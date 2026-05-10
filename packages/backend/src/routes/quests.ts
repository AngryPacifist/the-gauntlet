// ============================================================================
// Quest API Routes (public)
//
// GET /api/quests/:tournamentId/leaderboard  — Round 2 LM-2/3: per-asset,
//   per-side LM leaderboard from quest_progress (live, not week-boundary)
//   Optional: ?week=N or ?date=YYYY-MM-DD
// GET /api/quests/:tournamentId/:wallet      — Quest progress (badge grid data)
//   Optional query: ?week=N for specific week
// ============================================================================

import { Router } from 'express';
import { eq, and, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { questProgress, tournaments, rounds } from '../db/schema.js';
import { resolveConfig } from '../types.js';
import { getQuestProgress } from '../services/quest-engine.js';

const router = Router();

// Round 2: LM quest-points table mirrors final-score.ts:LEVERAGE_QUEST_POINTS.
// Top 5 per (asset, side) earn points. Phase 8.m guard: stepCount > 0 required.
const LEVERAGE_QUEST_POINTS = [0.5, 0.4, 0.3, 0.2, 0.1];

// --------------------------------------------------------------------------
// GET /api/quests/:tournamentId/leaderboard?week=N or ?date=YYYY-MM-DD
//
// Round 2 (LM-2 + LM-3): per-asset, per-side LM leaderboard read from
// quest_progress (live state, hourly-updated by evaluateLeverageProgress)
// instead of daily_category_scores (week-boundary writes only). Replaces
// the dailyCategoryScores dependency that produced "no scores yet" mid-week
// on the Quest Leaderboards Weekly tab.
//
// Response shape:
// {
//   weekNumber: 1,
//   byAssetSide: {
//     'SOL': {
//       long: [{ wallet, stepCount, stepTotal, stepsCompleted, rank, points }, ...],
//       short: [...]
//     },
//     'BTC': { long, short },
//     ...
//   }
// }
//
// Ranking: stepCount DESC, wallet ASC. Top 5 per (asset, side) earn LM
// quest points from LEVERAGE_QUEST_POINTS table [0.5, 0.4, 0.3, 0.2, 0.1].
// Phase 8.m guard: stepCount > 0 required for points.
//
// Week resolution priority: ?week=N > ?date=YYYY-MM-DD > current week.
// Date param supports the frontend's Quest Leaderboards Weekly date navigator
// — frontend passes the displayed date string, this endpoint converts to
// week number using the same logic as scheduler.ts:computeCurrentQuestWeek.
// --------------------------------------------------------------------------
router.get('/:tournamentId/leaderboard', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId))
            .limit(1);
        if (!tournament) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }
        const config = resolveConfig(tournament.config);

        const [firstRound] = await db
            .select({ startTime: rounds.startTime })
            .from(rounds)
            .where(and(
                eq(rounds.tournamentId, tournamentId),
                eq(rounds.type, 'main'),
            ))
            .orderBy(asc(rounds.startTime))
            .limit(1);
        if (!firstRound) {
            res.json({ success: true, data: { weekNumber: 0, byAssetSide: {} } });
            return;
        }

        const startDate = new Date(firstRound.startTime);
        startDate.setUTCHours(0, 0, 0, 0);

        // Helper: date → week number (mirror of scheduler.ts:computeCurrentQuestWeek).
        const dateToWeek = (d: Date): number => {
            const normalized = new Date(d);
            normalized.setUTCHours(0, 0, 0, 0);
            const daysSinceStart = Math.floor(
                (normalized.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
            );
            return Math.max(Math.floor(daysSinceStart / 7) + 1, 1);
        };

        const weekParam = req.query.week as string | undefined;
        const dateParam = req.query.date as string | undefined;

        let targetWeek: number;
        if (weekParam) {
            targetWeek = parseInt(weekParam, 10);
            if (isNaN(targetWeek) || targetWeek < 1) {
                res.status(400).json({ success: false, error: 'Invalid week number' });
                return;
            }
        } else if (dateParam) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
                res.status(400).json({ success: false, error: 'Invalid date format (expected YYYY-MM-DD)' });
                return;
            }
            targetWeek = dateToWeek(new Date(dateParam + 'T00:00:00Z'));
        } else {
            targetWeek = dateToWeek(new Date());
        }

        // Pull all quest_progress for the tournament + week
        const rows = await db
            .select()
            .from(questProgress)
            .where(and(
                eq(questProgress.tournamentId, tournamentId),
                eq(questProgress.questType, 'leverage_master'),
                eq(questProgress.weekNumber, targetWeek),
            ))
            .orderBy(desc(questProgress.stepCount), asc(questProgress.wallet));

        // Group by (asset, side)
        type Entry = {
            wallet: string;
            stepCount: number;
            stepTotal: number;
            stepsCompleted: boolean[];
            rank: number;
            points: number;
        };
        const byAssetSide: Record<string, { long: Entry[]; short: Entry[] }> = {};

        // Initialize from config.assetList so empty assets render correctly
        if (config.assetList?.length) {
            for (const a of config.assetList) {
                byAssetSide[a.symbol] = { long: [], short: [] };
            }
        }

        for (const r of rows) {
            const sym = r.asset;
            if (!byAssetSide[sym]) byAssetSide[sym] = { long: [], short: [] };
            const side = r.side as 'long' | 'short';
            byAssetSide[sym][side].push({
                wallet: r.wallet,
                stepCount: r.stepCount,
                stepTotal: r.stepTotal,
                stepsCompleted: r.stepsCompleted as boolean[],
                rank: 0,
                points: 0,
            });
        }

        // Compute competition rank + LM quest points per (asset, side)
        for (const sym of Object.keys(byAssetSide)) {
            for (const side of ['long', 'short'] as const) {
                const list = byAssetSide[sym][side];
                let cRank = 0;
                for (let i = 0; i < list.length; i++) {
                    if (i > 0 && list[i].stepCount !== list[i - 1].stepCount) cRank = i;
                    list[i].rank = cRank + 1;
                    // Phase 8.m guard: stepCount > 0 required for points.
                    if (list[i].stepCount > 0 && cRank < LEVERAGE_QUEST_POINTS.length) {
                        list[i].points = LEVERAGE_QUEST_POINTS[cRank];
                    }
                }
            }
        }

        res.json({ success: true, data: { weekNumber: targetWeek, byAssetSide } });
    } catch (error) {
        console.error('[Quests] Error getting LM leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/quests/:tournamentId/:wallet — Badge grid data
//
// Returns the wallet's Leverage Master quest progress for the current
// or specified week. Used by the frontend badge grid component.
// --------------------------------------------------------------------------
router.get('/:tournamentId/:wallet', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const wallet = req.params.wallet;

        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        if (!wallet || wallet.length < 32 || wallet.length > 44) {
            res.status(400).json({ success: false, error: 'Invalid wallet address' });
            return;
        }

        // Optional week query parameter
        const weekParam = req.query.week as string | undefined;
        const weekNumber = weekParam ? parseInt(weekParam, 10) : undefined;

        if (weekParam && (isNaN(weekNumber!) || weekNumber! < 1)) {
            res.status(400).json({ success: false, error: 'Invalid week number' });
            return;
        }

        const progress = await getQuestProgress(tournamentId, wallet, weekNumber);

        if (!progress) {
            // Phase 4 item 30: new shape is {byAsset: Record<symbol, {...}>, weekNumber}.
            // Empty byAsset = no progress yet (frontend handles empty state).
            res.json({
                success: true,
                data: {
                    byAsset: {},
                    weekNumber: weekNumber ?? 0,
                },
            });
            return;
        }

        res.json({ success: true, data: progress });
    } catch (error) {
        console.error('[Quests] Error getting quest progress:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
