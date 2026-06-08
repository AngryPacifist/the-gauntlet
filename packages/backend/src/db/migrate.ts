// ============================================================================
// Database Migration: push schema to PostgreSQL
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

-- Add asset column to quest_progress + recreate unique index.
-- Migration strategy: TRUNCATE existing rows (no meaningful per-asset
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

-- Bump daily_category_scores.category length to accommodate per-asset LM
-- slugs (leverage_master_SYMBOL_long|short). Idempotent: only alters if
-- current length is 30.
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

-- Add step_total column to quest_progress (denormalized step count for
-- variable-length per-asset ladders). Default 10 backfills existing rows
-- (matches the legacy crypto ladder length).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quest_progress' AND column_name = 'step_total' AND table_schema = 'public'
  ) THEN
    ALTER TABLE quest_progress ADD COLUMN step_total INTEGER NOT NULL DEFAULT 10;
  END IF;
END $$;

-- Drop the legacy 5-col UNIQUE constraint created by the inline UNIQUE(...)
-- clause in CREATE TABLE. The earlier ALTER TABLE block above added the
-- 6-col idx_quest_progress_unique but the inline constraint was never
-- explicitly dropped; its DROP INDEX IF EXISTS targeted a name that the
-- inline constraint doesn't use.
--
-- Symptom: per-asset LM INSERT fails with 5-col unique violation when a
-- (tournament, wallet, side, week) tuple already has ANY asset row, even
-- though the new 6-col index correctly allows different assets to coexist.
-- The throw aborts scheduler.ts:scoreHourlyCategories' for-loop, so all
-- subsequent wallets in the tick get NO LM tracking.
--
-- Recovery: dropping the constraint leaves the 6-col idx_quest_progress_unique
-- in place. Existing rows trivially satisfy the looser 6-col uniqueness
-- (5-col is strictly stricter). The next hourly tick re-evaluates all wallets
-- from positions and INSERTs the missing per-asset rows cleanly, with no
-- data corruption.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'quest_progress'
      AND constraint_name = 'quest_progress_tournament_id_wallet_quest_type_side_week_nu_key'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE quest_progress
      DROP CONSTRAINT quest_progress_tournament_id_wallet_quest_type_side_week_nu_key;
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

// ============================================================================
// Mutagen: 9 new tables for the new scoring domain
// ============================================================================

