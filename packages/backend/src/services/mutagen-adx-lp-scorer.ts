// ============================================================================
// Activity 4 scorer: ADX LP on Meteora (governance-token liquidity)
// ============================================================================
//
// Activity 4: weight 30% of total Mutagen. Scoring rewards the
// time-weighted size of LP positions across enabled pools.
//
// Algorithm per enabled pool (config.activity4.pools where enabled=true):
//   1. Read time-series of position-value snapshots from
//      mutagen_position_snapshots (one row per hourly snapshot, written by
//      the scheduler job).
//   2. Compute trapezoidal time-weighted average (TWA) of position USD value
//      over the snapshots within the current sub-epoch. With ≥2 snapshots
//      we have intervals; with 1 we use that single value; with 0 we cold-
//      start by doing a live read.
//   3. size_score(pool) = bracketLookupUsd(twa_usd) × pool.weight
//   4. has_been_active(pool) = twa_usd > 0
//
// Aggregate:
//   - size_score = Σ size_score(pool) across enabled pools
//   - active_pool_count = count(has_been_active)
//   - within-Activity mutation rewards being LP in MULTIPLE pools (the
//     "Activity on both pools" dimension). extraQualified =
//     active_pool_count - 1 → sumMutationIncrements over config.activity4.
//
// USD valuation: positions hold X + Y token amounts; we look up each token's
// USD price via ctx.prices (adx / alp / rwalp / sol / usdc). Token decimals
// come from the DLMM SDK (tokenX.decimal / tokenY.decimal). Unknown tokens
// (e.g. BONK if ever in a pool) value to 0 — Activity 4 default scope is
// the 4 ADX/ALP Meteora pools, all using known tokens.
//
// The hourly scheduler job writes to mutagen_position_snapshots; a wallet
// with no snapshots yet cold-starts with a live RPC read (see the cold-start
// path below).
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mutagenPositionSnapshots } from '../db/schema.js';
import {
    getWalletPositionsForPool,
    getPoolTokenInfo,
    type MeteoraPositionSummary,
    type PoolTokenInfo,
} from './meteora-dlmm-client.js';
import {
    ADX_MINT,
    ALP_MINT,
    RWALP_MINT,
    USDC_MINT,
    WSOL_MINT,
} from './solana-constants.js';
import {
    bracketLookupUsd,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
} from './mutagen-scorer-types.js';

// Cache pool-token info for the lifetime of the process — the (X,Y) ordering
// for a given pool never changes, so one fetch per pool is enough.
const poolInfoCache = new Map<string, PoolTokenInfo>();

async function getCachedPoolInfo(poolAddress: PublicKey): Promise<PoolTokenInfo> {
    const key = poolAddress.toBase58();
    const cached = poolInfoCache.get(key);
    if (cached) return cached;
    const info = await getPoolTokenInfo(poolAddress);
    poolInfoCache.set(key, info);
    return info;
}

/**
 * Maps a token mint (base58) to its USD price from ctx.prices.
 * Returns 0 for unknown mints — those sides of positions don't contribute
 * to USD value, which is the safest conservative default.
 */
function priceForMint(mintBase58: string, prices: ScorerContext['prices']): number {
    if (mintBase58 === ADX_MINT.toBase58()) return prices.adx;
    if (mintBase58 === ALP_MINT.toBase58()) return prices.alp;
    if (mintBase58 === RWALP_MINT.toBase58()) return prices.rwalp;
    if (mintBase58 === USDC_MINT.toBase58()) return prices.usdc;
    if (mintBase58 === WSOL_MINT.toBase58()) return prices.sol;
    return 0;
}

/**
 * Converts a wallet's positions in one pool to a single USD total.
 * Sums X-side value + Y-side value across every position the wallet holds
 * in the pool.
 */
function computeUsdValueFromPositions(
    positions: MeteoraPositionSummary[],
    pool: PoolTokenInfo,
    prices: ScorerContext['prices'],
): number {
    const xPrice = priceForMint(pool.tokenXMint, prices);
    const yPrice = priceForMint(pool.tokenYMint, prices);
    const xDivisor = 10 ** pool.tokenXDecimals;
    const yDivisor = 10 ** pool.tokenYDecimals;

    let totalUsd = 0;
    for (const pos of positions) {
        const xUsd = (Number(pos.totalXAmount) / xDivisor) * xPrice;
        const yUsd = (Number(pos.totalYAmount) / yDivisor) * yPrice;
        totalUsd += xUsd + yUsd;
    }
    return totalUsd;
}

interface PositionSnapshotRow {
    positionValueUsd: string;
    snapshottedAt: Date;
}

/**
 * Trapezoidal time-weighted average across snapshots within the sub-epoch.
 * Each pair of consecutive snapshots contributes
 *   (value_n + value_n+1) / 2 × (time_n+1 - time_n)
 * to the area; we then divide by total time span for the average.
 *
 * With ≥2 snapshots this gives a proper TWA. With 1 snapshot we just
 * return that value (no interval to weight). With 0 snapshots the caller
 * does a cold-start instead.
 */
