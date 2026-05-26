// ============================================================================
// AdrenaNativeLockSource — reads UserStaking accounts on-chain
// ============================================================================
//
// Reads Adrena's native UserStaking account for a given (wallet, mint) pair
// and emits one LockEntry per active locked stake.
//
// Byte layout source-of-truth: Adrena codama-generated IDL
// (`AdrenaFoundation/adrena-abi/idl/adrena.json`, types: UserStaking +
// LiquidStake + LockedStake). Field offsets pinned below in module-scope
// constants; if Adrena ever changes the layout, the boot-time PDA assertion
// in adrena-pda.ts won't catch it (only program ID + seed scheme are
// checked there), so consider adding a one-shot decode test for OUTIS's
// known ADX lock as part of future hardening if the layout ever flexes.
//
// Empirically verified during inventory: OUTIS's ADX UserStaking has one
// 180-day 300K ADX lock; ZeDef's ALP UserStaking has only a liquid stake
// (no active locked stakes despite the `locked_stake_id_counter` being > 0
// — past locks have been withdrawn). RWALP staking pool doesn't exist
// today; if Adrena ever creates one, add the mint→pool mapping to
// `stakingPoolForMint()` below and the rest of the path (UserStaking PDA
// derivation, LockedStake array decode) is generic.
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection } from '../solana-rpc.js';
import {
    deriveUserStaking,
    deriveLmStakingPool,
    deriveLpStakingPool,
} from '../adrena-pda.js';
import {
    ADX_MINT,
    ALP_MINT,
    ADRENA_USER_STAKING_SIZE,
    ADRENA_USER_STAKING_DISCRIMINATOR,
} from '../solana-constants.js';
import {
    ADX_TIERS_DAYS,
    ALP_TIERS_DAYS,
    bucketToNearestTier,
} from '../mutagen-scorer-types.js';
import type { LockSource, LockEntry } from './types.js';

// ---------- UserStaking outer layout (from codama IDL) ----------
//
// 0..8     discriminator
// 8        bump (u8)
// 9        _unused_unsafe (u8)
// 10       staking_type (u8) — 1=LM/ADX, 2=LP/ALP
// 11..16   _padding (5 bytes)
// 16..24   locked_stake_id_counter (u64)
// 24..64   liquid_stake (LiquidStake, 40 bytes)
// 64..3904 locked_stakes (LockedStake[32], 32 × 120 = 3840 bytes)
//
const LOCKED_STAKES_ARRAY_OFFSET = 64;
const LOCKED_STAKE_SIZE = 120;
const LOCKED_STAKE_COUNT = 32;

// ---------- LockedStake inner layout (120 bytes per entry) ----------
//
// 0..8     amount (u64)
// 8..16    stake_time (i64)
// 16..24   claim_time (i64)
// 24..32   end_time (i64)
// 32..40   lock_duration (u64) — SECONDS
// 40..44   reward_multiplier (u32)
// 44..48   lm_reward_multiplier (u32)
// 48..52   vote_multiplier (u32)
// 52..56   qualified_for_rewards_in_resolved_round_count (u32)
// 56..64   amount_with_reward_multiplier (u64)
// 64..72   amount_with_lm_reward_multiplier (u64)
// 72       resolved (u8)
// 73..80   _padding2 (7 bytes)
// 80..88   id (u64)
// 88       early_exit (u8)
// 89..96   _padding3 (7 bytes)
// 96..104  early_exit_fee (u64)
// 104      is_genesis (u8)
// 105..112 _padding4 (7 bytes)
// 112..120 genesis_claim_time (i64)
//
// Relative offsets we read:
const LS_AMOUNT_OFFSET = 0;
const LS_STAKE_TIME_OFFSET = 8;
const LS_END_TIME_OFFSET = 24;
const LS_LOCK_DURATION_OFFSET = 32;

