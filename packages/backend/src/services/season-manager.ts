// ============================================================================
// Season Manager
//
// Manages the weekly season lifecycle:
//   1. Create a season (container for weekly gauntlets)
//   2. Start the season (creates Week 1 tournament)
//   3. Advance weeks (after each weekly tournament completes)
//   4. Qualify for the Season Final (top N from aggregate standings)
//   5. Complete the season (after the Final tournament completes)
//
// A season contains `weekCount` weekly gauntlets + 1 Season Final.
// Each weekly gauntlet is a full tournament (bracket → rounds → scoring).
// The season tracks aggregate points across all weeks for qualification.
//
// Points scheme (per weekly tournament placement):
//   Winner: 25, 2nd: 18, 3rd: 15, Finalist: 12,
//   Eliminated R2: 8, Eliminated R1: 4,
//   Consolation 1st: 6, 2nd: 4, 3rd: 3, Registered: 1
// ============================================================================

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    seasons,
    seasonStandings,
    tournaments,
    rounds,
    brackets,
    bracketEntries,
    registrations,
    seasonRegistrations,
} from '../db/schema.js';
import { createTournament, registerWallet } from './tournament-manager.js';
import type { SeasonConfig, SeasonPointsScheme } from '../types.js';
import { DEFAULT_SEASON_CONFIG } from '../types.js';

// --------------------------------------------------------------------------
// 1. Create a new season
// --------------------------------------------------------------------------
export async function createSeason(
    name: string,
    config: Partial<SeasonConfig> = {},
): Promise<{ id: number }> {
    const fullConfig: SeasonConfig = { ...DEFAULT_SEASON_CONFIG, ...config };

    const [season] = await db
        .insert(seasons)
        .values({
            name,
            status: 'registration',
            config: fullConfig,
            currentWeek: 0,
        })
        .returning({ id: seasons.id });

    console.log(`[SeasonManager] Created season "${name}" (id: ${season.id})`);
    return season;
}

// --------------------------------------------------------------------------
// 2. Start the season — creates Week 1 tournament
// --------------------------------------------------------------------------
export async function startSeason(
    seasonId: number,
): Promise<{ tournamentId: number }> {
    const [season] = await db
        .select()
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .limit(1);

    if (!season) throw new Error('Season not found');
    if (season.status !== 'registration') {
        throw new Error(`Cannot start season in "${season.status}" status`);
    }

    const config = { ...DEFAULT_SEASON_CONFIG, ...(season.config as Partial<SeasonConfig>) };

    // Create Week 1 tournament
    const weekName = `${season.name} — Week 1`;
    const tournament = await createTournament(weekName, config.tournamentConfig);

    // Link tournament to season
    await db
        .update(tournaments)
        .set({ seasonId, weekNumber: 1 })
        .where(eq(tournaments.id, tournament.id));

    // Update season status
    await db
        .update(seasons)
        .set({
            status: 'active',
            currentWeek: 1,
            updatedAt: new Date(),
        })
        .where(eq(seasons.id, seasonId));

    console.log(
        `[SeasonManager] Started season ${seasonId}: Week 1 tournament ${tournament.id}`,
    );

    return { tournamentId: tournament.id };
}

