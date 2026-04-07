// ============================================================================
// Raffle API Routes (public)
//
// GET  /api/raffle/:tournamentId          → all raffle results for tournament
// GET  /api/raffle/:tournamentId/verify   → verify draw determinism
// GET  /api/raffle/:tournamentId/:wallet  → single wallet's raffle info
// ============================================================================

import { Router } from 'express';
import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { raffleResults } from '../db/schema.js';
import { verifyDraw } from '../services/raffle-engine.js';

const router = Router();

// --------------------------------------------------------------------------
// GET /api/raffle/:tournamentId — All raffle results
// --------------------------------------------------------------------------
router.get('/:tournamentId', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const results = await db
            .select()
            .from(raffleResults)
            .where(eq(raffleResults.tournamentId, tournamentId))
            .orderBy(desc(raffleResults.finalScore), asc(raffleResults.wallet));

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('[Raffle] Error getting results:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/raffle/:tournamentId/verify — Verify draw determinism
// --------------------------------------------------------------------------
router.get('/:tournamentId/verify', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const verification = await verifyDraw(tournamentId);
        res.json({ success: true, data: verification });
    } catch (error) {
        console.error('[Raffle] Error verifying draw:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// GET /api/raffle/:tournamentId/:wallet — Single wallet's raffle info
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

        const [result] = await db
            .select()
            .from(raffleResults)
            .where(and(
                eq(raffleResults.tournamentId, tournamentId),
                eq(raffleResults.wallet, wallet),
            ))
            .limit(1);

        if (!result) {
            res.status(404).json({ success: false, error: 'No raffle entry found for this wallet' });
            return;
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Raffle] Error getting wallet raffle info:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
