// ============================================================================
// Tournament API Routes
//
// POST   /api/tournaments             — Create a new tournament (admin-protected)
// GET    /api/tournaments             — List all tournaments
// GET    /api/tournaments/:id         — Get tournament state
// PUT    /api/tournaments/:id         — Update tournament (admin, registration only)
// DELETE /api/tournaments/:id         — Delete tournament (admin, full cascade)
// GET    /api/tournaments/:id/brackets — Get all brackets for active round
// ============================================================================

import { Router } from 'express';
import {
    createTournament,
    getTournamentState,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { tournaments, rounds, brackets, bracketEntries, registrations, scoreSnapshots, dailyCategoryScores } from '../db/schema.js';
import { eq, desc, inArray } from 'drizzle-orm';
import type { TournamentConfig } from '../types.js';

const router = Router();

// POST /api/tournaments — Create a new tournament (requires admin secret)
router.post('/', async (req, res) => {
    try {
        // Admin auth check
        const secret = req.headers['x-admin-secret'] as string;
        const expected = process.env.ADMIN_SECRET;

        if (expected && secret !== expected) {
            res.status(401).json({ success: false, error: 'Unauthorized — admin secret required' });
            return;
        }

        const { name, config } = req.body as {
            name: string;
            config?: Partial<TournamentConfig>;
        };

        if (!name || typeof name !== 'string') {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }

        const tournament = await createTournament(name, config);
        res.status(201).json({ success: true, data: tournament });
    } catch (error) {
        console.error('[API] Error creating tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/tournaments — List all tournaments
router.get('/', async (_req, res) => {
    try {
        const allTournaments = await db
            .select()
            .from(tournaments)
            .orderBy(desc(tournaments.createdAt));

        res.json({ success: true, data: allTournaments });
    } catch (error) {
        console.error('[API] Error listing tournaments:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/tournaments/:id — Get tournament state (with rounds, registration counts)
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const state = await getTournamentState(id);
        if (!state) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        res.json({ success: true, data: state });
    } catch (error) {
        console.error('[API] Error getting tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// PUT /api/tournaments/:id — Update tournament name/config (admin, registration status only)
router.put('/:id', async (req, res) => {
    try {
        const secret = req.headers['x-admin-secret'] as string;
        const expected = process.env.ADMIN_SECRET;

        if (expected && secret !== expected) {
            res.status(401).json({ success: false, error: 'Unauthorized — admin secret required' });
            return;
        }

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        // Verify tournament exists and is still in registration phase
        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, id))
            .limit(1);

        if (!tournament) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        if (tournament.status !== 'registration') {
            res.status(409).json({
                success: false,
                error: `Cannot edit tournament in "${tournament.status}" status. Only tournaments in "registration" status can be edited.`,
            });
            return;
        }

        const { name, config } = req.body as {
            name?: string;
            config?: Partial<TournamentConfig>;
        };

        if (!name && !config) {
            res.status(400).json({ success: false, error: 'Nothing to update. Provide name and/or config.' });
            return;
        }

        // Build update payload
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (name && typeof name === 'string') {
            updates.name = name;
        }
        if (config) {
            // Merge provided config overrides with existing config
            const existingConfig = tournament.config as TournamentConfig;
            updates.config = { ...existingConfig, ...config };
        }

        await db
            .update(tournaments)
            .set(updates)
            .where(eq(tournaments.id, id));

        // Fetch updated tournament
        const [updated] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, id))
            .limit(1);

        console.log(`[API] Updated tournament ${id}`);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[API] Error updating tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// DELETE /api/tournaments/:id — Delete tournament (admin, full cascade)
router.delete('/:id', async (req, res) => {
    try {
        const secret = req.headers['x-admin-secret'] as string;
        const expected = process.env.ADMIN_SECRET;

        if (expected && secret !== expected) {
            res.status(401).json({ success: false, error: 'Unauthorized — admin secret required' });
            return;
        }

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, id))
            .limit(1);

        if (!tournament) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        // Cascade delete in FK dependency order:
        // scoreSnapshots → bracketEntries → brackets → rounds → registrations → tournament

        // 1. Gather round IDs for this tournament
        const tournamentRounds = await db
            .select({ id: rounds.id })
            .from(rounds)
            .where(eq(rounds.tournamentId, id));
        const roundIds = tournamentRounds.map(r => r.id);

        if (roundIds.length > 0) {
            // 2. Gather bracket IDs for these rounds
            const tournamentBrackets = await db
                .select({ id: brackets.id })
                .from(brackets)
                .where(inArray(brackets.roundId, roundIds));
            const bracketIds = tournamentBrackets.map(b => b.id);

            if (bracketIds.length > 0) {
                // 3. Gather bracket entry IDs for these brackets
                const tournamentEntries = await db
                    .select({ id: bracketEntries.id })
                    .from(bracketEntries)
                    .where(inArray(bracketEntries.bracketId, bracketIds));
                const entryIds = tournamentEntries.map(e => e.id);

                // 4. Delete score snapshots (FK → bracketEntries)
                if (entryIds.length > 0) {
                    await db.delete(scoreSnapshots).where(inArray(scoreSnapshots.bracketEntryId, entryIds));
                }

                // 5. Delete bracket entries (FK → brackets)
                await db.delete(bracketEntries).where(inArray(bracketEntries.bracketId, bracketIds));
            }

            // 6. Delete brackets (FK → rounds)
            await db.delete(brackets).where(inArray(brackets.roundId, roundIds));

            // 7. Delete rounds (FK → tournaments)
            await db.delete(rounds).where(eq(rounds.tournamentId, id));
        }

        // 8. Delete registrations (FK → tournaments)
        await db.delete(registrations).where(eq(registrations.tournamentId, id));

        // 9. Delete daily category scores (FK → tournaments)
        await db.delete(dailyCategoryScores).where(eq(dailyCategoryScores.tournamentId, id));

        // 10. Delete trade cache entries (no FK, but tied to tournament context)
        // Note: tradeCache doesn't have a tournamentId column — it's wallet-scoped,
        // not tournament-scoped. Skipping to avoid deleting cache shared across tournaments.

        // 11. Delete the tournament
        await db.delete(tournaments).where(eq(tournaments.id, id));

        console.log(`[API] Deleted tournament ${id} ("${tournament.name}") — full cascade`);
        res.json({ success: true, data: { id, name: tournament.name, deleted: true } });
    } catch (error) {
        console.error('[API] Error deleting tournament:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/tournaments/:id/brackets — Get brackets for a round (defaults to most recent)
router.get('/:id/brackets', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const roundIdParam = req.query.roundId ? parseInt(req.query.roundId as string, 10) : null;

        let round;
        if (roundIdParam && !isNaN(roundIdParam)) {
            // Fetch specific round
            const [specificRound] = await db
                .select()
                .from(rounds)
                .where(eq(rounds.id, roundIdParam))
                .limit(1);
            round = specificRound || null;
        } else {
            // Default: most recent round
            const roundRows = await db
                .select()
                .from(rounds)
                .where(eq(rounds.tournamentId, tournamentId))
                .orderBy(desc(rounds.roundNumber))
                .limit(1);
            round = roundRows[0] || null;
        }

        if (!round) {
            res.json({ success: true, data: { round: null, brackets: [] } });
            return;
        }
        const roundBrackets = await db
            .select()
            .from(brackets)
            .where(eq(brackets.roundId, round.id));

        // Get entries for each bracket
        const bracketsWithEntries = await Promise.all(
            roundBrackets.map(async (bracket) => {
                const entries = await db
                    .select()
                    .from(bracketEntries)
                    .where(eq(bracketEntries.bracketId, bracket.id));

                // Sort by CPI descending
                entries.sort((a, b) => b.cpiScore - a.cpiScore);

                return { ...bracket, entries };
            }),
        );

        res.json({
            success: true,
            data: { round, brackets: bracketsWithEntries },
        });
    } catch (error) {
        console.error('[API] Error getting brackets:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
