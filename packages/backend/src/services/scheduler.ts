// ============================================================================
// Tournament Scheduler
//
// Uses node-cron to automate tournament operations:
//   1. Score refresh: every 15 minutes, compute scores for all active rounds
//   2. Round advancement: check if any active round's endTime has passed,
//      and if so, advance the tournament to the next round
//   3. Daily category scoring: midnight UTC, compute All Around + Fisher
//      (Bottom Fisher = longs near low, Top-Tick Traveler = shorts near high)
//      scores for all registered wallets in active tournaments
//   4. Hourly provisional category scoring: every hour, compute provisional
//      scores using intraday OHLC; overwrites safely via upsert, finalized
//      by the midnight job
//
// Updated to handle multiple active rounds per tournament (main + consolation).
// A tournament can have both a main active round and a consolation active round
// running simultaneously.
//
// Wired into the server lifecycle via start() and stop() functions.
// ============================================================================

import cron from 'node-cron';
import { db } from '../db/index.js';
import { tournaments, rounds, registrations } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { computeRoundScores, advanceRound } from './tournament-manager.js';
import { awardDailyFisherPoints, awardDailyAllAroundPoints, awardDaily2DayCategoryPoints } from './season-manager.js';
import { AdrenaClient } from './adrena-client.js';
import { resolveConfig } from '../types.js';
import { fetchDailyOHLCBatch, fetchIntradayOHLCBatch } from './pyth-client.js';
import {
    computeAllAroundScore,
    computeFisherScores,
    computeRiskManagerScores,
    computeHumbleOneScores,
    saveDailyCategoryScores,
} from './category-engine.js';
import type { AdrenaPosition, CategoryScoreRow } from '../types.js';
import { evaluateLeverageProgress, computeLeverageMasterLeaderboard } from './quest-engine.js';

const schedulerAdrenaClient = new AdrenaClient();

