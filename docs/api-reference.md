# API Reference

Base URL: `http://localhost:3001/api`

All responses follow a consistent envelope:

```json
{
  "success": true,
  "error": null,
  "data": { ... }
}
```

On error:

```json
{
  "success": false,
  "error": "Description of what went wrong",
  "data": null
}
```

---

## Public Endpoints

### Health Check

```
GET /api/health
```

Returns the server status.

**Response:**
```json
{
  "success": true,
  "data": {
    "service": "adrena-the-gauntlet",
    "status": "healthy",
    "timestamp": "2026-03-08T05:00:00.000Z"
  }
}
```

---

### List Tournaments

```
GET /api/tournaments
```

Returns all tournaments, ordered by creation date (newest first).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Season 1",
      "status": "registration",
      "config": {
        "format": "bracket",
        "bracketSize": 8,
        "advanceRatio": 0.5,
        "roundDurations": [72, 48, 48],
        "minPositionCollateral": 25,
        "minTradeDurationSec": 120,
        "supportedAssetCount": 4,
        "prizeTable": {
          "totalPool": 100000,
          "currency": "ADX",
          "skillPrizes": [25000, 18000, 14000, 10000, 8000, 5000, 5000],
          "rafflePrizes": [5000, 5000, 5000],
          "tokens": [
            {
              "sponsor": "Adrena",
              "symbol": "ADX",
              "amount": 100000,
              "mint": null,
              "staticUsdPrice": null
            }
          ]
        }
      },
      "createdAt": "2026-03-08T04:00:00.000Z",
      "updatedAt": "2026-03-08T04:00:00.000Z"
    }
  ]
}
```

**`format` values**: `'bracket'` for the Gauntlet (elimination), `'rank_only'` for the Forge (flat leaderboard).

**`prizeTable` shape**:
- `tokens[]`: list of per-sponsor contributions. Each entry is one sponsor contributing one token. A sponsor contributing multiple tokens appears as multiple entries. Optional `mint` (SPL token mint pubkey for Jupiter pricing of custom tokens). Optional `staticUsdPrice` (admin-supplied USD per token, used only when both Pyth + Jupiter return null).
- `skillPrizes` and `rafflePrizes`: rank-weight ratios. Per-rank share of every token equals `(weight / totalWeight) × token.amount` where `totalWeight = sum(skillPrizes) + sum(rafflePrizes)`. For single-sponsor single-token tournaments, these can still be read as literal token amounts (math is identical).
- Legacy `totalPool` + `currency` fields kept for backward compat with older tournaments. New code paths read `tokens[]` and fall back to a synthesized `[{sponsor: 'Adrena', symbol: <currency>, amount: <totalPool>}]` when absent.

---

### Get Tournament

```
GET /api/tournaments/:id
```

Returns tournament details including rounds and registration counts.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Season 1",
    "status": "active",
    "config": { ... },
    "createdAt": "2026-03-08T04:00:00.000Z",
    "updatedAt": "2026-03-08T05:00:00.000Z",
    "rounds": [
      {
        "id": 1,
        "tournamentId": 1,
        "roundNumber": 1,
        "name": "First Blood",
        "type": "main",
        "startTime": "2026-03-08T05:00:00.000Z",
        "endTime": "2026-03-11T05:00:00.000Z",
        "status": "active"
      }
    ],
    "registrationCount": 24
  }
}
```

---

### Get Tournament Brackets

```
GET /api/tournaments/:id/brackets
```

Returns the most recent round and all its brackets with entries, sorted by CPI descending within each bracket.

**Response:**
```json
{
  "success": true,
  "data": {
    "round": {
      "id": 1,
      "tournamentId": 1,
      "roundNumber": 1,
      "name": "First Blood",
      "type": "main",
      "startTime": "...",
      "endTime": "...",
      "status": "active"
    },
    "brackets": [
      {
        "id": 1,
        "roundId": 1,
        "bracketNumber": 1,
        "entries": [
          {
            "id": 1,
            "bracketId": 1,
            "wallet": "AbcXyz...",
            "pnlScore": 72.5,
            "riskScore": 88.0,
            "consistencyScore": 65.3,
            "activityScore": 45.0,
            "cpiScore": 70.12,
            "eliminated": false,
            "advanced": false
          }
        ]
      }
    ]
  }
}
```

---

### Update Tournament

```
PUT /api/tournaments/:id
```

