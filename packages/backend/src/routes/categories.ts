// ============================================================================
// Daily Category API Routes
//
// GET /api/categories/:tournamentId/wallet/:wallet  -- Per-wallet quest breakdown
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
import { resolveConfig } from '../types.js';
import { createCache } from '../services/cache.js';

const router = Router();
const adrenaClient = new AdrenaClient();

// Phase 6 — TTL cache for wallet breakdown endpoint.
// Cache key = `${tournamentId}:${wallet}`. Backing data updates at 15-min scheduler
// cadence; 5-min TTL stays just under that.
interface WalletBreakdownData {
    wallet: string;
    tournamentId: number;
    totalQuestPoints: number;
    breakdown: Record<string, { totalScore: number; daysScored: number }>;
}
const walletBreakdownCache = createCache<WalletBreakdownData>();

// --------------------------------------------------------------------------
// Category validation
// --------------------------------------------------------------------------
// Phase 4 item 30: LM slugs are runtime-computed per-asset (leverage_master_${symbol}_${side}).
// VALID_NON_LM_CATEGORIES covers the 5 static slugs; LM is validated via prefix match.
const VALID_NON_LM_CATEGORIES = [
    'all_around', 'top_tick_traveler', 'bottom_fisher',
    'risk_manager', 'humble_one',
] as const;

// Legacy LM slugs (backward compat with pre-Phase-4 data) + new per-asset slugs both match.
const LM_SLUG_RE = /^leverage_master_([A-Z0-9_]+_)?(long|short)$/;

function isValidCategory(category: string): boolean {
    return (
        (VALID_NON_LM_CATEGORIES as readonly string[]).includes(category)
        || LM_SLUG_RE.test(category)
    );
}

// Categories that use SUM aggregation (daily additive scores)
const SUM_CATEGORIES = new Set(['all_around', 'top_tick_traveler', 'bottom_fisher']);

