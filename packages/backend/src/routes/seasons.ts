// ============================================================================
// Season API Routes
//
// Public:
//   GET /api/seasons              — List all seasons
//   GET /api/seasons/:id          — Get season details + tournaments
//   GET /api/seasons/:id/standings — Full standings leaderboard
//
// Admin (protected by x-admin-secret):
//   POST /api/seasons             — Create a season
//   POST /api/seasons/:id/start   — Start the season (creates Week 1)
//   POST /api/seasons/:id/advance — Advance to next week
//   POST /api/seasons/:id/complete — Complete the season (after Final)
// ============================================================================

import { Router } from 'express';
import { db } from '../db/index.js';
import { seasons } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import {
    createSeason,
    startSeason,
    advanceWeek,
    completeSeason,
    getSeasonStandings,
    getSeasonDetails,
} from '../services/season-manager.js';
import type { SeasonConfig } from '../types.js';

const router = Router();

// --------------------------------------------------------------------------
// Admin middleware for mutating routes
// --------------------------------------------------------------------------
function requireAdmin(req: any, res: any, next: any): void {
    const secret = req.headers['x-admin-secret'] as string;
    const expected = process.env.ADMIN_SECRET;

    if (!expected) {
        console.warn('[Seasons] ADMIN_SECRET not set — admin routes are unprotected');
        next();
        return;
    }

    if (secret !== expected) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
}

// --------------------------------------------------------------------------
// Public routes
// --------------------------------------------------------------------------

// GET /api/seasons — List all seasons
router.get('/', async (_req, res) => {
    try {
        const allSeasons = await db
            .select()
            .from(seasons)
            .orderBy(desc(seasons.createdAt));

        res.json({ success: true, data: allSeasons });
    } catch (error) {
        console.error('[Seasons] Error listing seasons:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/seasons/:id — Season details with tournaments
router.get('/:id', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.id, 10);
        if (isNaN(seasonId)) {
            res.status(400).json({ success: false, error: 'Invalid season ID' });
            return;
        }

        const season = await getSeasonDetails(seasonId);
        if (!season) {
            res.status(404).json({ success: false, error: 'Season not found' });
            return;
        }

        res.json({ success: true, data: season });
    } catch (error) {
        console.error('[Seasons] Error getting season:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/seasons/:id/standings — Season standings leaderboard
router.get('/:id/standings', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.id, 10);
        if (isNaN(seasonId)) {
            res.status(400).json({ success: false, error: 'Invalid season ID' });
            return;
        }

        const standings = await getSeasonStandings(seasonId);
        res.json({ success: true, data: standings });
    } catch (error) {
        console.error('[Seasons] Error getting standings:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// --------------------------------------------------------------------------
// Admin routes
// --------------------------------------------------------------------------

// POST /api/seasons — Create a season
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { name, config } = req.body as { name: string; config?: Partial<SeasonConfig> };

        if (!name) {
            res.status(400).json({ success: false, error: 'name is required' });
            return;
        }

        const result = await createSeason(name, config);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Seasons] Error creating season:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/seasons/:id/start — Start the season
router.post('/:id/start', requireAdmin, async (req, res) => {
    try {
        const seasonId = parseInt(req.params.id, 10);
        if (isNaN(seasonId)) {
            res.status(400).json({ success: false, error: 'Invalid season ID' });
            return;
        }

        const result = await startSeason(seasonId);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Seasons] Error starting season:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/seasons/:id/advance — Advance to next week
router.post('/:id/advance', requireAdmin, async (req, res) => {
    try {
        const seasonId = parseInt(req.params.id, 10);
        if (isNaN(seasonId)) {
            res.status(400).json({ success: false, error: 'Invalid season ID' });
            return;
        }

        const result = await advanceWeek(seasonId);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Seasons] Error advancing week:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// POST /api/seasons/:id/complete — Complete the season
router.post('/:id/complete', requireAdmin, async (req, res) => {
    try {
        const seasonId = parseInt(req.params.id, 10);
        if (isNaN(seasonId)) {
            res.status(400).json({ success: false, error: 'Invalid season ID' });
            return;
        }

        await completeSeason(seasonId);
        res.json({ success: true, data: { seasonId, status: 'completed' } });
    } catch (error) {
        console.error('[Seasons] Error completing season:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