// --------------------------------------------------------------------------
// 3. Advance to the next week
//
// Called after a weekly tournament completes:
//   1. Compute placements for the completed tournament
//   2. Award season points according to the points scheme
//   3. If more weeks remain: create next week's tournament
//   4. If all weeks done: transition to 'final' and qualify top wallets
// --------------------------------------------------------------------------
export async function advanceWeek(
    seasonId: number,
): Promise<{ nextTournamentId?: number; seasonStatus: string }> {
    const [season] = await db
        .select()
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .limit(1);

    if (!season) throw new Error('Season not found');
    if (season.status !== 'active') {
        throw new Error(`Cannot advance week in "${season.status}" status`);
    }

    const config = { ...DEFAULT_SEASON_CONFIG, ...(season.config as Partial<SeasonConfig>) };
    const currentWeek = season.currentWeek;

    // Find the current week's tournament
    const [currentTournament] = await db
        .select()
        .from(tournaments)
        .where(
            and(
                eq(tournaments.seasonId, seasonId),
                eq(tournaments.weekNumber, currentWeek),
            ),
        )
        .limit(1);

    if (!currentTournament) {
        throw new Error(`No tournament found for season ${seasonId} week ${currentWeek}`);
    }

    if (currentTournament.status !== 'completed') {
        throw new Error(
            `Week ${currentWeek} tournament (${currentTournament.id}) is not completed ` +
            `(status: ${currentTournament.status}). Complete it first.`,
        );
    }

    // Compute placements and award points
    await awardWeeklyPoints(
        seasonId,
        currentTournament.id,
        config.pointsScheme,
    );

    const nextWeek = currentWeek + 1;

    // Check if all regular weeks are done
    if (nextWeek > config.weekCount) {
        // All weeks done — transition to final
        await qualifyForFinal(seasonId, config);

        console.log(
            `[SeasonManager] Season ${seasonId}: All ${config.weekCount} weeks complete. ` +
            `Entering Season Final phase.`,
        );

        return { seasonStatus: 'final' };
    }

    // Create next week's tournament
    const weekName = `${season.name} — Week ${nextWeek}`;
    const nextTournament = await createTournament(weekName, config.tournamentConfig);

    // Link tournament to season
    await db
        .update(tournaments)
        .set({ seasonId, weekNumber: nextWeek })
        .where(eq(tournaments.id, nextTournament.id));

    // Update season
    await db
        .update(seasons)
        .set({ currentWeek: nextWeek, updatedAt: new Date() })
        .where(eq(seasons.id, seasonId));

    // Auto-enroll all season-registered wallets into the new tournament
    const seasonWallets = await db
        .select()
        .from(seasonRegistrations)
        .where(eq(seasonRegistrations.seasonId, seasonId));

    let autoRegistered = 0;
    for (const sw of seasonWallets) {
        const result = await registerWallet(nextTournament.id, sw.wallet);
        if (result.registered) autoRegistered++;
    }

    console.log(
        `[SeasonManager] Season ${seasonId}: Advanced to Week ${nextWeek} ` +
        `(tournament ${nextTournament.id}). Auto-registered ${autoRegistered}/${seasonWallets.length} wallets.`,
    );

    return { nextTournamentId: nextTournament.id, seasonStatus: 'active' };
}

