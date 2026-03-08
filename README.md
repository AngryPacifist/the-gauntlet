# Adrena Battle Royale

A bracket-style elimination trading competition engine built for the [Adrena](https://www.adrena.xyz/) perpetuals protocol on Solana.

Traders register with their wallet, compete in timed rounds, and are scored on a multi-dimensional **Composite Performance Index (CPI)** derived from live Adrena position data. The bottom half of each bracket is eliminated each round until a final group of top performers remains.

---

## How It Works

1. **Registration** — Traders submit their Solana wallet address. Eligibility is checked against their Adrena trading history.
2. **Bracket Formation** — Eligible traders are shuffled into brackets of 8.
3. **Trading Rounds** — Each round runs for 72 hours. Traders trade as they normally would on Adrena.
4. **Scoring** — At the end of each round, positions are fetched from the Adrena API and a CPI score is computed.
5. **Elimination** — The bottom 50% of each bracket is eliminated. The top 50% advance to the next round in new brackets.
6. **Completion** — After 3 rounds (or when 3 or fewer traders remain), the tournament ends.

### CPI Scoring

```
CPI = (0.35 x PnL) + (0.25 x Risk) + (0.25 x Consistency) + (0.15 x Activity)
```

- **PnL**: ROI normalized across account sizes. Measures profitability.
- **Risk**: Penalizes liquidations and excessive leverage. Measures discipline.
- **Consistency**: Low variance in daily returns = higher score.
- **Activity**: Trade count, volume, and market diversity.

Full methodology: [docs/competition-design.md](docs/competition-design.md)

---

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Node.js, Express 5, TypeScript      |
| Database  | PostgreSQL (Neon), Drizzle ORM      |
| Frontend  | Next.js 16, React 19, Vanilla CSS   |
| Data      | Adrena Public HTTP API              |
| Monorepo  | npm workspaces                      |

---

## Quick Start

### Prerequisites

- Node.js v18+
- PostgreSQL database (Neon recommended)

### Setup

```bash
# Install dependencies
npm install

# Create .env in project root
cp .env.example .env
# Edit .env with your DATABASE_URL and ADMIN_SECRET

# Run database migrations
npm run db:setup

# Start development servers (backend + frontend)
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:3000

### Create a Tournament

1. Open http://localhost:3000/admin
2. Enter your admin secret
3. Fill in a tournament name and click "Create"
4. Register wallets on the tournament detail page
5. Use the admin panel to Start, Score, and Advance rounds

---

## API

14 endpoints covering tournaments, registration, brackets, trader profiles, leaderboards, and admin actions.

Full reference: [docs/api-reference.md](docs/api-reference.md)

---

## Project Structure

```
adrena-battle-royale/
├── packages/
│   ├── backend/           # Express API server
│   │   └── src/
│   │       ├── routes/    # API route handlers
│   │       ├── services/  # Business logic (tournament, scoring, scheduler, Adrena client)
│   │       └── db/        # Schema, migrations, connection
│   └── frontend/          # Next.js dashboard
│       └── src/
│           ├── lib/       # API client
│           └── app/       # Pages (dashboard, tournament, admin, register, leaderboard, trader)
├── scripts/               # Test scripts
├── docs/                  # Documentation
│   ├── competition-design.md
│   ├── api-reference.md
│   ├── deployment-guide.md
│   └── testing-report.md
└── package.json           # Monorepo root
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Competition Design](docs/competition-design.md) | Tournament mechanics, scoring methodology, anti-gaming filters |
| [API Reference](docs/api-reference.md) | All endpoints with request/response examples |
| [Deployment Guide](docs/deployment-guide.md) | Setup, environment variables, production build, hosting |
| [Testing Report](docs/testing-report.md) | Engine validation, simulation results, scoring analysis |

---

## License

[MIT](LICENSE)
