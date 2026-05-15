# Handoff Walkthrough

For Adrena's engineering team taking over the trading-engine codebase post v1.0-handover. Read this top-to-bottom on day one. Reference docs (`api-reference.md`, `competition-design.md`, `deployment-guide.md`) live next door for endpoint contracts, scoring math, and infra setup respectively.

## TL;DR

A monorepo trading-competition engine for Adrena. Two competition formats share the same engine:

- **The Forge** (`format: 'rank_only'`). Flat leaderboard, no brackets, no elimination. T1 was a Forge tournament.
- **The Gauntlet** (`format: 'bracket'`). 8-person brackets, 3 rounds, top half advances. Multi-week seasons.

Same Postgres schema, same scoring engines, same admin UI, same leaderboard surfaces. The only behavioural fork is bracket creation + advancement (`tournament-manager.ts`) which only fires for `format: 'bracket'`.

Stack: Next.js 16 + React 19 frontend, Express 5 + TypeScript backend, PostgreSQL via Drizzle ORM, node-cron scheduler, Pyth Benchmarks + Pyth Lazer + Jupiter for prices.

## Quickstart

```bash
# 1. Clone + install
git clone <repo>
cd adrena-the-gauntlet
npm install   # installs both workspaces

# 2. Configure
cp .env.example .env
# Edit .env: DATABASE_URL (Postgres conn string), ADMIN_SECRET (any string), PORT (default 3001)

# 3. Migrate DB
npm run db:setup   # idempotent, safe to re-run

# 4. Run dev
npm run dev   # backend on :3001, frontend on :3002 (next dev with API proxy)
```

Backend health: `http://localhost:3001/api/health`. Frontend: `http://localhost:3002`.

Production build: `npm run build`. Backend produces a `dist/` for node; frontend produces a Next.js static + server build.

## Mental model

```
User wallet trades on Adrena DEX
        │
        ▼
Adrena API (datapi.adrena.trade) exposes positions
        │
        ▼
Engine pulls positions, computes:
   - CPI (Composite Performance Index, 4 dimensions)
   - Quest category scores (7 categories, daily/2-day/weekly cadences)
   - Raffle tickets
        │
        ▼
Persisted in Postgres (per-round bracket entries + daily score rows)
        │
        ▼
Frontend reads via Express API endpoints
        │
        ▼
Post-completion: payouts endpoint exposes the final distribution list
        │
        ▼
MrRewards keeper polls payouts and executes SPL transfers
```

Scoring is replayable from positions. The engine treats the Adrena API as the canonical source of trades. The engine's DB is derived state.

## What lives where

