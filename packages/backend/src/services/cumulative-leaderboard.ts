// ============================================================================
// Cumulative Leaderboard — Phase 5 item 20
//
// Aggregates leaderboard data across 3 views:
//   - Tournament: current active tournament's top N by finalScore (slim — D-20.8).
//   - Season:     current active season's standings (uses existing seasonStandings).
//   - All-time:   cumulative finalScore across all tournaments + formats + FF (D-20.9).
//
// Compute strategy: ON-DEMAND per request (D-20.4). Phase 6 will add caching.
// Cross-format: all participants regardless of Forge/Gauntlet (D-20.9). FF participants
// included naturally via bracketEntries which span main + consolation rounds (verified
// in final-score.ts:computeFinalScores — iterates all rounds for the tournament).
// ============================================================================

import { eq, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tournaments, seasons, seasonStandings } from '../db/schema.js';
import { computeFinalScores } from './final-score.js';
import { resolveConfig } from '../types.js';
import { createCache } from './cache.js';

// Slim shape for Tournament tab (D-20.8 — top N + link to full /leaderboard/:id)
export interface CumulativeTournamentEntry {
    rank: number;
    wallet: string;
    finalScore: number;
    cpiScore: number;
    questPoints: number;
}

export interface CumulativeSeasonEntry {
    rank: number;
    wallet: string;
    totalPoints: number;
    weeksParticipated: number;
    bestPlacement: number | null;
}

export interface CumulativeAllTimeEntry {
    rank: number;
    wallet: string;
    totalFinalScore: number;
    tournamentsPlayed: number;
}

export interface CumulativeLeaderboardData {
    current: {
        tournament: { id: number; name: string; status: string; format: string } | null;
        topEntries: CumulativeTournamentEntry[];
    };
    season: {
        season: { id: number; name: string; currentWeek: number; status: string } | null;
        standings: CumulativeSeasonEntry[];
    };
    allTime: {
        standings: CumulativeAllTimeEntry[];
        totalTournaments: number;
    };
}

const TOURNAMENT_TAB_TOP_N = 10;
const ALL_TIME_TOP_N = 100; // cap rendering payload

// Phase 6 — TTL cache for the bundled cumulative payload.
// Single global key: payload reflects DB-wide state; per-tournament filtering happens inside.
const cumulativeCache = createCache<CumulativeLeaderboardData>();
const CUMULATIVE_CACHE_KEY = 'cumulative-leaderboard:global';

