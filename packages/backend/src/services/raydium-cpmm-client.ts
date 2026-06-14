// ============================================================================
// Raydium CP-Swap (CPMM) client
// ============================================================================
//
// Reads a wallet's LP position in a Raydium constant-product (CPMM) pool,
// normalized to the SAME shape the Activity 4 scorer already consumes from the
// Meteora client (MeteoraPositionSummary + PoolTokenInfo). The Meteora DLMM SDK
// cannot decode Raydium pools, so this decodes the CPMM PoolState directly.
//
// PoolState layout (verified on-chain: owner
// CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C, 637-byte account, decode
// cross-checked to the ADX/SOL + ADX/USDC pools). 8-byte anchor discriminator,
// then pubkeys/scalars at the offsets below. Token order is NOT fixed (one pool
// is SOL/ADX, the other ADX/USDC), so we read both mints and let the scorer
// value by mint.
//
// A CPMM LP token is a pro-rata claim on both vault reserves, so a wallet's
// position = (walletLp / lpSupply) x [reserve0, reserve1].
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection } from './solana-rpc.js';
import type { MeteoraPositionSummary, PoolTokenInfo } from './meteora-dlmm-client.js';

const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const POOL_STATE_SIZE = 637;

// Offsets into PoolState, after the 8-byte anchor discriminator.
const OFF = {
    vault0: 72, vault1: 104, lpMint: 136, mint0: 168, mint1: 200,
    mint0Dec: 331, mint1Dec: 332,
} as const;

// Static fields only (mints/decimals/vaults/lpMint never change for a pool), so
// they're safe to cache for the process lifetime. Reserves + LP supply are read
// fresh on every position lookup.
interface RaydiumPoolStatic {
    lpMint: PublicKey;
    vault0: PublicKey;
    vault1: PublicKey;
    mint0: string;
    mint0Decimals: number;
    mint1: string;
    mint1Decimals: number;
}

const staticCache = new Map<string, RaydiumPoolStatic>();
const pk = (d: Buffer, off: number) => new PublicKey(d.subarray(off, off + 32));

async function getStatic(pool: PublicKey): Promise<RaydiumPoolStatic> {
    const key = pool.toBase58();
    const hit = staticCache.get(key);
    if (hit) return hit;

    const info = await getSolanaConnection().getAccountInfo(pool);
    if (!info) throw new Error(`[raydium-cpmm] pool ${key} not found`);
    if (!info.owner.equals(RAYDIUM_CPMM_PROGRAM)) {
        throw new Error(`[raydium-cpmm] pool ${key} is not a CPMM pool (owner ${info.owner.toBase58()})`);
    }
    if (info.data.length !== POOL_STATE_SIZE) {
        throw new Error(`[raydium-cpmm] pool ${key} unexpected PoolState size ${info.data.length}`);
    }

    const d = info.data;
    const s: RaydiumPoolStatic = {
        lpMint: pk(d, OFF.lpMint),
        vault0: pk(d, OFF.vault0),
        vault1: pk(d, OFF.vault1),
        mint0: pk(d, OFF.mint0).toBase58(),
        mint0Decimals: d[OFF.mint0Dec],
        mint1: pk(d, OFF.mint1).toBase58(),
        mint1Decimals: d[OFF.mint1Dec],
    };
    staticCache.set(key, s);
    return s;
}

/**
 * Pool token-info in the same shape as the Meteora client: token0 -> X, token1 -> Y.
 */
export async function getPoolTokenInfo(pool: PublicKey): Promise<PoolTokenInfo> {
    const s = await getStatic(pool);
    return {
        poolAddress: pool.toBase58(),
        tokenXMint: s.mint0,
        tokenXDecimals: s.mint0Decimals,
        tokenYMint: s.mint1,
        tokenYDecimals: s.mint1Decimals,
    };
}

/**
 * A wallet's LP position in the pool, as [0 or 1] MeteoraPositionSummary.
 * Empty array when the wallet holds no LP or the pool has no LP supply.
 */
export async function getWalletPositionsForPool(
    wallet: PublicKey,
    pool: PublicKey,
): Promise<MeteoraPositionSummary[]> {
    const conn = getSolanaConnection();
    const s = await getStatic(pool);

    // Wallet's LP balance (sum across any LP token accounts it holds).
    const lpAccounts = await conn.getParsedTokenAccountsByOwner(wallet, { mint: s.lpMint });
    let walletLp = 0n;
    for (const a of lpAccounts.value) {
        const amt = (a.account.data.parsed as { info?: { tokenAmount?: { amount?: string } } })
            .info?.tokenAmount?.amount;
        if (amt) walletLp += BigInt(amt);
    }
    if (walletLp === 0n) return [];

    const supply = await conn.getTokenSupply(s.lpMint);
    const lpSupply = BigInt(supply.value.amount);
    if (lpSupply === 0n) return []; // empty pool, no LP-owned reserve

    const [b0, b1] = await Promise.all([
        conn.getTokenAccountBalance(s.vault0),
        conn.getTokenAccountBalance(s.vault1),
    ]);
    // Pro-rata share of the vault reserves. (Vault balances include a small
    // uncollected protocol-fee component, not LP-owned; negligible for the
    // bracketed size score, so not subtracted here.)
    const x = (walletLp * BigInt(b0.value.amount)) / lpSupply;
    const y = (walletLp * BigInt(b1.value.amount)) / lpSupply;

    return [{
        poolAddress: pool.toBase58(),
        totalXAmount: x.toString(),
        totalYAmount: y.toString(),
        lastUpdatedAt: 0, // CPMM positions have no per-position update slot
        upperBinId: 0,
        lowerBinId: 0,
    }];
}
