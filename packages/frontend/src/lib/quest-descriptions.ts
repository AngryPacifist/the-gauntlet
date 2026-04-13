// ============================================================================
// Quest Descriptions — Human-Readable Copy for The Forge Competition Page
//
// Each quest has a short tagline and an expanded description for the [+] rule
// section in the quest breakdown panel. Written for traders, not developers.
// ============================================================================

export const QUEST_DESCRIPTIONS: Record<
    string,
    { tagline: string; description: string }
> = {
    all_around: {
        tagline: 'Master every asset, dominate the scoreboard.',
        description:
            'The All Around quest rewards traders who perform consistently across ALL supported assets — BTC, ETH, SOL, and BONK. ' +
            'Each day, your best trade per asset is scored based on ROI, and the scores are combined. ' +
            'Only traders active across the full asset range can compete here. Diversification is king.',
    },
    top_tick_traveler: {
        tagline: 'Catch the top. Short the peak.',
        description:
            'Top-Tick Traveler rewards the sharpest short entries. Your best short position each day is measured by ' +
            'how close your entry price was to the daily high (the "top tick"). The closer you are to shorting the exact top, ' +
            'the higher your score. Precision timing on short entries is everything.',
    },
    bottom_fisher: {
        tagline: 'Buy the dip. Nail the bottom.',
        description:
            'Bottom Fisher is the mirror of Top-Tick Traveler — it rewards the best long entries. Your best long position each day is scored by ' +
            'how close your entry price was to the daily low. If you consistently enter longs near the bottom of the daily range, ' +
            'this quest is yours. ROI acts as a tiebreaker when entry precision is equal.',
    },
    risk_manager: {
        tagline: 'Discipline over danger. Control your downside.',
        description:
            'Risk Manager rewards traders who keep their risk tight. Your score is based on your best single trade\'s risk-adjusted return — ' +
            'high ROI with controlled position size and reasonable leverage scores highest. ' +
            'This quest spans a 2-day rolling window, giving you time to set up and manage positions carefully.',
    },
    humble_one: {
        tagline: 'Low leverage. High conviction. Pure skill.',
        description:
            'The Humble One quest celebrates low-leverage traders who let their conviction do the heavy lifting. ' +
            'Your best trade within a 2-day window is scored, with a strong preference for positions using minimal leverage. ' +
            'If you can generate returns without cranking leverage to the max, you belong here.',
    },
    leverage_master_long: {
        tagline: 'Push the limits on longs. 10 steps to mastery.',
        description:
            'Leverage Master (Long) is a weekly progression quest. Open profitable long positions at increasing leverage tiers — ' +
            'from 1.1x up to 50x+ across 10 defined steps. Each step requires a closed, profitable position at or above the tier\'s leverage. ' +
            'Complete all 10 steps in a single week to max out your score. Partial progress still earns points.',
    },
    leverage_master_short: {
        tagline: 'Push the limits on shorts. 10 steps to mastery.',
        description:
            'Leverage Master (Short) mirrors the Long version — open profitable short positions at escalating leverage tiers. ' +
            'Same 10-step structure, same weekly window. The twist: shorting at high leverage demands even sharper timing and conviction. ' +
            'Only the most precise short sellers will complete all steps.',
    },
};
