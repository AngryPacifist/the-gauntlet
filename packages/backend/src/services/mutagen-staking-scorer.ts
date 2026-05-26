// ============================================================================
// Activity 2 scorer — ADX Staking + DAO Voting
// ============================================================================
//
// ZeDef R2 Activity 2: weight 5% of total Mutagen. Two dimensions:
//   1. Stake  — Σ over open ADX stakes: stakeTierMultiplier(locked_days)
//               × sizeBracketLookup(stake_amount_usd)
//   2. Vote   — bracketLookupCount(voteScoreCurve, vote_count)
//
// Both dimensions qualified → 2-of-2 within-Activity mutation (ZeDef
// explicit: "I see a mutation linked to staking and also to dao voting").
//
// Data sources:
//   - Stakes: Adrena datapi /stake?user_wallet=X (covers liquid + locked,
//     both ADX and ALP; we filter to ADX here — ALP locks are scored by
//     Activity 1, not double-counted).
//   - Vote count: vote-cache (24h TTL refresh, falls back to live SPL Gov
//     getProgramAccounts on miss). Daily scheduler keeps known wallets
//     warm (Commit 17).
//
// Sub-tier on-chain lock durations bucket to the nearest UI tier via the
// shared `bucketToNearestTier` helper (e.g. a 7-day ADX lock buckets to
// tier 0; a 60-day to 90, etc.). Matches what users see on /stake.
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { AdrenaClient, type AdrenaStake } from './adrena-client.js';
import { getVoteCacheFreshOrRefresh } from './vote-cache.js';
import {
    ADX_TIERS_DAYS,
    bracketLookupCount,
    bracketLookupUsd,
    bucketToNearestTier,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
} from './mutagen-scorer-types.js';

// Singleton client — re-uses positionCache across scoring runs (won't
// affect /stake reads, which are uncached at the client level).
const adrenaClient = new AdrenaClient();

export async function scoreActivity2(ctx: ScorerContext): Promise<ActivityScoreResult> {
    const walletStr = ctx.wallet.toBase58();

    // ---------- 1. Stake dimension ----------
    // /stake returns BOTH liquid + locked, ADX + ALP. Filter to open ADX only.
    const allStakes = await fetchOpenAdxStakes(walletStr);

    let stakeScore = 0;
    const perStakeBreakdown: Array<{
        stake_id: number;
        locked_days: number;
        bucketedTier: number;
        tierMult: number;
        amountAdx: number;
        amountUsd: number;
        sizeBracketPts: number;
        contribution: number;
    }> = [];

    for (const stake of allStakes) {
        const bucketedTier = bucketToNearestTier(stake.locked_days, ADX_TIERS_DAYS);
        const tierMult =
            ctx.config.activity2.stakeTierMultipliers[String(bucketedTier)] ?? 1.0;
        const amountUsd = stake.remaining_amount * ctx.prices.adx;
        const sizeBracketPts = bracketLookupUsd(
            ctx.config.activity2.sizeBrackets,
            amountUsd,
        );
        const contribution = tierMult * sizeBracketPts;
        stakeScore += contribution;
        perStakeBreakdown.push({
            stake_id: stake.stake_id,
            locked_days: stake.locked_days,
            bucketedTier,
            tierMult,
            amountAdx: stake.remaining_amount,
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
            stakeCount: allStakes.length,
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

/**
 * Lookback window for /stake — covers the longest possible ADX lock (540d)
 * plus a safety margin. The endpoint defaults to ~25 days otherwise, which
 * misses any stake initiated before that and silently undercounts (verified
 * empirically: ZeDef has 7 active 540-day ADX locks from Nov 2024 that the
 * default window excludes — visible only with a longer start_date).
 */
const STAKE_LOOKBACK_DAYS = 600;

/**
 * Fetches /stake for a wallet, narrows to open ADX-only stakes.
 * Returns [] if the wallet has no stakes (the datapi returns a 404 in
 * that case, which AdrenaClient swallows to an empty list).
 *
 * Why filter on `status === 'open'`: closed stakes are historical and
 * don't represent current ADX commitment to the protocol; scoring would
 * double-credit a user who closed and reopened.
 *
 * Why filter on `symbol === 'ADX'`: ALP stakes belong to Activity 1
 * (LP lock dim). Including them here would double-count.
 *
 * Suppresses /stake's "Not found" response (which AdrenaClient surfaces
 * as a thrown error for some wallets) — semantics are "no stakes" so we
 * treat it as []. Any other error propagates.
 */
async function fetchOpenAdxStakes(wallet: string): Promise<AdrenaStake[]> {
    const startDate = new Date(Date.now() - STAKE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    let stakes: AdrenaStake[];
    try {
        stakes = await adrenaClient.getStakes(wallet, startDate);
    } catch (err) {
        const msg = String(err);
        // The datapi returns 404 with {"error":"Not found"} when the user
        // has no UserStaking accounts at all. Treat as empty list.
        if (msg.includes('Not found') || msg.includes('404')) return [];
        throw err;
    }
    return stakes.filter((s) => s.symbol === 'ADX' && s.status === 'open');
}

// Note: we don't gate on `vote count > 0` to determine if a wallet's voteCount
// dim is "active" for meta-mutation — that's the within-Activity 2 mutation
// (vote dim qualified iff voteCount > 0). The Activity-level qualifyingThreshold
// is applied to the final score (after × mutationFactor), not to individual dims.
// This matches Activity 1 and the meta-mutation design in §9.
export { fetchOpenAdxStakes }; // exported for direct testing
