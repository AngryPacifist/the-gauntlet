// ============================================================================
// Adrena: The Gauntlet — Shared TypeScript Types
// ============================================================================

// --- Tournament ---

export type TournamentStatus = 'registration' | 'active' | 'completed' | 'cancelled';
export type RoundStatus = 'pending' | 'active' | 'completed';
export type RoundName = 'First Blood' | 'The Crucible' | 'Endgame';
export type RoundType = 'main' | 'consolation';

export const CONSOLATION_ROUND_NAMES = ['Redemption Arc', 'Last Stand', 'Final Reckoning'] as const;

export interface TournamentConfig {
    format: 'bracket' | 'rank_only'; // 'bracket' = Gauntlet (elimination), 'rank_only' = Forge (flat leaderboard)
    bracketSize: number;              // Traders per bracket in Round 1 (default: 8)
    advanceRatio: number;             // Fraction that advance per round (default: 0.5)
    roundDurations: number[];         // Duration of each round in hours [R1, R2, R3] (default: [72, 48, 48])

    // Anti-gaming filters (shared between CPI + quest engines)
    minPositionCollateral: number;    // Minimum collateral to count a trade (USD, default: 25)
    minTradeDurationSec: number;      // Minimum trade duration to count (seconds, default: 120)

    // Scoring engine inputs
    supportedAssetCount: number;      // Number of tradeable assets on Adrena (default: 4)

    // Backtest mode
    useHistoricalWindow: boolean;     // If true, scoring uses historical window instead of round dates (default: false)
    historicalWindowDays: number;     // Number of days for historical window (default: 90)

    // Seeded brackets (programmatic — set by Season Final logic, not admin UI)
    seededWallets?: string[];         // For Final tournaments: wallets ordered by season standing

    // Prize distribution (optional — wired in admin UI per Phase 3 item 16)
    prizeTable?: {
        totalPool: number;            // Total prize pool amount
        currency: string;             // Prize currency (e.g. 'ADX', 'USDC')
        skillPrizes: number[];        // Amounts for rank 1, 2, 3... (top 30% skill prizes)
        rafflePrizes: number[];       // Amounts for raffle winner 1, 2, 3...
    };

    // --- Phase 3 additions (2026-04-22) — config-driven scoring/raffle constants ---

    // Top % cutoff for skill prizes vs raffle eligibility (item 26 — unifies
    // routes/tournaments.ts forge endpoint + raffle-engine cutoff)
    topPercentCutoff: number;         // Fraction, default 0.30 (top 30% earn skill prizes)

    // All Around quest — per-asset best-ROI scoring (item 13)
    allAroundMinTradeUsd: number;     // Minimum trade exit_size for quest eligibility (USD, default 500)
    allAroundMaxPointsPerAsset: number; // Cap on points per asset (default 25 — prevents one outlier dominating)

    // Bottom Fisher / Top-Tick Traveler quest — rank points (item 17)
    fisherRankPoints: number[];       // Default [3, 2, 1] — points for 1st/2nd/3rd

    // Quest point award tables (item 17 — used by final-score.ts + raffle-engine)
    dailyQuestPoints: number[];       // Default [0.2, 0.15, 0.1, 0.05, 0.01]
    multidayQuestPoints: number[];    // Default [0.3, 0.25, 0.2, 0.15, 0.1]

    // Raffle eligibility + ticket math (item 17)
    raffleMinClosedPositions: number; // Default 10 — min closed positions for raffle eligibility
    cpiTicketMultiplier: number;      // Default 0.5 — tickets = floor(CPI × this)
    questTicketMultiplier: number;    // Default 20 — tickets += floor(questPoints × this)

    // Risk Manager minimum trade size (item 11 — prevents micro-trade SL exploit)
    riskManagerMinSize: number;       // Default 1000 USD (test 500)

