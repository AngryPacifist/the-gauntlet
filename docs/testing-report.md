# Testing Report

## Overview

Testing of the Adrena: The Gauntlet engine against live data from the Adrena API.  
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

## Test 2: Full Tournament Simulation (30 Wallets)

### Registration

- **29 out of 30** wallets eligible (97% pass rate)
- 1 wallet rejected: 0 closed trades found
- Validation performed against live Adrena API position data

### Tournament Structure

- **4 brackets** of 7-8 traders each
- Round window: 1 year of historical data (backdated for simulation)
- All 29 traders scored successfully

### Round 1 Results — "The Drop"

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

- **15 advanced** to Round 2 "The Clash"
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

`computeRoundScores` filters positions by round window. Newly created rounds have `startTime=now` and `endTime=now+72h`, so historical positions are excluded. For simulation testing with historical data, an admin endpoint was added to backdate the round window.

**Fix:** Added `PATCH /api/admin/round/:roundId` to allow setting round start/end times.

---

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/simulated-tournament-test.ts` | Engine validation (7 unit tests) |
| `scripts/full-tournament-test.ts` | Full tournament simulation (30 wallets, live data) |
| `scripts/discover-wallets.ts` | Wallet discovery utilities (unused in final run) |

Output files:
- `scripts/test-output.txt` — Engine validation results
- `scripts/tournament-output.txt` — Full simulation results
- `test-results.json` — Structured engine validation data

---

## Recommendations

1. **Source test wallets from within the Adrena community** for a live, real-time pilot tournament.
2. **Consider reducing activity weight** from 15% to 10%. Most active traders score 85-95, creating little differentiation. Redistributing that weight to consistency would better reflect skill.
3. **Add unit tests** for edge cases: zero-trade rounds, all-liquidated portfolios, single-position wallets.
4. **Monitor Adrena API stability.** The API returned 503 on `datapi.adrena.xyz` during early testing. The correct domain is `datapi.adrena.trade`.
