// ============================================================================
// Tournament Manager
//
// Orchestrates the lifecycle of a Gauntlet tournament:
//   Registration → Bracket Creation → Round Progression → Elimination → Results
//
// Core operations:
//   1. createTournament: Initialize a new tournament with config
//   2. startTournament: Close registration, create Round 1 brackets
//   3. computeRoundScores: Score all traders in the current round
//   4. advanceRound: Eliminate bottom half, promote top half to next round
//   5. completeTournament: Finalize results
// ============================================================================

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    tournaments,
    rounds,
    brackets,
    bracketEntries,
    registrations,
    scoreSnapshots,
} from '../db/schema.js';
import { AdrenaClient } from './adrena-client.js';
import { computeCPI } from './scoring-engine.js';
import type {
    TournamentConfig,
    RoundName,
    CPIScores,
    AdrenaPosition,
} from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG, DEFAULT_CPI_WEIGHTS } from '../types.js';

const ROUND_NAMES: RoundName[] = ['First Blood', 'The Crucible', 'Sudden Death', 'Endgame'];

const adrenaClient = new AdrenaClient();

// --------------------------------------------------------------------------
// 1. Create a new tournament
// --------------------------------------------------------------------------
export async function createTournament(
    name: string,
    config: Partial<TournamentConfig> = {},
): Promise<{ id: number }> {
    const fullConfig: TournamentConfig = { ...DEFAULT_TOURNAMENT_CONFIG, ...config };

    const [tournament] = await db
        .insert(tournaments)
        .values({
            name,
            status: 'registration',
            config: fullConfig,
        })
        .returning({ id: tournaments.id });

    console.log(`[TournamentManager] Created tournament "${name}" (id: ${tournament.id})`);
    return tournament;
}

// --------------------------------------------------------------------------
// 2. Register a wallet for a tournament
//
// Checks eligibility: wallet must have >= minHistoricalTrades closed positions
// and must have traded within maxDaysInactive days.
// --------------------------------------------------------------------------
export async function registerWallet(
    tournamentId: number,
    wallet: string,
): Promise<{ eligible: boolean; reason?: string }> {
    // Check tournament exists and is in registration phase
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) {
        return { eligible: false, reason: 'Tournament not found' };
    }
    if (tournament.status !== 'registration') {
        return { eligible: false, reason: 'Tournament is not accepting registrations' };
    }

    // Check if already registered
    const [existing] = await db
        .select()
        .from(registrations)
        .where(
            and(
                eq(registrations.tournamentId, tournamentId),
                eq(registrations.wallet, wallet),
            ),
        )
        .limit(1);

    if (existing) {
        return { eligible: false, reason: 'Wallet already registered' };
    }

    // Check eligibility: fetch historical positions from Adrena
    const config = tournament.config as TournamentConfig;
    let positions: AdrenaPosition[];
    try {
        positions = await adrenaClient.getPositions(wallet);
    } catch (apiError) {
        // Adrena API may error for wallets that have never traded on the platform.
        // Treat this as "0 positions found" — the wallet is simply ineligible.
        console.warn(
            `[TournamentManager] Adrena API error for wallet ${wallet}:`,
            apiError instanceof Error ? apiError.message : apiError,
        );
        positions = [];
    }

    // Count closed positions
    const closedPositions = positions.filter(
        (p: AdrenaPosition) => p.status === 'close' || p.status === 'liquidate',
    );

    if (closedPositions.length < config.minHistoricalTrades) {
        // Register but mark as ineligible
        await db.insert(registrations).values({
            tournamentId,
            wallet,
            eligible: false,
        });
        return {
            eligible: false,
            reason: `Need at least ${config.minHistoricalTrades} closed trades. Found ${closedPositions.length}.`,
        };
    }

    // Check recency: most recent trade must be within maxDaysInactive days
    const mostRecentTradeDate = closedPositions.reduce((latest: Date, p: AdrenaPosition) => {
        const exitDate = p.exit_date ? new Date(p.exit_date) : new Date(p.entry_date);
        return exitDate > latest ? exitDate : latest;
    }, new Date(0));

    const daysSinceLastTrade = Math.floor(
        (Date.now() - mostRecentTradeDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceLastTrade > config.maxDaysInactive) {
        await db.insert(registrations).values({
            tournamentId,
            wallet,
            eligible: false,
        });
        return {
            eligible: false,
            reason: `Last trade was ${daysSinceLastTrade} days ago. Must be within ${config.maxDaysInactive} days.`,
        };
    }

    // Eligible! Register.
    await db.insert(registrations).values({
        tournamentId,
        wallet,
        eligible: true,
    });

    console.log(`[TournamentManager] Registered wallet ${wallet} for tournament ${tournamentId}`);
    return { eligible: true };
}

