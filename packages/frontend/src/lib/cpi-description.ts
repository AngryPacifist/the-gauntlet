// ============================================================================
// CPI Description: user-facing "How Scoring Works" copy for the Forge page.
//
// Renders in the General Leaderboard tab as an expandable panel above the
// search input. Explains tournament mechanics + CPI formula + sub-scores.
//
// INTENTIONALLY DOES NOT PUBLISH specific anti-gaming thresholds
// (min collateral, min duration) or exact normalization math: users should
// not be able to optimize for just-above-threshold positions. Same rationale
// applies to quest-descriptions.ts.
// ============================================================================

export interface CPISection {
    heading: string;
    paragraph?: string;
    items?: string[];
}

export interface CPIDescription {
    title: string;
    tagline: string;
    sections: CPISection[];
}

export const CPI_DESCRIPTION: CPIDescription = {
    title: 'How Scoring Works',
    tagline: 'Final Score = CPI + Quest Points. Top 30% earn skill prizes; the rest split raffle tickets.',
    sections: [
        {
            heading: 'Tournament Mechanics',
            paragraph:
                'Every trader is ranked by Final Score = CPI + Quest Points. The CPI (Composite Performance Index) ' +
                'captures overall trading performance. Quest Points come from the Daily, 2-Day, and Weekly quest ' +
                'categories. At the end of the tournament, the top 30% of traders by Final Score earn skill prizes, ' +
                'and the remaining 70% earn raffle tickets weighted by their score.',
        },
        {
            heading: 'The CPI Formula',
            paragraph: 'CPI weights four dimensions of trading performance, each scored 0–100:',
            items: [
                'PnL (35%): profitability on closed trades',
                'Risk (30%): drawdown discipline and liquidation avoidance',
                'Consistency (20%): steady performance across trading days',
                'Activity (15%): trade count, volume, and asset variety',
            ],
        },
        {
            heading: 'Sub-Scores in Detail',
            items: [
                'PnL: rewards total net profit relative to position size. Larger profitable positions and bigger ROIs both contribute. Losses are penalized proportionally.',
                'Risk: rewards controlled risk-taking. Smaller equity-curve drawdowns and fewer liquidations increase the score.',
                'Consistency: rewards traders who are profitable on more of their trading days, not just on one outlier day.',
                'Activity: rewards active participation: number of trades (capped), trading volume (log-scaled), and the diversity of assets traded.',
            ],
        },
        {
            heading: 'Trade Quality Filters',
            paragraph:
                'To keep the scoring meaningful, trades must meet minimum quality criteria to count toward CPI, ' +
                'preventing dust trades and wash trades from influencing rankings. Filter specifics are intentionally ' +
                'not published, to keep the system robust against just-above-threshold optimization.',
        },
    ],
};