// --------------------------------------------------------------------------
// 4. Award season points for a completed weekly tournament
//
// Placement detection:
//   - Finalists = wallets that were never eliminated (advanced through all rounds
//     or were still active when tournament completed)
//   - Winner = finalist with highest CPI in last round
//   - 2nd/3rd = next highest CPI among finalists
//   - Eliminated R1 = wallets eliminated in round 1
//   - Eliminated R2 = wallets eliminated in round 2+
//   - Consolation winner = highest CPI in last consolation round
//   - Registered but didn't trade = registered but 0 CPI in round 1
// --------------------------------------------------------------------------
async function awardWeeklyPoints(
    seasonId: number,
    tournamentId: number,
    pointsScheme: SeasonPointsScheme,
): Promise<void> {
    // Get all rounds for this tournament
    const tournamentRounds = await db
        .select()
        .from(rounds)
        .where(eq(rounds.tournamentId, tournamentId));

    // Separate main and consolation rounds
    const mainRounds = tournamentRounds
        .filter((r) => (r.type ?? 'main') === 'main')
        .sort((a, b) => a.roundNumber - b.roundNumber);

    const consolationRounds = tournamentRounds
        .filter((r) => (r.type ?? 'main') === 'consolation')
        .sort((a, b) => a.roundNumber - b.roundNumber);

    // All registrations
    const allRegs = await db
        .select()
        .from(registrations)
        .where(eq(registrations.tournamentId, tournamentId));

    const allRegisteredWallets = new Set(allRegs.map((r) => r.wallet));

    // Track wallet placements
    const walletPoints = new Map<string, number>();
    const walletPlacements = new Map<string, number>(); // 1 = winner, 2 = 2nd, etc.

    // Initialize all registered wallets with minimum points
    for (const wallet of allRegisteredWallets) {
        walletPoints.set(wallet, pointsScheme.registered);
    }

    // Process main rounds to find who was eliminated in each
    const eliminatedInRound = new Map<string, number>(); // wallet → round number eliminated

    for (const round of mainRounds) {
        const roundBrackets = await db
            .select()
            .from(brackets)
            .where(eq(brackets.roundId, round.id));

        for (const bracket of roundBrackets) {
            const entries = await db
                .select()
                .from(bracketEntries)
                .where(eq(bracketEntries.bracketId, bracket.id));

            for (const entry of entries) {
                if (entry.eliminated) {
                    eliminatedInRound.set(entry.wallet, round.roundNumber);
                }
            }
        }
    }

    // Find finalists — wallets that advanced in the last main round
    // (or wallets that were never eliminated in any main round)
    const lastMainRound = mainRounds[mainRounds.length - 1];
    const finalists: Array<{ wallet: string; cpiScore: number }> = [];

    if (lastMainRound) {
        const lastBrackets = await db
            .select()
            .from(brackets)
            .where(eq(brackets.roundId, lastMainRound.id));

        for (const bracket of lastBrackets) {
            const entries = await db
                .select()
                .from(bracketEntries)
                .where(eq(bracketEntries.bracketId, bracket.id));

            for (const entry of entries) {
                if (entry.advanced || !entry.eliminated) {
                    finalists.push({ wallet: entry.wallet, cpiScore: entry.cpiScore });
                }
            }
        }
    }

    // Sort finalists by CPI (descending) for placement
    finalists.sort((a, b) => b.cpiScore - a.cpiScore);

    // Award finalist points
    for (let i = 0; i < finalists.length; i++) {
        const wallet = finalists[i].wallet;
        const placement = i + 1;
        walletPlacements.set(wallet, placement);

        if (i === 0) {
            walletPoints.set(wallet, pointsScheme.winner);
        } else if (i === 1) {
            walletPoints.set(wallet, pointsScheme.second);
        } else if (i === 2) {
            walletPoints.set(wallet, pointsScheme.third);
        } else {
            walletPoints.set(wallet, pointsScheme.finalist);
        }
    }

    // Award elimination points
    for (const [wallet, roundNumber] of eliminatedInRound) {
        // Skip if wallet is already a finalist (shouldn't happen, but safety)
        if (walletPlacements.has(wallet)) continue;

        if (roundNumber === 1) {
            walletPoints.set(wallet, pointsScheme.eliminatedR1);
        } else {
            walletPoints.set(wallet, pointsScheme.eliminatedR2);
        }
    }

    // Award consolation podium points (top 3)
    if (consolationRounds.length > 0) {
        const lastConsolation = consolationRounds[consolationRounds.length - 1];
        const consolationBrackets = await db
            .select()
            .from(brackets)
            .where(eq(brackets.roundId, lastConsolation.id));

        const consolationFinishers: { wallet: string; cpiScore: number }[] = [];

        for (const bracket of consolationBrackets) {
            const entries = await db
                .select()
                .from(bracketEntries)
                .where(eq(bracketEntries.bracketId, bracket.id));

            for (const entry of entries) {
                consolationFinishers.push({ wallet: entry.wallet, cpiScore: entry.cpiScore });
            }
        }

        consolationFinishers.sort((a, b) => b.cpiScore - a.cpiScore);

        const consolationTiers = [
            pointsScheme.consolationWinner,
            pointsScheme.consolationSecond ?? 4,
            pointsScheme.consolationThird ?? 3,
        ];
        for (let i = 0; i < Math.min(consolationFinishers.length, 3); i++) {
            const wallet = consolationFinishers[i].wallet;
            const currentPoints = walletPoints.get(wallet) ?? 0;
            if (consolationTiers[i] > currentPoints) {
                walletPoints.set(wallet, consolationTiers[i]);
            }
        }
    }

    // Upsert standings
    for (const [wallet, points] of walletPoints) {
        const placement = walletPlacements.get(wallet) ?? null;

        const [existing] = await db
            .select()
            .from(seasonStandings)
            .where(
                and(
                    eq(seasonStandings.seasonId, seasonId),
                    eq(seasonStandings.wallet, wallet),
                ),
            )
            .limit(1);

        if (existing) {
            const newBest = placement !== null
                ? (existing.bestPlacement === null ? placement : Math.min(existing.bestPlacement, placement))
                : existing.bestPlacement;

            await db
                .update(seasonStandings)
                .set({
                    totalPoints: existing.totalPoints + points,
                    weeksParticipated: existing.weeksParticipated + 1,
                    bestPlacement: newBest,
                })
                .where(eq(seasonStandings.id, existing.id));
        } else {
            await db.insert(seasonStandings).values({
                seasonId,
                wallet,
                totalPoints: points,
                weeksParticipated: 1,
                bestPlacement: placement,
            });
        }
    }

    console.log(
        `[SeasonManager] Awarded weekly points for tournament ${tournamentId}: ` +
        `${walletPoints.size} wallets scored`,
    );
}

