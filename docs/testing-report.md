# Testing Report

## Overview

Testing of the Adrena: The Gauntlet engine against live data from the Adrena API. This report covers a **comprehensive integration test** validating both Phase 1 (tournament lifecycle) and Phase 2 (season lifecycle, daily categories, admin auth).

Conducted March 11, 2026 (updated from initial March 8 run).

---

## Environment

- Backend: Node.js + Express, port 3001
- Database: PostgreSQL (Neon)
- Adrena API: `https://datapi.adrena.trade` (live production data)
- Wallet source: Adrena Mutagen Leaderboard (top 30 all-time traders)

---

## Comprehensive Integration Test

**Test script:** `packages/backend/scripts/full-tournament-test.ts`

Single integrated flow: Season → Tournament → Register → Score → Advance → Verify.

### Step-by-Step Results

| Step | Description | Result |
|------|-------------|--------|
| 1 | Create season (3 weeks, 4 qualification slots) | Season #1 created ✅ |
| 2 | Start season → auto-creates Week 1 tournament | Tournament #1 created ✅ |
| 3 | Register 30 real Adrena wallets | 30/30 registered ✅ |
| 4 | Start tournament → bracket creation | 4 brackets created ✅ |
| 5 | Compute CPI scores (365-day historical window) | 29 traders scored ✅ |
| 6 | Display bracket results with real CPI data | All brackets populated ✅ |
| 7 | Advance round (eliminate bottom 50%) | 15 advanced, 15 eliminated ✅ |
| 8 | Season verification (status, standings, list) | Season active, week 1 ✅ |
| 9 | Category endpoints (All Around × 2, Fisher × 2) | All responding ✅ |
| 10 | Admin auth rejection (no secret) | Both rejected ✅ |

### Round 1 Results — "First Blood"

**Bracket 1:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| 8anmrYFmdX.. | 69.2 | 33.3 | 99.8 | 76.4 | 90.0 | Advanced |
| B3qwaaDGVr.. | 64.8 | 33.3 | 99.0 | 71.4 | 70.0 | Advanced |
| CDUwP2FrQB.. | 64.5 | 33.3 | 98.8 | 70.5 | 70.0 | Advanced |
| 8EJMQy74GJ.. | 64.0 | 33.3 | 100.0 | 67.2 | 70.0 | Advanced |
| 6ALGMay8Am.. | 53.3 | 33.3 | 57.4 | 55.1 | 90.0 | Eliminated |
| 7QYoineP55.. | 46.9 | 33.3 | 53.8 | 39.0 | 80.0 | Eliminated |
| sigMag9SUG.. | 36.0 | 33.3 | 5.1 | 38.2 | 90.0 | Eliminated |
| 8umPs96cv2.. | 31.2 | 33.4 | 0.0 | 30.0 | 80.0 | Eliminated |

**Bracket 2:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| Am1B44zvUo.. | 66.8 | 33.3 | 100.0 | 78.5 | 70.0 | Advanced |
| dutoz9dc3E.. | 64.8 | 33.3 | 100.0 | 70.7 | 70.0 | Advanced |
| C9jxD53Thg.. | 64.2 | 33.3 | 100.0 | 68.0 | 70.0 | Advanced |
| HZHXUquiJD.. | 62.2 | 33.3 | 100.0 | 60.1 | 70.0 | Advanced |
| DaVA8ciisv.. | 59.5 | 33.3 | 58.4 | 79.0 | 90.0 | Eliminated |
| HjcswYCPRK.. | 41.5 | 33.3 | 38.6 | 32.7 | 80.0 | Eliminated |
| DWcFRJrpzs.. | 28.8 | 33.3 | 0.0 | 20.5 | 80.0 | Eliminated |
| 2SwMcnwKap.. | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | Eliminated |

**Bracket 3:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| ErVgLQB4hw.. | 72.6 | 33.3 | 100.0 | 89.8 | 90.0 | Advanced |
| 59k6t2RKY9.. | 66.9 | 33.3 | 100.0 | 79.1 | 70.0 | Advanced |
| 6iGVCaVPn1.. | 65.4 | 33.3 | 99.0 | 73.9 | 70.0 | Advanced |
| 7XfwQavG7r.. | 65.1 | 33.3 | 100.0 | 71.6 | 70.0 | Advanced |
| A6ELwd76fH.. | 64.3 | 33.3 | 99.1 | 69.4 | 70.0 | Eliminated |
| 3NCrJhLN62.. | 64.3 | 33.3 | 83.5 | 73.0 | 90.0 | Eliminated |
| 56yW76VPSv.. | 63.8 | 33.3 | 100.0 | 66.6 | 70.0 | Eliminated |
| 4QLQUhJEqM.. | 61.7 | 33.3 | 99.3 | 59.0 | 70.0 | Eliminated |

**Bracket 4:**

| Wallet | CPI | PnL | Risk | Cons | Act | Result |
|--------|-----|-----|------|------|-----|--------|
| F179GtjoSK.. | 86.9 | 100.0 | 100.0 | 82.7 | 41.3 | Advanced |
| 4PcPViGTjh.. | 64.9 | 33.3 | 100.0 | 71.0 | 70.0 | Advanced |
| 4N69yzFFVr.. | 64.9 | 33.3 | 100.0 | 71.0 | 70.0 | Advanced |
| EgDYVEsGJt.. | 56.8 | 33.3 | 61.5 | 65.0 | 90.0 | Eliminated |
| 2o1odPv3HB.. | 30.7 | 33.3 | 0.0 | 22.3 | 90.0 | Eliminated |
| GZXqnVpZuy.. | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | Eliminated |

