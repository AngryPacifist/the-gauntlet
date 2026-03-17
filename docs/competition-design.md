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
- **Zero-barrier sign-up**: any valid Solana wallet is accepted. No eligibility checks (trade history, recency) are performed at registration time.
- Quality filters (minimum activity, prize eligibility) are evaluated at prize distribution time, not sign-up.

### 2. Tournament Start

An admin triggers the start. Registration closes and brackets are created:

1. All registered wallets are collected.
2. Wallets are shuffled randomly (Fisher-Yates algorithm).
3. Wallets are split into groups of `bracketSize` (default: 8).
4. If the last group has fewer than 2 traders, it is merged with the previous group.
5. Round 1 begins immediately. Its duration is taken from `roundDurations[0]` (default: 72 hours).

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
   - Eliminated wallets are tracked for the Fallen Fighters pool (see below).
   - Advancing wallets are re-shuffled into new brackets for the next round.
   - Round 2+ brackets use half the original bracket size for more focused competition.
   - **Round 3 (final main round) is rank-only**: all participants are ranked but none eliminated, ensuring everyone earns finalist-level season points.

### 4. Fallen Fighters Pool

Eliminated traders are not removed from competition entirely. When the main bracket concludes (after Round 3), all wallets eliminated from any main round (R1 + R2) are placed into a single Fallen Fighters consolation round:

- The FF pool is scored over the same time window as the final main round.
- Ranking is flat (rank-only) — no elimination within the FF pool.
- Top 3 FF finishers earn consolation season points (1st: 6, 2nd: 4, 3rd: 3).
- Once the FF round completes, the tournament is marked as completed.

### 5. Completion

A tournament completes when:
- The main bracket finishes (3 or fewer traders remain, or 3 rounds completed), AND
- The Fallen Fighters consolation round has been scored and completed.

The remaining traders are the finalists.

---

## Round Names

Each round has a thematic name:

**Main bracket:**

| Round | Name           |
|-------|----------------|
| 1     | First Blood    |
| 2     | The Crucible   |
| 3     | Sudden Death   |
| Final | Endgame        |

**Fallen Fighters (consolation):**

| Round | Name              |
|-------|-------------------|
| 1     | Fallen Fighters   |

---

## Scoring: Composite Performance Index (CPI)

The CPI is a weighted sum of four sub-scores, each normalized to a 0-100 scale:

```
CPI = (0.35 x PnL) + (0.20 x Risk) + (0.30 x Consistency) + (0.15 x Activity)
```

### PnL Score (35%)

Measures net profitability relative to notional exposure (ROI).

- **ROI** = Total Net PnL (USD) / Total Notional Exposure (USD)
- Notional exposure = `entry_size × entry_price` (immutable at position open; cannot be gamed).
- Normalized linearly from -100% ROI (score 0) to +200% ROI (score 100).
- Only closed/liquidated positions contribute to realized PnL.
- If a trader has only open positions, PnL score defaults to 50 (neutral).

Uses `entry_size × entry_price` instead of `collateral_amount` as the denominator because collateral can be removed mid-trade, making it gameable.

### Risk Score (20%)

Measures risk management discipline. Starts at 100 and is reduced by penalties:

- **Liquidation penalty**: `(liquidated count / total count) x 100`
- **Leverage penalty**: `max(0, (average_leverage - threshold) x 2)`. Threshold is configurable (default: 30x).

The 30x default was chosen to respect Adrena's trading style — many legitimate strategies use 10-25x leverage on the platform.

### Consistency Score (30%)

Measures consistent profitable performance across trading days.

- Closed positions are grouped by the calendar day they were closed.
- **Profitable days ratio** (0-80 points): `(days with net positive PnL / total trading days) × 80`
- **Win rate bonus** (0-20 points): `(winning trades / total trades) × 20`

This replaced the previous standard-deviation approach, which perversely penalized big winning days. The profitable-days ratio rewards traders who are green on most days they trade, without punishing outsized wins.

If a trader has only open positions, they receive a baseline of 30.

### Activity Score (15%)

Measures active participation. Prevents "open one trade, sit idle" strategies:

- **Trade count**: `min(count / 10, 1) x 30`. Maxes out at 10+ trades.
- **Volume**: `min(volume / $10,000, 1) x 30`. Maxes out at $10K+ notional volume.
- **Variety**: `min(unique_symbols / N, 1) x 40`. N = `supportedAssetCount` from config (default: 4).

Variety is heavily weighted (40%) to push traders toward using all available assets on Adrena, directly serving the platform's goal of broad market engagement.

---

## Season Structure

Tournaments can be grouped into a **weekly season** — a multi-week competitive arc that culminates in a Season Final.

### Season Lifecycle

```
registration → active → final → completed
                ↕ advanceWeek() loops through weeks
```

