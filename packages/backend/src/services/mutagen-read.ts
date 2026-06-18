// ============================================================================
// Mutagen: read service (leaderboard + per-wallet on-demand score)
// ============================================================================
//
// Thin domain layer behind routes/mutagen.ts (mirrors the Forge
// leaderboard.ts → cumulative-leaderboard.ts split). Framework-free so the
// verifier can exercise it without standing up HTTP.
//
// Per the on-demand + cached model:
//   - Leaderboard reads existing mutagen_user_scores rows. Default view is the
//     CURRENT sub-epoch; ?view=cumulative SUMs across the active epoch's
//     sub-epochs.
//   - Per-wallet is score-on-demand WITH cache: a fresh row (≤ TTL) for the
//     current sub-epoch is returned as-is; otherwise we compute live, persist,
//     and return.
//
// Response fields are NAMED (points_lp_mint, points_staking, …), not opaque
// a1..a5, and not Adrena's legacy trading/mutations/streaks/quests columns.
// The legacy-column bridge is deferred; we expose the true 5-Activity model
// and keep only the shared envelope keys (rank, user_wallet, total_points).
//
// Activity → field mapping (the one place it's defined):
//   1 LP minting  → points_lp_mint
//   2 Staking     → points_staking
//   3 Trading     → points_trading
//   4 ADX-LP      → points_adx_lp
//   5 Marketing   → points_marketing
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mutagenUserScores, mutagenSubEpochs } from '../db/schema.js';
import { getActiveEpoch, getActiveSubEpoch } from './mutagen-epoch.js';
import { scoreWalletForSubEpoch } from './mutagen-aggregator.js';
import type { EpochConfig } from './mutagen-scorer-types.js';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WALLET_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export type LeaderboardView = 'current' | 'cumulative';

export interface MutagenLeaderboardRow {
    rank: number;
    user_wallet: string;
    points_lp_mint: number;
    points_staking: number;
    points_trading: number;
    points_adx_lp: number;
    points_marketing: number;
    total_points: number;
}

export interface GetLeaderboardOpts {
    view?: LeaderboardView;
    limit?: number;
}

/**
 * Validates a base58 wallet address. Used by the route to return a clean 400
 * before any DB / RPC work happens.
 */
export function isValidWalletAddress(address: string): boolean {
    try {
        new PublicKey(address);
        return true;
    } catch {
        return false;
    }
}

function shapeLeaderboardRow(
    rank: number,
    wallet: string,
    a1: string,
    a2: string,
    a3: string,
    a4: string,
    a5: string,
    total: string,
): MutagenLeaderboardRow {
    return {
        rank,
        user_wallet: wallet,
        points_lp_mint: parseFloat(a1),
        points_staking: parseFloat(a2),
        points_trading: parseFloat(a3),
        points_adx_lp: parseFloat(a4),
        points_marketing: parseFloat(a5),
        total_points: parseFloat(total),
    };
}

/**
 * Leaderboard rows for the active epoch.
 *   - 'current'    → the live sub-epoch only (default).
 *   - 'cumulative' → SUM across every sub-epoch in the active epoch.
 * Empty array when there is no active epoch / sub-epoch.
 */
export async function getMutagenLeaderboard(
    opts: GetLeaderboardOpts = {},
): Promise<MutagenLeaderboardRow[]> {
    const view: LeaderboardView = opts.view === 'cumulative' ? 'cumulative' : 'current';
    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    if (view === 'current') {
        const active = await getActiveSubEpoch(new Date());
        if (!active) return [];
        const rows = await db
            .select({
                wallet: mutagenUserScores.wallet,
                a1: mutagenUserScores.activity1Score,
                a2: mutagenUserScores.activity2Score,
                a3: mutagenUserScores.activity3Score,
                a4: mutagenUserScores.activity4Score,
                a5: mutagenUserScores.activity5Score,
                total: mutagenUserScores.totalMutagen,
            })
            .from(mutagenUserScores)
            .where(eq(mutagenUserScores.subEpochId, active.subEpoch.id))
            .orderBy(desc(mutagenUserScores.totalMutagen))
            .limit(limit);
        return rows.map((r, i) =>
            shapeLeaderboardRow(i + 1, r.wallet, r.a1, r.a2, r.a3, r.a4, r.a5, r.total),
        );
    }

    // cumulative — across all sub-epochs of the active epoch
    const epoch = await getActiveEpoch();
    if (!epoch) return [];
    const subEpochs = await db
        .select({ id: mutagenSubEpochs.id })
        .from(mutagenSubEpochs)
        .where(eq(mutagenSubEpochs.epochId, epoch.id));
    const subEpochIds = subEpochs.map((s) => s.id);
    if (subEpochIds.length === 0) return [];

    const rows = await db
        .select({
            wallet: mutagenUserScores.wallet,
            a1: sql<string>`SUM(${mutagenUserScores.activity1Score})`,
            a2: sql<string>`SUM(${mutagenUserScores.activity2Score})`,
            a3: sql<string>`SUM(${mutagenUserScores.activity3Score})`,
            a4: sql<string>`SUM(${mutagenUserScores.activity4Score})`,
            a5: sql<string>`SUM(${mutagenUserScores.activity5Score})`,
            total: sql<string>`SUM(${mutagenUserScores.totalMutagen})`,
        })
        .from(mutagenUserScores)
        .where(inArray(mutagenUserScores.subEpochId, subEpochIds))
        .groupBy(mutagenUserScores.wallet)
        .orderBy(desc(sql`SUM(${mutagenUserScores.totalMutagen})`))
        .limit(limit);
    return rows.map((r, i) =>
        shapeLeaderboardRow(i + 1, r.wallet, r.a1, r.a2, r.a3, r.a4, r.a5, r.total),
    );
}

