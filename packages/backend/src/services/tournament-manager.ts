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
//   4. advanceRound: Rank traders, advance top half, track eliminated wallets
//   5. completeTournament: Finalize results
//
// Behavioral notes:
//   - Registration is zero-barrier; anyone with a valid Solana wallet can
//     register. Quality filters move to prize distribution time.
//   - Round durations are configurable per-round via roundDurations[].
//   - Fallen Fighters: at main completion, all eliminated wallets enter a
//     single consolation pool scored over the final round's time window.
//   - Risk score uses drawdown metric (leverage is not penalized).
// ============================================================================

import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    tournaments,
    rounds,
    brackets,
    bracketEntries,
    registrations,
    scoreSnapshots,
    seasonRegistrations,
} from '../db/schema.js';
import { AdrenaClient } from './adrena-client.js';
import { computeCPI } from './scoring-engine.js';
import type {
    TournamentConfig,
    RoundName,
    CPIScores,
} from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG, DEFAULT_CPI_WEIGHTS, resolveConfig } from '../types.js';

const ROUND_NAMES: RoundName[] = ['First Blood', 'The Crucible', 'Endgame'];

const adrenaClient = new AdrenaClient();

// --------------------------------------------------------------------------
// Helper: get round duration for a given round number from config
// If more rounds than durations, use the last duration.
// --------------------------------------------------------------------------
function getRoundDuration(config: TournamentConfig, roundNumber: number): number {
    const durations = config.roundDurations;
    if (!durations || durations.length === 0) {
        return 72; // fallback
    }
    return durations[Math.min(roundNumber - 1, durations.length - 1)];
}

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
// Zero-barrier registration: anyone with a valid Solana wallet can register.
// No eligibility checks (trade history, recency); those move to prize time.
// --------------------------------------------------------------------------
export async function registerWallet(
    tournamentId: number,
    wallet: string,
): Promise<{ registered: boolean; reason?: string }> {
    // Check tournament exists and is accepting registrations
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) {
        return { registered: false, reason: 'Tournament not found' };
    }

    const config = resolveConfig(tournament.config);

    // Rank-only (Forge): accept registrations while active (open entry)
    // Bracket (Gauntlet): only accept during registration phase
    if (tournament.status === 'completed' || tournament.status === 'cancelled') {
        return { registered: false, reason: 'Tournament has ended' };
    }
    if (tournament.status !== 'registration' && config.format !== 'rank_only') {
        return { registered: false, reason: 'Tournament is not accepting registrations' };
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
        return { registered: false, reason: 'Wallet already registered' };
    }

    // Register — no eligibility check, no API call
    await db.insert(registrations).values({
        tournamentId,
        wallet,
    });

    // If tournament belongs to a season, also register at season level
    if (tournament.seasonId) {
        try {
            await db.insert(seasonRegistrations).values({
                seasonId: tournament.seasonId,
                wallet,
            });
        } catch (err) {
            // UNIQUE constraint violation = already season-registered (idempotent)
            if (!(err instanceof Error && err.message.includes('unique'))) {
                throw err;
            }
        }
    }

    // For rank-only active tournaments: add wallet to the existing bracket immediately
    // so the scoring pipeline picks them up on the next refresh cycle
    if (config.format === 'rank_only' && tournament.status === 'active') {
        const [activeRound] = await db
            .select()
            .from(rounds)
            .where(
                and(
                    eq(rounds.tournamentId, tournamentId),
                    eq(rounds.status, 'active'),
                ),
            )
            .limit(1);

        if (activeRound) {
            const [bracket] = await db
                .select()
                .from(brackets)
                .where(eq(brackets.roundId, activeRound.id))
                .limit(1);

            if (bracket) {
                await db.insert(bracketEntries).values({
                    bracketId: bracket.id,
                    wallet,
                });
            }
        }
    }

    console.log(`[TournamentManager] Registered wallet ${wallet} for tournament ${tournamentId}`);
    return { registered: true };
}

