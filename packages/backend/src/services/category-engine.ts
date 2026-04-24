// ============================================================================
// Category Engine -- Daily Tactical Category Scoring
//
// Implements engagement kick categories for The Gauntlet:
// 1. "All Around Trader" -- best ROI per unique asset traded, summed (daily)
// 2. "Bottom Fisher"         -- long entry precision relative to daily low (daily)
// 3. "Top-Tick Traveler"     -- short entry precision relative to daily high (daily)
// 4. "Risk Manager"      -- best stop-loss ROI in a 2-day window
// 5. "The Humble One"    -- best take-profit ROI in a 2-day window
//
// These run alongside the main CPI-based bracket tournament and provide
// engagement loops for all traders (including eliminated ones).
// ============================================================================

import { db } from '../db/index.js';
import { dailyCategoryScores } from '../db/schema.js';
import type {
    AdrenaPosition,
    OHLCBar,
    AllAroundDetails,
    AllAroundAssetScore,
    FisherDetails,
    FisherEntryDetail,
    CategoryScoreRow,
    RiskManagerDetails,
    HumbleOneDetails,
    SLTPTradeDetail,
    TournamentConfig,
} from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../types.js';

// --------------------------------------------------------------------------
// Constants: migrated to TournamentConfig (Phase 3 item 13 + item 17, 2026-04-22).
// Scoring parameters are now config-driven via the `config: TournamentConfig`
// parameter on each engine function. Defaults mirror the old hardcoded values
// (see `DEFAULT_TOURNAMENT_CONFIG` in types.ts).
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Filter positions to those opened on a specific UTC day.
 * Uses the position's entry_date (ISO 8601 string).
 */
