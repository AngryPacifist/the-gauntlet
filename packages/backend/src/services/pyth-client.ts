// ============================================================================
// Pyth Benchmarks Client
//
// Fetches daily OHLC candle data from the Pyth Benchmarks TradingView shim.
// Used by the Top Bottom Fisher category to get daily high/low prices.
//
// API: https://benchmarks.pyth.network/v1/shims/tradingview/history
// No API key required. Rate limit: 90 requests / 10 seconds (TradingView shim).
//
// Daily bars are immutable once the day ends — we cache them permanently
// in the pyth_ohlc_cache table to avoid redundant calls.
// ============================================================================

import { db } from '../db/index.js';
import { pythOhlcCache } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { ADRENA_TO_PYTH_SYMBOL } from '../types.js';
import type { OHLCBar } from '../types.js';

const PYTH_BENCHMARKS_BASE = 'https://benchmarks.pyth.network';

// --------------------------------------------------------------------------
// TradingView History API response shape
// --------------------------------------------------------------------------
interface TradingViewHistoryResponse {
    s: 'ok' | 'error' | 'no_data';
    t?: number[];  // timestamps
    o?: number[];  // open
    h?: number[];  // high
    l?: number[];  // low
    c?: number[];  // close
    v?: number[];  // volume
    errmsg?: string;
}

// --------------------------------------------------------------------------
// Internal: fetch with retry + backoff
// --------------------------------------------------------------------------
async function fetchWithRetry(
    url: string,
    maxRetries: number = 3,
): Promise<Response> {
    const delays = [2000, 4000, 8000]; // exponential backoff in ms

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);

            // Rate limited — wait 60 seconds per Pyth docs, then retry once
            if (response.status === 429 && attempt < maxRetries) {
                console.warn(`[PythClient] Rate limited (429). Waiting 60s before retry...`);
                await sleep(60000);
                continue;
            }

            return response;
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = delays[Math.min(attempt, delays.length - 1)];
            console.warn(
                `[PythClient] Fetch failed (attempt ${attempt + 1}/${maxRetries + 1}): ` +
                `${error instanceof Error ? error.message : error}. ` +
                `Retrying in ${delay}ms...`,
            );
            await sleep(delay);
        }
    }

    // Should not reach here, but TypeScript needs it
    throw new Error('Exhausted retries');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Convert a UTC date string (YYYY-MM-DD) to start/end unix timestamps
// --------------------------------------------------------------------------
function dateToUnixRange(dateStr: string): { from: number; to: number } {
    // Start of the day: midnight UTC
    const startOfDay = new Date(dateStr + 'T00:00:00Z');
    // End of the day: 23:59:59 UTC
    const endOfDay = new Date(dateStr + 'T23:59:59Z');

    return {
        from: Math.floor(startOfDay.getTime() / 1000),
        to: Math.floor(endOfDay.getTime() / 1000),
    };
}

// --------------------------------------------------------------------------
// Fetch a single daily OHLC bar from Pyth for a given Adrena symbol + date
//
// Checks DB cache first. If not cached, fetches from Pyth and caches.
// Returns null if the symbol is not mapped or the fetch fails.
// --------------------------------------------------------------------------
export async function fetchDailyOHLC(
    adrenaSymbol: string,
    dateStr: string,
): Promise<OHLCBar | null> {
    // 1. Resolve Pyth symbol
    const pythSymbol = ADRENA_TO_PYTH_SYMBOL[adrenaSymbol];
    if (!pythSymbol) {
        console.warn(`[PythClient] No Pyth mapping for Adrena symbol "${adrenaSymbol}"`);
        return null;
    }

    // 2. Check DB cache
    const [cached] = await db
        .select()
        .from(pythOhlcCache)
        .where(
            and(
                eq(pythOhlcCache.symbol, adrenaSymbol),
                eq(pythOhlcCache.barDate, dateStr),
            ),
        )
        .limit(1);

    if (cached) {
        return {
            open: cached.open,
            high: cached.high,
            low: cached.low,
            close: cached.close,
        };
    }

    // 3. Fetch from Pyth Benchmarks
    const { from, to } = dateToUnixRange(dateStr);
    const url =
        `${PYTH_BENCHMARKS_BASE}/v1/shims/tradingview/history` +
        `?symbol=${encodeURIComponent(pythSymbol)}` +
        `&resolution=D` +
        `&from=${from}` +
        `&to=${to}`;

    try {
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            console.error(
                `[PythClient] HTTP ${response.status} fetching OHLC for ${adrenaSymbol} on ${dateStr}`,
            );
            return null;
        }

        const data = (await response.json()) as TradingViewHistoryResponse;

        if (data.s !== 'ok') {
            console.warn(
                `[PythClient] Pyth returned status "${data.s}" for ${adrenaSymbol} on ${dateStr}` +
                (data.errmsg ? `: ${data.errmsg}` : ''),
            );
            return null;
        }

        // Validate response arrays exist and are non-empty
        if (
            !data.t || !data.o || !data.h || !data.l || !data.c ||
            data.t.length === 0
        ) {
            console.warn(
                `[PythClient] Empty OHLC data for ${adrenaSymbol} on ${dateStr}`,
            );
            return null;
        }

        // Use the FIRST bar returned (should be the daily bar for our date)
        const bar: OHLCBar = {
            open: data.o[0],
            high: data.h[0],
            low: data.l[0],
            close: data.c[0],
        };

        // 4. Cache in DB (immutable — daily bar won't change)
        try {
            await db.insert(pythOhlcCache).values({
                symbol: adrenaSymbol,
                barDate: dateStr,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
            });
        } catch (cacheError) {
            // UNIQUE constraint violation = another process cached it first. That's fine.
            console.warn(
                `[PythClient] Cache insert for ${adrenaSymbol}/${dateStr} failed (likely duplicate):`,
                cacheError instanceof Error ? cacheError.message : cacheError,
            );
        }

        console.log(
            `[PythClient] Fetched OHLC for ${adrenaSymbol} on ${dateStr}: ` +
            `O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)}`,
        );

        return bar;
    } catch (error) {
        console.error(
            `[PythClient] Failed to fetch OHLC for ${adrenaSymbol} on ${dateStr}:`,
            error instanceof Error ? error.message : error,
        );
        return null;
    }
}

// --------------------------------------------------------------------------
// Fetch daily OHLC for ALL supported Adrena assets for a given date
//
// Returns a Map<adrenaSymbol, OHLCBar>. Missing bars are omitted (not null).
// --------------------------------------------------------------------------
export async function fetchDailyOHLCBatch(
    dateStr: string,
): Promise<Map<string, OHLCBar>> {
    const results = new Map<string, OHLCBar>();
    const symbols = Object.keys(ADRENA_TO_PYTH_SYMBOL);

    for (const symbol of symbols) {
        const bar = await fetchDailyOHLC(symbol, dateStr);
        if (bar) {
            results.set(symbol, bar);
        }
    }

    console.log(
        `[PythClient] Batch OHLC for ${dateStr}: ${results.size}/${symbols.length} assets fetched`,
    );

    return results;
}
