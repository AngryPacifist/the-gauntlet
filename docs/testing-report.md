# Testing Report

## Overview

Testing of the Adrena: The Gauntlet engine against live data from the Adrena API. This report covers both unit-level engine validation and a **small-group test competition** using 30 real Adrena traders sourced from the Mutagen leaderboard.

Conducted March 8, 2026.

---

## Environment

- Backend: Node.js + Express, port 3001
- Database: PostgreSQL (Neon)
- Adrena API: `https://datapi.adrena.trade` (live production data)
- Wallet source: Adrena Mutagen Leaderboard (top 30 all-time traders)

---

## Test 1: Engine Validation (Unit-Level)

7 out of 7 tests passed.

| Test | Result | Details |
|------|--------|---------|
| API Health Check | Pass | Backend responsive |
| Create Tournament | Pass | Tournament #4 created |
| Register Wallet (live API) | Pass | Wallet eligible with 30+ closed positions |
| Duplicate Registration | Pass | Correctly rejected |
| Minimum Wallet Guard | Pass | "Need at least 2 eligible traders. Found 1." |
| Admin Auth Rejection | Pass | 401 returned without secret |
| Invalid Wallet Rejection | Pass | "Invalid Solana wallet address" |

---

## Small-Group Test: Full Tournament Simulation (30 Wallets)

### Registration

- **29 out of 30** wallets eligible (97% pass rate)
- 1 wallet rejected: 0 closed trades found
- Validation performed against live Adrena API position data

### Tournament Structure

- **4 brackets** of 7-8 traders each
- Round window: 1 year of historical data (backdated for simulation)
- All 29 traders scored successfully

### Round 1 Results — "First Blood"

**Bracket 1:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| dutoz9dc3E.. | 60.9 | 35.7 | 79.0 | 63.5 | 85.0 | Advanced |
| 59k6t2RKY9.. | 60.4 | 36.1 | 77.9 | 62.0 | 85.0 | Advanced |
| 6iGVCaVPn1.. | 55.8 | 36.3 | 76.7 | 44.6 | 85.0 | Advanced |
| CDUwP2FrQB.. | 54.9 | 35.6 | 77.6 | 41.2 | 85.0 | Advanced |
| A6ELwd76fH.. | 44.6 | 36.6 | 76.0 | 0.0 | 85.0 | Eliminated |
| 3NCrJhLN62.. | 37.3 | 34.0 | 44.5 | 0.0 | 95.0 | Eliminated |
| 7QYoineP55.. | 25.9 | 31.7 | 5.5 | 0.0 | 90.0 | Eliminated |
| sigMag9SUG.. | 25.1 | 31.0 | 0.0 | 0.0 | 95.0 | Eliminated |

**Bracket 2:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| 4PcPViGTjh.. | 59.5 | 34.8 | 81.0 | 57.4 | 85.0 | Advanced |
| 4QLQUhJEqM.. | 59.2 | 35.1 | 80.5 | 56.1 | 85.0 | Advanced |
| 7XfwQavG7r.. | 58.6 | 36.0 | 78.1 | 54.9 | 85.0 | Advanced |
| C9jxD53Thg.. | 55.2 | 35.4 | 74.1 | 46.2 | 85.0 | Advanced |
| 8anmrYFmdX.. | 45.8 | 34.6 | 77.6 | 0.0 | 95.0 | Eliminated |
| DaVA8ciisv.. | 30.6 | 34.5 | 17.1 | 0.0 | 95.0 | Eliminated |
| 8umPs96cv2.. | 26.0 | 35.7 | 0.0 | 0.0 | 90.0 | Eliminated |
| 2o1odPv3HB.. | 21.8 | 21.6 | 0.0 | 0.0 | 95.0 | Eliminated |