export async function computeCumulativeLeaderboard(): Promise<CumulativeLeaderboardData> {
    // Phase 6: TTL cache check.
    const cached = cumulativeCache.get(CUMULATIVE_CACHE_KEY);
    if (cached) return cached;

    // --- Tournament tab — current active (singleton per item 21) ---
    // Fallback chain matches /forge redirector + layout.tsx Tournament-link logic:
    // active → most-recent completed → most-recent overall.
    const allTournaments = await db
        .select()
        .from(tournaments)
        .orderBy(desc(tournaments.createdAt));

    const currentTournament =
        allTournaments.find((t) => t.status === 'active')
        ?? allTournaments.find((t) => t.status === 'completed')
        ?? allTournaments[0]
        ?? null;

    let currentTab: CumulativeLeaderboardData['current'] = {
        tournament: null,
        topEntries: [],
    };

    if (currentTournament) {
        const config = resolveConfig(currentTournament.config);
        const fullEntries = await computeFinalScores(currentTournament.id, config);
        // Tie-aware competition rank, then slice to top N (slim view — D-20.8).
        let currentRank = 1;
        const ranked = fullEntries.map((e, i) => {
            if (i > 0 && e.finalScore !== fullEntries[i - 1].finalScore) {
                currentRank = i + 1;
            }
            return { rank: currentRank, ...e };
        });
        currentTab = {
            tournament: {
                id: currentTournament.id,
                name: currentTournament.name,
                status: currentTournament.status,
                format: config.format,
            },
            topEntries: ranked.slice(0, TOURNAMENT_TAB_TOP_N).map((r) => ({
                rank: r.rank,
                wallet: r.wallet,
                finalScore: r.finalScore,
                cpiScore: r.cpiScore,
                questPoints: r.questPoints,
            })),
        };
    }

    // --- Season tab — current active season standings ---
    const allSeasons = await db
        .select()
        .from(seasons)
        .orderBy(desc(seasons.createdAt));

    const currentSeason =
        allSeasons.find((s) => s.status === 'active')
        ?? allSeasons.find((s) => s.status === 'final')
        ?? allSeasons.find((s) => s.status === 'completed')
        ?? allSeasons[0]
        ?? null;

    let seasonTab: CumulativeLeaderboardData['season'] = {
        season: null,
        standings: [],
    };

    if (currentSeason) {
        const standings = await db
            .select()
            .from(seasonStandings)
            .where(eq(seasonStandings.seasonId, currentSeason.id))
            .orderBy(desc(seasonStandings.totalPoints), asc(seasonStandings.wallet));

        // Tie-aware competition rank.
        let rank = 1;
        const ranked = standings.map((s, i) => {
            if (i > 0 && s.totalPoints !== standings[i - 1].totalPoints) {
                rank = i + 1;
            }
            return { rank, ...s };
        });

        seasonTab = {
            season: {
                id: currentSeason.id,
                name: currentSeason.name,
                currentWeek: currentSeason.currentWeek,
                status: currentSeason.status,
            },
            standings: ranked.map((r) => ({
                rank: r.rank,
                wallet: r.wallet,
                totalPoints: r.totalPoints,
                weeksParticipated: r.weeksParticipated,
                bestPlacement: r.bestPlacement,
            })),
        };
    }

    // --- All-time tab — cross-tournament finalScore aggregation (D-20.1, D-20.9) ---
    // For each tournament: compute finalScores → fold into per-wallet running sum.
    // Zero-fill is implicit (D-20.2): wallets that didn't play a tournament don't get
    // a contribution from it, so their total sum is naturally lower than wallets who
    // played more tournaments at the same per-tournament score level.
    //
    // Cross-format (D-20.9): computeFinalScores is format-agnostic and includes all
    // bracketEntries (main + consolation FF). No format filter applied.
    const walletAgg = new Map<string, { total: number; count: number }>();

    for (const t of allTournaments) {
        const config = resolveConfig(t.config);
        let entries;
        try {
            entries = await computeFinalScores(t.id, config);
        } catch (err) {
            console.error(`[CumulativeLB] computeFinalScores failed for tournament ${t.id}:`, err);
            continue; // skip this tournament, keep going for the rest
        }
        for (const e of entries) {
            const prev = walletAgg.get(e.wallet) ?? { total: 0, count: 0 };
            walletAgg.set(e.wallet, {
                total: prev.total + e.finalScore,
                count: prev.count + 1,
            });
        }
    }

    // Sort by total DESC, alphabetical wallet for stable tiebreak.
    const sortedAll = [...walletAgg.entries()]
        .map(([wallet, agg]) => ({ wallet, ...agg }))
        .sort((a, b) => b.total - a.total || a.wallet.localeCompare(b.wallet));

    // Tie-aware competition rank, then cap at ALL_TIME_TOP_N for payload size.
    let allTimeRank = 1;
    const rankedAll = sortedAll.map((r, i) => {
        if (i > 0 && r.total !== sortedAll[i - 1].total) {
            allTimeRank = i + 1;
        }
        return {
            rank: allTimeRank,
            wallet: r.wallet,
            totalFinalScore: r.total,
            tournamentsPlayed: r.count,
        };
    }).slice(0, ALL_TIME_TOP_N);

    const result: CumulativeLeaderboardData = {
        current: currentTab,
        season: seasonTab,
        allTime: {
            standings: rankedAll,
            totalTournaments: allTournaments.length,
        },
    };

    // Phase 6: write-through cache.
    cumulativeCache.set(CUMULATIVE_CACHE_KEY, result);
    return result;
}
