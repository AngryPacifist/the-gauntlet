// ============================================================================
// Final Score: CPI + Quest Points Join
//
// Combines a trader's bracket CPI score with their accumulated quest points
// from daily categories. Used for:
//   1. Overall tournament ranking (CPI + quests)
//   2. Raffle ticket computation (floor(CPI × cpiTicketMultiplier) + floor(questPoints × questTicketMultiplier))
//   3. Top-% / remainder split for prize distribution (config.topPercentCutoff)
//
// CRITICAL: Quest points are awarded PER-DAY, not by cumulative rank.
// Each day, the top N wallets in each category earn quest points:
//   Daily categories (All Around, Bottom Fisher, Top-Tick): config.dailyQuestPoints
//     (default [0.2, 0.15, 0.1, 0.05, 0.01])
//   Multi-day (Risk Manager, Humble One): config.multidayQuestPoints
//     (default [0.3, 0.25, 0.2, 0.15, 0.1])
//   Weekly (Leverage Master): LEVERAGE_QUEST_POINTS module constant
//     [0.5, 0.4, 0.3, 0.2, 0.1] per (asset, side) ladder.
//
// The computation replays each day's scores from daily_category_scores,
// ranks within that day (tie-aware), assigns quest points, and sums.
// ============================================================================

import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    bracketEntries,
    brackets,
    rounds,
    dailyCategoryScores,
} from '../db/schema.js';
import type { TournamentConfig } from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../types.js';
import { createCache } from './cache.js';

// Quest point award tables:
// - DAILY + MULTIDAY are config-driven via TournamentConfig
//   (config.dailyQuestPoints / config.multidayQuestPoints).
// - LEVERAGE is the module constant below.
// Per-asset LM scaling: [0.5, 0.4, 0.3, 0.2, 0.1] per (asset, side) ladder
// with 2N ladders total (long + short × N assets). Ceiling math: for N=3
// assets, 2N × 0.5 peak = 3.0.
const LEVERAGE_QUEST_POINTS = [0.5, 0.4, 0.3, 0.2, 0.1];

// TTL cache for the heaviest computation in the system.
// Cache key = tournamentId. Config is frozen post-registration (the PUT
// /:id route rejects edits after activation), so per-tournament keying is
// correct without including a config hash in the key.
const finalScoreCache = createCache<FinalScoreResult[]>();

// Categories grouped by scoring period
const DAILY_CATEGORIES = ['all_around', 'top_tick_traveler', 'bottom_fisher'];
const MULTIDAY_CATEGORIES = ['risk_manager', 'humble_one'];

// WEEKLY_CATEGORIES is runtime-computed from config.assetList.
// Per-asset slugs: leverage_master_${symbol}_${side}.
// Legacy fallback when assetList is undefined/empty: the static 2-slug list
// matches older data in `dailyCategoryScores`.
function computeWeeklyCategories(config: TournamentConfig): string[] {
    if (!config.assetList?.length) {
        return ['leverage_master_long', 'leverage_master_short'];
    }
    const slugs: string[] = [];
    for (const asset of config.assetList) {
        slugs.push(`leverage_master_${asset.symbol}_long`);
        slugs.push(`leverage_master_${asset.symbol}_short`);
    }
    return slugs;
}

export interface FinalScoreResult {
    wallet: string;
    cpiScore: number;
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    questPoints: number;
    finalScore: number;        // CPI + questPoints
    raffleTickets: number;     // floor(CPI × cpiTicketMultiplier) + floor(questPoints × questTicketMultiplier)
    closedPositionCount: number; // gates raffle eligibility per config.raffleMinClosedPositions
}

// --------------------------------------------------------------------------
// Helper: compute competition rank for a wallet in a sorted score list
// Tie-aware: tied wallets share the highest rank, next rank skips.
// Returns 0-indexed competition rank, or -1 if wallet not found.
// --------------------------------------------------------------------------
function getCompetitionRank(
    sortedScores: Array<{ wallet: string; score: number }>,
    targetWallet: string,
): number {
    let competitionRank = 0;
    for (let i = 0; i < sortedScores.length; i++) {
        if (i > 0 && sortedScores[i].score !== sortedScores[i - 1].score) {
            competitionRank = i;
        }
        if (sortedScores[i].wallet === targetWallet) {
            return competitionRank;
        }
    }
    return -1; // wallet not in list
}

