// ============================================================================
// Activity 2 scorer: ADX Staking + DAO Voting
// ============================================================================
//
// Activity 2: weight 5% of total Mutagen. Two dimensions:
//   1. Stake - a wallet's TOTAL LOCKED ADX amount (liquid excluded) looked up
//              in the ADX-amount size ladder, times a stake-weighted-average
//              duration tier multiplier (each lock's tier weighted by its ADX).
//   2. Vote  - DAO vote count through voteScoreCurve. Skipped entirely when
//              config.activity2.voteEnabled is false (zero-weighted: 0 score,
//              no within-Activity mutation, no governance RPC).
//
// Both dimensions qualified gives the 2-of-2 within-Activity mutation; with
// voting off, only the stake dim qualifies so the mutation factor stays 1.0.
//
// Stake data source: on-chain UserStaking via AdrenaNativeLockSource (same
// path as Activity 1's lock dim). On-chain is authoritative over the datapi
// /stake endpoint, which misses upgradeLockedStake updates. See
// lock-sources/adrena-native.ts for details.
//
// Vote count: vote-cache (24h TTL, hits realms-client on miss). The daily
// scheduler keeps known wallets warm (only while voting is enabled).
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

    // ---------- 1. Stake dimension ----------
    // Size = the wallet's TOTAL LOCKED ADX amount (liquid excluded) through the
    // ADX-amount ladder. Duration = a stake-weighted-average tier multiplier
    // (each lock's tier weighted by its ADX amount). score = sizePts x tier.
    const stakingState = await lockSource.getUserStakingState(ctx.wallet, ADX_MINT);

    let totalLockedAdx = 0;
    let weightedTierNumerator = 0;
    const perLockBreakdown: Array<{
        durationDays: number;
        tierMult: number;
        amountAdx: number;
    }> = [];

    // Locked stakes only — each already filtered to active (amount>0,
    // endTime>now, resolved=0) and bucketed to nearest UI tier by the lock
    // source. Liquid stake is deliberately NOT counted toward size.
    for (const lock of stakingState.locks) {
        const amountAdx = Number(lock.amountRaw) / ADX_DIVISOR;
        const tierMult =
            ctx.config.activity2.stakeTierMultipliers[String(lock.durationDays)] ?? 1.0;
        totalLockedAdx += amountAdx;
        weightedTierNumerator += amountAdx * tierMult;
        perLockBreakdown.push({ durationDays: lock.durationDays, tierMult, amountAdx });
    }

    const sizeBracketPts = bracketLookupUsd(ctx.config.activity2.sizeBrackets, totalLockedAdx);
    const weightedTier = totalLockedAdx > 0 ? weightedTierNumerator / totalLockedAdx : 0;
    const stakeScore = sizeBracketPts * weightedTier;

    const stakeDim: DimensionScore = {
        dimension: 'stake',
        raw: stakeScore,
        qualifiedForMutation: stakeScore > 0,
        details: {
            totalLockedAdx,
            // Recorded for transparency but NOT in the size metric (the "$ADX
            // Locked" column is locked-only).
            liquidAmountAdx: Number(stakingState.liquidAmountRaw) / ADX_DIVISOR,
            lockedStakeCount: stakingState.locks.length,
            sizeBracketPts,
            weightedTier,
            locks: perLockBreakdown,
        },
    };

    // ---------- 2. Vote dimension ----------
    // Zero-weighted when disabled: skip the (expensive) governance read entirely,
    // contribute 0 score, and don't count toward the within-Activity mutation.
    let voteScore = 0;
    let voteDim: DimensionScore;
    if (ctx.config.activity2.voteEnabled) {
        const voteCacheEntry = await getVoteCacheFreshOrRefresh(walletStr);
        const voteCount = voteCacheEntry.voteCount;
        voteScore = bracketLookupCount(ctx.config.activity2.voteScoreCurve, voteCount);
        voteDim = {
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
    } else {
        voteDim = {
            dimension: 'vote',
            raw: 0,
            qualifiedForMutation: false,
            details: { voteEnabled: false, skipped: true },
        };
    }

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

// Note: when voting is enabled, the vote dim's "qualified" flag is voteCount>0,
// which drives only the within-Activity-2 mutation (not the score directly). The
// Activity-level qualifyingThreshold is applied to the FINAL score (after the
// mutation factor), not to individual dims. When voteEnabled is false the vote
// dim never qualifies. This matches Activity 1 and the meta-mutation design.
