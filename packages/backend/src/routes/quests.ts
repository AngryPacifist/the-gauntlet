// ============================================================================
// Quest API Routes (public)
//
// GET /api/quests/:tournamentId/leaderboard  Per-asset merged LM leaderboard
//   from quest_progress (live state; mid-week step progress visible).
//   Optional: ?week=N or ?date=YYYY-MM-DD
// GET /api/quests/:tournamentId/:wallet      Quest progress (badge grid data)
//   Optional query: ?week=N for specific week
// ============================================================================

import { Router } from 'express';
import { eq, and, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { questProgress, tournaments, rounds } from '../db/schema.js';
import { resolveConfig } from '../types.js';
import { getQuestProgress } from '../services/quest-engine.js';

const router = Router();

// LM quest-points table mirrors final-score.ts:LEVERAGE_QUEST_POINTS.
// Top 5 per (asset, side) earn points. Guard: stepCount > 0 required.
const LEVERAGE_QUEST_POINTS = [0.5, 0.4, 0.3, 0.2, 0.1];

// --------------------------------------------------------------------------
// GET /api/quests/:tournamentId/leaderboard?week=N or ?date=YYYY-MM-DD
//
// Per-asset merged LM leaderboard from quest_progress (live state). Each
// entry combines both Long + Short progression for a single wallet so the
// FE Weekly tab + General Leaderboard expanded row can render one row per
// wallet with split-background per-step badges.
//
// Response shape:
// {
//   weekNumber: 1,
//   byAsset: {
//     'SOL': [{
//       wallet,
//       longCount, shortCount, stepTotal,
//       stepsCompletedLong: boolean[], stepsCompletedShort: boolean[],
//       pointsLong, pointsShort, totalPoints,
//       rank
//     }, ...],
//     'BTC': [...],
//     ...
//   }
// }
//
// Sort: (longCount + shortCount) DESC, max(L, S) DESC, wallet ASC.
// Competition ranking (1224): tied wallets share rank, next rank skips.
//
// Points: engine UNCHANGED. Top 5 per (asset, side) earn from
// LEVERAGE_QUEST_POINTS [0.5, 0.4, 0.3, 0.2, 0.1]; guard requires
// stepCount > 0. Display sums pointsLong + pointsShort per wallet.
//
// Week resolution priority: ?week=N > ?date=YYYY-MM-DD > current week.
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
            res.json({ success: true, data: { weekNumber: 0, byAsset: {} } });
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
            ));

        // Pivot: group by (asset, wallet), combine long + short per wallet.
        type SideData = { stepsCompleted: boolean[]; stepCount: number };
        const byAssetWallet: Record<string, Map<string, {
            long?: SideData; short?: SideData; stepTotal: number;
        }>> = {};
        for (const r of rows) {
            if (!byAssetWallet[r.asset]) byAssetWallet[r.asset] = new Map();
            const m = byAssetWallet[r.asset];
            if (!m.has(r.wallet)) m.set(r.wallet, { stepTotal: r.stepTotal });
            const entry = m.get(r.wallet)!;
            const side = r.side as 'long' | 'short';
            entry[side] = {
                stepsCompleted: r.stepsCompleted as boolean[],
                stepCount: r.stepCount,
            };
            entry.stepTotal = r.stepTotal;
        }

        // Initialize byAsset from config.assetList so empty assets render correctly.
        type MergedEntry = {
            wallet: string;
            longCount: number;
            shortCount: number;
            stepTotal: number;
            stepsCompletedLong: boolean[];
            stepsCompletedShort: boolean[];
            pointsLong: number;
            pointsShort: number;
            totalPoints: number;
            rank: number;
        };
        const byAsset: Record<string, MergedEntry[]> = {};
        if (config.assetList?.length) {
            for (const a of config.assetList) byAsset[a.symbol] = [];
        }

        // Per-asset: compute per-side rank to assign points (engine unchanged),
        // then build merged entries + sort by combined metrics.
        for (const [asset, walletMap] of Object.entries(byAssetWallet)) {
            type SideRanked = { wallet: string; stepCount: number; points: number };
            const longList: SideRanked[] = [];
            const shortList: SideRanked[] = [];
            for (const [wallet, sides] of walletMap) {
                if (sides.long) longList.push({ wallet, stepCount: sides.long.stepCount, points: 0 });
                if (sides.short) shortList.push({ wallet, stepCount: sides.short.stepCount, points: 0 });
            }
            // Per-side rank: stepCount DESC, wallet ASC. stepCount > 0 required for points.
            longList.sort((a, b) => b.stepCount - a.stepCount || a.wallet.localeCompare(b.wallet));
            shortList.sort((a, b) => b.stepCount - a.stepCount || a.wallet.localeCompare(b.wallet));
            let lcRank = 0;
            for (let i = 0; i < longList.length; i++) {
                if (i > 0 && longList[i].stepCount !== longList[i - 1].stepCount) lcRank = i;
                if (longList[i].stepCount > 0 && lcRank < LEVERAGE_QUEST_POINTS.length) {
                    longList[i].points = LEVERAGE_QUEST_POINTS[lcRank];
                }
            }
            let scRank = 0;
            for (let i = 0; i < shortList.length; i++) {
                if (i > 0 && shortList[i].stepCount !== shortList[i - 1].stepCount) scRank = i;
                if (shortList[i].stepCount > 0 && scRank < LEVERAGE_QUEST_POINTS.length) {
                    shortList[i].points = LEVERAGE_QUEST_POINTS[scRank];
                }
            }
            const longPointsByWallet = new Map(longList.map((e) => [e.wallet, e.points]));
            const shortPointsByWallet = new Map(shortList.map((e) => [e.wallet, e.points]));

            // Build merged entries.
            const merged: MergedEntry[] = [];
            for (const [wallet, sides] of walletMap) {
                const stepTotal = sides.stepTotal;
                const longCount = sides.long?.stepCount ?? 0;
                const shortCount = sides.short?.stepCount ?? 0;
                const pointsLong = longPointsByWallet.get(wallet) ?? 0;
                const pointsShort = shortPointsByWallet.get(wallet) ?? 0;
                merged.push({
                    wallet,
                    longCount,
                    shortCount,
                    stepTotal,
                    stepsCompletedLong: sides.long?.stepsCompleted ?? new Array(stepTotal).fill(false),
                    stepsCompletedShort: sides.short?.stepsCompleted ?? new Array(stepTotal).fill(false),
                    pointsLong,
                    pointsShort,
                    totalPoints: pointsLong + pointsShort,
                    rank: 0,
                });
            }
            // Combined sort: total step count DESC, max(L, S) DESC, wallet ASC.
            merged.sort((a, b) => {
                const totalDiff = (b.longCount + b.shortCount) - (a.longCount + a.shortCount);
                if (totalDiff !== 0) return totalDiff;
                const maxDiff = Math.max(b.longCount, b.shortCount) - Math.max(a.longCount, a.shortCount);
                if (maxDiff !== 0) return maxDiff;
                return a.wallet.localeCompare(b.wallet);
            });
            // Competition rank (1224) on the merged sort key.
            let mRank = 1;
            let prevKey = '';
            for (let i = 0; i < merged.length; i++) {
                const key = `${merged[i].longCount + merged[i].shortCount}|${Math.max(merged[i].longCount, merged[i].shortCount)}`;
                if (i === 0 || key !== prevKey) mRank = i + 1;
                merged[i].rank = mRank;
                prevKey = key;
            }
            byAsset[asset] = merged;
        }

        res.json({ success: true, data: { weekNumber: targetWeek, byAsset } });
    } catch (error) {
        console.error('[Quests] Error getting LM leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/quests/:tournamentId/:wallet: Badge grid data
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
            // Shape: {byAsset: Record<symbol, {...}>, weekNumber}.
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