// --------------------------------------------------------------------------
// Helper: extract category-specific ROI for tiebreaker sorting
// Uses the details JSONB column from daily_category_scores.
// Falls back to 0 when no ROI is available (e.g. Leverage Master).
// --------------------------------------------------------------------------
function extractTiebreakerRoi(category: string, details: Record<string, unknown> | null): number {
    if (!details) return 0;
    try {
        switch (category) {
            case 'all_around': {
                const scores = details.assetScores as Array<{ bestROI: number }> | undefined;
                if (!scores || scores.length === 0) return 0;
                return Math.max(...scores.map((s) => s.bestROI));
            }
            case 'bottom_fisher': {
                const entry = details.longEntry as { roi: number } | null;
                return entry?.roi ?? 0;
            }
            case 'top_tick_traveler': {
                const entry = details.shortEntry as { roi: number } | null;
                return entry?.roi ?? 0;
            }
            case 'risk_manager':
            case 'humble_one': {
                const trade = details.bestTrade as { roi: number } | null;
                return trade?.roi ?? 0;
            }
            default:
                // Leverage Master — no ROI concept
                return 0;
        }
    } catch {
        return 0;
    }
}

// --------------------------------------------------------------------------
// Compute quest points for a wallet by replaying each day's scores
//
// For each day/window/week and each category:
//   1. Query that period's scores from daily_category_scores
//   2. Rank wallets by score (tie-aware, ROI DESC, wallet ASC tiebreaker)
//   3. Top 5 earn quest points from the appropriate table
//   4. Sum across all periods
// --------------------------------------------------------------------------
export async function computeQuestPoints(
    tournamentId: number,
    wallet: string,
    config: TournamentConfig,
): Promise<number> {
    let totalQuestPoints = 0;

    // Get all unique score dates for this tournament
    const dates = await db
        .selectDistinct({ scoreDate: dailyCategoryScores.scoreDate })
        .from(dailyCategoryScores)
        .where(eq(dailyCategoryScores.tournamentId, tournamentId))
        .orderBy(asc(dailyCategoryScores.scoreDate));

    // --- Daily + Multi-Day Categories: replay each date ---
    for (const { scoreDate } of dates) {
        const allPerDayCategories = [...DAILY_CATEGORIES, ...MULTIDAY_CATEGORIES];

        for (const category of allPerDayCategories) {
            const dayScoresRaw = await db
                .select()
                .from(dailyCategoryScores)
                .where(
                    and(
                        eq(dailyCategoryScores.tournamentId, tournamentId),
                        eq(dailyCategoryScores.category, category),
                        eq(dailyCategoryScores.scoreDate, scoreDate),
                    ),
                );

            // Filter sentinels, sort by score DESC → ROI DESC → wallet ASC
            const validRows = dayScoresRaw.filter(
                (r) => !r.wallet.startsWith('__'),
            );
            validRows.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const roiA = extractTiebreakerRoi(category, a.details as Record<string, unknown> | null);
                const roiB = extractTiebreakerRoi(category, b.details as Record<string, unknown> | null);
                if (roiB !== roiA) return roiB - roiA;
                return a.wallet.localeCompare(b.wallet);
            });
            const valid = validRows.map((r) => ({ wallet: r.wallet, score: r.score }));

            if (valid.length === 0) continue;

            const rank = getCompetitionRank(valid, wallet);
            if (rank === -1) continue;

            const dailyPoints = config.dailyQuestPoints ?? DEFAULT_TOURNAMENT_CONFIG.dailyQuestPoints;
            const multidayPoints = config.multidayQuestPoints ?? DEFAULT_TOURNAMENT_CONFIG.multidayQuestPoints;
            const pointsTable = DAILY_CATEGORIES.includes(category)
                ? dailyPoints
                : multidayPoints;

            // Score > 0 guard (mirror of computeAllQuestPoints).
            const walletScore = valid.find((v) => v.wallet === wallet)?.score ?? 0;
            if (rank < pointsTable.length && walletScore > 0) {
                totalQuestPoints += pointsTable[rank];
            }
        }
    }

    // --- Weekly Categories (Leverage Master): per stored result ---
    // Leverage Master stores one score per wallet per week (scoreDate = week boundary).
    // Each stored entry represents that week's step count.
    // We rank ALL Leverage Master entries for this tournament by score, grouped by scoreDate.
    // WEEKLY_CATEGORIES is config-driven (per-asset slugs).
    const weeklyCategories = computeWeeklyCategories(config);
    for (const category of weeklyCategories) {
        const weekDates = await db
            .selectDistinct({ scoreDate: dailyCategoryScores.scoreDate })
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, category),
                ),
            )
            .orderBy(asc(dailyCategoryScores.scoreDate));

        for (const { scoreDate } of weekDates) {
            const weekScoresRaw = await db
                .select()
                .from(dailyCategoryScores)
                .where(
                    and(
                        eq(dailyCategoryScores.tournamentId, tournamentId),
                        eq(dailyCategoryScores.category, category),
                        eq(dailyCategoryScores.scoreDate, scoreDate),
                    ),
                );

            // Filter sentinels, sort by score DESC → ROI DESC → wallet ASC
            const validRows = weekScoresRaw.filter(
                (r) => !r.wallet.startsWith('__'),
            );
            validRows.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const roiA = extractTiebreakerRoi(category, a.details as Record<string, unknown> | null);
                const roiB = extractTiebreakerRoi(category, b.details as Record<string, unknown> | null);
                if (roiB !== roiA) return roiB - roiA;
                return a.wallet.localeCompare(b.wallet);
            });
            const valid = validRows.map((r) => ({ wallet: r.wallet, score: r.score }));

            if (valid.length === 0) continue;

            const rank = getCompetitionRank(valid, wallet);
            if (rank === -1) continue;

            // Score > 0 guard. For LM, score = stepCount; zero = no leverage
            // steps completed, same baseline-inflation issue as daily categories.
            const walletScore = valid.find((v) => v.wallet === wallet)?.score ?? 0;
            if (rank < LEVERAGE_QUEST_POINTS.length && walletScore > 0) {
                totalQuestPoints += LEVERAGE_QUEST_POINTS[rank];
            }
        }
    }

    return totalQuestPoints;
}

