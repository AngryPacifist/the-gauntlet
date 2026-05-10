// ============================================================================
// Single-source scoring filters
//
// Round 2 refactor: previously CPI applied `filterValidPositions`
// (collateral + duration) before computeCPI in tournament-manager.ts:469-472,
// while category engines (AA, BF, TT, RM, HO) did not. This produced visible
// asymmetry — wallets could rank in daily categories with positions that were
// excluded from CPI for failing the anti-gaming threshold (case in point: 95Vm
// in T1 with $9.94 BONK trade earning 0.01 quest points but contributing 0 to
// CPI).
//
// Single-source helper used by all engine entry points (CPI, AA, BF, TT, RM,
// HO). LM (quest-engine.ts) already enforces the same checks per-position
// inside positionCompletesStep, so it stays unchanged.
//
// Filter order:
//   1. assetList match (mint when present, symbol fallback) — D16
//   2. joinedAt cutoff (entry_date >= match.joinedAt)
//   3. Symbol canonicalization to match's configured symbol — Phase 8.p
//   4. minPositionCollateral floor
//   5. minTradeDurationSec floor (open positions: elapsed-since-entry; closed:
//      precomputed `duration` or computed from timestamps)
//
// Bypasses asset filter when config.assetList undefined/empty (D5 fallback)
// but ALWAYS applies collateral + duration floors.
// ============================================================================

import type { AdrenaPosition, TournamentConfig } from '../types.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../types.js';

export function filterPositionsForScoring(
    positions: AdrenaPosition[],
    config: TournamentConfig,
): AdrenaPosition[] {
    const minColl = config.minPositionCollateral ?? DEFAULT_TOURNAMENT_CONFIG.minPositionCollateral;
    const minDur = config.minTradeDurationSec ?? DEFAULT_TOURNAMENT_CONFIG.minTradeDurationSec;
    const hasAssetList = !!config.assetList?.length;

    const result: AdrenaPosition[] = [];
    for (const p of positions) {
        let canonical: AdrenaPosition = p;

        // 1+2+3: assetList match + joinedAt + canonicalization (when configured)
        if (hasAssetList) {
            const match = config.assetList!.find((a) =>
                a.mint ? p.token_account_mint === a.mint : p.symbol === a.symbol,
            );
            if (!match) continue;
            const entryDate = p.entry_date.slice(0, 10);
            if (entryDate < match.joinedAt) continue;
            canonical = p.symbol === match.symbol ? p : { ...p, symbol: match.symbol };
        }

        // 4: collateral floor
        const collateral = canonical.entry_collateral_amount ?? canonical.collateral_amount;
        if (collateral < minColl) continue;

        // 5: duration floor
        let durationSec: number | null = null;
        if (canonical.status === 'open') {
            durationSec = (Date.now() - new Date(canonical.entry_date).getTime()) / 1000;
        } else if (canonical.duration != null && canonical.duration > 0) {
            durationSec = canonical.duration;
        } else if (canonical.exit_date) {
            durationSec = (new Date(canonical.exit_date).getTime() - new Date(canonical.entry_date).getTime()) / 1000;
        }
        if (durationSec !== null && durationSec < minDur) continue;

        result.push(canonical);
    }
    return result;
}