Updates a tournament's name and/or config. **Admin-only. Only works during `registration` status.**

**Headers:** `X-Admin-Secret: your-secret`

**Request body:**
```json
{
  "name": "Season 1 (updated)",
  "config": {
    "bracketSize": 16,
    "roundDurations": [48, 48, 48]
  }
}
```

Config overrides are merged with the existing config; you only need to send the fields you want to change.

**Response:** Returns the updated tournament object.

**Errors:**
- `401` if admin secret is missing/wrong
- `404` if tournament not found
- `409` if tournament is not in `registration` status

---

### Delete Tournament

```
DELETE /api/tournaments/:id
```

Deletes a tournament and **all associated data** (registrations, rounds, brackets, entries, score snapshots). **Admin-only. Works in any status.** Performs a full cascade delete in FK dependency order.

**Headers:** `X-Admin-Secret: your-secret`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Season 1",
    "deleted": true
  }
}
```

**Errors:**
- `401` if admin secret is missing/wrong
- `404` if tournament not found

---

### Register Wallet

```
POST /api/register
```

Registers a wallet for a tournament. Zero-barrier sign-up: any valid Solana wallet is accepted without eligibility checks.

**Request body:**
```json
{
  "tournamentId": 1,
  "wallet": "BVsfLRjj5LBYUxE39cr8uQF99BU1LxYUon4AqEEQhBxX"
}
```

**Success response (registered):**
```json
{
  "success": true,
  "data": {
    "registered": true
  }
}
```

**Success response (rejected):**
```json
{
  "success": true,
  "data": {
    "registered": false,
    "reason": "Wallet already registered"
  }
}
```

**Validation rules:**
- Wallet must be 32-44 characters (Solana base58 address format).
- Tournament must exist and be in `registration` status.
- Duplicate registrations are rejected.
- If the tournament belongs to a season, the wallet is also registered at the season level (auto-enrolled in future weeks).

---

### Get Registrations

```
GET /api/register/:tournamentId
```

Returns all registrations for a tournament.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tournamentId": 1,
      "wallet": "AbcXyz...",
      "registeredAt": "2026-03-08T04:30:00.000Z"
    }
  ]
}
```

---

### Get Bracket

```
GET /api/brackets/:id
```

Returns a single bracket with its entries, sorted by CPI descending.

---

### Get Trader Profile

```
GET /api/brackets/traders/:wallet?tournamentId=1
```

Returns a trader's performance across all rounds in a tournament.

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet": "AbcXyz...",
    "tournament": { "id": 1, "name": "Season 1" },
    "rounds": [
      {
        "roundNumber": 1,
        "roundName": "First Blood",
        "roundType": "main",
        "bracketNumber": 2,
        "scores": {
          "pnlScore": 72.5,
          "riskScore": 88.0,
          "consistencyScore": 65.3,
          "activityScore": 45.0,
          "cpiScore": 70.12
        },
        "eliminated": false,
        "advanced": true
      }
    ]
  }
}
```

---

### Get Leaderboard

```
GET /api/brackets/leaderboard/:tournamentId
```

Returns all participants ranked across the tournament. Sorting priority:
1. Active traders before eliminated traders.
2. Traders who survived more rounds rank higher.
3. Within the same round, sorted by CPI score.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRounds": 2,
    "entries": [
      {
        "wallet": "AbcXyz...",
        "cpiScore": 70.12,
        "pnlScore": 72.5,
        "riskScore": 88.0,
        "consistencyScore": 65.3,
        "activityScore": 45.0,
        "lastRound": 2,
        "eliminated": false,
        "advanced": true
      }
    ]
  }
}
```

---

### Get Tournament Analytics

```
GET /api/brackets/analytics/:tournamentId
```

Returns aggregate post-tournament analytics: per-round statistics, CPI score distribution, component insights (advanced vs eliminated), and top performers. Useful for analyzing completed tournaments.

