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
        roundDurationHours: number;
        minHistoricalTrades: number;
        minPositionCollateral: number;
        minTradeDurationSec: number;
        maxDaysInactive: number;
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
    eligibleCount: number;
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
): Promise<{ round: Round | null; brackets: Bracket[] }> {
    return apiFetch(`/api/tournaments/${tournamentId}/brackets`);
}

export async function registerWallet(
    tournamentId: number,
    wallet: string,
): Promise<{ eligible: boolean; reason?: string }> {
    return apiFetch('/api/register', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, wallet }),
    });
}

export async function getRegistrations(
    tournamentId: number,
): Promise<Array<{ id: number; wallet: string; eligible: boolean; registeredAt: string }>> {
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