// --------------------------------------------------------------------------
// 3. Start the tournament: close registration, create Round 1 brackets
//
// Bracket creation algorithm:
//   1. Get all eligible registrations
//   2. Shuffle them randomly (Fisher-Yates)
//   3. Split into groups of bracketSize
//   4. If the last group has fewer than 2 traders, merge with previous group
// --------------------------------------------------------------------------
export async function startTournament(
    tournamentId: number,
): Promise<{ roundId: number; bracketCount: number }> {
    // Verify tournament is in registration phase
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) throw new Error('Tournament not found');
    if (tournament.status !== 'registration') {
        throw new Error(`Cannot start tournament in "${tournament.status}" status`);
    }

    const config = tournament.config as TournamentConfig;

    // Get all eligible registrations
    const eligibleRegs = await db
        .select()
        .from(registrations)
        .where(
            and(
                eq(registrations.tournamentId, tournamentId),
                eq(registrations.eligible, true),
            ),
        );

    if (eligibleRegs.length < 2) {
        throw new Error(`Need at least 2 eligible traders. Found ${eligibleRegs.length}.`);
    }

    // Shuffle wallets (Fisher-Yates)
    const wallets = eligibleRegs.map((r) => r.wallet);
    for (let i = wallets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wallets[i], wallets[j]] = [wallets[j], wallets[i]];
    }

    // Create Round 1
    const now = new Date();
    const roundEnd = new Date(now.getTime() + config.roundDurationHours * 60 * 60 * 1000);

    const [round] = await db
        .insert(rounds)
        .values({
            tournamentId,
            roundNumber: 1,
            name: ROUND_NAMES[0],
            startTime: now,
            endTime: roundEnd,
            status: 'active',
        })
        .returning({ id: rounds.id });

    // Split into brackets
    const bracketSize = config.bracketSize;
    const bracketGroups: string[][] = [];

    for (let i = 0; i < wallets.length; i += bracketSize) {
        bracketGroups.push(wallets.slice(i, i + bracketSize));
    }

    // If last group has fewer than 2 traders, merge with previous
    if (bracketGroups.length > 1 && bracketGroups[bracketGroups.length - 1].length < 2) {
        const lastGroup = bracketGroups.pop()!;
        bracketGroups[bracketGroups.length - 1].push(...lastGroup);
    }

    // Create bracket records and entries
    for (let i = 0; i < bracketGroups.length; i++) {
        const [bracket] = await db
            .insert(brackets)
            .values({
                roundId: round.id,
                bracketNumber: i + 1,
            })
            .returning({ id: brackets.id });

        for (const wallet of bracketGroups[i]) {
            await db.insert(bracketEntries).values({
                bracketId: bracket.id,
                wallet,
            });
        }
    }

    // Update tournament status
    await db
        .update(tournaments)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(tournaments.id, tournamentId));

    console.log(
        `[TournamentManager] Started tournament ${tournamentId}: ` +
        `Round 1 "${ROUND_NAMES[0]}" with ${bracketGroups.length} brackets, ` +
        `${wallets.length} traders`,
    );

    return { roundId: round.id, bracketCount: bracketGroups.length };
}