function computeTimeWeightedAverage(snapshots: PositionSnapshotRow[]): number {
    if (snapshots.length === 0) return 0;
    if (snapshots.length === 1) return parseFloat(snapshots[0].positionValueUsd);

    let areaSum = 0;
    let totalMs = 0;
    for (let i = 0; i < snapshots.length - 1; i++) {
        const v0 = parseFloat(snapshots[i].positionValueUsd);
        const v1 = parseFloat(snapshots[i + 1].positionValueUsd);
        const t0 = snapshots[i].snapshottedAt.getTime();
        const t1 = snapshots[i + 1].snapshottedAt.getTime();
        const dtMs = t1 - t0;
        if (dtMs <= 0) continue; // skip non-monotonic timestamps defensively
        areaSum += ((v0 + v1) / 2) * dtMs;
        totalMs += dtMs;
    }
    if (totalMs === 0) return parseFloat(snapshots[0].positionValueUsd);
    return areaSum / totalMs;
}

export async function scoreActivity4(ctx: ScorerContext): Promise<ActivityScoreResult> {
    const walletStr = ctx.wallet.toBase58();
    const enabledPools = ctx.config.activity4.pools.filter((p) => p.enabled);

    interface PoolBreakdown {
        address: string;
        label: string;
        weight: number;
        twaUsd: number;
        bracketPts: number;
        weightedPts: number;
        snapshotCount: number;
        coldStart: boolean;
        hasBeenActive: boolean;
    }

    let totalSizeScore = 0;
    let activePoolCount = 0;
    const poolBreakdown: PoolBreakdown[] = [];

    for (const pool of enabledPools) {
        const poolPk = new PublicKey(pool.address);

        // 1. Try to read snapshots from this sub-epoch for this (wallet, pool)
        const snapshots: PositionSnapshotRow[] = await db
            .select({
                positionValueUsd: mutagenPositionSnapshots.positionValueUsd,
                snapshottedAt: mutagenPositionSnapshots.snapshottedAt,
            })
            .from(mutagenPositionSnapshots)
            .where(
                and(
                    eq(mutagenPositionSnapshots.wallet, walletStr),
                    eq(mutagenPositionSnapshots.subEpochId, ctx.subEpochId),
                    eq(mutagenPositionSnapshots.poolAddress, pool.address),
                ),
            )
            .orderBy(asc(mutagenPositionSnapshots.snapshottedAt));

        // 2. Cold-start vs TWA
        let twaUsd: number;
        let coldStart = false;
        if (snapshots.length === 0) {
            // Cold start: no historical snapshots. Live read + treat as
            // single datapoint. The scheduler job fills in the time series
            // so subsequent runs get a proper TWA.
            coldStart = true;
            try {
                const positions = await getWalletPositionsForPool(ctx.wallet, poolPk);
                const poolInfo = await getCachedPoolInfo(poolPk);
                twaUsd = computeUsdValueFromPositions(positions, poolInfo, ctx.prices);
            } catch (e) {
                // If the SDK can't decode the pool (e.g., admin enabled a
                // Raydium pool by mistake), score it as 0 and log. Don't
                // fail the whole Activity 4 run.
                console.warn(`[mutagen-activity-4] Failed to read pool ${pool.address} (${pool.label}): ${(e as Error).message}`);
                twaUsd = 0;
            }
        } else {
            twaUsd = computeTimeWeightedAverage(snapshots);
        }

        const bracketPts = bracketLookupUsd(ctx.config.activity4.sizeBrackets, twaUsd);
        const weightedPts = bracketPts * pool.weight;
        totalSizeScore += weightedPts;

        const hasBeenActive = twaUsd > 0;
        if (hasBeenActive) activePoolCount += 1;

        poolBreakdown.push({
            address: pool.address,
            label: pool.label,
            weight: pool.weight,
            twaUsd,
            bracketPts,
            weightedPts,
            snapshotCount: snapshots.length,
            coldStart,
            hasBeenActive,
        });
    }

    // ---------- Within-Activity mutation ----------
    // Being LP in multiple enabled pools is the bonus dim. extraQualified =
    // activePoolCount - 1 (the first active pool earns base; each additional
    // adds an increment).
    const extraQualified = Math.max(0, activePoolCount - 1);
    const mutationFactor =
        1 + sumMutationIncrements(ctx.config.activity4.mutationIncrements, extraQualified);

    const baseScore = totalSizeScore;
    const finalScore = baseScore * mutationFactor;

    // Single dimension exposed externally (size), but the active-pool count
    // drives the mutation. Expose both via details for transparency.
    const sizeDim: DimensionScore = {
        dimension: 'size',
        raw: totalSizeScore,
        qualifiedForMutation: totalSizeScore > 0,
        details: {
            enabledPoolCount: enabledPools.length,
            activePoolCount,
            pools: poolBreakdown,
        },
    };

    return {
        activity: 4,
        baseScore,
        mutationFactor,
        finalScore,
        qualified: finalScore >= ctx.config.activity4.qualifyingThreshold,
        dimensions: [sizeDim],
    };
}

// Re-exports for testing — verifier can poke individual paths.
export { computeUsdValueFromPositions, computeTimeWeightedAverage };