// --------------------------------------------------------------------------
// 5. Qualify top wallets for the Season Final
//
// Reads season standings, marks top N as qualified, creates the Final
// tournament with those wallets auto-registered.
// --------------------------------------------------------------------------
async function qualifyForFinal(
    seasonId: number,
    config: SeasonConfig,
): Promise<void> {
    // Get top N wallets by total points
    const standings = await db
        .select()
        .from(seasonStandings)
        .where(eq(seasonStandings.seasonId, seasonId))
        .orderBy(desc(seasonStandings.totalPoints))
        .limit(config.qualificationSlots);

    if (standings.length === 0) {
        console.warn(`[SeasonManager] No standings found for season ${seasonId}. Cannot qualify.`);
        return;
    }

    // Mark as qualified
    for (const standing of standings) {
        await db
            .update(seasonStandings)
            .set({ qualifiedForFinal: true })
            .where(eq(seasonStandings.id, standing.id));
    }

    // Get season name for the final tournament name
    const [season] = await db
        .select()
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .limit(1);

    const finalName = `${season?.name ?? 'Season'} — Grand Final`;
    const finalTournament = await createTournament(finalName, config.tournamentConfig);

    // Link to season
    await db
        .update(tournaments)
        .set({ seasonId, weekNumber: config.weekCount + 1 })
        .where(eq(tournaments.id, finalTournament.id));

    // Auto-register qualified wallets
    for (const standing of standings) {
        await registerWallet(finalTournament.id, standing.wallet);
    }

    // Update season status to 'final'
    await db
        .update(seasons)
        .set({
            status: 'final',
            currentWeek: config.weekCount + 1,
            updatedAt: new Date(),
        })
        .where(eq(seasons.id, seasonId));

    console.log(
        `[SeasonManager] Season ${seasonId}: Qualified ${standings.length} wallets for Final ` +
        `(tournament ${finalTournament.id})`,
    );
}

// --------------------------------------------------------------------------
// 6. Complete the season — called after the Final tournament completes
// --------------------------------------------------------------------------
export async function completeSeason(seasonId: number): Promise<void> {
    const [season] = await db
        .select()
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .limit(1);

    if (!season) throw new Error('Season not found');
    if (season.status !== 'final') {
        throw new Error(`Cannot complete season in "${season.status}" status — must be in "final"`);
    }

    // Verify the Final tournament is completed
    const config = { ...DEFAULT_SEASON_CONFIG, ...(season.config as Partial<SeasonConfig>) };
    const finalWeekNumber = config.weekCount + 1;

    const [finalTournament] = await db
        .select()
        .from(tournaments)
        .where(
            and(
                eq(tournaments.seasonId, seasonId),
                eq(tournaments.weekNumber, finalWeekNumber),
            ),
        )
        .limit(1);

    if (!finalTournament) {
        throw new Error('Final tournament not found');
    }

    if (finalTournament.status !== 'completed') {
        throw new Error(
            `Final tournament (${finalTournament.id}) is not completed ` +
            `(status: ${finalTournament.status})`,
        );
    }

    // Award final points (same scheme as weekly)
    await awardWeeklyPoints(seasonId, finalTournament.id, config.pointsScheme);

    // Mark season as completed
    await db
        .update(seasons)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(seasons.id, seasonId));

    console.log(`[SeasonManager] Season ${seasonId} completed!`);
}

// --------------------------------------------------------------------------
// 7. Get season standings
// --------------------------------------------------------------------------
export async function getSeasonStandings(seasonId: number) {
    const standings = await db
        .select()
        .from(seasonStandings)
        .where(eq(seasonStandings.seasonId, seasonId))
        .orderBy(desc(seasonStandings.totalPoints));

    return standings;
}

// --------------------------------------------------------------------------
// 8. Get season details with tournaments
// --------------------------------------------------------------------------
export async function getSeasonDetails(seasonId: number) {
    const [season] = await db
        .select()
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .limit(1);

    if (!season) return null;

    const seasonTournaments = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.seasonId, seasonId));

    // Sort by week number
    seasonTournaments.sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0));

    return {
        ...season,
        tournaments: seasonTournaments,
    };
}