// --------------------------------------------------------------------------
// Batch Compute Quest Points — ALL wallets in ONE query
//
// Fetches every daily_category_scores row for the tournament in a single
// query, then groups, ranks, and awards quest points entirely in-memory.
// Returns Map<wallet, questPoints>.
//
// This replaces the per-wallet approach when computing final scores,
// reducing ~3000 queries to 1 for a 30-wallet × 14-day tournament.
// --------------------------------------------------------------------------
export async function computeAllQuestPoints(
    tournamentId: number,
    config: TournamentConfig,
): Promise<Map<string, number>> {
    // Single query: fetch all scores for this tournament
    const allScores = await db
        .select()
        .from(dailyCategoryScores)
        .where(eq(dailyCategoryScores.tournamentId, tournamentId));

    // Group by (category, scoreDate) for ranking
    const groups = new Map<string, typeof allScores>();
    for (const row of allScores) {
        // Skip sentinel rows
        if (row.wallet.startsWith('__')) continue;
        const key = `${row.category}::${row.scoreDate}`;
        let group = groups.get(key);
        if (!group) {
            group = [];
            groups.set(key, group);
        }
        group.push(row);
    }

    // Accumulate quest points per wallet
    const walletPoints = new Map<string, number>();

    for (const [key, rows] of groups) {
        const category = key.split('::')[0];

        // Sort: score DESC → ROI DESC → wallet ASC (deterministic)
        rows.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const roiA = extractTiebreakerRoi(category, a.details as Record<string, unknown> | null);
            const roiB = extractTiebreakerRoi(category, b.details as Record<string, unknown> | null);
            if (roiB !== roiA) return roiB - roiA;
            return a.wallet.localeCompare(b.wallet);
        });

        // Determine which points table to use
        const dailyPoints = config.dailyQuestPoints ?? DEFAULT_TOURNAMENT_CONFIG.dailyQuestPoints;
        const multidayPoints = config.multidayQuestPoints ?? DEFAULT_TOURNAMENT_CONFIG.multidayQuestPoints;
        let pointsTable: number[];
        if (DAILY_CATEGORIES.includes(category)) {
            pointsTable = dailyPoints;
        } else if (MULTIDAY_CATEGORIES.includes(category)) {
            pointsTable = multidayPoints;
        } else if (category.startsWith('leverage_master_')) {
            // Any per-asset LM slug uses LEVERAGE_QUEST_POINTS table.
            pointsTable = LEVERAGE_QUEST_POINTS;
        } else {
            continue;
        }

        // Assign quest points using tie-aware competition ranking.
        // Score > 0 guard. Without it, wallets tied at score=0 (no actual
        // participation in the category) all share the top-1 rank-points slot,
        // producing a baseline 0.60 quest points for every registered wallet
        // (3 daily categories × 0.2).
        let competitionRank = 0;
        for (let i = 0; i < rows.length; i++) {
            if (i > 0 && rows[i].score !== rows[i - 1].score) {
                competitionRank = i;
            }
            if (competitionRank < pointsTable.length && rows[i].score > 0) {
                const current = walletPoints.get(rows[i].wallet) ?? 0;
                walletPoints.set(rows[i].wallet, current + pointsTable[competitionRank]);
            }
        }
    }

    return walletPoints;
}

