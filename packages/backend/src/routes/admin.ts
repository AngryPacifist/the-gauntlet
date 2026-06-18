// ============================================================================
// Admin API Routes (protected by ADMIN_SECRET)
//
// POST /api/admin/start                   Start a tournament (close reg, create brackets)
// POST /api/admin/score/:roundId          Trigger score computation for a round
// POST /api/admin/advance                 Advance to next round (eliminate + promote)
// POST /api/admin/cancel/:id              Cancel a tournament
// POST /api/admin/raffle/:id/compute      Compute raffle tickets for a tournament
// POST /api/admin/raffle/:id/draw         Execute deterministic raffle draw
// POST /api/admin/raffle/:id/reset        Reset raffle draw (clear winners + audit trail)
// GET  /api/admin/analytics/:id/daily     Daily per-wallet position metrics
// GET  /api/admin/analytics/:id/anomalies Quest score streak detection
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
import * as mutagenAdmin from '../services/mutagen-admin.js';
import type { EpochConfig } from '../services/mutagen-scorer-types.js';

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

// POST /api/admin/start: Start tournament (close registration, create brackets)
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

// POST /api/admin/score/:roundId: Trigger score computation
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

// POST /api/admin/advance: Advance to next round
router.post('/advance', async (req, res) => {
    try {
        const { tournamentId, roundType } = req.body as { tournamentId: number; roundType?: 'main' | 'consolation' };

        if (!tournamentId) {
            res.status(400).json({ success: false, error: 'tournamentId is required' });
            return;
        }

        // roundType is optional; if omitted, the tournament manager auto-detects
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

// POST /api/admin/cancel/:id: Cancel a tournament
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

// POST /api/admin/raffle/:id/compute: Compute raffle tickets for a tournament
router.post('/raffle/:id/compute', async (req, res) => {
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
        const { resolveConfig } = await import('../types.js');
        const config = resolveConfig(tournament.config);
        const result = await computeAllTickets(tournamentId, config);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Admin] Error computing raffle tickets:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/admin/raffle/:id/draw: Execute deterministic raffle draw
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

// POST /api/admin/raffle/:id/reset: Reset raffle draw (clear winners + audit trail)
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

        // Parallel batch fetch: concurrency limit of 10 to avoid API rate issues
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
                            // Gap; check if previous streak was long enough
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

// --------------------------------------------------------------------------
// GET /api/admin/tradable-assets: static-mirror from adrena-abi
//
// Returns the canonical 9 tradable Adrena symbols with Pyth Lazer feed_id,
// SPL token mint (main-pool only, sourced from src/lib.rs:46-50 constants in
// the abi repo), synthetic-custody PDA (commodities-pool RWAs only), pool
// name, and trading-hours profile (sessioned flag). Data sourced from a
// pinned snapshot of github.com/AdrenaFoundation/adrena-abi; see
// services/adrena-canonical.ts for sync notes + commit hash.
//
// Static-mirror chosen over runtime HTTP joins so the endpoint survives
// Adrena API shape changes and avoids a runtime dependency on Adrena's
// uptime for admin tournament-creation.
//
// Admin-protected by the router.use() middleware at top of file.
// --------------------------------------------------------------------------
router.get('/tradable-assets', async (_req, res) => {
    try {
        const { getTradableAssets } = await import('../services/adrena-canonical.js');
        res.json({ success: true, data: getTradableAssets() });
    } catch (error) {
        console.error('[Admin] Error fetching tradable assets:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// ============================================================================
// Mutagen admin: epoch lifecycle + marketing awards + bootstrap.
// Thin handlers over services/mutagen-admin.ts. All inherit the ADMIN_SECRET
// middleware (router.use) at the top of this router.
// ============================================================================

const MUTAGEN_FAIL_STATUS: Record<mutagenAdmin.AdminFail['code'], number> = {
    not_found: 404,
    conflict: 409,
    bad_request: 400,
};

// POST /api/admin/mutagen/epochs — create an epoch (config defaults to DEFAULT_EPOCH_CONFIG)
router.post('/mutagen/epochs', async (req, res) => {
    try {
        const { name, startAt, endAt, subEpochWeeks, config } = req.body as {
            name?: string; startAt?: string; endAt?: string; subEpochWeeks?: number; config?: EpochConfig;
        };
        const result = await mutagenAdmin.createEpoch({
            name: name ?? '',
            startAt: startAt ? new Date(startAt) : new Date(NaN),
            endAt: endAt ? new Date(endAt) : new Date(NaN),
            subEpochWeeks,
            config,
        });
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: result.epoch });
    } catch (error) {
        console.error('[Admin][mutagen] create epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// GET /api/admin/mutagen/epochs — list all epochs
router.get('/mutagen/epochs', async (_req, res) => {
    try {
        const epochs = await mutagenAdmin.listEpochs();
        res.json({ success: true, data: epochs });
    } catch (error) {
        console.error('[Admin][mutagen] list epochs error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// GET /api/admin/mutagen/epochs/:id — one epoch
router.get('/mutagen/epochs/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid epoch id' });
            return;
        }
        const epoch = await mutagenAdmin.getEpochById(id);
        if (!epoch) {
            res.status(404).json({ success: false, error: `epoch ${id} not found` });
            return;
        }
        res.json({ success: true, data: epoch });
    } catch (error) {
        console.error('[Admin][mutagen] get epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// GET /api/admin/mutagen/epochs/:id/sub-epochs — list an epoch's sub-epochs (+ weights)
router.get('/mutagen/epochs/:id/sub-epochs', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) { res.status(400).json({ success: false, error: 'invalid epoch id' }); return; }
        const subEpochs = await mutagenAdmin.listSubEpochs(id);
        res.json({ success: true, data: subEpochs });
    } catch (error) {
        console.error('[Admin][mutagen] list sub-epochs error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// PATCH /api/admin/mutagen/epochs/:id — update epoch config
router.patch('/mutagen/epochs/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid epoch id' });
            return;
        }
        const { config } = req.body as { config?: EpochConfig };
        if (!config) {
            res.status(400).json({ success: false, error: 'config is required' });
            return;
        }
        const result = await mutagenAdmin.updateEpochConfig(id, config);
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: result.epoch });
    } catch (error) {
        console.error('[Admin][mutagen] update epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// POST /api/admin/mutagen/epochs/:id/activate — registration → active + generate sub-epochs (atomic)
router.post('/mutagen/epochs/:id/activate', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid epoch id' });
            return;
        }
        const result = await mutagenAdmin.activateEpoch(id);
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: { epoch: result.epoch, subEpochIds: result.subEpochIds } });
    } catch (error) {
        console.error('[Admin][mutagen] activate epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// POST /api/admin/mutagen/epochs/:id/complete — active → completed
router.post('/mutagen/epochs/:id/complete', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid epoch id' });
            return;
        }
        const result = await mutagenAdmin.completeEpoch(id);
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: result.epoch });
    } catch (error) {
        console.error('[Admin][mutagen] complete epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// DELETE /api/admin/mutagen/epochs/:id — delete epoch + cascade all its data
router.delete('/mutagen/epochs/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid epoch id' });
            return;
        }
        const result = await mutagenAdmin.deleteEpoch(id);
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: result.deleted });
    } catch (error) {
        console.error('[Admin][mutagen] delete epoch error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// POST /api/admin/mutagen/marketing-award — award Activity 5 social/discord points
router.post('/mutagen/marketing-award', async (req, res) => {
    try {
        const { wallet, activityType, amount, reason, awardedBy, source } = req.body as {
            wallet?: string; activityType?: string; amount?: number; reason?: string; awardedBy?: string; source?: string;
        };
        const result = await mutagenAdmin.addMarketingAward({
            wallet: wallet ?? '',
            activityType: activityType ?? '',
            amount: typeof amount === 'number' ? amount : NaN,
            reason,
            awardedBy,
            source,
        });
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: { awardId: result.awardId, subEpochId: result.subEpochId } });
    } catch (error) {
        console.error('[Admin][mutagen] marketing-award error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// POST /api/admin/mutagen/bootstrap — one-time seeding (fire-and-forget background scoring)
router.post('/mutagen/bootstrap', async (req, res) => {
    try {
        const { topN } = req.body as { topN?: number };
        const result = await mutagenAdmin.bootstrapSeed(typeof topN === 'number' ? topN : 1000);
        if (!result.ok) {
            res.status(400).json({ success: false, error: result.error });
            return;
        }
        // 202 Accepted: scoring runs in the background; the response returns now.
        res.status(202).json({ success: true, data: { queued: result.queued, sources: result.sources } });
    } catch (error) {
        console.error('[Admin][mutagen] bootstrap error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

// PATCH /api/admin/mutagen/sub-epochs/:id/weights — set a sub-epoch's weights (forward-only)
router.patch('/mutagen/sub-epochs/:id/weights', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'invalid sub-epoch id' });
            return;
        }
        const { weights } = req.body as { weights?: { a1: number; a2: number; a3: number; a4: number; a5: number } };
        if (!weights) {
            res.status(400).json({ success: false, error: 'weights is required' });
            return;
        }
        const result = await mutagenAdmin.setSubEpochWeights(id, weights);
        if (!result.ok) {
            res.status(MUTAGEN_FAIL_STATUS[result.code]).json({ success: false, error: result.error });
            return;
        }
        res.json({ success: true, data: result.subEpoch });
    } catch (error) {
        console.error('[Admin][mutagen] set sub-epoch weights error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

export default router;
