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
            'The All Around quest rewards traders who perform consistently across ALL supported assets — SOL, BTC, and BONK. ' +
            'Each day, your best trade per asset is scored based on ROI, and the scores are combined. ' +
            'Only traders active across the full asset range can compete here. Diversification is king.',
        rules: [
            'Only positions opened and closed on the same UTC day count.',
            'Trades under $500 in size are excluded.',
            'Your best trade per asset (by ROI) is selected.',
            'Positive ROI earns up to 25 points per asset (ROI × 25, capped at 25).',
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
            'All traders are ranked by proximity. Top 3 earn rank points (3, 2, 1).',
            'Score = rank points × ROI × 100.',
            'Negative ROI can produce negative scores — precision without profit costs you.',
            'Assets with less than 0.1% daily spread are excluded (stale price feeds).',
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
            'All traders are ranked by proximity. Top 3 earn rank points (3, 2, 1).',
            'Score = rank points × ROI × 100.',
            'Negative ROI can produce negative scores — precision without profit costs you.',
            'Assets with less than 0.1% daily spread are excluded (stale price feeds).',
        ],
    },
    risk_manager: {
        tagline: 'Discipline over danger. Control your downside.',
        description:
            'Risk Manager rewards traders who use stop-losses effectively. Your score is based on your best stop-loss triggered trade — ' +
            'the tightest loss (least negative ROI) wins. ' +
            'This quest spans a 2-day rolling window, giving you time to set up and manage positions carefully.',
        rules: [
            'Scored over a 2-day window (Day 1–2, Day 3–4, etc.).',
            'Only positions closed by stop-loss (SL) with negative PnL count.',
            'Your best SL trade is selected — the one with the least negative ROI.',
            'Score = |ROI| × 100 (absolute value — tighter losses score higher).',
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
            'Your best TP trade is selected — the one with the highest ROI.',
            'Score = ROI × 100.',
            'Leaderboard shows the best single window, not a sum across windows.',
        ],
    },
    leverage_master_long: {
        tagline: 'Push the limits on longs. 10 steps to mastery.',
        description:
            'Leverage Master (Long) is a weekly progression quest. Open profitable long positions at increasing leverage tiers — ' +
            'from 10x up to 100x across 10 defined steps. Each step requires a closed, profitable position at or above the tier\'s leverage. ' +
            'Complete all 10 steps in a single week to max out your score. Partial progress still earns points.',
        rules: [
            'Steps: 10x, 20x, 30x, 40x, 50x, 60x, 70x, 80x, 90x, 100x.',
            'Each step has a ±2x tolerance (e.g., 50x accepts 48x–52x).',
            'Position must be a long with at least $25 collateral.',
            'Position must stay open for at least 2 minutes.',
            'Opening a qualifying position at any step counts — it doesn\'t need to be profitable.',
            'Steps are permanent per week — once earned, never removed.',
            'Ranked by steps completed. More steps = higher rank.',
        ],
    },
    leverage_master_short: {
        tagline: 'Push the limits on shorts. 10 steps to mastery.',
        description:
            'Leverage Master (Short) mirrors the Long version — open profitable short positions at escalating leverage tiers. ' +
            'Same 10-step structure, same weekly window. The twist: shorting at high leverage demands even sharper timing and conviction. ' +
            'Only the most precise short sellers will complete all steps.',
        rules: [
            'Steps: 10x, 20x, 30x, 40x, 50x, 60x, 70x, 80x, 90x, 100x.',
            'Each step has a ±2x tolerance (e.g., 50x accepts 48x–52x).',
            'Position must be a short with at least $25 collateral.',
            'Position must stay open for at least 2 minutes.',
            'Opening a qualifying position at any step counts — it doesn\'t need to be profitable.',
            'Steps are permanent per week — once earned, never removed.',
            'Ranked by steps completed. More steps = higher rank.',
        ],
    },
};
