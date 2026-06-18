// ============================================================================
// Mutagen: public read API
//
//   GET /api/mutagen-leaderboard?view=current|cumulative&limit=N
//   GET /api/mutagen/wallet/:wallet     (score-on-demand with 1h cache)
//
// Thin transport over services/mutagen-read.ts. Public, read-only, no auth —
// mirrors the Forge leaderboard route. Mounted at /api in index.ts because the
// two routes have distinct prefixes (mutagen-leaderboard vs mutagen/wallet).
// ============================================================================

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
    getMutagenLeaderboard,
    getWalletMutagenScore,
    computeEpochCumulative,
    isValidWalletAddress,
    type LeaderboardView,
} from '../services/mutagen-read.js';
import { db } from '../db/index.js';
import { mutagenEpochs } from '../db/schema.js';
import type { EpochConfig } from '../services/mutagen-scorer-types.js';

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

// Geometric-decay extension of the rank curve (mirrors the Forge payouts logic):
// when K (paid wallets) exceeds the curve length, extend so every rank gets a weight.
function extendCurve(curve: number[], K: number): number[] {
    if (K <= curve.length) return curve;
    if (curve.length === 0) return [];
    const len = curve.length;
    const tail2 = curve[len - 1];
    const tail1 = len >= 2 ? curve[len - 2] : tail2 * 2;
    const ratio = Math.min(Math.max(tail1 > 0 ? tail2 / tail1 : 0.5, 0), 1);
    const ext = [...curve];
    while (ext.length < K) ext.push(Math.max(ext[ext.length - 1] * ratio, 1));
    return ext;
}

// GET /api/mutagen/epochs/:id/payouts
// Ranked payout list for an epoch, off the cumulative (ENDED-average) board, for
// external distribution tooling. Single-token; no raffle (Mutagen pays by rank).
// Amounts use prizePool.value (0 until funded) split by prizePool.prizesByRank
// (ties share). `complete` flips true once the epoch is completed and rows exist.
router.get('/mutagen/epochs/:id/payouts', async (req, res) => {
    try {
        const epochId = parseInt(req.params.id, 10);
        if (isNaN(epochId)) { res.status(400).json({ success: false, error: 'invalid epoch id' }); return; }
        const [epoch] = await db.select().from(mutagenEpochs).where(eq(mutagenEpochs.id, epochId)).limit(1);
        if (!epoch) { res.status(404).json({ success: false, error: 'epoch not found' }); return; }

        const config = epoch.config as EpochConfig;
        const pool = config.prizePool?.value ?? 0;
        const denomination = config.prizePool?.denominatedIn ?? 'ADX';
        const curve = config.prizePool?.prizesByRank ?? [];
        const board = await computeEpochCumulative(epochId, 5000);

        // Competition ranking (ties share a rank).
        const ranked: Array<{ wallet: string; rank: number; score: number }> = [];
        let prev = Number.POSITIVE_INFINITY;
        let rank = 0;
        for (let i = 0; i < board.length; i++) {
            const r = board[i];
            if (r.total_points !== prev) rank = i + 1;
            prev = r.total_points;
            ranked.push({ wallet: r.user_wallet, rank, score: r.total_points });
        }
        const K = ranked.length;
        const extended = extendCurve(curve, K);
        const totalWeight = extended.slice(0, K).reduce((a, b) => a + b, 0);
        const rankCounts = new Map<number, number>();
        for (const w of ranked) rankCounts.set(w.rank, (rankCounts.get(w.rank) ?? 0) + 1);
        const perRankShare = new Map<number, number>();
        for (const [rk, count] of rankCounts) {
            let s = 0;
            for (let i = 0; i < count; i++) s += extended[rk - 1 + i] ?? 0;
            perRankShare.set(rk, totalWeight > 0 ? (s / count) / totalWeight : 0);
        }
        const rows = ranked.map((w) => ({
            wallet: w.wallet,
            rank: w.rank,
            score: Math.round(w.score * 100) / 100,
            amount: Math.round((perRankShare.get(w.rank) ?? 0) * pool * 100) / 100,
        }));
        const complete = epoch.status === 'completed' && rows.length > 0;
        res.json({ success: true, data: { epochId, status: epoch.status, complete, denomination, pool, rows } });
    } catch (error) {
        console.error('[API] mutagen payouts error:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
});

export default router;
