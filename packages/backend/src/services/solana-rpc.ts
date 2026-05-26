// ============================================================================
// Solana RPC factory + raw JSON-RPC helper
// ============================================================================
//
// Single app-wide Connection instance backed by HELIUS_RPC_URL (env-required,
// no fallbacks). The rpcCall helper exists for calls that web3.js doesn't
// expose cleanly with our needed options (e.g. getProgramAccounts with
// memcmp filters and dataSlice).
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

type RpcError = { code: number; message: string };
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError };

/**
 * Direct JSON-RPC call to Helius. Use when web3.js's typed helpers don't
 * expose the options you need (e.g. dataSlice on getProgramAccounts).
 */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(env.HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`[rpcCall ${method}] HTTP ${res.status}: ${text}`);
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
