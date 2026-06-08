// ============================================================================
// Meteora DLMM client — thin wrapper over @meteora-ag/dlmm
// ============================================================================
//
// Powers Activity 4 (ADX-LP) scoring. Reads per-wallet positions across
// Adrena's incentivized Meteora ADX pools, plus pool-level metrics via
// Meteora's public datapi for context (TVL, 24h volume/fees, etc.).
//
// All RPC calls go through our singleton Connection (env.HELIUS_RPC_URL).
// Datapi calls are public, no auth required, ~30 RPS rate limit per
// Meteora docs.
//
// Pool scope:
//   - METEORA_POOL_ADX_SOL  (bin step 100, 0.30% fees) — incentivized
//   - METEORA_POOL_ADX_USDC (bin step  50, 0.25% fees) — incentivized
// The 4 dormant POL pools (Raydium ADX-SOL/USDC + Meteora ALP-SOL/USDC)
// are admin-toggleable per epoch but default off — the helper here doesn't
// hardcode them. Scorers iterate `epoch.config.activity4.pools` to know
// what's enabled.
// ============================================================================

import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection } from './solana-rpc.js';
import {
    METEORA_POOL_ADX_SOL,
    METEORA_POOL_ADX_USDC,
} from './solana-constants.js';

// @meteora-ag/dlmm's ESM bundle does `import { BN } from "@coral-xyz/anchor"`,
// which fails under Node ESM: cjs-module-lexer can't detect BN's named export
// from anchor's CJS index (it's wrapped in __importDefault). Forcing CJS
// resolution via createRequire bypasses the static-import-from-CJS limitation
// because CJS named-property access doesn't go through the lexer at all.
//
// The cost: lose tree-shaking on the SDK (~600KB bundle pulled in). Acceptable
// for a backend that only uses a handful of methods. If we need granular
// imports later, switch to raw RPC + manual position decode.
const require = createRequire(import.meta.url);
// The SDK's CJS bundle flattens its exports — there is no `default` export
// or `DLMM` class on the module root; the factory is just `mod.create()`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dlmmMod = require('@meteora-ag/dlmm') as DlmmModule;

// Minimal DLMM types declared inline since createRequire loses the type info
// from the SDK's .d.ts. Only includes the surface area we actually use here.
interface DlmmBigNumLike {
    toString(): string;
    toNumber(): number;
}
interface DlmmPositionRaw {
    positionData: {
        totalXAmount: DlmmBigNumLike;
        totalYAmount: DlmmBigNumLike;
        lastUpdatedAt: DlmmBigNumLike;
        upperBinId: number;
        lowerBinId: number;
    };
}
interface DlmmTokenLike {
    publicKey: PublicKey;
    decimal: number;
    mint?: { decimals?: number };
}
interface DlmmInstance {
    getPositionsByUserAndLbPair(wallet: PublicKey): Promise<{ userPositions: DlmmPositionRaw[] }>;
    tokenX: DlmmTokenLike;
    tokenY: DlmmTokenLike;
}
interface DlmmModule {
    create(
        connection: ReturnType<typeof getSolanaConnection>,
        poolAddress: PublicKey,
    ): Promise<DlmmInstance>;
}

/**
 * Per-wallet position summary, normalized to plain-data values (no BN.js
 * objects leaked across module boundaries). Token amounts are returned as
 * strings to preserve precision; consumers convert to bigint or scaled
 * floats with the appropriate decimal divisor.
 */
export interface MeteoraPositionSummary {
    poolAddress: string;
    /** Raw token amount, base units, X side (first token of pair). */
    totalXAmount: string;
    /** Raw token amount, base units, Y side (second token of pair). */
    totalYAmount: string;
    /** Unix seconds of last on-chain update (rebalance, deposit, withdraw, claim). */
    lastUpdatedAt: number;
    upperBinId: number;
    lowerBinId: number;
}