```
packages/
  backend/
    src/
      index.ts            Express entry point. Boots the scheduler too.
      types.ts            All shared types. TournamentConfig is the main one.
      db/
        schema.ts         Drizzle schema. 15 tables.
        migrate.ts        Idempotent migration runner. Not Drizzle Kit, custom DO $$ blocks.
        index.ts          PG pool + drizzle wrapper.
      routes/
        tournaments.ts    Tournament CRUD, Forge leaderboard, payouts.
        registration.ts   POST /api/register (any wallet can register).
        admin.ts          All admin actions, gated by x-admin-secret header.
        brackets.ts       Bracket reads, trader profiles, analytics.
        seasons.ts        Season CRUD + lifecycle.
        categories.ts     Daily category leaderboards (one route per category slug).
        quests.ts         Leverage Master quest progress + merged LM leaderboard.
        raffle.ts         Raffle results, verification, per-wallet info.
        leaderboard.ts    Cumulative leaderboard (Tournament / Season / All-time).
        prices.ts         Token USD prices (Pyth -> Jupiter -> admin static).
      services/
        scoring-engine.ts     CPI computation (PnL/Risk/Consistency/Activity).
        category-engine.ts    Quest category scoring (All Around, Fisher, etc).
        quest-engine.ts       Leverage Master step evaluation.
        tournament-manager.ts Tournament lifecycle: create, start, advance, complete.
        season-manager.ts     Season lifecycle + season points.
        scheduler.ts          4 cron jobs: score refresh, round advance, daily cats, hourly provisional.
        adrena-client.ts      Wraps datapi.adrena.trade.
        adrena-canonical.ts   Pinned snapshot of adrena-abi (mints, feed IDs, sessioned flags).
        pyth-client.ts        OHLC fetch via Pyth Benchmarks with Pyth Lazer fallback.
        raffle-engine.ts      Engagement-weighted raffle + deterministic Mulberry32 draw.
        final-score.ts        CPI + quest points join. Batched compute.
        cumulative-leaderboard.ts  Cross-tournament aggregation.

  frontend/
    src/
      app/
        page.tsx                          Dashboard / tournament list.
        layout.tsx                        Root layout, nav.
        admin/                            Multi-route admin UI.
          page.tsx                        Landing, secret entry.
          tournaments/page.tsx            Create / edit / start / score / raffle / etc.
          seasons/page.tsx                Season CRUD + lifecycle.
          registrations/page.tsx          Registration browser.
          analytics/page.tsx              Per-tournament analytics.
        forge/                            The Forge competition pages.
        leaderboard/                      Cumulative leaderboard + per-tournament leaderboard.
          [id]/page.tsx                   Per-tournament leaderboard (CPI + quest tabs, format-aware).
        tournament/[id]/                  Tournament detail + bracket view + analytics.
        categories/[tournamentId]/        Category leaderboards.
        raffle/[tournamentId]/            Raffle results + verification.
        register/                         Public registration.
        seasons/                          Season list + detail.
        trader/[wallet]/                  Trader profile.
      lib/
        api.ts                            Typed API client. One function per backend endpoint.
        quest-descriptions.ts             Human-readable copy for each quest category.
        cpi-description.ts                CPI explainer copy.
      components/
        ShareButton.tsx                   Share-to-X button.
        Select.tsx                        Custom select component for the admin UI.
```

Important: `packages/backend/scripts/` is gitignored. It contains one-off migration / audit / inspection scripts. The `_` prefix flags them as operational tools. Examples that exist on disk today:

- `_migrate-t1-to-multi-token.ts` (T1 prizeTable shape migration, ran 2026-05-15)
- `_cleanup-t1-orphan-week2.ts` (T1 orphan quest_progress cleanup)
- `_inspect-t1-raffle-draw.ts` (T1 raffle audit)
- `_export-t1-payout-list.ts` (T1 payout CSV/JSON export)

These are not part of the build. They are run on-demand via `npx tsx packages/backend/scripts/<name>.ts`. New one-offs follow the same convention.

## Postgres schema

15 tables. The relevant ones for handover:

- `tournaments` (id, name, status, config JSONB, seasonId, weekNumber, timestamps). `status` is `registration | active | completed | cancelled`. `config` carries everything format-specific. **All multi-token data lives in `config.prizeTable.tokens`.** Adding new prize tokens means updating the JSONB, not the table.
- `rounds` (tournament FK, roundNumber, name, type, startTime, endTime, status). `type` is `main | consolation` (Fallen Fighters runs as a separate consolation round).
- `brackets` (round FK, bracketNumber). Forge tournaments have one synthetic bracket per round; Gauntlet tournaments have many.
- `bracket_entries` (bracket FK, wallet, CPI sub-scores, eliminated, advanced). Per-wallet per-round.
- `registrations` (tournament FK, wallet, registeredAt).
- `daily_category_scores` (tournament FK, wallet, category, scoreDate, score, details JSONB). One row per (tournament, wallet, category, date). `details` carries category-specific payload.
- `quest_progress` (tournament FK, wallet, questType, side, asset, stepsCompleted JSONB, stepCount, stepTotal, weekNumber). Per-(tournament, wallet, side, asset, week). Leverage Master only for now.
- `raffle_results` (tournament FK, wallet, finalScore, cpiScore, questPoints, closedPositionCount, isTopPercent, ticketCount, isWinner). One row per (tournament, wallet).
- `raffle_draws` (tournament FK, blockHash, seed, eligibleCount, totalTickets, winnerCount, winners JSONB array). One row per draw. **Audit trail is permanent.** Verification replays from this row.
- `seasons` (id, name, status, config JSONB, currentWeek, timestamps).
- `season_standings` (season FK, wallet, totalPoints, weeksParticipated, bestPlacement, qualifiedForFinal).
- `pyth_ohlc_cache` (symbol, barDate, open, high, low, close, fetchedAt). Daily OHLC cache.
- `trade_cache` (wallet, positionData JSONB, fetchedAt). Wallet-scoped position cache to avoid hammering the Adrena API.
- `score_snapshots` (bracket entry FK, rawPositions JSONB, scores JSONB, computedAt). Audit trail of every scoring computation.
- `season_registrations` (season FK, wallet, registeredAt).

