// ============================================================================
// Frontend API Client — talks to our Express backend at /api
//
// IMPORTANT: Field names must match what Drizzle ORM returns.
// Drizzle maps DB column names (snake_case) to JS property names (camelCase).
// Example: DB column `created_at` → JS property `createdAt`
// ============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface ApiResponse<T> {
    success: boolean;
    error: string | null;
    data: T;
}

async function apiFetch<T>(
    path: string,
    options?: RequestInit,
): Promise<T> {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    const json: ApiResponse<T> = await res.json();

    if (!json.success) {
        throw new Error(json.error || 'API request failed');
    }

    return json.data;
}

// --- Tournament Types (camelCase — matches Drizzle output) ---

export interface Tournament {
    id: number;
    name: string;
    status: 'registration' | 'active' | 'completed' | 'cancelled';
    config: {
        bracketSize: number;
        advanceRatio: number;
        roundDurations: number[];
        minPositionCollateral: number;
        minTradeDurationSec: number;
        leveragePenaltyThreshold: number;
        supportedAssetCount: number;
        useHistoricalWindow: boolean;
        historicalWindowDays: number;
    };
    createdAt: string;
    updatedAt: string;
}

export interface Round {
    id: number;
    tournamentId: number;
    roundNumber: number;
    name: string;
    type: 'main' | 'consolation';
    startTime: string;
    endTime: string;
    status: 'pending' | 'active' | 'completed';
}

export interface BracketEntry {
    id: number;
    bracketId: number;
    wallet: string;
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    cpiScore: number;
    eliminated: boolean;
    advanced: boolean;
}

export interface Bracket {
    id: number;
    roundId: number;
    bracketNumber: number;
    entries: BracketEntry[];
}

export interface TournamentState extends Tournament {
    rounds: Round[];
    registrationCount: number;
}

export interface LeaderboardEntry {
    wallet: string;
    cpiScore: number;
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    lastRound: number;
    eliminated: boolean;
    advanced: boolean;
}

export interface TraderRound {
    roundNumber: number;
    roundName: string;
    bracketNumber: number;
    scores: {
        pnlScore: number;
        riskScore: number;
        consistencyScore: number;
        activityScore: number;
        cpiScore: number;
    };
    eliminated: boolean;
    advanced: boolean;
}

export interface TraderProfile {
    wallet: string;
    tournament: { id: number; name: string };
    rounds: TraderRound[];
}

// --- API Functions ---

export async function listTournaments(): Promise<Tournament[]> {
    return apiFetch<Tournament[]>('/api/tournaments');
}

export async function getTournament(id: number): Promise<TournamentState> {
    return apiFetch<TournamentState>(`/api/tournaments/${id}`);
}

export async function getTournamentBrackets(
    tournamentId: number,
    roundId?: number,
): Promise<{ round: Round | null; brackets: Bracket[] }> {
    const query = roundId ? `?roundId=${roundId}` : '';
    return apiFetch(`/api/tournaments/${tournamentId}/brackets${query}`);
}

export async function registerWallet(
    tournamentId: number,
    wallet: string,
): Promise<{ registered: boolean; reason?: string }> {
    return apiFetch('/api/register', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, wallet }),
    });
}

export async function getRegistrations(
    tournamentId: number,
): Promise<Array<{ id: number; wallet: string; registeredAt: string }>> {
    return apiFetch(`/api/register/${tournamentId}`);
}

export async function getBracket(bracketId: number): Promise<Bracket> {
    return apiFetch(`/api/brackets/${bracketId}`);
}

export async function getTraderProfile(
    tournamentId: number,
    wallet: string,
): Promise<TraderProfile> {
    return apiFetch(`/api/brackets/traders/${wallet}?tournamentId=${tournamentId}`);
}

export async function getLeaderboard(
    tournamentId: number,
): Promise<{ totalRounds: number; entries: LeaderboardEntry[] }> {
    return apiFetch(`/api/brackets/leaderboard/${tournamentId}`);
}

// --- Analytics Types ---

export interface RoundStats {
    roundNumber: number;
    roundName: string;
    roundType: 'main' | 'consolation';
    traderCount: number;
    eliminatedCount: number;
    advancedCount: number;
    avgCpi: number;
    minCpi: number;
    maxCpi: number;
    avgPnl: number;
    avgRisk: number;
    avgConsistency: number;
    avgActivity: number;
}

export interface TournamentAnalytics {
    tournament: {
        id: number;
        name: string;
        status: string;
        totalRounds: number;
        totalTraders: number;
        totalRegistrations: number;
        season: {
            id: number;
            name: string;
            weekNumber: number;
            currentWeek: number;
            status: string;
        } | null;
    };
    roundStats: RoundStats[];
    scoreDistribution: Array<{ bucket: string; count: number }>;
    componentInsights: {
        advancedAvg: { pnl: number; risk: number; consistency: number; activity: number };
        eliminatedAvg: { pnl: number; risk: number; consistency: number; activity: number };
    } | null;
    topPerformers: Array<{
        wallet: string;
        cpiScore: number;
        roundNumber: number;
        roundName: string;
    }>;
    categoryData: {
        allAround: Array<{ wallet: string; score: number; scoreDate: string }>;
        fisher: Array<{ wallet: string; score: number; scoreDate: string }>;
    };
}

