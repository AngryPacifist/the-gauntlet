// ============================================================================
// Raffle Engine: Deterministic Weighted Raffle Draw System
//
// Eligibility: ≥10 closed positions, not in top 30% by final score.
// Tickets:     floor(CPI × 0.5) + floor(questPoints × 20)
// Draw:        Mulberry32 PRNG seeded by future block hash, weighted
//              selection without replacement. Pool sorted by wallet ASC
//              before drawing to ensure determinism.
//
// Audit trail: raffle_draws table stores block hash, seed, and winners
//              for full deterministic replay via verifyDraw().
// ============================================================================

import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { raffleResults, raffleDraws, tournaments } from '../db/schema.js';
import { computeFinalScores } from './final-score.js';
import { AdrenaClient } from './adrena-client.js';
import type { TournamentConfig } from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG, resolveConfig } from '../types.js';

// --------------------------------------------------------------------------
// Config-driven knobs (all reads use `config.<field> ?? DEFAULT_TOURNAMENT_CONFIG.<field>`):
//   - raffleMinClosedPositions (default 10): eligibility threshold
//   - topPercentCutoff (default 0.30): top-% excluded from raffle. Also
//     consumed by the /forge endpoint in routes/tournaments.ts for top-cutoff
//     gating.
//   - cpiTicketMultiplier (default 0.5)
//   - questTicketMultiplier (default 20)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Mulberry32 PRNG
//
// Deterministic 32-bit PRNG. Given the same seed, always produces the
// same sequence of floats in [0, 1).
//
// --------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --------------------------------------------------------------------------
// Weighted Draw — Without Replacement
//
// CRITICAL: pool MUST be sorted by wallet ASC before the draw loop.
// Without this sort, two runs with the same block hash could produce
// different winners depending on database query order.
// --------------------------------------------------------------------------

function weightedDraw(
    entries: { wallet: string; tickets: number }[],
    count: number,
    rng: () => number,
): string[] {
    // Sort pool deterministically before drawing
    const pool = [...entries].sort((a, b) => a.wallet.localeCompare(b.wallet));
    const selected: string[] = [];

    for (let i = 0; i < count && pool.length > 0; i++) {
        const totalWeight = pool.reduce((sum, e) => sum + e.tickets, 0);
        if (totalWeight <= 0) break;

        let target = rng() * totalWeight;

        for (let j = 0; j < pool.length; j++) {
            target -= pool[j].tickets;
            if (target <= 0) {
                selected.push(pool[j].wallet);
                pool.splice(j, 1);
                break;
            }
        }
    }

    return selected;
}

// --------------------------------------------------------------------------
// Compute All Tickets
//
// For each wallet in the tournament:
// 1. Compute final scores (CPI + quest points) via final-score.ts
// 2. Fetch closed position count from Adrena API
// 3. Determine top 30% by competition ranking on final score
// 4. Compute tickets: floor(CPI × 0.5) + floor(questPoints × 20)
// 5. Upsert to raffle_results
// --------------------------------------------------------------------------