All schema mutations are idempotent via custom DO blocks in `migrate.ts`. No Drizzle Kit. To add a new column, append a `DO $$ ... ADD COLUMN IF NOT EXISTS ... END $$` block. To add a new table, append a `CREATE TABLE IF NOT EXISTS ...` block. Re-run `npm run db:setup` to apply.

## Tournament lifecycle (the path a tournament takes)

1. **Admin creates a tournament**. `POST /api/tournaments` with `{name, config}`. Required field: `format`. Most other config fields have sensible defaults (see `DEFAULT_TOURNAMENT_CONFIG` in `types.ts`).
2. **Tournament is in `registration` state**. Wallets register via `POST /api/register`. Admin can edit config (`PUT /api/tournaments/:id`). Admin can delete (`DELETE`).
3. **Admin starts the tournament** (`POST /api/admin/start`). State flips to `active`. First round is created with timestamps. For Gauntlet tournaments, brackets are seeded (random if no `seededWallets`).
4. **Scheduler runs every 15 minutes** and computes CPI for active rounds. Scores are persisted to `bracket_entries`.
5. **Scheduler runs at midnight UTC** and scores daily category leaderboards. Hourly provisional scoring fires at the top of each hour and overwrites mid-day. Quest progress (Leverage Master) is evaluated hourly from positions.
6. **Round ends** at `endTime`. Scheduler's round-advancement cron detects the end and either advances (Gauntlet: top half) or completes (last round). Eliminated traders fold into the Fallen Fighters consolation round in Gauntlet tournaments.
7. **Tournament completes**. Status flips to `completed`. The scheduler is what triggers this; admin doesn't need to manually advance.
8. **Admin computes raffle tickets** (`POST /api/admin/raffle/:id/compute`). Pulls position counts from the Adrena API, computes tickets per wallet, persists to `raffle_results`. Top 30% by final score are excluded (skill prizes instead).
9. **Admin selects a future Bitcoin block hash** (announced via mempool.space before mining), passes it to `POST /api/admin/raffle/:id/draw`. Mulberry32 PRNG draws weighted winners. Audit trail in `raffle_draws`.
10. **`GET /api/tournaments/:id/payouts`** flips `complete: true`. MrRewards keeper picks up the row, distributes tokens. `GET /api/raffle/:id/verify` lets anyone re-run the draw against the stored block hash.

## Multi-token prize distribution (post-2026-05-15)

The prize structure has evolved from single-currency to per-sponsor multi-token. Existing T1 has been migrated; new tournaments configure tokens at create time.

### Schema

```
config.prizeTable = {
  tokens: [
    { sponsor: "Adrena Foundation", symbol: "ADX", amount: 100000, mint: "AuQa...", staticUsdPrice: null },
    { sponsor: "Jito Labs",         symbol: "JTO", amount: 30000,  mint: "jtoj...", staticUsdPrice: null }
  ],
  skillPrizes:  [25000, 18000, 14000, 10000, 8000, 5000, 5000],  // rank-weight ratios
  rafflePrizes: [5000, 5000, 5000],                              // rank-weight ratios
  totalPool: 130000,    // legacy field, derive live from tokens
  currency:  "ADX"      // legacy field, see tokens[0].symbol
}
```

