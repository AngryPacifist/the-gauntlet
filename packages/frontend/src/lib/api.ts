// ============================================================================
// Frontend API Client — talks to our Express backend at /api
//
// IMPORTANT: Field names must match what Drizzle ORM returns.
// Drizzle maps DB column names (snake_case) to JS property names (camelCase).
// Example: DB column `created_at` → JS property `createdAt`
// ============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Direct backend URL — bypasses Next.js rewrite proxy (which has a 30s timeout)
// Used for admin endpoints that may take longer (e.g. raffle compute hits Adrena API)
const BACKEND_DIRECT = 'http://localhost:3001';

interface ApiResponse<T> {
    success: boolean;
    error: string | null;
    data: T;
}

async function apiFetch<T>(
    path: string,
    options?: RequestInit,
): Promise<T> {
    // Admin paths bypass the Next.js proxy to avoid its 30s timeout
    const base = path.startsWith('/api/admin') ? BACKEND_DIRECT : API_BASE;
    const url = `${base}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    // Handle non-JSON responses (e.g. proxy timeout returning plain text)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
    }

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
        seededWallets?: string[];
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
        topTickTraveler: Array<{ wallet: string; score: number; scoreDate: string }>;
        bottomFisher: Array<{ wallet: string; score: number; scoreDate: string }>;
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
            fourth: number;
            fifth: number;
            otherFinalist: number;
            passingR1: number;
            passingR2: number;
            consolationWinner: number;
            consolationSecond: number;
            consolationThird: number;
            otherConsolation: number;
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

export type CategorySlug =
    | 'all_around'
    | 'top_tick_traveler'
    | 'bottom_fisher'
    | 'risk_manager'
    | 'humble_one'
    | 'leverage_master_long'
    | 'leverage_master_short';

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
    category: CategorySlug,
): Promise<CategoryLeaderboardEntry[]> {
    return apiFetch<CategoryLeaderboardEntry[]>(`/api/categories/${tournamentId}/${category}`);
}

export async function getDailyScores(
    tournamentId: number,
    category: CategorySlug,
    date: string,
): Promise<DailyCategoryScore[]> {
    return apiFetch<DailyCategoryScore[]>(`/api/categories/${tournamentId}/${category}/${date}`);
}

// --- Quest API Functions ---

export interface QuestProgressDetails {
    long: boolean[];
    short: boolean[];
    longCount: number;
    shortCount: number;
    weekNumber: number;
}

export async function getQuestProgress(
    tournamentId: number,
    wallet: string,
    week?: number,
): Promise<QuestProgressDetails> {
    const url = week
        ? `/api/quests/${tournamentId}/${wallet}?week=${week}`
        : `/api/quests/${tournamentId}/${wallet}`;
    return apiFetch<QuestProgressDetails>(url);
}

// --- Raffle API Functions ---

export interface RaffleResult {
    wallet: string;
    finalScore: number;
    cpiScore: number;
    questPoints: number;
    closedPositionCount: number;
    isTopPercent: boolean;
    ticketCount: number;
    isWinner: boolean;
}

export interface RaffleVerification {
    verified: boolean;
    mismatches: string[];
    drawId: number | null;
}

export async function getRaffleResults(tournamentId: number): Promise<RaffleResult[]> {
    return apiFetch<RaffleResult[]>(`/api/raffle/${tournamentId}`);
}

export async function getWalletRaffleInfo(
    tournamentId: number,
    wallet: string,
): Promise<RaffleResult> {
    return apiFetch<RaffleResult>(`/api/raffle/${tournamentId}/${wallet}`);
}

export async function adminComputeRaffle(
    tournamentId: number,
    adminSecret: string,
): Promise<{ total: number; eligible: number; excluded: number }> {
    return apiFetch('/api/admin/raffle/' + tournamentId + '/compute', {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminDrawRaffle(
    tournamentId: number,
    blockHash: string,
    prizeCount: number,
    adminSecret: string,
): Promise<{ winners: string[]; seed: number }> {
    return apiFetch('/api/admin/raffle/' + tournamentId + '/draw', {
        method: 'POST',
        body: JSON.stringify({ blockHash, prizeCount }),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function verifyRaffleDraw(
    tournamentId: number,
): Promise<RaffleVerification> {
    return apiFetch<RaffleVerification>(`/api/raffle/${tournamentId}/verify`);
}

export async function adminScoreCategories(
    tournamentId: number,
    date: string,
    adminSecret: string,
): Promise<{ date: string; tournamentId: number; walletsScored: number; ohlcAssetsAvailable: number }> {
    return apiFetch('/api/categories/score', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, date }),
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

export async function adminResetRaffle(
    tournamentId: number,
    adminSecret: string,
): Promise<{ deletedDraws: number; resetWinners: number }> {
    return apiFetch(`/api/admin/raffle/${tournamentId}/reset`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': adminSecret },
    });
}

// --------------------------------------------------------------------------
// The Forge — Merged Leaderboard
// --------------------------------------------------------------------------

export interface ForgeEntry {
    rank: number;
    wallet: string;
    cpiScore: number;
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    questPoints: number;
    finalScore: number;
    raffleTickets: number;
    isTopPercent: boolean;
}

export interface ForgeLeaderboard {
    tournament: { id: number; name: string; status: string };
    totalParticipants: number;
    top30Cutoff: number;
    entries: ForgeEntry[];
}

export async function getForgeLeaderboard(
    tournamentId: number,
): Promise<ForgeLeaderboard> {
    return apiFetch<ForgeLeaderboard>(`/api/tournaments/${tournamentId}/forge`);
}

// --------------------------------------------------------------------------
// Per-Wallet Quest Breakdown
// --------------------------------------------------------------------------

export interface WalletBreakdown {
    wallet: string;
    tournamentId: number;
    totalQuestPoints: number;
    breakdown: Record<string, { totalScore: number; daysScored: number }>;
}

export async function getWalletBreakdown(
    tournamentId: number,
    wallet: string,
): Promise<WalletBreakdown> {
    return apiFetch<WalletBreakdown>(`/api/categories/${tournamentId}/wallet/${wallet}`);
}
