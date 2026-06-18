// ============================================================================
// Mutagen Aggregator: per-wallet, per-sub-epoch orchestrator
// ============================================================================
//
// One-call entry point for "score this wallet for this sub-epoch":
//   1. Acquire a row in mutagen_scoring_locks (prevents two schedulers /
//      API hits from racing on the same wallet).
//   2. Fetch live USD prices for ADX/ALP/RWALP/SOL/USDC.
//   3. Run all 5 Activity scorers in parallel via safeScoreActivity:
//      a thrown scorer becomes an emptyActivityResult + an entry in the
//      audit's `errors[]`, doesn't fail the whole run.
//   4. Aggregate via aggregateAndApplyMetaMutation (cross-Activity weights +
//      meta-mutation multiplier).
//   5. Upsert to mutagen_user_scores (the leaderboard read-path).
//   6. Insert a row to mutagen_snapshots (audit trail with raw_inputs).
//   7. Release the lock.
//
// The function is idempotent across re-runs (upsert semantics + lock-based
// concurrency control). Stale locks (older than the TTL) are reaped on
// acquisition attempt.
//
// SOL/USD comes from the shared Pyth OHLC client (Pyth Benchmarks primary,
// Adrena Lazer fallback, both with retry/backoff): the same source the rest
// of the platform prices against, using the latest intraday close as spot.
// It is cached briefly with a last-known fallback so a transient miss never
// zeroes the SOL side of a position. ADX/ALP/RWALP from Adrena's /last-price;
// USDC = $1 by convention.
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    mutagenUserScores,
    mutagenSnapshots,
    mutagenScoringLocks,
    mutagenSubEpochs,
} from '../db/schema.js';
import { AdrenaClient } from './adrena-client.js';
import { fetchIntradayOHLC } from './pyth-client.js';
import { scoreActivity1 } from './mutagen-lp-scorer.js';
import { scoreActivity2 } from './mutagen-staking-scorer.js';
import { scoreActivity3 } from './mutagen-trading-scorer.js';
import { scoreActivity4 } from './mutagen-adx-lp-scorer.js';
import { scoreActivity5 } from './mutagen-referrer-scorer.js';
import {
    aggregateAndApplyMetaMutation,
    emptyActivityResult,
    type AggregateResult,
} from './mutagen-mutations.js';
import type {
    ActivityScoreResult,
    EpochConfig,
    ScorerContext,
} from './mutagen-scorer-types.js';

const adrenaClient = new AdrenaClient();

// Lock TTL — long enough for a slow scoring run (Helius + datapi + DB) to
// complete, short enough that a crashed process gets unblocked quickly.
const SCORING_LOCK_TTL_MS = 5 * 60 * 1000; // 5 min

export interface AggregatorOptions {
    /** If true, throws on lock acquisition failure. Default false (skip silently). */
    throwOnLockBusy?: boolean;
}

export interface ScoreWalletOutcome {
    /** AggregateResult if scoring ran, null if skipped due to lock contention. */
    result: AggregateResult | null;
    /** Per-scorer errors, if any. Empty if all scorers succeeded. */
    errors: Array<{ activity: 1 | 2 | 3 | 4 | 5; message: string }>;
    /** Whether we held the lock and wrote the score (false = skipped). */
    scored: boolean;
}

/**
 * Main entry point: score one wallet for one sub-epoch.
 * Returns { scored: false } if another process holds the lock.
 */
