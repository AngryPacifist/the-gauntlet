// ============================================================================
// Mutagen R2 Aggregator — per-wallet, per-sub-epoch orchestrator
// ============================================================================
//
// One-call entry point for "score this wallet for this sub-epoch":
//   1. Acquire a row in mutagen_scoring_locks (Gap 12) — prevents two
//      schedulers / API hits from racing on the same wallet.
//   2. Fetch live USD prices for ADX/ALP/RWALP/SOL/USDC.
//   3. Run all 5 Activity scorers in parallel via safeScoreActivity (Gap 14)
//      — a thrown scorer becomes an emptyActivityResult + an entry in the
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
// SOL price comes from Pyth Hermes (the official Pyth price API, free,
// no auth). ADX/ALP/RWALP from Adrena's own /last-price; USDC = $1
// by convention. Hermes used over Jupiter Lite because the latter has
// been failing TLS handshakes from this environment (verified 2026-05-26).
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    mutagenUserScores,
    mutagenSnapshots,
    mutagenScoringLocks,
} from '../db/schema.js';
import { AdrenaClient } from './adrena-client.js';
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

        // --- 4. Aggregate ---
        const agg = aggregateAndApplyMetaMutation(results, config);

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
 * + an entry in the errors[] array. Per Gap 14, this isolates a failing scorer
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

// Pyth Hermes SOL/USD feed (hex feed ID — distinct from Lazer's numeric IDs).
const PYTH_SOL_USD_FEED_HEX = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

/**
 * Fetches the price record needed by all 5 scorers. ADX/ALP/RWALP via
 * Adrena's own /last-price; SOL via Pyth Hermes; USDC = 1.0 by convention.
 *
 * If SOL fetch fails, falls back to 0 so the run still completes —
 * Activity 4's SOL-paired pool valuation would value the SOL side at 0
 * for the run. Logged loudly so we notice.
 */
async function fetchScoringPrices(): Promise<ScorerContext['prices']> {
    const adrenaPrices = await adrenaClient.getLastPrices();
    let sol = 0;
    try {
        const url = `https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=${PYTH_SOL_USD_FEED_HEX}`;
        const res = await fetch(url);
        if (res.ok) {
            const body = await res.json() as {
                parsed?: Array<{ price?: { price?: string; expo?: number } }>;
            };
            const p = body.parsed?.[0]?.price;
            if (p?.price && typeof p.expo === 'number') {
                sol = Number(p.price) * Math.pow(10, p.expo);
            }
        }
    } catch (e) {
        console.warn('[mutagen-aggregator] Pyth Hermes SOL price fetch failed:', (e as Error).message);
    }

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