let scoreTask: cron.ScheduledTask | null = null;
let advanceTask: cron.ScheduledTask | null = null;
let categoryTask: cron.ScheduledTask | null = null;
let hourlyCategoryTask: cron.ScheduledTask | null = null;
let isHourlyScoringRunning = false;

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

                    // Advance to next round; pass the round type so main/consolation
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
// Daily Category Scoring: runs at midnight UTC (0 0 * * *)
//
// For each active tournament:
//   1. Get yesterday's date (the day that just ended)
//   2. Fetch OHLC data from Pyth for all supported assets
//   3. Compute daily scores: All Around, Top-Tick Traveler, Bottom Fisher
//   4. On even-numbered days: compute 2-day window scores (Risk Manager, Humble One)
//   5. Persist results to daily_category_scores table via idempotent upsert
//   6. Award daily category season points if applicable
// --------------------------------------------------------------------------
async function scoreDailyCategories(): Promise<void> {
    try {
        const activeTournaments = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.status, 'active'));

        if (activeTournaments.length === 0) return;

        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // Rolling re-score window. Each midnight tick scores yesterday
        // (canonical) + yesterday-1 + yesterday-2 (rescore). Catches cross-day
        // closes whose entry-day daily-category attribution would otherwise
        // be missed (entry-day finalized when the trade was still open).
        // Days older than 3 are not rescored; diminishing returns vs cost.
        const datesToScore: Date[] = [
            new Date(yesterday.getTime() - 2 * 24 * 60 * 60 * 1000),  // yesterday-2
            new Date(yesterday.getTime() - 1 * 24 * 60 * 60 * 1000),  // yesterday-1
            yesterday,                                                  // canonical
        ];

        for (const tournament of activeTournaments) {
            // Resolve config once per tournament for engine threading
            const config = resolveConfig(tournament.config);
            const seasonId = tournament.seasonId ?? null;

            // Get all registered wallets
            const regs = await db
                .select()
                .from(registrations)
                .where(eq(registrations.tournamentId, tournament.id));

            if (regs.length === 0) continue;

            // Fetch positions ONCE per tournament (positions are wallet-keyed,
            // not date-keyed). Reused across all 3 date scoring passes.
            const walletPositions = new Map<string, AdrenaPosition[]>();
            for (const reg of regs) {
                try {
                    const positions = await schedulerAdrenaClient.getPositions(reg.wallet);
                    walletPositions.set(reg.wallet, positions);
                } catch (error) {
                    console.warn(
                        `[Scheduler] Failed to fetch positions for ${reg.wallet}:`,
                        error instanceof Error ? error.message : error,
                    );
                }
            }

            // Determine tournament trading start (anchors quest week + skips
            // pre-tournament dates in the rolling window)
            const [firstRound] = await db
                .select({ startTime: rounds.startTime })
                .from(rounds)
                .where(and(
                    eq(rounds.tournamentId, tournament.id),
                    eq(rounds.type, 'main'),
                ))
                .orderBy(asc(rounds.startTime))
                .limit(1);
            if (!firstRound) continue;
            const tradingStart = new Date(firstRound.startTime);
            tradingStart.setUTCHours(0, 0, 0, 0);

            // --- Daily Categories: rolling 3-day rescore window ---
            for (const date of datesToScore) {
                if (date < tradingStart) continue;  // skip pre-tournament dates
                const dateStr = date.toISOString().slice(0, 10);
                const isCanonical = date.getTime() === yesterday.getTime();

                console.log(
                    `[Scheduler] Computing daily category scores for tournament ${tournament.id} ` +
                    `on ${dateStr}${isCanonical ? '' : ' (rolling rescore)'}`,
                );

                // Per-tournament daily OHLC batch (assetList scopes the fetch)
                const ohlcData = await fetchDailyOHLCBatch(dateStr, config.assetList);

                // All Around
                const allAroundRows: CategoryScoreRow[] = [];
                for (const [wallet, positions] of walletPositions) {
                    const details = computeAllAroundScore(positions, dateStr, config);
                    allAroundRows.push({
                        wallet, category: 'all_around',
                        score: details.totalPoints, details,
                    });
                }

                // Fisher (Bottom Fisher = longs, Top-Tick = shorts)
                const fisherResults = computeFisherScores(walletPositions, dateStr, ohlcData, config);
                const bottomFisherRows: CategoryScoreRow[] = [];
                const topTickRows: CategoryScoreRow[] = [];
                for (const [wallet, details] of fisherResults) {
                    bottomFisherRows.push({
                        wallet, category: 'bottom_fisher',
                        score: details.longPoints,
                        details: { longEntry: details.longEntry, totalPoints: details.longPoints },
                    });
                    topTickRows.push({
                        wallet, category: 'top_tick_traveler',
                        score: details.shortPoints,
                        details: { shortEntry: details.shortEntry, totalPoints: details.shortPoints },
                    });
                }

                await saveDailyCategoryScores(
                    tournament.id, seasonId, dateStr,
                    [...allAroundRows, ...topTickRows, ...bottomFisherRows],
                );

                // Award daily-category season points only on the canonical
                // (yesterday) pass. Sentinel rows in season-manager already
                // enforce single-award per (tournament, scoreDate), so this is
                // defense-in-depth; also keeps log noise down on rescore passes.
                if (isCanonical && seasonId !== null) {
                    await awardDailyFisherPoints(tournament.id, seasonId, dateStr);
                    await awardDailyAllAroundPoints(tournament.id, seasonId, dateStr);
                }
            }

            // --- LM Quest Progress + week-boundary leaderboard ---
            // LM block runs ONCE per tick (not per date); quest_progress is
            // week-keyed not date-keyed. evaluateLeverageProgress is idempotent
            // (only flips stepsCompleted false→true). isLastDay anchored to
            // yesterday (canonical) per existing semantics.
            const weekInfo = computeCurrentQuestWeek(firstRound.startTime, yesterdayStr);
            if (weekInfo) {
                for (const [wallet, positions] of walletPositions) {
                    await evaluateLeverageProgress(
                        tournament.id, wallet, positions,
                        weekInfo.weekNumber, weekInfo.weekStart, weekInfo.weekEnd,
                        config,
                    );
                }
                if (weekInfo.isLastDay) {
                    await computeLeverageMasterLeaderboard(
                        tournament.id, weekInfo.weekNumber, yesterdayStr, config, seasonId,
                    );
                }
            }

            // --- 2-Day Engagement Categories: Risk Manager + Humble One ---
            // 2-day scoring lives in the hourly job exclusively. Hourly already
            // rescores RM/HO every hour against current positions, so cross-day
            // closes get attributed implicitly without a separate rolling
            // window here.

            // 2-day season points key on windowStart (odd-day anchor) and only
            // fire on even-day window completion (canonical pass only).
            if (seasonId !== null) {
                const tournamentConfig = tournament.config as Record<string, unknown>;
                if (tournamentConfig?.award2DayCategorySeasonPoints) {
                    const daysSinceStart = Math.floor(
                        (yesterday.getTime() - tradingStart.getTime()) / (24 * 60 * 60 * 1000),
                    );
                    const dayNumber = daysSinceStart + 1;
                    if (dayNumber >= 2 && dayNumber % 2 === 0) {
                        const windowStartDate = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000);
                        const windowStartStr = windowStartDate.toISOString().slice(0, 10);
                        await awardDaily2DayCategoryPoints(tournament.id, seasonId, windowStartStr);
                    }
                }
            }

            console.log(
                `[Scheduler] Daily categories scored for tournament ${tournament.id}: ` +
                `${walletPositions.size} wallets across ${datesToScore.length} dates (rolling)`,
            );
        }
    } catch (error) {
        console.error('[Scheduler] Error scoring daily categories:', error);
    }
}

