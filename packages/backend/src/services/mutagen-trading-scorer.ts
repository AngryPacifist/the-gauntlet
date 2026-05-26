// ============================================================================
// Activity 3 scorer — Trading
// ============================================================================
//
// ZeDef R2 Activity 3: weight 30% of total Mutagen. Three dimensions:
//   1. Volume         — sum of trading activity in the epoch window. Admin
//                       picks one of two modes via epoch.config.activity3.mode:
//                       - 'wrap_existing_formula' (default): sum each closed
//                         position's `total_points` (Adrena's existing per-trade
//                         mutagen formula: (Performance + Duration) × Size).
//                         Multiplied by `existingFormulaWeight`. Honors the
//                         live MECHANICS calculator users already see.
//                       - 'volume_brackets': aggregate `position.volume` (USD
//                         notional) per epoch → bracketLookupUsd.
//   2. Forge top-X%   — wallet's percentile rank in the latest Adrena-Forge
//                       rank_only tournament (active or recently completed).
//                       Top 1% / 5% / 10% / 25% tiers per config.
//   3. Asset variety  — distinct symbols traded in epoch with per-symbol
//                       volume ≥ admin threshold. Bucket-keyed by count.
//                       Admin can disable per epoch (varietyEnabled flag).
//
// Within-Activity mutation: count qualified dims (1..3), apply increments
// from config.activity3.mutationIncrements (default [0.3, 0.5, 0.7]).
//
// Data sources:
//   - Positions: Adrena datapi /v4/position via AdrenaClient.getV4Positions
//     (returns ALL positions; we filter to closed-in-epoch-window here).
//   - Forge ranking: local DB join (tournaments → rounds → brackets →
//     bracket_entries) on the latest rank_only tournament.
// ============================================================================

import { and, desc, eq, sql } from 'drizzle-orm';
import { AdrenaClient } from './adrena-client.js';
import { db } from '../db/index.js';
import {
    tournaments,
    rounds,
    brackets,
    bracketEntries,
} from '../db/schema.js';
import {
    bracketLookupCount,
    bracketLookupUsd,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
    type EpochConfig,
} from './mutagen-scorer-types.js';
import type { AdrenaPosition } from '../types.js';

const adrenaClient = new AdrenaClient();

export async function scoreActivity3(ctx: ScorerContext): Promise<ActivityScoreResult> {
    const walletStr = ctx.wallet.toBase58();

    // ---------- Pull all positions, filter to closed-in-epoch-window ----------
    const allPositions = await adrenaClient.getV4Positions(walletStr);
    const epochStartMs = ctx.subEpochStart.getTime();
    const epochEndMs = ctx.subEpochEnd.getTime();

    const epochPositions = allPositions.filter((p) => {
        // Only closed positions contribute to scoring — total_points is only
        // finalized on close (per Adrena's existing mutagen formula). Open
        // positions show points_* = 0 in the datapi response.
        if (!p.exit_date) return false;
        const exitMs = new Date(p.exit_date).getTime();
        return exitMs >= epochStartMs && exitMs < epochEndMs;
    });

    // ---------- 1. Volume dimension ----------
    let volumeScore = 0;
    let volumeDetail: Record<string, unknown>;

    if (ctx.config.activity3.mode === 'wrap_existing_formula') {
        const totalPoints = epochPositions.reduce((s, p) => s + (p.total_points ?? 0), 0);
        volumeScore = totalPoints * ctx.config.activity3.existingFormulaWeight;
        volumeDetail = {
            mode: 'wrap_existing_formula',
            existingFormulaWeight: ctx.config.activity3.existingFormulaWeight,
            sumTotalPoints: totalPoints,
            positionCount: epochPositions.length,
        };
    } else {
        const totalVolume = epochPositions.reduce((s, p) => s + (p.volume ?? 0), 0);
        volumeScore = bracketLookupUsd(ctx.config.activity3.volumeBrackets, totalVolume);
        volumeDetail = {
            mode: 'volume_brackets',
            totalVolumeUsd: totalVolume,
            bracketPts: volumeScore,
            positionCount: epochPositions.length,
        };
    }

    const volumeDim: DimensionScore = {
        dimension: 'volume',
        raw: volumeScore,
        qualifiedForMutation: volumeScore > 0,
        details: volumeDetail,
    };

    // ---------- 2. Forge top-X% dimension ----------
    const forgeRanking = await computeForgeTopPctScore(walletStr, ctx.config.activity3);

    const forgeDim: DimensionScore = {
        dimension: 'forge_top_pct',
        raw: forgeRanking.pts,
        qualifiedForMutation: forgeRanking.pts > 0,
        details: { ...forgeRanking },
    };

    // ---------- 3. Asset variety dimension (admin-toggleable) ----------
    let varietyScore = 0;
    let varietyDetail: Record<string, unknown>;

    if (ctx.config.activity3.varietyEnabled) {
        const perSymbolVolume = new Map<string, number>();
        for (const p of epochPositions) {
            perSymbolVolume.set(
                p.symbol,
                (perSymbolVolume.get(p.symbol) ?? 0) + (p.volume ?? 0),
            );
        }
        const qualifyingSymbols = Array.from(perSymbolVolume.entries())
            .filter(([, vol]) => vol >= ctx.config.activity3.varietyMinVolumePerAsset);
        varietyScore = bracketLookupCount(
            ctx.config.activity3.varietyBrackets,
            qualifyingSymbols.length,
        );
        varietyDetail = {
            enabled: true,
            minVolumePerAsset: ctx.config.activity3.varietyMinVolumePerAsset,
            perSymbolVolume: Object.fromEntries(perSymbolVolume),
            qualifyingSymbolCount: qualifyingSymbols.length,
            qualifyingSymbols: qualifyingSymbols.map(([s]) => s),
            bracketPts: varietyScore,
        };
    } else {
        varietyDetail = { enabled: false };
    }

    const varietyDim: DimensionScore = {
        dimension: 'variety',
        raw: varietyScore,
        // Disabled variety doesn't qualify (it's not earning anything this epoch).
        qualifiedForMutation: ctx.config.activity3.varietyEnabled && varietyScore > 0,
        details: varietyDetail,
    };

    // ---------- Mutation ----------
    const dims = [volumeDim, forgeDim, varietyDim];
    const qualifiedCount = dims.filter((d) => d.qualifiedForMutation).length;
    const extraQualified = Math.max(0, qualifiedCount - 1);
    const mutationFactor =
        1 + sumMutationIncrements(ctx.config.activity3.mutationIncrements, extraQualified);

    const baseScore = volumeScore + forgeRanking.pts + varietyScore;
    const finalScore = baseScore * mutationFactor;

    return {
        activity: 3,
        baseScore,
        mutationFactor,
        finalScore,
        qualified: finalScore >= ctx.config.activity3.qualifyingThreshold,
        dimensions: dims,
    };
}

