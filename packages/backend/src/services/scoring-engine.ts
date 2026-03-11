// ============================================================================
// Scoring Engine — Composite Performance Index (CPI)
//
// Computes a multi-dimensional score for trader performance during a round.
//
// CPI = (0.35 × PnL Score) + (0.25 × Risk Score)
//      + (0.25 × Consistency Score) + (0.15 × Activity Score)
//
// Each sub-score is normalized to 0-100.
//
// Changelog (ZeDef feedback, March 2026):
//   - PnL: ROI denominator switched from collateral_amount to entry_size
//     (entry_size is immutable at position open; collateral is gameable)
//   - Risk: leverage penalty threshold raised from 10x to configurable
//     (default 30x; respects tactical high-leverage trading on Adrena)
//   - Consistency: std-dev of daily ROIs replaced with profitable days ratio
//     (avoids perverse incentive to trade conservatively on big winning days)
//   - Activity: variety score weight doubled (20→40), trade count reduced
//     (50→30). Asset count is dynamic via config, not hardcoded to 4.
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
    config?: Partial<TournamentConfig>,
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

    const leverageThreshold = config?.leveragePenaltyThreshold ?? 30;
    const assetCount = Math.max(config?.supportedAssetCount ?? 4, 1);

    const pnlScore = computePnlScore(positions);
    const riskScore = computeRiskScore(positions, leverageThreshold);
    const consistencyScore = computeConsistencyScore(positions);
    const activityScore = computeActivityScore(positions, assetCount);

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
// Measures net profitability relative to position size (ROI).
// Using entry_size × entry_price as the denominator (notional USD exposure)
// instead of collateral_amount because collateral is gameable — traders can
// remove collateral mid-trade. entry_size is immutable at position open.
//
// ROI = Total Net PnL (USD) / Total Notional Exposure (USD)
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

    // Sum notional exposure across ALL positions (open + closed) in USD.
    // entry_size is in token units; multiply by entry_price to get USD value.
    // This is the denominator for ROI — total USD exposure the trader committed.
    const totalExposureUsd = positions.reduce(
        (sum, p) => sum + p.entry_size * p.entry_price,
        0,
    );

    if (totalExposureUsd === 0) return 0;

    // ROI as a percentage (PnL in USD / total USD exposure)
    const roi = (totalPnl / totalExposureUsd) * 100;

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
// Leverage Penalty = max(0, (avg_leverage - threshold) × 2)
//     Default threshold: 30x (configurable per tournament).
//     At 30x: 0 penalty. At 50x: 40 penalty. At 100x: 140 → clamped.
//
// Risk Score = 100 - Liquidation Penalty - Leverage Penalty
// --------------------------------------------------------------------------
function computeRiskScore(
    positions: AdrenaPosition[],
    leverageThreshold: number,
): number {
    if (positions.length === 0) return 0;

    // Liquidation penalty
    const liquidatedCount = positions.filter((p) => p.status === 'liquidate').length;
    const liquidationPenalty = (liquidatedCount / positions.length) * 100;

    // Average leverage penalty
    const avgLeverage =
        positions.reduce((sum, p) => sum + p.entry_leverage, 0) / positions.length;
    const leveragePenalty = Math.max(0, (avgLeverage - leverageThreshold) * 2);

    const rawScore = 100 - liquidationPenalty - leveragePenalty;
    return clamp(rawScore, 0, 100);
}

// --------------------------------------------------------------------------
// Consistency Score (25% weight)
//
// Measures trading consistency across the round.
// Rewards traders who perform steadily across multiple days.
//
// Replaced std-dev approach (which penalized big winning days) with:
//   Profitable Days Ratio = (days with net positive PnL / total trading days) × 80
//   Win Rate Bonus = (winning trades / total trades) × 20
//
// "Trading day" = a calendar day with at least one closed position.
// This measures "of the days you traded, how many were green" — not
// "what fraction of the round did you trade" (that's Activity's job).
//
// Edge cases:
//   - 0 closed positions: returns 30 (if open positions exist) or 0
//   - 1 trading day with profit: 80 + win rate bonus
//   - 1 trading day with loss: 0 + win rate bonus
// --------------------------------------------------------------------------
function computeConsistencyScore(positions: AdrenaPosition[]): number {
    const closedPositions = positions.filter(
        (p) => (p.status === 'close' || p.status === 'liquidate') && p.exit_date
    );

    if (closedPositions.length === 0) {
        // No closed trades — score based purely on existence of open positions
        // Having positions open shows intent; give a baseline score
        return positions.length > 0 ? 30 : 0;
    }

    // --- Profitable days ratio ---
    // Group positions by the calendar day they were closed
    const dailyGroups = new Map<string, AdrenaPosition[]>();

    for (const p of closedPositions) {
        const exitDay = new Date(p.exit_date!).toISOString().split('T')[0];
        const group = dailyGroups.get(exitDay) ?? [];
        group.push(p);
        dailyGroups.set(exitDay, group);
    }

    // Count days with net positive PnL
    let profitableDays = 0;
    const totalTradingDays = dailyGroups.size;

    for (const [, dayPositions] of dailyGroups) {
        const dayPnl = dayPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        if (dayPnl > 0) {
            profitableDays++;
        }
    }

    // Profitable days score: 0-80 range
    const profitableDaysScore = totalTradingDays > 0
        ? (profitableDays / totalTradingDays) * 80
        : 0;

    // --- Win rate bonus ---
    const winningTrades = closedPositions.filter((p) => (p.pnl ?? 0) > 0).length;
    const winRate = winningTrades / closedPositions.length;
    const winRateBonus = winRate * 20; // Up to 20 bonus points

    return clamp(profitableDaysScore + winRateBonus, 0, 100);
}

// --------------------------------------------------------------------------
// Activity Score (15% weight)
//
// Measures active participation. Prevents "open one trade, get lucky, sit"
// strategy. Capped to avoid rewarding trade spam.
//
// Trade Count Score = min(count / 10, 1) × 30   (max at 10+ trades)
// Volume Score = min(volume / 10000, 1) × 30    (max at $10K+ volume)
// Variety Score = min(symbols / N, 1) × 40       (max at N unique symbols)
//
// N = supportedAssetCount from tournament config (default: 4).
// Variety weight doubled from 20→40 per ZeDef feedback: pushes traders
// to try all assets on the platform, directly serving Adrena's goal of
// broad market engagement.
// --------------------------------------------------------------------------
function computeActivityScore(
    positions: AdrenaPosition[],
    supportedAssetCount: number,
): number {
    if (positions.length === 0) return 0;

    // Trade count (capped at 10)
    const tradeCountScore = Math.min(positions.length / 10, 1) * 30;

    // Total volume (entry_size × entry_price gives notional value in USD)
    const totalVolume = positions.reduce(
        (sum, p) => sum + p.entry_size * p.entry_price,
        0
    );
    const volumeScore = Math.min(totalVolume / 10000, 1) * 30;

    // Symbol variety (dynamic asset count, not hardcoded)
    const uniqueSymbols = new Set(positions.map((p) => p.symbol));
    const varietyScore = Math.min(uniqueSymbols.size / supportedAssetCount, 1) * 40;

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
