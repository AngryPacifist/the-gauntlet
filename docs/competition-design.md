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
- All FF participants earn season points: 1st: 6, 2nd: 4, 3rd: 3, all others: 1.
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
| 3+    | Endgame        |

**Fallen Fighters (consolation):**

| Round | Name              |
|-------|-------------------|
| 1     | Fallen Fighters   |

---

## Scoring: Composite Performance Index (CPI)

The CPI is a weighted sum of four sub-scores, each normalized to a 0-100 scale:

```
CPI = (0.35 x PnL) + (0.30 x Risk) + (0.20 x Consistency) + (0.15 x Activity)
```

### PnL Score (35%)

Measures net profitability relative to notional exposure (ROI).

- **ROI** = Total Net PnL (USD) / Total Close Exposure (USD)
- Close exposure = `exit_size` (already in USD). Accounts for all upsizing. Falls back to `entry_size` for positions without `exit_size` data.
- Both numerator (PnL) and denominator (exposure) use closed positions only. Open positions are excluded from both.
- Normalized linearly from -100% ROI (score 0) to +200% ROI (score 100).
- If a trader has only open positions, PnL score defaults to 50 (neutral).

Note: `entry_size` and `exit_size` are already in USD (notional exposure), not token units. Do not multiply by `entry_price`. Previously used `entry_size × entry_price`, which was double-multiplying.

### Risk Score (30%)

Measures risk management discipline via equity curve stability. Starts at 100 and is reduced by penalties:

- **Liquidation penalty**: `(liquidated count / total count) x 100`
- **Drawdown penalty**: `min(drawdownRatio × 200, 80)`
  - Drawdown ratio = max drawdown / total closed exposure
  - Max drawdown is computed from the cumulative PnL curve of closed positions, sorted chronologically by exit_date (ties: position_id ascending for determinism)

  | Drawdown Ratio | Penalty | Risk Score (no liquidations) |
  |----------------|---------|------------------------------|
  | 0% (all green) | 0       | 100                          |
  | 5%             | 10      | 90                           |
  | 10%            | 20      | 80                           |
  | 20%            | 40      | 60                           |
  | 40%+           | 80 (cap)| 20                           |

Leverage is not penalized — tactical high-leverage trading is a legitimate strategy on Adrena. Instead, the drawdown metric captures whether a trader manages their equity curve well regardless of leverage used.

### Consistency Score (20%)

Measures consistent profitable performance across trading days.

- Closed positions are grouped by the calendar day they were closed.
- **Profitable days ratio** (0-80 points): `(days with net positive PnL / total trading days) × 80`
- **Win rate bonus** (0-20 points): `(winning trades / total trades) × 20`

This replaced the previous standard-deviation approach, which perversely penalized big winning days. The profitable-days ratio rewards traders who are green on most days they trade, without punishing outsized wins.

If a trader has only open positions, they receive a baseline of 30.

### Activity Score (15%)

Measures active participation. Prevents "open one trade, sit idle" strategies:

- **Trade count**: `min(count / 10, 1) x 30`. Maxes out at 10+ trades.
- **Volume** (logarithmic scale, 0-30 points): `10 × log10(volume / $1,000)`, capped at 30. Uses the API's precomputed `volume` field (round-trip USD notional). Falls back to `entry_size` (already USD).

  | Volume | Score |
  |--------|-------|
  | ≤$1K   | 0     |
  | $10K   | 10    |
  | $100K  | 20    |
  | $1M    | 30    |
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

After each weekly tournament completes, wallets earn season points based on placement. Points are **additive** — a wallet accumulates points from every milestone reached, not just the highest single placement:

| Placement | Points | Stacking |
|-----------|--------|----------|
| Tournament winner | 25 | Placement |
| 2nd place | 18 | Placement |
| 3rd place | 15 | Placement |
| 4th place | 12 | Placement |
| 5th place | 10 | Placement |
| Other finalists | 8 | Placement |
| Survived R1 (played in R2+) | +3 | Additive survival bonus |
| Survived R2 (played in R3+) | +5 | Additive survival bonus |
| FF 1st (Fallen Fighters winner) | +6 | Additive FF bonus |
| FF 2nd | +4 | Additive FF bonus |
| FF 3rd | +3 | Additive FF bonus |
| Other FF participants | +1 | Additive FF bonus |

