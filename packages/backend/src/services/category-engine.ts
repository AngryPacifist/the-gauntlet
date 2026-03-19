// ============================================================================
// Category Engine — Daily Tactical Category Scoring
//
// Implements two ZeDef-proposed daily competition categories:
// 1. "All Around Trader" — best ROI per unique asset traded, summed
// 2. "Top Bottom Fisher" — entry precision relative to daily high/low
//
// These run alongside the main CPI-based bracket tournament and provide
// daily engagement loops for all traders (including eliminated ones).
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
} from '../types.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

// All Around Trader: minimum trade size in USD (entry_size × entry_price)
const ALL_AROUND_MIN_TRADE_USD = 1000;

// All Around Trader: max points per asset (cap to prevent one outlier dominating)
const ALL_AROUND_MAX_POINTS_PER_ASSET = 25;

// Fisher: rank points awarded to top 3 in each direction
const FISHER_RANK_POINTS = [3, 2, 1]; // 1st, 2nd, 3rd

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
 * Compute ROI for a position.
 * ROI = pnl / (entry_size × entry_price)
 * Returns 0 if position has no realized PnL (still open) or denominator is 0.
 */
function computePositionROI(position: AdrenaPosition): number {
    if (position.pnl === null || position.pnl === undefined) {
        return 0;
    }
    const exposure = position.entry_size * position.entry_price;
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
// - Min trade size: $1,000 (entry_size × entry_price)
// - Negative ROI = 0 points (not negative)
// - Only closed positions count (need realized PnL)
// ============================================================================

/**
 * Compute All Around Trader score for a single wallet on a single day.
 *
 * Algorithm:
 * 1. Filter to positions opened on the given UTC day
 * 2. Filter to closed positions only (need realized PnL)
 * 3. Filter to positions ≥ $1,000 exposure
 * 4. Group by symbol
 * 5. For each symbol: select position with highest ROI
 *    - ROI > 0 → min(ROI × 25, 25) points
 *    - ROI ≤ 0 → 0 points
 * 6. Sum across all assets
 */
export function computeAllAroundScore(
    positions: AdrenaPosition[],
    dateStr: string,
): AllAroundDetails {
    const dayPositions = filterPositionsForDay(positions, dateStr);

    // Filter: closed only + minimum trade size
    const qualifying = dayPositions.filter((p) => {
        if (p.status === 'open') return false;
        const exposure = p.entry_size * p.entry_price;
        return exposure >= ALL_AROUND_MIN_TRADE_USD;
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
            ? Math.min(bestROI * 25, ALL_AROUND_MAX_POINTS_PER_ASSET)
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
// TOP BOTTOM FISHER
//
// ZeDef's spec:
// - At end of UTC day, capture daily high/low from Pyth OHLC data
// - Rank longs by how close entry price was to the day's LOW (best long entry)
// - Rank shorts by how close entry price was to the day's HIGH (best short entry)
// - Top 3 each direction get rank points (3, 2, 1), multiplied by ROI
// - Best trade per trader per direction
//
// This is a TOURNAMENT-WIDE computation — rankings require comparing all traders.
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
 * Algorithm:
 * 1. For each wallet: find best long (highest proximity to day low)
 *    and best short (highest proximity to day high) across all assets
 * 2. Rank all best longs by proximity — top 3 get rank points
 * 3. Rank all best shorts by proximity — top 3 get rank points
 * 4. Score = rank_points × max(ROI, 0) × 100
 *
 * Returns a Map<wallet, FisherDetails>
 */
export function computeFisherScores(
    walletPositions: Map<string, AdrenaPosition[]>,
    dateStr: string,
    ohlcData: Map<string, OHLCBar>,
): Map<string, FisherDetails> {
    const results = new Map<string, FisherDetails>();

    // Phase 1: Find each wallet's best long and best short for the day
    const allLongs: FisherCandidate[] = [];
    const allShorts: FisherCandidate[] = [];

    for (const [wallet, positions] of walletPositions) {
        const dayPositions = filterPositionsForDay(positions, dateStr);

        let bestLong: FisherCandidate | null = null;
        let bestShort: FisherCandidate | null = null;

        for (const p of dayPositions) {
            const ohlc = ohlcData.get(p.symbol);
            if (!ohlc) continue;

            // Skip assets with zero price range (division by zero)
            const range = ohlc.high - ohlc.low;
            if (range <= 0) continue;

            const roi = computePositionROI(p);

            if (p.side === 'long') {
                // Long proximity: how close entry was to the day's LOW
                // 1.0 = entered at exact low (perfect), 0.0 = entered at high (worst)
                const proximity = 1 - ((p.entry_price - ohlc.low) / range);
                // Clamp to [0, 1] — entry could be outside day's range
                const clampedProximity = Math.max(0, Math.min(1, proximity));

                if (!bestLong || clampedProximity > bestLong.proximity) {
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

                if (!bestShort || clampedProximity > bestShort.proximity) {
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

        // Initialize all wallets with empty details (will be populated after ranking)
        results.set(wallet, {
            longEntry: null,
            shortEntry: null,
            totalPoints: 0,
        });
    }

    // Phase 2: Rank longs by proximity (descending) — top 3 get rank points
    allLongs.sort((a, b) => b.proximity - a.proximity);
    for (let i = 0; i < allLongs.length; i++) {
        const candidate = allLongs[i];
        const rank = i < FISHER_RANK_POINTS.length ? i + 1 : null;
        const rankPoints = rank !== null ? FISHER_RANK_POINTS[i] : 0;
        const pointsFromLong = rankPoints * Math.max(candidate.roi, 0) * 100;

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
        existing.totalPoints += pointsFromLong;
    }

    // Phase 3: Rank shorts by proximity (descending) — top 3 get rank points
    allShorts.sort((a, b) => b.proximity - a.proximity);
    for (let i = 0; i < allShorts.length; i++) {
        const candidate = allShorts[i];
        const rank = i < FISHER_RANK_POINTS.length ? i + 1 : null;
        const rankPoints = rank !== null ? FISHER_RANK_POINTS[i] : 0;
        const pointsFromShort = rankPoints * Math.max(candidate.roi, 0) * 100;

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
        existing.totalPoints += pointsFromShort;
    }

    return results;
}

// --------------------------------------------------------------------------
// Persist daily category scores to the database
// --------------------------------------------------------------------------
export async function saveDailyCategoryScores(
    tournamentId: number,
    seasonId: number | null,
    dateStr: string,
    allAroundScores: Map<string, AllAroundDetails>,
    fisherScores: Map<string, FisherDetails>,
): Promise<void> {
    const rows: Array<{
        tournamentId: number;
        seasonId: number | null;
        wallet: string;
        category: string;
        scoreDate: string;
        score: number;
        details: AllAroundDetails | FisherDetails;
    }> = [];

    // Collect All Around rows
    for (const [wallet, details] of allAroundScores) {
        rows.push({
            tournamentId,
            seasonId,
            wallet,
            category: 'all_around',
            scoreDate: dateStr,
            score: details.totalPoints,
            details,
        });
    }

    // Collect Fisher rows
    for (const [wallet, details] of fisherScores) {
        rows.push({
            tournamentId,
            seasonId,
            wallet,
            category: 'fisher',
            scoreDate: dateStr,
            score: details.totalPoints,
            details,
        });
    }

    if (rows.length === 0) {
        console.log(`[CategoryEngine] No scores to save for tournament ${tournamentId} on ${dateStr}`);
        return;
    }

    // Insert with ON CONFLICT DO UPDATE for idempotency
    for (const row of rows) {
        try {
            await db.insert(dailyCategoryScores).values(row);
        } catch (error) {
            // UNIQUE constraint violation — update existing
            if (error instanceof Error && error.message.includes('unique')) {
                console.warn(
                    `[CategoryEngine] Duplicate score for ${row.wallet}/${row.category}/${row.scoreDate}, skipping`,
                );
            } else {
                throw error;
            }
        }
    }

    console.log(
        `[CategoryEngine] Saved ${rows.length} category scores ` +
        `for tournament ${tournamentId} on ${dateStr}`,
    );
}