// --------------------------------------------------------------------------
// 4. Compute scores for all traders in a given round
//
// For each bracket entry:
//   1. Fetch positions from Adrena API
//   2. Filter to round window + apply competition rules
//   3. Compute CPI
//   4. Update bracket_entries with scores
//   5. Save score snapshot for audit trail
// --------------------------------------------------------------------------
export async function computeRoundScores(roundId: number): Promise<number> {
    // Get round details
    const [round] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1);

    if (!round) throw new Error('Round not found');

    // Get tournament config
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, round.tournamentId))
        .limit(1);

    if (!tournament) throw new Error('Tournament not found');
    const config = tournament.config as TournamentConfig;

    // Get all brackets in this round
    const roundBrackets = await db
        .select()
        .from(brackets)
        .where(eq(brackets.roundId, roundId));

    let scoredCount = 0;

    for (const bracket of roundBrackets) {
        // Get all entries in this bracket
        const entries = await db
            .select()
            .from(bracketEntries)
            .where(eq(bracketEntries.bracketId, bracket.id));

        for (const entry of entries) {
            try {
                // Fetch positions from Adrena API
                const allPositions = await adrenaClient.getPositions(entry.wallet);

                // Filter to round window (or historical window for backtest mode)
                let scoringStart: Date;
                let scoringEnd: Date;

                if (config.useHistoricalWindow) {
                    // Backtest mode: use a historical window instead of round dates
                    scoringEnd = new Date();
                    scoringStart = new Date(
                        scoringEnd.getTime() - config.historicalWindowDays * 24 * 60 * 60 * 1000,
                    );
                } else {
                    // Production mode: use round dates
                    scoringStart = round.startTime;
                    scoringEnd = round.endTime;
                }

                const roundPositions = adrenaClient.filterPositionsForRound(
                    allPositions,
                    scoringStart,
                    scoringEnd,
                );

                // Apply competition rules (anti-wash, anti-dust)
                const validPositions = adrenaClient.filterValidPositions(
                    roundPositions,
                    config.minPositionCollateral,
                    config.minTradeDurationSec,
                );

                // Compute CPI
                const scores: CPIScores = computeCPI(
                    validPositions,
                    round.startTime,
                    round.endTime,
                    DEFAULT_CPI_WEIGHTS,
                );

                // Update bracket entry with scores
                await db
                    .update(bracketEntries)
                    .set({
                        pnlScore: scores.pnlScore,
                        riskScore: scores.riskScore,
                        consistencyScore: scores.consistencyScore,
                        activityScore: scores.activityScore,
                        cpiScore: scores.cpiScore,
                    })
                    .where(eq(bracketEntries.id, entry.id));

                // Save snapshot for audit trail
                await db.insert(scoreSnapshots).values({
                    bracketEntryId: entry.id,
                    rawPositions: validPositions,
                    scores,
                });

                scoredCount++;
            } catch (error) {
                console.error(
                    `[TournamentManager] Error scoring wallet ${entry.wallet}:`,
                    error instanceof Error ? error.message : error,
                );
                // Continue scoring other entries — don't let one failure stop the round
            }
        }
    }

    console.log(`[TournamentManager] Scored ${scoredCount} entries in round ${roundId}`);
    return scoredCount;
}

// --------------------------------------------------------------------------
// 5. Advance to the next round
//
// For each bracket:
//   1. Rank entries by CPI score (descending)
//   2. Top advanceRatio (default 50%) advance
//   3. Bottom entries eliminated
//   4. Create next round with new brackets from advancing wallets
// --------------------------------------------------------------------------
export async function advanceRound(
    tournamentId: number,
): Promise<{ nextRoundId: number; advanced: number; eliminated: number } | { completed: true }> {
    // Get current active round
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) throw new Error('Tournament not found');
    const config = tournament.config as TournamentConfig;

    const activeRound = await db
        .select()
        .from(rounds)
        .where(
            and(
                eq(rounds.tournamentId, tournamentId),
                eq(rounds.status, 'active'),
            ),
        )
        .limit(1);

    if (activeRound.length === 0) throw new Error('No active round found');
    const currentRound = activeRound[0];

    // Get brackets and entries for current round
    const currentBrackets = await db
        .select()
        .from(brackets)
        .where(eq(brackets.roundId, currentRound.id));

    const advancingWallets: string[] = [];
    let eliminatedCount = 0;

    for (const bracket of currentBrackets) {
        const entries = await db
            .select()
            .from(bracketEntries)
            .where(eq(bracketEntries.bracketId, bracket.id));

        // Sort by CPI score descending
        entries.sort((a, b) => b.cpiScore - a.cpiScore);

        // Top advanceRatio advance, rest eliminated
        const advanceCount = Math.max(1, Math.ceil(entries.length * config.advanceRatio));

        for (let i = 0; i < entries.length; i++) {
            const isAdvancing = i < advanceCount;

            await db
                .update(bracketEntries)
                .set({
                    advanced: isAdvancing,
                    eliminated: !isAdvancing,
                })
                .where(eq(bracketEntries.id, entries[i].id));

            if (isAdvancing) {
                advancingWallets.push(entries[i].wallet);
            } else {
                eliminatedCount++;
            }
        }
    }

    // Mark current round as completed
    await db
        .update(rounds)
        .set({ status: 'completed' })
        .where(eq(rounds.id, currentRound.id));

    // Determine next round number
    const nextRoundNumber = currentRound.roundNumber + 1;

    // If 3 or fewer traders remain, or we've done 3 rounds, tournament is complete
    if (advancingWallets.length <= 3 || nextRoundNumber > 3) {
        await db
            .update(tournaments)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(tournaments.id, tournamentId));

        console.log(
            `[TournamentManager] Tournament ${tournamentId} completed! ` +
            `${advancingWallets.length} final traders.`,
        );

        return { completed: true };
    }

    // Create next round
    const roundName = ROUND_NAMES[Math.min(nextRoundNumber - 1, ROUND_NAMES.length - 1)];
    const now = new Date();
    const roundEnd = new Date(now.getTime() + config.roundDurationHours * 60 * 60 * 1000);

    const [nextRound] = await db
        .insert(rounds)
        .values({
            tournamentId,
            roundNumber: nextRoundNumber,
            name: roundName,
            startTime: now,
            endTime: roundEnd,
            status: 'active',
        })
        .returning({ id: rounds.id });

    // Shuffle advancing wallets and create new brackets
    for (let i = advancingWallets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [advancingWallets[i], advancingWallets[j]] = [advancingWallets[j], advancingWallets[i]];
    }

    // For Round 2+, use half the bracket size (more intimate brackets)
    const nextBracketSize = Math.max(2, Math.ceil(config.bracketSize / 2));
    const nextBracketGroups: string[][] = [];

    for (let i = 0; i < advancingWallets.length; i += nextBracketSize) {
        nextBracketGroups.push(advancingWallets.slice(i, i + nextBracketSize));
    }

    // Merge last group if too small
    if (nextBracketGroups.length > 1 && nextBracketGroups[nextBracketGroups.length - 1].length < 2) {
        const lastGroup = nextBracketGroups.pop()!;
        nextBracketGroups[nextBracketGroups.length - 1].push(...lastGroup);
    }

    for (let i = 0; i < nextBracketGroups.length; i++) {
        const [bracket] = await db
            .insert(brackets)
            .values({
                roundId: nextRound.id,
                bracketNumber: i + 1,
            })
            .returning({ id: brackets.id });

        for (const wallet of nextBracketGroups[i]) {
            await db.insert(bracketEntries).values({
                bracketId: bracket.id,
                wallet,
            });
        }
    }

    console.log(
        `[TournamentManager] Advanced to Round ${nextRoundNumber} "${roundName}": ` +
        `${advancingWallets.length} advanced, ${eliminatedCount} eliminated, ` +
        `${nextBracketGroups.length} brackets`,
    );

    return {
        nextRoundId: nextRound.id,
        advanced: advancingWallets.length,
        eliminated: eliminatedCount,
    };
}

