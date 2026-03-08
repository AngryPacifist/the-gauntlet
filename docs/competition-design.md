# Competition Design: The Gauntlet

## Overview

Adrena: The Gauntlet is a bracket-style elimination trading competition built on top of the Adrena perpetuals protocol. Traders compete in rounds, and the bottom performers are eliminated each round until a small group of top traders remains.

The engine consumes live position data from the Adrena public API, computes a multi-dimensional performance score (the Composite Performance Index), and uses it to rank, eliminate, and advance traders through rounds.

---

## Tournament Lifecycle

A tournament progresses through four states:

```
registration -> active -> completed
                      \-> cancelled
```

### 1. Registration

The tournament is created with a configurable set of parameters. During registration:

- Traders submit their Solana wallet address.
- The engine fetches the wallet's historical positions from the Adrena API.
- Eligibility is checked:
  - Must have at least `minHistoricalTrades` closed positions (default: 5).
  - Most recent trade must be within `maxDaysInactive` days (default: 30).
- Eligible wallets are registered. Ineligible wallets are still recorded with the reason for rejection.

### 2. Tournament Start

An admin triggers the start. Registration closes and brackets are created:

1. All eligible registrations are collected.
2. Wallets are shuffled randomly (Fisher-Yates algorithm).
3. Wallets are split into groups of `bracketSize` (default: 8).
4. If the last group has fewer than 2 traders, it is merged with the previous group.
5. Round 1 begins immediately with a timer of `roundDurationHours` (default: 72 hours).

### 3. Round Progression

Each round follows this flow:

1. **Trading period**: Traders trade on Adrena as they normally would. The engine does not impose any constraints on what they trade — it simply observes.
2. **Scoring**: An admin triggers score computation. For each trader in each bracket:
   - Positions are fetched from the Adrena API.
   - Positions are filtered to the round's time window.
   - Anti-gaming filters are applied (minimum collateral, minimum duration).
   - The CPI is computed (see scoring section below).
3. **Advancement**: An admin triggers round advancement.
   - Each bracket is ranked by CPI score (descending).
   - The top `advanceRatio` (default: 50%) advance to the next round.
   - The rest are eliminated.
   - Advancing wallets are re-shuffled into new brackets for the next round.
   - Round 2+ brackets use half the original bracket size for more focused competition.

### 4. Completion

A tournament completes when either:
- 3 or fewer traders remain after a round, or
- 3 rounds have been completed.

The remaining traders are the finalists.

---

## Round Names

Each round has a thematic name:

| Round | Name           |
|-------|----------------|
| 1     | The Drop       |
| 2     | The Clash      |
| 3     | The Final Ring |

---

## Scoring: Composite Performance Index (CPI)

The CPI is a weighted sum of four sub-scores, each normalized to a 0-100 scale:

```
CPI = (0.35 x PnL) + (0.25 x Risk) + (0.25 x Consistency) + (0.15 x Activity)
```

### PnL Score (35%)

Measures net profitability relative to capital at risk.

- **ROI** = Total Net PnL / Total Collateral Deployed.
- Normalized linearly from -100% ROI (score 0) to +200% ROI (score 100).
- Only closed/liquidated positions contribute to realized PnL.
- If a trader has only open positions, PnL score defaults to 50 (neutral).

This uses ROI rather than absolute PnL to normalize across account sizes. A small account earning 10% outscores a large account earning 1%.

### Risk Score (25%)

Measures risk management discipline. Starts at 100 and is reduced by penalties:

- **Liquidation penalty**: `(liquidated count / total count) x 100`
- **Leverage penalty**: `max(0, (average_leverage - 10) x 2)`. Penalty begins above 10x leverage.

A trader with no liquidations and moderate leverage scores near 100. A trader who gets repeatedly liquidated at 50x leverage scores near 0.

### Consistency Score (25%)

Measures steady performance across days rather than one lucky spike.

- Closed positions are grouped by the calendar day they were closed.
- Daily ROI is computed for each day.
- **Base score**: `100 - StdDev(daily ROIs) x 4`. Low standard deviation = high consistency.
- **Win rate bonus**: `(winning trades / total trades) x 20`. Up to 20 bonus points.

If a trader has only 1 day of activity, StdDev is 0 and they receive the full base score. If they have only open positions, they receive a baseline of 30.

### Activity Score (15%)

Measures active participation. Prevents "open one trade, sit idle" strategies:

- **Trade count**: `min(count / 10, 1) x 50`. Maxes out at 10+ trades.
- **Volume**: `min(volume / $10,000, 1) x 30`. Maxes out at $10K+ notional volume.
- **Variety**: `min(unique_symbols / 4, 1) x 20`. Adrena supports SOL, BTC, JITOSOL, BONK.

---

## Anti-Gaming Filters

Before scoring, positions are filtered to prevent manipulation:

| Filter                   | Default    | Purpose                                          |
|--------------------------|------------|--------------------------------------------------|
| `minPositionCollateral`  | $10 USD    | Excludes dust trades (negligible risk)            |
| `minTradeDurationSec`    | 120 seconds| Excludes wash trades (open-close-repeat gaming)   |
| Round time window        | Per round  | Only counts positions opened during the round     |

---

## Tournament Configuration

All parameters are configurable per tournament:

| Parameter              | Default | Description                                           |
|------------------------|---------|-------------------------------------------------------|
| `bracketSize`          | 8       | Traders per bracket in Round 1                        |
| `advanceRatio`         | 0.5     | Fraction of bracket that advances each round          |
| `roundDurationHours`   | 72      | Duration of each round                                |
| `minHistoricalTrades`  | 5       | Minimum closed trades for registration eligibility    |
| `minPositionCollateral`| 10      | Minimum collateral (USD) for a position to count      |
| `minTradeDurationSec`  | 120     | Minimum duration (seconds) for a position to count    |
| `maxDaysInactive`      | 30      | Maximum days since last trade for eligibility          |

---

## Data Source

All trader data comes from the Adrena public HTTP API at `https://datapi.adrena.xyz`. The engine fetches:

- `GET /position?user_wallet=<wallet>` — All positions for a wallet (open, closed, liquidated).

Position data includes entry/exit prices, PnL, leverage, collateral, fees, timestamps, and symbols. This is the sole data source for scoring; no on-chain RPC calls are required.

---

## Audit Trail

Every score computation is persisted as a **score snapshot** containing:

- The bracket entry ID
- The raw positions used for computation
- The computed scores (all 4 sub-scores + final CPI)
- The timestamp of computation

This provides a complete, auditable record of how every score was derived.

---

## Competitive Analysis

The Gauntlet is designed to solve specific problems with existing competition formats in the Solana perps space:

| Platform | Format | Limitation | How The Gauntlet Differs |
|----------|--------|-----------|--------------------------|
| Jupiter | Flat PnL leaderboard | Whales dominate; small traders have no realistic path to winning | Brackets normalize competition — you compete against 3-7 others in your group, not 10,000 sharks |
| Drift | No competition infrastructure | No structured engagement mechanism | Full tournament lifecycle with rounds, progression, and elimination |
| Adrena Mutagen | Points accumulation (linear) | Structurally linear — you accumulate points over time, no narrative arc | Elimination creates narrative tension — "did I survive?" is more compelling than "what rank am I?" |
| Most perp DEXes | One-dimensional ranking (PnL or volume) | Rewards a single skill; easily gamed by leverage or volume washing | Multi-dimensional scoring — PnL, risk management, consistency, and activity all contribute |

The core psychological hook is **loss aversion**. Being "eliminated" from a bracket is more emotionally impactful than dropping in rank on a leaderboard. Players fight harder to avoid elimination than to climb a ranking, which drives engagement and return visits.

The bracket format also creates natural social dynamics: traders in the same bracket have a shared context, can compare scores, and develop rivalries. This is harder to achieve with a flat leaderboard of thousands.

---

## Integration with Adrena

### What integrates now

- **Data source**: The scoring engine reads from `datapi.adrena.xyz/position`. No special access or API keys required.
- **Trading**: Competitors trade on Adrena's platform as they normally would. The competition engine is an observational overlay — it watches and scores, but never interferes with trading.
- **Wallet-based identity**: The same wallet-centric model Adrena already uses. No additional auth layer needed for traders.

### Potential future integrations

- **MrRewards**: Competition results could be inserted into the `rewards` table schema (discovered in the `MrRewards` repository) for automatic prize distribution via Adrena's existing keeper infrastructure.
- **Mutagen**: The CPI could supplement or replace Mutagen as a scoring mechanism — particularly for time-bounded competitive events vs. ongoing accumulation.
- **Quest system**: Daily objectives within a round ("trade both long and short today", "close a position in profit") could feed into the Activity sub-score for additional engagement.
- **Frontend embedding**: The bracket view could be embedded directly in Adrena's trading interface via iframe or as a React component library.
- **Streaming API**: If Adrena ships their planned streaming service, the engine could switch from API polling to real-time event streams for live score updates.

