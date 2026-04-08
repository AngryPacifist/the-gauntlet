// ============================================================================
// Admin API Routes (protected by ADMIN_SECRET)
//
// POST /api/admin/start             — Start a tournament (close reg, create brackets)
// POST /api/admin/score/:roundId    — Trigger score computation for a round
// POST /api/admin/advance           — Advance to next round (eliminate + promote)
// POST /api/admin/cancel/:id        — Cancel a tournament
// POST /api/admin/raffle/:id/compute — Compute raffle tickets for a tournament
// POST /api/admin/raffle/:id/draw   — Execute deterministic raffle draw
// POST /api/admin/raffle/:id/reset  — Reset raffle draw (clear winners + audit trail)
// ============================================================================

import { Router } from 'express';
import {
    startTournament,
    computeRoundScores,
    advanceRound,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { tournaments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
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
        const { tournamentId } = req.body as { tournamentId: number };

        if (!tournamentId) {
            res.status(400).json({ success: false, error: 'tournamentId is required' });
            return;
        }

        const result = await advanceRound(tournamentId);
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

export default router;
