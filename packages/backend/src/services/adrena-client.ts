// ============================================================================
// Adrena API Client
//
// Wraps the Adrena public API at datapi.adrena.trade. Endpoints:
//   Forge:        getPositions, filterPositionsForRound, filterValidPositions
//   Mutagen R2:   getV4Positions, getStakes, getReferrerStatus,
//                 getReferrerRewards, getLastPrices, getLiquidityInfo,
//                 getTraderVolume, getAdrenaMutagenLeaderboard
//
// Static asset metadata (mints, feed_ids, sessioned flags) lives in
// services/adrena-canonical.ts (synced from github.com/AdrenaFoundation/adrena-abi).
// admin/tradable-assets reads the static-mirror; no runtime HTTP needed for that data.
//
// Reference: resources/adrena-api-reference.md +
//            .agent/brain/mutagen_rework_r2_inventory.md §4a (datapi swagger)
// ============================================================================

import type { AdrenaPosition } from '../types.js';

const DEFAULT_BASE_URL = 'https://datapi.adrena.trade';

// ============================================================================
// Mutagen R2 — endpoint response types (inline; client-specific shapes)
// ============================================================================

export interface AdrenaStake {
    stake_id: number;
    user_pubkey: string;
    mint: string;
    symbol: 'ADX' | 'ALP';
    initial_amount: number;
    current_amount: number;
    locked_days: number;
    is_liquid: boolean;
    is_early_exit: boolean;
    status: 'open' | 'closed';
    entry_date: string;
    end_date: string | null;
}

export interface ReferrerStatus {
    is_referrer: boolean;
    is_active: boolean | null;
}

export interface ReferrerRewardItem {
    referrer_reward_id: number;
    position_id: number;
    usdc_amount: number;
    created_at: string;
}

export interface ReferrerRewards {
    is_approved: boolean;
    pending_usdc: number;
    paid_usdc: number;
    total_usdc: number;
    total_referees: number;
    rewards: ReferrerRewardItem[];
}

export interface PriceQuote {
    price: string;
    price_timestamp: string;
}

export interface LastPrices {
    adx: PriceQuote;
    alp: PriceQuote;
    rwalp: PriceQuote;
}

export interface PoolLiquidityCustody {
    pubkey: string;
    symbol: string;
    name: string;
    mint: string;
    isSynthetic: boolean;
    isStable: boolean;
    aumUsd: string;
    aumTokenAmount: string;
}

export interface PoolLiquidityInfo {
    poolName: string;
    poolPubkey: string;
    poolType: string;
    lpSymbol: 'ALP' | 'RWALP';
    aumUsd: string;
    aumUsdFormatted: string;
    aumLimitUsd: string;
    aumLimitUsdFormatted: string;
    alpPriceUsd: string;
    alpTotalSupply: string;
    alpAprPct: string;
    alpRealizedFeeUsd: string;
    custodies: PoolLiquidityCustody[];
}

export interface TraderVolume {
    user_pubkey: string;
    total_volume: number;
    total_pnl: number;
}

