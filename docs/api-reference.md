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
        "bracketSize": 8,
        "advanceRatio": 0.5,
        "roundDurations": [72, 48, 48],
        "minPositionCollateral": 25,
        "minTradeDurationSec": 120,
        "leveragePenaltyThreshold": 30,
        "supportedAssetCount": 4
      },
      "createdAt": "2026-03-08T04:00:00.000Z",
      "updatedAt": "2026-03-08T04:00:00.000Z"
    }
  ]
}
```

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
  "name": "Season 1 — Updated",
  "config": {
    "bracketSize": 16,
    "roundDurations": [48, 48, 48]
  }
}
```

Config overrides are merged with the existing config — you only need to send the fields you want to change.

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

Registers a wallet for a tournament. Zero-barrier sign-up — any valid Solana wallet is accepted without eligibility checks.

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
    "bracketSize": 16,
    "roundDurations": [48, 48, 48],
    "leveragePenaltyThreshold": 30,
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

Closes registration, shuffles all registered wallets, creates Round 1 brackets, and sets the tournament status to `active`.

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

Ranks each bracket by CPI, eliminates the bottom half, creates the next round with advancing traders, and creates a consolation bracket ("Fallen Fighters") for eliminated traders.

**Request body:**
```json
{
  "tournamentId": 1,
  "roundType": "main"
}
```

`roundType` is optional (defaults to `"main"`). Use `"consolation"` to advance the consolation bracket independently.

**Response (next round created):**
```json
{
  "success": true,
  "data": {
    "nextRoundId": 2,
    "advanced": 8,
    "eliminated": 8,
    "consolationRoundId": 3
  }
}
```

`consolationRoundId` is present only when ≥2 traders were eliminated and a consolation bracket was created.

**Response (tournament completed):**
```json
{
  "success": true,
  "data": {
    "completed": true
  }
}
```

The tournament completes if 3 or fewer traders remain or 3 rounds have been played.

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

### All Around Trader Leaderboard

```
GET /api/categories/:tournamentId/all-around
```

Returns cumulative All Around scores aggregated across all days: `wallet`, `totalScore`, `daysScored`.

### Daily All Around Scores

```
GET /api/categories/:tournamentId/all-around/:date
```

Returns All Around scores for a specific UTC day (format: `YYYY-MM-DD`).

### Fisher Leaderboard

```
GET /api/categories/:tournamentId/fisher
```

Returns cumulative Top Bottom Fisher scores aggregated across all days.

### Daily Fisher Scores

```
GET /api/categories/:tournamentId/fisher/:date
```

Returns Fisher scores for a specific UTC day.

### Trigger Category Scoring (Admin)

```
POST /api/categories/score
Headers: X-Admin-Secret: <secret>
Body: { "tournamentId": 1, "date": "2026-03-10" }
```

Manually triggers daily category scoring for a specific tournament and date. Fetches OHLC data from Pyth, computes scores for all registered wallets, and persists results.

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