export async function computeAllTickets(
    tournamentId: number,
    config: TournamentConfig,
): Promise<{ total: number; eligible: number; excluded: number }> {
    const adrenaClient = new AdrenaClient();

    // Phase 3 items 17 + 26: read constants from config (was module-level TOP_PERCENT_CUTOFF,
    // MIN_CLOSED_POSITIONS, CPI_TICKET_MULTIPLIER, QUEST_TICKET_MULTIPLIER).
    const cutoff = config.topPercentCutoff ?? DEFAULT_TOURNAMENT_CONFIG.topPercentCutoff;
    const minClosed = config.raffleMinClosedPositions ?? DEFAULT_TOURNAMENT_CONFIG.raffleMinClosedPositions;
    const cpiMult = config.cpiTicketMultiplier ?? DEFAULT_TOURNAMENT_CONFIG.cpiTicketMultiplier;
    const questMult = config.questTicketMultiplier ?? DEFAULT_TOURNAMENT_CONFIG.questTicketMultiplier;

    // Step 1: Compute final scores for all wallets
    const finalScores = await computeFinalScores(tournamentId, config);

    if (finalScores.length === 0) {
        console.log(`[RaffleEngine] No final scores for tournament ${tournamentId}`);
        return { total: 0, eligible: 0, excluded: 0 };
    }

    // Step 2: Determine top-% threshold using competition ranking
    // finalScores are already sorted by finalScore DESC, wallet ASC (deterministic)
    const topCutIndex = Math.ceil(finalScores.length * cutoff);

    // Step 3: For each wallet, compute ticket count and eligibility
    let eligibleCount = 0;
    let excludedCount = 0;

    for (let i = 0; i < finalScores.length; i++) {
        const fs = finalScores[i];

        // Competition ranking: find first wallet with same score
        let rank = i + 1;
        for (let j = 0; j < i; j++) {
            if (finalScores[j].finalScore === fs.finalScore) {
                rank = j + 1;
                break;
            }
        }

        // Phase 8.m: gate TOP 30% on positive finalScore. Mirrors the guard
        // in routes/tournaments.ts:/forge so persisted raffle_results stays
        // consistent with the rendered leaderboard.
        const isTopPercent = rank <= topCutIndex && fs.finalScore > 0;

        // Fetch closed position count from Adrena API
        let closedPositionCount = 0;
        try {
            const positions = await adrenaClient.getPositions(fs.wallet);
            closedPositionCount = positions.filter(p => p.status !== 'open').length;
        } catch (err) {
            console.error(`[RaffleEngine] Failed to fetch positions for ${fs.wallet}:`, err);
        }

        // Compute tickets
        const ticketCount = isTopPercent
            ? 0  // top-% get skill prizes, no raffle tickets
            : Math.floor(fs.cpiScore * cpiMult) +
              Math.floor(fs.questPoints * questMult);

        // Eligibility: ≥ minClosed closed positions AND not top-%
        const isEligible = closedPositionCount >= minClosed && !isTopPercent && ticketCount > 0;

        if (isEligible) eligibleCount++;
        if (isTopPercent) excludedCount++;

        // Upsert to raffle_results
        const values = {
            tournamentId,
            wallet: fs.wallet,
            finalScore: fs.finalScore,
            cpiScore: fs.cpiScore,
            questPoints: fs.questPoints,
            closedPositionCount,
            isTopPercent,
            ticketCount,
            isWinner: false,
        };

        // Try insert, update on conflict
        await db.insert(raffleResults)
            .values(values)
            .onConflictDoUpdate({
                target: [raffleResults.tournamentId, raffleResults.wallet],
                set: {
                    finalScore: fs.finalScore,
                    cpiScore: fs.cpiScore,
                    questPoints: fs.questPoints,
                    closedPositionCount,
                    isTopPercent,
                    ticketCount,
                },
            });
    }

    console.log(
        `[RaffleEngine] Computed tickets for ${finalScores.length} wallets: ` +
        `${eligibleCount} eligible, ${excludedCount} top 30% excluded`,
    );

    return { total: finalScores.length, eligible: eligibleCount, excluded: excludedCount };
}

// --------------------------------------------------------------------------
// Execute Deterministic Draw
//
// 1. Reads eligible entries from raffle_results
// 2. Sorts by wallet ASC (determinism)
// 3. Seeds Mulberry32 with first 8 hex chars of block hash
// 4. Weighted random selection without replacement
// 5. Updates raffle_results.isWinner for winners
// 6. Saves audit trail to raffle_draws
// --------------------------------------------------------------------------

export async function executeDeterministicDraw(
    tournamentId: number,
    blockHash: string,
    prizeCount: number,
): Promise<{ winners: string[]; seed: number }> {
    // Enforce one draw per tournament — provable fairness requires a single result
    const [existingDraw] = await db
        .select({ id: raffleDraws.id })
        .from(raffleDraws)
        .where(eq(raffleDraws.tournamentId, tournamentId))
        .limit(1);

    if (existingDraw) {
        throw new Error(
            `A raffle draw already exists for tournament ${tournamentId} (draw #${existingDraw.id}). ` +
            `Each tournament may only be drawn once to preserve verifiability.`
        );
    }

    // Fetch tournament config for minClosedPositions threshold. Previously
    // only enforced at computeAllTickets time → "eligible" count displayed
    // by admin UI diverged from actual draw pool size. Engine docstring at
    // top of file claims "≥10 closed positions"; pool filter now matches.
    const [tournament] = await db
        .select({ config: tournaments.config })
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);
    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
    const config = resolveConfig(tournament.config);
    const minClosed = config.raffleMinClosedPositions
        ?? DEFAULT_TOURNAMENT_CONFIG.raffleMinClosedPositions;

    // Read eligible entries (not top 30%, tickets > 0, closedPos >= minClosed)
    const eligible = await db
        .select({
            wallet: raffleResults.wallet,
            ticketCount: raffleResults.ticketCount,
            closedPositionCount: raffleResults.closedPositionCount,
        })
        .from(raffleResults)
        .where(and(
            eq(raffleResults.tournamentId, tournamentId),
            eq(raffleResults.isTopPercent, false),
        ))
        .orderBy(asc(raffleResults.wallet));

    // Filter: tickets > 0 AND closedPos >= minClosed (matches computeAllTickets
    // "eligible" definition + engine docstring claim).
    const pool = eligible.filter(e =>
        e.ticketCount > 0 && e.closedPositionCount >= minClosed,
    );

    if (pool.length === 0) {
        console.log(`[RaffleEngine] No eligible entries for draw in tournament ${tournamentId}`);
        return { winners: [], seed: 0 };
    }

    // Seed from block hash (first 8 hex chars → 32-bit integer)
    const seed = parseInt(blockHash.slice(0, 8), 16);
    const rng = mulberry32(seed);

    // Execute weighted draw
    const drawPool = pool.map(e => ({ wallet: e.wallet, tickets: e.ticketCount }));
    const actualPrizeCount = Math.min(prizeCount, drawPool.length);
    const winners = weightedDraw(drawPool, actualPrizeCount, rng);

    // Update winners in raffle_results
    for (const wallet of winners) {
        await db.update(raffleResults)
            .set({ isWinner: true })
            .where(and(
                eq(raffleResults.tournamentId, tournamentId),
                eq(raffleResults.wallet, wallet),
            ));
    }

    // Save audit trail
    const totalTickets = pool.reduce((sum, e) => sum + e.ticketCount, 0);
    await db.insert(raffleDraws).values({
        tournamentId,
        blockHash,
        seed,
        eligibleCount: pool.length,
        totalTickets,
        winnerCount: winners.length,
        winners,
    });

    console.log(
        `[RaffleEngine] Draw complete for tournament ${tournamentId}: ` +
        `${winners.length} winners from ${pool.length} eligible (${totalTickets} total tickets)`,
    );

    return { winners, seed };
}