// --------------------------------------------------------------------------
// 3. Start the tournament: close registration, create Round 1 brackets
//
// Bracket creation algorithm:
//   1. Get all registrations (no eligibility filter — all participate)
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

    // Singleton enforcement: only one tournament can be `active` at a time.
    // This is the funnel for ALL `active` transitions in this function:
    //   - rank_only branch (Forge "The Forge" round): flips status to active before returning
    //   - bracket branch (Gauntlet "First Blood" Round 1): flips status to active before returning
    // season-manager paths (startSeason / advanceWeek / qualifyForFinal) only CREATE tournaments
    // in registration status; they don't activate. So this single guard covers every path.
    //
    // Race-safety: app-level check only. Single-operator admin makes the race window
    // microseconds; if two starts collide, the second sees status='active' on the first and
    // 409s out cleanly via the thrown error.
    //
    // `ne(tournaments.id, tournamentId)` excludes the subject tournament; defensive, since the
    // status check above already guarantees it's in registration (not active), but explicit
    // self-exclusion is robust against future status-flow changes.
    const [activeOther] = await db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .where(
            and(
                eq(tournaments.status, 'active'),
                ne(tournaments.id, tournamentId),
            ),
        )
        .limit(1);

    if (activeOther) {
        throw new Error(
            `Cannot start tournament ${tournamentId}: tournament ${activeOther.id} ("${activeOther.name}") is already active. ` +
            `Only one tournament can be active at a time. Cancel or complete the active tournament first.`,
        );
    }

    const config = resolveConfig(tournament.config);

    // Get all registrations (no eligibility filter)
    const allRegs = await db
        .select()
        .from(registrations)
        .where(eq(registrations.tournamentId, tournamentId));

    if (allRegs.length < 2) {
        throw new Error(`Need at least 2 registered traders. Found ${allRegs.length}.`);
    }

    // --- Rank-only mode (The Forge): one round, one bracket, all wallets ---

    if (config.format === 'rank_only') {
        const wallets = allRegs.map((r) => r.wallet);
        const now = new Date();
        // Full competition duration = sum of all round durations
        const durationHours = config.roundDurations.reduce((a, b) => a + b, 0);
        const roundEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const [round] = await db
            .insert(rounds)
            .values({
                tournamentId,
                roundNumber: 1,
                name: 'The Forge',
                type: 'main',
                startTime: now,
                endTime: roundEnd,
                status: 'active',
            })
            .returning({ id: rounds.id });

        // Single bracket containing all participants
        const [bracket] = await db
            .insert(brackets)
            .values({
                roundId: round.id,
                bracketNumber: 1,
            })
            .returning({ id: brackets.id });

        for (const wallet of wallets) {
            await db.insert(bracketEntries).values({
                bracketId: bracket.id,
                wallet,
            });
        }

        // Activate tournament
        await db
            .update(tournaments)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(tournaments.id, tournamentId));

        console.log(
            `[TournamentManager] Started rank-only tournament ${tournamentId} (The Forge): ` +
            `1 round, 1 bracket, ${wallets.length} traders, ${durationHours}h duration`,
        );

        return { roundId: round.id, bracketCount: 1 };
    }

    // --- Bracket mode (The Gauntlet): standard bracket elimination ---

    // Use seeded order if provided (Final tournaments), otherwise shuffle randomly
    let wallets: string[];
    if (config.seededWallets && config.seededWallets.length > 0) {
        // Seeded bracket: use the order from season standings (Championship → Contender)
        // Only include wallets that are actually registered
        const registeredSet = new Set(allRegs.map((r) => r.wallet));
        wallets = config.seededWallets.filter((w) => registeredSet.has(w));
        // Append any registered wallets not in the seeded list (safety)
        for (const reg of allRegs) {
            if (!wallets.includes(reg.wallet)) {
                wallets.push(reg.wallet);
            }
        }
        console.log(`[TournamentManager] Using seeded bracket order (${wallets.length} wallets)`);
    } else {
        // Random shuffle (Fisher-Yates)
        wallets = allRegs.map((r) => r.wallet);
        for (let i = wallets.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [wallets[i], wallets[j]] = [wallets[j], wallets[i]];
        }
    }

    // Create Round 1
    const now = new Date();
    const durationHours = getRoundDuration(config, 1);
    const roundEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const [round] = await db
        .insert(rounds)
        .values({
            tournamentId,
            roundNumber: 1,
            name: ROUND_NAMES[0],
            type: 'main',
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
//   3. Compute CPI (with config for asset count)
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
    const config = resolveConfig(tournament.config);

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

                // Compute CPI — pass config for asset count
                const scores: CPIScores = computeCPI(
                    validPositions,
                    round.startTime,
                    round.endTime,
                    DEFAULT_CPI_WEIGHTS,
                    config,
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
                // Continue scoring other entries; don't let one failure stop the round
            }
        }
    }

    console.log(`[TournamentManager] Scored ${scoredCount} entries in round ${roundId}`);
    return scoredCount;
}