// --------------------------------------------------------------------------
// Compute Final Score for all wallets in a tournament
//
// Uses batch quest point computation (1 DB query) instead of per-wallet
// queries (~3000 queries). Critical for remote DB connections.
// --------------------------------------------------------------------------
export async function computeFinalScores(
    tournamentId: number,
    config: TournamentConfig,
): Promise<FinalScoreResult[]> {
    // TTL cache check (5-min default). Returns cached payload if fresh.
    const cacheKey = `final-score:${tournamentId}`;
    const cached = finalScoreCache.get(cacheKey);
    if (cached) return cached;

    // Get all unique wallets that participated (have bracket entries)
    const tournamentRounds = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.tournamentId, tournamentId));

    const walletCPIs = new Map<string, {
        cpiScore: number;
        pnlScore: number;
        riskScore: number;
        consistencyScore: number;
        activityScore: number;
    }>();

    for (const round of tournamentRounds) {
        const roundBrackets = await db
            .select({ id: brackets.id })
            .from(brackets)
            .where(eq(brackets.roundId, round.id));

        for (const bracket of roundBrackets) {
            const entries = await db
                .select()
                .from(bracketEntries)
                .where(eq(bracketEntries.bracketId, bracket.id));

            for (const entry of entries) {
                const existing = walletCPIs.get(entry.wallet);
                if (!existing || entry.cpiScore > existing.cpiScore) {
                    walletCPIs.set(entry.wallet, {
                        cpiScore: entry.cpiScore,
                        pnlScore: entry.pnlScore,
                        riskScore: entry.riskScore,
                        consistencyScore: entry.consistencyScore,
                        activityScore: entry.activityScore,
                    });
                }
            }
        }
    }

    // Batch quest point computation — 1 query for all wallets
    const questPointsMap = await computeAllQuestPoints(tournamentId, config);

    // Read ticket multipliers from config (was previously hardcoded 0.5 and 20).
    const cpiMult = config.cpiTicketMultiplier ?? DEFAULT_TOURNAMENT_CONFIG.cpiTicketMultiplier;
    const questMult = config.questTicketMultiplier ?? DEFAULT_TOURNAMENT_CONFIG.questTicketMultiplier;

    const results: FinalScoreResult[] = [];

    for (const [wallet, scores] of walletCPIs) {
        const questPoints = questPointsMap.get(wallet) ?? 0;
        const finalScore = scores.cpiScore + questPoints;
        const raffleTickets = Math.floor(scores.cpiScore * cpiMult) + Math.floor(questPoints * questMult);

        results.push({
            wallet,
            cpiScore: scores.cpiScore,
            pnlScore: scores.pnlScore,
            riskScore: scores.riskScore,
            consistencyScore: scores.consistencyScore,
            activityScore: scores.activityScore,
            questPoints,
            finalScore,
            raffleTickets,
            closedPositionCount: 0, // populated by caller via Adrena API
        });
    }

    // Sort by final score descending, wallet ascending (deterministic)
    results.sort((a, b) => b.finalScore - a.finalScore || a.wallet.localeCompare(b.wallet));

    // Write-through cache.
    finalScoreCache.set(cacheKey, results);
    return results;
}
