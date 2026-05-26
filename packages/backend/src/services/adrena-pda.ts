// ============================================================================
// Adrena program PDA derivations
// ============================================================================
//
// Pure web3.js derivations of Adrena program PDAs (mints, staking pools,
// per-user staking accounts). Mirrors the seed scheme used by Adrena's on-
// chain program — verified empirically during the inventory phase against
// canonical pubkeys at the chain (see `.agent/brain/mutagen_rework_r2_
// inventory.md` §3.1).
//
// No codama / Anchor SDK dependency at runtime. Keeps the bundle small and
// avoids a hard pin to Adrena's TS SDK version.
//
// `assertCanonicalPdas()` runs at boot and throws loudly if the derivations
// no longer reproduce the canonical mint pubkeys (signals either a program-
// ID change or a seed-scheme change upstream — either of which breaks every
// Mutagen R2 scorer that reads chain state).
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import {
    ADRENA_PROGRAM_ID,
    ADRENA_MAIN_POOL,
    ADX_MINT,
    ALP_MINT,
} from './solana-constants.js';

// Seeds used by Adrena's on-chain program. Buffers, not strings, because
// findProgramAddressSync expects raw byte slices.
const SEED = {
    STAKING: Buffer.from('staking'),
    USER_STAKING: Buffer.from('user_staking'),
    LP_TOKEN_MINT: Buffer.from('lp_token_mint'),
    LM_TOKEN_MINT: Buffer.from('lm_token_mint'),
} as const;

// ---------- Token mints (program-derived) ----------

/**
 * LM (governance) token mint, a.k.a. ADX.
 * Seeds: ["lm_token_mint"]
 */
export function deriveLmTokenMint(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SEED.LM_TOKEN_MINT],
        ADRENA_PROGRAM_ID,
    );
    return pda;
}

/**
 * LP token mint for a given pool. Defaults to the main pool (= ALP mint).
 * For the commodities pool, pass ADRENA_COMMODITIES_POOL to get RWALP.
 * Seeds: ["lp_token_mint", pool_pubkey]
 */
export function deriveLpTokenMint(pool: PublicKey = ADRENA_MAIN_POOL): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SEED.LP_TOKEN_MINT, pool.toBuffer()],
        ADRENA_PROGRAM_ID,
    );
    return pda;
}

// ---------- Staking pools (program-derived per staked-token mint) ----------

/**
 * Staking pool PDA for a given staked-token mint.
 * Seeds: ["staking", staked_token_mint]
 *
 * Note: the canonical addresses are not asserted at boot because they are
 * deterministically derived from {program_id, mint, seed} — if the mint
 * assertions pass, these will too. The staking pool addresses ARE pinned
 * empirically in inventory §3.1 for cross-reference:
 *   - LM (ADX) staking pool: 5Feq2MKbimA44dqgFHLWr7h77xAqY9cet5zn9eMCj78p
 *   - LP (ALP) staking pool: 7UWcLAzcCRuJF5U2iyZs2ybwDWZWWMVp1y6KgnRJP2C
 */
export function deriveStakingPool(stakedTokenMint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SEED.STAKING, stakedTokenMint.toBuffer()],
        ADRENA_PROGRAM_ID,
    );
    return pda;
}

/** LM staking pool (ADX side). */
export function deriveLmStakingPool(): PublicKey {
    return deriveStakingPool(ADX_MINT);
}

/** LP staking pool (ALP side). */
export function deriveLpStakingPool(): PublicKey {
    return deriveStakingPool(ALP_MINT);
}

// ---------- Per-user staking accounts ----------

/**
 * Per-user staking account PDA.
 * Seeds: ["user_staking", owner_pubkey, staking_pool_pubkey]
 *
 * The pair (owner, staking_pool) keys this account; (owner, ADX_staking) and
 * (owner, ALP_staking) are two distinct accounts. UserStaking accounts do
 * NOT store owner or pool fields — they are identified purely by PDA, so
 * memcmp enumeration "all stakers of pool X" is not possible. Must derive
 * per known owner.
 */
export function deriveUserStaking(owner: PublicKey, stakingPool: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SEED.USER_STAKING, owner.toBuffer(), stakingPool.toBuffer()],
        ADRENA_PROGRAM_ID,
    );
    return pda;
}

// ---------- Boot-time canonical sanity ----------

/**
 * Verify that PDA derivations still reproduce the canonical mint pubkeys
 * pinned in solana-constants.ts. Run once at server boot, before any module
 * that consumes these helpers does live RPC reads.
 *
 * Failure modes this catches:
 *   - Adrena redeploys the program at a new program ID (ADRENA_PROGRAM_ID
 *     would need updating in solana-constants.ts)
 *   - Adrena changes the seed scheme upstream (extremely unlikely but
 *     theoretically possible across a major version bump)
 *
 * Either case = silent data corruption across every R2 scorer if undetected.
 * We trade ~2ms of boot cost for an immediate, loud failure mode.
 */
export function assertCanonicalPdas(): void {
    const derivedLm = deriveLmTokenMint();
    if (!derivedLm.equals(ADX_MINT)) {
        throw new Error(
            `[adrena-pda] LM token mint PDA derivation mismatch. ` +
            `Derived: ${derivedLm.toString()}, canonical ADX: ${ADX_MINT.toString()}. ` +
            `Has Adrena's program ID or seed scheme changed?`,
        );
    }
    const derivedLp = deriveLpTokenMint();
    if (!derivedLp.equals(ALP_MINT)) {
        throw new Error(
            `[adrena-pda] LP token mint PDA derivation mismatch. ` +
            `Derived: ${derivedLp.toString()}, canonical ALP: ${ALP_MINT.toString()}. ` +
            `Has Adrena's program ID, main-pool, or seed scheme changed?`,
        );
    }
}
