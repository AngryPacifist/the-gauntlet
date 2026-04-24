// ============================================================================
// Scoring Engine — Composite Performance Index (CPI)
//
// Computes a multi-dimensional score for trader performance during a round.
//
// CPI = (0.35 × PnL Score) + (0.30 × Risk Score)
//      + (0.20 × Consistency Score) + (0.15 × Activity Score)
//
// Each sub-score is normalized to 0-100.
//
// Changelog (ZeDef feedback, March 2026):
//   - PnL: ROI denominator switched from collateral_amount to entry_size
//     (entry_size is immutable at position open; collateral is gameable)
//   - Risk: leverage penalty replaced with max drawdown metric
//     (drawdown captures equity curve quality; leverage is no longer penalized)
//   - Consistency: std-dev of daily ROIs replaced with profitable days ratio
//     (avoids perverse incentive to trade conservatively on big winning days)
//   - Activity: variety score weight doubled (20→40), trade count reduced
//     (50→30). Asset count is dynamic via config, not hardcoded to 4.
//
// Changelog (April 2026 — API field sync):
//   - PnL: denominator switched from entry_size × entry_price to exit_size.
//     entry_size/exit_size are already USD; × entry_price was double-multiplying.
//     exit_size accounts for upsizing. Denominator now closed-positions-only.
//   - Activity: volume now uses API's precomputed volume field (with fallback).
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
    // Phase 4 item 29-engine: filter by assetList when populated.
    // D5 fallback — undefined/empty = permissive (all symbols observed).
    // D16 matching — prefer mint when present, fall back to symbol.
    const filtered = config?.assetList?.length
        ? positions.filter((p) => {
            const match = config.assetList!.find((a) =>
                a.mint ? p.token_account_mint === a.mint : p.symbol === a.symbol,
            );
            if (!match) return false;
            const entryDate = p.entry_date.slice(0, 10); // YYYY-MM-DD
            return entryDate >= match.joinedAt;
        })
        : positions;

    // If trader has zero valid positions (post-filter), all scores are 0
    if (filtered.length === 0) {
        return {
            pnlScore: 0,
            riskScore: 0,
            consistencyScore: 0,
            activityScore: 0,
            cpiScore: 0,
        };
    }

    // D22: variety denominator prefers assetList length when populated,
    // falls back to supportedAssetCount for backward compat.
    const assetCount = Math.max(
        config?.assetList?.length ?? config?.supportedAssetCount ?? 4,
        1,
    );

    const pnlScore = computePnlScore(filtered);
    const riskScore = computeRiskScore(filtered);
    const consistencyScore = computeConsistencyScore(filtered);
    const activityScore = computeActivityScore(filtered, assetCount);

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
// entry_size and exit_size are already in USD (notional exposure).
// Uses exit_size for closed positions (accounts for upsizing).
// Falls back to entry_size for positions that lack exit_size (historical data).
//
// IMPORTANT: Do NOT multiply by entry_price — the size fields are already USD.
// The previous formula (entry_size × entry_price) was double-multiplying.
//
// ROI = Total Net PnL (USD) / Total Close Exposure (USD)
// PnL Score = normalize(ROI, -100%, +200%) → 0-100
//
// Both numerator (PnL) and denominator (exposure) use closed positions only.
// Open positions have pnl = null and are excluded from both.
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

    // Sum notional exposure across CLOSED positions only (aligns with PnL numerator).
    // entry_size/exit_size are already in USD — do NOT multiply by entry_price.
    // Uses exit_size (final exposure including upsizing) with entry_size fallback.
    const totalExposureUsd = closedPositions.reduce(
        (sum, p) => sum + (p.exit_size ?? p.entry_size),
        0,
    );

    if (totalExposureUsd === 0) return 0;

    // ROI as a percentage (PnL in USD / total USD exposure at close)
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
// Risk Score (30% weight)
//
// Measures risk management discipline via equity curve stability.
//
// Two penalty components:
//   1. Liquidation Penalty = (liquidated count / total count) × 100
//   2. Drawdown Penalty = min(drawdownRatio × 200, 80)
//      where drawdownRatio = maxDrawdown / totalClosedExposure
//
// Max drawdown is computed from the cumulative PnL curve of closed positions,
// sorted by exit_date (secondary: position_id for determinism).
//
// Risk Score = 100 - Liquidation Penalty - Drawdown Penalty
// --------------------------------------------------------------------------
function computeRiskScore(positions: AdrenaPosition[]): number {
    if (positions.length === 0) return 0;

    // Liquidation penalty (unchanged — uses ALL positions)
    const liquidatedCount = positions.filter((p) => p.status === 'liquidate').length;
    const liquidationPenalty = (liquidatedCount / positions.length) * 100;

    // Drawdown penalty — only from closed positions with exit_date
    const closedWithExit = positions.filter(
        (p) => (p.status === 'close' || p.status === 'liquidate') && p.exit_date !== null,
    );

    if (closedWithExit.length === 0) {
        // No closed positions to compute drawdown from.
        // Score based on liquidation penalty only.
        return clamp(100 - liquidationPenalty, 0, 100);
    }

    // Sort by exit_date chronologically; ties broken by position_id for determinism
    closedWithExit.sort((a, b) => {
        const dateA = new Date(a.exit_date!).getTime();
        const dateB = new Date(b.exit_date!).getTime();
        if (dateA !== dateB) return dateA - dateB;
        return a.position_id - b.position_id;
    });

    // Compute cumulative PnL curve and track max drawdown
    let cumPnL = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const p of closedWithExit) {
        cumPnL += p.pnl ?? 0;
        if (cumPnL > peak) peak = cumPnL;
        const drawdown = peak - cumPnL;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Normalize by total closed exposure
    const totalExposure = closedWithExit.reduce(
        (sum, p) => sum + (p.exit_size ?? p.entry_size), 0,
    );

    if (totalExposure <= 0) {
        return clamp(100 - liquidationPenalty, 0, 100);
    }

    const drawdownRatio = maxDrawdown / totalExposure;
    // 0% → 0 penalty, 10% → 20 penalty, 40%+ → 80 penalty (capped)
    const drawdownPenalty = Math.min(drawdownRatio * 200, 80);

    const rawScore = 100 - liquidationPenalty - drawdownPenalty;
    return clamp(rawScore, 0, 100);
}

// --------------------------------------------------------------------------
// Consistency Score (20% weight)
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
// Volume Score = 10 × log10(volume / 1000), capped at 30 ($1K→0, $10K→10, $100K→20, $1M→30)
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

    // Total volume in USD. Uses API's precomputed volume field (round-trip notional).
    // Falls back to entry_size (already USD) for positions without volume.
    // Note: do NOT multiply by entry_price — size fields are already USD.
    const totalVolume = positions.reduce(
        (sum, p) => sum + (p.volume ?? p.entry_size),
        0
    );
    // Log scale: $1K → 0, $10K → 10, $100K → 20, $1M → 30
    const volumeRaw = totalVolume <= 1000 ? 0 : 10 * Math.log10(totalVolume / 1000);
    const volumeScore = Math.min(Math.max(volumeRaw, 0), 30);

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