**Response:**
```json
{
  "success": true,
  "data": {
    "tournament": {
      "id": 1,
      "name": "Season 1",
      "status": "completed",
      "totalRounds": 3,
      "totalTraders": 30,
      "totalRegistrations": 35
    },
    "roundStats": [
      {
        "roundNumber": 1,
        "roundName": "First Blood",
        "traderCount": 30,
        "eliminatedCount": 15,
        "advancedCount": 15,
        "avgCpi": 52.3,
        "minCpi": 18.7,
        "maxCpi": 82.1,
        "avgPnl": 45.2,
        "avgRisk": 68.4,
        "avgConsistency": 42.8,
        "avgActivity": 55.1
      }
    ],
    "scoreDistribution": [
      { "bucket": "0-10", "count": 2 },
      { "bucket": "10-20", "count": 5 },
      { "bucket": "20-30", "count": 8 }
    ],
    "componentInsights": {
      "advancedAvg": { "pnl": 58.3, "risk": 72.1, "consistency": 55.4, "activity": 62.0 },
      "eliminatedAvg": { "pnl": 32.1, "risk": 64.8, "consistency": 30.2, "activity": 48.5 }
    },
    "topPerformers": [
      {
        "wallet": "AbcXyz...",
        "cpiScore": 82.1,
        "roundNumber": 1,
        "roundName": "First Blood"
      }
    ]
  }
}
```

**Notes:**
- Returns empty arrays and `null` insights if no rounds have been scored yet.
- `componentInsights` is `null` if no entries have CPI > 0.
- `scoreDistribution` uses 10-point buckets from 0-10 through 90-100.
- `topPerformers` returns up to 5 entries, ranked by single-round CPI.

---

### The Forge: Merged Leaderboard

```
GET /api/tournaments/:id/forge
```

Returns the merged competition leaderboard combining CPI scores, quest points, and raffle ticket counts for all participants. Powers "The Forge" competition page.

**Response:**
```json
{
  "success": true,
  "data": {
    "tournament": { "id": 1, "name": "Season 1", "status": "active" },
    "totalParticipants": 50,
    "top30Cutoff": 15,
    "entries": [
      {
        "rank": 1,
        "wallet": "AbcXyz...",
        "cpiScore": 72.5,
        "pnlScore": 80.1,
        "riskScore": 68.3,
        "consistencyScore": 71.0,
        "activityScore": 55.2,
        "questPoints": 12,
        "finalScore": 84.5,
        "raffleTickets": 276,
        "isTopPercent": true
      }
    ]
  }
}
```

**Notes:**
- `isTopPercent` indicates whether the wallet is in the top 30% by final score.
- CPI sub-scores (`pnlScore`, `riskScore`, `consistencyScore`, `activityScore`) reflect the wallet's best bracket entry across all rounds.
- `finalScore = cpiScore + questPoints`.
- `raffleTickets = floor(cpiScore × 0.5) + floor(questPoints × 20)`.

---

### Tournament Payouts

```
GET /api/tournaments/:id/payouts
```

