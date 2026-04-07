// ============================================================================
// Final Score — CPI + Quest Points Join
//
// Combines a trader's bracket CPI score with their accumulated quest points
// from daily categories. Used for:
//   1. Overall tournament ranking (CPI + quests)
//   2. Raffle ticket computation (CPI×0.5 + questPoints×20)
//   3. Top 30% / bottom 70% split for prize distribution
//
// CRITICAL: Quest points are awarded PER-DAY, not by cumulative rank.
// Each day, the top 5 wallets in each category earn quest points:
//   Daily categories (All Around, Bottom Fisher, Top-Tick): 0.2/0.15/0.1/0.05/0.01
//   Multi-day (Risk Manager, Humble One): 0.3/0.25/0.2/0.15/0.10
//   Weekly (Leverage Master): 1.5/1.2/1.0/0.75/0.50
//
// The computation replays each day's scores from daily_category_scores,
// ranks within that day (tie-aware), assigns quest points, and sums.
// ============================================================================

import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    bracketEntries,
    brackets,
    rounds,
    dailyCategoryScores,
} from '../db/schema.js';

// Quest point award tables (rank 1-5, 0-indexed)
const DAILY_QUEST_POINTS = [0.2, 0.15, 0.1, 0.05, 0.01];
const MULTIDAY_QUEST_POINTS = [0.3, 0.25, 0.2, 0.15, 0.10];
const LEVERAGE_QUEST_POINTS = [1.5, 1.2, 1.0, 0.75, 0.50];

// Categories grouped by scoring period
const DAILY_CATEGORIES = ['all_around', 'top_tick_traveler', 'bottom_fisher'];
const MULTIDAY_CATEGORIES = ['risk_manager', 'humble_one'];
const WEEKLY_CATEGORIES = ['leverage_master_long', 'leverage_master_short'];

export interface FinalScoreResult {
    wallet: string;
    cpiScore: number;
    questPoints: number;
    finalScore: number;        // CPI + questPoints
    raffleTickets: number;     // floor(CPI × 0.5) + floor(questPoints × 20)
    closedPositionCount: number; // for ≥10 threshold check
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
// Compute quest points for a wallet by replaying each day's scores
//
// For each day/window/week and each category:
//   1. Query that period's scores from daily_category_scores
//   2. Rank wallets by score (tie-aware, wallet ASC tiebreaker)
//   3. Top 5 earn quest points from the appropriate table
//   4. Sum across all periods
// --------------------------------------------------------------------------
export async function computeQuestPoints(
    tournamentId: number,
    wallet: string,
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
            const dayScores = await db
                .select({
                    wallet: dailyCategoryScores.wallet,
                    score: dailyCategoryScores.score,
                })
                .from(dailyCategoryScores)
                .where(
                    and(
                        eq(dailyCategoryScores.tournamentId, tournamentId),
                        eq(dailyCategoryScores.category, category),
                        eq(dailyCategoryScores.scoreDate, scoreDate),
                    ),
                )
                .orderBy(
                    desc(dailyCategoryScores.score),
                    asc(dailyCategoryScores.wallet),
                );

            // Filter zero/negative scores and sentinel rows
            const valid = dayScores.filter(
                (r) => r.score > 0 && !r.wallet.startsWith('__'),
            );

            if (valid.length === 0) continue;

            const rank = getCompetitionRank(valid, wallet);
            if (rank === -1) continue;

            const pointsTable = DAILY_CATEGORIES.includes(category)
                ? DAILY_QUEST_POINTS
                : MULTIDAY_QUEST_POINTS;

            if (rank < pointsTable.length) {
                totalQuestPoints += pointsTable[rank];
            }
        }
    }

    // --- Weekly Categories (Leverage Master): per stored result ---
    // Leverage Master stores one score per wallet per week (scoreDate = week boundary).
    // Each stored entry represents that week's step count.
    // We rank ALL Leverage Master entries for this tournament by score, grouped by scoreDate.
    for (const category of WEEKLY_CATEGORIES) {
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
            const weekScores = await db
                .select({
                    wallet: dailyCategoryScores.wallet,
                    score: dailyCategoryScores.score,
                })
                .from(dailyCategoryScores)
                .where(
                    and(
                        eq(dailyCategoryScores.tournamentId, tournamentId),
                        eq(dailyCategoryScores.category, category),
                        eq(dailyCategoryScores.scoreDate, scoreDate),
                    ),
                )
                .orderBy(
                    desc(dailyCategoryScores.score),
                    asc(dailyCategoryScores.wallet),
                );

            const valid = weekScores.filter(
                (r) => r.score > 0 && !r.wallet.startsWith('__'),
            );

            if (valid.length === 0) continue;

            const rank = getCompetitionRank(valid, wallet);
            if (rank === -1) continue;

            if (rank < LEVERAGE_QUEST_POINTS.length) {
                totalQuestPoints += LEVERAGE_QUEST_POINTS[rank];
            }
        }
    }

    return totalQuestPoints;
}

// --------------------------------------------------------------------------
// Compute Final Score for all wallets in a tournament
// --------------------------------------------------------------------------
export async function computeFinalScores(
    tournamentId: number,
): Promise<FinalScoreResult[]> {
    // Get all unique wallets that participated (have bracket entries)
    const tournamentRounds = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.tournamentId, tournamentId));

    const walletCPIs = new Map<string, number>();

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
                const existing = walletCPIs.get(entry.wallet) ?? 0;
                if (entry.cpiScore > existing) {
                    walletCPIs.set(entry.wallet, entry.cpiScore);
                }
            }
        }
    }

    const results: FinalScoreResult[] = [];

    for (const [wallet, cpiScore] of walletCPIs) {
        const questPoints = await computeQuestPoints(tournamentId, wallet);
        const finalScore = cpiScore + questPoints;
        const raffleTickets = Math.floor(cpiScore * 0.5) + Math.floor(questPoints * 20);

        results.push({
            wallet,
            cpiScore,
            questPoints,
            finalScore,
            raffleTickets,
            closedPositionCount: 0, // populated by caller via Adrena API
        });
    }

    // Sort by final score descending, wallet ascending (deterministic)
    results.sort((a, b) => b.finalScore - a.finalScore || a.wallet.localeCompare(b.wallet));

    return results;
}
