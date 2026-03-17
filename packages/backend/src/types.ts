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
    risk: 0.20,
    consistency: 0.30,
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


// --- Season Types ---

export type SeasonStatus = 'registration' | 'active' | 'final' | 'completed';

export interface SeasonPointsScheme {
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
}

export interface SeasonConfig {
    weekCount: number;
    qualificationSlots: number;
    tournamentConfig: TournamentConfig;
    pointsScheme: SeasonPointsScheme;
}

export const DEFAULT_SEASON_POINTS: SeasonPointsScheme = {
    winner: 25,
    second: 18,
    third: 15,
    finalist: 12,
    eliminatedR2: 8,
    eliminatedR1: 4,
    consolationWinner: 6,
    consolationSecond: 4,
    consolationThird: 3,
    registered: 1,
};

export const DEFAULT_SEASON_CONFIG: SeasonConfig = {
    weekCount: 7,
    qualificationSlots: 8,
    tournamentConfig: DEFAULT_TOURNAMENT_CONFIG,
    pointsScheme: DEFAULT_SEASON_POINTS,
};

// --- Daily Category Types ---

export interface AllAroundAssetScore {
    symbol: string;
    bestROI: number;
    points: number;
    positionId: number;
}

export interface AllAroundDetails {
    assetScores: AllAroundAssetScore[];
    totalPoints: number;
}

export interface FisherEntryDetail {
    symbol: string;
    entryPrice: number;
    dayLow: number;
    dayHigh: number;
    proximity: number;
    roi: number;
    rank: number | null;
    rankPoints: number;
    positionId: number;
}

export interface FisherDetails {
    longEntry: FisherEntryDetail | null;
    shortEntry: FisherEntryDetail | null;
    totalPoints: number;
}

export interface OHLCBar {
    open: number;
    high: number;
    low: number;
    close: number;
}

// --- Pyth Symbol Mapping ---
// Verified against live Pyth Benchmarks API + Adrena liquidity-info endpoint.
// Adrena position `symbol` field → Pyth TradingView `symbol` query param.
export const ADRENA_TO_PYTH_SYMBOL: Record<string, string> = {
    SOL: 'Crypto.SOL/USD',
    BTC: 'Crypto.BTC/USD',
    BONK: 'Crypto.BONK/USD',
    JITOSOL: 'Crypto.JITOSOL/USD',
};