// ---------- Forge top-pct helper ----------

interface ForgeRanking {
    tournamentId: number | null;
    tournamentName: string | null;
    totalEntries: number;
    walletRank: number | null;      // 1-indexed rank within the Forge (null = not in Forge)
    percentile: number | null;      // walletRank / totalEntries
    matchedTier: { maxPct: number; pts: number } | null;
    pts: number;
}

/**
 * Finds the wallet's percentile rank in the latest rank_only Forge
 * tournament (active first, else most recently completed) and looks it up
 * in the topPctTiers ladder.
 *
 * Returns pts=0 when:
 *   - No rank_only tournament exists yet
 *   - The tournament has no bracket entries
 *   - The wallet isn't in the Forge
 *   - The wallet's percentile falls outside every tier
 *
 * Type signature uses Pick to avoid coupling this helper to the full
 * activity3 config shape — it only needs topPctTiers.
 */
async function computeForgeTopPctScore(
    wallet: string,
    config: EpochConfig['activity3'],
): Promise<ForgeRanking> {
    const emptyReturn: ForgeRanking = {
        tournamentId: null,
        tournamentName: null,
        totalEntries: 0,
        walletRank: null,
        percentile: null,
        matchedTier: null,
        pts: 0,
    };

    // 1. Find the latest rank_only tournament: active > completed > none
    const isRankOnly = sql`${tournaments.config}->>'format' = 'rank_only'`;
    const activeForge = await db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .where(and(eq(tournaments.status, 'active'), isRankOnly))
        .orderBy(desc(tournaments.id))
        .limit(1);

    let forgeRow = activeForge[0];
    if (!forgeRow) {
        const completedForge = await db
            .select({ id: tournaments.id, name: tournaments.name })
            .from(tournaments)
            .where(and(eq(tournaments.status, 'completed'), isRankOnly))
            .orderBy(desc(tournaments.id))
            .limit(1);
        forgeRow = completedForge[0];
    }
    if (!forgeRow) return emptyReturn;

    // 2. Pull bracket entries for this tournament, sorted by CPI descending.
    //    For rank_only tournaments there's typically a single "round" + bracket
    //    holding every entrant; the join still works for multi-bracket cases.
    const entries = await db
        .select({
            wallet: bracketEntries.wallet,
            cpi: bracketEntries.cpiScore,
        })
        .from(bracketEntries)
        .innerJoin(brackets, eq(brackets.id, bracketEntries.bracketId))
        .innerJoin(rounds, eq(rounds.id, brackets.roundId))
        .where(eq(rounds.tournamentId, forgeRow.id))
        .orderBy(desc(bracketEntries.cpiScore));

    if (entries.length === 0) {
        return { ...emptyReturn, tournamentId: forgeRow.id, tournamentName: forgeRow.name };
    }

    // 3. Find the wallet's index. -1 means not in the Forge.
    const idx = entries.findIndex((e) => e.wallet === wallet);
    if (idx === -1) {
        return {
            ...emptyReturn,
            tournamentId: forgeRow.id,
            tournamentName: forgeRow.name,
            totalEntries: entries.length,
        };
    }

    const walletRank = idx + 1;
    const percentile = walletRank / entries.length;

    // 4. Match percentile against tier ladder (sorted by maxPct ascending so
    //    the most-elite tier wins first).
    const sortedTiers = [...config.topPctTiers].sort((a, b) => a.maxPct - b.maxPct);
    let matchedTier: { maxPct: number; pts: number } | null = null;
    for (const tier of sortedTiers) {
        if (percentile <= tier.maxPct) {
            matchedTier = tier;
            break;
        }
    }

    return {
        tournamentId: forgeRow.id,
        tournamentName: forgeRow.name,
        totalEntries: entries.length,
        walletRank,
        percentile,
        matchedTier,
        pts: matchedTier?.pts ?? 0,
    };
}

// Re-export for testing — verifier can exercise the Forge query in isolation.
export { computeForgeTopPctScore };

// Strict-import safety: AdrenaPosition is the underlying shape getV4Positions returns.
// Kept as a type re-export so consumers don't need to dig into types.ts.
export type { AdrenaPosition };