    // Dynamic asset list (item 29-admin — per-asset scoring starts from joinedAt week)
    // Optional: undefined OR empty = engine fallback to permissive (all observed symbols).
    // Populated = strict filter (scoring engines include only listed symbols, from joinedAt).
    // CREATE-time Add Asset defaults joinedAt to today (equivalent to "from tournament start").
    assetList?: Array<{
        symbol: string;               // e.g. 'SOL', 'BTC', 'BONK'
        // Phase 4: mint from /liquidity-info for identity-robust matching.
        // Optional for backward compat with Phase-3-created tournaments (no mint).
        // Engines prefer mint when present, fall back to symbol (D16).
        mint?: string;
        joinedAt: string;             // ISO date (YYYY-MM-DD) — first scoring day
        // Phase 7.b: optional Pyth Lazer feed_id override.
        // Resolution: feed_id ?? ADRENA_TO_LAZER_FEED_ID[symbol] ?? null (skip).
        // Used by services/pyth-client.ts to query www.adrena.trade/api/oracle-bars.
        feed_id?: number;
        // Phase 7.a: optional per-asset Leverage Master ladder.
        // Engine builds LeverageStep[] via buildLeverageSteps(lmSteps, lmTolerance ?? 2).
        // undefined = falls back to module constant LEVERAGE_STEPS (10x ladder).
        lmSteps?: number[];           // e.g. [10, 20, 30, ..., 100] or [1.5, 2, 2.5, 3, 3.5, 4, 4.5]
        lmTolerance?: number;         // tolerance window; default 2 (matches crypto)
    }>;
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
    format: 'bracket',
    bracketSize: 8,
    advanceRatio: 0.5,
    roundDurations: [72, 48, 48],
    minPositionCollateral: 25,
    minTradeDurationSec: 120,
    supportedAssetCount: 4,
    useHistoricalWindow: false,
    historicalWindowDays: 90,

    // Phase 3 config-driven defaults (match current hardcoded values for zero-drift migration)
    topPercentCutoff: 0.30,
    allAroundMinTradeUsd: 500,
    allAroundMaxPointsPerAsset: 25,
    fisherRankPoints: [3, 2, 1],
    dailyQuestPoints: [0.2, 0.15, 0.1, 0.05, 0.01],
    multidayQuestPoints: [0.3, 0.25, 0.2, 0.15, 0.1],
    raffleMinClosedPositions: 10,
    cpiTicketMultiplier: 0.5,
    questTicketMultiplier: 20,
    riskManagerMinSize: 1000,
    // assetList intentionally omitted — undefined = engine fallback; admin opts in via UI (D5)
};

/**
 * Resolve a stored tournament config against defaults.
 *
 * Merges `stored` (from DB JSONB) onto DEFAULT_TOURNAMENT_CONFIG so missing
 * fields — including ALL Phase 3 additions for pre-existing tournaments —
 * get sensible defaults. Required at every boundary that loads a tournament
 * and passes its config to scoring/quest/raffle engines.
 *
 * Pattern: `const config = resolveConfig(tournament.config);`
 *
 * Callers (as of 2026-04-22):
 *   - tournament-manager.ts — computeRoundScores, advanceRound, startTournament, registerWallet
 *   - scheduler.ts — refreshScores, scoreDailyCategories, scoreHourlyCategories
 *   - routes/categories.ts — admin-triggered POST /api/categories/score
 *   - routes/tournaments.ts — forge endpoint (item 26 consumer)
 *   - routes/admin.ts — raffle compute endpoint
 */
export function resolveConfig(stored: unknown): TournamentConfig {
    return { ...DEFAULT_TOURNAMENT_CONFIG, ...(stored as Partial<TournamentConfig>) };
}

// --- Scoring ---

export interface CPIWeights {
    pnl: number;
    risk: number;
    consistency: number;
    activity: number;
}

export const DEFAULT_CPI_WEIGHTS: CPIWeights = {
    pnl: 0.35,
    risk: 0.30,
    consistency: 0.20,
    activity: 0.15,
};

export interface CPIScores {
    pnlScore: number;
    riskScore: number;
    consistencyScore: number;
    activityScore: number;
    cpiScore: number;
}

// Phase 8 item (c.1-4): granular CPI inputs surfaced in expanded leaderboard
// row to give traders insight into why their sub-scores are what they are.
// Computed on-demand by computeCPIWithDetails; not persisted.
export interface CPIDetails {
    // PnL granular (under PNL bar)
    totalPnl: number;
    totalExposureUsd: number;
    roi: number;  // fraction; frontend formats × 100

    // Risk granular (under RISK bar)
    liquidatedCount: number;
    totalCount: number;
    maxDrawdownUsd: number;
    drawdownRatio: number;  // fraction

    // Consistency granular (under CONSISTENCY bar)
    profitableDays: number;
    totalTradingDays: number;
    winningTrades: number;
    totalClosedTrades: number;