**Examples (standard 3-round tournament):**
- Tournament winner: 25 (placement) + 3 (R1) + 5 (R2) = **33**
- Eliminated in R2, FF 1st: 3 (R1) + 6 (FF) = **9**
- Eliminated in R1, FF other: 0 + 1 (FF) = **1**

**Survival bonuses are conditional on actual rounds played**: passingR1 is only awarded if ≥2 main rounds exist; passingR2 only if ≥3. A small-field tournament completing after 1 round awards no survival bonuses.

**Idempotency**: A sentinel row in `daily_category_scores` prevents `awardWeeklyPoints` from being called twice for the same tournament.

Points accumulate across all weeks. Additionally, top 3 in each Fisher direction (Top-Tick Traveler / Bottom Fisher) and top 3 All Around traders earn 3/2/1 season points daily (with tie-sharing — see below).

### Qualification

After all regular weeks conclude, **all season participants** qualify for the Season Grand Final. Brackets are seeded by season standing — the highest-ranked wallet faces the lowest-ranked in the same bracket, rewarding consistent season performance with favorable matchups.

### Placement Detection

Finalists are wallets that advanced in (or were never eliminated from) the last main round, ordered by CPI score. The winner is the finalist with the highest CPI.

---

## Daily Categories

Alongside the main CPI-based bracket tournament, seven tactical categories provide engagement loops for all registered traders -- including those already eliminated from the main bracket.

**Daily categories** (scored every UTC day): All Around, Bottom Fisher, Top-Tick Traveler
**2-day window categories** (scored on even-numbered tournament days): Risk Manager, The Humble One
**Weekly categories** (scored at week boundary): Leverage Master (Long), Leverage Master (Short)

### Hourly Provisional Updates

All categories are also scored provisionally every hour (`0 * * * *`) during the current UTC day. This provides traders with near-real-time leaderboard positions throughout the day. Key differences from the midnight (final) scoring:

| Aspect | Midnight Job | Hourly Job |
|--------|-------------|------------|
| Date targeted | Yesterday (completed day) | Today (in-progress day) |
| OHLC data source | `resolution=D` (daily bar, cached in DB) | `resolution=60` (hourly bars, NOT cached) |
| Season point awards | Yes | No (prevents sentinel collision) |
| Leverage leaderboard | Computed at week boundary | Progress evaluation only |
| Status label | FINAL | LIVE |

The hourly job writes to the same `daily_category_scores` table via the existing idempotent upsert (`onConflictDoUpdate`). The midnight job overwrites hourly data with finalized daily OHLC bars, making the midnight run the authoritative source.

The frontend displays a **LIVE** badge (green, pulsing) when viewing today's quest scores, and a **FINAL** badge (muted) for any past date. This sets correct expectations — hourly scores are provisional and may shift as the day progresses.

### All Around Trader

Rewards diversified profitable trading across multiple assets within a single UTC day.

**Algorithm:**
1. Filter positions opened on the UTC day.
2. Exclude positions with close exposure < $500 (`exit_size`, already in USD. Falls back to `entry_size`).
3. Only closed positions count (need realized PnL).
4. Group by asset symbol.
5. For each asset: select the position with the highest ROI.
   - ROI > 0: `min(ROI * 25, 25)` points (capped at 25 per asset)
   - ROI <= 0: 0 points
6. Sum across all assets.

**Design rationale:** The $500 minimum prevents dust-trade farming. The 25-point cap prevents one outlier position from dominating. Only closed positions are counted because open positions have no realized PnL.

**Season points:** Top 3 wallets by daily All Around score earn 3 / 2 / 1 season points respectively. **Tie-sharing**: tied wallets all receive the highest tied rank's points (standard competition ranking). Three wallets tied for 1st all receive 3 points; the next wallet is ranked 4th and receives no season points.

**Inclusive ranking:** Wallets with 0 scores are included in rankings. In bear market conditions where all wallets score 0, they all tie at rank 1 and earn full top-rank season points. The only filtered rows are internal sentinel records (wallet prefix `__`).

