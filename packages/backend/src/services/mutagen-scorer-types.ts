// ============================================================================
// Mutagen R2 — shared scorer types + DEFAULT_EPOCH_CONFIG
// ============================================================================
//
// Single source of truth for what every scorer takes in (ScorerContext) and
// emits (ActivityScoreResult). All scoring math is centralized here through
// the `EpochConfig` shape so admin-tunable knobs (brackets, multipliers,
// thresholds) flow through one config object per epoch.
//
// Two bracket flavors:
//   - UsdBracket  — USD-keyed (Activity 1 size, Activity 2 size, Activity 3
//                   volume, Activity 4 size, Activity 5 referrer earnings)
//   - CountBracket — count-keyed (vote count, distinct-symbols variety)
//
// They are separate types so a value-as-USD can't accidentally be looked up
// through a count-keyed table (the unit semantics would silently mismatch).
// Bracket lookup helpers below dispatch by table type.
//
// Patches applied vs the v1 plan sketch:
//   - Gap 8: activity1.lockUsdCap (per-lock USD cap, anti-whale)
//   - Gap 4: activity3.mode toggle + existingFormulaWeight (wrap-existing vs
//            volume-brackets, admin-switchable per epoch)
//   - Gap 9: UsdBracket / CountBracket type split (was one BracketTable)
// ============================================================================

import type { PublicKey } from '@solana/web3.js';

// ---------- Bracket tables ----------

export type UsdBracket = Array<{
    minUsd: number;
    maxUsd: number | null; // null = open upper bound
    pts: number;
}>;

export type CountBracket = Array<{
    minCount: number;
    maxCount: number | null;
    pts: number;
}>;

/**
 * Looks up the points value for a USD-denominated metric.
 * Returns 0 if value falls below the lowest bracket's minUsd.
 * Brackets must be sorted ascending by minUsd; behavior is undefined otherwise.
 */
export function bracketLookupUsd(table: UsdBracket, valueUsd: number): number {
    for (const b of table) {
        if (valueUsd >= b.minUsd && (b.maxUsd === null || valueUsd < b.maxUsd)) {
            return b.pts;
        }
    }
    return 0;
}

/**
 * Looks up the points value for a count-keyed metric (vote count, distinct
 * symbols, etc). Same semantics as the USD variant but with integer keys.
 */
export function bracketLookupCount(table: CountBracket, value: number): number {
    for (const b of table) {
        if (value >= b.minCount && (b.maxCount === null || value < b.maxCount)) {
            return b.pts;
        }
    }
    return 0;
}

// ---------- UI lock-tier buckets ----------
//
// Used by both AdrenaNativeLockSource (deciding which tier a sub-tier
// on-chain lock duration buckets to) and Activity 2 staking scorer
// (mapping per-stake locked_days to its multiplier-eligible tier).
//
// ADX UI tiers from /stake page header (0d liquid / 90d / 180d / 360d / 540d).
// ALP UI tiers from /buy_alp Lock buttons (30d / 90d / 180d / 1yr).
// The "1yr" button is treated as 360d per native-staking convention;
// ZeDef open question #31 reconciles whether it should be 365 instead.

export const ADX_TIERS_DAYS: readonly number[] = [0, 90, 180, 360, 540];
export const ALP_TIERS_DAYS: readonly number[] = [30, 90, 180, 360];

/**
 * Buckets `value` to the closest entry in `tiers`. Ties go to the lower
 * tier (because Math.abs comparison is strict-less-than, not less-equal,
 * so the first match wins).
 *
 * Empty tier array is invalid input — returns 0 defensively.
 */
export function bucketToNearestTier(value: number, tiers: readonly number[]): number {
    if (tiers.length === 0) return 0;
    let closest = tiers[0];
    let bestDist = Math.abs(closest - value);
    for (let i = 1; i < tiers.length; i++) {
        const d = Math.abs(tiers[i] - value);
        if (d < bestDist) {
            bestDist = d;
            closest = tiers[i];
        }
    }
    return closest;
}

// ---------- Within-Activity mutation math ----------

