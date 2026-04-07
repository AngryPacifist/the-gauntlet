// ============================================================================
// Quest Engine — Leverage Master Quest System
//
// Tracks progressive completion of leverage tiers (10x–100x) for each wallet.
// Two independent quests per wallet: long side and short side.
// Each quest resets weekly (7-day windows aligned to tournament start).
//
// Integration:
//   scheduler.ts calls evaluateLeverageProgress() daily for each wallet.
//   At week boundaries, computeLeverageMasterLeaderboard() writes scores
//   to daily_category_scores as 'leverage_master_long' / 'leverage_master_short'.
//   final-score.ts then picks these up in the weekly category loop.
//
// Determinism guarantees:
//   - Step completion: boolean[10] output is order-independent (no position ordering dependency)
//   - Leaderboard: ORDER BY step_count DESC, wallet ASC (fully deterministic)
//   - Steps are permanent per week: once earned, never removed
//
// Anti-gaming filters:
//   - Minimum collateral: $25 (entry_collateral_amount ?? collateral_amount)
//   - Minimum duration: 120 seconds (open positions check time since entry)
//   - entry_leverage is immutable (set at open) — opening is the accomplishment
// ============================================================================

import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { questProgress } from '../db/schema.js';
import { saveDailyCategoryScores } from './category-engine.js';
import type { AdrenaPosition, LeverageStep, QuestProgressDetails, CategoryScoreRow } from '../types.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const MIN_POSITION_COLLATERAL = 25;   // USD
const MIN_TRADE_DURATION_SEC = 120;   // seconds

/**
 * Leverage step windows: ±2x tolerance per step.
 * Step 100 is capped at protocol max (100x).
 * No overlap between consecutive steps (gap = 6x between windows).
 */
export const LEVERAGE_STEPS: LeverageStep[] = [
    { step: 10,  min: 8,   max: 12  },
    { step: 20,  min: 18,  max: 22  },
    { step: 30,  min: 28,  max: 32  },
    { step: 40,  min: 38,  max: 42  },
    { step: 50,  min: 48,  max: 52  },
    { step: 60,  min: 58,  max: 62  },
    { step: 70,  min: 68,  max: 72  },
    { step: 80,  min: 78,  max: 82  },
    { step: 90,  min: 88,  max: 92  },
    { step: 100, min: 98,  max: 100 },  // capped at Adrena protocol max
];

const SIDES = ['long', 'short'] as const;

// --------------------------------------------------------------------------
// Position Validation
//
// Checks if a single position qualifies for a specific leverage step.
// Validates: side match, collateral, duration, leverage window.
// --------------------------------------------------------------------------

function positionCompletesStep(
    position: AdrenaPosition,
    step: LeverageStep,
    side: 'long' | 'short',
): boolean {
    // 1. Direction check
    if (position.side !== side) return false;

    // 2. Anti-dust: minimum collateral
    // Uses entry_collateral_amount (immutable) with fallback to collateral_amount
    // Matches pattern in adrena-client.ts:137
    const collateral = position.entry_collateral_amount ?? position.collateral_amount;
    if (collateral < MIN_POSITION_COLLATERAL) return false;

    // 3. Anti-wash: minimum duration (120s)
    // Open positions: check elapsed time since entry
    // Closed positions: use precomputed duration or compute from timestamps
    if (position.status === 'open') {
        const elapsedSec = (Date.now() - new Date(position.entry_date).getTime()) / 1000;
        if (elapsedSec < MIN_TRADE_DURATION_SEC) return false;
    } else {
        // Closed position — use precomputed duration if available
        if (position.duration != null && position.duration > 0) {
            if (position.duration < MIN_TRADE_DURATION_SEC) return false;
        } else if (position.exit_date && position.entry_date) {
            // Fallback: compute from timestamps
            const durationMs = new Date(position.exit_date).getTime() -
                new Date(position.entry_date).getTime();
            if (durationMs / 1000 < MIN_TRADE_DURATION_SEC) return false;
        }
        // If no duration info available (shouldn't happen), let it pass
    }

    // 4. Leverage window check (entry_leverage is immutable — set at open)
    const lev = position.entry_leverage;
    return lev >= step.min && lev <= step.max;
}

// --------------------------------------------------------------------------
// Evaluate Leverage Progress
//
// For a single wallet: checks all positions against all 10 steps for both
// long and short sides. Merges with existing progress (steps are permanent
// per week — once earned, never removed).
//
// Called daily by the scheduler for each registered wallet.
// --------------------------------------------------------------------------

