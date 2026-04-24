// ============================================================================
// Quest API Routes (public)
//
// GET /api/quests/:tournamentId/:wallet  — Quest progress (badge grid data)
//   Optional query: ?week=N for specific week
// ============================================================================

import { Router } from 'express';
import { getQuestProgress } from '../services/quest-engine.js';

const router = Router();

// --------------------------------------------------------------------------
// GET /api/quests/:tournamentId/:wallet — Badge grid data
//
// Returns the wallet's Leverage Master quest progress for the current
// or specified week. Used by the frontend badge grid component.
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

        // Optional week query parameter
        const weekParam = req.query.week as string | undefined;
        const weekNumber = weekParam ? parseInt(weekParam, 10) : undefined;

        if (weekParam && (isNaN(weekNumber!) || weekNumber! < 1)) {
            res.status(400).json({ success: false, error: 'Invalid week number' });
            return;
        }

        const progress = await getQuestProgress(tournamentId, wallet, weekNumber);

        if (!progress) {
            // Phase 4 item 30: new shape is {byAsset: Record<symbol, {...}>, weekNumber}.
            // Empty byAsset = no progress yet (frontend handles empty state).
            res.json({
                success: true,
                data: {
                    byAsset: {},
                    weekNumber: weekNumber ?? 0,
                },
            });
            return;
        }

        res.json({ success: true, data: progress });
    } catch (error) {
        console.error('[Quests] Error getting quest progress:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
