// ============================================================================
// Brackets + Trader Profile + Analytics API Routes
//
// GET /api/brackets/:id                  — Get bracket details with entries
// GET /api/traders/:wallet               — Get trader profile across a tournament
// GET /api/brackets/analytics/:id        — Post-tournament aggregate analytics
// GET /api/leaderboard/:id               — Get leaderboard for a tournament
// ============================================================================

import { Router } from 'express';
import {
    getBracketDetails,
    getTraderProfile,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { tournaments, rounds, brackets, bracketEntries, registrations, seasons, dailyCategoryScores } from '../db/schema.js';
import { eq, desc, count, and } from 'drizzle-orm';

const router = Router();

// GET /api/brackets/:id — Get a single bracket with its entries
router.get('/:id', async (req, res) => {
    try {
        const bracketId = parseInt(req.params.id, 10);
        if (isNaN(bracketId)) {
            res.status(400).json({ success: false, error: 'Invalid bracket ID' });
            return;
        }

        const bracket = await getBracketDetails(bracketId);
        if (!bracket) {
            res.status(404).json({ success: false, error: 'Bracket not found' });
            return;
        }

        res.json({ success: true, data: bracket });
    } catch (error) {
        console.error('[API] Error getting bracket:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/traders/:wallet?tournamentId=X — Get trader profile
router.get('/traders/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const tournamentId = parseInt(req.query.tournamentId as string, 10);

        if (!wallet || isNaN(tournamentId)) {
            res.status(400).json({
                success: false,
                error: 'wallet param and tournamentId query param are required',
            });
            return;
        }

        const profile = await getTraderProfile(tournamentId, wallet);
        if (!profile) {
            res.status(404).json({ success: false, error: 'Trader not found in tournament' });
            return;
        }

        res.json({ success: true, data: profile });
    } catch (error) {
        console.error('[API] Error getting trader profile:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/brackets/analytics/:tournamentId — Post-tournament analytics
router.get('/analytics/:tournamentId', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        // Fetch tournament
        const [tournament_] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId));

        if (!tournament_) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        // Get registration count
        const [regCount] = await db
            .select({ value: count() })
            .from(registrations)
            .where(eq(registrations.tournamentId, tournamentId));

        // Get all rounds ordered by round number
        const allRounds = await db
            .select()
            .from(rounds)
            .where(eq(rounds.tournamentId, tournamentId))
            .orderBy(rounds.roundNumber);

        if (allRounds.length === 0) {
            res.json({
                success: true,
                data: {
                    tournament: {
                        id: tournament_.id,
                        name: tournament_.name as string,
                        status: tournament_.status,
                        totalRounds: 0,
                        totalTraders: 0,
                        totalRegistrations: regCount.value,
                    },
                    roundStats: [],
                    scoreDistribution: [],
                    componentInsights: null,
                    topPerformers: [],
                },
            });
            return;
        }

        // Collect all entries per round
        const roundStats: Array<{
            roundNumber: number;
            roundName: string;
            roundType: string;
            traderCount: number;
            eliminatedCount: number;
            advancedCount: number;
            avgCpi: number;
            minCpi: number;
            maxCpi: number;
            avgPnl: number;
            avgRisk: number;
            avgConsistency: number;
            avgActivity: number;
        }> = [];

        const allEntries: Array<{
            wallet: string;
            cpiScore: number;
            pnlScore: number;
            riskScore: number;
            consistencyScore: number;
            activityScore: number;
            eliminated: boolean;
            advanced: boolean;
            roundNumber: number;
            roundName: string;
        }> = [];

        const uniqueWallets = new Set<string>();

        for (const round of allRounds) {
            const roundBrackets = await db
                .select()
                .from(brackets)
                .where(eq(brackets.roundId, round.id));

            const roundEntries: typeof allEntries = [];

            for (const bracket of roundBrackets) {
                const entries = await db
                    .select()
                    .from(bracketEntries)
                    .where(eq(bracketEntries.bracketId, bracket.id));

                for (const entry of entries) {
                    uniqueWallets.add(entry.wallet);
                    roundEntries.push({
                        wallet: entry.wallet,
                        cpiScore: entry.cpiScore,
                        pnlScore: entry.pnlScore,
                        riskScore: entry.riskScore,
                        consistencyScore: entry.consistencyScore,
                        activityScore: entry.activityScore,
                        eliminated: entry.eliminated,
                        advanced: entry.advanced,
                        roundNumber: round.roundNumber,
                        roundName: round.name,
                    });
                }
            }

            allEntries.push(...roundEntries);

            // Only compute stats for scored entries (CPI > 0)
            const scoredEntries = roundEntries.filter(e => e.cpiScore > 0);

            if (scoredEntries.length > 0) {
                const cpis = scoredEntries.map(e => e.cpiScore);
                roundStats.push({
                    roundNumber: round.roundNumber,
                    roundName: round.name,
                    roundType: round.type,
                    traderCount: roundEntries.length,
                    eliminatedCount: roundEntries.filter(e => e.eliminated).length,
                    advancedCount: roundEntries.filter(e => e.advanced).length,
                    avgCpi: cpis.reduce((a, b) => a + b, 0) / cpis.length,
                    minCpi: Math.min(...cpis),
                    maxCpi: Math.max(...cpis),
                    avgPnl: scoredEntries.reduce((a, e) => a + e.pnlScore, 0) / scoredEntries.length,
                    avgRisk: scoredEntries.reduce((a, e) => a + e.riskScore, 0) / scoredEntries.length,
                    avgConsistency: scoredEntries.reduce((a, e) => a + e.consistencyScore, 0) / scoredEntries.length,
                    avgActivity: scoredEntries.reduce((a, e) => a + e.activityScore, 0) / scoredEntries.length,
                });
            } else {
                roundStats.push({
                    roundNumber: round.roundNumber,
                    roundName: round.name,
                    roundType: round.type,
                    traderCount: roundEntries.length,
                    eliminatedCount: 0,
                    advancedCount: 0,
                    avgCpi: 0,
                    minCpi: 0,
                    maxCpi: 0,
                    avgPnl: 0,
                    avgRisk: 0,
                    avgConsistency: 0,
                    avgActivity: 0,
                });
            }
        }

        // Score distribution — bucket all scored entries into 10-point ranges
        const scoredAll = allEntries.filter(e => e.cpiScore > 0);
        const buckets = Array.from({ length: 10 }, (_, i) => ({
            bucket: `${i * 10}-${(i + 1) * 10}`,
            count: 0,
        }));
        for (const entry of scoredAll) {
            const idx = Math.min(Math.floor(entry.cpiScore / 10), 9);
            buckets[idx].count++;
        }

        // Component insights — advanced vs eliminated averages
        const advancedEntries = scoredAll.filter(e => e.advanced);
        const eliminatedEntries = scoredAll.filter(e => e.eliminated);

        const avg = (arr: typeof scoredAll, key: 'pnlScore' | 'riskScore' | 'consistencyScore' | 'activityScore') =>
            arr.length > 0 ? arr.reduce((a, e) => a + e[key], 0) / arr.length : 0;

        const componentInsights = scoredAll.length > 0 ? {
            advancedAvg: {
                pnl: avg(advancedEntries, 'pnlScore'),
                risk: avg(advancedEntries, 'riskScore'),
                consistency: avg(advancedEntries, 'consistencyScore'),
                activity: avg(advancedEntries, 'activityScore'),
            },
            eliminatedAvg: {
                pnl: avg(eliminatedEntries, 'pnlScore'),
                risk: avg(eliminatedEntries, 'riskScore'),
                consistency: avg(eliminatedEntries, 'consistencyScore'),
                activity: avg(eliminatedEntries, 'activityScore'),
            },
        } : null;

        // Top 5 performers by single-round CPI
        const topPerformers = [...scoredAll]
            .sort((a, b) => b.cpiScore - a.cpiScore)
            .slice(0, 5)
            .map(e => ({
                wallet: e.wallet,
                cpiScore: e.cpiScore,
                roundNumber: e.roundNumber,
                roundName: e.roundName,
            }));

        // Season context
        let seasonContext: { id: number; name: string; weekNumber: number; currentWeek: number; status: string } | null = null;
        if (tournament_.seasonId) {
            const [season] = await db
                .select()
                .from(seasons)
                .where(eq(seasons.id, tournament_.seasonId))
                .limit(1);
            if (season) {
                seasonContext = {
                    id: season.id,
                    name: season.name,
                    weekNumber: tournament_.weekNumber ?? 0,
                    currentWeek: season.currentWeek,
                    status: season.status,
                };
            }
        }

        // Daily category top performers
        const categoryData: {
            allAround: Array<{ wallet: string; score: number; scoreDate: string }>;
            fisher: Array<{ wallet: string; score: number; scoreDate: string }>;
        } = { allAround: [], fisher: [] };

        const allAroundScores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'all_around'),
                ),
            )
            .orderBy(desc(dailyCategoryScores.score))
            .limit(5);

        categoryData.allAround = allAroundScores.map(s => ({
            wallet: s.wallet,
            score: s.score,
            scoreDate: String(s.scoreDate),
        }));

        const fisherScores = await db
            .select()
            .from(dailyCategoryScores)
            .where(
                and(
                    eq(dailyCategoryScores.tournamentId, tournamentId),
                    eq(dailyCategoryScores.category, 'fisher'),
                ),
            )
            .orderBy(desc(dailyCategoryScores.score))
            .limit(5);

        categoryData.fisher = fisherScores.map(s => ({
            wallet: s.wallet,
            score: s.score,
            scoreDate: String(s.scoreDate),
        }));

        res.json({
            success: true,
            data: {
                tournament: {
                    id: tournament_.id,
                    name: tournament_.name as string,
                    status: tournament_.status,
                    totalRounds: allRounds.length,
                    totalTraders: uniqueWallets.size,
                    totalRegistrations: regCount.value,
                    season: seasonContext,
                },
                roundStats,
                scoreDistribution: buckets,
                componentInsights,
                topPerformers,
                categoryData,
            },
        });
    } catch (error) {
        console.error('[API] Error getting analytics:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/leaderboard/:tournamentId — Overall leaderboard (all wallets, best CPI)
router.get('/leaderboard/:tournamentId', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        // Get the most recent round
        const roundRows = await db
            .select()
            .from(rounds)
            .where(eq(rounds.tournamentId, tournamentId))
            .orderBy(desc(rounds.roundNumber));

        if (roundRows.length === 0) {
            res.json({ success: true, data: { round: null, entries: [] } });
            return;
        }

        // Get entries across ALL rounds per wallet.
        // Strategy: for each wallet, show the best scored entry (non-zero CPI).
        // If a trader is in a later unscored round, use their previous round's scores
        // but keep the lastRound value from the latest round and current status.
        const walletScores = new Map<string, {
            wallet: string;
            cpiScore: number;
            pnlScore: number;
            riskScore: number;
            consistencyScore: number;
            activityScore: number;
            lastRound: number;
            eliminated: boolean;
            advanced: boolean;
        }>();

        // Process rounds in ascending order so later rounds override earlier ones
        const sortedRounds = [...roundRows].sort((a, b) => a.roundNumber - b.roundNumber);

        for (const round of sortedRounds) {
            const roundBrackets = await db
                .select()
                .from(brackets)
                .where(eq(brackets.roundId, round.id));

            for (const bracket of roundBrackets) {
                const entries = await db
                    .select()
                    .from(bracketEntries)
                    .where(eq(bracketEntries.bracketId, bracket.id));

                for (const entry of entries) {
                    const existing = walletScores.get(entry.wallet);
                    const entryIsScored = entry.cpiScore > 0;

                    if (!existing) {
                        // First time seeing this wallet
                        walletScores.set(entry.wallet, {
                            wallet: entry.wallet,
                            cpiScore: entry.cpiScore,
                            pnlScore: entry.pnlScore,
                            riskScore: entry.riskScore,
                            consistencyScore: entry.consistencyScore,
                            activityScore: entry.activityScore,
                            lastRound: round.roundNumber,
                            eliminated: entry.eliminated,
                            advanced: entry.advanced,
                        });
                    } else if (entryIsScored) {
                        // This entry has real scores — use them (later round wins)
                        walletScores.set(entry.wallet, {
                            wallet: entry.wallet,
                            cpiScore: entry.cpiScore,
                            pnlScore: entry.pnlScore,
                            riskScore: entry.riskScore,
                            consistencyScore: entry.consistencyScore,
                            activityScore: entry.activityScore,
                            lastRound: round.roundNumber,
                            eliminated: entry.eliminated,
                            advanced: entry.advanced,
                        });
                    } else {
                        // Unscored entry in a later round — keep existing scores
                        // but update the lastRound and status to reflect current position
                        walletScores.set(entry.wallet, {
                            ...existing,
                            lastRound: round.roundNumber,
                            eliminated: entry.eliminated,
                            advanced: entry.advanced,
                        });
                    }
                }
            }
        }

        // Sort by: still in competition first, then by CPI score
        const leaderboard = Array.from(walletScores.values()).sort((a, b) => {
            // Active traders first, then eliminated
            if (!a.eliminated && b.eliminated) return -1;
            if (a.eliminated && !b.eliminated) return 1;
            // Within same status, sort by last round (higher = survived longer)
            if (a.lastRound !== b.lastRound) return b.lastRound - a.lastRound;
            // Within same round, sort by CPI
            return b.cpiScore - a.cpiScore;
        });

        res.json({
            success: true,
            data: {
                totalRounds: roundRows.length,
                entries: leaderboard,
            },
        });
    } catch (error) {
        console.error('[API] Error getting leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
