// ============================================================================
// Database Schema — Drizzle ORM (PostgreSQL)
// ============================================================================

import {
    pgTable,
    serial,
    varchar,
    integer,
    boolean,
    real,
    timestamp,
    jsonb,
} from 'drizzle-orm/pg-core';

// --- Tournaments ---

export const tournaments = pgTable('tournaments', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('registration'),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Rounds ---

export const rounds = pgTable('rounds', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    roundNumber: integer('round_number').notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    type: varchar('type', { length: 20 }).notNull().default('main'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
});

// --- Brackets ---

export const brackets = pgTable('brackets', {
    id: serial('id').primaryKey(),
    roundId: integer('round_id').notNull().references(() => rounds.id),
    bracketNumber: integer('bracket_number').notNull(),
});

// --- Bracket Entries (trader in a bracket) ---

export const bracketEntries = pgTable('bracket_entries', {
    id: serial('id').primaryKey(),
    bracketId: integer('bracket_id').notNull().references(() => brackets.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    pnlScore: real('pnl_score').notNull().default(0),
    riskScore: real('risk_score').notNull().default(0),
    consistencyScore: real('consistency_score').notNull().default(0),
    activityScore: real('activity_score').notNull().default(0),
    cpiScore: real('cpi_score').notNull().default(0),
    eliminated: boolean('eliminated').notNull().default(false),
    advanced: boolean('advanced').notNull().default(false),
});

// --- Registrations ---

export const registrations = pgTable('registrations', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Score Snapshots (history of score computations for audit trail) ---

export const scoreSnapshots = pgTable('score_snapshots', {
    id: serial('id').primaryKey(),
    bracketEntryId: integer('bracket_entry_id').notNull().references(() => bracketEntries.id),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    rawPositions: jsonb('raw_positions').notNull(),
    scores: jsonb('scores').notNull(),
});

// --- Trade Cache (avoid re-fetching positions from Adrena API too frequently) ---

export const tradeCache = pgTable('trade_cache', {
    id: serial('id').primaryKey(),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    positionData: jsonb('position_data').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
