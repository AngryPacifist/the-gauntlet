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
    numeric,
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

// ============================================================================
// MUTAGEN R2 — new domain alongside Forge
// ============================================================================
// 9 tables. See:
//   .agent/brain/zedef_mutagen_rework_r2_teardown.md (architecture)
//   .agent/brain/zedef_mutagen_rework_r2_implementation_plan.md (per-table spec)
// ============================================================================

// --- Mutagen Epochs (Y-month epochs per teardown, default 3 months) ---

export const mutagenEpochs = pgTable('mutagen_epochs', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('registration'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    subEpochWeeks: integer('sub_epoch_weeks').notNull().default(3),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Mutagen Sub-Epochs (X-week buckets within an epoch, default 3 weeks) ---

export const mutagenSubEpochs = pgTable('mutagen_sub_epochs', {
    id: serial('id').primaryKey(),
    epochId: integer('epoch_id').notNull().references(() => mutagenEpochs.id),
    subEpochIndex: integer('sub_epoch_index').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
}, (table) => ({
    uniqueEpochIndex: uniqueIndex('idx_mutagen_sub_epochs_unique').on(table.epochId, table.subEpochIndex),
}));

// --- Mutagen User Scores (per-wallet per-sub-epoch result, on-demand-cached) ---

export const mutagenUserScores = pgTable('mutagen_user_scores', {
    id: serial('id').primaryKey(),
    subEpochId: integer('sub_epoch_id').notNull().references(() => mutagenSubEpochs.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    activity1Score: numeric('activity_1_score', { precision: 20, scale: 4 }).notNull().default('0'),
    activity2Score: numeric('activity_2_score', { precision: 20, scale: 4 }).notNull().default('0'),
    activity3Score: numeric('activity_3_score', { precision: 20, scale: 4 }).notNull().default('0'),
    activity4Score: numeric('activity_4_score', { precision: 20, scale: 4 }).notNull().default('0'),
    activity5Score: numeric('activity_5_score', { precision: 20, scale: 4 }).notNull().default('0'),
    metaMutationMultiplier: numeric('meta_mutation_multiplier', { precision: 6, scale: 3 }).notNull().default('1.0'),
    totalMutagen: numeric('total_mutagen', { precision: 20, scale: 4 }).notNull().default('0'),
    details: jsonb('details').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    uniqueSubEpochWallet: uniqueIndex('idx_mutagen_user_scores_unique').on(table.subEpochId, table.wallet),
}));

// --- Mutagen Snapshots (audit trail of raw inputs per scoring run) ---

export const mutagenSnapshots = pgTable('mutagen_snapshots', {
    id: serial('id').primaryKey(),
    subEpochId: integer('sub_epoch_id').notNull().references(() => mutagenSubEpochs.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    rawInputs: jsonb('raw_inputs').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Mutagen Marketing Awards (Activity 5: admin-manual + future automated feeds) ---

export const mutagenMarketingAwards = pgTable('mutagen_marketing_awards', {
    id: serial('id').primaryKey(),
    subEpochId: integer('sub_epoch_id').notNull().references(() => mutagenSubEpochs.id),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    source: varchar('source', { length: 32 }).notNull(),  // 'admin' | 'discord-bot' | 'twitter-api' | ...
    activityType: varchar('activity_type', { length: 64 }).notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    awardedBy: varchar('awarded_by', { length: 80 }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Mutagen Legacy Scores (snapshot-freeze of pre-R2 leaderboard, for migration path c) ---

export const mutagenLegacyScores = pgTable('mutagen_legacy_scores', {
    id: serial('id').primaryKey(),
    wallet: varchar('wallet', { length: 44 }).notNull().unique(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
    pointsTrading: numeric('points_trading', { precision: 20, scale: 4 }),
    pointsMutations: numeric('points_mutations', { precision: 20, scale: 4 }),
    pointsStreaks: numeric('points_streaks', { precision: 20, scale: 4 }),
    pointsQuests: numeric('points_quests', { precision: 20, scale: 4 }),
    totalPoints: numeric('total_points', { precision: 20, scale: 4 }),
    totalVolume: numeric('total_volume', { precision: 20, scale: 4 }),
    rawRow: jsonb('raw_row').notNull(),
});

// --- Mutagen Position Snapshots (Activity 4 time-weighted size, hourly snapshots) ---

export const mutagenPositionSnapshots = pgTable('mutagen_position_snapshots', {
    id: serial('id').primaryKey(),
    wallet: varchar('wallet', { length: 44 }).notNull(),
    subEpochId: integer('sub_epoch_id').notNull().references(() => mutagenSubEpochs.id),
    poolAddress: varchar('pool_address', { length: 44 }).notNull(),
    source: varchar('source', { length: 32 }).notNull(),  // 'meteora-dlmm' | future
    positionValueUsd: numeric('position_value_usd', { precision: 20, scale: 4 }).notNull(),
    totalXAmount: numeric('total_x_amount', { precision: 40, scale: 0 }).notNull(),
    totalYAmount: numeric('total_y_amount', { precision: 40, scale: 0 }).notNull(),
    lastUpdatedAtChain: integer('last_updated_at_chain'),  // unix seconds (INTEGER; safe through 2038)
    snapshottedAt: timestamp('snapshotted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    walletSubepochIdx: index('idx_mutagen_position_snapshots_wallet_subepoch').on(table.wallet, table.subEpochId),
    snapshottedAtIdx: index('idx_mutagen_position_snapshots_snapshotted_at').on(table.snapshottedAt),
}));

// --- Mutagen Vote Cache (daily refresh; expensive getProgramAccounts query) ---

export const mutagenVoteCache = pgTable('mutagen_vote_cache', {
    wallet: varchar('wallet', { length: 44 }).primaryKey(),
    voteCount: integer('vote_count').notNull(),
    hasTokenOwnerRecord: boolean('has_token_owner_record').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    refreshedAtIdx: index('idx_mutagen_vote_cache_refreshed_at').on(table.refreshedAt),
}));

// --- Mutagen Scoring Locks (prevent concurrent scoring runs per wallet+sub-epoch) ---

export const mutagenScoringLocks = pgTable('mutagen_scoring_locks', {
    wallet: varchar('wallet', { length: 44 }).notNull(),
    subEpochId: integer('sub_epoch_id').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({
    primaryKey: uniqueIndex('idx_mutagen_scoring_locks_pk').on(table.wallet, table.subEpochId),
}));
