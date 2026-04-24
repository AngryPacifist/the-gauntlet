// ============================================================================
// Quest Descriptions — Human-Readable Copy for The Forge Competition Page
//
// Each quest has a short tagline, an expanded description for the [+] rule
// section, and a structured rules list for the detailed scoring breakdown.
// Written for traders, not developers.
// ============================================================================

export interface QuestDescription {
    tagline: string;
    description: string;
    rules: string[];
}

// Fallen Fighters — displayed as a banner/info block on the Forge page
// during Gauntlet tournaments where elimination has occurred.
export const FF_DESCRIPTION = {
    title: 'Fallen Fighters',
    description:
        'All eliminated traders are automatically scored during the Endgame round. ' +
        'Your trades during this period count toward the Fallen Fighters pool — ' +
        'keep trading for a shot at consolation prizes. ' +
        'The top 3 Fallen Fighters earn season points (6, 4, 3), and all participants earn at least 1.',
};

export const QUEST_DESCRIPTIONS: Record<string, QuestDescription> = {
    all_around: {
        tagline: 'Master every asset, dominate the scoreboard.',
        description:
            'The All Around quest rewards traders who perform consistently across ALL supported assets in the tournament. ' +
            'Each day, your best trade per asset is scored based on ROI, and the scores are combined. ' +
            'Only traders active across the full asset range can compete here. Diversification is king.',
        rules: [
            'Only positions opened and closed on the same UTC day count.',
            'Low-size trades are excluded.',
            'Your best trade per asset (by ROI) is selected.',
            'Positive ROI earns points per asset, capped to prevent a single outlier dominating.',
            'Negative ROI on an asset scores 0 — it won\'t drag you down.',
            'Scores are summed across all assets — more assets = higher ceiling.',
        ],
    },
    top_tick_traveler: {
        tagline: 'Catch the top. Short the peak.',
        description:
            'Top-Tick Traveler rewards the sharpest short entries. Your best short position each day is measured by ' +
            'how close your entry price was to the daily high (the "top tick"). The closer you are to shorting the exact top, ' +
            'the higher your score. Precision timing on short entries is everything.',
        rules: [
            'Your best short entry of the day is selected (closest to the daily high).',
            'Proximity is measured as a percentage — 100% means you shorted the exact high.',
            'All traders are ranked by proximity — the sharpest entries score highest.',
            'Negative ROI can produce negative scores — precision without profit costs you.',
            'Assets with unusually tight price ranges are excluded (stale price feeds).',
        ],
    },
    bottom_fisher: {
        tagline: 'Buy the dip. Nail the bottom.',
        description:
            'Bottom Fisher is the mirror of Top-Tick Traveler — it rewards the best long entries. Your best long position each day is scored by ' +
            'how close your entry price was to the daily low. If you consistently enter longs near the bottom of the daily range, ' +
            'this quest is yours. ROI acts as a tiebreaker when entry precision is equal.',
        rules: [
            'Your best long entry of the day is selected (closest to the daily low).',
            'Proximity is measured as a percentage — 100% means you bought the exact low.',
            'All traders are ranked by proximity — the sharpest entries score highest.',
            'Negative ROI can produce negative scores — precision without profit costs you.',
            'Assets with unusually tight price ranges are excluded (stale price feeds).',
        ],
    },
    risk_manager: {
        tagline: 'Discipline over danger. Control your downside.',
        description:
            'Risk Manager rewards traders who use stop-losses effectively. Your score is based on your best stop-loss triggered trade — ' +
            'the tightest, best-controlled loss wins. ' +
            'This quest spans a 2-day rolling window, giving you time to set up and manage positions carefully.',
        rules: [
            'Scored over a 2-day window (Day 1–2, Day 3–4, etc.).',
            'Only positions closed by stop-loss (SL) with negative PnL count.',
            'Your best SL trade is selected — the tightest controlled loss.',
            'Tighter losses score higher.',
            'Minimum trade size applies (prevents micro-trade exploitation).',
            'Leaderboard shows the best single window, not a sum across windows.',
        ],
    },
    humble_one: {
        tagline: 'Low leverage. High conviction. Pure skill.',
        description:
            'The Humble One quest celebrates disciplined take-profit usage. ' +
            'Your best trade within a 2-day window is scored, rewarding positions closed by take-profit with the highest ROI. ' +
            'Patience and precision over reckless size.',
        rules: [
            'Scored over a 2-day window (Day 1–2, Day 3–4, etc.).',
            'Only positions closed by take-profit (TP) with positive PnL count.',
            'Your best TP trade is selected — the highest-return precision close.',
            'Leaderboard shows the best single window, not a sum across windows.',
        ],
    },
};

// Phase 4 item 30: LM descriptions are now parameterized per-(asset, side).
// Rendered at display time from the tournament's assetList. Replaces the 2 static
// entries (leverage_master_long / leverage_master_short) that existed pre-Phase-4.
//
// Reframing per item 12 coordination: LM now rewards "precision at leverage + asset breadth".
// A SOL-only specialist caps at 1/N of the ceiling — full score requires topping ladders
// across every config asset. The description reflects this explicitly so the diversification
// requirement is visible upfront.
export function getLeverageMasterDescription(
    side: 'long' | 'short',
    assetSymbol?: string, // optional — narrows description to a specific asset tab
): QuestDescription {
    const sideLabel = side === 'long' ? 'Long' : 'Short';
    const sideArticle = side === 'long' ? 'long' : 'short';
    const assetScope = assetSymbol
        ? `for ${assetSymbol}`
        : 'across every supported asset';

    return {
        tagline: `Push the limits on ${sideArticle}s — 10 steps per asset.`,
        description:
            `Leverage Master (${sideLabel}) is a weekly per-asset progression quest. Open qualifying ${sideArticle} positions ` +
            `at increasing leverage tiers — from 10x up to 100x across 10 defined steps ${assetScope}. ` +
            `Each step requires a position at or above the tier's leverage. ` +
            `Completing the full ladder on a single asset earns that asset's share of the weekly LM ceiling; ` +
            `maxing LM overall requires topping ladders on every supported asset.`,
        rules: [
            'Steps: 10x, 20x, 30x, 40x, 50x, 60x, 70x, 80x, 90x, 100x (±2x tolerance per step).',
            `Position must be a qualifying ${sideArticle} position above a minimum collateral threshold.`,
            'Position must meet a minimum open-duration requirement.',
            'Opening a qualifying position at any step counts — it doesn\'t need to be profitable.',
            'Steps are permanent per week — once earned, never removed.',
            'Each asset has its own independent ladder; asset breadth matters for the full ceiling.',
        ],
    };
}
