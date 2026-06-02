// ============================================================================
// Solana RPC factory + raw JSON-RPC helper
// ============================================================================
//
// Single app-wide Connection instance backed by HELIUS_RPC_URL (env-required,
// no fallbacks). The rpcCall helper exists for calls that web3.js doesn't
// expose cleanly with our needed options (e.g. getProgramAccounts with
// memcmp filters and dataSlice).
//
// Rate limiting: getProgramAccounts (vote enumeration) is the heaviest,
// most-throttled call we make, and bulk paths (bootstrap, the daily vote
// refresh) fire it once per wallet. Flat-out, that bursts past Helius limits →
// 429. Two guards live here so every direct call benefits:
//   1. A global rate-gate spaces calls into fixed time slots, capping the
//      sustained direct-RPC rate.
//   2. Retry-with-backoff on 429 / transient network failures, so a rate limit
//      SLOWS scoring instead of corrupting it — a thrown scorer would otherwise
//      record that activity as 0 for the wallet.
// The web3.js Connection already retries on rate limit (disableRetryOnRateLimit
// = false), so getAccountInfo / Meteora reads are covered separately.
//
// If Helius is down, scoring fails loudly. No silent degradation to public RPC.
// ============================================================================

import { Connection } from '@solana/web3.js';
import { env } from '../config/env.js';

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
    if (!_connection) {
        _connection = new Connection(env.HELIUS_RPC_URL, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: false,
        });
    }
    return _connection;
}

// ---- Direct-RPC rate gate + retry ----

// ~5 direct calls/sec ceiling. Relax (lower) on a higher Helius tier.
const RPC_MIN_INTERVAL_MS = 200;
const RPC_MAX_ATTEMPTS = 6;

let _nextSlot = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserves the next evenly-spaced time slot and waits for it. Serializes
 *  bursts (e.g. the 5 scorers running in parallel) into a bounded rate. */
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

type RpcError = { code: number; message: string };
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError };

/**
 * Direct JSON-RPC call to Helius. Use when web3.js's typed helpers don't
 * expose the options you need (e.g. dataSlice on getProgramAccounts).
 * Rate-gated + retried on 429 / transient network errors.
 */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    let lastErr: Error = new Error(`[rpcCall ${method}] failed`);

    for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
        await rpcThrottle();

        let res: Response;
        try {
            res = await fetch(env.HELIUS_RPC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            });
        } catch (e) {
            // Network error — transient, retry.
            lastErr = e instanceof Error ? e : new Error(String(e));
            if (attempt < RPC_MAX_ATTEMPTS) { await sleep(backoff(attempt)); continue; }
            throw lastErr;
        }

        if (res.status === 429) {
            // Rate limited — back off and retry rather than fail the scorer.
            lastErr = new Error(`[rpcCall ${method}] HTTP 429 (rate limited)`);
            if (attempt < RPC_MAX_ATTEMPTS) { await sleep(backoff(attempt)); continue; }
            throw lastErr;
        }
        if (!res.ok) {
            // Non-429 HTTP error — deterministic, don't retry.
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

    throw lastErr;
}