function filterPositionsForDay(
    positions: AdrenaPosition[],
    dateStr: string, // YYYY-MM-DD
): AdrenaPosition[] {
    const dayStart = new Date(dateStr + 'T00:00:00Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

    return positions.filter((p) => {
        const entryDate = new Date(p.entry_date);
        return entryDate >= dayStart && entryDate <= dayEnd;
    });
}

/**
 * Filter positions to those opened within a multi-day UTC window.
 * Used by 2-day engagement categories (Risk Manager, Humble One).
 */
function filterPositionsForWindow(
    positions: AdrenaPosition[],
    startDate: string, // YYYY-MM-DD
    endDate: string,   // YYYY-MM-DD
): AdrenaPosition[] {
    const windowStart = new Date(startDate + 'T00:00:00Z');
    const windowEnd = new Date(endDate + 'T23:59:59.999Z');

    return positions.filter((p) => {
        const entryDate = new Date(p.entry_date);
        return entryDate >= windowStart && entryDate <= windowEnd;
    });
}

/**
 * Phase 4 item 29-engine: filter positions by config.assetList.
 * D5 — undefined/empty assetList = permissive (unchanged behavior).
 * D16 — prefer mint match when present, fall back to symbol.
 *
 * Also applies per-asset joinedAt filter: a position is kept only if it was
 * opened on or after the asset's joinedAt date.
 */
function filterByAssetList(
    positions: AdrenaPosition[],
    config: TournamentConfig,
): AdrenaPosition[] {
    if (!config.assetList?.length) return positions;
    return positions.filter((p) => {
        const match = config.assetList!.find((a) =>
            a.mint ? p.token_account_mint === a.mint : p.symbol === a.symbol,
        );
        if (!match) return false;
        const entryDate = p.entry_date.slice(0, 10); // YYYY-MM-DD
        return entryDate >= match.joinedAt;
    });
}

/**
 * Compute ROI for a position.
 * ROI = pnl / exit_size (already USD). Falls back to entry_size.
 * Returns 0 if position has no realized PnL (still open) or denominator is 0.
 */
function computePositionROI(position: AdrenaPosition): number {
    if (position.pnl === null || position.pnl === undefined) {
        return 0;
    }
    // entry_size/exit_size are already in USD -- do NOT multiply by entry_price
    const exposure = position.exit_size ?? position.entry_size;
    if (exposure <= 0) {
        return 0;
    }
    return position.pnl / exposure;
}

// ============================================================================
// ALL AROUND TRADER
//
// ZeDef's spec:
// - Daily points = best ROI per unique asset traded, summed
// - Min trade size: $1,000 (exit_size, already USD)
// - Negative ROI = 0 points (not negative)
// - Only closed positions count (need realized PnL)
// ============================================================================

/**
 * Compute All Around Trader score for a single wallet on a single day.
 *
 * Algorithm:
 * 1. Filter to positions opened on the given UTC day
 * 2. Filter to closed positions only (need realized PnL)
 * 3. Filter to positions >= $1,000 exposure
 * 4. Group by symbol
 * 5. For each symbol: select position with highest ROI
 *    - ROI > 0 -> min(ROI * 25, 25) points
 *    - ROI <= 0 -> 0 points
 * 6. Sum across all assets
 */
export function computeAllAroundScore(
    positions: AdrenaPosition[],
    dateStr: string,
    config: TournamentConfig,
): AllAroundDetails {
    // Phase 4 item 29-engine: filter by assetList first (if configured)
    const assetFiltered = filterByAssetList(positions, config);
    const dayPositions = filterPositionsForDay(assetFiltered, dateStr);

    // Phase 3 item 13 + 17: read from config (was hardcoded ALL_AROUND_MIN_TRADE_USD + ALL_AROUND_MAX_POINTS_PER_ASSET)
    const minTradeUsd = config.allAroundMinTradeUsd ?? DEFAULT_TOURNAMENT_CONFIG.allAroundMinTradeUsd;
    const maxPointsPerAsset = config.allAroundMaxPointsPerAsset ?? DEFAULT_TOURNAMENT_CONFIG.allAroundMaxPointsPerAsset;

    // Filter: closed only + minimum trade size
    const qualifying = dayPositions.filter((p) => {
        if (p.status === 'open') return false;
        // exit_size/entry_size are already in USD -- do NOT multiply by entry_price
        const exposure = p.exit_size ?? p.entry_size;
        return exposure >= minTradeUsd;
    });

    // Group by symbol
    const bySymbol = new Map<string, AdrenaPosition[]>();
    for (const p of qualifying) {
        const group = bySymbol.get(p.symbol) ?? [];
        group.push(p);
        bySymbol.set(p.symbol, group);
    }

    // Compute best ROI per symbol
    const assetScores: AllAroundAssetScore[] = [];
    for (const [symbol, symbolPositions] of bySymbol) {
        let bestROI = -Infinity;
        let bestPositionId = 0;

        for (const p of symbolPositions) {
            const roi = computePositionROI(p);
            if (roi > bestROI) {
                bestROI = roi;
                bestPositionId = p.position_id;
            }
        }

        // Negative ROI = 0 points
        const points = bestROI > 0
            ? Math.min(bestROI * maxPointsPerAsset, maxPointsPerAsset)
            : 0;

        assetScores.push({
            symbol,
            bestROI,
            points,
            positionId: bestPositionId,
        });
    }

    const totalPoints = assetScores.reduce((sum, s) => sum + s.points, 0);

    return { assetScores, totalPoints };
}

// ============================================================================
// TOP-TICK TRAVELER / BOTTOM FISHER (Fisher split)
//
// ZeDef's spec:
// - At end of UTC day, capture daily high/low from Pyth OHLC data
// - Rank longs by how close entry price was to the day's LOW (best long entry)
// - Rank shorts by how close entry price was to the day's HIGH (best short entry)
// - Top 3 each direction get rank points (3, 2, 1), multiplied by ROI
// - Best trade per trader per direction
//
// This is a TOURNAMENT-WIDE computation -- rankings require comparing all traders.
//
// Determinism:
// - Cross-wallet sort: proximity DESC, wallet ASC (alphabetical tiebreaker)
// - Intra-wallet selection: proximity -> ROI -> position_id (3-level tiebreaker)
// ============================================================================

interface FisherCandidate {
    wallet: string;
    symbol: string;
    entryPrice: number;
    dayLow: number;
    dayHigh: number;
    proximity: number;
    roi: number;
    positionId: number;
}

/**
 * Compute Fisher scores for ALL wallets in a tournament on a single day.
 *
 * Returns a Map<wallet, FisherDetails> with longPoints and shortPoints
 * stored separately for caller-level split into Top-Tick Traveler and
 * Bottom Fisher categories.
 */
export function computeFisherScores(
    walletPositions: Map<string, AdrenaPosition[]>,
    dateStr: string,
    ohlcData: Map<string, OHLCBar>,
    config: TournamentConfig,
): Map<string, FisherDetails> {
    const results = new Map<string, FisherDetails>();

    // Phase 3 item 17: read Fisher rank points from config (was hardcoded FISHER_RANK_POINTS = [3, 2, 1])
    const fisherPoints = config.fisherRankPoints ?? DEFAULT_TOURNAMENT_CONFIG.fisherRankPoints;

    // Phase 1: Find each wallet's best long and best short for the day
    const allLongs: FisherCandidate[] = [];
    const allShorts: FisherCandidate[] = [];

    for (const [wallet, positions] of walletPositions) {
        // Phase 4 item 29-engine: assetList filter before per-day filter
        const assetFiltered = filterByAssetList(positions, config);
        const dayPositions = filterPositionsForDay(assetFiltered, dateStr);

        let bestLong: FisherCandidate | null = null;
        let bestShort: FisherCandidate | null = null;

        for (const p of dayPositions) {
            const ohlc = ohlcData.get(p.symbol);
            if (!ohlc) continue;

            // Skip assets with degenerate price range (stale feed, oracle outage,
            // illiquid pair). < 0.1% spread = no meaningful price discovery.
            const range = ohlc.high - ohlc.low;
            if (range <= 0 || (ohlc.low > 0 && range / ohlc.low < 0.001)) continue;

            const roi = computePositionROI(p);

            if (p.side === 'long') {
                // Long proximity: how close entry was to the day's LOW
                // 1.0 = entered at exact low (perfect), 0.0 = entered at high (worst)
                const proximity = 1 - ((p.entry_price - ohlc.low) / range);
                // Clamp to [0, 1] -- entry could be outside day's range
                const clampedProximity = Math.max(0, Math.min(1, proximity));

                // Deterministic intra-wallet selection: proximity -> ROI -> position_id
                if (
                    !bestLong ||
                    clampedProximity > bestLong.proximity ||
                    (clampedProximity === bestLong.proximity && roi > bestLong.roi) ||
                    (clampedProximity === bestLong.proximity && roi === bestLong.roi &&
                     p.position_id < bestLong.positionId)
                ) {
                    bestLong = {
                        wallet,
                        symbol: p.symbol,
                        entryPrice: p.entry_price,
                        dayLow: ohlc.low,
                        dayHigh: ohlc.high,
                        proximity: clampedProximity,
                        roi,
                        positionId: p.position_id,
                    };
                }
            } else if (p.side === 'short') {
                // Short proximity: how close entry was to the day's HIGH
                // 1.0 = entered at exact high (perfect), 0.0 = entered at low (worst)
                const proximity = (p.entry_price - ohlc.low) / range;
                const clampedProximity = Math.max(0, Math.min(1, proximity));

                // Deterministic intra-wallet selection: proximity -> ROI -> position_id
                if (
                    !bestShort ||
                    clampedProximity > bestShort.proximity ||
                    (clampedProximity === bestShort.proximity && roi > bestShort.roi) ||
                    (clampedProximity === bestShort.proximity && roi === bestShort.roi &&
                     p.position_id < bestShort.positionId)
                ) {
                    bestShort = {
                        wallet,
                        symbol: p.symbol,
                        entryPrice: p.entry_price,
                        dayLow: ohlc.low,
                        dayHigh: ohlc.high,
                        proximity: clampedProximity,
                        roi,
                        positionId: p.position_id,
                    };
                }
            }
        }

        if (bestLong) allLongs.push(bestLong);
        if (bestShort) allShorts.push(bestShort);

        // Initialize all wallets with empty details (populated after ranking).
        // Phase 4 item 10 + D19: added longRank, shortRank, byAsset top-level fields.
        results.set(wallet, {
            longRank: null,
            shortRank: null,
            longEntry: null,
            shortEntry: null,
            longPoints: 0,
            shortPoints: 0,
            totalPoints: 0,
            byAsset: {},
        });
    }

    // Phase 4 item 10: populate byAsset per-wallet breakdown.
    // For each wallet × asset, find best long + best short entry (using same
    // deterministic tiebreaker as cross-wallet: proximity → ROI → position_id).
    for (const [wallet, positions] of walletPositions) {
        const assetFiltered = filterByAssetList(positions, config);
        const dayPositions = filterPositionsForDay(assetFiltered, dateStr);
        const byAsset: Record<string, {
            longEntry: FisherEntryDetail | null;
            shortEntry: FisherEntryDetail | null;
        }> = {};

        for (const p of dayPositions) {
            const ohlc = ohlcData.get(p.symbol);
            if (!ohlc) continue;
            const range = ohlc.high - ohlc.low;
            if (range <= 0 || (ohlc.low > 0 && range / ohlc.low < 0.001)) continue;
            const roi = computePositionROI(p);

            if (!byAsset[p.symbol]) {
                byAsset[p.symbol] = { longEntry: null, shortEntry: null };
            }

            if (p.side === 'long') {
                const proximity = Math.max(0, Math.min(1, 1 - ((p.entry_price - ohlc.low) / range)));
                const current = byAsset[p.symbol].longEntry;
                if (!current || proximity > current.proximity ||
                    (proximity === current.proximity && roi > current.roi) ||
                    (proximity === current.proximity && roi === current.roi && p.position_id < current.positionId)) {
                    byAsset[p.symbol].longEntry = {
                        symbol: p.symbol, entryPrice: p.entry_price,
                        dayLow: ohlc.low, dayHigh: ohlc.high,
                        proximity, roi, rank: null, rankPoints: 0,
                        positionId: p.position_id,
                    };
                }
            } else if (p.side === 'short') {
                const proximity = Math.max(0, Math.min(1, (p.entry_price - ohlc.low) / range));
                const current = byAsset[p.symbol].shortEntry;
                if (!current || proximity > current.proximity ||
                    (proximity === current.proximity && roi > current.roi) ||
                    (proximity === current.proximity && roi === current.roi && p.position_id < current.positionId)) {
                    byAsset[p.symbol].shortEntry = {
                        symbol: p.symbol, entryPrice: p.entry_price,
                        dayLow: ohlc.low, dayHigh: ohlc.high,
                        proximity, roi, rank: null, rankPoints: 0,
                        positionId: p.position_id,
                    };
                }
            }
        }

        const existing = results.get(wallet);
        if (existing) existing.byAsset = byAsset;
    }

    // Phase 2: Rank longs by proximity (descending)
    // Deterministic tiebreaker: wallet alphabetical when proximity is equal
    allLongs.sort((a, b) => b.proximity - a.proximity || a.wallet.localeCompare(b.wallet));
    for (let i = 0; i < allLongs.length; i++) {
        const candidate = allLongs[i];
        const rank = i + 1; // All entries get a rank (1-indexed)
        const rankPoints = i < fisherPoints.length ? fisherPoints[i] : 0;
        const pointsFromLong = rankPoints * candidate.roi * 100;

        const existing = results.get(candidate.wallet)!;
        existing.longEntry = {
            symbol: candidate.symbol,
            entryPrice: candidate.entryPrice,
            dayLow: candidate.dayLow,
            dayHigh: candidate.dayHigh,
            proximity: candidate.proximity,
            roi: candidate.roi,
            rank,
            rankPoints,
            positionId: candidate.positionId,
        };
        existing.longPoints = pointsFromLong;
        existing.longRank = rank;  // D19: top-level rank field for season-manager
        existing.totalPoints += pointsFromLong;
    }

    // Phase 3: Rank shorts by proximity (descending)
    // Deterministic tiebreaker: wallet alphabetical when proximity is equal
    allShorts.sort((a, b) => b.proximity - a.proximity || a.wallet.localeCompare(b.wallet));
    for (let i = 0; i < allShorts.length; i++) {
        const candidate = allShorts[i];
        const rank = i + 1; // All entries get a rank (1-indexed)
        const rankPoints = i < fisherPoints.length ? fisherPoints[i] : 0;
        const pointsFromShort = rankPoints * candidate.roi * 100;

        const existing = results.get(candidate.wallet)!;
        existing.shortEntry = {
            symbol: candidate.symbol,
            entryPrice: candidate.entryPrice,
            dayLow: candidate.dayLow,
            dayHigh: candidate.dayHigh,
            proximity: candidate.proximity,
            roi: candidate.roi,
            rank,
            rankPoints,
            positionId: candidate.positionId,
        };
        existing.shortPoints = pointsFromShort;
        existing.shortRank = rank;  // D19
        existing.totalPoints += pointsFromShort;
    }

    return results;
}

// ============================================================================
// RISK MANAGER (2-day engagement category)
//
// Best stop-loss trade by ROI within a 2-day window. Tightest controlled loss wins.
// SL detection: closed_by_sl_tp === true && pnl < 0
// Minimum trade size: config.riskManagerMinSize USD (default 1000, test 500)
// Score formula = (1 - |roi|) × 100  — applied at the scheduler row-emission layer,
// not inside this engine (engine returns raw trade data; scheduler converts to score).
// Raw negative ROI preserved in details for transparency.
//
// Determinism:
// - Intra-wallet tiebreaker: ROI (highest = least negative) -> position_id (lower wins)
// ============================================================================

export function computeRiskManagerScores(
    walletPositions: Map<string, AdrenaPosition[]>,
    startDate: string,
    endDate: string,
    config: TournamentConfig,
): Map<string, RiskManagerDetails> {
    // Phase 4 item 11: RM minimum trade size filter + inversion fix.
    // Config field default 1000 USD per D-value (test 500).
    const minSize = config.riskManagerMinSize ?? DEFAULT_TOURNAMENT_CONFIG.riskManagerMinSize;

    const results = new Map<string, RiskManagerDetails>();

    for (const [wallet, positions] of walletPositions) {
        // Phase 4 item 29-engine: assetList filter
        const assetFiltered = filterByAssetList(positions, config);
        const windowPositions = filterPositionsForWindow(assetFiltered, startDate, endDate);

        // Phase 4 item 11: minSize filter applied here
        const slTrades = windowPositions.filter((p) =>
            p.status !== 'open' &&
            p.closed_by_sl_tp === true &&
            (p.pnl ?? 0) < 0 &&
            (p.exit_size ?? p.entry_size) >= minSize,
        );

        // Phase 4 item 10c: per-asset best SL trade
        const byAsset: Record<string, {
            bestTrade: SLTPTradeDetail | null;
            candidateCount: number;
        }> = {};

        // Top-level aggregate (best SL across all assets, preserved for backward-compat display)
        let bestTrade: SLTPTradeDetail | null = null;
        let bestROI = -Infinity;

        for (const p of slTrades) {
            const exposure = p.exit_size ?? p.entry_size;
            if (exposure <= 0) continue;
            const roi = (p.pnl ?? 0) / exposure;
            const trade: SLTPTradeDetail = {
                positionId: p.position_id, symbol: p.symbol, side: p.side,
                roi, pnl: p.pnl ?? 0, exitSize: exposure, leverage: p.entry_leverage,
            };

            // Per-asset best (deterministic: highest ROI → lowest position_id)
            if (!byAsset[p.symbol]) {
                byAsset[p.symbol] = { bestTrade: null, candidateCount: 0 };
            }
            byAsset[p.symbol].candidateCount++;
            const current = byAsset[p.symbol].bestTrade;
            if (!current || roi > current.roi ||
                (roi === current.roi && p.position_id < current.positionId)) {
                byAsset[p.symbol].bestTrade = trade;
            }

            // Top-level aggregate best (same determinism)
            if (roi > bestROI ||
                (roi === bestROI && bestTrade !== null && p.position_id < bestTrade.positionId)) {
                bestROI = roi;
                bestTrade = trade;
            }
        }

        results.set(wallet, {
            bestTrade,
            candidateCount: slTrades.length,
            byAsset,
        });
    }

    return results;
}

// ============================================================================
// THE HUMBLE ONE (2-day engagement category)
//
// Best take-profit trade by ROI within a 2-day window.
// TP detection: closed_by_sl_tp === true && pnl > 0
// Score = roi * 100 (already positive)
//
// Determinism:
// - Intra-wallet tiebreaker: ROI (highest) -> position_id (lower wins)
// ============================================================================

export function computeHumbleOneScores(
    walletPositions: Map<string, AdrenaPosition[]>,
    startDate: string,
    endDate: string,
    config: TournamentConfig,
): Map<string, HumbleOneDetails> {
    const results = new Map<string, HumbleOneDetails>();

    for (const [wallet, positions] of walletPositions) {
        // Phase 4 item 29-engine: assetList filter
        const assetFiltered = filterByAssetList(positions, config);
        const windowPositions = filterPositionsForWindow(assetFiltered, startDate, endDate);

        // TP-triggered closes with positive PnL (no minSize filter — HumbleOne keeps all)
        const tpTrades = windowPositions.filter((p) =>
            p.status !== 'open' &&
            p.closed_by_sl_tp === true &&
            (p.pnl ?? 0) > 0,
        );

        // Phase 4 item 10b: per-asset best TP trade
        const byAsset: Record<string, {
            bestTrade: SLTPTradeDetail | null;
            candidateCount: number;
        }> = {};

        let bestTrade: SLTPTradeDetail | null = null;
        let bestROI = -Infinity;

        for (const p of tpTrades) {
            const exposure = p.exit_size ?? p.entry_size;
            if (exposure <= 0) continue;
            const roi = (p.pnl ?? 0) / exposure;
            const trade: SLTPTradeDetail = {
                positionId: p.position_id, symbol: p.symbol, side: p.side,
                roi, pnl: p.pnl ?? 0, exitSize: exposure, leverage: p.entry_leverage,
            };

            // Per-asset best (deterministic: highest ROI → lowest position_id)
            if (!byAsset[p.symbol]) {
                byAsset[p.symbol] = { bestTrade: null, candidateCount: 0 };
            }
            byAsset[p.symbol].candidateCount++;
            const current = byAsset[p.symbol].bestTrade;
            if (!current || roi > current.roi ||
                (roi === current.roi && p.position_id < current.positionId)) {
                byAsset[p.symbol].bestTrade = trade;
            }

            // Top-level aggregate best (same determinism)
            if (roi > bestROI ||
                (roi === bestROI && bestTrade !== null && p.position_id < bestTrade.positionId)) {
                bestROI = roi;
                bestTrade = trade;
            }
        }

        results.set(wallet, {
            bestTrade,
            candidateCount: tpTrades.length,
            byAsset,
        });
    }

    return results;
}

// --------------------------------------------------------------------------
// Persist daily category scores to the database
//
// Accepts a flat array of CategoryScoreRow. Uses onConflictDoUpdate for
// idempotent upsert behavior -- re-scoring the same date replaces old values.
// --------------------------------------------------------------------------
export async function saveDailyCategoryScores(
    tournamentId: number,
    seasonId: number | null,
    dateStr: string,
    rows: CategoryScoreRow[],
): Promise<void> {
    if (rows.length === 0) {
        console.log(`[CategoryEngine] No scores to save for tournament ${tournamentId} on ${dateStr}`);
        return;
    }

    for (const row of rows) {
        await db.insert(dailyCategoryScores).values({
            tournamentId,
            seasonId,
            wallet: row.wallet,
            category: row.category,
            scoreDate: dateStr,
            score: row.score,
            details: row.details,
        }).onConflictDoUpdate({
            target: [
                dailyCategoryScores.tournamentId,
                dailyCategoryScores.wallet,
                dailyCategoryScores.category,
                dailyCategoryScores.scoreDate,
            ],
            set: {
                score: row.score,
                details: row.details,
                computedAt: new Date(),
            },
        });
    }

    console.log(
        `[CategoryEngine] Saved ${rows.length} category scores ` +
        `for tournament ${tournamentId} on ${dateStr}`,
    );
}
