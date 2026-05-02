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
import { ADRENA_TO_LAZER_FEED_ID, ADRENA_TO_PYTH_SYMBOL } from '../types.js';
import type { OHLCBar } from '../types.js';

// Phase 7.b: primary OHLC source — Adrena's Next.js proxy serving Pyth Lazer.
// Verified 2026-05-01: same TradingView UDF response shape as Pyth Benchmarks.
const ADRENA_LAZER_BASE = 'https://www.adrena.trade/api/oracle-bars';

// Phase 7.b D35: throttle between batched fetches to stay under Vercel WAF.
const BATCH_THROTTLE_MS = 200;

// Legacy Pyth Benchmarks (Phase 7.b D33 fallback path).
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
// Phase 7.b: fetch + parse OHLC from a TradingView UDF URL.
//
// Shared between Adrena Pyth Lazer (/api/oracle-bars) and Pyth Benchmarks
// (TradingView shim) — both return identical UDF response shape (s, t, o, h, l, c, v).
//
// Aggregation:
//   - 'daily' = take first bar from response (one-bar-per-day query)
//   - 'intraday' = aggregate hourly bars into a single running open/high/low/close
//
// Uses fetchWithRetry (existing) for shared 429 / network-error backoff logic.
// --------------------------------------------------------------------------
async function fetchOHLCFromUrl(
    url: string,
    contextLabel: string,
    aggregation: 'daily' | 'intraday',
): Promise<OHLCBar | null> {
    try {
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            console.warn(`[PythClient] ${contextLabel}: HTTP ${response.status}`);
            return null;
        }

        const data = (await response.json()) as TradingViewHistoryResponse;

        if (data.s !== 'ok') {
            console.warn(
                `[PythClient] ${contextLabel}: status "${data.s}"` +
                (data.errmsg ? ` (${data.errmsg})` : ''),
            );
            return null;
        }

        if (
            !data.t || !data.o || !data.h || !data.l || !data.c ||
            data.t.length === 0
        ) {
            console.warn(`[PythClient] ${contextLabel}: empty bars`);
            return null;
        }

        if (aggregation === 'daily') {
            return {
                open: data.o[0],
                high: data.h[0],
                low: data.l[0],
                close: data.c[0],
            };
        }

        // intraday: aggregate hourly bars into single running OHLCBar
        return {
            open: data.o[0],
            high: Math.max(...data.h),
            low: Math.min(...data.l),
            close: data.c[data.c.length - 1],
        };
    } catch (error) {
        console.error(
            `[PythClient] ${contextLabel}: fetch error —`,
            error instanceof Error ? error.message : error,
        );
        return null;
    }
}

// --------------------------------------------------------------------------
// Phase 7.b: dispatch helper — try Adrena Pyth Lazer first, fall back to
// Pyth Benchmarks (D33) if Lazer returns null (non-2xx, non-"ok", or empty).
// --------------------------------------------------------------------------
async function fetchOHLCWithFallback(
    adrenaSymbol: string,
    range: { from: number; to: number },
    aggregation: 'daily' | 'intraday',
    feedIdOverride?: number,
): Promise<OHLCBar | null> {
    // 1. Try Adrena Pyth Lazer proxy
    const feedId = feedIdOverride ?? ADRENA_TO_LAZER_FEED_ID[adrenaSymbol];
    if (feedId != null) {
        const resolution = aggregation === 'daily' ? '1D' : '60';
        const url =
            `${ADRENA_LAZER_BASE}` +
            `?feed_id=${feedId}` +
            `&resolution=${resolution}` +
            `&from=${range.from}` +
            `&to=${range.to}`;
        const bar = await fetchOHLCFromUrl(
            url, `Lazer ${adrenaSymbol} feed_id=${feedId} ${aggregation}`, aggregation,
        );
        if (bar) return bar;
        console.warn(
            `[PythClient] Lazer null for ${adrenaSymbol} (feed_id ${feedId}); ` +
            `falling back to Pyth Benchmarks (D33)`,
        );
    }

    // 2. Fall back to Pyth Benchmarks
    const pythSymbol = ADRENA_TO_PYTH_SYMBOL[adrenaSymbol];
    if (!pythSymbol) {
        if (feedId == null) {
            console.warn(
                `[PythClient] No Lazer feed_id and no Pyth Benchmarks symbol for "${adrenaSymbol}" — skipping`,
            );
        }
        return null;
    }
    const resolution = aggregation === 'daily' ? 'D' : '60';
    const url =
        `${PYTH_BENCHMARKS_BASE}/v1/shims/tradingview/history` +
        `?symbol=${encodeURIComponent(pythSymbol)}` +
        `&resolution=${resolution}` +
        `&from=${range.from}` +
        `&to=${range.to}`;
    return fetchOHLCFromUrl(
        url, `Benchmarks ${adrenaSymbol} ${pythSymbol} ${aggregation}`, aggregation,
    );
}

