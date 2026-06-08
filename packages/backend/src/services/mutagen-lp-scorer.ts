// ============================================================================
// Activity 1 scorer: LP minting (ALP + RWALP)
// ============================================================================
//
// Activity 1: weight 30% of total Mutagen. Three dimensions:
//   1. Mint   — has a non-zero ALP or RWALP balance (net of redemption)
//   2. Size   — USD value of LP position via admin-tunable bracket table
//   3. Lock   — sum of lock-duration-weighted USD value per active lock,
//               capped per-lock to avoid whale dominance
//
// Mint + Size + Lock all "qualified" → within-Activity mutation triggers.
// Increments are admin-tunable per-tier (default [0.3, 0.5, 0.7, 0.9]):
// a per-tier-increasing slope, steeper as more dimensions qualify.
//
// Lock reads go through the LockSource interface so Streamflow can later
// plug in without touching this file. Today only AdrenaNativeLockSource
// is wired (see lock-sources/adrena-native.ts).
//
// USD prices arrive via ctx.prices, populated by the aggregator, so this
// scorer doesn't fetch prices itself: a single price fetch covers all 5
// Activity scorers for a given wallet.
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection } from './solana-rpc.js';
import { ALP_MINT, RWALP_MINT } from './solana-constants.js';
import { AdrenaNativeLockSource } from './lock-sources/adrena-native.js';
import {
    bracketLookupUsd,
    sumMutationIncrements,
    type ScorerContext,
    type ActivityScoreResult,
    type DimensionScore,
} from './mutagen-scorer-types.js';

// Singleton — stateless, threadsafe (LockSource has no per-call state)
const lockSource = new AdrenaNativeLockSource();

// LP tokens have 6 decimals
const LP_DECIMALS = 6;
const LP_DIVISOR = 10 ** LP_DECIMALS;

export async function scoreActivity1(ctx: ScorerContext): Promise<ActivityScoreResult> {
    // ---------- 1. Mint + Size dimensions ----------
    // Mint = net-of-redemption = current SPL balance. If you minted and
    // redeemed everything, balance = 0 and you don't qualify.
    const [alpBalance, rwalpBalance] = await Promise.all([
        getSplBalance(ctx.wallet, ALP_MINT),
        getSplBalance(ctx.wallet, RWALP_MINT),
    ]);
    const alpUsd = alpBalance * ctx.prices.alp;
    const rwalpUsd = rwalpBalance * ctx.prices.rwalp;
    const totalLpUsd = alpUsd + rwalpUsd;

    const sizeScore = bracketLookupUsd(ctx.config.activity1.sizeBrackets, totalLpUsd);

    const mintDim: DimensionScore = {
        dimension: 'mint',
        raw: totalLpUsd > 0 ? 1 : 0,
        qualifiedForMutation: totalLpUsd > 0,
        details: { alpBalance, rwalpBalance, alpUsd, rwalpUsd, totalLpUsd },
    };
    const sizeDim: DimensionScore = {
        dimension: 'size',
        raw: sizeScore,
        qualifiedForMutation: sizeScore > 0,
        details: { totalLpUsd, bracketPts: sizeScore },
    };

    // ---------- 2. Lock dimension ----------
    const [alpLocks, rwalpLocks] = await Promise.all([
        lockSource.getActiveLocks(ctx.wallet, ALP_MINT),
        lockSource.getActiveLocks(ctx.wallet, RWALP_MINT),
    ]);
    const allLocks = [...alpLocks, ...rwalpLocks];

    let lockScore = 0;
    for (const lock of allLocks) {
        // Pick the right per-mint price via the LockEntry.sourceMint field
        // (explicit, not fragile array-membership inference).
        const price = lock.sourceMint.equals(ALP_MINT) ? ctx.prices.alp : ctx.prices.rwalp;
        const lockUsd = (Number(lock.amountRaw) / LP_DIVISOR) * price;
        const cappedUsd = Math.min(lockUsd, ctx.config.activity1.lockUsdCap);
        const tierMult =
            ctx.config.activity1.lockTierMultipliers[String(lock.durationDays)] ?? 1.0;
        lockScore += tierMult * cappedUsd;
    }

    const lockDim: DimensionScore = {
        dimension: 'lock',
        raw: lockScore,
        qualifiedForMutation: allLocks.length > 0,
        details: {
            lockCount: allLocks.length,
            // Strip non-serializable PublicKey from details — store base58 string.
            locks: allLocks.map((l) => ({
                sourceMint: l.sourceMint.toBase58(),
                durationDays: l.durationDays,
                amountRaw: l.amountRaw.toString(),
                startedAt: l.startedAt,
                endsAt: l.endsAt,
                sourceProgram: l.sourceProgram,
            })),
        },
    };

    // ---------- 3. Within-Activity mutation ----------
    const dims = [mintDim, sizeDim, lockDim];
    const qualifiedCount = dims.filter((d) => d.qualifiedForMutation).length;
    const extraQualified = Math.max(0, qualifiedCount - 1);
    const mutationFactor =
        1 + sumMutationIncrements(ctx.config.activity1.mutationIncrements, extraQualified);

    const baseScore = sizeScore + lockScore;
    const finalScore = baseScore * mutationFactor;

    return {
        activity: 1,
        baseScore,
        mutationFactor,
        finalScore,
        qualified: finalScore >= ctx.config.activity1.qualifyingThreshold,
        dimensions: dims,
    };
}

/**
 * Reads SPL token balance for a wallet+mint, summed across all token
 * accounts (covers the rare case where a wallet has more than one ATA
 * for the same mint — e.g. legacy migration).
 *
 * Returns the human-readable balance (e.g. 1.5 ALP, not raw 1500000).
 */
async function getSplBalance(wallet: PublicKey, mint: PublicKey): Promise<number> {
    const connection = getSolanaConnection();
    const accounts = await connection.getParsedTokenAccountsByOwner(wallet, { mint });
    let total = 0;
    for (const a of accounts.value) {
        // The parsed data shape comes from @solana/web3.js — typed as unknown,
        // narrow it at the access point.
        const info = (a.account.data as { parsed: { info: { tokenAmount: { uiAmount: number | null } } } }).parsed.info;
        total += info.tokenAmount.uiAmount ?? 0;
    }
    return total;
}