Final distribution list for a tournament: skill prizes (top % wallets) plus raffle winners. Designed for external distribution systems (e.g. Adrena's MrRewards keeper) to ingest the determinate result post-tournament. Public, no auth.

Each row carries both a legacy `amountADX` field (sum of any ADX token amounts in `tokens[]`, kept for backward compat) and a `tokens[]` array (the multi-token source of truth).

**Response:**
```json
{
  "success": true,
  "data": {
    "tournamentId": 1,
    "status": "completed",
    "complete": true,
    "prizeTable": {
      "tokens": [
        { "sponsor": "Adrena", "symbol": "ADX", "amount": 100000, "mint": null }
      ],
      "skillPrizes": [25000, 18000, 14000, 10000, 8000, 5000, 5000],
      "rafflePrizes": [5000, 5000, 5000],
      "totalPool": 100000,
      "currency": "ADX"
    },
    "raffleDraw": {
      "id": 4,
      "blockHash": "0000000000000000000102d0e2a8ffe31a90a02a5df70f5d9faeb0a0c2b33b12",
      "drawnAt": "2026-05-11T12:34:00.000Z"
    },
    "proRataScale": 1.0,
    "totalPayout": 100000,
    "rows": [
      {
        "wallet": "AyAd...",
        "amountADX": 25000,
        "tokens": [
          { "symbol": "ADX", "mint": null, "sponsor": "Adrena", "amount": 25000 }
        ],
        "category": "skill",
        "rank": 1,
        "drawPosition": null
      },
      {
        "wallet": "2Cdt...",
        "amountADX": 5000,
        "tokens": [
          { "symbol": "ADX", "mint": null, "sponsor": "Adrena", "amount": 5000 }
        ],
        "category": "raffle",
        "rank": null,
        "drawPosition": 1
      }
    ]
  }
}
```

**Notes:**
- `complete` is `true` only when `status === 'completed'` AND `rows` is non-empty. Polling signal for downstream consumers (poll the endpoint, act when `complete` flips to true).
- Skill rows have `category: 'skill'`, `rank: N`, `drawPosition: null`. Raffle rows have `category: 'raffle'`, `rank: null`, `drawPosition: 1/2/3/...`.
- Tie-handling matches the frontend's `prizesByRank` math exactly: tied wallets at rank R split the summed slot prizes across the group, preserving conservation.
- Per-rank skill share uses a geometric-decay curve extension when the top % count exceeds `skillPrizes.length` (so every top-% wallet gets a non-zero share), plus a pro-rata scale that boosts active wallets when the count is fewer than `skillPrizes.length` (so the configured pool always flows fully).
- For multi-token tournaments: every winner gets a proportional share of every token. `rank_N_share_of_token_T = (rank_weight / totalWeight) × pool_token_T`. MrRewards should consume `tokens[]` directly, not `amountADX`.
- For single-sponsor single-token tournaments (e.g. T1): `amountADX` works exactly as before. `tokens[]` is a single-entry array.

---

### Cumulative Leaderboard

```
GET /api/leaderboard
```

Bundled cumulative leaderboard payload powering the standalone `/leaderboard` page. Public, no auth. On-demand compute, memoized via a 5-min TTL cache at the service layer. Aggregates three views:

- **Tournament tab**: Top 10 of the current active tournament (or most-recent completed if none active). Format-agnostic, works for both Forge (rank_only) and Gauntlet (bracket).
- **Season tab**: Current active season's full standings (or most-recent completed/final season).
- **All-time tab**: Cross-tournament `finalScore` aggregation per wallet, capped at top 100. Spans all formats (Forge + Gauntlet) and includes Fallen Fighters participants.

**Response:**
```json
{
  "success": true,
  "data": {
    "current": {
      "tournament": { "id": 1, "name": "Forge Week 1", "status": "active", "format": "rank_only" },
      "topEntries": [
        { "rank": 1, "wallet": "AbcXyz...", "finalScore": 84.5, "cpiScore": 72.5, "questPoints": 12 }
      ]
    },
    "season": {
      "season": { "id": 1, "name": "Season 1", "currentWeek": 3, "status": "active" },
      "standings": [
        { "rank": 1, "wallet": "AbcXyz...", "totalPoints": 75, "weeksParticipated": 3, "bestPlacement": 1 }
      ]
    },
    "allTime": {
      "standings": [
        { "rank": 1, "wallet": "AbcXyz...", "totalFinalScore": 312.7, "tournamentsPlayed": 4 }
      ],
      "totalTournaments": 7
    }
  }
}
```

**Notes:**
- All three rankings use tie-aware competition ranking (1, 1, 3, 4...).
- Empty fields return as `null` (e.g. `current.tournament: null` if no tournaments exist).
- The Tournament tab is intentionally slim (top 10); the full per-tournament leaderboard is at `/leaderboard/:id`.

---

## Admin Endpoints

All admin endpoints require the `X-Admin-Secret` header matching the `ADMIN_SECRET` environment variable. Returns `401 Unauthorized` if the secret is missing or incorrect.

### Create Tournament

```
POST /api/tournaments
```

**Headers:**
```
X-Admin-Secret: <your-admin-secret>
```

**Request body:**
```json
{
  "name": "Season 1",
  "config": {
    "format": "bracket",  // 'bracket' (Gauntlet, default) | 'rank_only' (Forge, skips bracket creation)
    "bracketSize": 16,
    "roundDurations": [48, 48, 48],
    "supportedAssetCount": 4
  }
}
```

The `config` object is optional. Any omitted fields use the defaults listed in the competition design document.

**Response:**
```json
{
  "success": true,
  "data": { "id": 1 }
}
```

---

### Start Tournament

```
POST /api/admin/start
```

Closes registration, creates Round 1 brackets, and sets the tournament status to `active`. Wallets are shuffled randomly (Fisher-Yates) for normal tournaments, or placed in seeded order for Season Final tournaments (where `config.seededWallets` is set by `qualifyForFinal`).

**Request body:**
```json
{
  "tournamentId": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "roundId": 1,
    "bracketCount": 2
  }
}
```

**Errors:**
- Tournament must be in `registration` status.
- At least 2 registered traders are required.
- **Singleton enforcement:** Another tournament with `active` status already exists. The error message includes the conflicting tournament's id and name. Cancel or complete it first.

---

### Compute Scores

```
POST /api/admin/score/:roundId
```

Triggers CPI computation for all traders in all brackets of the specified round. Fetches live position data from the Adrena API for each trader.

**Response:**
```json
{
  "success": true,
  "data": { "scoredCount": 16 }
}
```

Scoring continues even if individual trader API calls fail. Failures are logged but do not stop the round.

---

### Advance Round

```
POST /api/admin/advance
```

Ranks each bracket by CPI, eliminates the bottom half (except in the final main round, which is rank-only), and creates the next round with advancing traders. When the main bracket completes, a single Fallen Fighters consolation round is created for all eliminated wallets.

**Request body:**
```json
{
  "tournamentId": 1,
  "roundType": "main"
}
```

`roundType` is optional. When omitted, the engine **auto-detects** the active round type: if a Fallen Fighters (consolation) round exists, it advances that; otherwise it advances the main round. You can still pass `"main"` or `"consolation"` explicitly to override.

**Response (next round created):**
```json
{
  "success": true,
  "data": {
    "nextRoundId": 2,
    "advanced": 8,
    "eliminated": 8
  }
}
```

When the main bracket finishes, the response returns the FF round as `nextRoundId`. The next advance auto-detects the FF round and completes the tournament.

**Response (tournament completed):**
```json
{
  "success": true,
  "data": {
    "completed": true
  }
}
```

The tournament completes after the Fallen Fighters round is scored and advanced.

---

### Cancel Tournament

```
POST /api/admin/cancel/:id
```

Cancels an active or registration-phase tournament. Cannot cancel tournaments that are already `completed` or `cancelled`.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "cancelled"
  }
}
```

**Errors:**
- `401` if admin secret is missing/wrong
- `404` if tournament not found
- `409` if tournament is already `completed` or `cancelled`

---

### Compute Raffle Tickets (Admin)

```
POST /api/admin/raffle/:id/compute
```

Computes ticket counts and eligibility for all wallets in a tournament. Must be called after tournament scoring is finalized.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 50,
    "eligible": 28,
    "excluded": 15
  }
}
```