export async function evaluateLeverageProgress(
    tournamentId: number,
    wallet: string,
    positions: AdrenaPosition[],
    weekNumber: number,
    weekStart: string,  // YYYY-MM-DD
    weekEnd: string,    // YYYY-MM-DD
): Promise<QuestProgressDetails> {
    // Filter positions to those opened within this quest week
    const weekPositions = positions.filter((p) => {
        const entryDate = p.entry_date.slice(0, 10); // YYYY-MM-DD
        return entryDate >= weekStart && entryDate <= weekEnd;
    });

    const result: QuestProgressDetails = {
        long: Array(10).fill(false) as boolean[],
        short: Array(10).fill(false) as boolean[],
        longCount: 0,
        shortCount: 0,
        weekNumber,
    };

    for (const side of SIDES) {
        // Read existing progress for this (tournament, wallet, side, week)
        const [existing] = await db
            .select()
            .from(questProgress)
            .where(and(
                eq(questProgress.tournamentId, tournamentId),
                eq(questProgress.wallet, wallet),
                eq(questProgress.questType, 'leverage_master'),
                eq(questProgress.side, side),
                eq(questProgress.weekNumber, weekNumber),
            ))
            .limit(1);

        // Start with existing steps (permanent — never remove completed steps)
        const currentSteps: boolean[] = existing
            ? (existing.stepsCompleted as boolean[])
            : Array(10).fill(false);

        // Check each position against each step
        for (const position of weekPositions) {
            for (let i = 0; i < LEVERAGE_STEPS.length; i++) {
                if (!currentSteps[i] && positionCompletesStep(position, LEVERAGE_STEPS[i], side)) {
                    currentSteps[i] = true;
                }
            }
        }

        const stepCount = currentSteps.filter(Boolean).length;

        // Persist: update if exists, insert if new
        if (existing) {
            await db.update(questProgress)
                .set({
                    stepsCompleted: currentSteps,
                    stepCount,
                    updatedAt: new Date(),
                })
                .where(eq(questProgress.id, existing.id));
        } else {
            await db.insert(questProgress)
                .values({
                    tournamentId,
                    wallet,
                    questType: 'leverage_master',
                    side,
                    stepsCompleted: currentSteps,
                    stepCount,
                    weekNumber,
                });
        }

        // Populate result
        result[side] = currentSteps;
        if (side === 'long') {
            result.longCount = stepCount;
        } else {
            result.shortCount = stepCount;
        }
    }

    return result;
}

// --------------------------------------------------------------------------
// Compute Leverage Master Leaderboard
//
// Runs at week boundary (last day of quest week). Reads all quest_progress
// for the given week, ranks by stepCount, and saves to daily_category_scores
// as separate categories: 'leverage_master_long' and 'leverage_master_short'.
//
// Deterministic ordering: stepCount DESC, wallet ASC.
// --------------------------------------------------------------------------

export async function computeLeverageMasterLeaderboard(
    tournamentId: number,
    weekNumber: number,
    scoreDate: string,  // YYYY-MM-DD — the week boundary date
    seasonId: number | null = null,
): Promise<void> {
    for (const side of SIDES) {
        const category = `leverage_master_${side}`;

        // Get all progress rows for this (tournament, side, week)
        const progressRows = await db
            .select({
                wallet: questProgress.wallet,
                stepCount: questProgress.stepCount,
            })
            .from(questProgress)
            .where(and(
                eq(questProgress.tournamentId, tournamentId),
                eq(questProgress.questType, 'leverage_master'),
                eq(questProgress.side, side),
                eq(questProgress.weekNumber, weekNumber),
            ))
            .orderBy(desc(questProgress.stepCount), asc(questProgress.wallet));

        // Build score rows for saveDailyCategoryScores
        const rows: CategoryScoreRow[] = progressRows
            .filter((r) => r.stepCount > 0)
            .map((r) => ({
                wallet: r.wallet,
                category,
                score: r.stepCount,
                details: { weekNumber, side, stepCount: r.stepCount },
            }));

        if (rows.length > 0) {
            await saveDailyCategoryScores(tournamentId, seasonId, scoreDate, rows);
            console.log(
                `[QuestEngine] Saved ${rows.length} ${category} leaderboard entries ` +
                `for tournament ${tournamentId}, week ${weekNumber}`,
            );
        }
    }
}

// --------------------------------------------------------------------------
// Get Quest Progress (read-only)
//
// Returns the badge grid data for a wallet's progress in a specific week.
// If weekNumber is not provided, returns the latest week's progress.
// --------------------------------------------------------------------------

export async function getQuestProgress(
    tournamentId: number,
    wallet: string,
    weekNumber?: number,
): Promise<QuestProgressDetails | null> {
    const result: QuestProgressDetails = {
        long: Array(10).fill(false) as boolean[],
        short: Array(10).fill(false) as boolean[],
        longCount: 0,
        shortCount: 0,
        weekNumber: weekNumber ?? 0,
    };

    let found = false;

    for (const side of SIDES) {
        const conditions = [
            eq(questProgress.tournamentId, tournamentId),
            eq(questProgress.wallet, wallet),
            eq(questProgress.questType, 'leverage_master'),
            eq(questProgress.side, side),
        ];

        if (weekNumber !== undefined) {
            conditions.push(eq(questProgress.weekNumber, weekNumber));
        }

        const rows = await db
            .select()
            .from(questProgress)
            .where(and(...conditions))
            .orderBy(desc(questProgress.weekNumber))
            .limit(1);

        if (rows.length > 0) {
            found = true;
            const row = rows[0];
            result[side] = row.stepsCompleted as boolean[];
            result.weekNumber = row.weekNumber;
            if (side === 'long') {
                result.longCount = row.stepCount;
            } else {
                result.shortCount = row.stepCount;
            }
        }
    }

    return found ? result : null;
}
