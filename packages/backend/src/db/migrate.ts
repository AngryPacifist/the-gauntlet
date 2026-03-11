// ============================================================================
// Database Migration — Push schema to PostgreSQL
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { pool } from './index.js';

const { Client } = pg;

const TABLES_SQL = `
-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'registration',
  config JSONB NOT NULL,
  season_id INTEGER,
  week_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rounds
CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  round_number INTEGER NOT NULL,
  name VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'main',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
);

-- Brackets
CREATE TABLE IF NOT EXISTS brackets (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  bracket_number INTEGER NOT NULL
);

-- Bracket Entries
CREATE TABLE IF NOT EXISTS bracket_entries (
  id SERIAL PRIMARY KEY,
  bracket_id INTEGER NOT NULL REFERENCES brackets(id),
  wallet VARCHAR(44) NOT NULL,
  pnl_score REAL NOT NULL DEFAULT 0,
  risk_score REAL NOT NULL DEFAULT 0,
  consistency_score REAL NOT NULL DEFAULT 0,
  activity_score REAL NOT NULL DEFAULT 0,
  cpi_score REAL NOT NULL DEFAULT 0,
  eliminated BOOLEAN NOT NULL DEFAULT false,
  advanced BOOLEAN NOT NULL DEFAULT false
);

-- Registrations
CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  wallet VARCHAR(44) NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, wallet)
);

-- Score Snapshots
CREATE TABLE IF NOT EXISTS score_snapshots (
  id SERIAL PRIMARY KEY,
  bracket_entry_id INTEGER NOT NULL REFERENCES bracket_entries(id),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_positions JSONB NOT NULL,
  scores JSONB NOT NULL
);

-- Trade Cache
CREATE TABLE IF NOT EXISTS trade_cache (
  id SERIAL PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL,
  position_data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'registration',
  config JSONB NOT NULL,
  current_week INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Season Standings
CREATE TABLE IF NOT EXISTS season_standings (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  wallet VARCHAR(44) NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  weeks_participated INTEGER NOT NULL DEFAULT 0,
  best_placement INTEGER,
  qualified_for_final BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(season_id, wallet)
);

-- Daily Category Scores
CREATE TABLE IF NOT EXISTS daily_category_scores (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  season_id INTEGER REFERENCES seasons(id),
  wallet VARCHAR(44) NOT NULL,
  category VARCHAR(30) NOT NULL,
  score_date DATE NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  details JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, wallet, category, score_date)
);

-- Pyth OHLC Cache
CREATE TABLE IF NOT EXISTS pyth_ohlc_cache (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(30) NOT NULL,
  bar_date DATE NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, bar_date)
);

-- Add type column to rounds if not already present (was added to CREATE TABLE
-- definition after initial deployment, but existing DBs don't have it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rounds' AND column_name = 'type' AND table_schema = 'public'
  ) THEN
    ALTER TABLE rounds ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'main';
  END IF;
END $$;

-- Add season_id and week_number columns to tournaments if not already present (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'season_id' AND table_schema = 'public'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN season_id INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'week_number' AND table_schema = 'public'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN week_number INTEGER;
  END IF;
END $$;

-- Add foreign key from tournaments.season_id to seasons.id if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_tournaments_season_id' AND table_name = 'tournaments'
  ) THEN
    ALTER TABLE tournaments ADD CONSTRAINT fk_tournaments_season_id
      FOREIGN KEY (season_id) REFERENCES seasons(id);
  END IF;
END $$;
`;

const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_rounds_tournament ON rounds(tournament_id);
CREATE INDEX IF NOT EXISTS idx_brackets_round ON brackets(round_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_wallet ON bracket_entries(wallet);
CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrations_wallet ON registrations(wallet);
CREATE INDEX IF NOT EXISTS idx_rounds_type ON rounds(type);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_entry ON score_snapshots(bracket_entry_id);
CREATE INDEX IF NOT EXISTS idx_trade_cache_wallet ON trade_cache(wallet);
CREATE INDEX IF NOT EXISTS idx_tournaments_season ON tournaments(season_id);
CREATE INDEX IF NOT EXISTS idx_season_standings_season ON season_standings(season_id);
CREATE INDEX IF NOT EXISTS idx_season_standings_points ON season_standings(season_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_daily_category_leaderboard ON daily_category_scores(tournament_id, category, score_date, score DESC);
CREATE INDEX IF NOT EXISTS idx_pyth_ohlc_lookup ON pyth_ohlc_cache(symbol, bar_date);
`;

async function migrate() {
    console.log('🔧 Running database migration...');
    console.log('   Connecting to:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'));

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('localhost')
            ? false
            : { rejectUnauthorized: false },
    });

    try {
        await client.connect();

        // Step 1: Tables + ALTER TABLE (must complete before indexes reference new columns)
        await client.query(TABLES_SQL);
        console.log('   ✅ Tables and columns created');

        // Step 2: Indexes (safe now that all columns exist)
        await client.query(INDEXES_SQL);
        console.log('   ✅ Indexes created');

        console.log('✅ Database schema created successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await client.end();
        await pool.end();
    }
}

migrate();
