// ============================================================================
// Solana RPC factory + raw JSON-RPC helper
// ============================================================================
//
// Single app-wide Connection backed by HELIUS_RPC_URL (env-required, no
// fallbacks). The rpcCall helper exists for calls web3.js doesn't expose
// cleanly (e.g. getProgramAccounts with memcmp + dataSlice).
//
// RATE LIMITING — covers EVERY Helius request:
//   getProgramAccounts (votes, via rpcCall) AND getAccountInfo + the Meteora
//   SDK's reads (via the Connection). Bulk paths (bootstrap, daily vote
//   refresh) fan these out per wallet, which bursts past Helius limits → 429.
//   Both the Connection's fetch and rpcCall go through ONE shared `gatedFetch`:
//     - a global rate-gate (evenly-spaced slots) caps the sustained rate, and
//     - retry-with-backoff on 429 / transient network errors means a rate limit
//       SLOWS scoring instead of corrupting it (a thrown scorer would record
//       that activity as 0 for the wallet).
//   The Connection's own rate-limit retry is disabled (disableRetryOnRateLimit:
//   true) — gatedFetch is the single retry/throttle authority.
//
// If Helius is down, scoring fails loudly. No silent degradation to public RPC.
// ============================================================================

import { Connection } from '@solana/web3.js';
import { env } from '../config/env.js';

// ~4 Helius requests/sec ceiling across the whole process. Relax (lower the
// interval) on a higher Helius tier; raise it if you still see 429s.
const RPC_MIN_INTERVAL_MS = 250;
const RPC_MAX_ATTEMPTS = 6;

let _nextSlot = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserves the next evenly-spaced time slot and waits for it. Serializes
 *  concurrent bursts (parallel scorers, the Meteora SDK's internal calls) into
 *  a bounded global rate. */
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

/**
 * The single fetch path for ALL Helius traffic. Paces every request through the
 * global gate, retries 429s and transient network errors with backoff. Used by
 * both the web3.js Connection (getAccountInfo / Meteora SDK) and rpcCall, so
 * every call shares one rate budget.
 */
const gatedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let lastErr: unknown = new Error('gatedFetch: no attempt made');
    for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
        await rpcThrottle();
        try {
            const res = await fetch(input, init);
            if (res.status !== 429) return res;
            // Rate limited — back off and retry (return the final 429 if exhausted).
            if (attempt >= RPC_MAX_ATTEMPTS) return res;
            await sleep(backoff(attempt));
        } catch (e) {
            lastErr = e;
            if (attempt >= RPC_MAX_ATTEMPTS) throw e;
            await sleep(backoff(attempt));
        }
    }
    throw lastErr;
};

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
    if (!_connection) {
        _connection = new Connection(env.HELIUS_RPC_URL, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true, // gatedFetch is the single throttle/retry authority
            fetch: gatedFetch as unknown as typeof fetch,
        });
    }
    return _connection;
}

type RpcError = { code: number; message: string };
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError };

/**
 * Direct JSON-RPC call to Helius. Use when web3.js's typed helpers don't expose
 * the options you need (e.g. dataSlice on getProgramAccounts). Goes through the
 * same gatedFetch (rate-gate + 429/network retry) as the Connection.
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