// --------------------------------------------------------------------------
// 5. Advance to the next round
//
// For each bracket in the active MAIN round:
//   1. Rank entries by CPI score (descending)
//   2. Top advanceRatio (default 50%) advance
//   3. Bottom entries eliminated
//   4. Create next MAIN round with new brackets from advancing wallets
//   5. Create CONSOLATION round ("Fallen Fighters") from eliminated wallets
//      if there are ≥2 eliminated traders
//
// Consolation rounds:
//   - Eliminated traders from the main bracket enter a parallel bracket
//   - Eliminated traders are collected into a single Fallen Fighters pool
//     scored over the final round's time window (rank-only, no elimination)
//   - R3 (final main round) is rank-only: all participants are ranked but
//     none eliminated, ensuring finalist status for season points
// --------------------------------------------------------------------------
export async function advanceRound(
    tournamentId: number,
    roundType?: 'main' | 'consolation',
): Promise<{ nextRoundId: number; advanced: number; eliminated: number } | { completed: true }> {
    // Get tournament
    const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

    if (!tournament) throw new Error('Tournament not found');
    const config = resolveConfig(tournament.config);

    // Get active rounds
    const activeRounds = await db
        .select()
        .from(rounds)
        .where(
            and(
                eq(rounds.tournamentId, tournamentId),
                eq(rounds.status, 'active'),
            ),
        );

    // Auto-detect round type if not specified:
    // Prefer consolation if one exists, otherwise main
    let effectiveType = roundType;
    if (!effectiveType) {
        const hasConsolation = activeRounds.some(r => (r.type ?? 'main') === 'consolation');
        const hasMain = activeRounds.some(r => (r.type ?? 'main') === 'main');
        if (hasConsolation) {
            effectiveType = 'consolation';
        } else if (hasMain) {
            effectiveType = 'main';
        } else {
            throw new Error('No active round found');
        }
    }

    // Find the active round matching the resolved type
    const currentRound = activeRounds.find(r => (r.type ?? 'main') === effectiveType);
    if (!currentRound) throw new Error(`No active ${effectiveType} round found`);

    // Get brackets and entries for current round
    const currentBrackets = await db
        .select()
        .from(brackets)
        .where(eq(brackets.roundId, currentRound.id));

    const advancingWallets: string[] = [];
    const eliminatedWallets: string[] = [];

    // Rank-only detection:
    // - Consolation (FF pool): flat ranking, no elimination
    // - Final main round: round that would trigger completion
    // - Forge (rank_only format): flat leaderboard, no elimination ever
    const nextRoundNumber = currentRound.roundNumber + 1;
    const isRankOnly = effectiveType === 'consolation'
        || (effectiveType === 'main' && nextRoundNumber > 3)
        || config.format === 'rank_only';

    for (const bracket of currentBrackets) {
        const entries = await db
            .select()
            .from(bracketEntries)
            .where(eq(bracketEntries.bracketId, bracket.id));
        // Sort by CPI score descending
        entries.sort((a, b) => b.cpiScore - a.cpiScore);

        // Top advanceRatio advance, rest eliminated (unless rank-only)
        const advanceCount = isRankOnly
            ? entries.length
            : Math.max(1, Math.ceil(entries.length * config.advanceRatio));

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
                eliminatedWallets.push(entries[i].wallet);
            }
        }
    }

    // Mark current round as completed
    await db
        .update(rounds)
        .set({ status: 'completed' })
        .where(eq(rounds.id, currentRound.id));

    // --- Handle consolation rounds (Fallen Fighters pool) ---
    if (effectiveType === 'consolation') {
        // FF pool complete — rank only, no advancement. Set tournament to completed.
        await db
            .update(tournaments)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(tournaments.id, tournamentId));

        console.log(
            `[TournamentManager] Tournament ${tournamentId} completed ` +
            `(main + Fallen Fighters). ${advancingWallets.length} FF finalists.`,
        );
        return { completed: true };
    }

    // --- Main round logic ---

    // If 3 or fewer traders remain, we've done 3 rounds, or this is rank-only — main track is done
    if (advancingWallets.length <= 3 || nextRoundNumber > 3 || config.format === 'rank_only') {
        // Collect ALL eliminated wallets from ALL main rounds
        const allMainRounds = await db
            .select()
            .from(rounds)
            .where(
                and(
                    eq(rounds.tournamentId, tournamentId),
                    eq(rounds.type, 'main'),
                ),
            );

        const allEliminated: string[] = [];
        for (const mr of allMainRounds) {
            const mrBrackets = await db
                .select()
                .from(brackets)
                .where(eq(brackets.roundId, mr.id));

            for (const br of mrBrackets) {
                const brEntries = await db
                    .select()
                    .from(bracketEntries)
                    .where(
                        and(
                            eq(bracketEntries.bracketId, br.id),
                            eq(bracketEntries.eliminated, true),
                        ),
                    );
                allEliminated.push(...brEntries.map(e => e.wallet));
            }
        }

        if (allEliminated.length >= 2) {
            // Create single FF consolation round using the current (final) round's time window
            const [ffRound] = await db
                .insert(rounds)
                .values({
                    tournamentId,
                    roundNumber: 1,
                    name: 'Fallen Fighters',
                    type: 'consolation',
                    startTime: currentRound.startTime,
                    endTime: currentRound.endTime,
                    status: 'active',
                })
                .returning({ id: rounds.id });

            await createBracketsForWallets(ffRound.id, allEliminated, config);

            console.log(
                `[TournamentManager] Main complete for tournament ${tournamentId}. ` +
                `Created Fallen Fighters: ${allEliminated.length} eliminated traders.`,
            );

            // Tournament stays 'active' — FF round must complete first
            return {
                nextRoundId: ffRound.id,
                advanced: advancingWallets.length,
                eliminated: eliminatedWallets.length,
            };
        }

        // No eliminated wallets (edge case) — complete immediately
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

    // Create next main round
    const roundName = ROUND_NAMES[Math.min(nextRoundNumber - 1, ROUND_NAMES.length - 1)];
    const now = new Date();
    const durationHours = getRoundDuration(config, nextRoundNumber);
    const roundEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const [nextRound] = await db
        .insert(rounds)
        .values({
            tournamentId,
            roundNumber: nextRoundNumber,
            name: roundName,
            type: 'main',
            startTime: now,
            endTime: roundEnd,
            status: 'active',
        })
        .returning({ id: rounds.id });

    // Create brackets for advancing wallets
    const mainBracketCount = await createBracketsForWallets(nextRound.id, advancingWallets, config);

    console.log(
        `[TournamentManager] Advanced to Round ${nextRoundNumber} "${roundName}": ` +
        `${advancingWallets.length} advanced, ${eliminatedWallets.length} eliminated, ` +
        `${mainBracketCount} brackets`,
    );

    return {
        nextRoundId: nextRound.id,
        advanced: advancingWallets.length,
        eliminated: eliminatedWallets.length,
    };
}

