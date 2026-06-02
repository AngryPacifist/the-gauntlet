// ============================================================================
// Solana RPC factory + raw JSON-RPC helper
// ============================================================================
//
// Single app-wide Connection backed by HELIUS_RPC_URL (env-required, no
// fallbacks). The rpcCall helper exists for calls web3.js doesn't expose
// cleanly (e.g. getProgramAccounts with memcmp + dataSlice).
//
// RATE LIMITING — assumption-free. EVERY Helius request is throttled, no matter
// who issues it, via THREE redundant routes onto one shared `gatedFetch`:
//   1. rpcCall (vote getProgramAccounts) calls gatedFetch directly.
//   2. The Connection we build is given `fetch: gatedFetch` (so getAccountInfo
//      and the Meteora SDK reads go through it — even if web3.js uses an
//      internal fetch rather than the global).
//   3. The global `fetch` is wrapped so ANY request to the Helius HOST is gated
//      — covers a caller we don't construct (a third-party SDK's own
//      Connection). Non-Helius requests (Adrena datapi, Pyth) pass straight
//      through, untouched.
// gatedFetch always calls the captured REAL fetch, so no path is gated twice.
// One global rate-gate (evenly-spaced slots) caps the sustained rate; 429 +
// transient network errors are retried with backoff so a rate limit SLOWS
// scoring instead of corrupting it (a thrown scorer would record that activity
// as 0 for the wallet). The Connection's own rate-limit retry is disabled —
// gatedFetch is the sole throttle/retry authority.
//
// If Helius is down, scoring fails loudly. No silent degradation to public RPC.
// ============================================================================

import { Connection } from '@solana/web3.js';
import { env } from '../config/env.js';

// ~4 Helius requests/sec ceiling across the whole process. Raise the interval
// if 429s persist (stricter tier); lower it on a higher Helius tier.
const RPC_MIN_INTERVAL_MS = 250;
const RPC_MAX_ATTEMPTS = 6;

let _nextSlot = 0;

// The real fetch, captured BEFORE we wrap the global one. gatedFetch calls THIS
// (never the wrapper) so no request is throttled twice.
const _realFetch: typeof fetch = globalThis.fetch.bind(globalThis) as typeof fetch;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserves the next evenly-spaced time slot and waits for it. Serializes
 *  concurrent bursts (parallel scorers, the SDK's internal calls) into a
 *  bounded global rate. */
async function rpcThrottle(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, _nextSlot);
    _nextSlot = slot + RPC_MIN_INTERVAL_MS;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
}

function backoff(attempt: number): number {
    return Math.min(500 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
}

/** Gate + 429/network retry, calling the REAL fetch. The single throttle for
 *  all Helius traffic. */
async function gatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let lastErr: unknown = new Error('gatedFetch: no attempt made');
    for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
        await rpcThrottle();
        try {
            const res = await _realFetch(input, init);
            if (res.status !== 429) return res;
            if (attempt >= RPC_MAX_ATTEMPTS) return res; // exhausted — let caller see the 429
            await sleep(backoff(attempt));
        } catch (e) {
            lastErr = e;
            if (attempt >= RPC_MAX_ATTEMPTS) throw e;
            await sleep(backoff(attempt));
        }
    }
    throw lastErr;
}

// ---- Global safety net: gate ANY request to the Helius host ----
// env is read lazily (only when a request is matched) so module load is safe
// regardless of dotenv ordering.

let _heliusHost: string | null = null;
function heliusHost(): string {
    if (_heliusHost === null) {
        try { _heliusHost = new URL(env.HELIUS_RPC_URL).host; } catch { _heliusHost = ''; }
    }
    return _heliusHost;
}

function isHeliusRequest(input: RequestInfo | URL): boolean {
    const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : (input as Request).url ?? '';
    const host = heliusHost();
    if (!host) return false;
    try { return new URL(url).host === host; } catch { return false; }
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    isHeliusRequest(input) ? gatedFetch(input, init) : _realFetch(input, init)
) as typeof fetch;

// ---- Connection ----

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
    if (!_connection) {
        _connection = new Connection(env.HELIUS_RPC_URL, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true, // gatedFetch is the sole throttle/retry authority
            fetch: gatedFetch as unknown as typeof fetch,
        });
    }
    return _connection;
}

// ---- Direct JSON-RPC ----

type RpcError = { code: number; message: string };
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError };

/**
 * Direct JSON-RPC call to Helius. Use when web3.js's typed helpers don't expose
 * the options you need (e.g. dataSlice on getProgramAccounts). Goes through the
 * same gatedFetch (rate-gate + 429/network retry) as everything else.
 */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await gatedFetch(env.HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
        throw new Error(`[rpcCall ${method}] HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as RpcResponse<T>;
    if (body.error) {
        throw new Error(`[rpcCall ${method}] RPC error ${body.error.code}: ${body.error.message}`);
    }
    if (body.result === undefined) {
        throw new Error(`[rpcCall ${method}] missing result`);
    }
    return body.result;
}
