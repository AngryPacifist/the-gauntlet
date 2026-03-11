// ============================================================================
// Tournament Scheduler
//
// Uses node-cron to automate tournament operations:
//   1. Score refresh: every 15 minutes, compute scores for all active rounds
//   2. Round advancement: check if any active round's endTime has passed,
//      and if so, advance the tournament to the next round
//
// Updated to handle multiple active rounds per tournament (main + consolation).
// A tournament can have both a main active round and a consolation active round
// running simultaneously.
//
// Wired into the server lifecycle via start() and stop() functions.
// ============================================================================

import cron from 'node-cron';
import { db } from '../db/index.js';
import { tournaments, rounds } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { computeRoundScores, advanceRound } from './tournament-manager.js';

let scoreTask: cron.ScheduledTask | null = null;
let advanceTask: cron.ScheduledTask | null = null;

// --------------------------------------------------------------------------
// Score Refresh: runs every 15 minutes
//
// Finds ALL active rounds (main + consolation) and triggers score
// computation for each. A tournament can have 2 active rounds at once.
// --------------------------------------------------------------------------
async function refreshScores(): Promise<void> {
    try {
        // Find all active tournaments
        const activeTournaments = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.status, 'active'));

        if (activeTournaments.length === 0) return;

        for (const tournament of activeTournaments) {
            // Find ALL active rounds for this tournament (not just one)
            const activeRounds = await db
                .select()
                .from(rounds)
                .where(
                    and(
                        eq(rounds.tournamentId, tournament.id),
                        eq(rounds.status, 'active'),
                    ),
                );

            for (const activeRound of activeRounds) {
                const roundType = (activeRound.type ?? 'main') as string;
                console.log(
                    `[Scheduler] Refreshing scores for tournament ${tournament.id} ` +
                    `("${tournament.name}"), ${roundType} round ${activeRound.roundNumber}`,
                );

                const scoredCount = await computeRoundScores(activeRound.id);
                console.log(`[Scheduler] Scored ${scoredCount} entries`);
            }
        }
    } catch (error) {
        console.error('[Scheduler] Error refreshing scores:', error);
    }
}

// --------------------------------------------------------------------------
// Round Advancement: runs every minute
//
// Checks if any active round's endTime has passed. If so, triggers
// round advancement. Handles main and consolation rounds independently.
// --------------------------------------------------------------------------
async function checkRoundAdvancement(): Promise<void> {
    try {
        const activeTournaments = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.status, 'active'));

        if (activeTournaments.length === 0) return;

        const now = new Date();

        for (const tournament of activeTournaments) {
            // Get ALL active rounds (main + consolation)
            const activeRounds = await db
                .select()
                .from(rounds)
                .where(
                    and(
                        eq(rounds.tournamentId, tournament.id),
                        eq(rounds.status, 'active'),
                    ),
                );

            for (const activeRound of activeRounds) {
                // Check if round has ended
                if (new Date(activeRound.endTime) <= now) {
                    const roundType = (activeRound.type ?? 'main') as 'main' | 'consolation';
                    console.log(
                        `[Scheduler] ${roundType} round ${activeRound.roundNumber} of tournament ` +
                        `${tournament.id} ("${tournament.name}") has ended. ` +
                        `Computing final scores and advancing...`,
                    );

                    // Compute final scores before advancing
                    await computeRoundScores(activeRound.id);

                    // Advance to next round — pass the round type so main/consolation
                    // are handled independently
                    const result = await advanceRound(tournament.id, roundType);

                    if ('completed' in result) {
                        if (roundType === 'main') {
                            console.log(
                                `[Scheduler] Tournament ${tournament.id} completed!`,
                            );
                        } else {
                            console.log(
                                `[Scheduler] Consolation bracket for tournament ${tournament.id} completed!`,
                            );
                        }
                    } else {
                        console.log(
                            `[Scheduler] ${roundType} advanced to round ${result.nextRoundId}: ` +
                            `${result.advanced} advanced, ${result.eliminated} eliminated`,
                        );
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Scheduler] Error checking round advancement:', error);
    }
}

// --------------------------------------------------------------------------
// Start / Stop
// --------------------------------------------------------------------------

export function startScheduler(): void {
    // Score refresh: every 15 minutes (at :00, :15, :30, :45)
    scoreTask = cron.schedule('*/15 * * * *', refreshScores);

    // Round advancement check: every minute
    advanceTask = cron.schedule('* * * * *', checkRoundAdvancement);

    console.log('[Scheduler] Started — score refresh every 15 min, advancement check every 1 min');
}

export function stopScheduler(): void {
    if (scoreTask) {
        scoreTask.stop();
        scoreTask = null;
    }
    if (advanceTask) {
        advanceTask.stop();
        advanceTask = null;
    }
    console.log('[Scheduler] Stopped');
}
