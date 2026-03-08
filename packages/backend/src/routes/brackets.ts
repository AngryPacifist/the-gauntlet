// ============================================================================
// Brackets + Trader Profile API Routes
//
// GET /api/brackets/:id         — Get bracket details with entries
// GET /api/traders/:wallet      — Get trader profile across a tournament
// GET /api/leaderboard/:id      — Get leaderboard for a tournament
// ============================================================================

import { Router } from 'express';
import {
    getBracketDetails,
    getTraderProfile,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { rounds, brackets, bracketEntries } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

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