// ---------------------------------------------------------------------------
// Per-wallet score (on-demand with cache)
// ---------------------------------------------------------------------------

export interface WalletMutagenScore {
    wallet: string;
    sub_epoch_id: number;
    epoch_id: number;
    points_lp_mint: number;
    points_staking: number;
    points_trading: number;
    points_adx_lp: number;
    points_marketing: number;
    meta_mutation_multiplier: number;
    total_points: number;
    /**
     * The epoch's Activity weights (sum to 1.0). Surfaced so the UI can show
     * each activity's WEIGHTED contribution, not just its raw score — e.g. a
     * raw 188.5 staking score at 5% weight contributes less than a raw 39
     * trading score at 30%. Without this the frontend can't decompose the
     * weighted sum per activity.
     */
    weights: { a1: number; a2: number; a3: number; a4: number; a5: number };
    weighted_sum: number | null;
    qualified_count: number | null;
    details: unknown;
    computed_at: string; // ISO-8601
    cached: boolean;
    stale: boolean;
}

export type WalletScoreResult =
    | { state: 'ok'; data: WalletMutagenScore }
    | { state: 'no_active_sub_epoch' }
    | { state: 'in_progress' };

type WalletRow = typeof mutagenUserScores.$inferSelect;

async function readWalletRow(subEpochId: number, wallet: string): Promise<WalletRow | null> {
    const rows = await db
        .select()
        .from(mutagenUserScores)
        .where(
            and(
                eq(mutagenUserScores.subEpochId, subEpochId),
                eq(mutagenUserScores.wallet, wallet),
            ),
        )
        .limit(1);
    return rows[0] ?? null;
}

function shapeWalletRow(
    row: WalletRow,
    epochId: number,
    weights: WalletMutagenScore['weights'],
    cached: boolean,
    stale: boolean,
): WalletMutagenScore {
    const details = row.details as { weightedSum?: number; qualifiedCount?: number } | null;
    return {
        wallet: row.wallet,
        sub_epoch_id: row.subEpochId,
        epoch_id: epochId,
        points_lp_mint: parseFloat(row.activity1Score),
        points_staking: parseFloat(row.activity2Score),
        points_trading: parseFloat(row.activity3Score),
        points_adx_lp: parseFloat(row.activity4Score),
        points_marketing: parseFloat(row.activity5Score),
        meta_mutation_multiplier: parseFloat(row.metaMutationMultiplier),
        total_points: parseFloat(row.totalMutagen),
        weights,
        weighted_sum: details?.weightedSum ?? null,
        qualified_count: details?.qualifiedCount ?? null,
        details: row.details,
        computed_at: row.computedAt.toISOString(),
        cached,
        stale,
    };
}

/**
 * Per-wallet score for the current sub-epoch, on-demand with cache.
 *   - no active sub-epoch        → { state: 'no_active_sub_epoch' }  (route: 404)
 *   - fresh cached row (≤ TTL)   → cached: true
 *   - stale / missing            → compute live, persist, return (cached: false)
 *   - lock contention, prior row → return it (cached: true, stale: true) rather
 *                                  than blank out a known score
 *   - lock contention, no row    → { state: 'in_progress' }          (route: 202)
 *
 * Caller validates the base58 address first (so the route can 400 before any
 * DB/RPC work).
 */
export async function getWalletMutagenScore(
    walletBase58: string,
    opts: { ttlMs?: number } = {},
): Promise<WalletScoreResult> {
    const ttlMs = opts.ttlMs ?? WALLET_CACHE_TTL_MS;
    const active = await getActiveSubEpoch(new Date());
    if (!active) return { state: 'no_active_sub_epoch' };

    // Show the EFFECTIVE weights for this sub-epoch (per-sub-epoch override if set,
    // else the epoch config's), so the breakdown's weighted contributions are correct.
    const weights = active.subEpoch.weights ?? (active.epoch.config as EpochConfig).weights;

    const existing = await readWalletRow(active.subEpoch.id, walletBase58);
    if (existing && Date.now() - existing.computedAt.getTime() < ttlMs) {
        return { state: 'ok', data: shapeWalletRow(existing, active.epoch.id, weights, true, false) };
    }

    // Stale or missing → compute on demand.
    const outcome = await scoreWalletForSubEpoch(
        new PublicKey(walletBase58),
        active.subEpoch.id,
        active.subEpoch.startAt,
        active.subEpoch.endAt,
        active.epoch.config as EpochConfig,
    );

    if (!outcome.scored) {
        // Another process holds the lock. Prefer last-known over blank.
        if (existing) {
            return { state: 'ok', data: shapeWalletRow(existing, active.epoch.id, weights, true, true) };
        }
        return { state: 'in_progress' };
    }

    const fresh = await readWalletRow(active.subEpoch.id, walletBase58);
    if (!fresh) {
        // scoreWalletForSubEpoch upserts a row on success, so this is defensive.
        return { state: 'in_progress' };
    }
    return { state: 'ok', data: shapeWalletRow(fresh, active.epoch.id, weights, false, false) };
}
