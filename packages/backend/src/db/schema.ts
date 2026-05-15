// ============================================================================
// Database Schema: Drizzle ORM (PostgreSQL)
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
    date,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';

// --- Tournaments ---

export const tournaments = pgTable('tournaments', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('registration'),
    config: jsonb('config').notNull(),
    seasonId: integer('season_id'),  // nullable: standalone tournaments have no season
    weekNumber: integer('week_number'),  // nullable: which week of the season (1-indexed)
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

// --- Season Registrations (register once, enrolled for all weeks) ---

export const seasonRegistrations = pgTable('season_registrations', {
    id: serial('id').primaryKey(),
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    uniqueSeasonWallet: uniqueIndex('idx_season_registrations_unique').on(table.seasonId, table.wallet),
}));

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

// --- Seasons ---

export const seasons = pgTable('seasons', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('registration'),
    config: jsonb('config').notNull(),
    currentWeek: integer('current_week').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Season Standings ---

export const seasonStandings = pgTable('season_standings', {
    id: serial('id').primaryKey(),
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    totalPoints: integer('total_points').notNull().default(0),
    weeksParticipated: integer('weeks_participated').notNull().default(0),
    bestPlacement: integer('best_placement'),
    qualifiedForFinal: boolean('qualified_for_final').notNull().default(false),
}, (table) => ({
    uniqueSeasonWallet: uniqueIndex('idx_season_standings_unique').on(table.seasonId, table.wallet),
}));

// --- Daily Category Scores ---

export const dailyCategoryScores = pgTable('daily_category_scores', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    seasonId: integer('season_id').references(() => seasons.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    scoreDate: date('score_date').notNull(),
    score: real('score').notNull().default(0),
    details: jsonb('details').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    uniqueDailyScore: uniqueIndex('idx_daily_category_unique').on(
        table.tournamentId, table.wallet, table.category, table.scoreDate,
    ),
    leaderboardIdx: index('idx_daily_category_leaderboard').on(
        table.tournamentId, table.category, table.scoreDate,
    ),
}));

// --- Pyth OHLC Cache ---

export const pythOhlcCache = pgTable('pyth_ohlc_cache', {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', { length: 30 }).notNull(),
    barDate: date('bar_date').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    uniqueSymbolDate: uniqueIndex('idx_pyth_ohlc_unique').on(table.symbol, table.barDate),
}));

// --- Quest Progress (Leverage Master) ---

export const questProgress = pgTable('quest_progress', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    questType: varchar('quest_type', { length: 30 }).notNull(), // 'leverage_master'
    side: varchar('side', { length: 10 }).notNull(),  // 'long' | 'short'
    // Per-asset LM ladders. Each (tournament, wallet, side, asset, week) tracks
    // its own progression independently. Length 30 matches questType / symbol conventions.
    asset: varchar('asset', { length: 30 }).notNull(),
    stepsCompleted: jsonb('steps_completed').notNull(), // boolean[N] where N = stepTotal
    stepCount: integer('step_count').notNull().default(0), // denormalized for ORDER BY
    // Denormalized step total per row (variable per asset).
    // Default 10 backfills legacy rows safely (crypto ladder length).
    stepTotal: integer('step_total').notNull().default(10),
    weekNumber: integer('week_number').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    // Unique index includes `asset` (6 cols instead of 5).
    uniqueQuestWallet: uniqueIndex('idx_quest_progress_unique').on(
        table.tournamentId, table.wallet, table.questType, table.side, table.asset, table.weekNumber,
    ),
}));

// --- Raffle Results (per-wallet eligibility + tickets) ---

export const raffleResults = pgTable('raffle_results', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    finalScore: real('final_score').notNull(),
    cpiScore: real('cpi_score').notNull(),
    questPoints: real('quest_points').notNull(),
    closedPositionCount: integer('closed_position_count').notNull(),
    isTopPercent: boolean('is_top_percent').notNull(),  // top 30% excluded from raffle
    ticketCount: integer('ticket_count').notNull().default(0),
    isWinner: boolean('is_winner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    uniqueRaffleWallet: uniqueIndex('idx_raffle_results_unique').on(
        table.tournamentId, table.wallet,
    ),
}));

// --- Raffle Draws (deterministic draw audit trail) ---

export const raffleDraws = pgTable('raffle_draws', {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    blockHash: varchar('block_hash', { length: 128 }).notNull(),
    seed: integer('seed').notNull(),
    eligibleCount: integer('eligible_count').notNull(),
    totalTickets: integer('total_tickets').notNull(),
    winnerCount: integer('winner_count').notNull(),
    winners: jsonb('winners').notNull(), // string[]: wallet addresses
    drawnAt: timestamp('drawn_at', { withTimezone: true }).notNull().defaultNow(),
});
