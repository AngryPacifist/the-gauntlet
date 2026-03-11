// ============================================================================
// Daily Category API Routes
//
// GET /api/categories/:tournamentId/all-around       — All Around leaderboard (cumulative)
// GET /api/categories/:tournamentId/all-around/:date  — Single day All Around scores
// GET /api/categories/:tournamentId/fisher            — Fisher leaderboard (cumulative)
// GET /api/categories/:tournamentId/fisher/:date      — Single day Fisher scores
//
// Admin:
// POST /api/categories/score — Manually trigger daily category scoring
// ============================================================================

import { Router } from 'express';
import { db } from '../db/index.js';
import { dailyCategoryScores, registrations, tournaments } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { AdrenaClient } from '../services/adrena-client.js';
import { fetchDailyOHLCBatch } from '../services/pyth-client.js';
import {
    computeAllAroundScore,
    computeFisherScores,
    saveDailyCategoryScores,
} from '../services/category-engine.js';
import type { AdrenaPosition, AllAroundDetails } from '../types.js';

const router = Router();
const adrenaClient = new AdrenaClient();

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/all-around — Cumulative All Around leaderboard
// --------------------------------------------------------------------------
router.get('/:tournamentId/all-around', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        // Aggregate scores across all days for this category
        const scores = await db
            .select({
                wallet: dailyCategoryScores.wallet,
                totalScore: sql<number>`SUM(${dailyCategoryScores.score})`.as('total_score'),
                daysScored: sql<number>`COUNT(*)`.as('days_scored'),
            })
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'all_around'),
                ),
            )
            .groupBy(dailyCategoryScores.wallet)
            .orderBy(desc(sql`SUM(${dailyCategoryScores.score})`));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error('[Categories] Error getting All Around leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/all-around/:date — Single day scores
// --------------------------------------------------------------------------
router.get('/:tournamentId/all-around/:date', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const dateStr = req.params.date; // YYYY-MM-DD

        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const scores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'all_around'),
                    eq(dailyCategoryScores.scoreDate, dateStr),
                ),
            )
            .orderBy(desc(dailyCategoryScores.score));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error('[Categories] Error getting daily All Around scores:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/fisher — Cumulative Fisher leaderboard
// --------------------------------------------------------------------------
router.get('/:tournamentId/fisher', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const scores = await db
            .select({
                wallet: dailyCategoryScores.wallet,
                totalScore: sql<number>`SUM(${dailyCategoryScores.score})`.as('total_score'),
                daysScored: sql<number>`COUNT(*)`.as('days_scored'),
            })
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'fisher'),
                ),
            )
            .groupBy(dailyCategoryScores.wallet)
            .orderBy(desc(sql`SUM(${dailyCategoryScores.score})`));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error('[Categories] Error getting Fisher leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/fisher/:date — Single day Fisher scores
// --------------------------------------------------------------------------
router.get('/:tournamentId/fisher/:date', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const dateStr = req.params.date;

        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const scores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'fisher'),
                    eq(dailyCategoryScores.scoreDate, dateStr),
                ),
            )
            .orderBy(desc(dailyCategoryScores.score));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error('[Categories] Error getting daily Fisher scores:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// POST /api/categories/score — Manually trigger daily category scoring
// Admin protected
// --------------------------------------------------------------------------
router.post('/score', async (req, res) => {
    try {
        // Check admin secret
        const secret = req.headers['x-admin-secret'] as string;
        const expected = process.env.ADMIN_SECRET;
        if (expected && secret !== expected) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }

        const { tournamentId, date } = req.body as { tournamentId: number; date: string };

        if (!tournamentId || !date) {
            res.status(400).json({
                success: false,
                error: 'tournamentId and date (YYYY-MM-DD) are required',
            });
            return;
        }

        // Fetch OHLC
        const ohlcData = await fetchDailyOHLCBatch(date);

        // Get registered wallets and their positions
        const regs = await db
            .select()
            .from(registrations)
            .where(eq(registrations.tournamentId, tournamentId));

        const walletPositions = new Map<string, AdrenaPosition[]>();
        for (const reg of regs) {
            try {
                const positions = await adrenaClient.getPositions(reg.wallet);
                walletPositions.set(reg.wallet, positions);
            } catch (error) {
                console.warn(`[Categories] Failed to fetch positions for ${reg.wallet}`);
            }
        }

        // Compute scores
        const allAroundScores = new Map<string, AllAroundDetails>();
        for (const [wallet, positions] of walletPositions) {
            allAroundScores.set(wallet, computeAllAroundScore(positions, date));
        }

        const fisherScores = computeFisherScores(walletPositions, date, ohlcData);

        // Get tournament to check for season_id
        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId))
            .limit(1);

        const seasonId = tournament?.seasonId ?? null;

        await saveDailyCategoryScores(tournamentId, seasonId, date, allAroundScores, fisherScores);

        res.json({
            success: true,
            data: {
                date,
                tournamentId,
                walletsScored: walletPositions.size,
                ohlcAssetsAvailable: ohlcData.size,
            },
        });
    } catch (error) {
        console.error('[Categories] Error scoring categories:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
