// ============================================================================
// Token Price API (Pyth Benchmarks → Jupiter → admin static cascade)
//
// GET /api/prices/usd?symbols=A,B,C&mints=mintA,mintB,mintC&statics=,,0.05
//
//   symbols  (required) — comma-separated, order-preserving
//   mints    (optional) — Fork A: parallel array, empty slot = use server-
//                         side KNOWN_PRIZE_TOKEN_MINT[symbol]. Admin-supplied
//                         mint takes precedence (lets admin add a new prize
//                         token without modifying server-side maps).
//   statics  (optional) — Fork B: parallel array, empty slot = no static for
//                         that symbol. Numeric USD-per-token; used ONLY if
//                         Pyth + Jupiter both return null. Per-request, not
//                         cached server-side (the static is fixed in admin
//                         config; no point memoizing).
//
// Cascade per symbol:
//   1. Pyth Benchmarks via PRIZE_TOKEN_PYTH_SYMBOL map (separate from
//      types.ts:ADRENA_TO_PYTH_SYMBOL which is the trading-asset map).
//      Covers JTO, USDC empirically. NOT ADX (Pyth doesn't index it).
//   2. Jupiter price v3 (lite-api.jup.ag/price/v3) via mint lookup. Admin-
//      supplied mint (Fork A) > KNOWN_PRIZE_TOKEN_MINT[symbol] > null.
//      Mint-based query is mandatory: Jupiter v3 rejects symbol-only
//      queries, and the ADX symbol is shared by two distinct tokens.
//   3. Admin-supplied static (Fork B). Used only if both feeds returned
//      null. Pass-through from tokens[].staticUsdPrice in tournament config.
//
// If all three return null: response sends {usd: null, source: null} and FE
// renders `—` per adjacent "price-feed failure UX" decision.
//
// Server-side cache (60s TTL): only memoizes Pyth/Jupiter network calls.
// Statics are NOT cached — they're per-request and don't involve I/O. Cache
// key is `mint || symbol:<symbol>` so admin-supplied mints don't collide
// with server-side defaults (two tournaments could use different mints for
// the same symbol — cache them independently).
// ============================================================================

import { Router } from 'express';

const router = Router();

// Pyth Benchmarks symbol map for PRIZE tokens (distinct from trading-asset
// map in types.ts:ADRENA_TO_PYTH_SYMBOL). ADX intentionally omitted — Pyth
// returns "Symbol doesn't exist" for Crypto.ADX/USD (empirically verified
// 2026-05-15). Extend this map as Adrena adds new prize tokens that Pyth
// indexes.
const PRIZE_TOKEN_PYTH_SYMBOL: Record<string, string> = {
    JTO: 'Crypto.JTO/USD',
    USDC: 'Crypto.USDC/USD',
};

// SPL token mints for Jupiter v3 mint-based queries — server-side defaults
// for well-known prize tokens. Admin-supplied mints (via ?mints=) override.
// Empirically verified 2026-05-15 via Jupiter token-search:
//   - ADX: Adrena Governance Token, isVerified=true
//   - JTO: liquidity confirmed
//   - USDC: stablecoin
// Extending this map is optional for handover; admin can add new tokens
// directly via tokens[].mint without a code change (Fork A).
const KNOWN_PRIZE_TOKEN_MINT: Record<string, string> = {
    ADX: 'AuQaustGiaqxRvj2gtCdrd22PBzTn8kM3kEPEkZCtuDw',
    JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

interface CacheEntry { usd: number; source: 'pyth' | 'jupiter'; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

const PYTH_BASE = 'https://benchmarks.pyth.network';
const JUPITER_BASE = 'https://lite-api.jup.ag/price/v3';

async function fetchPythPrice(symbol: string): Promise<number | null> {
    const pythSymbol = PRIZE_TOKEN_PYTH_SYMBOL[symbol];
    if (!pythSymbol) return null;
    try {
        const now = Math.floor(Date.now() / 1000);
        const from = now - 600; // 10-min window
        const url = `${PYTH_BASE}/v1/shims/tradingview/history?symbol=${encodeURIComponent(pythSymbol)}&resolution=1&from=${from}&to=${now}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json() as { s: string; c?: number[] };
        if (data.s !== 'ok' || !data.c || data.c.length === 0) return null;
        return data.c[data.c.length - 1];
    } catch { return null; }
}

// Fork A: takes optional adminMint that overrides KNOWN_PRIZE_TOKEN_MINT.
// Returns null if neither source has a mint for this symbol.
async function fetchJupiterPrice(symbol: string, adminMint?: string): Promise<number | null> {
    const mint = adminMint || KNOWN_PRIZE_TOKEN_MINT[symbol];
    if (!mint) return null;  // can't query Jupiter v3 without a mint; symbol-only fails
    try {
        const url = `${JUPITER_BASE}?ids=${encodeURIComponent(mint)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        // Jupiter v3 response shape: { "<mint>": { usdPrice: number, ... } }
        // (NOT v2's { data: { "<id>": { price: number } } } — that endpoint is 404).
        const data = await res.json() as Record<string, { usdPrice?: number }>;
        const entry = data[mint];
        return entry?.usdPrice ?? null;
    } catch { return null; }
}

router.get('/usd', async (req, res) => {
    try {
        const symbolsParam = (req.query.symbols as string) || '';
        const mintsParam = (req.query.mints as string) || '';
        const staticsParam = (req.query.statics as string) || '';

        const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean);
        if (symbols.length === 0) {
            res.status(400).json({ success: false, error: 'symbols query param required (comma-separated)' });
            return;
        }
        // Parallel arrays — preserve empty slots to maintain index alignment.
        // Trim only (don't filter Boolean) so `?mints=mint1,,mint3` works.
        const mints = mintsParam ? mintsParam.split(',').map((s) => s.trim()) : [];
        const statics = staticsParam ? staticsParam.split(',').map((s) => s.trim()) : [];

        const now = Date.now();
        const result: Record<string, { usd: number | null; source: string | null }> = {};

        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            const adminMint = mints[i] || undefined;  // empty string → undefined
            const adminStaticStr = statics[i] || '';
            const adminStatic = adminStaticStr ? Number(adminStaticStr) : NaN;

            // Cache key: admin mint takes precedence (disambiguates symbol collisions).
            const cacheKey = adminMint || `symbol:${symbol}`;
            const cached = cache.get(cacheKey);
            if (cached && cached.expiresAt > now) {
                result[symbol] = { usd: cached.usd, source: cached.source };
                continue;
            }

            // Cascade: Pyth → Jupiter → admin static
            let usd: number | null = null;
            let source: 'pyth' | 'jupiter' | 'static' | null = null;
            usd = await fetchPythPrice(symbol);
            if (usd !== null) source = 'pyth';
            if (usd === null) {
                usd = await fetchJupiterPrice(symbol, adminMint);
                if (usd !== null) source = 'jupiter';
            }

            // Cache Pyth/Jupiter result if any (not static — fixed in config).
            if (usd !== null && (source === 'pyth' || source === 'jupiter')) {
                cache.set(cacheKey, { usd, source, expiresAt: now + CACHE_TTL_MS });
                result[symbol] = { usd, source };
                continue;
            }

            // Final fallback (Fork B / G2): admin static.
            if (!isNaN(adminStatic) && adminStatic > 0) {
                result[symbol] = { usd: adminStatic, source: 'static' };
            } else {
                result[symbol] = { usd: null, source: null };
            }
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Prices] Error fetching USD prices:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});

export default router;
