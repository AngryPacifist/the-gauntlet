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

-- Seasons (must be created before season_registrations which references it)
CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'registration',
  config JSONB NOT NULL,
  current_week INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Season Registrations (register once, enrolled for all season weeks)
CREATE TABLE IF NOT EXISTS season_registrations (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  wallet VARCHAR(44) NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, wallet)
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

-- Quest Progress (Leverage Master)
CREATE TABLE IF NOT EXISTS quest_progress (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  wallet VARCHAR(44) NOT NULL,
  quest_type VARCHAR(30) NOT NULL,
  side VARCHAR(10) NOT NULL,
  steps_completed JSONB NOT NULL,
  step_count INTEGER NOT NULL DEFAULT 0,
  week_number INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, wallet, quest_type, side, week_number)
);

-- Raffle Results
CREATE TABLE IF NOT EXISTS raffle_results (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  wallet VARCHAR(44) NOT NULL,
  final_score REAL NOT NULL,
  cpi_score REAL NOT NULL,
  quest_points REAL NOT NULL,
  closed_position_count INTEGER NOT NULL,
  is_top_percent BOOLEAN NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, wallet)
);

-- Raffle Draws
CREATE TABLE IF NOT EXISTS raffle_draws (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  block_hash VARCHAR(128) NOT NULL,
  seed INTEGER NOT NULL,
  eligible_count INTEGER NOT NULL,
  total_tickets INTEGER NOT NULL,
  winner_count INTEGER NOT NULL,
  winners JSONB NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Phase 4 item 30: add asset column to quest_progress + recreate unique index
-- Migration strategy (D18 — Option A): TRUNCATE existing rows (no meaningful per-asset
-- info in old single-ladder rows), ADD COLUMN NOT NULL (safe on empty table),
-- DROP old unique index, CREATE new 6-col unique index. Backfill repopulates.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quest_progress' AND column_name = 'asset' AND table_schema = 'public'
  ) THEN
    DELETE FROM quest_progress;
    ALTER TABLE quest_progress ADD COLUMN asset VARCHAR(30) NOT NULL;
    DROP INDEX IF EXISTS idx_quest_progress_unique;
    CREATE UNIQUE INDEX idx_quest_progress_unique
      ON quest_progress (tournament_id, wallet, quest_type, side, asset, week_number);
  END IF;
END $$;

-- Phase 4 item 30: bump daily_category_scores.category length to accommodate
-- per-asset LM slugs (leverage_master_SYMBOL_long|short). Idempotent: only alters
-- if current length is 30.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_category_scores'
      AND column_name = 'category'
      AND character_maximum_length = 30
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE daily_category_scores ALTER COLUMN category TYPE VARCHAR(50);
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
CREATE INDEX IF NOT EXISTS idx_quest_progress_tournament ON quest_progress(tournament_id, week_number);
CREATE INDEX IF NOT EXISTS idx_raffle_results_tournament ON raffle_results(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_rounds_tournament_status ON rounds(tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket_cpi_desc ON bracket_entries(bracket_id, cpi_score DESC);
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