### Execute Raffle Draw (Admin)

```
POST /api/admin/raffle/:id/draw
```

Executes a deterministic weighted draw using a Bitcoin block hash as the PRNG seed. The first 8 hex characters of the hash are converted to a 32-bit integer, seeding a Mulberry32 PRNG for weighted random selection without replacement. Results are fully reproducible via the Verify endpoint.

**Request body:**
```json
{
  "blockHash": "5a7b3c...",
  "prizeCount": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "winners": ["AbcXyz...", "DefUvw..."],
    "seed": 1517211420
  }
}
```

**Note:** Only one draw is permitted per tournament. Attempting a second draw returns a `500` error with a message explaining that a draw already exists. Use the Reset endpoint below to clear a draw before re-drawing.

### Reset Raffle Draw (Admin)

```
POST /api/admin/raffle/:id/reset
```

Clears all draw records and resets winner flags for a tournament. Use only if a draw was executed with incorrect parameters (e.g. wrong block hash, test data).

**Response:**
```json
{
  "success": true,
  "data": {
    "deletedDraws": 1,
    "resetWinners": 3
  }
}
```

### Daily Analytics (Admin)

```
GET /api/admin/analytics/:tournamentId/daily?date=YYYY-MM-DD
```

Returns per-wallet position metrics (trade count, size, leverage, fees) for a specific date. Uses parallel batch fetching (concurrency=10) with 5-minute cache.

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "date": "2026-04-10",
      "activeTraders": 42,
      "totalTrades": 186,
      "size": { "min": 50.0, "max": 5000.0, "avg": 480.3 },
      "leverage": { "min": 1.1, "max": 50.0, "avg": 8.7 },
      "fees": { "total": 234.5, "max": 45.2, "min": 0.1, "avg": 5.6 },
      "tradesPerTrader": { "min": 1, "max": 22, "avg": 4.4 }
    },
    "walletMetrics": [
      {
        "wallet": "AbcXyz...",
        "tradeCount": 12,
        "longCount": 8,
        "shortCount": 4,
        "avgSize": 500.0,
        "maxSize": 2000.0,
        "minSize": 100.0,
        "avgLeverage": 5.5,
        "maxLeverage": 20.0,
        "minLeverage": 1.1,
        "totalFees": 45.2
      }
    ]
  }
}
```

**Notes:**
- `walletMetrics` is sorted by `totalFees` descending (most active first).
- Stats fields (`size`, `leverage`, `fees`, `tradesPerTrader`) are `null` when no activity exists.

### Anomaly Detection (Admin)

```
GET /api/admin/analytics/:tournamentId/anomalies
```

Detects wallets with consecutive-day top-5 streaks (≥3 days) across quest categories. Flags potential gaming or bot patterns.

**Response:**
```json
{
  "success": true,
  "data": {
    "tournamentId": 1,
    "streakThreshold": 3,
    "anomalyCount": 2,
    "anomalies": [
      {
        "wallet": "AbcXyz...",
        "category": "all_around",
        "streakLength": 5,
        "dates": ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"],
        "type": "consecutive_top5"
      }
    ]
  }
}
```

---

## Season Endpoints

### List Seasons

```
GET /api/seasons
```

Returns all seasons ordered by creation date (newest first).

### Get Season Details

```
GET /api/seasons/:id
```

Returns season details including all linked tournaments (weekly gauntlets + final).

### Get Season Standings

```
GET /api/seasons/:id/standings
```

Returns the season leaderboard: all wallets with `totalPoints`, `weeksParticipated`, `bestPlacement`, and `qualifiedForFinal`.

### Create Season (Admin)

```
POST /api/seasons
Headers: X-Admin-Secret: <secret>
Body: { "name": "Season 1", "config": { "weekCount": 7, "qualificationSlots": 8 } }
```

Creates a new season in `registration` status. Config fields are optional (defaults used for omitted fields).

### Start Season (Admin)

```
POST /api/seasons/:id/start
Headers: X-Admin-Secret: <secret>
```

Transitions season from `registration` → `active`. Creates the Week 1 tournament.

### Advance Week (Admin)

```
POST /api/seasons/:id/advance
Headers: X-Admin-Secret: <secret>
```

Awards season points for the current week's completed tournament, then either creates the next week's tournament or qualifies wallets for the Season Final.

**Response:**
```json
{
  "success": true,
  "data": {
    "nextTournamentId": 5,
    "seasonStatus": "active"
  }
}
```

If all weeks are done, `seasonStatus` will be `"final"` and no `nextTournamentId` is returned.

### Complete Season (Admin)

```
POST /api/seasons/:id/complete
Headers: X-Admin-Secret: <secret>
```

Finalizes the season after the Grand Final tournament completes. Awards final points and sets status to `completed`.

---

## Category Endpoints

Categories use two aggregation modes:
- **SUM** categories (daily additive): `all_around`, `top_tick_traveler`, `bottom_fisher`
- **MAX** categories (best single window): `risk_manager`, `humble_one`, `leverage_master_long`, `leverage_master_short`

All leaderboards use deterministic ordering: score DESC, wallet ASC. Quest point rankings additionally use category-specific ROI as a secondary tiebreaker before wallet (see competition-design.md Determinism Guarantees).

### Wallet Quest Breakdown

```
GET /api/categories/:tournamentId/wallet/:wallet
```

Returns cumulative scores across all 7 quest categories for a single wallet. Used by The Forge expanded row "Quests Breakdown" panel.

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet": "AbcXyz...",
    "tournamentId": 1,
    "totalQuestPoints": 15,
    "breakdown": {
      "all_around": { "totalScore": 185.4, "daysScored": 3 },
      "top_tick_traveler": { "totalScore": 42.1, "daysScored": 2 },
      "bottom_fisher": { "totalScore": 67.8, "daysScored": 3 },
      "risk_manager": { "totalScore": 12.5, "daysScored": 1 },
      "humble_one": { "totalScore": 8.3, "daysScored": 1 },
      "leverage_master_long": { "totalScore": 5, "daysScored": 1 },
      "leverage_master_short": { "totalScore": 3, "daysScored": 1 }
    }
  }
}
```