// --------------------------------------------------------------------------
// Verify Draw
//
// Re-runs the exact same algorithm with the stored block hash and compares
// results. Returns verification status and any mismatches.
// --------------------------------------------------------------------------

export async function verifyDraw(
    tournamentId: number,
): Promise<{ verified: boolean; mismatches: string[]; drawId: number | null }> {
    // Get the latest draw for this tournament
    const [draw] = await db
        .select()
        .from(raffleDraws)
        .where(eq(raffleDraws.tournamentId, tournamentId))
        .orderBy(desc(raffleDraws.drawnAt))
        .limit(1);

    if (!draw) {
        return { verified: false, mismatches: ['No draw found for this tournament'], drawId: null };
    }

    // Fetch tournament config for minClosedPositions threshold. Pool filter
    // must mirror executeDeterministicDraw exactly — otherwise replay uses a
    // wider pool than the live draw and verification fails deterministically.
    const [tournament] = await db
        .select({ config: tournaments.config })
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);
    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
    const config = resolveConfig(tournament.config);
    const minClosed = config.raffleMinClosedPositions
        ?? DEFAULT_TOURNAMENT_CONFIG.raffleMinClosedPositions;

    // Re-read the eligible pool as it existed at draw time
    // (raffle_results should not have changed since draw)
    const eligible = await db
        .select({
            wallet: raffleResults.wallet,
            ticketCount: raffleResults.ticketCount,
            closedPositionCount: raffleResults.closedPositionCount,
        })
        .from(raffleResults)
        .where(and(
            eq(raffleResults.tournamentId, tournamentId),
            eq(raffleResults.isTopPercent, false),
        ))
        .orderBy(asc(raffleResults.wallet));

    // Same tri-condition filter as executeDeterministicDraw
    const pool = eligible.filter(e =>
        e.ticketCount > 0 && e.closedPositionCount >= minClosed,
    );

    // Re-run the PRNG with the stored seed
    const rng = mulberry32(draw.seed);
    const drawPool = pool.map(e => ({ wallet: e.wallet, tickets: e.ticketCount }));
    const replayWinners = weightedDraw(drawPool, draw.winnerCount, rng);

    // Compare
    const storedWinners = draw.winners as string[];
    const mismatches: string[] = [];

    if (replayWinners.length !== storedWinners.length) {
        mismatches.push(
            `Winner count mismatch: stored ${storedWinners.length}, replayed ${replayWinners.length}`,
        );
    }

    for (let i = 0; i < Math.max(replayWinners.length, storedWinners.length); i++) {
        if (replayWinners[i] !== storedWinners[i]) {
            mismatches.push(
                `Position ${i + 1}: stored ${storedWinners[i] ?? '(none)'}, replayed ${replayWinners[i] ?? '(none)'}`,
            );
        }
    }

    const verified = mismatches.length === 0;

    console.log(
        `[RaffleEngine] Verification for tournament ${tournamentId}: ` +
        `${verified ? 'PASSED' : `FAILED (${mismatches.length} mismatches)`}`,
    );

    return { verified, mismatches, drawId: draw.id };
}

// --------------------------------------------------------------------------
// Reset Draw
//
// Clears all draw records and resets isWinner flags for a tournament.
// Use only if a draw was executed with incorrect parameters.
// --------------------------------------------------------------------------

export async function resetDraw(
    tournamentId: number,
): Promise<{ deletedDraws: number; resetWinners: number }> {
    // Delete all draw audit records
    const deleted = await db.delete(raffleDraws)
        .where(eq(raffleDraws.tournamentId, tournamentId))
        .returning({ id: raffleDraws.id });

    // Reset all isWinner flags back to false
    const reset = await db.update(raffleResults)
        .set({ isWinner: false })
        .where(and(
            eq(raffleResults.tournamentId, tournamentId),
            eq(raffleResults.isWinner, true),
        ))
        .returning({ wallet: raffleResults.wallet });

    console.log(
        `[RaffleEngine] Reset draw for tournament ${tournamentId}: ` +
        `${deleted.length} draw(s) deleted, ${reset.length} winner flag(s) cleared`,
    );

    return { deletedDraws: deleted.length, resetWinners: reset.length };
}
