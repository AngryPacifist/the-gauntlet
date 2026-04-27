// ============================================================================
// Cumulative Leaderboard API — Phase 5 item 20
//
// GET /api/leaderboard — bundled cumulative payload (Tournament + Season + All-time)
//
// Public read-only. No auth. On-demand compute (D-20.4); Phase 6 will add caching.
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