export interface AdrenaMutagenRow {
    rank: number;
    user_wallet: string;
    points_trading: number;
    points_mutations: number;
    points_streaks: number;
    points_quests: number;
    total_points: number;
    total_volume: number;
    total_pnl: number;
    total_borrow_fees: number;
    total_close_fees: number;
    total_fees: number;
}

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
    // GET /position: Fetch trade history for a wallet
    //
    // Returns ALL positions (open + closed + liquidated) for the given wallet.
    // The `limit` param caps the number of results returned.
    //
    // API response shape (34 fields per position):
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

    // ==========================================================================
    // MUTAGEN R2 — 8 new endpoint wrappers
    //
    // - getV4Positions(wallet, limit?)         GET /v4/position?user_wallet=X
    // - getStakes(wallet)                       GET /stake?user_wallet=X
    // - getReferrerStatus(account)              GET /referrer/status?account=X
    // - getReferrerRewards(account)             GET /referrer-rewards?account=X
    // - getLastPrices()                         GET /last-price
    // - getLiquidityInfo()                      GET /liquidity-info
    // - getTraderVolume(wallet?)                GET /trader-volume[?user_wallet=X]
    // - getAdrenaMutagenLeaderboard(limit?)     GET /mutagen-leaderboard
    //
    // Param convention quirks (verified live in inventory phase):
    //   - referrer/*  + fee-rebates/*: `account=X`  (NOT `wallet` / `user_wallet`)
    //   - stake / position / v4/position / trader-volume: `user_wallet=X`
    // ==========================================================================

    // GET /v4/position — like legacy /position but response is nested:
    //   v4:     { success, data: { positions: [...] } }
    //   legacy: { success, data: [...] }
    // Returned positions have all the mutagen fields (points_*, total_points)
    // plus v4-only extras (pool_id, decrease_size, close_size) we ignore here.
    async getV4Positions(wallet: string, limit?: number): Promise<AdrenaPosition[]> {
        const params = new URLSearchParams({ user_wallet: wallet });
        if (limit !== undefined) params.set('limit', String(limit));
        const url = `${this.baseUrl}/v4/position?${params.toString()}`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /v4/position): ${response.error ?? 'Unknown'}`);
        }
        // 404-empty path → response.data = [] (per fetchWithRetry); v4 normal path → { positions: [...] }
        if (Array.isArray(response.data)) return [];
        const data = response.data as { positions?: AdrenaPosition[] };
        return data?.positions ?? [];
    }

    // GET /stake?user_wallet=X — per-user stake list (404 → [] per fetchWithRetry)
    async getStakes(wallet: string): Promise<AdrenaStake[]> {
        const url = `${this.baseUrl}/stake?user_wallet=${encodeURIComponent(wallet)}`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            // /stake returns {error: "Not found"} for wallets with no stakes; fetchWithRetry treats
            // 404 as empty success, so we'd land here only for genuine API issues.
            throw new Error(`Adrena API error (GET /stake): ${response.error ?? 'Unknown'}`);
        }
        // Response shape: { success, data: { stakes: [...], start_date, end_date, limit } }
        const data = response.data as { stakes?: AdrenaStake[] } | unknown[];
        if (Array.isArray(data)) return data as AdrenaStake[];  // 404-empty path
        return data?.stakes ?? [];
    }

    // GET /referrer/status?account=X — is the wallet an approved referrer?
    async getReferrerStatus(account: string): Promise<ReferrerStatus> {
        const url = `${this.baseUrl}/referrer/status?account=${encodeURIComponent(account)}`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /referrer/status): ${response.error ?? 'Unknown'}`);
        }
        // 404-empty path returns data=[]; coerce to default false/null
        if (Array.isArray(response.data)) return { is_referrer: false, is_active: null };
        return response.data as ReferrerStatus;
    }

    // GET /referrer-rewards?account=X — referrer rewards summary + per-position history
    async getReferrerRewards(account: string): Promise<ReferrerRewards> {
        const url = `${this.baseUrl}/referrer-rewards?account=${encodeURIComponent(account)}`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /referrer-rewards): ${response.error ?? 'Unknown'}`);
        }
        if (Array.isArray(response.data)) {
            return {
                is_approved: false, pending_usdc: 0, paid_usdc: 0, total_usdc: 0,
                total_referees: 0, rewards: [],
            };
        }
        return response.data as ReferrerRewards;
    }

    // GET /last-price — current ADX / ALP / RWALP prices
    async getLastPrices(): Promise<LastPrices> {
        const url = `${this.baseUrl}/last-price`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /last-price): ${response.error ?? 'Unknown'}`);
        }
        return response.data as LastPrices;
    }

    // GET /liquidity-info — per-pool AUM, ALP price, AUM cap, custody breakdown
    async getLiquidityInfo(): Promise<PoolLiquidityInfo[]> {
        const url = `${this.baseUrl}/liquidity-info`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /liquidity-info): ${response.error ?? 'Unknown'}`);
        }
        const data = response.data as { pools?: PoolLiquidityInfo[] };
        return data?.pools ?? [];
    }

    // GET /trader-volume[?user_wallet=X] — per-wallet DAILY trader volume aggregate.
    //
    // ⚠ NOT used by Mutagen R2 scoring path. Activity 3 aggregates per-epoch volume
    // from /v4/position instead (multi-day window). This method is here for ad-hoc
    // analytics + future use. When called with `user_wallet`, returns empty array
    // if the wallet hasn't traded today (by design — endpoint is daily-only).
    async getTraderVolume(wallet?: string): Promise<TraderVolume[]> {
        const url = wallet
            ? `${this.baseUrl}/trader-volume?user_wallet=${encodeURIComponent(wallet)}`
            : `${this.baseUrl}/trader-volume`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /trader-volume): ${response.error ?? 'Unknown'}`);
        }
        if (Array.isArray(response.data)) return [];
        const data = response.data as { traders?: TraderVolume[] };
        return data?.traders ?? [];
    }

    // GET /mutagen-leaderboard?limit=N — Adrena's current Mutagen leaderboard.
    // Used by the one-time bootstrap script to seed our R2 leaderboard with the
    // wallets already on Adrena's current system (implementation_plan §8.4).
    //
    // ⚠ API quirk: the server-side `limit` param is IGNORED. The endpoint always
    // returns the full leaderboard (~2782 rows as of 2026-05-26). We pass `limit`
    // anyway for forward-compat in case they fix it server-side, but we ALSO
    // slice client-side to honor the method's contract.
    async getAdrenaMutagenLeaderboard(limit: number = 1000): Promise<AdrenaMutagenRow[]> {
        const url = `${this.baseUrl}/mutagen-leaderboard?limit=${limit}`;
        const response = await this.fetchWithRetry(url);
        if (!response.success) {
            throw new Error(`Adrena API error (GET /mutagen-leaderboard): ${response.error ?? 'Unknown'}`);
        }
        const rows = Array.isArray(response.data) ? (response.data as AdrenaMutagenRow[]) : [];
        return rows.slice(0, limit);  // enforce limit client-side (API ignores it)
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