### Per-rank distribution math

Every winner gets a proportional slice of every token. For a wallet at competition rank `R`:

```
totalWeight = sum(skillPrizes) + sum(rafflePrizes)
rank_R_share_of_total = (skillPrizes[R-1] * proRataScale) / totalWeight
amount_of_token_T_for_rank_R_wallet = rank_R_share_of_total * tokens[T].amount
```

`proRataScale` rebalances when the actual top-% count is fewer than `skillPrizes.length` (so the configured pool always flows fully). The curve is also extended via geometric decay when the count exceeds `skillPrizes.length`, so every top-% wallet gets a non-zero share.

Raffle slots use the same fractional approach: `rank_N_raffle_share = rafflePrizes[N-1] / totalWeight`.

Conservation: for any token, the sum across all skill + raffle payouts equals the token's pool amount (assuming all top-% wallets are paid and all raffle slots are filled).

### Admin entry

Multi-token entry happens in the admin tournament-creation modal under the Sponsors section. Each sponsor row holds a name and a nested grid of token rows. Each token row has:

- Symbol dropdown (ADX / JTO / USDC pre-loaded; admin can type a custom symbol).
- Amount input.
- Optional Mint input (paste SPL token mint pubkey for tokens not in the server-side default map).
- Optional Static USD per token (fallback when Pyth + Jupiter both return null).

Validation:
- At least one sponsor required when prize table is enabled.
- Every sponsor needs a name.
- Every token needs symbol + amount > 0.
- Mint, if provided, must be a valid base58 pubkey (32-44 chars).
- Static USD, if provided, must be > 0.
- No duplicate (sponsor, symbol) pairs within one tournament.

After tournament flips `registration -> active`, the inherited PUT edit-gate blocks any further edits. Tokens are immutable mid-tournament.

### Price feed cascade

Live USD per token via `GET /api/prices/usd?symbols=A,B&mints=mintA,mintB&statics=,0.05`:

1. Pyth Benchmarks (covers JTO, USDC, most major Solana tokens).
2. Jupiter v3 lite-api by mint (required for tokens Pyth doesn't index, e.g. ADX).
3. Admin-supplied static USD (per-request, fixed in config, used only when both feeds null).

If all three return null for a token, the frontend renders `—` for that token's USD contribution but still shows the token amount and sponsor name on hover.

Server-side cache: 60s TTL per (cache key). Only Pyth + Jupiter results are memoized. Cache key is `mint || symbol:<symbol>` so different mints sharing a symbol don't collide.

Empirically as of 2026-05-15: ADX has only Jupiter coverage (Pyth doesn't index it); JTO and USDC have Pyth coverage. T1 with 100K ADX displays as ~$83.33 USD given current Jupiter pricing. Admin can override with a static price per token if a different baseline is desired (e.g. treasury reference price for handover demos).

## Scoring engines

### CPI (Composite Performance Index)

4-dimension weighted score, computed per-bracket per-wallet:

| Dimension     | Weight | What it measures                                                    |
|---------------|--------|---------------------------------------------------------------------|
| PnL           | 35%    | ROI on closed positions (exit_size denominator, accounts for upsizing) |
| Risk          | 30%    | Max drawdown ratio                                                  |
| Consistency   | 20%    | Trading frequency / regularity                                      |
| Activity      | 15%    | Volume (log10 scaled, capped at 30)                                 |

Final CPI = `0.35*PnL + 0.30*Risk + 0.20*Consistency + 0.15*Activity`. Code in `services/scoring-engine.ts`.

Anti-gaming filters: `minPositionCollateral` (default $25) and `minTradeDurationSec` (default 120s) drop micro-trades and washes.

### Quest categories

7 total, in `services/category-engine.ts` and `services/quest-engine.ts`:

| Category            | Cadence | Scoring                                                                   |
|---------------------|---------|---------------------------------------------------------------------------|
| All Around Trader   | Daily   | Best ROI per asset, capped per-asset, summed.                              |
| Bottom Fisher       | Daily   | Best long entry proximity to daily low.                                    |
| Top-Tick Traveler   | Daily   | Best short entry proximity to daily high.                                  |
| Risk Manager        | 2-day   | Best SL-triggered close by ROI.                                            |
| Humble One          | 2-day   | Best TP-triggered close by ROI.                                            |
| Leverage Master Long | Weekly | Per-asset variable-step ladder (10x..100x for crypto, sub-10x for RWAs). |
| Leverage Master Short | Weekly | Same per-asset semantics, separate ladder per side.                      |

Quest point tables:
- Daily: `[0.2, 0.15, 0.1, 0.05, 0.01]` for top 5
- 2-day: `[0.3, 0.25, 0.2, 0.15, 0.1]` for top 5
- Leverage Master: `[0.5, 0.4, 0.3, 0.2, 0.1]` per side per asset for top 5

Phase 8.m guard: `score > 0` is required to receive points. Wallets tied at score=0 don't share the top-N points slot.

### Raffle

`services/raffle-engine.ts`. Engagement-weighted raffle for non-top-% wallets.

- Eligibility: not in top 30%, at least 10 closed positions, ticket count > 0.
- Tickets: `floor(CPI * cpiTicketMultiplier) + floor(questPoints * questTicketMultiplier)`. Defaults 0.5 and 20.
- Draw: Mulberry32 PRNG seeded by the first 8 hex chars of a future Bitcoin block hash. Weighted selection without replacement. Pool sorted by `wallet ASC` before the draw loop (determinism).
- Audit trail in `raffle_draws`. Replay via `GET /api/raffle/:id/verify`.
- One draw per tournament. Admin can reset via `POST /api/admin/raffle/:id/reset` to clear and re-draw.

## Admin operations cheat sheet

All admin endpoints require `x-admin-secret` header. Admin UI lives at `/admin/*`. Localstorage stores the secret (cleared on logout) so admin doesn't paste it per action.

| Action                  | Endpoint                                  | UI                          |
|-------------------------|-------------------------------------------|-----------------------------|
| Create tournament       | `POST /api/tournaments`                   | `/admin/tournaments`        |
| Edit tournament         | `PUT /api/tournaments/:id`                | `/admin/tournaments` (Edit) |
| Delete tournament       | `DELETE /api/tournaments/:id`             | `/admin/tournaments`        |
| Start tournament        | `POST /api/admin/start`                   | `/admin/tournaments` (Start) |
| Compute scores          | `POST /api/admin/score/:roundId`          | `/admin/tournaments` (Score) |
| Advance round           | `POST /api/admin/advance`                 | `/admin/tournaments` (Advance, bracket only) |
| Cancel tournament       | `POST /api/admin/cancel/:id`              | `/admin/tournaments` (Cancel) |
| Score categories        | `POST /api/categories/score`              | `/admin/tournaments` (Score Categories) |
| Compute raffle tickets  | `POST /api/admin/raffle/:id/compute`      | `/admin/tournaments` (Compute Raffle) |
| Draw raffle             | `POST /api/admin/raffle/:id/draw`         | `/admin/tournaments` (Draw Raffle) |
| Verify draw             | `GET /api/raffle/:id/verify`              | `/admin/tournaments` (Verify) |
| Reset draw              | `POST /api/admin/raffle/:id/reset`        | `/admin/tournaments` (Reset) |

Edit-gate: most lifecycle actions (Start, Score, Advance, Cancel) are status-conditional. Edit + Delete only work in `registration`. Compute / Draw / Verify raffle work in `active` and `completed`.

## Forward-compat conventions (operational, not code)

For new tournaments:

- Schedule starts at exactly 00:00 UTC.
- Set `roundDurations` (or for Forge, the single-element `roundDurations`) to multiples of 168h (7 days) so week boundaries align with tournament-end. Avoids orphan quest_progress rows in week N+1.
- Multi-token tournaments: enter sponsors at create-time via admin form. Tokens lock after `registration -> active`.
- For prize tokens outside ADX / JTO / USDC: paste the SPL mint into the Mint field of the admin Sponsors section. The price feed will use that mint for Jupiter lookups.
- For prize tokens with poor Pyth + Jupiter coverage (or where the live DEX-derived price would surprise sponsors): enter a Static USD per token. The cascade uses it as a third-tier fallback.

## Re-skin scope (what to change for Adrena's visual identity)

The current frontend is functional but generic. Adrena's team handles the visual polish post-handover. Touchpoints:

- **Display names + alias system**. Currently `wallet.slice(0, 4) + '...' + wallet.slice(-4)` everywhere. Adrena has a profile lookup (display name + title alias, e.g. "TheWhiteWhale / Unstoppable"). Wire that lookup into `shortWallet()` in `packages/frontend/src/app/leaderboard/[id]/page.tsx` (and a couple of other render sites).
- **Markup**. Tables are `<table>` elements with `<thead>`, `<tbody>`. Adrena's site uses div-based CSS grids. Convert per Adrena's layout primitives.
- **Sortable columns**. Adrena's leaderboards have `↕` / `↓` icons for sortable columns. The engine returns server-sorted data, but client-side re-sort is a UX add.
- **Token logos**. The Sponsors section and PRIZE column tooltips render symbols as text. Adrena's design uses per-token icons.
- **Dark theme polish**. Body color is currently `rgb(5, 15, 25)` (matched Adrena's), but full palette + typography alignment is a re-skin pass.
- **Admin-editable quest descriptions**. Currently hardcoded in `packages/frontend/src/lib/quest-descriptions.ts`. Adrena's team may want DB-stored text editable from the admin UI.
- **Bracket-screen prize header**. The multi-token prize header is on `/leaderboard/:id` only. If Adrena wants it on `/tournament/:id` too, ~10 LOC drop-in (import `PrizeInfo` + invoke).
- **Mobile breakpoints**. The 3-panel expanded row stacks to 1 column at `<768px`. The LM split-bg cells wrap automatically. May want a finer-grained mobile layout pass.

## Deployment

See `deployment-guide.md` for env vars + Postgres setup. Current state:

- The repo previously deployed to Railway at `adrena-battle-royalebackend-production.up.railway.app` (backend) and `the-forge.up.railway.app` (frontend).
- The repo GitHub URL is `https://github.com/AngryPacifist/the-gauntlet.git` (previously `adrena-battle-royale`).
- CORS is currently `cors()` with no restrictions. Lock down `origin` for production.
- `NEXT_PUBLIC_API_URL` on the frontend env points to the backend URL. The frontend's `lib/api.ts` reads it at build time for production.
- Admin endpoints take `ADMIN_SECRET` via `x-admin-secret` header. Set it on the backend; the admin UI prompts for it and stores in localStorage.

## Operational scripts (gitignored)

The `packages/backend/scripts/` directory contains one-off migration / audit tools that are not part of the build. They are run on-demand via `npx tsx`. Examples:

- `_migrate-t1-to-multi-token.ts`: T1 prizeTable shape migration. Idempotent. Ran successfully 2026-05-15.
- `_cleanup-t1-orphan-week2.ts`: deleted T1's Week 2 orphan quest_progress rows (created by the 01:00 UTC hourly tick that fired before T1's 01:19 UTC end). 252 rows.
- `_inspect-t1-raffle-draw.ts`: read-only audit of T1's raffle draw row.
- `_export-t1-payout-list.ts`: one-off CSV/JSON export of T1's payout list.

When adding new one-offs: `_<purpose>.ts` naming, `import 'dotenv/config'` at top, idempotent where possible, `pool.end()` in a `finally` to close the DB connection.

## When something breaks: where to look

| Symptom                                              | Where to look                                       |
|------------------------------------------------------|-----------------------------------------------------|
| Scoring stopped or scores look stale                 | `services/scheduler.ts`, check cron job logs        |
| CPI numbers look wrong                               | `services/scoring-engine.ts`, then `final-score.ts` |
| Quest categories all zero                            | `services/category-engine.ts`, OHLC cache, Phase 8.m score>0 guard |
| Leverage Master rows missing                         | `services/quest-engine.ts`, `quest_progress` table  |
| Raffle draw fails verification                       | `services/raffle-engine.ts:verifyDraw`, eligible-pool filter consistency |
| Multi-token prize display shows `—`                  | `routes/prices.ts` cascade, browser console for fetch errors |
| Admin form rejects valid input                       | `app/admin/tournaments/page.tsx` validation block   |
| Adrena API fetches are slow                          | `services/adrena-client.ts`, `trade_cache` rows     |
| OHLC fetches are slow / failing                      | `services/pyth-client.ts` (Pyth Benchmarks primary + Pyth Lazer fallback) |

Logs are written to stdout via `console.log` / `console.error`. The backend prints a request log for every request and module-level prefixes (`[Scheduler]`, `[RaffleEngine]`, `[CategoryEngine]`, etc) for cross-cut tracing.

## Glossary

- **CPI**: Composite Performance Index. The 4-dimension skill score.
- **Forge**: rank-only tournament format. Flat leaderboard, no brackets.
- **Gauntlet**: bracket-elimination tournament format. 8-person brackets, multi-round.
- **Fallen Fighters**: consolation round in Gauntlet for eliminated traders.
- **Top %**: top portion of the field by final score, configurable via `topPercentCutoff`. Default 30%.
- **Raffle pool**: bottom (1 - topPercentCutoff) of the field. Weighted by engagement.
- **Quest progress**: per-(asset, side, week) step completion for Leverage Master.
- **OHLC**: Open / High / Low / Close prices. Used by Fisher / Top-Tick / All Around scoring.
- **Score snapshot**: persisted record of a scoring computation. Audit trail.
- **Block hash seed**: future Bitcoin block hash used as PRNG seed for raffle draws. Announced before mining for verifiability.

## Where to start reading the code

If you have an hour, read in this order:

1. `packages/backend/src/types.ts`. Understand `TournamentConfig`, `CPIScores`, `AdrenaPosition`. The mental model lives here.
2. `packages/backend/src/services/scoring-engine.ts`. CPI computation, one of the two scoring entry points.
3. `packages/backend/src/services/category-engine.ts`. Quest scoring, the other scoring entry point.
4. `packages/backend/src/services/scheduler.ts`. When everything runs.
5. `packages/backend/src/routes/tournaments.ts`. The Forge endpoint + payouts endpoint. Two of the most-touched API surfaces.
6. `packages/frontend/src/app/leaderboard/[id]/page.tsx`. The main competition leaderboard page. Most UI surface area lives here.
7. `packages/frontend/src/app/admin/tournaments/page.tsx`. Admin operations UI.

Skip Drizzle's internal schema unless you're adding tables. The schema is in `db/schema.ts`; migrations in `db/migrate.ts`.

## Open items at handover

These are noted in the project's CLAUDE.md and various brain docs. None block handover, but flagging for awareness:

- Forge -> Gauntlet carryover: auto-register Forge participants in the next Gauntlet season. Approved by ZeDef but not yet built.
- Registration-free Forge: ZeDef wants any active Adrena trader auto-included. Currently requires explicit registration.
- Fallen Fighters UX: eliminated traders aren't notified they're being scored for consolation.
- CORS lockdown: currently open. Restrict to production frontend domain.
- Cumulative leaderboard caching: currently on-demand compute. Phase 6 will add caching when needed.

## Contact + handoff context

- Solo builder: OUTIS (Discord username).
- ZeDef (Adrena team): primary design + product feedback throughout development. 13+ rounds of iterative feedback.
- br0wnD3v (Adrena team): MrRewards keeper integration. Has been consuming the payouts endpoint since Day 49.
- call2aamir (Adrena team): oracle / runtime questions.
- mcg26623 (Adrena team): launch coordination.

Tag `v1.0-handover` on origin/master is the stable cut for this handover. The Adrena team owns the re-skin and integration thereafter. Anything pre-tag is OUTIS's; anything post-tag is collaborative.