1. **Registration**: Season is created, accepting signups.
2. **Active**: Weekly gauntlet tournaments run sequentially (default: 7 weeks). Wallets register once and are auto-enrolled in all subsequent weeks.
3. **Final**: Top qualifiers from aggregate standings compete in the Season Grand Final.
4. **Completed**: Season ends after the Final tournament completes.

### Season Points

After each weekly tournament completes, wallets earn season points based on placement:

| Placement | Points |
|-----------|--------|
| Tournament winner | 25 |
| 2nd place | 18 |
| 3rd place | 15 |
| Other finalists | 12 |
| Eliminated in Round 2+ | 8 |
| Eliminated in Round 1 | 4 |
| Consolation 1st (FF) | 6 |
| Consolation 2nd (FF) | 4 |
| Consolation 3rd (FF) | 3 |
| Registered but no trades | 1 |

Points accumulate across all weeks. Consolation points are only applied if they exceed the wallet's existing weekly points (prevents double-counting).

### Qualification

After all regular weeks conclude, the top N wallets by total season points (default: 8) qualify for the Season Grand Final. Qualified wallets are auto-registered into the Final tournament.

### Placement Detection

Finalists are wallets that advanced in (or were never eliminated from) the last main round, ordered by CPI score. The winner is the finalist with the highest CPI.

---

## Daily Categories

Alongside the main CPI-based bracket tournament, two daily tactical categories provide engagement loops for all registered traders — including those already eliminated from the main bracket.

### All Around Trader

Rewards diversified profitable trading across multiple assets within a single UTC day.

**Algorithm:**
1. Filter positions opened on the UTC day.
2. Exclude positions with exposure < $1,000 (`entry_size × entry_price`).
3. Only closed positions count (need realized PnL).
4. Group by asset symbol.
5. For each asset: select the position with the highest ROI.
   - ROI > 0 → `min(ROI × 100, 200)` points (capped at 200 per asset)
   - ROI ≤ 0 → 0 points
6. Sum across all assets.

**Design rationale:** The $1K minimum prevents dust-trade farming. The 200-point cap prevents one outlier position from dominating. Only closed positions are counted because open positions have no realized PnL.

### Top Bottom Fisher

Rewards precise entry timing — catching the best long entry near the day's low, or the best short entry near the day's high.

