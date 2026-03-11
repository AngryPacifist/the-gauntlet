// ============================================================================
// Adrena: The Gauntlet — Shared TypeScript Types
// ============================================================================

// --- Tournament ---

export type TournamentStatus = 'registration' | 'active' | 'completed' | 'cancelled';
export type RoundStatus = 'pending' | 'active' | 'completed';
export type RoundName = 'First Blood' | 'The Crucible' | 'Sudden Death' | 'Endgame';
export type RoundType = 'main' | 'consolation';

export const CONSOLATION_ROUND_NAMES = ['Redemption Arc', 'Last Stand', 'Final Reckoning'] as const;

export interface TournamentConfig {
    bracketSize: number;              // Traders per bracket in Round 1 (default: 8)
    advanceRatio: number;             // Fraction that advance per round (default: 0.5)
    roundDurations: number[];         // Duration of each round in hours [R1, R2, R3] (default: [72, 48, 48])
    minPositionCollateral: number;    // Minimum collateral to count a trade (USD, default: 25)
    minTradeDurationSec: number;      // Minimum trade duration to count (seconds, default: 120)
    leveragePenaltyThreshold: number; // Leverage above this is penalized (default: 30)
    supportedAssetCount: number;      // Number of tradeable assets on Adrena (default: 4)
    useHistoricalWindow: boolean;     // If true, scoring uses historical window instead of round dates (default: false)
    historicalWindowDays: number;     // Number of days for historical window (default: 90)
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
    bracketSize: 8,
    advanceRatio: 0.5,
    roundDurations: [72, 48, 48],
    minPositionCollateral: 25,
    minTradeDurationSec: 120,
    leveragePenaltyThreshold: 30,
    supportedAssetCount: 4,
    useHistoricalWindow: false,
    historicalWindowDays: 90,
};

// --- Scoring ---

export interface CPIWeights {
    pnl: number;
    risk: number;
    consistency: number;
    activity: number;
}

export const DEFAULT_CPI_WEIGHTS: CPIWeights = {
    pnl: 0.35,
    risk: 0.25,
    consistency: 0.25,
    activity: 0.15,
};

export interface CPIScores {
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    cpiScore: number;
}

// --- Adrena API Types ---

export interface AdrenaPosition {
    position_id: number;
    user_id: number;
    symbol: string;
    token_account_mint: string;
    side: 'long' | 'short';
    status: 'open' | 'close' | 'liquidate';
    pubkey: string;
    entry_price: number;
    exit_price: number | null;
    entry_size: number;
    pnl: number | null;
    entry_leverage: number;
    entry_date: string;    // ISO 8601
    exit_date: string | null; // ISO 8601
    fees: number;
    collateral_amount: number;
}

export interface AdrenaPositionResponse {
    success: boolean;
    error: string | null;
    data: AdrenaPosition[];
}

export interface AdrenaPoolStats {
    start_date: string;
    end_date: string;
    daily_volume_usd: number;
    total_volume_usd: number;
    daily_fee_usd: number;
    total_fee_usd: number;
    pool_name: string;
}

export interface AdrenaPoolStatsResponse {
    success: boolean;
    error: string | null;
    data: AdrenaPoolStats;
}

// --- Database Row Types ---

export interface TournamentRow {
    id: number;
    name: string;
    status: TournamentStatus;
    config: TournamentConfig;
    created_at: Date;
    updated_at: Date;
}

export interface RoundRow {
    id: number;
    tournament_id: number;
    round_number: number;
    name: string;
    start_time: Date;
    end_time: Date;
    status: RoundStatus;
    type: RoundType;
}

export interface BracketRow {
    id: number;
    round_id: number;
    bracket_number: number;
}

export interface BracketEntryRow {
    id: number;
    bracket_id: number;
    wallet: string;
    pnl_score: number;
    risk_score: number;
    consistency_score: number;
    activity_score: number;
    cpi_score: number;
    eliminated: boolean;
    advanced: boolean;
}

export interface RegistrationRow {
    id: number;
    tournament_id: number;
    wallet: string;
    registered_at: Date;
}

export interface ScoreSnapshotRow {
    id: number;
    bracket_entry_id: number;
    computed_at: Date;
    raw_positions: AdrenaPosition[];
    scores: CPIScores;
}

// --- API Response Types ---

export interface ApiResponse<T> {
    success: boolean;
    error: string | null;
    data: T;
}

export interface TournamentDetail extends TournamentRow {
    rounds: RoundRow[];
    registrationCount: number;
}

export interface BracketDetail extends BracketRow {
    entries: BracketEntryRow[];
}

export interface TraderProfile {
    wallet: string;
    tournament: {
        id: number;
        name: string;
    };
    currentRound: number;
    scores: CPIScores | null;
    eliminated: boolean;
    advanced: boolean;
    positions: AdrenaPosition[];
}
