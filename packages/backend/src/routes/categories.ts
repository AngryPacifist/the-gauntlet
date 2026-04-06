// ============================================================================
// Daily Category API Routes
//
// GET /api/categories/:tournamentId/:category       -- Category leaderboard (cumulative)
// GET /api/categories/:tournamentId/:category/:date -- Single day scores
//
// Admin:
// POST /api/categories/score -- Manually trigger daily category scoring
// ============================================================================

import { Router } from 'express';
import { db } from '../db/index.js';
import { dailyCategoryScores, registrations, rounds, tournaments } from '../db/schema.js';
import { awardDailyFisherPoints, awardDailyAllAroundPoints } from '../services/season-manager.js';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { AdrenaClient } from '../services/adrena-client.js';
import { fetchDailyOHLCBatch } from '../services/pyth-client.js';
import {
    computeAllAroundScore,
    computeFisherScores,
    computeRiskManagerScores,
    computeHumbleOneScores,
    saveDailyCategoryScores,
} from '../services/category-engine.js';
import type { AdrenaPosition, AllAroundDetails, CategoryScoreRow } from '../types.js';

const router = Router();
const adrenaClient = new AdrenaClient();

// --------------------------------------------------------------------------
// Category validation
// --------------------------------------------------------------------------
const VALID_CATEGORIES = [
    'all_around', 'top_tick_traveler', 'bottom_fisher',
    'risk_manager', 'humble_one', 'leverage_master',
] as const;

// Categories that use SUM aggregation (daily additive scores)
const SUM_CATEGORIES = new Set(['all_around', 'top_tick_traveler', 'bottom_fisher']);

// Categories that use MAX aggregation (best single window score)
// risk_manager, humble_one, leverage_master

// --------------------------------------------------------------------------
// POST /api/categories/score -- Manually trigger daily category scoring
// Admin protected. Must be registered BEFORE generic routes.
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

        // Compute daily scores
        const allAroundRows: CategoryScoreRow[] = [];
        for (const [wallet, positions] of walletPositions) {
            const details = computeAllAroundScore(positions, date);
            allAroundRows.push({
                wallet, category: 'all_around',
                score: details.totalPoints, details,
            });
        }

        // Fisher split
        const fisherResults = computeFisherScores(walletPositions, date, ohlcData);
        const bottomFisherRows: CategoryScoreRow[] = [];
        const topTickRows: CategoryScoreRow[] = [];

        for (const [wallet, details] of fisherResults) {
            bottomFisherRows.push({
                wallet, category: 'bottom_fisher',
                score: details.longPoints,
                details: { longEntry: details.longEntry, totalPoints: details.longPoints },
            });
            topTickRows.push({
                wallet, category: 'top_tick_traveler',
                score: details.shortPoints,
                details: { shortEntry: details.shortEntry, totalPoints: details.shortPoints },
            });
        }

        // Get tournament to check for season_id
        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId))
            .limit(1);

        const seasonId = tournament?.seasonId ?? null;

        await saveDailyCategoryScores(
            tournamentId, seasonId, date,
            [...allAroundRows, ...topTickRows, ...bottomFisherRows],
        );

        // Determine if this is a 2-day window scoring day
        const [firstRound] = await db
            .select({ startTime: rounds.startTime })
            .from(rounds)
            .where(eq(rounds.tournamentId, tournamentId))
            .orderBy(asc(rounds.startTime))
            .limit(1);

        if (firstRound) {
            const tradingStartDate = new Date(firstRound.startTime);
            tradingStartDate.setUTCHours(0, 0, 0, 0);
            const yesterday = new Date(date + 'T00:00:00Z');
            const daysSinceStart = Math.floor(
                (yesterday.getTime() - tradingStartDate.getTime()) / (24 * 60 * 60 * 1000),
            );
            const dayNumber = daysSinceStart + 1;

            if (dayNumber >= 2 && dayNumber % 2 === 0) {
                const windowStartDate = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000);
                const windowStartStr = windowStartDate.toISOString().slice(0, 10);

                const riskManagerResults = computeRiskManagerScores(
                    walletPositions, windowStartStr, date,
                );
                const humbleOneResults = computeHumbleOneScores(
                    walletPositions, windowStartStr, date,
                );

                const engagementRows: CategoryScoreRow[] = [];
                for (const [wallet, details] of riskManagerResults) {
                    engagementRows.push({
                        wallet, category: 'risk_manager',
                        score: details.bestTrade ? Math.abs(details.bestTrade.roi) * 100 : 0,
                        details,
                    });
                }
                for (const [wallet, details] of humbleOneResults) {
                    engagementRows.push({
                        wallet, category: 'humble_one',
                        score: details.bestTrade ? details.bestTrade.roi * 100 : 0,
                        details,
                    });
                }

                await saveDailyCategoryScores(
                    tournamentId, seasonId, date, engagementRows,
                );
            }
        }

        // Award season points if applicable
        if (seasonId !== null) {
            await awardDailyFisherPoints(tournamentId, seasonId, date);
            await awardDailyAllAroundPoints(tournamentId, seasonId, date);
        }

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

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/:category -- Cumulative leaderboard
//
// SUM categories (daily additive): all_around, top_tick_traveler, bottom_fisher
// MAX categories (best single window): risk_manager, humble_one, leverage_master
//
// Deterministic ordering: score DESC, wallet ASC
// --------------------------------------------------------------------------
router.get('/:tournamentId/:category', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const category = req.params.category;

        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
            res.status(400).json({ success: false, error: `Invalid category: ${category}` });
            return;
        }

        const agg = SUM_CATEGORIES.has(category)
            ? sql<number>`SUM(${dailyCategoryScores.score})`
            : sql<number>`MAX(${dailyCategoryScores.score})`;

        const scores = await db
            .select({
                wallet: dailyCategoryScores.wallet,
                totalScore: agg.as('total_score'),
                daysScored: sql<number>`COUNT(*)`.as('days_scored'),
            })
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, category),
                ),
            )
            .groupBy(dailyCategoryScores.wallet)
            .orderBy(desc(sql`total_score`), asc(dailyCategoryScores.wallet));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error(`[Categories] Error getting ${req.params.category} leaderboard:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/categories/:tournamentId/:category/:date -- Single day scores
//
// Deterministic ordering: score DESC, wallet ASC
// --------------------------------------------------------------------------
router.get('/:tournamentId/:category/:date', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const category = req.params.category;
        const dateStr = req.params.date; // YYYY-MM-DD

        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
            res.status(400).json({ success: false, error: `Invalid category: ${category}` });
            return;
        }

        const scores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, category),
                    eq(dailyCategoryScores.scoreDate, dateStr),
                ),
            )
            .orderBy(desc(dailyCategoryScores.score), asc(dailyCategoryScores.wallet));

        res.json({ success: true, data: scores });
    } catch (error) {
        console.error(`[Categories] Error getting daily ${req.params.category} scores:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