**Data source:** Daily OHLC candles from the [Pyth Benchmarks TradingView shim](https://benchmarks.pyth.network/v1/shims/tradingview/history). No API key required. Bars are cached in the database (immutable after the day ends).

**Algorithm (tournament-wide):**
1. For each trader's positions opened on the UTC day:
   - Find their best long across all assets (highest proximity to day low)
   - Find their best short across all assets (highest proximity to day high)
2. Long proximity: `1 - ((entry_price - day_low) / (day_high - day_low))`
3. Short proximity: `(entry_price - day_low) / (day_high - day_low)`
4. Rank all traders' best longs by proximity (descending). Top 3 receive rank points: 3, 2, 1.
5. Rank all traders' best shorts by proximity (descending). Top 3 receive rank points.
6. Score = `rank_points × max(ROI, 0) × 100`

**Edge cases:**
- Zero price range (high = low) → that asset is skipped entirely.
- Entry outside day's range → proximity clamped to [0, 1].
- Open positions → ROI = 0, so ranked but no score.
- Fewer than 3 traders with longs/shorts → only available ranks awarded.

### Supported Adrena Assets

| Adrena Symbol | Pyth TradingView Symbol |
|---------------|------------------------|
| SOL | `Crypto.SOL/USD` |
| BTC | `Crypto.BTC/USD` |
| BONK | `Crypto.BONK/USD` |
| JITOSOL | `Crypto.JITOSOL/USD` |

The mapping is configurable via `ADRENA_TO_PYTH_SYMBOL` in `types.ts`.

---

## Anti-Gaming Filters

Before scoring, positions are filtered to prevent manipulation:

| Filter                   | Default    | Purpose                                          |
|--------------------------|------------|--------------------------------------------------|
| `minPositionCollateral`  | $25 USD    | Excludes dust trades (negligible risk)            |
| `minTradeDurationSec`    | 120 seconds| Excludes wash trades (open-close-repeat gaming)   |
| Round time window        | Per round  | Only counts positions opened during the round     |

---

## Tournament Configuration

All parameters are configurable per tournament:

| Parameter                  | Default      | Description                                         |
|----------------------------|--------------|-----------------------------------------------------|
| `bracketSize`              | 8            | Traders per bracket in Round 1                      |
| `advanceRatio`             | 0.5          | Fraction of bracket that advances each round        |
| `roundDurations`           | [72, 48, 48] | Duration of each round in hours (per-round array)   |
| `minPositionCollateral`    | 25           | Minimum collateral (USD) for a position to count    |
| `minTradeDurationSec`      | 120          | Minimum duration (seconds) for a position to count  |
| `leveragePenaltyThreshold` | 30           | Leverage above this is penalized in Risk score      |
| `supportedAssetCount`      | 4            | Number of tradeable assets (for Activity variety)   |
| `useHistoricalWindow`      | false        | Use historical window instead of round dates        |
| `historicalWindowDays`     | 90           | Days for historical window (for backtesting)        |

---

## Data Source

All trader data comes from the Adrena public HTTP API at `https://datapi.adrena.trade`. The engine fetches:

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

### Current Integrations

- **Data source**: The scoring engine reads from `datapi.adrena.trade/position`. No special access or API keys required.
- **Trading**: Competitors trade on Adrena's platform as they normally would. The competition engine is an observational overlay — it watches and scores, but never interferes with trading.
- **Wallet-based identity**: The same wallet-centric model Adrena already uses. No additional auth layer needed for traders.

---

## Reward Structure

### Prize Distribution Model

Tournament prizes are distributed based on final standing. The recommended structure for a standard 3-round Gauntlet:

| Placement | Share | Example ($5,000 pool) |
|-----------|-------|----------------------|
| 1st       | 40%   | $2,000               |
| 2nd       | 25%   | $1,250               |
| 3rd       | 15%   | $750                 |
| Finalists (remaining) | 20% split | Variable |

The prize pool can be funded in USDC, ADX, or a combination. For ADX-denominated prizes, the current market rate at tournament completion determines dollar equivalence.

### MrRewards Integration

Adrena's `MrRewards` repository contains a keeper service that processes reward distributions automatically. The integration path:

1. **On tournament completion**, the engine produces a ranked finalists list with wallet addresses and placements.
2. **A reward insertion script** writes rows to the `rewards` table in Adrena's rewards database:
   ```
   INSERT INTO rewards (wallet, amount, token, source, tournament_id, placement)
   ```
3. **The MrRewards keeper** picks up pending reward rows and executes SPL token transfers to each wallet automatically.

This means prize distribution requires no manual token transfers — the existing Adrena infrastructure handles it. The only new code needed is a post-tournament script that maps placements to reward amounts and inserts the rows.

### Manual Distribution (Fallback)

If MrRewards integration is not available, prizes can be distributed manually:
1. Export the final standings from the leaderboard endpoint (`GET /api/brackets/leaderboard/:tournamentId`)
2. Transfer tokens to each winner's wallet using any Solana wallet
3. Document the transactions in the tournament's audit trail

---

## Mutagen Integration

### CPI → Mutagen Points Mapping

The Gauntlet's CPI scores can feed directly into Adrena's Mutagen system, rewarding participants with Mutagen points based on their competitive performance:

| Event | Mutagen Points | Rationale |
|-------|---------------|-----------|
| Enter a Gauntlet tournament | 50 | Reward participation |
| Survive Round 1 (First Blood) | 100 | Reward for not being eliminated |
| Survive Round 2 (The Crucible) | 200 | Increasing reward for deeper runs |
| Reach Endgame (finals) | 500 | Significant achievement |
| Win a Gauntlet | 1,000 | Major milestone |
| CPI performance bonus | CPI × 2 | Scaling reward based on score quality |

**Example:** A trader who enters (50), survives Round 1 (100), gets eliminated in Round 2, with a CPI of 65.5 would earn: 50 + 100 + 131 = **281 Mutagen points**.

### Suggested Mutagen Quests

Gauntlet participation creates natural quest opportunities within Adrena's existing quest system:

| Quest | Condition | Points | Category |
|-------|-----------|--------|----------|
| "Enter the Arena" | Register for a Gauntlet tournament | 50 | Participation |
| "Survivor" | Advance past Round 1 | 100 | Achievement |
| "Iron Will" | Win 3 trades in a single round | 75 | Trading |
| "Diversified" | Trade all 4 supported assets in one round | 50 | Activity |
| "Risk Controlled" | Finish a round with Risk score > 80 | 100 | Discipline |
| "Consistent Performer" | Finish a round with Consistency score > 60 | 100 | Discipline |
| "Gauntlet Champion" | Win a tournament | 500 | Achievement |

### Streak Integration

Gauntlet rounds naturally integrate with Adrena's streak mechanic:
- **Round streak**: Consecutive rounds survived across tournaments
- **Trade streak**: Consecutive profitable trades within a round
- **Participation streak**: Entering consecutive Gauntlet seasons

---

## Future Integration Paths

- **Frontend embedding**: The bracket view could be embedded directly in Adrena's trading interface via iframe or as a React component library.
- **Streaming API**: If Adrena ships their planned streaming service, the engine could switch from API polling to real-time event streams for live score updates.
- **Cross-protocol tournaments**: The scoring engine's modular design allows swapping the data source. A future version could score traders across multiple Solana perp DEXes simultaneously.

