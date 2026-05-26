// ============================================================================
// AdrenaNativeLockSource — reads UserStaking accounts on-chain
// ============================================================================
//
// Reads Adrena's native UserStaking account for a given (wallet, mint) pair
// and exposes both the liquid amount and per-slot locked stakes. The
// LockSource interface only returns locked stakes (for Activity 1); the
// full liquid+locked decode is exposed via `getUserStakingState` for
// Activity 2 staking-scorer consumption.
//
// Byte layout source-of-truth: Adrena codama-generated IDL
// (`AdrenaFoundation/adrena-abi/idl/adrena.json`, types: UserStaking +
// LiquidStake + LockedStake). Field offsets pinned below in module-scope
// constants.
//
// Active-stake filter: amount > 0 AND endTime > now AND resolved === 0.
// The `resolved` flag is the protocol's own indicator that a stake's
// rewards have been distributed (i.e., it's settled / done). A slot can
// have amount > 0 + endTime in the past + resolved = 1 — that's a stake
// whose lock period ended and rewards were claimed but the user hasn't
// withdrawn the principal yet. We DON'T count those (they're not active
// in any meaningful sense for ongoing Mutagen scoring).
//
// Authority for using on-chain reads as the source of truth (over the
// Adrena datapi /stake endpoint): verified empirically against the
// Adrena program's own transaction logs. Specifically, ZeDef's
// UserStaking PDA has an upgradeLockedStake TX from 2026-05-08 that
// logged `new total amount: 4727799524423 ... current locked days: 540`,
// matching our on-chain decode exactly. Datapi /stake does NOT return
// that 4.7M position — it appears to miss upgradeLockedStake events.
// We trust the chain. See investigate_zedef_userstaking_tx_history.ts
// in scripts/ for the verification harness.
//
// Empirical baselines:
//   - OUTIS's ADX UserStaking: 1 active locked stake (300K ADX, 180d)
//   - ZeDef's ADX UserStaking: 7 active locked stakes (~4.77M ADX total,
//     largest 4.72M in slot 2 via 540d upgradeLockedStake) + 1.54M liquid
//   - ZeDef's ALP UserStaking: 0 active locked stakes; past locks
//     finalized + withdrawn (locked_stake_id_counter > 0)
//
// RWALP staking pool doesn't exist today; if Adrena ever creates one,
// add the mint→pool mapping to `stakingPoolForMint()` below and the rest
// of the path (UserStaking PDA derivation, LockedStake array decode) is
// generic.
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
const LS_RESOLVED_OFFSET = 72; // u8: 0 = active/pending, 1 = rewards distributed (settled)

// ---------- LiquidStake layout (40 bytes at offset 24 in UserStaking) ----------
//
// 0..8     amount (u64)
// 8..16    stake_time (i64)
// 16..24   claim_time (i64)
// 24..32   overlap_time (i64)
// 32..40   overlap_amount (u64)
//
const LIQUID_STAKE_OFFSET = 24;
const LIQUID_AMOUNT_OFFSET = LIQUID_STAKE_OFFSET + 0;

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
    resolved: number;
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
        resolved: data[base + LS_RESOLVED_OFFSET],
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

/**
 * Combined liquid + locked stake snapshot from a single UserStaking
 * account decode. Activity 1 only needs `locks`; Activity 2 needs both.
 * Decode is shared so neither path pays for two RPC reads.
 */
export interface UserStakingState {
    /** Liquid (tier-0) stake amount in raw token units. 0 if no liquid stake. */
    liquidAmountRaw: bigint;
    /** Active locked stakes (filtered: amount>0, endTime>now, resolved===0). */
    locks: LockEntry[];
}

export class AdrenaNativeLockSource implements LockSource {
    readonly name = 'adrena-native';

    /**
     * One-shot decode of a wallet's UserStaking account for a given mint.
     * Single getAccountInfo RPC call; returns both liquid + locked state.
     */
    async getUserStakingState(wallet: PublicKey, mint: PublicKey): Promise<UserStakingState> {
        const empty: UserStakingState = { liquidAmountRaw: 0n, locks: [] };

        const stakingPool = stakingPoolForMint(mint);
        if (!stakingPool) return empty; // No native staking pool for this mint

        const connection = getSolanaConnection();
        const userStaking = deriveUserStaking(wallet, stakingPool);

        const account = await connection.getAccountInfo(userStaking);
        if (!account) return empty; // wallet has never interacted with this pool

        // Sanity: size and discriminator must match. If either is off, treat
        // as empty — we'd rather miss data than misread garbage.
        if (account.data.length !== ADRENA_USER_STAKING_SIZE) return empty;
        const discriminator = account.data.subarray(0, 8);
        if (!discriminator.equals(Buffer.from(ADRENA_USER_STAKING_DISCRIMINATOR))) return empty;

        const liquidAmountRaw = account.data.readBigUInt64LE(LIQUID_AMOUNT_OFFSET);

        const now = Math.floor(Date.now() / 1000);
        const locks: LockEntry[] = [];

        for (let i = 0; i < LOCKED_STAKE_COUNT; i++) {
            const raw = parseLockedStake(account.data, i);
            if (!raw) continue;

            const endsAtSec = Number(raw.endTime);
            // Active = end_time in future AND not yet finalized (resolved=0).
            // A resolved=1 stake has had its rewards distributed; it's "done"
            // even if amount > 0 (principal not yet withdrawn).
            if (endsAtSec <= now) continue;
            if (raw.resolved !== 0) continue;

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

        return { liquidAmountRaw, locks };
    }

    /**
     * LockSource interface — locked stakes only (no liquid).
     * Activity 1 LP scorer consumes this.
     */
    async getActiveLocks(wallet: PublicKey, mint: PublicKey): Promise<LockEntry[]> {
        const state = await this.getUserStakingState(wallet, mint);
        return state.locks;
    }
}