// --------------------------------------------------------------------------
// 6. Get tournament state (for API responses)
// --------------------------------------------------------------------------
export async function getTournamentState(tournamentId: number) {
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) return null;

    const tournamentRounds = await db
        .select()
        .from(rounds)
        .where(eq(rounds.tournamentId, tournamentId));

    const regCount = await db
        .select()
        .from(registrations)
        .where(eq(registrations.tournamentId, tournamentId));

    return {
        ...tournament,
        rounds: tournamentRounds,
        registrationCount: regCount.length,
        eligibleCount: regCount.filter((r) => r.eligible).length,
    };
}

// --------------------------------------------------------------------------
// 7. Get bracket details with entries
// --------------------------------------------------------------------------
export async function getBracketDetails(bracketId: number) {
    const [bracket] = await db
        .select()
        .from(brackets)
        .where(eq(brackets.id, bracketId))
        .limit(1);

    if (!bracket) return null;

    const entries = await db
        .select()
        .from(bracketEntries)
        .where(eq(bracketEntries.bracketId, bracketId));

    // Sort by CPI score descending
    entries.sort((a, b) => b.cpiScore - a.cpiScore);

    return { ...bracket, entries };
}

// --------------------------------------------------------------------------
// 8. Get trader profile across the tournament
// --------------------------------------------------------------------------
export async function getTraderProfile(tournamentId: number, wallet: string) {
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) return null;

    // Find all bracket entries for this wallet across all rounds
    const tournamentRounds = await db
        .select()
        .from(rounds)
        .where(eq(rounds.tournamentId, tournamentId));

    const roundEntries = [];
    for (const round of tournamentRounds) {
        const roundBrackets = await db
            .select()
            .from(brackets)
            .where(eq(brackets.roundId, round.id));

        for (const bracket of roundBrackets) {
            const entries = await db
                .select()
                .from(bracketEntries)
                .where(
                    and(
                        eq(bracketEntries.bracketId, bracket.id),
                        eq(bracketEntries.wallet, wallet),
                    ),
                );

            if (entries.length > 0) {
                roundEntries.push({
                    round,
                    bracket,
                    entry: entries[0],
                });
            }
        }
    }

    return {
        wallet,
        tournament: { id: tournament.id, name: tournament.name },
        rounds: roundEntries.map((re) => ({
            roundNumber: re.round.roundNumber,
            roundName: re.round.name,
            bracketNumber: re.bracket.bracketNumber,
            scores: {
                pnlScore: re.entry.pnlScore,
                riskScore: re.entry.riskScore,
                consistencyScore: re.entry.consistencyScore,
                activityScore: re.entry.activityScore,
                cpiScore: re.entry.cpiScore,
            },
            eliminated: re.entry.eliminated,
            advanced: re.entry.advanced,
        })),
    };
}