export async function scoreWalletForSubEpoch(
    wallet: PublicKey,
    subEpochId: number,
    subEpochStart: Date,
    subEpochEnd: Date,
    config: EpochConfig,
    opts: AggregatorOptions = {},
): Promise<ScoreWalletOutcome> {
    const walletStr = wallet.toBase58();

    // --- 1. Acquire lock ---
    const acquired = await tryAcquireLock(walletStr, subEpochId, SCORING_LOCK_TTL_MS);
    if (!acquired) {
        if (opts.throwOnLockBusy) {
            throw new Error(`[mutagen-aggregator] Another process is scoring ${walletStr} for sub-epoch ${subEpochId}`);
        }
        return { result: null, errors: [], scored: false };
    }

    try {
        // --- 2. Fetch live prices ---
        const prices = await fetchScoringPrices();

        const baseCtx: ScorerContext = {
            wallet,
            subEpochId,
            subEpochStart,
            subEpochEnd,
            config,
            prices,
        };

        // --- 3. Run all 5 scorers in parallel via safeScoreActivity ---
        const errors: Array<{ activity: 1 | 2 | 3 | 4 | 5; message: string }> = [];

        const [a1, a2, a3, a4, a5] = await Promise.all([
            safeScoreActivity(1, () => scoreActivity1(baseCtx), errors),
            safeScoreActivity(2, () => scoreActivity2(baseCtx), errors),
            safeScoreActivity(3, () => scoreActivity3(baseCtx), errors),
            safeScoreActivity(4, () => scoreActivity4(baseCtx), errors),
            safeScoreActivity(5, () => scoreActivity5(baseCtx), errors),
        ]);
        const results: ActivityScoreResult[] = [a1, a2, a3, a4, a5];

        // --- 4. Aggregate (with per-sub-epoch weight override, weights-only) ---
        // A sub-epoch may carry its own weights (set forward via admin before it
        // starts); null = inherit the epoch config's weights. Resolved here, the
        // single place weights are applied, so no caller can bypass the override.
        const [seRow] = await db
            .select({ weights: mutagenSubEpochs.weights })
            .from(mutagenSubEpochs)
            .where(eq(mutagenSubEpochs.id, subEpochId))
            .limit(1);
        const effectiveConfig = seRow?.weights ? { ...config, weights: seRow.weights } : config;
        const agg = aggregateAndApplyMetaMutation(results, effectiveConfig);

        // --- 5. Upsert mutagen_user_scores ---
        // Stores both the aggregate fields (for leaderboard queries) and the
        // full per-activity finalScores for per-wallet breakdown UI.
        await db
            .insert(mutagenUserScores)
            .values({
                subEpochId,
                wallet: walletStr,
                activity1Score: String(a1.finalScore),
                activity2Score: String(a2.finalScore),
                activity3Score: String(a3.finalScore),
                activity4Score: String(a4.finalScore),
                activity5Score: String(a5.finalScore),
                metaMutationMultiplier: String(agg.metaMutationMultiplier),
                totalMutagen: String(agg.totalMutagen),
                details: {
                    weightedSum: agg.weightedSum,
                    qualifiedCount: agg.qualifiedCount,
                    activities: results.map((r) => ({
                        activity: r.activity,
                        baseScore: r.baseScore,
                        mutationFactor: r.mutationFactor,
                        finalScore: r.finalScore,
                        qualified: r.qualified,
                        dimensions: r.dimensions,
                    })),
                    errors,
                },
            })
            .onConflictDoUpdate({
                target: [mutagenUserScores.subEpochId, mutagenUserScores.wallet],
                set: {
                    activity1Score: String(a1.finalScore),
                    activity2Score: String(a2.finalScore),
                    activity3Score: String(a3.finalScore),
                    activity4Score: String(a4.finalScore),
                    activity5Score: String(a5.finalScore),
                    metaMutationMultiplier: String(agg.metaMutationMultiplier),
                    totalMutagen: String(agg.totalMutagen),
                    details: {
                        weightedSum: agg.weightedSum,
                        qualifiedCount: agg.qualifiedCount,
                        activities: results.map((r) => ({
                            activity: r.activity,
                            baseScore: r.baseScore,
                            mutationFactor: r.mutationFactor,
                            finalScore: r.finalScore,
                            qualified: r.qualified,
                            dimensions: r.dimensions,
                        })),
                        errors,
                    },
                    computedAt: new Date(),
                },
            });

        // --- 6. Insert audit snapshot ---
        await db.insert(mutagenSnapshots).values({
            subEpochId,
            wallet: walletStr,
            rawInputs: {
                prices,
                errors,
            },
        });

        return { result: agg, errors, scored: true };
    } finally {
        // --- 7. Release lock (always, even on throw) ---
        await releaseLock(walletStr, subEpochId);
    }
}

// ---------- Internal helpers ----------

/**
 * Wraps a scorer call. Throws are caught and converted to an emptyActivityResult
 * + an entry in the errors[] array. This isolates a failing scorer
 * from collapsing the whole run.
 */