const MUTAGEN_TABLES_SQL = `
-- Mutagen Epochs (Y-month epochs per teardown, default 3 months)
CREATE TABLE IF NOT EXISTS mutagen_epochs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'registration',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  sub_epoch_weeks INTEGER NOT NULL DEFAULT 3,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mutagen Sub-Epochs (X-week buckets within an epoch, default 3 weeks)
CREATE TABLE IF NOT EXISTS mutagen_sub_epochs (
  id SERIAL PRIMARY KEY,
  epoch_id INTEGER NOT NULL REFERENCES mutagen_epochs(id),
  sub_epoch_index INTEGER NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  UNIQUE(epoch_id, sub_epoch_index)
);

-- Mutagen User Scores (per-wallet per-sub-epoch result, on-demand-cached)
CREATE TABLE IF NOT EXISTS mutagen_user_scores (
  id SERIAL PRIMARY KEY,
  sub_epoch_id INTEGER NOT NULL REFERENCES mutagen_sub_epochs(id),
  wallet VARCHAR(44) NOT NULL,
  activity_1_score NUMERIC(20, 4) NOT NULL DEFAULT 0,
  activity_2_score NUMERIC(20, 4) NOT NULL DEFAULT 0,
  activity_3_score NUMERIC(20, 4) NOT NULL DEFAULT 0,
  activity_4_score NUMERIC(20, 4) NOT NULL DEFAULT 0,
  activity_5_score NUMERIC(20, 4) NOT NULL DEFAULT 0,
  meta_mutation_multiplier NUMERIC(6, 3) NOT NULL DEFAULT 1.0,
  total_mutagen NUMERIC(20, 4) NOT NULL DEFAULT 0,
  details JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sub_epoch_id, wallet)
);

-- Mutagen Snapshots (audit trail of raw inputs per scoring run)
CREATE TABLE IF NOT EXISTS mutagen_snapshots (
  id SERIAL PRIMARY KEY,
  sub_epoch_id INTEGER NOT NULL REFERENCES mutagen_sub_epochs(id),
  wallet VARCHAR(44) NOT NULL,
  raw_inputs JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mutagen Marketing Awards (Activity 5: admin-manual + future automated feeds)
CREATE TABLE IF NOT EXISTS mutagen_marketing_awards (
  id SERIAL PRIMARY KEY,
  sub_epoch_id INTEGER NOT NULL REFERENCES mutagen_sub_epochs(id),
  wallet VARCHAR(44) NOT NULL,
  source VARCHAR(32) NOT NULL,
  activity_type VARCHAR(64) NOT NULL,
  amount NUMERIC(20, 4) NOT NULL,
  reason VARCHAR(500),
  awarded_by VARCHAR(80),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mutagen Legacy Scores (snapshot-freeze of the legacy leaderboard)
CREATE TABLE IF NOT EXISTS mutagen_legacy_scores (
  id SERIAL PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL UNIQUE,
  snapshot_at TIMESTAMPTZ NOT NULL,
  points_trading NUMERIC(20, 4),
  points_mutations NUMERIC(20, 4),
  points_streaks NUMERIC(20, 4),
  points_quests NUMERIC(20, 4),
  total_points NUMERIC(20, 4),
  total_volume NUMERIC(20, 4),
  raw_row JSONB NOT NULL
);

-- Mutagen Position Snapshots (Activity 4 time-weighted size, hourly snapshots)
CREATE TABLE IF NOT EXISTS mutagen_position_snapshots (
  id SERIAL PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL,
  sub_epoch_id INTEGER NOT NULL REFERENCES mutagen_sub_epochs(id),
  pool_address VARCHAR(44) NOT NULL,
  source VARCHAR(32) NOT NULL,
  position_value_usd NUMERIC(20, 4) NOT NULL,
  total_x_amount NUMERIC(40, 0) NOT NULL,
  total_y_amount NUMERIC(40, 0) NOT NULL,
  last_updated_at_chain INTEGER,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mutagen Vote Cache (daily refresh; expensive getProgramAccounts query)
CREATE TABLE IF NOT EXISTS mutagen_vote_cache (
  wallet VARCHAR(44) PRIMARY KEY,
  vote_count INTEGER NOT NULL,
  has_token_owner_record BOOLEAN NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mutagen Scoring Locks (prevent concurrent scoring per wallet+sub-epoch; TTL via expires_at)
CREATE TABLE IF NOT EXISTS mutagen_scoring_locks (
  wallet VARCHAR(44) NOT NULL,
  sub_epoch_id INTEGER NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (wallet, sub_epoch_id)
);
`;

const MUTAGEN_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_mutagen_sub_epochs_epoch ON mutagen_sub_epochs(epoch_id);
CREATE INDEX IF NOT EXISTS idx_mutagen_user_scores_leaderboard ON mutagen_user_scores(sub_epoch_id, total_mutagen DESC);
CREATE INDEX IF NOT EXISTS idx_mutagen_user_scores_wallet ON mutagen_user_scores(wallet);
CREATE INDEX IF NOT EXISTS idx_mutagen_snapshots_subepoch ON mutagen_snapshots(sub_epoch_id, wallet);
CREATE INDEX IF NOT EXISTS idx_mutagen_marketing_awards_wallet ON mutagen_marketing_awards(wallet, sub_epoch_id);
CREATE INDEX IF NOT EXISTS idx_mutagen_position_snapshots_wallet_subepoch ON mutagen_position_snapshots(wallet, sub_epoch_id);
CREATE INDEX IF NOT EXISTS idx_mutagen_position_snapshots_snapshotted_at ON mutagen_position_snapshots(snapshotted_at);
CREATE INDEX IF NOT EXISTS idx_mutagen_vote_cache_refreshed_at ON mutagen_vote_cache(refreshed_at);
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

        // Step 1: Forge tables + ALTER TABLE (must complete before indexes reference new columns)
        await client.query(TABLES_SQL);
        console.log('   ✅ Forge tables and columns created');

        // Step 2: Forge indexes (safe now that all columns exist)
        await client.query(INDEXES_SQL);
        console.log('   ✅ Forge indexes created');

        // Step 3: Mutagen tables (new domain alongside Forge)
        await client.query(MUTAGEN_TABLES_SQL);
        console.log('   ✅ Mutagen tables created');

        // Step 4: Mutagen indexes
        await client.query(MUTAGEN_INDEXES_SQL);
        console.log('   ✅ Mutagen indexes created');

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
