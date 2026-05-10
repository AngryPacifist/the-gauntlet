// ============================================================================
// Quest Engine — Leverage Master Quest System
//
// Tracks progressive completion of leverage tiers (10x–100x) per (asset, side).
// Phase 4 item 30: ladders are per-asset. Each (wallet, asset, side) has its
// own independent 10-step progression per week.
//
// Integration:
//   scheduler.ts calls evaluateLeverageProgress() daily for each wallet.
//   At week boundaries, computeLeverageMasterLeaderboard() writes scores
//   to daily_category_scores as 'leverage_master_${symbol}_long' / '_short'
//   when config.assetList is populated, falling back to the legacy 2-slug
//   shape ('leverage_master_long' / '_short') for pre-Phase-4 tournaments.
//   final-score.ts then picks these up in the weekly category loop.
//
// Determinism guarantees:
//   - Step completion: boolean[10] output is order-independent (no position ordering dependency)
//   - Leaderboard: ORDER BY step_count DESC, wallet ASC (fully deterministic)
//   - Steps are permanent per week: once earned, never removed
//
// Anti-gaming filters (config-driven per Phase 3 item 14):
//   - config.minPositionCollateral (entry_collateral_amount ?? collateral_amount)
//   - config.minTradeDurationSec (open positions check time since entry)
//   - entry_leverage is immutable (set at open) — opening is the accomplishment
// ============================================================================

import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { questProgress } from '../db/schema.js';
import { saveDailyCategoryScores } from './category-engine.js';
import type { AdrenaPosition, LeverageStep, QuestProgressDetails, CategoryScoreRow, TournamentConfig } from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../types.js';

// --------------------------------------------------------------------------
// Constants: migrated to TournamentConfig (Phase 3 item 14, 2026-04-22).
// MIN_POSITION_COLLATERAL + MIN_TRADE_DURATION_SEC are now config-driven via
// `config.minPositionCollateral` + `config.minTradeDurationSec` (same names as
// already-existing TournamentConfig fields). LEVERAGE_STEPS stays as a module
// constant (D1 — game design, no admin use case).
// --------------------------------------------------------------------------