/**
 * Sums the first `extraDims` mutation increments. If more extra dimensions
 * exist than tabled increments, the last increment applies for each
 * additional dim (slope continues at the steepest-tier rate, never resets).
 *
 * Example: increments [0.3, 0.5, 0.7, 0.9], extraDims=5
 *   → 0.3 + 0.5 + 0.7 + 0.9 + 0.9 (one extra at last-tier rate) = 3.3
 *
 * "Extra" dims = qualifiedDimCount - 1 (the first qualified dim earns the
 * base mutationFactor of 1.0; each ADDITIONAL qualified dim adds an
 * increment). So:
 *   1 qualified dim  → extraDims=0 → 0   → mutationFactor 1.0
 *   2 qualified dims → extraDims=1 → +0.3 → mutationFactor 1.3
 *   3 qualified dims → extraDims=2 → +0.8 → mutationFactor 1.8
 *
 * Returns 0 for extraDims ≤ 0 (or empty table).
 */
export function sumMutationIncrements(increments: number[], extraDims: number): number {
    if (extraDims <= 0 || increments.length === 0) return 0;
    let sum = 0;
    const tabledCount = Math.min(extraDims, increments.length);
    for (let i = 0; i < tabledCount; i++) sum += increments[i];
    if (extraDims > increments.length) {
        sum += increments[increments.length - 1] * (extraDims - increments.length);
    }
    return sum;
}

// ---------- Scorer I/O ----------

export interface ScorerContext {
    wallet: PublicKey;
    subEpochId: number;
    subEpochStart: Date;
    subEpochEnd: Date;
    config: EpochConfig;
    /** Live USD prices for the assets the scorers value (1 USDC = 1 USD by convention). */
    prices: { adx: number; alp: number; rwalp: number; sol: number; usdc: number };
}

export interface DimensionScore {
    /** Stable identifier — used as the JSON key in mutagen_user_scores.details. */
    dimension: string;
    /** Raw points contribution from this dimension (pre-mutation). */
    raw: number;
    /**
     * Whether this dimension counts toward the within-Activity mutation
     * multiplier. A dimension is "qualified" when it crosses the per-Activity
     * minimum activity threshold (e.g., a $0.50 LP balance is NOT a qualified
     * mint dimension; a 1-cent referral payout is NOT a qualified referrer).
     */
    qualifiedForMutation: boolean;
    /** Free-form breakdown for transparency / debugging — written to DB. */
    details: Record<string, unknown>;
}

export interface ActivityScoreResult {
    activity: 1 | 2 | 3 | 4 | 5;
    /** Sum of dimension contributions before within-category mutation. */
    baseScore: number;
    /**
     * Within-Activity mutation multiplier: 1 + Σ increments for qualified
     * extra dimensions. A score with only 1 qualified dimension has
     * mutationFactor = 1.0 (no bonus); 2 qualified dims = 1.0 + increments[0];
     * 3 = 1.0 + increments[0] + increments[1]; etc.
     */
    mutationFactor: number;
    /** baseScore × mutationFactor. */
    finalScore: number;
    /**
     * Whether this Activity contributes to the across-category meta-mutation
     * count for the wallet. True if finalScore ≥ config.activityN.qualifyingThreshold.
     */
    qualified: boolean;
    dimensions: DimensionScore[];
}

// ---------- Epoch configuration ----------

export interface EpochConfig {
    /** Activity weights — must sum to 1.0. ZeDef-locked at 30/5/30/30/5. */
    weights: { a1: number; a2: number; a3: number; a4: number; a5: number };

    activity1: {
        /** ALP/RWALP size brackets, in USD. */
        sizeBrackets: UsdBracket;
        /** Multiplier per UI lock-duration tier ("30", "90", "180", "360"). */
        lockTierMultipliers: Record<string, number>;
        /** Per-lock USD cap (anti-whale): no single lock contributes more than this. */
        lockUsdCap: number;
        /** Within-Activity mutation increments — index N = N+2-th qualified dim's bonus. */
        mutationIncrements: number[];
        /** Threshold for this Activity to count toward meta-mutation. */
        qualifyingThreshold: number;
    };

    activity2: {
        /** Stake-tier multipliers per UI duration ("0", "90", "180", "360", "540"). */
        stakeTierMultipliers: Record<string, number>;
        sizeBrackets: UsdBracket;
        /** Vote-count → points curve. */
        voteScoreCurve: CountBracket;
        mutationIncrements: number[];
        qualifyingThreshold: number;
    };

