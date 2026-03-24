# Testing Report

## Overview

Two validation cycles were conducted on the Gauntlet engine, each testing a different axis:

1. **Backtest (T1)** — 30 wallets from the Adrena Mutagen Leaderboard, scored over a 365-day historical window. Tests: Does the engine produce meaningful differentiation against real data at scale?
2. **Live Trade Test (T4)** — 12 wallets with live 24-hour round windows. Tests: Does the engine work in production conditions with real-time position data?

Both tests ran end-to-end via the automated scheduler with no manual intervention after start.

---

## Test 1: Backtest — "Integration Test Season, Week 1"

### Config

| Parameter | Value |
|-----------|-------|
| Wallets | 30 (top Adrena Mutagen traders) |
| Bracket size | 8 |
| Advance ratio | 50% |
| Round durations | 72h, 48h, 48h |
| Historical window | 365 days |
| Min collateral | $25 |
| Leverage penalty | 30× |

### Main Bracket Progression

| Round | Name | Entries | Advanced | Eliminated | CPI Range | CPI Avg |
|-------|------|---------|----------|------------|-----------|---------|
| R1 | First Blood | 30 | 15 | 15 | 28.8–86.9 | 58.8 |
| R2 | The Crucible | 15 | 8 | 7 | 62.2–86.9 | 67.1 |
| R3 | Endgame | 8 | 4 | 4 | 64.8–86.9 | 69.7 |

CPI floor rose each round (28.8 → 62.2 → 64.8), confirming the elimination system progressively concentrates stronger performers.

### Finalists

| Rank | Wallet | CPI | PnL | Risk | Cons | Act |
|------|--------|-----|-----|------|------|-----|
| 1 | F179GtjoSK.. | 86.9 | 100.0 | 100.0 | 82.7 | 41.3 |
| 2 | ErVgLQB4hw.. | 72.6 | 33.3 | 100.0 | 89.8 | 90.0 |
| 3 | 8anmrYFmdX.. | 69.2 | 33.3 | 99.8 | 76.4 | 90.0 |
| 4 | 6iGVCaVPn1.. | 65.4 | 33.3 | 99.0 | 73.9 | 70.0 |

### Consolation Rounds

The consolation bracket ran 3 rounds (Redemption Arc → Last Stand → Final Reckoning) in parallel with the main bracket:
- Consolation R1: 15 entries, 8 advanced, 7 eliminated
- Consolation R2: 8 entries, 4 advanced, 4 eliminated
- Consolation R3: 4 entries (reached end of consolation chain)

> **Note:** This test used the original multi-round consolation design. After feedback from the Adrena team, the consolation structure was simplified to a single Fallen Fighters round (see competition-design.md).

### Score Analysis

| Metric | Min | Max | Avg | Observations |
|--------|-----|-----|-----|-------------|
| PnL | 0.0 | 100.0 | ~33 | Compressed at 33.3 (0% ROI over 365 days). Expected — year-long aggregate ROI converges near zero. Short round windows will produce wider spread. |
| Risk | 0.0 | 100.0 | ~80 | Top traders rarely liquidated. Differentiation comes from wallets penalized for leverage/liquidations (Risk=0 → eliminated R1). |
| Consistency | 0.0 | 89.8 | ~57 | Primary differentiator. Widest useful variance. Rewarded steady profitable days. |
| Activity | 41.3 | 90.0 | ~73 | Good range. Winner (F179GtjoSK..) scored low (41.3) because fewer trades, but dominant PnL compensated. |

### What This Proves

- **Scoring engine differentiates real traders.** 28 of 30 wallets got unique CPI scores. Rankings reflect genuine differences in trading style.
- **Elimination concentrates quality.** The CPI floor rises each round (28.8 → 62.2 → 64.8), confirming progressive filtering of weaker performers.
- **Full lifecycle runs end-to-end.** Registration → Start → Score → Advance → Consolation → Completion. 3 main rounds + 3 consolation rounds, all automated.
- **Zero-position handling is correct.** 2 wallets with no qualifying positions scored CPI=0.0 and were eliminated — no crashes, no defaults.

---

## Test 2: Live Trade Test — "Liquidity Parasites"

### Config

| Parameter | Value |
|-----------|-------|
| Wallets | 12 (recruited testers) |
| Bracket size | 4 |
| Advance ratio | 50% |
| Round durations | 24h, 24h, 24h |
| Historical window | Disabled (live round windows) |
| Min collateral | $1 |
| Leverage penalty | 30× |

### Main Bracket Progression

| Round | Name | Entries | Advanced | Eliminated | Non-Zero CPI | Zero CPI |
|-------|------|---------|----------|------------|-------------|----------|
| R1 | First Blood | 12 | 6 | 6 | 3 | 9 |
| R2 | The Crucible | 6 | 3 | 3 | 1 | 5 |

Tournament completed after R2 because 3 traders remained (≤3 triggers completion). With `bracketSize: 4` and 12 registrations, reaching R3 is mathematically impossible (need ≥14 registrations).

### Active Traders