**Bracket 3:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| ErVgLQB4hw.. | 69.0 | 35.0 | 78.5 | 91.8 | 95.0 | Advanced |
| 4N69yzFFVr.. | 59.9 | 35.9 | 77.0 | 61.4 | 85.0 | Advanced |
| 56yW76VPSv.. | 51.7 | 36.3 | 77.3 | 27.5 | 85.0 | Advanced |
| B3qwaaDGVr.. | 49.3 | 38.2 | 78.5 | 14.2 | 85.0 | Advanced |
| GZXqnVpZuy.. | 47.1 | 30.9 | 91.4 | 0.0 | 90.0 | Eliminated |
| 6ALGMay8Am.. | 32.1 | 28.2 | 32.1 | 0.0 | 95.0 | Eliminated |
| HjcswYCPRK.. | 24.5 | 31.4 | 0.0 | 0.0 | 90.0 | Eliminated |
| DWcFRJrpzs.. | 23.7 | 29.2 | 0.0 | 0.0 | 90.0 | Eliminated |

**Bracket 4:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| HZHXUquiJD.. | 60.3 | 35.1 | 80.8 | 60.2 | 85.0 | Advanced |
| Am1B44zvUo.. | 59.3 | 36.2 | 79.1 | 56.3 | 85.0 | Advanced |
| 8EJMQy74GJ.. | 58.5 | 35.7 | 77.3 | 55.9 | 85.0 | Advanced |
| F179GtjoSK.. | 56.6 | 35.9 | 77.6 | 64.8 | 56.3 | Eliminated |
| EgDYVEsGJt.. | 30.7 | 33.2 | 19.4 | 0.0 | 95.0 | Eliminated |

### Elimination Summary

- **15 advanced** to Round 2 "The Crucible"
- **14 eliminated**
- Round 3 created as next active round

---

## Score Analysis

### Score Distribution

| Metric | Min | Max | Mean | Observations |
|--------|-----|-----|------|-------------|
| CPI | 21.8 | 69.0 | ~46 | Good differentiation between traders |
| PnL | 21.6 | 38.2 | ~34 | Narrow range — most traders moderately profitable |
| Risk | 0.0 | 91.4 | ~48 | Widest variance — clear separation between disciplined and reckless |
| Consistency | 0.0 | 91.8 | ~27 | Binary split: consistent traders score 40-92, sporadic ones score 0 |
| Activity | 56.3 | 95.0 | ~88 | High baseline — expected since these are leaderboard traders |

### Scoring Fairness Assessment

1. **The CPI formula differentiates skill from luck.** Traders with similar PnL (34-36 range) are separated by risk management and consistency. `ErVgLQB4hw` leads at 69.0 CPI not because of highest returns but because of the best consistency score (91.8).

2. **Risk penalties work as intended.** Traders like `sigMag9SUG` (Risk: 0.0) and `7QYoineP55` (Risk: 5.5) were heavily penalized for liquidations and high leverage, despite having decent PnL and activity.

3. **Consistency scores create a clear tier break.** Traders who closed positions across multiple days get consistency credit (40-92 range). Single-day or sporadic traders get 0.0. This rewards sustained engagement over lucky single trades.

4. **One anomaly worth noting:** `F179GtjoSK` was eliminated in Bracket 4 despite having the highest consistency in that bracket (64.8) because of a lower activity score (56.3 vs 85.0). The activity weight (15%) was enough to offset consistency (25%). In a real tournament, this trader might feel the elimination was unfair. Consider whether the activity floor should be higher, or whether activity weight should be reduced.

---

## Bugs Found and Fixed

### 1. Position Status Value Mismatch (Critical)

The Adrena API returns `"close"` and `"liquidate"`, not `"closed"` and `"liquidated"`. All status checks in `types.ts`, `scoring-engine.ts`, and `tournament-manager.ts` were silently wrong.

### 2. Round Window Filtering (Found During Simulation)

`computeRoundScores` filters positions by round window. Newly created rounds have `startTime=now` and `endTime=now+72h`, so historical positions are excluded. For simulation testing with historical data, a backtest mode was implemented.