// --------------------------------------------------------------------------
// Hourly Provisional Category Scoring: runs every hour (0 * * * *)
//
// Mirrors scoreDailyCategories but with key differences:
//   - Targets TODAY (not yesterday)
//   - Uses fetchIntradayOHLCBatch (hourly bars, no DB cache)
//   - Does NOT award season points (sentinel collision risk)
//   - Only scores 2-day categories on even-numbered days (no orphaned data)
//   - Does NOT compute leverage leaderboard (only progress evaluation)
//   - Includes overlap guard (skip if previous run hasn't completed)
// --------------------------------------------------------------------------
async function scoreHourlyCategories(): Promise<void> {
    // Overlap guard: skip if previous hourly run is still executing
    if (isHourlyScoringRunning) {
        console.warn('[Scheduler] Hourly category scoring still running, skipping this tick');
        return;
    }
    isHourlyScoringRunning = true;

    try {
        const activeTournaments = await db
            .select()
            .from(tournaments)
            .where(eq(tournaments.status, 'active'));

        if (activeTournaments.length === 0) return;

        // Today in UTC (the day currently in progress)
        const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // Intraday batch fetch lives INSIDE the per-tournament loop below
        // so each tournament passes its own assetList to fetchIntradayOHLCBatch.

        for (const tournament of activeTournaments) {
            console.log(
                `[Scheduler] Hourly provisional scoring for tournament ${tournament.id} ` +
                `on ${dateStr}`,
            );

            // Resolve config once per tournament for engine threading
            const config = resolveConfig(tournament.config);

            // Per-tournament intraday OHLC batch (must be inside the loop so each tournament's
            // assetList scopes the fetch)
            const intradayOhlc = await fetchIntradayOHLCBatch(dateStr, config.assetList);

            // Get all registered wallets
            const regs = await db
                .select()
                .from(registrations)
                .where(eq(registrations.tournamentId, tournament.id));

            if (regs.length === 0) continue;

            // Fetch positions for all wallets (AdrenaClient 5-min cache helps here)
            const walletPositions = new Map<string, AdrenaPosition[]>();
            for (const reg of regs) {
                try {
                    const positions = await schedulerAdrenaClient.getPositions(reg.wallet);
                    walletPositions.set(reg.wallet, positions);
                } catch (error) {
                    console.warn(
                        `[Scheduler] Failed to fetch positions for ${reg.wallet}:`,
                        error instanceof Error ? error.message : error,
                    );
                }
            }

            // --- Daily Categories: All Around + Fisher ---

            const allAroundRows: CategoryScoreRow[] = [];
            for (const [wallet, positions] of walletPositions) {
                const details = computeAllAroundScore(positions, dateStr, config);
                allAroundRows.push({
                    wallet, category: 'all_around',
                    score: details.totalPoints, details,
                });
            }

            const fisherResults = computeFisherScores(walletPositions, dateStr, intradayOhlc, config);
            const bottomFisherRows: CategoryScoreRow[] = [];
            const topTickRows: CategoryScoreRow[] = [];

            for (const [wallet, details] of fisherResults) {
                bottomFisherRows.push({
                    wallet, category: 'bottom_fisher',
                    score: details.longPoints,
                    details: { longEntry: details.longEntry, totalPoints: details.longPoints },
                });
                topTickRows.push({
                    wallet, category: 'top_tick_traveler',
                    score: details.shortPoints,
                    details: { shortEntry: details.shortEntry, totalPoints: details.shortPoints },
                });
            }

            // Persist daily scores (upsert overwrites previous hourly values)
            const seasonId = tournament.seasonId ?? null;
            await saveDailyCategoryScores(
                tournament.id, seasonId, dateStr,
                [...allAroundRows, ...topTickRows, ...bottomFisherRows],
            );

            // --- 2-Day Engagement Categories: Risk Manager + Humble One ---
            // Scored every day. Hourly job is the sole writer for these
            // categories (midnight job no longer scores them). Convention details
            // in the inner comment block below.

            const [firstRound] = await db
                .select({ startTime: rounds.startTime })
                .from(rounds)
                .where(and(
                    eq(rounds.tournamentId, tournament.id),
                    eq(rounds.type, 'main'),
                ))
                .orderBy(asc(rounds.startTime))
                .limit(1);

            if (firstRound) {
                const tradingStartDate = new Date(firstRound.startTime);
                tradingStartDate.setUTCHours(0, 0, 0, 0);

                const today = new Date(dateStr + 'T00:00:00Z');
                const daysSinceStart = Math.floor(
                    (today.getTime() - tradingStartDate.getTime()) / (24 * 60 * 60 * 1000),
                );
                const dayNumber = daysSinceStart + 1;

                // Always score 2-day categories. windowStart = today on odd days
                // (provisional, partial window [today, today]), yesterday on
                // even days (authoritative, full window [yesterday, today]).
                // Both writes share scoreDate=windowStart → authoritative upserts
                // provisional via PK (tournamentId, wallet, category, scoreDate).
                // Conservation: 1 row per window per wallet.
                if (dayNumber >= 1) {
                    const windowStartDate = dayNumber % 2 === 0
                        ? new Date(today.getTime() - 24 * 60 * 60 * 1000)
                        : today;
                    const windowStartStr = windowStartDate.toISOString().slice(0, 10);

                    console.log(
                        `[Scheduler] Hourly 2-day window [${windowStartStr} - ${dateStr}] ` +
                        `(day ${dayNumber}, ${dayNumber % 2 === 0 ? 'authoritative' : 'provisional'}) ` +
                        `for tournament ${tournament.id}`,
                    );

                    const riskManagerResults = computeRiskManagerScores(
                        walletPositions, windowStartStr, dateStr, config,
                    );
                    const humbleOneResults = computeHumbleOneScores(
                        walletPositions, windowStartStr, dateStr, config,
                    );

                    const engagementRows: CategoryScoreRow[] = [];

                    for (const [wallet, details] of riskManagerResults) {
                        // Inversion fix (see midnight job for full reasoning).
                        engagementRows.push({
                            wallet, category: 'risk_manager',
                            score: details.bestTrade
                                ? (1 - Math.abs(details.bestTrade.roi)) * 100
                                : 0,
                            details,
                        });
                    }
                    for (const [wallet, details] of humbleOneResults) {
                        engagementRows.push({
                            wallet, category: 'humble_one',
                            score: details.bestTrade ? details.bestTrade.roi * 100 : 0,
                            details,
                        });
                    }

                    await saveDailyCategoryScores(
                        tournament.id, seasonId, windowStartStr, engagementRows,
                    );
                }

                // Leverage Master: evaluate progress (idempotent, steps only false→true).
                // No leaderboard computation; that only happens at week boundary (midnight job).
                const weekInfo = computeCurrentQuestWeek(firstRound.startTime, dateStr);
                if (weekInfo) {
                    for (const [wallet, positions] of walletPositions) {
                        await evaluateLeverageProgress(
                            tournament.id, wallet, positions,
                            weekInfo.weekNumber, weekInfo.weekStart, weekInfo.weekEnd,
                            config,
                        );
                    }
                }
            }

            // Intentionally NO season point awards; only the midnight job does this.
            // Awarding here would insert sentinel rows that block midnight's award.

            console.log(
                `[Scheduler] Hourly provisional scores for tournament ${tournament.id}: ` +
                `${walletPositions.size} wallets`,
            );
        }
    } catch (error) {
        console.error('[Scheduler] Error in hourly category scoring:', error);
    } finally {
        isHourlyScoringRunning = false;
    }
}

