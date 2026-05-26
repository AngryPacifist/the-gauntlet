// ============================================================================
// Activity 2 scorer — ADX Staking + DAO Voting
// ============================================================================
//
// ZeDef R2 Activity 2: weight 5% of total Mutagen. Two dimensions:
//   1. Stake — sum over ADX stakes (liquid + active locked):
//              stakeTierMultiplier(locked_days) × sizeBracketLookup(usd)
//   2. Vote  — bracketLookupCount(voteScoreCurve, voteCount_from_cache)
//
// Both dimensions qualified → 2-of-2 within-Activity mutation (ZeDef
// explicit: "I see a mutation linked to staking and also to dao voting").
//
// Stake data source: on-chain UserStaking account via AdrenaNativeLockSource
// (same path as Activity 1's lock dim). Empirically verified via Adrena
// program transaction logs that on-chain is authoritative — datapi /stake
// misses upgradeLockedStake updates and undercounts by significant amounts
// for some wallets. See lock-sources/adrena-native.ts header for details.
//
// Vote count: vote-cache (24h TTL, hits realms-client on miss). Daily
// scheduler keeps known wallets warm (Commit 17).
// ============================================================================

import { AdrenaNativeLockSource } from './lock-sources/adrena-native.js';
import { ADX_MINT } from './solana-constants.js';
import { getVoteCacheFreshOrRefresh } from './vote-cache.js';
import {
    bracketLookupCount,
    bracketLookupUsd,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
} from './mutagen-scorer-types.js';

// Singleton — stateless, threadsafe.
const lockSource = new AdrenaNativeLockSource();

// ADX has 6 decimals on-chain.
const ADX_DECIMALS = 6;
const ADX_DIVISOR = 10 ** ADX_DECIMALS;

export async function scoreActivity2(ctx: ScorerContext): Promise<ActivityScoreResult> {
    const walletStr = ctx.wallet.toBase58();

    // ---------- 1. Stake dimension — on-chain decode (liquid + locked) ----------
    const stakingState = await lockSource.getUserStakingState(ctx.wallet, ADX_MINT);

    let stakeScore = 0;
    const perStakeBreakdown: Array<{
        kind: 'liquid' | 'locked';
        durationDays: number;
        tierMult: number;
        amountAdx: number;
        amountUsd: number;
        sizeBracketPts: number;
        contribution: number;
    }> = [];

    // Liquid stake = tier 0 (locked_days = 0). Always uses the "0" multiplier.
    if (stakingState.liquidAmountRaw > 0n) {
        const amountAdx = Number(stakingState.liquidAmountRaw) / ADX_DIVISOR;
        const amountUsd = amountAdx * ctx.prices.adx;
        const tierMult = ctx.config.activity2.stakeTierMultipliers['0'] ?? 1.0;
        const sizeBracketPts = bracketLookupUsd(
            ctx.config.activity2.sizeBrackets,
            amountUsd,
        );
        const contribution = tierMult * sizeBracketPts;
        stakeScore += contribution;
        perStakeBreakdown.push({
            kind: 'liquid',
            durationDays: 0,
            tierMult,
            amountAdx,
            amountUsd,
            sizeBracketPts,
            contribution,
        });
    }

    // Locked stakes — each already filtered to active (amount>0, endTime>now,
    // resolved=0) and bucketed to nearest UI tier by AdrenaNativeLockSource.
    for (const lock of stakingState.locks) {
        const amountAdx = Number(lock.amountRaw) / ADX_DIVISOR;
        const amountUsd = amountAdx * ctx.prices.adx;
        const tierMult =
            ctx.config.activity2.stakeTierMultipliers[String(lock.durationDays)] ?? 1.0;
        const sizeBracketPts = bracketLookupUsd(
            ctx.config.activity2.sizeBrackets,
            amountUsd,
        );
        const contribution = tierMult * sizeBracketPts;
        stakeScore += contribution;
        perStakeBreakdown.push({
            kind: 'locked',
            durationDays: lock.durationDays,
            tierMult,
            amountAdx,
            amountUsd,
            sizeBracketPts,
            contribution,
        });
    }

    const stakeDim: DimensionScore = {
        dimension: 'stake',
        raw: stakeScore,
        qualifiedForMutation: stakeScore > 0,
        details: {
            liquidAmountAdx: Number(stakingState.liquidAmountRaw) / ADX_DIVISOR,
            lockedStakeCount: stakingState.locks.length,
            stakes: perStakeBreakdown,
        },
    };

    // ---------- 2. Vote dimension ----------
    const voteCacheEntry = await getVoteCacheFreshOrRefresh(walletStr);
    const voteCount = voteCacheEntry.voteCount;
    const voteScore = bracketLookupCount(
        ctx.config.activity2.voteScoreCurve,
        voteCount,
    );

    const voteDim: DimensionScore = {
        dimension: 'vote',
        raw: voteScore,
        qualifiedForMutation: voteCount > 0,
        details: {
            voteCount,
            hasTokenOwnerRecord: voteCacheEntry.hasTokenOwnerRecord,
            cacheRefreshedAt: voteCacheEntry.refreshedAt.toISOString(),
            bracketPts: voteScore,
        },
    };

    // ---------- 3. Within-Activity mutation ----------
    const dims = [stakeDim, voteDim];
    const qualifiedCount = dims.filter((d) => d.qualifiedForMutation).length;
    const extraQualified = Math.max(0, qualifiedCount - 1);
    const mutationFactor =
        1 + sumMutationIncrements(ctx.config.activity2.mutationIncrements, extraQualified);

    const baseScore = stakeScore + voteScore;
    const finalScore = baseScore * mutationFactor;

    return {
        activity: 2,
        baseScore,
        mutationFactor,
        finalScore,
        qualified: finalScore >= ctx.config.activity2.qualifyingThreshold,
        dimensions: dims,
    };
}

// Note: we don't gate on `vote count > 0` to determine if a wallet's voteCount
// dim is "active" for meta-mutation — that's the within-Activity 2 mutation
// (vote dim qualified iff voteCount > 0). The Activity-level qualifyingThreshold
// is applied to the final score (after × mutationFactor), not to individual dims.
// This matches Activity 1 and the meta-mutation design in §9.
