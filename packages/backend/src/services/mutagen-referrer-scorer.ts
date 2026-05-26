// ============================================================================
// Activity 5 scorer — Marketing (Referrer + admin-manual social/Discord)
// ============================================================================
//
// ZeDef R2 Activity 5: weight 5% of total Mutagen. Three dimensions:
//   1. Referrer — datapi /referrer-rewards: USDC earned via referrals in the
//                 epoch window (Gap 3 — epoch-window filter applied) +
//                 per-referee bonus (capped). Only counts when wallet is
//                 is_approved=true.
//   2. Social   — admin-manual awards via mutagen_marketing_awards
//                 (activity_type starting with 'social-' or in
//                 {'post','mention','tag','twitter-*'}). Schema designed to
//                 also accept future bot-feed entries (source='discord-bot'
//                 or 'twitter-api' — same table, different source field).
//   3. Discord  — admin-manual awards via mutagen_marketing_awards
//                 (activity_type starting with 'discord-').
//
// All 3 dims qualified → 3-of-3 within-Activity mutation. Default
// increments [0.3, 0.5] (one for going 1→2 dims, one for 2→3).
//
// ZeDef noted referrals are "currently not active" — but empirically both
// OUTIS and ZeDef are is_approved=true with accrued USDC pending. The
// program IS live, just not actively promoted. See inventory §4.5 +
// teardown §7.
//
// Social + Discord stub for v1 — admin-manual via mutagen_marketing_awards.
// Per teardown §7.3 lean (b): no automation yet, admin awards via UI form.
// When/if Discord bot or Twitter API integration ships, those feed into
// the SAME table with source='discord-bot' / 'twitter-api'.
// ============================================================================

import { and, eq } from 'drizzle-orm';
import { AdrenaClient } from './adrena-client.js';
import { db } from '../db/index.js';
import { mutagenMarketingAwards } from '../db/schema.js';
import {
    bracketLookupUsd,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
} from './mutagen-scorer-types.js';

const adrenaClient = new AdrenaClient();

/** Categorize an admin-award activity_type into one of our 3 dim buckets. */
function categorizeActivityType(activityType: string): 'social' | 'discord' | 'other' {
    const lower = activityType.toLowerCase();
    if (lower.startsWith('discord-')) return 'discord';
    if (
        lower.startsWith('social-') ||
        lower.startsWith('twitter-') ||
        lower === 'post' ||
        lower === 'mention' ||
        lower === 'tag'
    ) {
        return 'social';
    }
    return 'other';
}

export async function scoreActivity5(ctx: ScorerContext): Promise<ActivityScoreResult> {
    const walletStr = ctx.wallet.toBase58();

    // ---------- 1. Referrer dimension ----------
    let referrerScore = 0;
    let referrerDetail: Record<string, unknown>;

    try {
        const data = await adrenaClient.getReferrerRewards(walletStr);

        if (data.is_approved) {
            // Filter rewards to the epoch window (Gap 3 patch — without this,
            // we'd credit accumulated lifetime rewards every epoch).
            const startMs = ctx.subEpochStart.getTime();
            const endMs = ctx.subEpochEnd.getTime();
            const epochRewards = data.rewards.filter((r) => {
                const t = new Date(r.created_at).getTime();
                return t >= startMs && t < endMs;
            });
            // The /referrer-rewards API returns usdc_amount as a string in some
            // response variants (verified empirically against OUTIS/ZeDef on
            // 2026-05-26 — raw response numbers came back as decimal strings).
            // Coerce via Number() to handle both number and string shapes.
            // NaN-safe: malformed strings sum into NaN which would then poison
            // downstream math, so we filter to finite values before summing.
            const epochUsdcEarned = epochRewards.reduce((s, r) => {
                const n = Number(r.usdc_amount);
                return Number.isFinite(n) ? s + n : s;
            }, 0);

            const usdcBracketPts = bracketLookupUsd(
                ctx.config.activity5.referrerBrackets,
                epochUsdcEarned,
            );
            // Per-referee bonus, capped at refereeCap referees.
            const cappedReferees = Math.min(data.total_referees, ctx.config.activity5.refereeCap);
            const refereeBonus = ctx.config.activity5.perRefereePts * cappedReferees;

            referrerScore = usdcBracketPts + refereeBonus;
            referrerDetail = {
                isApproved: true,
                lifetimeUsdc: data.total_usdc,
                epochUsdcEarned,
                epochRewardCount: epochRewards.length,
                usdcBracketPts,
                totalReferees: data.total_referees,
                cappedReferees,
                refereeBonus,
            };
        } else {
            referrerDetail = {
                isApproved: false,
                note: 'wallet not approved as referrer — score 0',
            };
        }
    } catch (e) {
        // /referrer-rewards 404s for non-referrer wallets; AdrenaClient may
        // surface this as a thrown error. Treat as "no referrer activity".
        referrerDetail = { error: String(e), note: 'referrer lookup failed → score 0' };
    }

    const referrerDim: DimensionScore = {
        dimension: 'referrer',
        raw: referrerScore,
        qualifiedForMutation: referrerScore > 0,
        details: referrerDetail,
    };

    // ---------- 2 & 3. Social + Discord (admin-manual awards) ----------
    const awards = await db
        .select({
            activityType: mutagenMarketingAwards.activityType,
            amount: mutagenMarketingAwards.amount,
            source: mutagenMarketingAwards.source,
        })
        .from(mutagenMarketingAwards)
        .where(
            and(
                eq(mutagenMarketingAwards.wallet, walletStr),
                eq(mutagenMarketingAwards.subEpochId, ctx.subEpochId),
            ),
        );

    let socialScore = 0;
    let discordScore = 0;
    const awardsBySocial: Array<{ activityType: string; source: string; amount: number }> = [];
    const awardsByDiscord: Array<{ activityType: string; source: string; amount: number }> = [];

    for (const a of awards) {
        const amt = parseFloat(a.amount);
        const cat = categorizeActivityType(a.activityType);
        const summary = { activityType: a.activityType, source: a.source, amount: amt };
        if (cat === 'social') {
            socialScore += amt;
            awardsBySocial.push(summary);
        } else if (cat === 'discord') {
            discordScore += amt;
            awardsByDiscord.push(summary);
        }
        // 'other' awards are stored but not credited to either dim.
    }

    const socialDim: DimensionScore = {
        dimension: 'social',
        raw: socialScore,
        qualifiedForMutation: socialScore > 0,
        details: {
            awardCount: awardsBySocial.length,
            awards: awardsBySocial,
        },
    };

    const discordDim: DimensionScore = {
        dimension: 'discord',
        raw: discordScore,
        qualifiedForMutation: discordScore > 0,
        details: {
            awardCount: awardsByDiscord.length,
            awards: awardsByDiscord,
        },
    };

    // ---------- Mutation ----------
    const dims = [referrerDim, socialDim, discordDim];
    const qualifiedCount = dims.filter((d) => d.qualifiedForMutation).length;
    const extraQualified = Math.max(0, qualifiedCount - 1);
    const mutationFactor =
        1 + sumMutationIncrements(ctx.config.activity5.mutationIncrements, extraQualified);

    const baseScore = referrerScore + socialScore + discordScore;
    const finalScore = baseScore * mutationFactor;

    return {
        activity: 5,
        baseScore,
        mutationFactor,
        finalScore,
        qualified: finalScore >= ctx.config.activity5.qualifyingThreshold,
        dimensions: dims,
    };
}

// Re-export for testing
export { categorizeActivityType };