// UI-tier sets (ADX_TIERS_DAYS, ALP_TIERS_DAYS) and bucketToNearestTier
// helper live in mutagen-scorer-types.ts so Activity 2 staking scorer
// can share them. Per-mint dispatch:
function tiersForMint(mint: PublicKey): readonly number[] {
    return mint.equals(ADX_MINT) ? ADX_TIERS_DAYS : ALP_TIERS_DAYS;
}

interface LockedStakeRaw {
    amount: bigint;
    stakeTime: bigint;
    endTime: bigint;
    lockDuration: bigint;
}

function parseLockedStake(data: Buffer, slotIndex: number): LockedStakeRaw | null {
    const base = LOCKED_STAKES_ARRAY_OFFSET + slotIndex * LOCKED_STAKE_SIZE;
    if (base + LOCKED_STAKE_SIZE > data.length) return null;

    const amount = data.readBigUInt64LE(base + LS_AMOUNT_OFFSET);
    // Slots with no active stake have amount = 0 (whether never used or already withdrawn).
    if (amount === 0n) return null;

    return {
        amount,
        stakeTime: data.readBigInt64LE(base + LS_STAKE_TIME_OFFSET),
        endTime: data.readBigInt64LE(base + LS_END_TIME_OFFSET),
        lockDuration: data.readBigUInt64LE(base + LS_LOCK_DURATION_OFFSET),
    };
}

/**
 * Picks the right staking pool PDA for a given mint, or null if Adrena's
 * native staking doesn't have a pool for that mint today.
 *
 * Today's pools: ADX (LM) and ALP (LP). RWALP is a future candidate —
 * the mint exists but no staking pool has been created. Anything else
 * (USDC, WSOL, etc.) is conceptually not stakeable here.
 *
 * Returning null (rather than throwing) makes the LockSource contract
 * predictable: "no locks via THIS source for THAT mint" = empty array.
 * Callers that want to know "do you handle this mint" can check
 * stakingPoolForMint(mint) !== null.
 */
function stakingPoolForMint(mint: PublicKey): PublicKey | null {
    if (mint.equals(ADX_MINT)) return deriveLmStakingPool();
    if (mint.equals(ALP_MINT)) return deriveLpStakingPool();
    return null;
}

export class AdrenaNativeLockSource implements LockSource {
    readonly name = 'adrena-native';

    async getActiveLocks(wallet: PublicKey, mint: PublicKey): Promise<LockEntry[]> {
        const stakingPool = stakingPoolForMint(mint);
        if (!stakingPool) return []; // No native staking pool for this mint

        const connection = getSolanaConnection();
        const userStaking = deriveUserStaking(wallet, stakingPool);

        const account = await connection.getAccountInfo(userStaking);
        if (!account) return []; // wallet has never interacted with this pool

        // Sanity: size and discriminator must match. If either is off, treat
        // as no-locks — we'd rather miss data than misread garbage.
        if (account.data.length !== ADRENA_USER_STAKING_SIZE) return [];
        const discriminator = account.data.subarray(0, 8);
        if (!discriminator.equals(Buffer.from(ADRENA_USER_STAKING_DISCRIMINATOR))) return [];

        const now = Math.floor(Date.now() / 1000);
        const locks: LockEntry[] = [];

        for (let i = 0; i < LOCKED_STAKE_COUNT; i++) {
            const raw = parseLockedStake(account.data, i);
            if (!raw) continue;

            const endsAtSec = Number(raw.endTime);
            // Expired locks: amount still in the slot but the lock period is over.
            // Don't count toward Mutagen scoring — user can/should withdraw.
            if (endsAtSec <= now) continue;

            const lockDurationDays = Math.round(Number(raw.lockDuration) / 86400);

            locks.push({
                sourceMint: mint,
                durationDays: bucketToNearestTier(lockDurationDays, tiersForMint(mint)),
                amountRaw: raw.amount,
                startedAt: Number(raw.stakeTime),
                endsAt: endsAtSec,
                sourceProgram: 'adrena-native',
            });
        }

        return locks;
    }
}
