// ============================================================================
// Admin API Routes (protected by ADMIN_SECRET)
//
// POST /api/admin/start               — Start a tournament (close reg, create brackets)
// POST /api/admin/score/:roundId      — Trigger score computation for a round
// POST /api/admin/advance             — Advance to next round (eliminate + promote)
// POST /api/admin/cancel/:id          — Cancel a tournament
// POST /api/admin/raffle/:id/compute  — Compute raffle tickets for a tournament
// POST /api/admin/raffle/:id/draw     — Execute deterministic raffle draw
// POST /api/admin/raffle/:id/reset    — Reset raffle draw (clear winners + audit trail)
// GET  /api/admin/analytics/:id/daily — Daily per-wallet position metrics
// GET  /api/admin/analytics/:id/anomalies — Quest score streak detection
// ============================================================================

import { Router } from 'express';
import {
    startTournament,
    computeRoundScores,
    advanceRound,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { tournaments, registrations, dailyCategoryScores } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { computeAllTickets, executeDeterministicDraw, resetDraw } from '../services/raffle-engine.js';

const router = Router();

// Middleware: check admin secret
router.use((req, res, next) => {
    const secret = req.headers['x-admin-secret'] as string;
    const expected = process.env.ADMIN_SECRET;

    if (!expected) {
        console.warn('[Admin] ADMIN_SECRET not set — admin routes are unprotected');
        next();
        return;
    }

    if (secret !== expected) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
});

// POST /api/admin/start — Start tournament (close registration, create brackets)
router.post('/start', async (req, res) => {
    try {
        const { tournamentId } = req.body as { tournamentId: number };

        if (!tournamentId) {
            res.status(400).json({ success: false, error: 'tournamentId is required' });
            return;
        }

        const result = await startTournament(tournamentId);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error starting tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/score/:roundId — Trigger score computation
router.post('/score/:roundId', async (req, res) => {
    try {
        const roundId = parseInt(req.params.roundId, 10);
        if (isNaN(roundId)) {
            res.status(400).json({ success: false, error: 'Invalid round ID' });
            return;
        }

        const scoredCount = await computeRoundScores(roundId);
        res.json({ success: true, data: { scoredCount } });
    } catch (error) {
        console.error('[Admin] Error computing scores:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/advance — Advance to next round
router.post('/advance', async (req, res) => {
    try {
        const { tournamentId, roundType } = req.body as { tournamentId: number; roundType?: 'main' | 'consolation' };

        if (!tournamentId) {
            res.status(400).json({ success: false, error: 'tournamentId is required' });
            return;
        }

        // roundType is optional — if omitted, the tournament manager auto-detects
        const result = await advanceRound(tournamentId, roundType);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error advancing round:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/cancel/:id — Cancel a tournament
router.post('/cancel/:id', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
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

        if (tournament.status === 'completed' || tournament.status === 'cancelled') {
            res.status(409).json({
                success: false,
                error: `Cannot cancel tournament in "${tournament.status}" status`,
            });
            return;
        }

        await db
            .update(tournaments)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(eq(tournaments.id, tournamentId));

        console.log(`[Admin] Cancelled tournament ${tournamentId} ("${tournament.name}")`);
        res.json({ success: true, data: { id: tournamentId, status: 'cancelled' } });
    } catch (error) {
        console.error('[Admin] Error cancelling tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/raffle/:id/compute — Compute raffle tickets for a tournament
router.post('/raffle/:id/compute', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const result = await computeAllTickets(tournamentId);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error computing raffle tickets:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/raffle/:id/draw — Execute deterministic raffle draw
router.post('/raffle/:id/draw', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const { blockHash, prizeCount } = req.body as {
            blockHash: string;
            prizeCount: number;
        };

        if (!blockHash || typeof blockHash !== 'string') {
            res.status(400).json({ success: false, error: 'blockHash is required (hex string)' });
            return;
        }

        if (!prizeCount || typeof prizeCount !== 'number' || prizeCount < 1) {
            res.status(400).json({ success: false, error: 'prizeCount must be a positive integer' });
            return;
        }

        const result = await executeDeterministicDraw(tournamentId, blockHash, prizeCount);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error executing raffle draw:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/raffle/:id/reset — Reset raffle draw (clear winners + audit trail)
router.post('/raffle/:id/reset', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const result = await resetDraw(tournamentId);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error resetting raffle draw:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/admin/analytics/:tournamentId/daily?date=YYYY-MM-DD
//
// Per-wallet position metrics for a specific date. Uses parallel batch
// fetching (concurrency=10) with 5-minute AdrenaClient cache.
// --------------------------------------------------------------------------
router.get('/analytics/:tournamentId/daily', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const date = req.query.date as string;
        if (isNaN(tournamentId) || !date) {
            res.status(400).json({ success: false, error: 'tournamentId and date query param required' });
            return;
        }

        // Get all registered wallets
        const regs = await db
            .select({ wallet: registrations.wallet })
            .from(registrations)
            .where(eq(registrations.tournamentId, tournamentId));

        const { AdrenaClient } = await import('../services/adrena-client.js');
        const adrena = new AdrenaClient();

        const dayStart = new Date(date + 'T00:00:00Z');
        const dayEnd = new Date(date + 'T23:59:59.999Z');

        // Per-wallet metrics
        const walletMetrics: Array<{
            wallet: string;
            tradeCount: number;
            longCount: number;
            shortCount: number;
            avgSize: number;
            maxSize: number;
            minSize: number;
            avgLeverage: number;
            maxLeverage: number;
            minLeverage: number;
            totalFees: number;
        }> = [];

        const allSizes: number[] = [];
        const allLeverages: number[] = [];
        const allFees: number[] = [];
        let totalTrades = 0;
        let activeTraders = 0;

        // Parallel batch fetch — concurrency limit of 10 to avoid API rate issues
        const BATCH_SIZE = 10;
        const walletList = regs.map((r) => r.wallet);

        for (let i = 0; i < walletList.length; i += BATCH_SIZE) {
            const batch = walletList.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                batch.map(async (wallet) => {
                    const positions = await adrena.getPositions(wallet);
                    return { wallet, positions };
                }),
            );

            for (const result of batchResults) {
                if (result.status !== 'fulfilled') continue;
                const { wallet, positions } = result.value;

                // Filter to positions opened on the specified date
                const dayPositions = positions.filter((p) => {
                    const entryDate = new Date(p.entry_date);
                    return entryDate >= dayStart && entryDate <= dayEnd;
                });

                if (dayPositions.length === 0) continue;

                activeTraders++;
                const sizes = dayPositions.map((p) => p.entry_size);
                const leverages = dayPositions.map((p) => p.entry_leverage);
                const fees = dayPositions.reduce((sum, p) => sum + p.fees, 0);
                const longs = dayPositions.filter((p) => p.side === 'long').length;
                const shorts = dayPositions.filter((p) => p.side === 'short').length;

                allSizes.push(...sizes);
                allLeverages.push(...leverages);
                allFees.push(fees);
                totalTrades += dayPositions.length;

                walletMetrics.push({
                    wallet,
                    tradeCount: dayPositions.length,
                    longCount: longs,
                    shortCount: shorts,
                    avgSize: sizes.reduce((a, b) => a + b, 0) / sizes.length,
                    maxSize: Math.max(...sizes),
                    minSize: Math.min(...sizes),
                    avgLeverage: leverages.reduce((a, b) => a + b, 0) / leverages.length,
                    maxLeverage: Math.max(...leverages),
                    minLeverage: Math.min(...leverages),
                    totalFees: fees,
                });
            }
        }

        // Aggregate stats
        const stats = {
            date,
            activeTraders,
            totalTrades,
            size: allSizes.length > 0 ? {
                min: Math.min(...allSizes),
                max: Math.max(...allSizes),
                avg: allSizes.reduce((a, b) => a + b, 0) / allSizes.length,
            } : null,
            leverage: allLeverages.length > 0 ? {
                min: Math.min(...allLeverages),
                max: Math.max(...allLeverages),
                avg: allLeverages.reduce((a, b) => a + b, 0) / allLeverages.length,
            } : null,
            fees: allFees.length > 0 ? {
                total: allFees.reduce((a, b) => a + b, 0),
                max: Math.max(...allFees),
                min: Math.min(...allFees),
                avg: allFees.reduce((a, b) => a + b, 0) / allFees.length,
            } : null,
            tradesPerTrader: activeTraders > 0 ? {
                min: Math.min(...walletMetrics.map((w) => w.tradeCount)),
                max: Math.max(...walletMetrics.map((w) => w.tradeCount)),
                avg: totalTrades / activeTraders,
            } : null,
        };

        // Sort by total fees desc (most → least active)
        walletMetrics.sort((a, b) => b.totalFees - a.totalFees);

        res.json({ success: true, data: { stats, walletMetrics } });
    } catch (error) {
        console.error('[Admin] Analytics error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/admin/analytics/:tournamentId/anomalies
//
// Detects quest score streaks: wallets in top 5 for N+ consecutive days.
// Flags potential gaming or bot patterns.
// --------------------------------------------------------------------------
router.get('/analytics/:tournamentId/anomalies', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const STREAK_THRESHOLD = 3; // Flag wallets in top 5 for N+ consecutive days

        // Get all category scores, ordered by wallet → category → date
        const allScores = await db
            .select()
            .from(dailyCategoryScores)
            .where(eq(dailyCategoryScores.tournamentId, tournamentId))
            .orderBy(
                asc(dailyCategoryScores.wallet),
                asc(dailyCategoryScores.category),
                asc(dailyCategoryScores.scoreDate),
            );

        // Filter out sentinels
        const realScores = allScores.filter((s) => !s.wallet.startsWith('__'));

        // Collect unique dates per category (for date enumeration)
        const categoryDates = new Map<string, Set<string>>();
        for (const score of realScores) {
            if (!categoryDates.has(score.category)) {
                categoryDates.set(score.category, new Set());
            }
            categoryDates.get(score.category)!.add(String(score.scoreDate));
        }

        // For each category, check each date's top 5 for streaks
        const anomalies: Array<{
            wallet: string;
            category: string;
            streakLength: number;
            dates: string[];
            type: 'consecutive_top5';
        }> = [];

        for (const [category, dateSet] of categoryDates) {
            // Get ordered dates
            const dates = [...dateSet].sort();

            // For each date, compute top 5 wallets
            const dailyTop5 = new Map<string, Set<string>>();
            for (const date of dates) {
                const dateScores = realScores
                    .filter((s) => s.category === category && String(s.scoreDate) === date)
                    .sort((a, b) => b.score - a.score);

                const top5 = new Set(dateScores.slice(0, 5).map((s) => s.wallet));
                dailyTop5.set(date, top5);
            }

            // Check for consecutive streaks per wallet
            const walletStreaks = new Map<string, string[]>();
            for (const date of dates) {
                const top5 = dailyTop5.get(date)!;
                for (const wallet of top5) {
                    const streak = walletStreaks.get(wallet) ?? [];
                    // Check if this continues a consecutive streak
                    if (streak.length > 0) {
                        const lastDate = streak[streak.length - 1];
                        const lastIdx = dates.indexOf(lastDate);
                        const currentIdx = dates.indexOf(date);
                        if (currentIdx === lastIdx + 1) {
                            streak.push(date);
                        } else {
                            // Gap — check if previous streak was long enough
                            if (streak.length >= STREAK_THRESHOLD) {
                                anomalies.push({
                                    wallet, category,
                                    streakLength: streak.length,
                                    dates: [...streak],
                                    type: 'consecutive_top5',
                                });
                            }
                            walletStreaks.set(wallet, [date]);
                            continue;
                        }
                    } else {
                        streak.push(date);
                    }
                    walletStreaks.set(wallet, streak);
                }

                // Clean up wallets NOT in today's top 5
                for (const [wallet, streak] of walletStreaks) {
                    if (!top5.has(wallet) && streak.length > 0) {
                        if (streak.length >= STREAK_THRESHOLD) {
                            anomalies.push({
                                wallet, category,
                                streakLength: streak.length,
                                dates: [...streak],
                                type: 'consecutive_top5',
                            });
                        }
                        walletStreaks.set(wallet, []);
                    }
                }
            }

            // Flush remaining streaks
            for (const [wallet, streak] of walletStreaks) {
                if (streak.length >= STREAK_THRESHOLD) {
                    anomalies.push({
                        wallet, category,
                        streakLength: streak.length,
                        dates: [...streak],
                        type: 'consecutive_top5',
                    });
                }
            }
        }

        res.json({
            success: true,
            data: {
                tournamentId,
                streakThreshold: STREAK_THRESHOLD,
                anomalyCount: anomalies.length,
                anomalies: anomalies.sort((a, b) => b.streakLength - a.streakLength),
            },
        });
    } catch (error) {
        console.error('[Admin] Anomaly detection error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
