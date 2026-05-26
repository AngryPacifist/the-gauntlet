// ============================================================================
// LockSource interface — pluggable lock-source abstraction
// ============================================================================
//
// The Mutagen R2 LP-scorer (Activity 1) needs to read locked-stake entries
// for ALP and RWALP regardless of which on-chain primitive actually holds
// the locks. Today only Adrena's native locked-staking primitive is wired
// (`addLockedStake(stakingType=2)`). The /buy_alp UI's "Lock Provider:
// Streamflow" label is forward-looking — no on-chain evidence of Streamflow
// ALP locks exists today (zero accounts on the Streamflow Streams program
// with the ALP mint at canonical memcmp offset 177, zero "streamflow"
// matches in any AdrenaFoundation repo, no SDK wrapper).
//
// To keep Activity 1 scoring agnostic to mechanism, all lock readers
// implement this interface. v1 ships `AdrenaNativeLockSource`. A future
// `StreamflowLockSource` plugs in WITHOUT touching scoring logic — the
// aggregator just adds a new source to the registry and the LP scorer
// transparently consumes both.
//
// See `.agent/brain/zedef_mutagen_rework_r2_teardown.md` §3.3 for the
// design rationale and the three options (A native / B Streamflow / C both)
// presented to ZeDef.
// ============================================================================

import type { PublicKey } from '@solana/web3.js';

/**
 * A single active lock entry, normalized across source programs.
 *
 * Returned by `LockSource.getActiveLocks()`. The aggregator consumes these
 * to compute per-lock score contributions via the Activity 1 scoring formula.
 */
export interface LockEntry {
    /**
     * The mint of the locked token. Explicit — never inferred from the
     * source program or seed scheme. Activity 1 scoring uses this to look
     * up the right USD price (ALP vs RWALP) so per-mint pricing is correct
     * even when both mints are passed through the same source.
     */
    sourceMint: PublicKey;

    /**
     * Duration of the lock in days, bucketed to the nearest UI tier:
     *   ADX (LM): 0 / 90 / 180 / 360 / 540
     *   ALP (LP): 30 / 90 / 180 / 360
     * Bucketing keeps scoring stable across sub-tier on-chain locks (e.g.
     * a 7-day or 60-day native lock buckets to its nearest UI tier rather
     * than scoring 0 because it doesn't match a tier exactly).
     */
    durationDays: number;

    /**
     * Raw amount in token base units (multiply by 1/10^decimals for human).
     * bigint avoids precision loss for large amounts.
     */
    amountRaw: bigint;

    /** Unix seconds when the lock started. */
    startedAt: number;

    /** Unix seconds when the lock unlocks. */
    endsAt: number;

    /**
     * Which on-chain primitive holds the lock. Mostly for observability /
     * debugging — scoring is mint-driven, not source-driven.
     */
    sourceProgram: 'adrena-native' | 'streamflow-streams' | 'streamflow-aligned';
}

/**
 * Reads locked-stake entries for a (wallet, mint) pair.
 *
 * Implementations should return ONLY entries that are currently active:
 *   amountRaw > 0 AND endsAt > now
 *
 * Expired-but-unwithdrawn locks should NOT be returned — the lock period
 * is over, the user has already enjoyed it, and they should withdraw.
 * Returning them would inflate Mutagen scores beyond what's earned.
 */
export interface LockSource {
    /** Returns active locks for (wallet, mint). Empty array if none or the underlying account doesn't exist. */
    getActiveLocks(wallet: PublicKey, mint: PublicKey): Promise<LockEntry[]>;

    /** Source identifier for logs / observability. */
    readonly name: string;
}
