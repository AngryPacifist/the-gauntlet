# Deployment Guide

## Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- **PostgreSQL** database (e.g. Neon, Supabase, or a self-hosted instance)

---

## Environment Variables

Create a `.env` file in the project root with the following:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
PORT=3001
ADRENA_API_URL=https://datapi.adrena.trade
ADMIN_SECRET=your-secret-here
```

| Variable         | Required | Description                                              |
|------------------|----------|----------------------------------------------------------|
| `DATABASE_URL`   | Yes      | PostgreSQL connection string                             |
| `PORT`           | No       | Backend server port (default: 3001)                      |
| `ADRENA_API_URL` | No       | Adrena API base URL (default: https://datapi.adrena.trade) |
| `ADMIN_SECRET`   | Yes      | Secret for admin endpoint authentication                 |

---

## Local Development

### 1. Install dependencies

From the project root:

```bash
npm install
```

This installs dependencies for both the backend and frontend workspaces.

### 2. Run database migrations

```bash
npm run db:setup
```

This creates all required tables and indexes in your PostgreSQL database.

### 3. Start development servers

To start both backend and frontend concurrently:

```bash
npm run dev
```

Or start them individually:

```bash
# Backend (port 3001)
npm run dev -w packages/backend

# Frontend (port 3000)
npm run dev -w packages/frontend
```

The frontend dev server proxies `/api/*` requests to the backend via Next.js rewrites. No CORS configuration is needed during development.

### 4. Verify

- Backend health: `http://localhost:3001/api/health`
- Frontend: `http://localhost:3000`

---

## Production Build

### Backend

```bash
npm run build -w packages/backend
npm run start -w packages/backend
```

This compiles TypeScript to JavaScript in `packages/backend/dist/` and runs it with Node.

### Frontend

```bash
npm run build -w packages/frontend
npm run start -w packages/frontend
```

For production, set `NEXT_PUBLIC_API_URL` to point to your deployed backend URL:

```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

---

## Database Schema

The migration script (`packages/backend/src/db/migrate.ts`) creates these tables:

| Table                  | Purpose                                        |
|------------------------|------------------------------------------------|
| `tournaments`          | Tournament metadata, config, status. Nullable `season_id` and `week_number` link to seasons. |
| `rounds`               | Round details (name, type, timestamps, status)  |
| `brackets`             | Bracket groupings within a round                |
| `bracket_entries`      | Individual trader entries with scores           |
| `registrations`        | Wallet registrations for tournaments            |
| `score_snapshots`      | Audit trail of score computations               |
| `trade_cache`          | Cached position data from the Adrena API        |
| `seasons`              | Season metadata, config, status, current week   |
| `season_standings`     | Aggregate points per wallet per season          |
| `daily_category_scores`| Daily All Around and Fisher scores per wallet   |
| `pyth_ohlc_cache`      | Cached daily OHLC candles from Pyth Benchmarks  |

Indexes are created on foreign keys and commonly queried columns. All migration SQL is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). See the migration file for the full schema.

---

## Project Structure

```
adrena-the-gauntlet/
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts              # Express server entry point
│   │       ├── types.ts              # Shared TypeScript types
│   │       ├── db/
│   │       │   ├── schema.ts         # Drizzle ORM schema
│   │       │   ├── index.ts          # Database connection pool
│   │       │   └── migrate.ts        # Migration script (raw SQL)
│   │       ├── routes/
│   │       │   ├── tournaments.ts    # Tournament CRUD (list, get, create, edit, delete)
│   │       │   ├── registration.ts   # Wallet registration
│   │       │   ├── admin.ts          # Admin actions (start, score, advance, cancel)
│   │       │   ├── brackets.ts       # Bracket details, trader profiles, leaderboard, analytics
│   │       │   ├── seasons.ts        # Season CRUD + lifecycle (start, advance, complete)
│   │       │   └── categories.ts     # Daily category leaderboards + manual scoring
│   │       └── services/
│   │           ├── tournament-manager.ts  # Tournament lifecycle logic
│   │           ├── scoring-engine.ts      # CPI computation
│   │           ├── scheduler.ts           # Automated scoring + round/category advancement
│   │           ├── adrena-client.ts       # Adrena API client
│   │           ├── season-manager.ts      # Season lifecycle (create, start, advance, qualify, complete)
│   │           ├── category-engine.ts     # All Around + Fisher daily scoring
│   │           └── pyth-client.ts         # Pyth Benchmarks OHLC fetcher with DB cache
│   └── frontend/
│       └── src/
│           ├── components/
│           │   └── ShareButton.tsx    # Share-to-X one-click tweet component
│           ├── lib/api.ts            # Typed API client (tournaments + seasons + categories)
│           └── app/
│               ├── layout.tsx        # Root layout with navigation
│               ├── page.tsx          # Dashboard (tournament list)
│               ├── admin/page.tsx    # Admin panel
│               ├── register/page.tsx # Public registration
│               ├── tournament/[id]/page.tsx           # Tournament detail
│               ├── tournament/[id]/analytics/page.tsx # Post-tournament analytics
│               ├── leaderboard/[id]/page.tsx          # Leaderboard
│               ├── trader/[wallet]/page.tsx           # Trader profile
│               ├── season/[id]/page.tsx               # Season detail + standings
│               └── categories/[tournamentId]/page.tsx # Category leaderboards
├── docs/
│   ├── competition-design.md         # Competition mechanics
│   ├── api-reference.md              # API documentation
│   ├── deployment-guide.md           # This file
│   └── testing-report.md             # Test results
├── .env                              # Environment variables (not committed)
├── .env.example                      # Example environment variables
└── package.json                      # Monorepo root with npm workspaces
```

---

## Hosting Suggestions

**Backend**: Any Node.js host (Railway, Render, Fly.io, AWS EC2/ECS). The backend is a stateless Express server so it can be deployed as a single instance.

**Frontend**: Vercel (optimized for Next.js), Netlify, or any static/serverless host.

**Database**: Neon (serverless Postgres, used during development), Supabase, or any PostgreSQL provider.

---

## Security Notes

- The `ADMIN_SECRET` protects all admin endpoints and tournament creation. Keep it secret, keep it safe.
- The `.env` file is gitignored and must not be committed.
- CORS is currently open (`cors()` with no restrictions). For production, restrict the `origin` to your frontend domain.
- The Adrena API is public and does not require authentication.