### Category Leaderboard

```
GET /api/categories/:tournamentId/:category
```

Valid category slugs: `all_around`, `top_tick_traveler`, `bottom_fisher`, `risk_manager`, `humble_one`, `leverage_master_long`, `leverage_master_short`.

Returns cumulative scores aggregated across all scored days.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "wallet": "AbcXyz...",
      "totalScore": 185.4,
      "daysScored": 3
    }
  ]
}
```

### Daily Category Scores

```
GET /api/categories/:tournamentId/:category/:date
```

Returns scores for a specific UTC day (format: `YYYY-MM-DD`).

### Trigger Category Scoring (Admin)

```
POST /api/categories/score
Headers: X-Admin-Secret: <secret>
Body: { "tournamentId": 1, "date": "2026-03-10" }
```

Manually triggers daily category scoring for a specific tournament and date. Computes all 7 categories:

1. **All Around**: Position diversity and sizing metrics
2. **Top-Tick Traveler**: Short entry proximity to daily high (Pyth OHLC)
3. **Bottom Fisher**: Long entry proximity to daily low (Pyth OHLC)
4. **Risk Manager**: Best risk-adjusted trade in 2-day windows (scored every 2nd day)
5. **The Humble One**: Best low-leverage profitable trade in 2-day windows
6. **Leverage Master (Long)**: Per-asset variable-step badge grid. Defaults to a 10-step `10x→100x` ladder for crypto assets; admin can configure custom `lmSteps` + `lmTolerance` per asset (e.g. `[1.5, 2, 2.5, 3, 3.5, 4, 4.5]` with `±0.2` tolerance for sub-10x RWAs like XAU/XAG/WTI). Long positions only.
7. **Leverage Master (Short)**: Same per-asset variable-step semantics; separate ladder per side.

If the tournament belongs to a season, Fisher (3/2/1 for top 3 each direction) and All Around (3/2/1 for top 3) season points are also awarded.

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-03-10",
    "tournamentId": 1,
    "walletsScored": 24,
    "ohlcAssetsAvailable": 4
  }
}
```