export async function getTournamentAnalytics(
    tournamentId: number,
): Promise<TournamentAnalytics> {
    return apiFetch(`/api/brackets/analytics/${tournamentId}`);
}

// --- Admin Functions ---

export async function createTournament(
    name: string,
    config?: Partial<Tournament['config']>,
    adminSecret?: string,
): Promise<{ id: number }> {
    return apiFetch('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify({ name, config }),
        headers: adminSecret ? { 'X-Admin-Secret': adminSecret } : {},
    });
}

export async function adminStartTournament(
    tournamentId: number,
    adminSecret: string,
): Promise<{ roundId: number; bracketCount: number }> {
    return apiFetch('/api/admin/start', {
        method: 'POST',
        body: JSON.stringify({ tournamentId }),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminComputeScores(
    roundId: number,
    adminSecret: string,
): Promise<{ scoredCount: number }> {
    return apiFetch(`/api/admin/score/${roundId}`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminAdvanceRound(
    tournamentId: number,
    adminSecret: string,
): Promise<{ nextRoundId?: number; advanced?: number; eliminated?: number; completed?: boolean }> {
    return apiFetch('/api/admin/advance', {
        method: 'POST',
        body: JSON.stringify({ tournamentId }),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function updateTournament(
    id: number,
    updates: { name?: string; config?: Partial<Tournament['config']> },
    adminSecret: string,
): Promise<Tournament> {
    return apiFetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function deleteTournament(
    id: number,
    adminSecret: string,
): Promise<{ id: number; name: string; deleted: boolean }> {
    return apiFetch(`/api/tournaments/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminCancelTournament(
    tournamentId: number,
    adminSecret: string,
): Promise<{ id: number; status: string }> {
    return apiFetch(`/api/admin/cancel/${tournamentId}`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

// --- Season Types ---

export interface Season {
    id: number;
    name: string;
    status: 'registration' | 'active' | 'final' | 'completed';
    config: {
        weekCount: number;
        qualificationSlots: number;
        tournamentConfig: Tournament['config'];
        pointsScheme: {
            winner: number;
            second: number;
            third: number;
            finalist: number;
            eliminatedR2: number;
            eliminatedR1: number;
            consolationWinner: number;
            consolationSecond: number;
            consolationThird: number;
            registered: number;
        };
    };
    currentWeek: number;
    createdAt: string;
    updatedAt: string;
}

export interface SeasonWithTournaments extends Season {
    tournaments: Tournament[];
}

export interface SeasonStanding {
    id: number;
    seasonId: number;
    wallet: string;
    totalPoints: number;
    weeksParticipated: number;
    bestPlacement: number | null;
    qualifiedForFinal: boolean;
}

// --- Category Types ---

export interface CategoryLeaderboardEntry {
    wallet: string;
    totalScore: number;
    daysScored: number;
}

export interface DailyCategoryScore {
    id: number;
    tournamentId: number;
    seasonId: number | null;
    wallet: string;
    category: string;
    scoreDate: string;
    score: number;
    details: unknown;
    computedAt: string;
}

// --- Season API Functions ---

export async function listSeasons(): Promise<Season[]> {
    return apiFetch<Season[]>('/api/seasons');
}

export async function getSeason(id: number): Promise<SeasonWithTournaments> {
    return apiFetch<SeasonWithTournaments>(`/api/seasons/${id}`);
}

export async function getSeasonStandings(seasonId: number): Promise<SeasonStanding[]> {
    return apiFetch<SeasonStanding[]>(`/api/seasons/${seasonId}/standings`);
}

export async function adminCreateSeason(
    name: string,
    config: Partial<Season['config']>,
    adminSecret: string,
): Promise<{ id: number }> {
    return apiFetch('/api/seasons', {
        method: 'POST',
        body: JSON.stringify({ name, config }),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminStartSeason(
    seasonId: number,
    adminSecret: string,
): Promise<{ tournamentId: number }> {
    return apiFetch(`/api/seasons/${seasonId}/start`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminAdvanceSeason(
    seasonId: number,
    adminSecret: string,
): Promise<{ nextTournamentId?: number; seasonStatus: string }> {
    return apiFetch(`/api/seasons/${seasonId}/advance`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminCompleteSeason(
    seasonId: number,
    adminSecret: string,
): Promise<{ seasonId: number; status: string }> {
    return apiFetch(`/api/seasons/${seasonId}/complete`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

// --- Category API Functions ---

export async function getCategoryLeaderboard(
    tournamentId: number,
    category: 'all-around' | 'fisher',
): Promise<CategoryLeaderboardEntry[]> {
    return apiFetch<CategoryLeaderboardEntry[]>(`/api/categories/${tournamentId}/${category}`);
}

export async function getDailyScores(
    tournamentId: number,
    category: 'all-around' | 'fisher',
    date: string,
): Promise<DailyCategoryScore[]> {
    return apiFetch<DailyCategoryScore[]>(`/api/categories/${tournamentId}/${category}/${date}`);
}
