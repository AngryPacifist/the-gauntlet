// ============================================================================
// Admin API Routes (protected by ADMIN_SECRET)
//
// POST /api/admin/start             — Start a tournament (close reg, create brackets)
// POST /api/admin/score/:roundId    — Trigger score computation for a round
// POST /api/admin/advance/:id       — Advance to next round (eliminate + promote)
// ============================================================================

import { Router } from 'express';
import {
    startTournament,
    computeRoundScores,
    advanceRound,
} from '../services/tournament-manager.js';

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

export default router;