    activity3: {
        /**
         * Trading volume scoring mode:
         *   - 'volume_brackets': aggregate per-epoch volume → bracket lookup
         *   - 'wrap_existing_formula': sum Adrena's existing per-trade points
         *     (Trade Performance + Trade Duration × Size Multiplier) across
         *     closed positions in the epoch window; use as the volume metric
         *
         * Admin-switchable per epoch. Default 'volume_brackets' per ZeDef's
         * 2026-05-27 reply (#14: "keep a) and c) as options ... I personally
         * lean a)" — the simpler volume-bracket model for newcomers).
         * 'wrap_existing_formula' stays selectable per epoch. NOTE: the
         * volumeBrackets *values* below are our defaults — ZeDef confirmed the
         * mode, not the specific thresholds (those remain admin-tunable).
         */
        mode: 'volume_brackets' | 'wrap_existing_formula';
        /** When wrapping: weight applied to the existing per-trade points sum. */
        existingFormulaWeight: number;
        volumeBrackets: UsdBracket;
        topPctTiers: Array<{ maxPct: number; pts: number }>;
        /** Admin toggle: include the distinct-asset-variety dimension this epoch? */
        varietyEnabled: boolean;
        varietyMinVolumePerAsset: number;
        /** Distinct qualifying assets → points (CountBracket: keys are counts of assets). */
        varietyBrackets: CountBracket;
        mutationIncrements: number[];
        qualifyingThreshold: number;
    };

    activity4: {
        /**
         * Pool whitelist with per-pool enable/weight. Admin can flip any
         * dormant pool on for an epoch without engineering work.
         */
        pools: Array<{ address: string; enabled: boolean; weight: number; label: string }>;
        sizeBrackets: UsdBracket;
        mutationIncrements: number[];
        qualifyingThreshold: number;
    };

    activity5: {
        referrerBrackets: UsdBracket;
        perRefereePts: number;
        refereeCap: number;
        mutationIncrements: number[];
        qualifyingThreshold: number;
    };

    /**
     * Cross-Activity meta-mutation: maps "qualified Activity count" → multiplier.
     * E.g., {1:1.0, 2:1.05, 3:1.15, 4:1.30, 5:1.50}.
     */
    metaMutationTable: Record<number, number>;

    prizePool: {
        type: 'fixed' | 'percent_fees';
        value: number;
        denominatedIn: 'ADX' | 'USDC';
    };
}

// ---------- Default config ----------
//
// Applied when admin creates a new epoch without specifying overrides.
// All values are starting points for ZeDef to tune via the admin panel.
// ============================================================================