// --------------------------------------------------------------------------
// Fetch a single daily OHLC bar from Pyth for a given Adrena symbol + date
//
// Phase 7.b: tries Adrena Pyth Lazer proxy first; D33 fallback to Pyth Benchmarks.
// Checks DB cache first. If not cached, fetches and caches.
// Returns null if no mapping is found or both fetches fail.
// --------------------------------------------------------------------------
export async function fetchDailyOHLC(
    adrenaSymbol: string,
    dateStr: string,
    feedIdOverride?: number,  // Phase 7.b
): Promise<OHLCBar | null> {
    // 1. Check DB cache (cache key: adrenaSymbol — D34, no schema migration)
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

    // 2. Fetch via dispatch (Lazer → Pyth Benchmarks fallback per D33)
    const range = dateToUnixRange(dateStr);
    const bar = await fetchOHLCWithFallback(adrenaSymbol, range, 'daily', feedIdOverride);
    if (!bar) {
        return null;
    }

    // 3. Cache the result (immutable — daily bar won't change)
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
        `[PythClient] Fetched daily OHLC for ${adrenaSymbol} on ${dateStr}: ` +
        `O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)}`,
    );

    return bar;
}

// --------------------------------------------------------------------------
// Fetch daily OHLC for ALL supported Adrena assets for a given date
//
// Returns a Map<adrenaSymbol, OHLCBar>. Missing bars are omitted (not null).
// --------------------------------------------------------------------------
export async function fetchDailyOHLCBatch(
    dateStr: string,
    assetList?: Array<{ symbol: string; feed_id?: number }>,  // Phase 7.b D27
): Promise<Map<string, OHLCBar>> {
    const results = new Map<string, OHLCBar>();
    // Phase 7.b: prefer caller's assetList; fall back to known Lazer mapping.
    const targets = assetList?.length
        ? assetList.map((a) => ({ symbol: a.symbol, feed_id: a.feed_id }))
        : Object.keys(ADRENA_TO_LAZER_FEED_ID).map((s) => ({ symbol: s, feed_id: undefined as number | undefined }));

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const bar = await fetchDailyOHLC(target.symbol, dateStr, target.feed_id);
        if (bar) {
            results.set(target.symbol, bar);
        }
        // D35: throttle between fetches to stay under Vercel WAF (skip after last)
        if (i < targets.length - 1) {
            await sleep(BATCH_THROTTLE_MS);
        }
    }

    console.log(
        `[PythClient] Batch OHLC for ${dateStr}: ${results.size}/${targets.length} assets fetched`,
    );

    return results;
}

// --------------------------------------------------------------------------
// Fetch INTRADAY OHLC for a single asset — current UTC day only
//
// Uses resolution=60 (hourly bars) instead of resolution=D (daily).
// Aggregates all hourly bars into a running high/low for the day so far.
//
// Does NOT write to pyth_ohlc_cache — intraday data is provisional and
// changes every hour. Only the midnight job's fetchDailyOHLC caches
// finalized daily bars.
//
// Returns null if:
//   - Symbol not mapped
//   - Fetch fails
//   - No bars returned (day just started, no data yet)
// --------------------------------------------------------------------------
export async function fetchIntradayOHLC(
    adrenaSymbol: string,
    dateStr: string,
    feedIdOverride?: number,  // Phase 7.b
): Promise<OHLCBar | null> {
    // 1. Build time range: midnight UTC of dateStr → now
    const from = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
    const to = Math.floor(Date.now() / 1000);

    // Safety: if 'to' is before 'from', the date is in the future
    if (to < from) {
        console.warn(`[PythClient] Intraday request for future date ${dateStr}, skipping`);
        return null;
    }

    // 2. Fetch via dispatch (Lazer → Pyth Benchmarks fallback per D33).
    // Intentionally NO cache write — intraday data is provisional and changes hourly.
    const bar = await fetchOHLCWithFallback(adrenaSymbol, { from, to }, 'intraday', feedIdOverride);
    if (bar) {
        console.log(
            `[PythClient] Fetched intraday OHLC for ${adrenaSymbol} on ${dateStr}: ` +
            `O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)}`,
        );
    }
    return bar;
}

// --------------------------------------------------------------------------
// Fetch intraday OHLC for ALL supported Adrena assets for a given date
//
// Returns a Map<adrenaSymbol, OHLCBar>. Missing bars are omitted (not null).
// Same pattern as fetchDailyOHLCBatch but using fetchIntradayOHLC.
// --------------------------------------------------------------------------
export async function fetchIntradayOHLCBatch(
    dateStr: string,
    assetList?: Array<{ symbol: string; feed_id?: number }>,  // Phase 7.b D27
): Promise<Map<string, OHLCBar>> {
    const results = new Map<string, OHLCBar>();
    // Phase 7.b: prefer caller's assetList; fall back to known Lazer mapping.
    const targets = assetList?.length
        ? assetList.map((a) => ({ symbol: a.symbol, feed_id: a.feed_id }))
        : Object.keys(ADRENA_TO_LAZER_FEED_ID).map((s) => ({ symbol: s, feed_id: undefined as number | undefined }));

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const bar = await fetchIntradayOHLC(target.symbol, dateStr, target.feed_id);
        if (bar) {
            results.set(target.symbol, bar);
        }
        // D35: throttle between fetches to stay under Vercel WAF (skip after last)
        if (i < targets.length - 1) {
            await sleep(BATCH_THROTTLE_MS);
        }
    }

    console.log(
        `[PythClient] Intraday batch for ${dateStr}: ${results.size}/${targets.length} assets fetched`,
    );

    return results;
}