// Categories that use MAX aggregation (best single window score)
// risk_manager, humble_one, leverage_master_long, leverage_master_short

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

        // Phase 3: fetch tournament + resolve config (hoisted from below — needed for engine threading)
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

        // Phase 7.b: pass assetList so engine queries only the configured assets.
        const ohlcData = await fetchDailyOHLCBatch(date, config.assetList);

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
            const details = computeAllAroundScore(positions, date, config);
            allAroundRows.push({
                wallet, category: 'all_around',
                score: details.totalPoints, details,
            });
        }

        // Fisher split
        const fisherResults = computeFisherScores(walletPositions, date, ohlcData, config);
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

        const seasonId = tournament.seasonId ?? null;

        await saveDailyCategoryScores(
            tournamentId, seasonId, date,
            [...allAroundRows, ...topTickRows, ...bottomFisherRows],
        );

        // Phase 8.o: 2-day window scoring inputs. Always scores when tournament
        // has started (dayNumber >= 1). windowStart = requested date on odd days
        // (provisional), requested date - 1 on even days (authoritative). scoreDate
        // = windowStart so authoritative writes upsert provisional via shared key.
        const [firstRound] = await db
            .select({ startTime: rounds.startTime })
            .from(rounds)
            .where(and(
                eq(rounds.tournamentId, tournamentId),
                eq(rounds.type, 'main'),
            ))
            .orderBy(asc(rounds.startTime))
            .limit(1);

        if (firstRound) {
            const tradingStartDate = new Date(firstRound.startTime);
            tradingStartDate.setUTCHours(0, 0, 0, 0);
            const requestedDate = new Date(date + 'T00:00:00Z');
            const daysSinceStart = Math.floor(
                (requestedDate.getTime() - tradingStartDate.getTime()) / (24 * 60 * 60 * 1000),
            );
            const dayNumber = daysSinceStart + 1;

            if (dayNumber >= 1) {
                const windowStartDate = dayNumber % 2 === 0
                    ? new Date(requestedDate.getTime() - 24 * 60 * 60 * 1000)
                    : requestedDate;
                const windowStartStr = windowStartDate.toISOString().slice(0, 10);

                const riskManagerResults = computeRiskManagerScores(
                    walletPositions, windowStartStr, date, config,
                );
                const humbleOneResults = computeHumbleOneScores(
                    walletPositions, windowStartStr, date, config,
                );

                const engagementRows: CategoryScoreRow[] = [];
                for (const [wallet, details] of riskManagerResults) {
                    // Phase 4 item 11: inversion fix. Score = (1 - |roi|) × 100 (tightest controlled loss wins).
                    engagementRows.push({
                        wallet, category: 'risk_manager',
                        score: details.bestTrade
                            ? (1 - Math.abs(details.bestTrade.roi)) * 100
                            : 0,
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
                    tournamentId, seasonId, windowStartStr, engagementRows,
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
// GET /api/categories/:tournamentId/wallet/:wallet — All quest scores for one wallet
//
// Returns cumulative scores across all 7 categories for a single wallet.
// Used by The Forge expanded row "Quests Breakdown" panel.
//
// IMPORTANT: This route MUST be registered BEFORE /:tournamentId/:category
// otherwise Express will match "wallet" as a :category param.
// --------------------------------------------------------------------------
router.get('/:tournamentId/wallet/:wallet', async (req, res) => {
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

        // Phase 6: TTL cache check — 5-min default. Cold path is ~111 sequential DB
        // queries (11 aggregations + ~100 in computeQuestPoints), so cache hit is
        // the difference between 8-15s and ~0ms.
        const cacheKey = `${tournamentId}:${wallet}`;
        const cached = walletBreakdownCache.get(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached });
            return;
        }

        // Phase 4 item 30: LM slugs computed per-asset from config.assetList.
        // Hoist tournament fetch + config resolution — needed by both the categories array and computeQuestPoints below.
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

        const categories: string[] = ['all_around', 'top_tick_traveler', 'bottom_fisher', 'risk_manager', 'humble_one'];
        if (config.assetList?.length) {
            for (const a of config.assetList) {
                categories.push(`leverage_master_${a.symbol}_long`);
                categories.push(`leverage_master_${a.symbol}_short`);
            }
        } else {
            // Legacy fallback: pre-Phase-4 tournaments use the static 2-slug shape
            categories.push('leverage_master_long', 'leverage_master_short');
        }

        // Phase 6.g: collapse 11 per-category aggregations into one GROUP BY query.
        // Postgres computes SUM and MAX in the same row; we pick the right one in JS
        // via SUM_CATEGORIES.has(). Categories with no data don't appear in `aggRows`
        // → fall through to the default {0, 0}.
        const aggRows = await db
            .select({
                category: dailyCategoryScores.category,
                sumScore: sql<number>`SUM(${dailyCategoryScores.score})`.as('sum_score'),
                maxScore: sql<number>`MAX(${dailyCategoryScores.score})`.as('max_score'),
                daysScored: sql<number>`COUNT(*)`.as('days_scored'),
            })
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.wallet, wallet),
                ),
            )
            .groupBy(dailyCategoryScores.category);

        const breakdown: Record<string, { totalScore: number; daysScored: number }> = {};
        for (const category of categories) {
            const row = aggRows.find((r) => r.category === category);
            if (row) {
                const totalScore = SUM_CATEGORIES.has(category) ? row.sumScore : row.maxScore;
                breakdown[category] = {
                    totalScore: totalScore ?? 0,
                    daysScored: row.daysScored ?? 0,
                };
            } else {
                breakdown[category] = { totalScore: 0, daysScored: 0 };
            }
        }

        // Phase 4: tournament + config already fetched above — reuse locals.
        // Phase 6.g: switch to batched computeAllQuestPoints (1 SQL query) instead
        // of per-wallet computeQuestPoints (~89 queries). Same scoring semantics —
        // computeFinalScores already uses this batched path (final-score.ts:391).
        const { computeAllQuestPoints } = await import('../services/final-score.js');
        const allPoints = await computeAllQuestPoints(tournamentId, config);
        const totalQuestPoints = allPoints.get(wallet) ?? 0;

        const data: WalletBreakdownData = {
            wallet,
            tournamentId,
            totalQuestPoints,
            breakdown,
        };

        // Phase 6: write-through cache.
        walletBreakdownCache.set(cacheKey, data);

        res.json({ success: true, data });
    } catch (error) {
        console.error('[Categories] Error getting wallet breakdown:', error);
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

        if (!isValidCategory(category)) {
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

        if (!isValidCategory(category)) {
            res.status(400).json({ success: false, error: `Invalid category: ${category}` });
            return;
        }

        // Phase 8.o: 2-day categories store rows at windowStart (odd-day anchor).
        // Map any requested date inside a 2-day window to that window's windowStart
        // so the frontend's date picker behaves transparently across odd/even days.
        let lookupDate = dateStr;
        if (category === 'risk_manager' || category === 'humble_one') {
            const [firstRound] = await db
                .select({ startTime: rounds.startTime })
                .from(rounds)
                .where(and(
                    eq(rounds.tournamentId, tournamentId),
                    eq(rounds.type, 'main'),
                ))
                .orderBy(asc(rounds.startTime))
                .limit(1);
            if (firstRound) {
                const tradingStartDate = new Date(firstRound.startTime);
                tradingStartDate.setUTCHours(0, 0, 0, 0);
                const requestedDate = new Date(dateStr + 'T00:00:00Z');
                const daysSinceStart = Math.floor(
                    (requestedDate.getTime() - tradingStartDate.getTime()) / (24 * 60 * 60 * 1000),
                );
                const dayNumber = daysSinceStart + 1;
                if (dayNumber >= 2 && dayNumber % 2 === 0) {
                    const windowStartDate = new Date(requestedDate.getTime() - 24 * 60 * 60 * 1000);
                    lookupDate = windowStartDate.toISOString().slice(0, 10);
                }
            }
        }

        const scores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, category),
                    eq(dailyCategoryScores.scoreDate, lookupDate),
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
