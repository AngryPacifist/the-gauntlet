// ============================================================================
// Adrena API Client
//
// Wraps the Adrena public API at datapi.adrena.trade.
// Primary endpoint for competitions: GET /position (trade history per wallet)
//
// Reference: resources/adrena-api-reference.md
// ============================================================================

import type { AdrenaPosition } from '../types.js';

const DEFAULT_BASE_URL = 'https://datapi.adrena.trade';

// Cache duration for trade data: 5 minutes
// The Adrena API doesn't document rate limits, but we should be respectful.
// During active rounds, the scheduler refreshes scores every 15 minutes,
// so a 5-minute cache means at most 3 fetches per wallet per refresh cycle.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
    data: T;
    fetchedAt: number;
}

export class AdrenaClient {
    private baseUrl: string;
    private positionCache: Map<string, CacheEntry<AdrenaPosition[]>> = new Map();

    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl ?? process.env.ADRENA_API_URL ?? DEFAULT_BASE_URL;
    }

    // --------------------------------------------------------------------------
    // GET /position — Fetch trade history for a wallet
    //
    // Returns ALL positions (open + closed + liquidated) for the given wallet.
    // The `limit` param caps the number of results returned.
    //
    // API response shape (verified 2026-04-01 — 34 fields per position):
    // {
    //   "success": true,
    //   "data": [
    //     {
    //       "position_id": 12345, "user_id": 67, "symbol": "SOL",
    //       "token_account_mint": "So11...2", "side": "long", "status": "open",
    //       "pubkey": "AbcXyz...", "entry_price": 145.32, "exit_price": null,
    //       "entry_size": 1525.86,  // USD notional (NOT token units)
    //       "increase_size": 0, "exit_size": 1525.86,  // USD notional
    //       "pnl": null, "entry_leverage": 2, "lowest_leverage": 1.5,
    //       "entry_date": "2024-11-01T12:00:00Z", "exit_date": null,
    //       "fees": 0.12, "borrow_fees": 0.01, "exit_fees": 0.11,
    //       "collateral_amount": 100.0, "entry_collateral_amount": 100.0,
    //       "closed_by_sl_tp": false, "volume": 3051.72, "duration": 0,
    //       "last_ix": "4rW8oJAY...",
    //       "pnl_volume_ratio": 0, "points_pnl_volume_ratio": 0,
    //       "points_duration": 0, "close_size_multiplier": 0,
    //       "points_mutations": 0, "total_points": 0,
    //       "created_at": "2024-11-01T12:00:00Z", "updated_at": null
    //     }
    //   ]
    // }
    // --------------------------------------------------------------------------
    async getPositions(wallet: string, limit?: number): Promise<AdrenaPosition[]> {
        // Check cache first
        const cached = this.positionCache.get(wallet);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return cached.data;
        }

        const params = new URLSearchParams({ user_wallet: wallet });
        if (limit !== undefined) {
            params.set('limit', String(limit));
        }

        const url = `${this.baseUrl}/position?${params.toString()}`;
        const response = await this.fetchWithRetry(url);

        if (!response.success) {
            throw new Error(`Adrena API error (GET /position): ${response.error ?? 'Unknown error'}`);
        }

        const positions: AdrenaPosition[] = Array.isArray(response.data)
            ? response.data
            : [];

        // Update cache
        this.positionCache.set(wallet, {
            data: positions,
            fetchedAt: Date.now(),
        });

        return positions;
    }

    // --------------------------------------------------------------------------
    // GET /liquidity-info — Fetch tradable custody list (Phase 4 item 29-engine)
    //
    // Returns symbol + mint for each custody in the Adrena pool. Consumed by
    // the admin tournament-creation modal to populate the asset dropdown,
    // and by the backend to validate symbol → mint resolution.
    //
    // No client-side cache (D17): the endpoint is already 60s server-side
    // cached per Adrena API reference §4.1, and admin dropdown load frequency
    // is low enough that stacking caches adds surface area without benefit.
    //
    // API response shape (verified 2026-04-23 via adrena-api-reference.md §4.1):
    // {
    //   "success": true,
    //   "data": {
    //     "totalPoolValueUsd": 12500000.00,
    //     "custodies": [
    //       {
    //         "symbol": "SOL",
    //         "mint": "So11111111111111111111111111111111111111112",
    //         "currentRatio": 0.42, "targetRatio": 0.40,
    //         "utilization": 0.61, "aumUsd": 5250000.00, "liquidityUsd": 3200000.00
    //       }
    //     ]
    //   }
    // }
    //
    // We project to the minimal {symbol, mint} shape — other fields are not
    // relevant to the admin dropdown or engine asset matching.
    // --------------------------------------------------------------------------
    async getCustodies(): Promise<Array<{ symbol: string; mint: string }>> {
        const url = `${this.baseUrl}/liquidity-info`;
        const response = await this.fetchWithRetry(url);

        if (!response.success) {
            throw new Error(
                `Adrena API error (GET /liquidity-info): ${response.error ?? 'Unknown error'}`,
            );
        }

        const data = response.data as
            | { custodies?: Array<{ symbol: string; mint: string }> }
            | undefined;
        const custodies = data?.custodies ?? [];

        return custodies.map((c) => ({ symbol: c.symbol, mint: c.mint }));
    }

    // --------------------------------------------------------------------------
    // GET /last-trading-prices — Phase 8.h: full tradable asset list
    //
    // Replaces the /liquidity-info-only path for "what assets does Adrena
    // trade" — post-Apr-29 relaunch /liquidity-info only returns 4 custodies
    // while /last-trading-prices returns all 9 tradable symbols across
    // autonom + switchboard arrays (chaoslabs empty/deprecated).
    //
    // Autonom's `source_feed_id` field equals the Pyth Lazer feed_id we use
    // for OHLC fetches — verified empirically 2026-05-03 against
    // ADRENA_TO_LAZER_FEED_ID for all 9 symbols (SOLUSD→3005, etc.).
    //
    // Switchboard's source_feed_id is a long hash (different ID type) — we
    // ignore it; only autonom's source_feed_id maps to Pyth Lazer numerics.
    //
    // Symbols are returned RAW (with "USD" suffix for crypto where applicable);
    // route layer normalizes ("SOLUSD" → "SOL"; bare RWAs unchanged).
    // --------------------------------------------------------------------------
    async getTradingPrices(): Promise<Array<{ symbol: string; source_feed_id?: string }>> {
        const url = `${this.baseUrl}/last-trading-prices`;
        const response = await this.fetchWithRetry(url);

        if (!response.success) {
            throw new Error(
                `Adrena API error (GET /last-trading-prices): ${response.error ?? 'Unknown error'}`,
            );
        }

        const data = response.data as
            | Record<string, { prices?: Array<{ symbol: string; source_feed_id?: string }> }>
            | undefined;

        // Union symbols across all oracle arrays. Prefer autonom's source_feed_id
        // (matches Pyth Lazer feed_ids); ignore other oracles' source_feed_id.
        const symbolMap = new Map<string, string | undefined>();
        for (const [oracleName, oracle] of Object.entries(data ?? {})) {
            if (!oracle.prices) continue;
            for (const p of oracle.prices) {
                if (!p.symbol) continue;
                if (oracleName === 'autonom') {
                    // Autonom is canonical: always set (overwrites any non-autonom value)
                    symbolMap.set(p.symbol, p.source_feed_id);
                } else if (!symbolMap.has(p.symbol)) {
                    // Non-autonom oracle: add symbol only if not already present
                    symbolMap.set(p.symbol, undefined);
                }
            }
        }

        return Array.from(symbolMap.entries()).map(([symbol, source_feed_id]) => ({
            symbol,
            source_feed_id,
        }));
    }

    // --------------------------------------------------------------------------
    // Helper: Filter positions to only those within a specific time window.
    //
    // For competition scoring, we only care about positions that were OPENED
    // during the round. Positions opened before the round start are excluded
    // even if they close during the round.
    //
    // This matches Adrena's existing Mutagen rule:
    // "Positions must open AND close within same week"
    //
    // For The Gauntlet: positions must be opened during the round window.
    // They can still be open at round end (scored at mark price) or closed.
    // --------------------------------------------------------------------------
    filterPositionsForRound(
        positions: AdrenaPosition[],
        roundStart: Date,
        roundEnd: Date,
    ): AdrenaPosition[] {
        return positions.filter((p) => {
            const entryDate = new Date(p.entry_date);
            // Position must have been opened during this round
            return entryDate >= roundStart && entryDate <= roundEnd;
        });
    }

    // --------------------------------------------------------------------------
    // Helper: Filter out positions that violate competition rules.
    //
    // Excludes:
    // - Positions with entry collateral < minCollateral (dust trades; uses
    //   entry_collateral_amount which is immutable, falls back to collateral_amount)
    // - Positions closed within minDurationSec of opening (wash trades)
    // --------------------------------------------------------------------------
    filterValidPositions(
        positions: AdrenaPosition[],
        minCollateral: number,
        minDurationSec: number,
    ): AdrenaPosition[] {
        return positions.filter((p) => {
            // Exclude dust trades
            if ((p.entry_collateral_amount ?? p.collateral_amount) < minCollateral) {
                return false;
            }

            // Exclude wash trades (closed too quickly)
            if (p.duration != null && p.duration > 0) {
                // Use precomputed duration from API (seconds)
                if (p.duration < minDurationSec) {
                    return false;
                }
            } else if (p.exit_date && p.entry_date) {
                // Fallback: compute from timestamps
                const durationMs = new Date(p.exit_date).getTime() - new Date(p.entry_date).getTime();
                if (durationMs / 1000 < minDurationSec) {
                    return false;
                }
            }

            return true;
        });
    }

    // --------------------------------------------------------------------------
    // Invalidate the cache for a specific wallet (used after force-refresh)
    // --------------------------------------------------------------------------
    invalidateCache(wallet: string): void {
        this.positionCache.delete(wallet);
    }

    invalidateAllCache(): void {
        this.positionCache.clear();
    }

    // --------------------------------------------------------------------------
    // Internal: fetch with retry (up to 3 attempts, exponential backoff)
    // --------------------------------------------------------------------------
    private async fetchWithRetry(
        url: string,
        maxRetries: number = 3,
    ): Promise<{ success: boolean; error?: string | null; data?: unknown }> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                    },
                });

                if (!response.ok) {
                    // 404 = wallet has no positions on Adrena (never traded)
                    // Treat as a valid empty response, don't retry
                    if (response.status === 404) {
                        return { success: true, data: [] };
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const json = await response.json() as Record<string, unknown>;

                // The API returns { success: true/false, error: null/string, data: ... }
                // But some responses might omit `error` on success.
                return {
                    success: json.success === true,
                    error: (json.error as string | null) ?? null,
                    data: json.data,
                };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`[AdrenaClient] Attempt ${attempt}/${maxRetries} failed for ${url}: ${lastError.message}`);

                if (attempt < maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError ?? new Error('All retry attempts failed');
    }
}