---

## Quest Endpoints

### Get Quest Progress

```
GET /api/quests/:tournamentId/:wallet
```

Returns a wallet's Leverage Master quest progress (badge grid data). Returns the latest week's progress by default. The shape is per-asset: the response contains a `byAsset` map keyed by asset symbol from the tournament's `assetList`.

**Query parameters:**
- `week` (optional): Specific week number to query.

**Response:**
```json
{
  "success": true,
  "data": {
    "byAsset": {
      "SOL": {
        "long": [true, true, true, false, false, false, false, false, false, false],
        "short": [true, false, false, false, false, false, false, false, false, false],
        "longCount": 3,
        "shortCount": 1
      },
      "BTC": {
        "long": [false, false, false, false, false, false, false, false, false, false],
        "short": [false, false, false, false, false, false, false, false, false, false],
        "longCount": 0,
        "shortCount": 0
      }
    },
    "weekNumber": 2
  }
}
```

**Notes:**
- `long` and `short` array lengths are variable per asset, defaulting to 10 elements for crypto (`10x → 100x` ladder), configurable via the tournament's `assetList[i].lmSteps` (e.g. RWAs use a 7-element `[1.5, 2, 2.5, 3, 3.5, 4, 4.5]` ladder with `±0.2` tolerance). Each `quest_progress` row carries a `stepTotal` column reflecting the configured length. Frontend should render `${count}/${total}` rather than assuming `/10`.
- If no progress exists for a wallet, the `byAsset` object is empty.

---

### Get LM Leaderboard (per-asset, merged Long + Short)

```
GET /api/quests/:tournamentId/leaderboard
```

Per-asset Leverage Master leaderboard powering the Quest Leaderboards Weekly tab. Each entry merges Long + Short progression for a single wallet so the frontend can render one row per wallet with split-background per-step badges.

**Query parameters:**
- `week` (optional): Week number to query.
- `date` (optional): `YYYY-MM-DD` date string. Frontend passes the displayed Weekly date; the backend converts to week number.

Resolution priority: `week` > `date` > current week.

**Response:**
```json
{
  "success": true,
  "data": {
    "weekNumber": 2,
    "byAsset": {
      "SOL": [
        {
          "wallet": "AbcXyz...",
          "longCount": 5,
          "shortCount": 3,
          "stepTotal": 10,
          "stepsCompletedLong":  [true, true, true, true, true, false, false, false, false, false],
          "stepsCompletedShort": [true, true, true, false, false, false, false, false, false, false],
          "pointsLong": 0.5,
          "pointsShort": 0.4,
          "totalPoints": 0.9,
          "rank": 1
        }
      ],
      "BTC": []
    }
  }
}
```