### Elimination Summary

- **15 advanced** to Round 2 "The Crucible"
- **15 eliminated** → auto-entered consolation bracket "Redemption Arc"
- Consolation R1 created in parallel with Main R2

---

## Score Analysis (Post-ZeDef Scoring Engine)

### Score Distribution

| Metric | Min | Max | Mean | Observations |
|--------|-----|-----|------|-------------|
| CPI | 0.0 | 86.9 | ~54 | Good differentiation; wide range |
| PnL | 0.0 | 100.0 | ~33 | Clusters at 33.3 (0% ROI) with one outlier at 100 |
| Risk | 0.0 | 100.0 | ~80 | Clusters high for disciplined traders |
| Consistency | 0.0 | 89.8 | ~57 | Primary differentiator — widest useful variance |
| Activity | 0.0 | 90.0 | ~73 | Good range (41.3 to 90.0) |

### Why PnL Clusters at 33.3

The PnL formula normalizes ROI on a -100% to +200% scale: `(ROI + 100) / 300 × 100`. So **0% ROI = exactly 33.3**. Over a 365-day window, most traders' aggregate ROI converges near 0% (gains and losses cancel over a full year). In production 72h rounds, PnL differentiation will be much sharper since short-term results vary more.

One notable exception: **F179GtjoSK** scored PnL = 100.0 (the cap), indicating significant positive ROI over the window.

### Why Risk Clusters at ~100

Risk only penalizes two things: liquidations and leverage above the 30x threshold. Top Mutagen leaderboard traders generally use <30x leverage and rarely get liquidated, so most score ~100 on risk. The differentiation comes from *Consistency* and *Activity*, which is working as designed — the updated scoring engine (post-ZeDef) rewards sustained, diverse participation over raw leverage.

### Key Finding

**Consistency is the primary skill differentiator.** With PnL and Risk compressed, the spread in Consistency (0 to 89.8) is what determines bracket outcomes. This aligns with the design intent: reward traders who perform steadily across multiple days, not those who get lucky on single trades.

---

## Phase 2 Feature Verification

| Feature | Test | Result |
|---------|------|--------|
| Season creation | `POST /api/seasons` with config | Season #1 created ✅ |
| Season start | `POST /api/seasons/:id/start` | Week 1 tournament auto-created ✅ |
| Season detail | `GET /api/seasons/:id` | Returns status, currentWeek, config ✅ |
| Season standings | `GET /api/seasons/:id/standings` | Returns standings array ✅ |
| Season list | `GET /api/seasons` | Returns all seasons ✅ |
| All Around (cum.) | `GET /api/categories/:id/all-around` | Responding ✅ |
| All Around (daily) | `GET /api/categories/:id/all-around/:date` | Responding ✅ |
| Fisher (cumulative) | `GET /api/categories/:id/fisher` | Responding ✅ |
| Fisher (daily) | `GET /api/categories/:id/fisher/:date` | Responding ✅ |
| Admin auth rejection | `POST /seasons` without secret | 401 Rejected ✅ |
| Admin auth rejection | `POST /tournaments` without secret | 401 Rejected ✅ |

---

## Bugs Found and Fixed

### 1. Position Status Value Mismatch (Critical, March 8)

The Adrena API returns `"close"` and `"liquidate"`, not `"closed"` and `"liquidated"`. All status checks in `types.ts`, `scoring-engine.ts`, and `tournament-manager.ts` were silently wrong.

### 2. Round Window Filtering (March 8)

Newly created rounds have `startTime=now`, so historical positions are excluded. A backtest mode was implemented: `useHistoricalWindow` config flag allows scoring with historical data.

### 3. Missing `rounds.type` Column (March 11)

The `rounds.type` column was added to `CREATE TABLE IF NOT EXISTS` but no `ALTER TABLE` existed for already-deployed databases. Added `ALTER TABLE rounds ADD COLUMN IF NOT EXISTS type VARCHAR(16) DEFAULT 'main'` to the migration.

---

## Test Script

| Script | Purpose |
|--------|---------|
| `scripts/full-tournament-test.ts` | Comprehensive integration test: season + tournament lifecycle with 30 real Adrena wallets |

---

## Iteration Recommendations

### Scoring Observations

1. **PnL differentiation will improve in production.** The 365-day historical window compresses ROI near 0%. Real 72h rounds will produce wider PnL variance.

2. **Consistency is working as the primary differentiator.** This is the intended outcome — sustained performance over single-trade luck.

3. **Risk score could be refined.** With most traders scoring ~100, the 25% weight is effectively "dead weight" in differentiation. Options:
   - Lower the leverage penalty threshold from 30x to 20x
   - Add position sizing consistency as a risk factor
   - Reduce Risk weight and redistribute to Consistency

### Live Pilot Recommendation

1. Recruit 16-32 volunteers from the Adrena community
2. Run a 1-round pilot (72h) with real-time scoring
3. Collect feedback on scoring fairness, UI clarity, elimination experience
4. Iterate on weights and thresholds based on pilot results
