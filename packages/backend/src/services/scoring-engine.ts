// ============================================================================
// Scoring Engine — Composite Performance Index (CPI)
//
// Computes a multi-dimensional score for trader performance during a round.
//
// CPI = (0.35 × PnL Score) + (0.25 × Risk Score)
//      + (0.25 × Consistency Score) + (0.15 × Activity Score)
//
// Each sub-score is normalized to 0-100.
// See implementation_plan.md for full methodology and rationale.
// ============================================================================

import type {
    AdrenaPosition,
    CPIScores,
    CPIWeights,
    TournamentConfig,
} from '../types.js';
import { DEFAULT_CPI_WEIGHTS } from '../types.js';

// --------------------------------------------------------------------------
// Main entry point: compute CPI for one trader in one round
// --------------------------------------------------------------------------
export function computeCPI(
    positions: AdrenaPosition[],
    roundStart: Date,
    roundEnd: Date,
    weights: CPIWeights = DEFAULT_CPI_WEIGHTS,
): CPIScores {
    // If trader has zero valid positions, all scores are 0
    if (positions.length === 0) {
        return {
            pnlScore: 0,
            riskScore: 0,
            consistencyScore: 0,
            activityScore: 0,
            cpiScore: 0,
        };
    }

    const pnlScore = computePnlScore(positions);
    const riskScore = computeRiskScore(positions);
    const consistencyScore = computeConsistencyScore(positions, roundStart, roundEnd);
    const activityScore = computeActivityScore(positions);

    const cpiScore =
        weights.pnl * pnlScore +
        weights.risk * riskScore +
        weights.consistency * consistencyScore +
        weights.activity * activityScore;

    return {
        pnlScore: round2(pnlScore),
        riskScore: round2(riskScore),
        consistencyScore: round2(consistencyScore),
        activityScore: round2(activityScore),
        cpiScore: round2(cpiScore),
    };
}

// --------------------------------------------------------------------------
// PnL Score (35% weight)
//
// Measures net profitability relative to capital at risk (ROI).
// Using ROI normalizes for account size — a $500 account earning $50 (10%)
// scores higher than a $50,000 account earning $500 (1%).
//
// ROI = Total Net PnL / Total Collateral Deployed
// PnL Score = normalize(ROI, -100%, +200%) → 0-100
//
// Only CLOSED positions contribute to PnL (open positions have pnl = null).
// --------------------------------------------------------------------------
function computePnlScore(positions: AdrenaPosition[]): number {
    const closedPositions = positions.filter(
        (p) => p.status === 'close' || p.status === 'liquidate'
    );

    if (closedPositions.length === 0) {
        // No closed positions — can't compute PnL. Score 50 (neutral).
        // This is intentional: a trader with only open positions shouldn't be
        // penalized (PnL is unknown) or rewarded (PnL is unrealized).
        return 50;
    }

    // Sum PnL across closed positions (pnl field is non-null for closed positions)
    const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);

    // Sum collateral across ALL positions (open + closed) — this is total capital deployed
    const totalCollateral = positions.reduce((sum, p) => sum + p.collateral_amount, 0);

    if (totalCollateral === 0) return 0;

    // ROI as a percentage
    const roi = (totalPnl / totalCollateral) * 100;

    // Normalize to 0-100 scale:
    // -100% ROI → 0 score
    //    0% ROI → 33.3 score
    // +200% ROI → 100 score (cap)
    //
    // Linear interpolation between -100 and +200
    const normalized = ((roi + 100) / 300) * 100;
    return clamp(normalized, 0, 100);
}

// --------------------------------------------------------------------------
// Risk Score (25% weight)
//
// Measures risk management discipline.
// Penalizes: liquidations, excessive leverage.
//
// Liquidation Penalty = (liquidated count / total count) × 100
// Leverage Penalty = max(0, (avg_leverage - 10) × 2)
//     Penalty starts above 10x. At 10x: 0 penalty. At 50x: 80 penalty.
//
// Risk Score = 100 - Liquidation Penalty - Leverage Penalty
// --------------------------------------------------------------------------
function computeRiskScore(positions: AdrenaPosition[]): number {
    if (positions.length === 0) return 0;

    // Liquidation penalty
    const liquidatedCount = positions.filter((p) => p.status === 'liquidate').length;
    const liquidationPenalty = (liquidatedCount / positions.length) * 100;

    // Average leverage penalty
    const avgLeverage =
        positions.reduce((sum, p) => sum + p.entry_leverage, 0) / positions.length;
    const leveragePenalty = Math.max(0, (avgLeverage - 10) * 2);

    const rawScore = 100 - liquidationPenalty - leveragePenalty;
    return clamp(rawScore, 0, 100);
}