    // Activity granular (under ACTIVITY bar)
    tradeCount: number;
    totalVolume: number;
    uniqueSymbols: number;
}

// --- Adrena API Types ---

export interface AdrenaPosition {
    // --- Original fields (always present) ---
    position_id: number;
    user_id: number;
    symbol: string;
    token_account_mint: string;
    side: 'long' | 'short';
    status: 'open' | 'close' | 'liquidate';
    pubkey: string;
    entry_price: number;       // average entry price in USD
    exit_price: number | null; // average exit price in USD
    entry_size: number;        // initial notional exposure in USD (NOT token units)
    pnl: number | null;
    entry_leverage: number;
    entry_date: string;        // ISO 8601
    exit_date: string | null;  // ISO 8601
    fees: number;
    collateral_amount: number;

    // --- New fields (optional for backward compat with JSONB snapshots) ---
    // Size tracking (all in USD notional)
    increase_size?: number;           // total USD added via upsizing (0 if no upsize)
    exit_size?: number;               // final USD exposure at close (entry_size + increase_size)

    // Leverage
    lowest_leverage?: number;         // lowest leverage during position lifetime

    // Collateral
    entry_collateral_amount?: number; // immutable collateral at open

    // Fee breakdown
    borrow_fees?: number;
    exit_fees?: number;

    // Risk management
    closed_by_sl_tp?: boolean;        // whether SL/TP triggered the close

    // Activity
    volume?: number;                  // round-trip notional volume in USD (= 2 × exit_size)
    duration?: number;                // precomputed duration in seconds

    // Audit trail
    last_ix?: string;                 // on-chain tx signature

    // Mutagen internals (informational — not used in CPI scoring)
    pnl_volume_ratio?: number;
    points_pnl_volume_ratio?: number;
    points_duration?: number;
    close_size_multiplier?: number;
    points_mutations?: number;
    total_points?: number;

    // DB timestamps
    created_at?: string;
    updated_at?: string | null;
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
    fourth: number;
    fifth: number;
    otherFinalist: number;
    passingR1: number;
    passingR2: number;
    consolationWinner: number;
    consolationSecond: number;
    consolationThird: number;
    otherConsolation: number;
}

export interface SeasonConfig {
    weekCount: number;
    qualificationSlots: number;
    tournamentConfig: TournamentConfig;
    pointsScheme: SeasonPointsScheme;
    award2DayCategorySeasonPoints?: boolean; // default: false — enable season points for Risk Manager / Humble One
}

export const DEFAULT_SEASON_POINTS: SeasonPointsScheme = {
    winner: 25,
    second: 18,
    third: 15,
    fourth: 12,
    fifth: 10,
    otherFinalist: 8,
    passingR1: 3,
    passingR2: 5,
    consolationWinner: 6,
    consolationSecond: 4,
    consolationThird: 3,
    otherConsolation: 1,
};

export const DEFAULT_SEASON_CONFIG: SeasonConfig = {
    weekCount: 7,
    qualificationSlots: 8,
    tournamentConfig: DEFAULT_TOURNAMENT_CONFIG,
    pointsScheme: DEFAULT_SEASON_POINTS,
    award2DayCategorySeasonPoints: false,
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
    // Phase 4 item 10 + D19: per-asset refactor.
    // Top-level rank fields: wallet's rank in the category leaderboard (1-indexed,
    // null if wallet not ranked). Consumed by season-manager.ts for season points.
    longRank: number | null;          // rank in bottom_fisher leaderboard
    shortRank: number | null;         // rank in top_tick_traveler leaderboard
    // Top-level aggregates (backward compat + fast display — "best" single entry across assets)
    longEntry: FisherEntryDetail | null;
    shortEntry: FisherEntryDetail | null;
    longPoints: number;
    shortPoints: number;
    totalPoints: number;
    // Per-asset breakdown (item 10): best long/short entry per asset.
    // Optional because pre-Phase-4 details JSONB lacks this field.
    byAsset?: Record<string, {
        longEntry: FisherEntryDetail | null;
        shortEntry: FisherEntryDetail | null;
    }>;
}

export interface SLTPTradeDetail {
    positionId: number;
    symbol: string;
    side: 'long' | 'short';
    roi: number;        // raw ROI (negative for SL, positive for TP)
    pnl: number;        // raw pnl value
    exitSize: number;   // denominator used for ROI
    leverage: number;   // entry_leverage at open
}

