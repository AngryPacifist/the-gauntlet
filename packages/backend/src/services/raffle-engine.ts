// ============================================================================
// Raffle Engine — Deterministic Weighted Raffle Draw System
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
import { raffleResults, raffleDraws } from '../db/schema.js';
import { computeFinalScores } from './final-score.js';
import { AdrenaClient } from './adrena-client.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const MIN_CLOSED_POSITIONS = 10;
const TOP_PERCENT_CUTOFF = 0.30;  // top 30% excluded from raffle
const CPI_TICKET_MULTIPLIER = 0.5;
const QUEST_TICKET_MULTIPLIER = 20;

// --------------------------------------------------------------------------
// Mulberry32 PRNG
//
// Deterministic 32-bit PRNG. Given the same seed, always produces the
// same sequence of floats in [0, 1).
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
): Promise<{ total: number; eligible: number; excluded: number }> {
    const adrenaClient = new AdrenaClient();

    // Step 1: Compute final scores for all wallets
    const finalScores = await computeFinalScores(tournamentId);

    if (finalScores.length === 0) {
        console.log(`[RaffleEngine] No final scores for tournament ${tournamentId}`);
        return { total: 0, eligible: 0, excluded: 0 };
    }

    // Step 2: Determine top 30% threshold using competition ranking
    // finalScores are already sorted by finalScore DESC, wallet ASC (deterministic)
    const topCutIndex = Math.ceil(finalScores.length * TOP_PERCENT_CUTOFF);

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

        const isTopPercent = rank <= topCutIndex;

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
            ? 0  // top 30% get skill prizes, no raffle tickets
            : Math.floor(fs.cpiScore * CPI_TICKET_MULTIPLIER) +
              Math.floor(fs.questPoints * QUEST_TICKET_MULTIPLIER);

        // Eligibility: ≥10 closed positions AND not top 30%
        const isEligible = closedPositionCount >= MIN_CLOSED_POSITIONS && !isTopPercent && ticketCount > 0;

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
    // Read eligible entries (not top 30%, ≥10 closed positions, tickets > 0)
    const eligible = await db
        .select({
            wallet: raffleResults.wallet,
            ticketCount: raffleResults.ticketCount,
        })
        .from(raffleResults)
        .where(and(
            eq(raffleResults.tournamentId, tournamentId),
            eq(raffleResults.isTopPercent, false),
            eq(raffleResults.isWinner, false),
        ))
        .orderBy(asc(raffleResults.wallet));

    // Filter to entries with actual tickets
    const pool = eligible.filter(e => e.ticketCount > 0);

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

    // Re-read the eligible pool as it existed at draw time
    // (raffle_results should not have changed since draw)
    const eligible = await db
        .select({
            wallet: raffleResults.wallet,
            ticketCount: raffleResults.ticketCount,
        })
        .from(raffleResults)
        .where(and(
            eq(raffleResults.tournamentId, tournamentId),
            eq(raffleResults.isTopPercent, false),
        ))
        .orderBy(asc(raffleResults.wallet));

    const pool = eligible.filter(e => e.ticketCount > 0);

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
