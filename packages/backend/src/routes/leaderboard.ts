// ============================================================================
// Cumulative Leaderboard API
//
// GET /api/leaderboard: bundled cumulative payload (Tournament + Season + All-time)
//
// Public read-only. No auth. Backed by a 5-min TTL cache at the service layer
// (cumulative-leaderboard.ts) so the route itself is a thin pass-through.
// ============================================================================

import { Router } from 'express';
import { computeCumulativeLeaderboard } from '../services/cumulative-leaderboard.js';

const router = Router();

router.get('/', async (_req, res) => {
    try {
        const data = await computeCumulativeLeaderboard();
        res.json({ success: true, data });
    } catch (error) {
        console.error('[API] Error computing cumulative leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