async function safeScoreActivity(
    activity: 1 | 2 | 3 | 4 | 5,
    fn: () => Promise<ActivityScoreResult>,
    errors: Array<{ activity: 1 | 2 | 3 | 4 | 5; message: string }>,
): Promise<ActivityScoreResult> {
    try {
        return await fn();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[mutagen-aggregator] Activity ${activity} failed:`, message);
        errors.push({ activity, message });
        return emptyActivityResult(activity, message);
    }
}

/**
 * Tries to insert a lock row. Returns true on success.
 * On PK collision, checks if the existing lock is stale (past expiresAt) —
 * if so, deletes it and retries once. Otherwise returns false.
 */
async function tryAcquireLock(
    wallet: string,
    subEpochId: number,
    ttlMs: number,
): Promise<boolean> {
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
        await db.insert(mutagenScoringLocks).values({ wallet, subEpochId, expiresAt });
        return true;
    } catch {
        // Most likely a PK conflict. Check if the existing lock is stale.
        const existing = await db
            .select()
            .from(mutagenScoringLocks)
            .where(
                and(
                    eq(mutagenScoringLocks.wallet, wallet),
                    eq(mutagenScoringLocks.subEpochId, subEpochId),
                ),
            )
            .limit(1);
        if (existing[0] && existing[0].expiresAt < new Date()) {
            // Stale — reap and retry exactly once
            await db
                .delete(mutagenScoringLocks)
                .where(
                    and(
                        eq(mutagenScoringLocks.wallet, wallet),
                        eq(mutagenScoringLocks.subEpochId, subEpochId),
                    ),
                );
            try {
                await db.insert(mutagenScoringLocks).values({ wallet, subEpochId, expiresAt });
                return true;
            } catch {
                return false; // someone else beat us to the reap
            }
        }
        return false;
    }
}

async function releaseLock(wallet: string, subEpochId: number): Promise<void> {
    await db
        .delete(mutagenScoringLocks)
        .where(
            and(
                eq(mutagenScoringLocks.wallet, wallet),
                eq(mutagenScoringLocks.subEpochId, subEpochId),
            ),
        );
}

// SOL/USD: cache the last good price so a transient fetch miss reuses it
// instead of zeroing the SOL side of any SOL-paired LP valuation. Short TTL
// so we hit the network at most once a minute (SOL/USD is stable within that
// window, and many wallet scoring runs can share one value).
let solCache: { usd: number; at: number } | null = null;
const SOL_PRICE_TTL_MS = 60 * 1000;

/**
 * SOL/USD via the shared Pyth OHLC client (Pyth Benchmarks primary, Adrena
 * Lazer fallback, both with retry/backoff). Uses the latest intraday close as
 * the spot value. On a transient miss, reuses the last known price (and backs
 * off so we retry at most once per TTL during an outage). Returns 0 only if a
 * price has never been obtained.
 */
async function fetchSolUsd(): Promise<number> {
    if (solCache && Date.now() - solCache.at < SOL_PRICE_TTL_MS) {
        return solCache.usd;
    }
    try {
        const today = new Date().toISOString().slice(0, 10);
        const bar = await fetchIntradayOHLC('SOL', today);
        if (bar && Number.isFinite(bar.close) && bar.close > 0) {
            solCache = { usd: bar.close, at: Date.now() };
            return bar.close;
        }
    } catch (e) {
        console.warn('[mutagen-aggregator] SOL price fetch threw:', e instanceof Error ? e.message : e);
    }
    if (solCache && solCache.usd > 0) {
        // Reuse last known; bump the timestamp so we back off to one retry per
        // TTL instead of hammering the failing source every run.
        solCache = { usd: solCache.usd, at: Date.now() };
        console.warn(`[mutagen-aggregator] SOL price unavailable; using last known ${solCache.usd}`);
        return solCache.usd;
    }
    console.warn('[mutagen-aggregator] SOL price unavailable and no cached value; using 0');
    return 0;
}

/**
 * Fetches the price record needed by all 5 scorers. ADX/ALP/RWALP via Adrena's
 * /last-price; SOL via fetchSolUsd (Pyth OHLC client); USDC = 1.0 by convention.
 */
async function fetchScoringPrices(): Promise<ScorerContext['prices']> {
    const [adrenaPrices, sol] = await Promise.all([
        adrenaClient.getLastPrices(),
        fetchSolUsd(),
    ]);
    return {
        adx: parseFloat(adrenaPrices.adx.price),
        alp: parseFloat(adrenaPrices.alp.price),
        rwalp: parseFloat(adrenaPrices.rwalp.price),
        sol,
        usdc: 1.0,
    };
}

// Internal re-exports for testing
export { tryAcquireLock, releaseLock, safeScoreActivity, fetchScoringPrices };
