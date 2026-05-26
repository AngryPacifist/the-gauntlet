// ============================================================================
// Mutation + Meta-mutation engine
// ============================================================================
//
// Within-Activity mutations are already applied in each scorer
// (sumMutationIncrements inside scoreActivityN's mutationFactor → finalScore).
// This module handles the CROSS-Activity meta-mutation: take the 5
// per-Activity finalScores, weight them, and apply a multiplier based on
// how many Activities the wallet qualified in (= ZeDef's "meta-mutation
// for performing all 5, or a lower combination" from RAW line 229).
//
// Per teardown §9 + Gap 9: qualifiedCount is "count of Activities where
// activity_score ≥ activity.qualifyingThreshold" — that gating happens
// inside each scorer (ActivityScoreResult.qualified). This module just
// reads it and looks up the multiplier from config.metaMutationTable.
//
// Default table {1:1.0, 2:1.05, 3:1.15, 4:1.30, 5:1.50} (from
// DEFAULT_EPOCH_CONFIG): 1 qualified Activity has no bonus, 2 gets +5%,
// 5 (all of them) gets +50%. Admin-tunable per epoch.
// ============================================================================

import type { ActivityScoreResult, EpochConfig } from './mutagen-scorer-types.js';

export interface AggregateResult {
    /** Sum of weighted Activity finalScores, BEFORE meta-mutation. */
    weightedSum: number;
    /** Number of Activities whose finalScore ≥ qualifyingThreshold. 0..5. */
    qualifiedCount: number;
    /** Multiplier from config.metaMutationTable[qualifiedCount]. Defaults to 1.0 if missing. */
    metaMutationMultiplier: number;
    /** Final Mutagen score for the wallet this sub-epoch = weightedSum × metaMutationMultiplier. */
    totalMutagen: number;
    /** The full per-Activity breakdown, unchanged from the scorers. */
    activityBreakdown: ActivityScoreResult[];
}

/**
 * Aggregates 5 per-Activity scoring results into a single Mutagen total.
 *
 * Caller responsibility: pass exactly the ActivityScoreResults you want
 * counted. The function does NOT enforce activity uniqueness — passing
 * duplicates or missing some is the caller's call (e.g., if one scorer
 * errored, the aggregator might pass 4 results plus a synthesized 0).
 *
 * Weight lookup: weights.a1..a5 indexed by ActivityScoreResult.activity
 * (1..5). An unknown activity number falls back to weight 0.
 */
export function aggregateAndApplyMetaMutation(
    results: ActivityScoreResult[],
    config: EpochConfig,
): AggregateResult {
    const weightForActivity = (n: 1 | 2 | 3 | 4 | 5): number => {
        switch (n) {
            case 1: return config.weights.a1;
            case 2: return config.weights.a2;
            case 3: return config.weights.a3;
            case 4: return config.weights.a4;
            case 5: return config.weights.a5;
            default: return 0;
        }
    };

    let weightedSum = 0;
    for (const r of results) {
        weightedSum += weightForActivity(r.activity) * r.finalScore;
    }

    const qualifiedCount = results.filter((r) => r.qualified).length;
    // Default to 1.0 when the table is missing an entry for this count
    // (e.g., admin omits the 0-qualified row, which would be 1.0 anyway).
    const metaMutationMultiplier = config.metaMutationTable[qualifiedCount] ?? 1.0;

    const totalMutagen = weightedSum * metaMutationMultiplier;

    return {
        weightedSum,
        qualifiedCount,
        metaMutationMultiplier,
        totalMutagen,
        activityBreakdown: results,
    };
}

/**
 * Convenience for building an Activity result that represents "this Activity
 * errored or wasn't run" — zero score, not qualified, with an error note in
 * details. The aggregator (Commit 16) uses this when a scorer throws so
 * the meta-mutation count isn't poisoned by missing entries.
 */
export function emptyActivityResult(
    activity: 1 | 2 | 3 | 4 | 5,
    error?: string,
): ActivityScoreResult {
    return {
        activity,
        baseScore: 0,
        mutationFactor: 1.0,
        finalScore: 0,
        qualified: false,
        dimensions: [
            {
                dimension: 'error',
                raw: 0,
                qualifiedForMutation: false,
                details: { error: error ?? 'no result' },
            },
        ],
    };
}