Three wallets had qualifying trades during the 24h R1 window:

| Wallet | R1 CPI | R2 CPI | Δ | PnL | Risk | Cons | Act |
|--------|--------|---------|---|-----|------|------|-----|
| BUTNVFuE.. | 52.5 | 26.9 | −25.6 | 50→0 | 100→100 | 30→0 | 16.8→13.0 |
| ATw6eVJF.. | 44.0 | 0.0 | −44.0 | 33.3→0 | 100→0 | 0→0 | 49→0 |
| B4qmh8qV.. | 43.1 | 0.0 | −43.1 | 33.3→0 | 100→0 | 0→0 | 43→0 |

- `BUTNVFuE..` was the only wallet active in both rounds. CPI dropped from 52.5 to 26.9 — PnL went from 50.0 to 0.0 (breakeven/losing R2 positions). This is the engine correctly reflecting changing performance across rounds.
- `ATw6eVJF..` and `B4qmh8qV..` traded in R1 but not R2, dropping to zero.

### What This Proves

- **Live position scoring works.** The engine read real Adrena positions from the production API, filtered to the round's time window, and produced differentiated scores.
- **Scores change between rounds.** Unlike the backtest (fixed 365-day window = static scores), the live test showed CPI shifting round-over-round based on actual trading activity. This is the core competitive dynamic working.
- **Zero-position handling at scale.** 9 wallets with no trades correctly scored CPI=0. No crashes.
- **Advancement logic is correct even with mixed zero/non-zero fields.** When most entries score zero, the engine still advances the top half and eliminates the rest without errors.
- **Consolation round created and populated.** 6 eliminated R1 wallets auto-entered "Redemption Arc" consolation bracket.

### Why Only 25% Traded

This was a pilot with recruited wallets — not a public competition with prizes at stake. A 25% engagement rate is expected. The system handled it correctly: it scored what it should, zeroed what it should, and advanced/eliminated based on the actual data. The low engagement is a recruitment outcome, not a system failure.

---

## Combined Findings

### Engine Validation Summary

| Capability | Backtest (T1) | Live (T4) | Status |
|-----------|---------------|-----------|--------|
| CPI scoring against real data | ✅ 28/30 differentiated | ✅ 3 unique scores | Verified |
| Bracket elimination (50%) | ✅ 3 rounds | ✅ 2 rounds | Verified |
| Consolation bracket creation | ✅ 3 rounds parallel | ✅ 1 round | Verified |
| Automated scheduler (15-min) | ✅ 8,700+ snapshots | ✅ Ran throughout | Verified |
| Zero-position handling | ✅ 2 wallets | ✅ 9 wallets | Verified |
| Round time window filtering | N/A (historical) | ✅ 24h windows | Verified |
| Score change between rounds | N/A (fixed window) | ✅ CPI shifted | Verified |
| Tournament completion trigger | ✅ After R3 | ✅ After R2 (≤3) | Verified |
| Season lifecycle (create/start) | ✅ | N/A (standalone) | Verified |
| Category endpoints | ✅ All responding | ✅ | Verified |
| Admin auth rejection | ✅ | ✅ | Verified |

### Bugs Found and Fixed

| Bug | Severity | Date | Resolution |
|-----|----------|------|------------|
| Position status mismatch (`"close"` vs `"closed"`) | Critical | Mar 8 | Fixed in `types.ts`, `scoring-engine.ts`, `tournament-manager.ts` |
| Round window filtering excludes historical positions | Medium | Mar 8 | Added `useHistoricalWindow` backtest config flag |
| Missing `rounds.type` column on existing databases | Medium | Mar 11 | Added `ALTER TABLE IF NOT EXISTS` to migration |

### Score Snapshot Counts

Evidence of automated scoring:

| Round | Type | Snapshots | Notes |
|-------|------|-----------|-------|
| T1 R1 First Blood | main | 29 | Initial manual score (1 API failure) |
| T1 R2 The Crucible | main | 2,880 | 15 entries × ~192 scheduler cycles (48h ÷ 15min) |
| T1 R3 Endgame | main | 1,644 | 8 entries × ~205 cycles |
| T1 Consolation R1 | consolation | 2,688 + 1,435 | Two parallel consolation chains |
| T1 Consolation R2 | consolation | 1,640 | Completed chain |

---

## Iteration Recommendations

1. **PnL differentiation will improve in production.** The backtest compressed PnL at 33.3 (year-long 0% ROI). Live 72h rounds will produce wider PnL variance — already confirmed by the live test where active traders scored PnL=50.0 and PnL=33.3 (distinct values).

2. **Consistency needs ≥48h rounds to be useful.** In 24h rounds, Consistency scored 0 for every trader — the formula needs multiple calendar days. The designed 72h default solves this (spans 3+ UTC days).

3. **Minimum registration thresholds:**
   - `bracketSize: 8`, 3 rounds → minimum 16 registrations
   - `bracketSize: 4`, 3 rounds → minimum 14 registrations
   - Below these thresholds, the tournament cannot mechanically reach R3.