### Bottom Fisher (Long Direction)

Rewards precise long entry timing -- *"I see the bottom and try to go long to catch a reversal."*

**Data source:** OHLC candles from the [Pyth Benchmarks TradingView shim](https://benchmarks.pyth.network/v1/shims/tradingview/history). No API key required.
- **Midnight job (final):** Uses `resolution=D` (single daily bar). Cached permanently in the `pyth_ohlc_cache` table — immutable after the day ends.
- **Hourly job (provisional):** Uses `resolution=60` (hourly bars), aggregated into a running high/low for the day so far. NOT cached in the database — intraday data is provisional and changes every hour.

**Algorithm (tournament-wide):**
1. For each trader's positions opened on the UTC day:
   - Find their best long across all assets (highest proximity to day low)
   - Intra-wallet tiebreaker: proximity -> ROI -> position_id (lower wins)
2. Long proximity: `1 - ((entry_price - day_low) / (day_high - day_low))`
3. Rank all traders' best longs by proximity (descending). Tiebreaker: wallet address alphabetical.
4. Top 3 receive rank points: 3, 2, 1.
5. Score = `rank_points * ROI * 100`

**Negative scores:** Fisher scores can be negative when a top-3 proximity trader has negative ROI. The formula is uncapped — no floor at zero. This ensures leaderboards always have entries regardless of market conditions. Wallets with negative Fisher scores are still eligible for quest points if they rank in the top 5.

**Season points:** Top 3 earn 3 / 2 / 1 season points daily.

### Top-Tick Traveler (Short Direction)

Rewards precise short entry timing -- *"I see the top and try to go short to catch a reversal."*

**Algorithm (tournament-wide):**
1. For each trader's positions opened on the UTC day:
   - Find their best short across all assets (highest proximity to day high)
   - Intra-wallet tiebreaker: proximity -> ROI -> position_id (lower wins)
2. Short proximity: `(entry_price - day_low) / (day_high - day_low)`
3. Rank all traders' best shorts by proximity (descending). Tiebreaker: wallet address alphabetical.
4. Top 3 receive rank points: 3, 2, 1.
5. Score = `rank_points * ROI * 100`

**Edge cases (both directions):**
- Degenerate price range (< 0.1% daily spread, or high = low): that asset is skipped entirely. Protects against stale oracle feeds, exchange outages, and permanently cached degenerate OHLC bars.
- Entry outside day's range: proximity clamped to [0, 1].
- Open positions: ROI = 0, so ranked but no score.
- Fewer than 3 traders with longs/shorts: only available ranks awarded.

**Season points:** Top 3 earn 3 / 2 / 1 season points daily.

### Risk Manager (2-day window)

Rewards disciplined stop-loss usage. Best SL-triggered close by ROI within a 2-day window.

**Detection:** `closed_by_sl_tp === true && pnl < 0` (the Adrena API `closed_by_sl_tp` flag indicates a position was closed by its stop-loss or take-profit mechanism; combined with negative PnL, this identifies stop-loss exits).

**Algorithm:**
1. Determine the 2-day window: anchored to the tournament's first round `startTime`, windows are `[day_N-1, day_N]` on even-numbered days (day 2, 4, 6, ...).
2. Filter each wallet's positions to those opened within the window.
3. From those, select SL-triggered closes (see detection above).
4. For each wallet, pick the best trade: highest ROI (least negative = tightest loss).
   - Intra-wallet tiebreaker: ROI -> position_id (lower wins)
5. Leaderboard score = `|ROI| * 100` (absolute value for positive sorting).
6. Raw negative ROI is preserved in the `details` JSON for transparency.

**Aggregation:** MAX (best single window score, not summed across windows).

**Season points:** Configurable via `award2DayCategorySeasonPoints` (default: false).

### The Humble One (2-day window)

Rewards disciplined take-profit usage. Best TP-triggered close by ROI within a 2-day window.

**Detection:** `closed_by_sl_tp === true && pnl > 0` (TP-triggered exit with positive PnL).

**Algorithm:**
1. Same 2-day windowing as Risk Manager.
2. Filter to TP-triggered closes (see detection above).
3. For each wallet, pick the best trade: highest ROI.
   - Intra-wallet tiebreaker: ROI -> position_id (lower wins)
4. Leaderboard score = `ROI * 100`.

**Aggregation:** MAX (best single window score, not summed across windows).

**Season points:** Configurable via `award2DayCategorySeasonPoints` (default: false).

### Determinism Guarantees

All category scoring is fully deterministic. Given the same input data, the same results will always be produced:

| Decision Point | Tiebreaker |
|----------------|------------|
| Fisher ranking (cross-wallet) | proximity DESC, wallet ASC |
| Fisher best position (intra-wallet) | proximity DESC, ROI DESC, position_id ASC |
| Risk Manager / Humble One best trade | ROI DESC, position_id ASC |
| All Around best asset position | ROI DESC (single-valued per asset) |
| Leverage Master leaderboard | stepCount DESC, wallet ASC |
| Season point awards (top-3 boundary) | score DESC, wallet ASC |
| Quest point rankings (daily/2-day/weekly) | score DESC, category-specific ROI DESC, wallet ASC |
| API leaderboard queries | score DESC, wallet ASC |
| Raffle draw pool order | wallet ASC (before PRNG selection) |

### Cross-Category Scoring

A single closed position can score in multiple categories simultaneously. For example, a long entry near the daily low may earn points in both **Bottom Fisher** (entry precision) and **All Around** (best ROI per asset). This is intentional — each category evaluates a different aspect of the same trade:

- **Bottom Fisher / Top-Tick Traveler:** Entry precision relative to daily extremes
- **All Around:** ROI diversification across assets
- **Risk Manager / Humble One:** SL/TP discipline within a 2-day window
- **Leverage Master:** Progressive leverage tier completion over a week

The day / 2-day / weekly window separation across categories further limits any gaming potential. A trade that scores in a daily category cannot also score in a weekly category through the same mechanism — the evaluation logic and time windows are fully independent.

### 2-Day Window Mechanics

The 2-day window is anchored to the tournament's **first round startTime**, not the calendar:

```
Day 1: [tournament_start, tournament_start + 1 day]   -- no window scoring
Day 2: [Day 1, Day 2]                                  -- first window
Day 3: [Day 3, ...]                                    -- no window scoring
Day 4: [Day 3, Day 4]                                  -- second window
```

This prevents drift if the tournament starts mid-week. The `dayNumber` is computed as:
```
daysSinceStart = floor((yesterday - tradingStartDate) / 86400000)
dayNumber = daysSinceStart + 1  // 1-indexed
```

Window scoring fires when `dayNumber >= 2 && dayNumber % 2 === 0`.

### Supported Adrena Assets

| Adrena Symbol | Pyth TradingView Symbol |
|---------------|------------------------|
| SOL | `Crypto.SOL/USD` |
| BTC | `Crypto.BTC/USD` |
| BONK | `Crypto.BONK/USD` |
| JITOSOL | `Crypto.JITOSOL/USD` |

The mapping is configurable via `ADRENA_TO_PYTH_SYMBOL` in `types.ts`.

### Leverage Master (Weekly Quest)

A progressive 10-step quest requiring traders to open positions at specific leverage tiers. Two independent tracks: **Long** and **Short**.

**Steps:** 10x, 20x, 30x, 40x, 50x, 60x, 70x, 80x, 90x, 100x.
Each step has a ±2x tolerance window (e.g., step 50x accepts 48x–52x). Step 100x is capped at Adrena's protocol max (98x–100x).

**Qualification criteria per position:**
- Side must match the track (long or short)
- Collateral ≥ $25 (`entry_collateral_amount`, with fallback to `collateral_amount`)
- Duration ≥ 120 seconds (open positions check elapsed time since entry)
- `entry_leverage` within the step's tolerance window

**Progress persistence:**
- Steps are permanent per week — once earned, never removed.
- Progress is stored in the `quest_progress` table with a unique index on `(tournament_id, wallet, quest_type, side, week_number)`.

**Weekly reset:**
Quest weeks are 7-day windows anchored to the tournament's first main round start date. The week boundary is computed by `computeCurrentQuestWeek()` in the scheduler.

**Scoring:**
At each week boundary (last day of the 7-day window), a leaderboard is computed for each side independently:
- Wallets are ranked by `stepCount DESC, wallet ASC` (fully deterministic).
- Scores are saved to `daily_category_scores` as `leverage_master_long` / `leverage_master_short`.
- `final-score.ts` processes these as `WEEKLY_CATEGORIES`.

**Leaderboard aggregation:** MAX (best single week), not SUM.

**Frontend:** The badge grid shows 10 step badges (10x through 100x) with visual completed/pending state. The standard leaderboard table appears underneath.

**API:** `GET /api/quests/:tournamentId/:wallet?week=N` returns the wallet's step completion for the current or specified week.

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
| `leveragePenaltyThreshold` | 30           | Legacy — no longer used by Risk score (retained for backward compat) |
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

## Raffle System

A deterministic weighted raffle for prize distribution to participants outside the top skill tier. Designed to be fully verifiable and replayable.

### Eligibility

| Criterion | Threshold | Purpose |
|-----------|-----------|----------|
| Closed positions | ≥ 10 | Ensures genuine participation |
| Final score ranking | Not in top 30% | Top performers receive skill prizes instead |
| Ticket count | > 0 | Must have earned tickets through CPI/quest performance |

### Ticket Formula

```
tickets = floor(CPI × 0.5) + floor(questPoints × 20)
```

Top 30% wallets receive zero tickets (they are excluded from the raffle and receive skill-based prizes).

### Draw Mechanism

1. **Seed**: A future Bitcoin block hash is selected after ticket computation is finalized. The first 8 hex characters are parsed as a 32-bit integer to seed the PRNG.
2. **PRNG**: Mulberry32 — a deterministic 32-bit PRNG that produces the same sequence of floats in [0, 1) for any given seed.
3. **Selection**: Weighted random selection without replacement. Each wallet's ticket count is its weight.
4. **Determinism**: The eligible pool is sorted by `wallet ASC` before the draw loop begins. This ensures that two runs with the same block hash always produce identical winners, regardless of database query order.

### Verification

The `verifyDraw()` function re-runs the identical algorithm using the stored block hash and seed, then compares the replayed winners against the stored winners. Any mismatch is reported.

**Audit trail:** The `raffle_draws` table stores:
- Block hash, PRNG seed, eligible count, total tickets, winner count, and the complete winner list (as JSON).
- Public verification endpoint: `GET /api/raffle/:tournamentId/verify`

### Admin Workflow

1. Tournament completes and all scoring is finalized.
2. Admin calls `POST /api/admin/raffle/:id/compute` — populates ticket counts and eligibility.
3. Admin selects a future Bitcoin block hash (announced publicly before the block is mined, e.g. via [mempool.space](https://mempool.space)).
4. Admin calls `POST /api/admin/raffle/:id/draw` with the block hash and prize count.
5. Only **one draw per tournament** is permitted. Use `POST /api/admin/raffle/:id/reset` to clear a draw before re-drawing if needed.
6. Winners are marked in `raffle_results` and the draw audit trail is persisted.
7. Anyone can verify via `GET /api/raffle/:tournamentId/verify`.

### Frontend Access

**Raffle Page** (`/raffle/:tournamentId`):

The raffle page displays ticket counts and eligibility status for all participants. It is accessible from the tournament page action bar (alongside Leaderboard, Analytics, and Categories). The page works in two states:

- **Pre-draw**: Shows ticket counts, CPI scores, quest points, and eligibility status for every wallet. The status column displays `TOP 30%` (excluded), `ELIGIBLE`, `<10 TRADES` (excluded), or `0 TICKETS`.
- **Post-draw**: Additionally highlights winners with a `WINNER` badge.

A wallet search input allows participants to find their row instantly (exact match, scrolls to and highlights the row).

The results table uses tie-aware competition ranking and renders in server-provided order (`finalScore DESC, wallet ASC`) with no client-side re-sorting.

**Badge Grid** (`/categories/:tournamentId?tab=leverage_master_long&wallet=xxx`):

The leverage quest badge grid shows real-time step completion for a specific wallet. The wallet is passed via the `?wallet=` URL query parameter. When a wallet is provided:

1. The page calls `GET /api/quests/:tournamentId/:wallet` to fetch quest progress.
2. The badge grid displays the appropriate boolean array (`long` or `short`) based on the active tab.
3. If no wallet is provided, or no quest data exists, the grid defaults to all-empty (10 uncompleted steps).

### Top 30% Determination

The top 30% cutoff uses competition ranking on the final composite score (CPI + quest points). Tied wallets share the same rank, and `Math.ceil(walletCount × 0.30)` determines the cutoff index.


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

## Raffle System — Provably Fair Draw

The Gauntlet includes a weighted raffle for non-podium participants. The draw is deterministic and publicly verifiable — anyone can independently reproduce the results using the published algorithm and inputs.

### Eligibility

After a tournament completes, raffle eligibility is computed per-wallet:

- **Minimum activity**: ≥10 closed positions on Adrena during the tournament
- **Top 30% excluded**: Wallets ranked in the top 30% by final score receive skill-based prizes instead and are excluded from the raffle pool
- Must have at least 1 ticket (see below)

### Ticket Computation

Each eligible wallet receives tickets based on two factors:

```
tickets = floor(CPI × 0.5) + floor(questPoints × 20)
```

- **CPI contribution**: A player with CPI 60 gets 30 tickets from performance
- **Quest contribution**: A player with 3 quest points gets 60 tickets from engagement
- Higher ticket counts = higher probability of winning, but it's still random

Tickets are computed via the **Compute Raffle** admin action after final scoring.

### The Draw: Bitcoin Block Hash Seeding

The draw uses a Bitcoin block hash as the randomness source. The process:

1. **Pre-commitment**: Before the block is mined, the admin announces which future Bitcoin block number will be used (e.g. "Block 944,200"). This prevents anyone from choosing a favorable hash.
2. **Block mined**: Once the target block is mined, its hash is publicly visible on any Bitcoin explorer (e.g. [mempool.space](https://mempool.space)).
3. **Seed extraction**: The first 8 hex characters of the block hash are converted to a 32-bit unsigned integer. This becomes the PRNG seed.

```
Example:
  Block hash: 0000000000000000000053f74eb4e9a1049c7eb095a05e46b2de79440d6a6054
  Seed chars: 00000000
  Seed value: 0 → parseInt("00000000", 16)
```

### PRNG: Mulberry32

The seed drives a **Mulberry32** pseudo-random number generator — a deterministic 32-bit PRNG that produces a sequence of floats in [0, 1) from any given seed. The same seed always produces the exact same sequence.

### Weighted Selection Without Replacement

The draw loop:

1. Sort the eligible pool alphabetically by wallet address (deterministic ordering)
2. Sum all tickets to get `totalWeight`
3. Generate a random float via Mulberry32 → multiply by `totalWeight` to get a target
4. Walk through the sorted pool, subtracting each wallet's ticket count from the target
5. When the target reaches ≤ 0, that wallet wins
6. Remove the winner from the pool (no replacement) and repeat for the next prize

This ensures wallets with more tickets have proportionally higher odds, while the alphabetical sort guarantees that database query order never affects results.

### Verification

After a draw, anyone can verify it:

1. Read the stored block hash and eligible pool from the database
2. Re-run the exact same algorithm: seed → Mulberry32 → sorted pool → weighted draw
3. Compare the reproduced winners against the stored winners

The **Verify Draw** action does exactly this. If all positions match, the draw is confirmed authentic. Any tampering would produce mismatches.

### Audit Trail

Every draw is persisted in the `raffle_draws` table:
- `blockHash`: The Bitcoin block hash used
- `seed`: The derived 32-bit integer seed
- `eligibleCount`: Number of wallets in the pool
- `totalTickets`: Sum of all tickets
- `winnerCount`: Number of winners drawn
- `winners`: Ordered array of winning wallet addresses

---

## Future Integration Paths

- **Frontend embedding**: The bracket view could be embedded directly in Adrena's trading interface via iframe or as a React component library.
- **Streaming API**: If Adrena ships their planned streaming service, the engine could switch from API polling to real-time event streams for live score updates.
- **Cross-protocol tournaments**: The scoring engine's modular design allows swapping the data source. A future version could score traders across multiple Solana perp DEXes simultaneously.