// --------------------------------------------------------------------------
// Quest Week Calculation
//
// Computes which 7-day quest week the current date falls into, anchored
// to the tournament's first main round start.
// --------------------------------------------------------------------------

function computeCurrentQuestWeek(
    tournamentStartTime: Date,
    currentDateStr: string,
): { weekNumber: number; weekStart: string; weekEnd: string; isLastDay: boolean } | null {
    const startDate = new Date(tournamentStartTime);
    startDate.setUTCHours(0, 0, 0, 0);
    const currentDate = new Date(currentDateStr + 'T00:00:00Z');

    const daysSinceStart = Math.floor(
        (currentDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (daysSinceStart < 0) return null;

    const weekNumber = Math.floor(daysSinceStart / 7) + 1;
    const weekStartOffset = (weekNumber - 1) * 7;
    const weekStart = new Date(startDate.getTime() + weekStartOffset * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    const isLastDay = daysSinceStart === weekStartOffset + 6;

    return {
        weekNumber,
        weekStart: weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        isLastDay,
    };
}

// --------------------------------------------------------------------------
// Start / Stop
// --------------------------------------------------------------------------

export function startScheduler(): void {
    // Score refresh: every 15 minutes (at :00, :15, :30, :45)
    scoreTask = cron.schedule('*/15 * * * *', refreshScores);

    // Round advancement check: every minute
    advanceTask = cron.schedule('* * * * *', checkRoundAdvancement);

    // Daily category scoring: midnight UTC (final, authoritative scores)
    categoryTask = cron.schedule('0 0 * * *', scoreDailyCategories, { timezone: 'UTC' });

    // Hourly provisional category scoring: every hour on the hour
    hourlyCategoryTask = cron.schedule('0 * * * *', scoreHourlyCategories, { timezone: 'UTC' });

    console.log(
        '[Scheduler] Started: score refresh every 15 min, advancement check every 1 min, ' +
        'daily categories at midnight UTC, hourly provisional updates every hour',
    );
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
    if (categoryTask) {
        categoryTask.stop();
        categoryTask = null;
    }
    if (hourlyCategoryTask) {
        hourlyCategoryTask.stop();
        hourlyCategoryTask = null;
    }
    console.log('[Scheduler] Stopped');
}