/**
 * Leverage step windows: ±2x tolerance per step uniformly.
 * No overlap between consecutive steps (gap = 6x between windows).
 *
 * Round 2: step 100 max relaxed from 100 → 102 to match the ±2 tolerance
 * applied to every other rung. Adrena's protocol max is 100x but reported
 * `entry_leverage` drifts slightly above 100x due to fee/calculation
 * precision after entry; trader intent at 100x should not be rejected
 * for sub-2x precision noise.
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
    { step: 100, min: 98,  max: 102 },  // ±2 tolerance like every other rung
];

// Phase 7.a: build LeverageStep[] from per-asset values + tolerance.
// Used when assetList entry has lmSteps configured. Tolerance default = 2 (D24).
export function buildLeverageSteps(stepValues: number[], tolerance: number = 2): LeverageStep[] {
    return stepValues.map(step => ({
        step,
        min: step - tolerance,
        max: step + tolerance,
    }));
}

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
    config: TournamentConfig,
): boolean {
    // 1. Direction check
    if (position.side !== side) return false;

    // Phase 3 item 14: read anti-gaming filters from config
    const minCollateral = config.minPositionCollateral ?? DEFAULT_TOURNAMENT_CONFIG.minPositionCollateral;
    const minDurationSec = config.minTradeDurationSec ?? DEFAULT_TOURNAMENT_CONFIG.minTradeDurationSec;

    // 2. Anti-dust: minimum collateral
    // Uses entry_collateral_amount (immutable) with fallback to collateral_amount
    // Matches pattern in adrena-client.ts:137
    const collateral = position.entry_collateral_amount ?? position.collateral_amount;
    if (collateral < minCollateral) return false;

    // 3. Anti-wash: minimum duration
    // Open positions: check elapsed time since entry
    // Closed positions: use precomputed duration or compute from timestamps
    if (position.status === 'open') {
        const elapsedSec = (Date.now() - new Date(position.entry_date).getTime()) / 1000;
        if (elapsedSec < minDurationSec) return false;
    } else {
        // Closed position — use precomputed duration if available
        if (position.duration != null && position.duration > 0) {
            if (position.duration < minDurationSec) return false;
        } else if (position.exit_date && position.entry_date) {
            // Fallback: compute from timestamps
            const durationMs = new Date(position.exit_date).getTime() -
                new Date(position.entry_date).getTime();
            if (durationMs / 1000 < minDurationSec) return false;
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
    config: TournamentConfig,
): Promise<QuestProgressDetails> {
    // Filter positions to those opened within this quest week
    const weekPositions = positions.filter((p) => {
        const entryDate = p.entry_date.slice(0, 10); // YYYY-MM-DD
        return entryDate >= weekStart && entryDate <= weekEnd;
    });

    // Phase 4 item 30: iterate per (asset, side). Falls back to symbol-only when
    // config.assetList is undefined/empty (D5 — pre-Phase-4 tournaments).
    const assetList = config.assetList?.length
        ? config.assetList
        : [{ symbol: '__legacy__', mint: undefined, joinedAt: weekStart }];

    // Build per-asset result map (item 30 new shape)
    const byAsset: Record<string, {
        long: boolean[];
        short: boolean[];
        longCount: number;
        shortCount: number;
    }> = {};

    for (const assetEntry of assetList) {
        // Filter weekPositions to this asset only (D16 match-by-mint-when-present)
        const assetPositions = weekPositions.filter((p) =>
            assetEntry.symbol === '__legacy__'
                ? true
                : (assetEntry.mint ? p.token_account_mint === assetEntry.mint : p.symbol === assetEntry.symbol),
        );

        const assetKey = assetEntry.symbol === '__legacy__' ? '__legacy__' : assetEntry.symbol;

        // Phase 7.a D24: resolve per-asset ladder. lmSteps + lmTolerance from assetEntry,
        // falls back to module-level LEVERAGE_STEPS (10x crypto ladder, ±2x tolerance).
        const stepsForAsset: LeverageStep[] = assetEntry.lmSteps && assetEntry.lmSteps.length > 0
            ? buildLeverageSteps(assetEntry.lmSteps, assetEntry.lmTolerance ?? 2)
            : LEVERAGE_STEPS;
        const stepTotal = stepsForAsset.length;

        byAsset[assetKey] = {
            long: Array(stepTotal).fill(false),
            short: Array(stepTotal).fill(false),
            longCount: 0,
            shortCount: 0,
        };

        for (const side of SIDES) {
            // Read existing progress for (tournament, wallet, side, asset, week)
            const [existing] = await db
                .select()
                .from(questProgress)
                .where(and(
                    eq(questProgress.tournamentId, tournamentId),
                    eq(questProgress.wallet, wallet),
                    eq(questProgress.questType, 'leverage_master'),
                    eq(questProgress.side, side),
                    eq(questProgress.asset, assetKey),
                    eq(questProgress.weekNumber, weekNumber),
                ))
                .limit(1);

            const currentSteps: boolean[] = existing
                ? (existing.stepsCompleted as boolean[])
                : Array(stepTotal).fill(false);

            for (const position of assetPositions) {
                for (let i = 0; i < stepsForAsset.length; i++) {
                    if (!currentSteps[i] && positionCompletesStep(position, stepsForAsset[i], side, config)) {
                        currentSteps[i] = true;
                    }
                }
            }

            const stepCount = currentSteps.filter(Boolean).length;

            if (existing) {
                await db.update(questProgress)
                    .set({ stepsCompleted: currentSteps, stepCount, stepTotal, updatedAt: new Date() })
                    .where(eq(questProgress.id, existing.id));
            } else {
                await db.insert(questProgress).values({
                    tournamentId, wallet, questType: 'leverage_master',
                    side, asset: assetKey, stepsCompleted: currentSteps, stepCount, stepTotal, weekNumber,
                });
            }

            if (side === 'long') {
                byAsset[assetKey].long = currentSteps;
                byAsset[assetKey].longCount = stepCount;
            } else {
                byAsset[assetKey].short = currentSteps;
                byAsset[assetKey].shortCount = stepCount;
            }
        }
    }

    return { byAsset, weekNumber };
}

// --------------------------------------------------------------------------
// Compute Leverage Master Leaderboard
//
// Runs at week boundary (last day of quest week). Reads all quest_progress
// for the given week, ranks by stepCount per (asset, side) combination, and
// saves to daily_category_scores. Phase 4 item 30: emits per-asset categories
// 'leverage_master_${symbol}_long' / '_short' when config.assetList is populated;
// falls back to legacy 'leverage_master_long' / '_short' for empty assetList.
//
// Deterministic ordering: stepCount DESC, wallet ASC.
// --------------------------------------------------------------------------

export async function computeLeverageMasterLeaderboard(
    tournamentId: number,
    weekNumber: number,
    scoreDate: string,  // YYYY-MM-DD — the week boundary date
    config: TournamentConfig,
    seasonId: number | null = null,
): Promise<void> {
    const assetList = config.assetList?.length
        ? config.assetList
        : [{ symbol: '__legacy__', mint: undefined, joinedAt: scoreDate }];

    for (const assetEntry of assetList) {
        const assetKey = assetEntry.symbol === '__legacy__' ? '__legacy__' : assetEntry.symbol;

        for (const side of SIDES) {
            // Phase 4 item 30: per-asset category slug
            // (legacy key renders as 'leverage_master_long' / '_short' for pre-Phase-4 backfills)
            const category = assetKey === '__legacy__'
                ? `leverage_master_${side}`
                : `leverage_master_${assetKey}_${side}`;

            const progressRows = await db
                .select({
                    wallet: questProgress.wallet,
                    stepCount: questProgress.stepCount,
                    stepTotal: questProgress.stepTotal,  // Phase 7.a D25
                })
                .from(questProgress)
                .where(and(
                    eq(questProgress.tournamentId, tournamentId),
                    eq(questProgress.questType, 'leverage_master'),
                    eq(questProgress.side, side),
                    eq(questProgress.asset, assetKey),
                    eq(questProgress.weekNumber, weekNumber),
                ))
                .orderBy(desc(questProgress.stepCount), asc(questProgress.wallet));

            const rows: CategoryScoreRow[] = progressRows
                .filter((r) => r.stepCount > 0)
                .map((r) => ({
                    wallet: r.wallet,
                    category,
                    score: r.stepCount,
                    // Phase 7.a D25: stepCountTotal lets frontend render `${count}/${total}` without config lookup
                    details: { weekNumber, side, asset: assetKey, stepCount: r.stepCount, stepCountTotal: r.stepTotal },
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
    // Phase 4 item 30: new shape with byAsset map. Queries all rows for the
    // (tournament, wallet, week) combo and groups by asset.
    const conditions = [
        eq(questProgress.tournamentId, tournamentId),
        eq(questProgress.wallet, wallet),
        eq(questProgress.questType, 'leverage_master'),
    ];
    if (weekNumber !== undefined) {
        conditions.push(eq(questProgress.weekNumber, weekNumber));
    }

    const rows = await db
        .select()
        .from(questProgress)
        .where(and(...conditions))
        .orderBy(desc(questProgress.weekNumber));

    if (rows.length === 0) return null;

    // Use the most recent week (or the specific week requested)
    const targetWeek = weekNumber ?? rows[0].weekNumber;
    const weekRows = rows.filter((r) => r.weekNumber === targetWeek);

    const byAsset: Record<string, {
        long: boolean[]; short: boolean[];
        longCount: number; shortCount: number;
    }> = {};

    for (const r of weekRows) {
        // Phase 7.a: use r.stepTotal for variable-length array initialization.
        // Both long + short for same asset share the same stepTotal (per-asset config).
        if (!byAsset[r.asset]) {
            byAsset[r.asset] = {
                long: Array(r.stepTotal).fill(false),
                short: Array(r.stepTotal).fill(false),
                longCount: 0,
                shortCount: 0,
            };
        }
        if (r.side === 'long') {
            byAsset[r.asset].long = r.stepsCompleted as boolean[];
            byAsset[r.asset].longCount = r.stepCount;
        } else if (r.side === 'short') {
            byAsset[r.asset].short = r.stepsCompleted as boolean[];
            byAsset[r.asset].shortCount = r.stepCount;
        }
    }

    return { byAsset, weekNumber: targetWeek };
}