**Fix:** Added `useHistoricalWindow` config flag. When enabled, the scoring engine uses a configurable historical window (default: 90 days) instead of the round's time window, allowing simulation with real historical data.

---

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/simulated-tournament-test.ts` | Engine validation (7 unit tests) |
| `scripts/full-tournament-test.ts` | Full tournament simulation (30 wallets, live data) |

Output files:
- `scripts/test-output.txt` — Engine validation results
- `scripts/tournament-output.txt` — Full simulation results
- `test-results.json` — Structured engine validation data

---

## Iteration Recommendations

Based on the small-group test results, the following iterations are recommended for production deployment:

### Scoring Weight Adjustment

**Current:** PnL 35%, Risk 25%, Consistency 25%, Activity 15%
**Recommended:** PnL 35%, Risk 25%, Consistency 30%, Activity 10%

Rationale: Activity scores clustered at 85-95 across nearly all traders, providing little differentiation. Redistributing 5% from Activity to Consistency better rewards the skill that most distinguished top performers from eliminated ones in our test.

### Anomaly Resolution

Trader `F179GtjoSK` was eliminated despite having the highest consistency in their bracket (64.8) because of low activity (56.3). This created a perceived fairness issue. Two options:

1. **Raise the activity floor** to 70 — ensures active traders aren't penalized by a wide variance in the activity score
2. **Reduce activity weight** (see above) — diminishes the impact of activity variance on final ranking

Recommendation: Option 2 (weight reduction) addresses the root cause without introducing arbitrary floors.

### Edge Case Coverage

The simulation revealed edge cases that should be handled before production:

| Edge Case | Current Behavior | Recommended |
|-----------|-----------------|-------------|
| Zero trades in a round | CPI defaults to baseline scores | Add explicit "no activity" warning in UI |
| All positions liquidated | Risk score = 0, PnL score varies | Correct — no change needed |
| Single position only | Consistency = full base (StdDev=0) | Consider adding minimum trade count per round |
| Odd bracket sizes | Last bracket gets fewer traders | Correct — handled by merge logic |

### Live Pilot Recommendation

The simulation used historical data via backtest mode. Before launching a production tournament:

1. **Recruit 16-32 volunteers** from the Adrena community (Discord, Twitter)
2. **Run a 1-round pilot** (72 hours) with real-time scoring
3. **Collect feedback** on: scoring fairness, UI clarity, elimination experience
4. **Iterate** on weights and thresholds based on pilot results

---

## Addendum: Scoring Formula Changes (Post-Test, March 11, 2026)

> **Important:** The test results above are unmodified and reflect the scoring engine as it existed on March 8, 2026. The following changes were made **after** the test was conducted, based on feedback from the Adrena team (ZeDef). These changes have **not been validated with a new test run yet.**

| Component | At Time of Test | Changed To | Rationale |
|-----------|----------------|------------|-----------|
| **Registration** | Eligibility checks (min trades, max inactivity) | Zero-barrier sign-up (any wallet) | Maximize participant pool |
| **PnL denominator** | `collateral_amount` | `entry_size × entry_price` (USD exposure) | Collateral is mutable mid-trade |
| **Risk threshold** | 10x leverage | 30x (configurable) | Respects Adrena's high-leverage culture |
| **Consistency** | `100 - StdDev(daily ROIs) × 4` | Profitable days ratio (0-80) + win rate bonus (0-20) | Std-dev penalized big winning days |
| **Activity weights** | Count 50%, Volume 30%, Variety 20% | Count 30%, Volume 30%, Variety 40% | Variety drives engagement across all assets |
| **Asset count** | Hardcoded 4 | Configurable `supportedAssetCount` | Future-proofs for new assets |
| **Min collateral** | $10 | $25 | Higher floor reduces dust trade noise |
| **Consolation brackets** | Not implemented | "Fallen Fighters" bracket for eliminated traders | Maintains engagement after elimination |

A new test run using the updated scoring engine is required before production deployment.