// --------------------------------------------------------------------------
// Consistency Score (25% weight)
//
// Measures trading consistency across the round.
// Rewards traders who perform steadily across all days rather than
// having one lucky day and two terrible days.
//
// Computed by:
// 1. Group closed positions by the DAY they were closed
// 2. Compute daily ROI for each day
// 3. Lower standard deviation of daily ROIs = higher score
// 4. Bonus for win rate (% of trades that were profitable)
//
// Consistency Raw = 100 - (StdDev(daily ROIs) × 4)
//   Scaling factor 4: a StdDev of 25% across days maps to 0 base score
// Win Rate Bonus = (winning / total) × 20 (up to 20 bonus points)
// --------------------------------------------------------------------------
function computeConsistencyScore(
    positions: AdrenaPosition[],
    roundStart: Date,
    roundEnd: Date,
): number {
    const closedPositions = positions.filter(
        (p) => (p.status === 'close' || p.status === 'liquidate') && p.exit_date
    );

    if (closedPositions.length === 0) {
        // No closed trades — score based purely on existence of open positions
        // Having positions open shows intent; give a baseline score
        return positions.length > 0 ? 30 : 0;
    }

    // --- Daily ROI calculation ---
    // Group positions by the calendar day they were closed
    const dailyGroups = new Map<string, AdrenaPosition[]>();

    for (const p of closedPositions) {
        const exitDay = new Date(p.exit_date!).toISOString().split('T')[0];
        const group = dailyGroups.get(exitDay) ?? [];
        group.push(p);
        dailyGroups.set(exitDay, group);
    }

    // Compute ROI for each day
    const dailyROIs: number[] = [];
    for (const [, dayPositions] of dailyGroups) {
        const dayPnl = dayPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        const dayCollateral = dayPositions.reduce((sum, p) => sum + p.collateral_amount, 0);
        if (dayCollateral > 0) {
            dailyROIs.push((dayPnl / dayCollateral) * 100);
        }
    }

    // If only 1 day of trading, std dev is 0 — that's fine, they get full base points
    let consistencyRaw = 100;
    if (dailyROIs.length > 1) {
        const stdDev = standardDeviation(dailyROIs);
        // Scaling: StdDev of 25% maps to 0 base score
        consistencyRaw = 100 - stdDev * 4;
    }

    // --- Win rate bonus ---
    const winningTrades = closedPositions.filter((p) => (p.pnl ?? 0) > 0).length;
    const winRate = winningTrades / closedPositions.length;
    const winRateBonus = winRate * 20; // Up to 20 bonus points

    return clamp(consistencyRaw + winRateBonus, 0, 100);
}

// --------------------------------------------------------------------------
// Activity Score (15% weight)
//
// Measures active participation. Prevents "open one trade, get lucky, sit"
// strategy. Capped to avoid rewarding trade spam.
//
// Trade Count Score = min(count / 10, 1) × 50   (max at 10+ trades)
// Volume Score = min(volume / 10000, 1) × 30    (max at $10K+ volume)
// Variety Score = (unique symbols / 4) × 20      (max at 4+ symbols)
//
// Supported symbols on Adrena: SOL, BTC, JITOSOL, BONK — so 4 is the max.
// --------------------------------------------------------------------------
function computeActivityScore(positions: AdrenaPosition[]): number {
    if (positions.length === 0) return 0;

    // Trade count (capped at 10)
    const tradeCountScore = Math.min(positions.length / 10, 1) * 50;

    // Total volume (entry_size × entry_price gives notional value in USD)
    const totalVolume = positions.reduce(
        (sum, p) => sum + p.entry_size * p.entry_price,
        0
    );
    const volumeScore = Math.min(totalVolume / 10000, 1) * 30;

    // Symbol variety
    const uniqueSymbols = new Set(positions.map((p) => p.symbol));
    const varietyScore = Math.min(uniqueSymbols.size / 4, 1) * 20;

    return clamp(tradeCountScore + volumeScore + varietyScore, 0, 100);
}

// --------------------------------------------------------------------------
// Utility functions
// --------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function standardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
}
