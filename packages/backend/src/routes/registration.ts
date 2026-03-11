// ============================================================================
// Registration API Routes
//
// POST /api/register   — Register a wallet for a tournament
// GET  /api/register/:tournamentId — Get all registrations for a tournament
//
// Updated: zero-barrier registration. No eligibility checks at registration
// time. Anyone with a valid Solana wallet can register.
// ============================================================================

import { Router } from 'express';
import { registerWallet } from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { registrations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

// POST /api/register — Register a wallet
router.post('/', async (req, res) => {
    try {
        const { tournamentId, wallet } = req.body as {
            tournamentId: number;
            wallet: string;
        };

        if (!tournamentId || !wallet) {
            res.status(400).json({
                success: false,
                error: 'tournamentId and wallet are required',
            });
            return;
        }

        // Basic wallet address validation (Solana addresses are 32-44 chars, base58)
        if (wallet.length < 32 || wallet.length > 44) {
            res.status(400).json({
                success: false,
                error: 'Invalid Solana wallet address',
            });
            return;
        }

        const result = await registerWallet(tournamentId, wallet);

        if (result.registered) {
            res.status(201).json({ success: true, data: result });
        } else {
            // Not registered (duplicate, wrong phase, etc.)
            res.status(200).json({ success: true, data: result });
        }
    } catch (error) {
        console.error('[API] Error registering wallet:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/register/:tournamentId — Get all registrations
router.get('/:tournamentId', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const regs = await db
            .select()
            .from(registrations)
            .where(eq(registrations.tournamentId, tournamentId));

        res.json({ success: true, data: regs });
    } catch (error) {
        console.error('[API] Error listing registrations:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
