// ============================================================================
// Mutagen R2 — public read API
//
//   GET /api/mutagen-leaderboard?view=current|cumulative&limit=N
//   GET /api/mutagen/wallet/:wallet     (score-on-demand with 1h cache)
//
// Thin transport over services/mutagen-read.ts. Public, read-only, no auth —
// mirrors the Forge leaderboard route. Mounted at /api in index.ts because the
// two routes have distinct prefixes (mutagen-leaderboard vs mutagen/wallet).
// ============================================================================

import { Router } from 'express';
import {
    getMutagenLeaderboard,
    getWalletMutagenScore,
    isValidWalletAddress,
    type LeaderboardView,
} from '../services/mutagen-read.js';

const router = Router();

router.get('/mutagen-leaderboard', async (req, res) => {
    try {
        const view: LeaderboardView = req.query.view === 'cumulative' ? 'cumulative' : 'current';
        const limitRaw = parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
        const data = await getMutagenLeaderboard({ view, limit });
        res.json({ success: true, view, data });
    } catch (error) {
        console.error('[API] mutagen-leaderboard error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

router.get('/mutagen/wallet/:wallet', async (req, res) => {
    const wallet = req.params.wallet;
    // Validate base58 before touching DB / RPC → clean 400.
    if (!isValidWalletAddress(wallet)) {
        res.status(400).json({ success: false, error: 'invalid wallet address' });
        return;
    }

    try {
        const result = await getWalletMutagenScore(wallet);
        if (result.state === 'no_active_sub_epoch') {
            res.status(404).json({ success: false, error: 'no active epoch / sub-epoch' });
            return;
        }
        if (result.state === 'in_progress') {
            // First-ever score for this wallet is computing under a lock; the
            // client should retry shortly (the on-demand model's "warming" state).
            res.status(202).json({ success: false, error: 'scoring in progress, retry shortly' });
            return;
        }
        res.json({ success: true, data: result.data });
    } catch (error) {
        console.error(`[API] mutagen wallet ${wallet} error:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