export interface RiskManagerDetails {
    // Top-level: best SL trade across all assets (backward compat)
    bestTrade: SLTPTradeDetail | null;
    candidateCount: number;
    // Phase 4 item 10: per-asset breakdown.
    // Aggregate score at row level = avg (1 - |roi|) × 100 across per-asset best SLs.
    byAsset?: Record<string, {
        bestTrade: SLTPTradeDetail | null;
        candidateCount: number;
    }>;
}

export interface HumbleOneDetails {
    bestTrade: SLTPTradeDetail | null;
    candidateCount: number;
    // Phase 4 item 10b: per-asset breakdown.
    // Aggregate score at row level = avg (roi × 100) across per-asset best TPs
    // (matches ZeDef's mockup: SCORE = avg ROI × 100).
    byAsset?: Record<string, {
        bestTrade: SLTPTradeDetail | null;
        candidateCount: number;
    }>;
}

export interface CategoryScoreRow {
    wallet: string;
    category: string;
    score: number;
    details: unknown;
}

// --- Leverage Master Quest Types ---

export interface LeverageStep {
    step: number;   // target leverage: 10, 20, 30, ..., 100
    min: number;    // lower bound of tolerance window (step - 2)
    max: number;    // upper bound of tolerance window (step + 2, capped at 100 for step 100)
}

export interface QuestProgressDetails {
    // Phase 4 item 30: per-asset LM ladders. `byAsset` keys are asset symbols
    // from config.assetList (e.g. 'SOL', 'BTC', 'BONK'). Each asset has
    // independent long + short ladders.
    // Phase 7.a: ladder length is now per-asset (variable). Length = asset.lmSteps?.length
    // when assetList entry has lmSteps configured, else LEVERAGE_STEPS.length (10).
    // Step values for rendering are resolved client-side from tournament.config.assetList,
    // not exposed in this payload.
    byAsset: Record<string, {
        long: boolean[];       // boolean[N] where N = asset's step count
        short: boolean[];      // boolean[N]
        longCount: number;     // denormalized count for fast rendering
        shortCount: number;
    }>;
    weekNumber: number;
}

export interface OHLCBar {
    open: number;
    high: number;
    low: number;
    close: number;
}

// --- Pyth Lazer Feed ID Mapping moved to services/adrena-canonical.ts (Phase 8.k) ---
// `ADRENA_TO_LAZER_FEED_ID` is now sourced from a pinned snapshot of the
// canonical adrena-abi repo (configs/oracles/autonom.mainnet.json). Import
// from `./services/adrena-canonical.js` instead of from this file.

// --- Pyth Benchmarks Symbol Mapping (PRIMARY, Phase 8.f) ---
// Phase 8.f promoted to primary OHLC source post call2aamir 2026-05-02 confirming
// /api/oracle-bars is internal-only Next.js API. Pyth Lazer (via Adrena's proxy)
// becomes fallback; see services/pyth-client.ts:fetchOHLCWithFallback.
//
// RWA additions (XAU/XAG/WTI) verified empirically 2026-05-02 against
// benchmarks.pyth.network/v1/shims/tradingview/history?symbol=<X>&resolution=D:
//   XAU close 2026-05-01 = $4,615   (Lazer 2056 capture: $4,614.83)  ✓ match
//   XAG close 2026-05-01 = $75.37   (Lazer 2069 capture: $75.36)     ✓ match
//   WTI close 2026-05-01 = $99.45   via Commodities.USOILSPOT
//     (Lazer 2035 capture: $102.53; ~3% spot-vs-continuous offset acceptable
//      since proximity scoring is ratio-based; spot continuous chosen for
//      handover-friendliness — no monthly futures roll, unlike WTIM6/USD).
export const ADRENA_TO_PYTH_SYMBOL: Record<string, string> = {
    SOL: 'Crypto.SOL/USD',
    BTC: 'Crypto.BTC/USD',
    BONK: 'Crypto.BONK/USD',
    JITOSOL: 'Crypto.JITOSOL/USD',
    XAU: 'Metal.XAU/USD',                  // Phase 8.f
    XAG: 'Metal.XAG/USD',                  // Phase 8.f
    WTI: 'Commodities.USOILSPOT',          // Phase 8.f (spot continuous, no roll)
};