// --------------------------------------------------------------------------
// Helper: Create brackets for a list of wallets in a given round
// Shuffles wallets, splits into bracket groups, merges small trailing group
// --------------------------------------------------------------------------
async function createBracketsForWallets(
    roundId: number,
    wallets: string[],
    config: TournamentConfig,
): Promise<number> {
    // Shuffle wallets (Fisher-Yates)
    const shuffled = [...wallets];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Use half bracket size for rounds beyond Round 1
    const bracketSize = Math.max(2, Math.ceil(config.bracketSize / 2));
    const groups: string[][] = [];

    for (let i = 0; i < shuffled.length; i += bracketSize) {
        groups.push(shuffled.slice(i, i + bracketSize));
    }

    // Merge last group if too small
    if (groups.length > 1 && groups[groups.length - 1].length < 2) {
        const lastGroup = groups.pop()!;
        groups[groups.length - 1].push(...lastGroup);
    }

    for (let i = 0; i < groups.length; i++) {
        const [bracket] = await db
            .insert(brackets)
            .values({
                roundId,
                bracketNumber: i + 1,
            })
            .returning({ id: brackets.id });

        for (const wallet of groups[i]) {
            await db.insert(bracketEntries).values({
                bracketId: bracket.id,
                wallet,
            });
        }
    }

    return groups.length;
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
            roundType: (re.round as { type?: string }).type ?? 'main',
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
