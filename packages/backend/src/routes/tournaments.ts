// ============================================================================
// Tournament API Routes
//
// POST   /api/tournaments              — Create a new tournament (admin-protected)
// GET    /api/tournaments              — List all tournaments
// GET    /api/tournaments/:id          — Get tournament state
// PUT    /api/tournaments/:id          — Update tournament (admin, registration only)
// DELETE /api/tournaments/:id          — Delete tournament (admin, full cascade)
// GET    /api/tournaments/:id/brackets — Get all brackets for active round
// GET    /api/tournaments/:id/forge    — The Forge merged leaderboard
// GET    /api/tournaments/:id/payouts  — Final payout list (skill + raffle), for external distribution systems (e.g. MrRewards)
// ============================================================================

import { Router } from 'express';
import {
    createTournament,
    getTournamentState,
} from '../services/tournament-manager.js';
import { db } from '../db/index.js';
import { tournaments, rounds, brackets, bracketEntries, registrations, scoreSnapshots, dailyCategoryScores, raffleResults, raffleDraws } from '../db/schema.js';
import { eq, desc, asc, and, inArray } from 'drizzle-orm';
import { resolveConfig, type TournamentConfig } from '../types.js';

// Phase 8.q geometric-decay extension (mirrors FE prizesByRank in
// leaderboard/[id]/page.tsx). When K (top% wallet count) exceeds the
// configured skillPrizes.length, extend the curve so every slot pays out.
function extendSkillPrizes(skillPrizes: number[], K: number): number[] {
    if (K <= skillPrizes.length) return skillPrizes;
    if (skillPrizes.length === 0) return [];
    const len = skillPrizes.length;
    const tail2 = skillPrizes[len - 1];
    const tail1 = len >= 2 ? skillPrizes[len - 2] : tail2 * 2;
    const rawRatio = tail1 > 0 ? tail2 / tail1 : 0.5;
    const decayRatio = Math.min(Math.max(rawRatio, 0), 1);
    const extended = [...skillPrizes];
    while (extended.length < K) {
        const next = extended[extended.length - 1] * decayRatio;
        extended.push(Math.max(next, 1));
    }
    return extended;
}

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
// --------------------------------------------------------------------------
// GET /api/tournaments/:id/forge — The Forge merged leaderboard (CPI + quests + raffle)
//
// Returns all participants with CPI sub-scores, quest points, raffle tickets,
// and top 30% status. Powers "The Forge" competition page.
// --------------------------------------------------------------------------
router.get('/:id/forge', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        // Verify tournament exists
        const [tournament] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId))
            .limit(1);

        if (!tournament) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        const { resolveConfig } = await import('../types.js');
        const { computeFinalScores } = await import('../services/final-score.js');
        const config = resolveConfig(tournament.config);
        const results = await computeFinalScores(tournamentId, config);

        // Compute top-% threshold (item 26 — was inline `* 0.3`; now config-driven)
        const top30Index = Math.ceil(results.length * config.topPercentCutoff);

        // Tie-aware competition ranking: tied wallets share the same rank
        let currentRank = 1;
        const entries = results.map((r, i) => {
            if (i > 0 && r.finalScore !== results[i - 1].finalScore) {
                currentRank = i + 1;
            }
            return {
                rank: currentRank,
                wallet: r.wallet,
                cpiScore: r.cpiScore,
                pnlScore: r.pnlScore,
                riskScore: r.riskScore,
                consistencyScore: r.consistencyScore,
                activityScore: r.activityScore,
                questPoints: r.questPoints,
                finalScore: r.finalScore,
                raffleTickets: r.raffleTickets,
                // Phase 8.m: gate TOP 30% on positive finalScore. Prevents
                // the "all 15 wallets labeled TOP 30%" symptom when many
                // wallets tie at finalScore=0 and rank <= cutoff. ZeDef T1
                // day-1 observation Day 42.
                isTopPercent: currentRank <= top30Index && r.finalScore > 0,
            };
        });

        res.json({
            success: true,
            data: {
                tournament: {
                    id: tournament.id,
                    name: tournament.name,
                    status: tournament.status,
                    config: tournament.config as TournamentConfig,
                },
                totalParticipants: results.length,
                top30Cutoff: top30Index,
                entries,
            },
        });
    } catch (error) {
        console.error('[API] Error getting forge leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

// GET /api/tournaments/:id/payouts
// Returns the final payout list for a tournament — skill prizes + raffle
// winners with their ADX amounts. Designed for external distribution
// systems (e.g., MrRewards / Adrena Prize Distribution worker) to ingest
// the determinate result post-tournament.
//
// Data is computed on-demand from raffle_results (skill rank order by
// finalScore DESC) + raffle_draws latest row (raffle winner array order).
// Pro-rata scale via Phase 8.q extension when K > skillPrizes.length.
//
// Response includes `complete: boolean` — true only when tournament status
// is 'completed' AND payout rows exist. Clients can poll this and act
// when complete flips to true.
router.get('/:id/payouts', async (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        if (isNaN(tournamentId)) {
            res.status(400).json({ success: false, error: 'Invalid tournament ID' });
            return;
        }

        const [t] = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, tournamentId))
            .limit(1);
        if (!t) {
            res.status(404).json({ success: false, error: 'Tournament not found' });
            return;
        }

        const config = resolveConfig(t.config);
        const prizeTable = config.prizeTable;
        if (!prizeTable) {
            res.json({
                success: true,
                data: {
                    tournamentId,
                    status: t.status,
                    complete: false,
                    reason: 'no prize table configured',
                    rows: [],
                },
            });
            return;
        }

        const skillPrizes = prizeTable.skillPrizes;
        const rafflePrizes = prizeTable.rafflePrizes;

        // Top% wallets ranked by finalScore DESC, wallet ASC (mirrors raffle-engine).
        const topPercentRows = await db
            .select()
            .from(raffleResults)
            .where(and(
                eq(raffleResults.tournamentId, tournamentId),
                eq(raffleResults.isTopPercent, true),
            ))
            .orderBy(desc(raffleResults.finalScore), asc(raffleResults.wallet));

        const K = topPercentRows.length;
        const extendedSkill = extendSkillPrizes(skillPrizes, K);
        const totalSkillPool = skillPrizes.reduce((a, b) => a + b, 0);
        const usedWeights = extendedSkill.slice(0, K).reduce((a, b) => a + b, 0);
        const proRataScale = usedWeights > 0 ? totalSkillPool / usedWeights : 1;

        type PayoutRow = {
            wallet: string;
            amountADX: number;
            category: 'skill' | 'raffle';
            rank: number | null;
            drawPosition: number | null;
        };
        const rows: PayoutRow[] = [];

        // Competition ranking — wallets tied at the same finalScore share a rank.
        let prevScore = Number.POSITIVE_INFINITY;
        let currentRank = 0;
        for (let i = 0; i < topPercentRows.length; i++) {
            const r = topPercentRows[i];
            if (r.finalScore !== prevScore) currentRank = i + 1;
            prevScore = r.finalScore;
            const slotADX = extendedSkill[currentRank - 1] ?? 0;
            const finalADX = Math.round(slotADX * proRataScale);
            rows.push({
                wallet: r.wallet,
                amountADX: finalADX,
                category: 'skill',
                rank: currentRank,
                drawPosition: null,
            });
        }

        // Raffle: latest draw row for this tournament
        const [draw] = await db
            .select()
            .from(raffleDraws)
            .where(eq(raffleDraws.tournamentId, tournamentId))
            .orderBy(desc(raffleDraws.drawnAt))
            .limit(1);

        let raffleDrawInfo: {
            id: number;
            blockHash: string;
            drawnAt: Date;
        } | null = null;
        if (draw) {
            const winners = draw.winners as string[];
            for (let i = 0; i < winners.length; i++) {
                rows.push({
                    wallet: winners[i],
                    amountADX: rafflePrizes[i] ?? 0,
                    category: 'raffle',
                    rank: null,
                    drawPosition: i + 1,
                });
            }
            raffleDrawInfo = {
                id: draw.id,
                blockHash: draw.blockHash,
                drawnAt: draw.drawnAt,
            };
        }

        const totalPayout = rows.reduce((a, r) => a + r.amountADX, 0);
        const complete = t.status === 'completed' && rows.length > 0;

        res.json({
            success: true,
            data: {
                tournamentId,
                status: t.status,
                complete,
                prizeTable: {
                    totalPool: prizeTable.totalPool,
                    skillPrizes,
                    rafflePrizes,
                    currency: prizeTable.currency,
                },
                raffleDraw: raffleDrawInfo,
                proRataScale,
                totalPayout,
                rows,
            },
        });
    } catch (error) {
        console.error('[API] Error getting tournament payouts:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
