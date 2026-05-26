// ============================================================================
// Vote cache — DB-coupled refresh helper around realms-client
// ============================================================================
//
// SPL Gov getProgramAccounts is expensive (cross-realm scan + per-account
// type filter on the client side). Activity 2 scoring would hit it on
// every wallet scoring run if we read live. Instead, we cache per-wallet
// vote counts in `mutagen_vote_cache` and refresh daily (per OUTIS).
//
// Refresh strategy:
//   - On-demand: scorer calls refreshVoteCacheForWallet() if cache is stale
//     (>24h since refreshedAt) or missing
//   - Daily scheduled: a background job (Commit 17 scheduler reshape) walks
//     wallets present in mutagen_user_scores and refreshes their entries
//     so the next scoring run hits a warm cache
//
// Separation rationale: realms-client.ts is pure RPC (testable without DB).
// This module is the DB-coupled half. Activity 2 scorer reads from the
// cache (via this module) and falls back to a live refresh if cold.
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mutagenVoteCache } from '../db/schema.js';
import {
    getWalletVoteCount,
    getTokenOwnerRecordPubkey,
} from './realms-client.js';

export const VOTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface VoteCacheEntry {
    wallet: string;
    voteCount: number;
    hasTokenOwnerRecord: boolean;
    refreshedAt: Date;
}

/**
 * Reads the cached vote info for a wallet. Returns null if not cached.
 * Does NOT auto-refresh — caller decides based on freshness.
 */
export async function readVoteCache(wallet: string): Promise<VoteCacheEntry | null> {
    const rows = await db
        .select()
        .from(mutagenVoteCache)
        .where(eq(mutagenVoteCache.wallet, wallet))
        .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        wallet: r.wallet,
        voteCount: r.voteCount,
        hasTokenOwnerRecord: r.hasTokenOwnerRecord,
        refreshedAt: r.refreshedAt,
    };
}

/**
 * Returns true if the cache entry is fresh (within TTL).
 */
export function isVoteCacheFresh(entry: VoteCacheEntry | null): boolean {
    if (!entry) return false;
    return Date.now() - entry.refreshedAt.getTime() < VOTE_CACHE_TTL_MS;
}

/**
 * Hits SPL Gov via realms-client, upserts into mutagen_vote_cache, returns
 * the fresh entry. Idempotent — safe to call concurrently for different
 * wallets, and concurrent calls for the SAME wallet will both succeed with
 * the second overwriting (which is fine; both produce the same value).
 *
 * This is what the daily scheduler calls per wallet, and what scorers call
 * on cache miss.
 */
export async function refreshVoteCacheForWallet(wallet: string): Promise<VoteCacheEntry> {
    const walletPk = new PublicKey(wallet);
    const [voteCount, torPubkey] = await Promise.all([
        getWalletVoteCount(walletPk),
        getTokenOwnerRecordPubkey(walletPk),
    ]);
    const hasTokenOwnerRecord = torPubkey !== null;
    const refreshedAt = new Date();

    await db
        .insert(mutagenVoteCache)
        .values({
            wallet,
            voteCount,
            hasTokenOwnerRecord,
            refreshedAt,
        })
        .onConflictDoUpdate({
            target: mutagenVoteCache.wallet,
            set: { voteCount, hasTokenOwnerRecord, refreshedAt },
        });

    return { wallet, voteCount, hasTokenOwnerRecord, refreshedAt };
}

/**
 * Convenience: read-then-refresh-if-stale. Activity 2 scorer's primary path.
 */
export async function getVoteCacheFreshOrRefresh(wallet: string): Promise<VoteCacheEntry> {
    const cached = await readVoteCache(wallet);
    if (isVoteCacheFresh(cached)) return cached!;
    return refreshVoteCacheForWallet(wallet);
}
