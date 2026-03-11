// ============================================================================
// Database Migration — Push schema to PostgreSQL
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { pool } from './index.js';

const { Client } = pg;

const SCHEMA_SQL = `
-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'registration',
  config JSONB NOT NULL,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rounds_tournament ON rounds(tournament_id);
CREATE INDEX IF NOT EXISTS idx_brackets_round ON brackets(round_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_wallet ON bracket_entries(wallet);
CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrations_wallet ON registrations(wallet);
CREATE INDEX IF NOT EXISTS idx_rounds_type ON rounds(type);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_entry ON score_snapshots(bracket_entry_id);
CREATE INDEX IF NOT EXISTS idx_trade_cache_wallet ON trade_cache(wallet);
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
        await client.query(SCHEMA_SQL);
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
