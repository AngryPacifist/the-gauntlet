// ============================================================================
// Season Manager
//
// Manages the weekly season lifecycle:
//   1. Create a season (container for weekly gauntlets)
//   2. Start the season (creates Week 1 tournament)
//   3. Advance weeks (after each weekly tournament completes)
//   4. Qualify for the Season Final (all participants, seeded by standings)
//   5. Complete the season (after the Final tournament completes)
//
// A season contains `weekCount` weekly gauntlets + 1 Season Final.
// Each weekly gauntlet is a full tournament (bracket → rounds → scoring).
// The season tracks aggregate points across all weeks for qualification.
//
// Points scheme (per weekly tournament placement):
//   Winner: 25, 2nd: 18, 3rd: 15, 4th: 12, 5th: 10, Other Finalist: 8,
//   Passing R1: 3, FF 1st: 6, FF 2nd: 4, FF 3rd: 3, Other FF: 1
//
// Daily category season points (awarded each UTC day):
//   Fisher (top 3 per direction): 3 / 2 / 1
//   All Around (top 3 by score): 3 / 2 / 1
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
    seasonRegistrations,
    dailyCategoryScores,
} from '../db/schema.js';
import { createTournament, registerWallet } from './tournament-manager.js';
import type { SeasonConfig, SeasonPointsScheme, FisherDetails } from '../types.js';
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
//   - Finalists = wallets that advanced through all main rounds
//   - Winner/2nd/3rd/4th/5th = top CPI among finalists
//   - Other Finalist = remaining finalists beyond 5th
//   - Passing R1 = wallets eliminated in R2+ (survived R1)
//   - FF participants = all eliminated wallets, ranked by CPI
//   - R1-eliminated wallets earn only FF-based points
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

    // Track wallet placements
    const walletPoints = new Map<string, number>();
    const walletPlacements = new Map<string, number>(); // 1 = winner, 2 = 2nd, etc.

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
        } else if (i === 3) {
            walletPoints.set(wallet, pointsScheme.fourth);
        } else if (i === 4) {
            walletPoints.set(wallet, pointsScheme.fifth);
        } else {
            walletPoints.set(wallet, pointsScheme.otherFinalist);
        }
    }

    // Award "Passing R1" points — wallets that survived R1 (eliminated in R2+)
    for (const [wallet, roundNumber] of eliminatedInRound) {
        // Skip if wallet is already a finalist (shouldn't happen, but safety)
        if (walletPlacements.has(wallet)) continue;

        if (roundNumber > 1) {
            // Survived R1, eliminated later — "Passing R1" gives base recognition
            // Their main points will come from FF placement below
            const current = walletPoints.get(wallet) ?? 0;
            walletPoints.set(wallet, Math.max(current, pointsScheme.passingR1));
        }
    }

    // Award Fallen Fighters (consolation) points — all FF participants
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
            pointsScheme.consolationSecond,
            pointsScheme.consolationThird,
        ];
        for (let i = 0; i < consolationFinishers.length; i++) {
            const wallet = consolationFinishers[i].wallet;
            const tierPoints = i < consolationTiers.length
                ? consolationTiers[i]
                : pointsScheme.otherConsolation;
            const currentPoints = walletPoints.get(wallet) ?? 0;
            if (tierPoints > currentPoints) {
                walletPoints.set(wallet, tierPoints);
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
// 4b. Award season points for daily Fisher category results
//
// Top 3 in each Fisher direction (Top Fisher / Bottom Fisher) earn
// 3 / 2 / 1 season points respectively. Uses a sentinel row in
// daily_category_scores to prevent double-awarding.
// --------------------------------------------------------------------------
export async function awardDailyFisherPoints(
    tournamentId: number,
    seasonId: number,
    scoreDate: string, // YYYY-MM-DD
): Promise<void> {
    const SENTINEL_WALLET = '__fisher_season_sentinel__';
    const SENTINEL_CATEGORY = 'fisher_season';
    const SEASON_POINTS = [3, 2, 1]; // 1st, 2nd, 3rd

    // Idempotency check: look for sentinel row
    const [existing] = await db
        .select()
        .from(dailyCategoryScores)
        .where(
            and(
                eq(dailyCategoryScores.tournamentId, tournamentId),
                eq(dailyCategoryScores.wallet, SENTINEL_WALLET),
                eq(dailyCategoryScores.category, SENTINEL_CATEGORY),
                eq(dailyCategoryScores.scoreDate, scoreDate),
            ),
        )
        .limit(1);

    if (existing) {
        console.log(
            `[SeasonManager] Fisher season points already awarded for tournament ${tournamentId} ` +
            `date ${scoreDate}. Skipping.`,
        );
        return;
    }

    // Read Fisher scores for this date
    const fisherRows = await db
        .select()
        .from(dailyCategoryScores)
        .where(
            and(
                eq(dailyCategoryScores.tournamentId, tournamentId),
                eq(dailyCategoryScores.category, 'fisher'),
                eq(dailyCategoryScores.scoreDate, scoreDate),
            ),
        );

    if (fisherRows.length === 0) {
        console.log(
            `[SeasonManager] No Fisher scores found for tournament ${tournamentId} ` +
            `date ${scoreDate}. Skipping Fisher season points.`,
        );
        return;
    }

    // Collect wallets with top-3 ranks in long or short direction
    const pointsToAward = new Map<string, number>(); // wallet → total points to add

    for (const row of fisherRows) {
        const details = row.details as FisherDetails;

        // Check long entry rank
        if (details.longEntry?.rank && details.longEntry.rank <= 3) {
            const pts = SEASON_POINTS[details.longEntry.rank - 1];
            const current = pointsToAward.get(row.wallet) ?? 0;
            pointsToAward.set(row.wallet, current + pts);
        }

        // Check short entry rank
        if (details.shortEntry?.rank && details.shortEntry.rank <= 3) {
            const pts = SEASON_POINTS[details.shortEntry.rank - 1];
            const current = pointsToAward.get(row.wallet) ?? 0;
            pointsToAward.set(row.wallet, current + pts);
        }
    }

    // Upsert season standings with Fisher points
    for (const [wallet, pts] of pointsToAward) {
        const [existingStanding] = await db
            .select()
            .from(seasonStandings)
            .where(
                and(
                    eq(seasonStandings.seasonId, seasonId),
                    eq(seasonStandings.wallet, wallet),
                ),
            )
            .limit(1);

        if (existingStanding) {
            await db
                .update(seasonStandings)
                .set({ totalPoints: existingStanding.totalPoints + pts })
                .where(eq(seasonStandings.id, existingStanding.id));
        } else {
            await db.insert(seasonStandings).values({
                seasonId,
                wallet,
                totalPoints: pts,
                weeksParticipated: 0,
                bestPlacement: null,
            });
        }
    }

    // Write sentinel row to mark this date as processed
    await db.insert(dailyCategoryScores).values({
        tournamentId,
        seasonId,
        wallet: SENTINEL_WALLET,
        category: SENTINEL_CATEGORY,
        scoreDate,
        score: 0,
        details: {},
    });

    console.log(
        `[SeasonManager] Awarded Fisher season points for tournament ${tournamentId} ` +
        `date ${scoreDate}: ${pointsToAward.size} wallets.`,
    );
}

// --------------------------------------------------------------------------
// 4c. Award season points for daily All Around category results
//
// Top 3 wallets by All Around score earn 3 / 2 / 1 season points
// respectively. Uses a sentinel row in daily_category_scores to
// prevent double-awarding (same pattern as Fisher).
// --------------------------------------------------------------------------
export async function awardDailyAllAroundPoints(
    tournamentId: number,
    seasonId: number,
    scoreDate: string, // YYYY-MM-DD
): Promise<void> {
    const SENTINEL_WALLET = '__all_around_season_sentinel__';
    const SENTINEL_CATEGORY = 'all_around_season';
    const SEASON_POINTS = [3, 2, 1]; // 1st, 2nd, 3rd

    // Idempotency check: look for sentinel row
    const [existing] = await db
        .select()
        .from(dailyCategoryScores)
        .where(
            and(
                eq(dailyCategoryScores.tournamentId, tournamentId),
                eq(dailyCategoryScores.wallet, SENTINEL_WALLET),
                eq(dailyCategoryScores.category, SENTINEL_CATEGORY),
                eq(dailyCategoryScores.scoreDate, scoreDate),
            ),
        )
        .limit(1);

    if (existing) {
        console.log(
            `[SeasonManager] All Around season points already awarded for tournament ${tournamentId} ` +
            `date ${scoreDate}. Skipping.`,
        );
        return;
    }

    // Read All Around scores for this date, sorted by score descending
    const allAroundRows = await db
        .select()
        .from(dailyCategoryScores)
        .where(
            and(
                eq(dailyCategoryScores.tournamentId, tournamentId),
                eq(dailyCategoryScores.category, 'all_around'),
                eq(dailyCategoryScores.scoreDate, scoreDate),
            ),
        )
        .orderBy(desc(dailyCategoryScores.score));

    if (allAroundRows.length === 0) {
        console.log(
            `[SeasonManager] No All Around scores found for tournament ${tournamentId} ` +
            `date ${scoreDate}. Skipping All Around season points.`,
        );
        return;
    }

    // Award 3/2/1 to top 3 by score (skip zero-score wallets)
    const pointsToAward = new Map<string, number>();

    for (let i = 0; i < Math.min(allAroundRows.length, SEASON_POINTS.length); i++) {
        const row = allAroundRows[i];
        if (row.score > 0) {
            pointsToAward.set(row.wallet, SEASON_POINTS[i]);
        }
    }

    if (pointsToAward.size === 0) {
        console.log(
            `[SeasonManager] All wallets scored 0 for All Around on ${scoreDate}. ` +
            `No season points awarded.`,
        );
        return;
    }

    // Upsert season standings with All Around points
    for (const [wallet, pts] of pointsToAward) {
        const [existingStanding] = await db
            .select()
            .from(seasonStandings)
            .where(
                and(
                    eq(seasonStandings.seasonId, seasonId),
                    eq(seasonStandings.wallet, wallet),
                ),
            )
            .limit(1);

        if (existingStanding) {
            await db
                .update(seasonStandings)
                .set({ totalPoints: existingStanding.totalPoints + pts })
                .where(eq(seasonStandings.id, existingStanding.id));
        } else {
            await db.insert(seasonStandings).values({
                seasonId,
                wallet,
                totalPoints: pts,
                weeksParticipated: 0,
                bestPlacement: null,
            });
        }
    }

    // Write sentinel row to mark this date as processed
    await db.insert(dailyCategoryScores).values({
        tournamentId,
        seasonId,
        wallet: SENTINEL_WALLET,
        category: SENTINEL_CATEGORY,
        scoreDate,
        score: 0,
        details: {},
    });

    console.log(
        `[SeasonManager] Awarded All Around season points for tournament ${tournamentId} ` +
        `date ${scoreDate}: ${pointsToAward.size} wallets.`,
    );
}

// --------------------------------------------------------------------------
// 5. Qualify ALL season participants for the Season Final
//
// All season participants enter the Final tournament. Brackets are seeded
// by season standing — the seeded order is stored in the tournament's
// config JSONB as seededWallets, which startTournament reads.
// --------------------------------------------------------------------------
async function qualifyForFinal(
    seasonId: number,
    config: SeasonConfig,
): Promise<void> {
    // Get ALL wallets with season standings, ordered by total points
    const standings = await db
        .select()
        .from(seasonStandings)
        .where(eq(seasonStandings.seasonId, seasonId))
        .orderBy(desc(seasonStandings.totalPoints));

    if (standings.length === 0) {
        console.warn(`[SeasonManager] No standings found for season ${seasonId}. Cannot qualify.`);
        return;
    }

    // Mark all as qualified
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

    // Store seeded order in tournament config for startTournament to read
    const seededOrder = standings.map(s => s.wallet);
    const finalConfig = {
        ...config.tournamentConfig,
        seededWallets: seededOrder,
    };

    const finalName = `${season?.name ?? 'Season'} — Grand Final`;
    const finalTournament = await createTournament(finalName, finalConfig);

    // Link to season
    await db
        .update(tournaments)
        .set({ seasonId, weekNumber: config.weekCount + 1 })
        .where(eq(tournaments.id, finalTournament.id));

    // Auto-register all participants
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
        `(tournament ${finalTournament.id}, seeded brackets)`,
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