**Notes:**
- Sort within each asset: `(longCount + shortCount)` DESC, then `max(longCount, shortCount)` DESC, then `wallet` ASC.
- Competition ranking (1224) on the merged sort key. Tied wallets share the same rank, next rank skips.
- Points are awarded per side (top 5 each from `[0.5, 0.4, 0.3, 0.2, 0.1]`). `totalPoints = pointsLong + pointsShort`. Engine logic unchanged from the previous per-side leaderboard; only the response shape and display merge.
- `stepCount > 0` is required to receive points. Wallets at step 0 don't claim a top-N points slot, preventing baseline inflation when many wallets register without trading the category.
- Empty assets (no progress at all) return as empty arrays. Assets listed in `config.assetList` are always present as keys, even when empty.

---

## Raffle Endpoints

### Get Raffle Results

```
GET /api/raffle/:tournamentId
```

Returns all raffle results for a tournament, sorted by final score descending with `wallet ASC` as the deterministic tiebreaker.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tournamentId": 1,
      "wallet": "AbcXyz...",
      "finalScore": 85.2,
      "cpiScore": 70.1,
      "questPoints": 15.1,
      "closedPositionCount": 24,
      "isTopPercent": false,
      "ticketCount": 337,
      "isWinner": true,
      "createdAt": "2026-03-15T00:00:00.000Z"
    }
  ]
}
```

### Verify Raffle Draw

```
GET /api/raffle/:tournamentId/verify
```

Re-runs the deterministic draw algorithm with the stored block hash and compares results.

**Response:**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "mismatches": [],
    "drawId": 1
  }
}
```

If `verified` is `false`, `mismatches` contains human-readable descriptions of each discrepancy.

### Get Wallet Raffle Info

```
GET /api/raffle/:tournamentId/:wallet
```

Returns a single wallet's raffle eligibility, ticket count, and winner status.

**Response:** Same shape as a single entry in the `GET /api/raffle/:tournamentId` response.

**Errors:** `404` if the wallet has no raffle entry.

---

## Price Endpoints

### Get Token USD Prices

```
GET /api/prices/usd?symbols=A,B,C&mints=mintA,mintB,mintC&statics=,,0.05
```

Live USD price feed used by the multi-token prize display. Cascades per symbol with a Pyth Benchmarks lookup first, Jupiter v3 lite-api fallback, then an admin-supplied static price if both feeds return null.

**Query parameters:**
- `symbols` (required): comma-separated, order-preserving list of token tickers.
- `mints` (optional): parallel array of SPL token mint pubkeys. Empty slot means use the server-side default mint for that symbol. Admin-supplied mint takes precedence so admins can add any SPL token without a code change.
- `statics` (optional): parallel array of fallback USD prices per token. Empty slot means no fallback. Used only when both Pyth + Jupiter return null. Per-request, not cached server-side.

**Cascade per symbol:**

1. Pyth Benchmarks via the prize-token-symbol map (covers JTO, USDC, and most major Solana tokens; does not cover ADX).
2. Jupiter price v3 (`lite-api.jup.ag/price/v3?ids=<mint>`) via mint lookup. Admin-supplied mint overrides the server-side default. Required for ADX, since Pyth doesn't index it. Mint-based lookup is mandatory: Jupiter v3 rejects symbol-only queries, and the ADX symbol is shared by two distinct tokens.
3. Admin-supplied static USD. Used only if both feeds returned null.

**Response:**
```json
{
  "success": true,
  "data": {
    "ADX":  { "usd": 0.000833, "source": "jupiter" },
    "JTO":  { "usd": 0.514,    "source": "pyth" },
    "USDC": { "usd": 0.9998,   "source": "pyth" }
  }
}
```

`source` indicates which tier answered: `'pyth'`, `'jupiter'`, `'static'`, or `null` (all three returned null, frontend renders a placeholder dash).

**Cache:** 60s TTL per symbol. Only Pyth + Jupiter results are memoized. Statics are pass-through (not cached) since they are fixed in admin config.

**Cache key:** `mint || symbol:<symbol>`. Two tournaments using different mints for the same symbol don't collide.

---

## Error Codes

| Status | Meaning                                          |
|--------|--------------------------------------------------|
| 200    | Success                                          |
| 201    | Created (registration, tournament)               |
| 400    | Bad request (missing/invalid params)             |
| 401    | Unauthorized (admin secret required)             |
| 404    | Resource not found                               |
| 409    | Conflict (invalid status transition)             |
| 500    | Internal server error                            |