/**
 * Reads all positions held by `wallet` in a single DLMM pool.
 * Returns [] if wallet has no positions in this pool.
 */
export async function getWalletPositionsForPool(
    wallet: PublicKey,
    poolAddress: PublicKey,
): Promise<MeteoraPositionSummary[]> {
    const connection = getSolanaConnection();
    const dlmm = await dlmmMod.create(connection, poolAddress);
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(wallet);

    return userPositions.map((p) => ({
        poolAddress: poolAddress.toBase58(),
        totalXAmount: p.positionData.totalXAmount.toString(),
        totalYAmount: p.positionData.totalYAmount.toString(),
        lastUpdatedAt: p.positionData.lastUpdatedAt.toNumber(),
        upperBinId: p.positionData.upperBinId,
        lowerBinId: p.positionData.lowerBinId,
    }));
}

/**
 * Pool-level token metadata, derived from the DLMM SDK instance. Used by
 * the Activity 4 scorer to convert raw token amounts to USD via the right
 * decimals + mint→price lookup.
 *
 * DLMM convention: tokenX has the lex-smaller mint address than tokenY.
 * We never assume the order — we read it from the SDK at runtime.
 */
export interface PoolTokenInfo {
    poolAddress: string;
    tokenXMint: string;
    tokenXDecimals: number;
    tokenYMint: string;
    tokenYDecimals: number;
}

export async function getPoolTokenInfo(poolAddress: PublicKey): Promise<PoolTokenInfo> {
    const connection = getSolanaConnection();
    const dlmm = await dlmmMod.create(connection, poolAddress);
    return {
        poolAddress: poolAddress.toBase58(),
        tokenXMint: dlmm.tokenX.publicKey.toBase58(),
        tokenXDecimals: dlmm.tokenX.decimal ?? dlmm.tokenX.mint?.decimals ?? 0,
        tokenYMint: dlmm.tokenY.publicKey.toBase58(),
        tokenYDecimals: dlmm.tokenY.decimal ?? dlmm.tokenY.mint?.decimals ?? 0,
    };
}

/**
 * Returns positions for a wallet across the 2 default-enabled
 * Adrena-Meteora ADX pools. Convenience for the common case where
 * Activity 4 only scores the spec-named pools (admin hasn't enabled the
 * dormant POL pools).
 *
 * For the admin-toggleable case (4 extra POL pools), the scorer iterates
 * `epoch.config.activity4.pools` and calls `getWalletPositionsForPool`
 * for each enabled address directly.
 */
export async function getWalletPositionsAcrossAdrenaAdxPools(
    wallet: PublicKey,
): Promise<MeteoraPositionSummary[]> {
    const pools = [METEORA_POOL_ADX_SOL, METEORA_POOL_ADX_USDC];
    const results = await Promise.all(
        pools.map((p) => getWalletPositionsForPool(wallet, p)),
    );
    return results.flat();
}

// ---------- Pool-level metrics (Meteora datapi, public) ----------

/**
 * Subset of Meteora's `/pools/{address}` response — only the fields we
 * actually consume. Full schema is in Meteora's public docs.
 */
export interface PoolDataPiInfo {
    address: string;
    tvl: number;
    current_price: number;
    apr: number;
    has_farm: boolean;
    farm_apr: number;
    volume: { '24h': number };
    fees: { '24h': number };
    cumulative_metrics: { volume: number; trade_fee: number };
}

/**
 * Pool-level data via Meteora's public datapi (no auth).
 * Used for: TVL display, USD-context for position values, activity
 * health metrics shown on the admin panel.
 */
export async function fetchPoolDataPiInfo(
    poolAddress: PublicKey,
): Promise<PoolDataPiInfo> {
    const url = `https://dlmm.datapi.meteora.ag/pools/${poolAddress.toBase58()}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(
            `[meteora datapi /pools/${poolAddress.toBase58()}] HTTP ${res.status}: ${await res.text()}`,
        );
    }
    return (await res.json()) as PoolDataPiInfo;
}