export const DEFAULT_EPOCH_CONFIG: EpochConfig = {
    weights: { a1: 0.30, a2: 0.05, a3: 0.30, a4: 0.30, a5: 0.05 },

    activity1: {
        // ZeDef 2026-05-27 (#21): fixed 10-step ladder regardless of TVL (NOT
        // %-of-TVL — TVL swings: ALP ~500k vs RWALP ~50k would over-reward
        // RWALP), $250 floor / $250k cap, "like leverage master". Geometric
        // boundaries (~2–2.5x/step), +20 pts/step, cap 200. Anchors locked by
        // ZeDef; per-step values approved by OUTIS 2026-06-07, admin-tunable.
        sizeBrackets: [
            { minUsd: 0, maxUsd: 250, pts: 0 },
            { minUsd: 250, maxUsd: 500, pts: 20 },
            { minUsd: 500, maxUsd: 1000, pts: 40 },
            { minUsd: 1000, maxUsd: 2500, pts: 60 },
            { minUsd: 2500, maxUsd: 5000, pts: 80 },
            { minUsd: 5000, maxUsd: 10000, pts: 100 },
            { minUsd: 10000, maxUsd: 25000, pts: 120 },
            { minUsd: 25000, maxUsd: 50000, pts: 140 },
            { minUsd: 50000, maxUsd: 100000, pts: 160 },
            { minUsd: 100000, maxUsd: 250000, pts: 180 },
            { minUsd: 250000, maxUsd: null, pts: 200 },
        ],
        lockTierMultipliers: { '30': 1.0, '90': 1.5, '180': 2.5, '360': 4.0 },
        lockUsdCap: 1000,
        mutationIncrements: [0.3, 0.5, 0.7, 0.9],
        qualifyingThreshold: 10,
    },

    activity2: {
        stakeTierMultipliers: { '0': 1.0, '90': 1.5, '180': 2.5, '360': 3.25, '540': 4.0 },
        sizeBrackets: [
            { minUsd: 0, maxUsd: 100, pts: 0 },
            { minUsd: 100, maxUsd: 1000, pts: 5 },
            { minUsd: 1000, maxUsd: 10000, pts: 20 },
            { minUsd: 10000, maxUsd: 100000, pts: 60 },
            { minUsd: 100000, maxUsd: null, pts: 120 },
        ],
        voteScoreCurve: [
            { minCount: 0, maxCount: 1, pts: 0 },
            { minCount: 1, maxCount: 5, pts: 10 },
            { minCount: 5, maxCount: 15, pts: 30 },
            { minCount: 15, maxCount: null, pts: 60 },
        ],
        mutationIncrements: [0.3, 0.5],
        qualifyingThreshold: 5,
    },

    activity3: {
        mode: 'volume_brackets',
        existingFormulaWeight: 1.0,
        volumeBrackets: [
            { minUsd: 0, maxUsd: 1000, pts: 0 },
            { minUsd: 1000, maxUsd: 10000, pts: 10 },
            { minUsd: 10000, maxUsd: 100000, pts: 30 },
            { minUsd: 100000, maxUsd: 1000000, pts: 80 },
            { minUsd: 1000000, maxUsd: null, pts: 150 },
        ],
        topPctTiers: [
            { maxPct: 0.01, pts: 100 },
            { maxPct: 0.05, pts: 60 },
            { maxPct: 0.10, pts: 30 },
            { maxPct: 0.25, pts: 10 },
        ],
        varietyEnabled: false,
        varietyMinVolumePerAsset: 1000,
        varietyBrackets: [
            { minCount: 0, maxCount: 2, pts: 0 },
            { minCount: 2, maxCount: 4, pts: 10 },
            { minCount: 4, maxCount: null, pts: 25 },
        ],
        mutationIncrements: [0.3, 0.5, 0.7],
        qualifyingThreshold: 10,
    },

    activity4: {
        pools: [
            { address: 'JCaK6qFS4e3YDAnmR2L84KhnrDf5NMwgRjbXgFvxFDnX', enabled: true, weight: 1.0, label: 'ADX-SOL Meteora' },
            { address: 'JCYMX9Nx7DTUdguptRR5LLSc62MEbNmFYsbT5R9yCDGy', enabled: true, weight: 1.0, label: 'ADX-USDC Meteora' },
            { address: '4wM3eJMduZBFytW6VqV5DC2CaSovRrM2RJG8bJkroqLD', enabled: false, weight: 0, label: 'ALP-USDC Meteora (dormant)' },
            { address: '39xxvte8BMaW7qBxeedFk9iauG42vxFsTA7yzM9X9cQN', enabled: false, weight: 0, label: 'ALP-SOL Meteora (dormant)' },
            { address: '7KFMHSyLzeEFebofSLS4zFbHZgkSDJY3CWpd9rJq2Jio', enabled: false, weight: 0, label: 'ADX-SOL Raydium' },
            { address: '2QNwSWsp1deYmNbuZgjFrZ55jnUbiwGrnPk6FMiZ1mEf', enabled: false, weight: 0, label: 'ADX-USDC Raydium (abandoned)' },
        ],
        sizeBrackets: [
            { minUsd: 0, maxUsd: 100, pts: 0 },
            { minUsd: 100, maxUsd: 1000, pts: 20 },
            { minUsd: 1000, maxUsd: 5000, pts: 60 },
            { minUsd: 5000, maxUsd: null, pts: 120 },
        ],
        mutationIncrements: [0.5],
        qualifyingThreshold: 20,
    },

    activity5: {
        referrerBrackets: [
            { minUsd: 0, maxUsd: 0.1, pts: 0 },
            { minUsd: 0.1, maxUsd: 10, pts: 10 },
            { minUsd: 10, maxUsd: 100, pts: 40 },
            { minUsd: 100, maxUsd: null, pts: 100 },
        ],
        perRefereePts: 5,
        refereeCap: 50,
        mutationIncrements: [0.3, 0.5],
        qualifyingThreshold: 5,
    },

    metaMutationTable: { 1: 1.00, 2: 1.05, 3: 1.15, 4: 1.30, 5: 1.50 },

    // Default 0 ADX — admin must explicitly fund per epoch (no auto-fund).
    prizePool: { type: 'fixed', value: 0, denominatedIn: 'ADX' },
};
