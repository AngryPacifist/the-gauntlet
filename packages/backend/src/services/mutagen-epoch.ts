// ============================================================================
// Mutagen — active epoch + sub-epoch resolver
// ============================================================================
//
// Single source of truth for "which epoch / sub-epoch is live right now".
// Used by the scheduler background jobs, the read API (leaderboard +
// per-wallet on-demand), and the admin endpoints. Centralized so the
// "straddling" boundary logic lives in exactly one place instead of
// drifting across callers.
// ============================================================================

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { addWeeks } from 'date-fns';
import { db } from '../db/index.js';
import { mutagenEpochs, mutagenSubEpochs } from '../db/schema.js';

export type MutagenEpochRow = typeof mutagenEpochs.$inferSelect;
export type MutagenSubEpochRow = typeof mutagenSubEpochs.$inferSelect;

export interface ActiveSubEpoch {
    subEpoch: MutagenSubEpochRow;
    epoch: MutagenEpochRow;
}

/**
 * The epoch whose status === 'active'. Null if none. Admin keeps exactly one
 * epoch active at a time; if more than one is active by data error, the
 * lowest-id one is returned deterministically (orderBy id asc).
 */
export async function getActiveEpoch(): Promise<MutagenEpochRow | null> {
    const rows = await db
        .select()
        .from(mutagenEpochs)
        .where(eq(mutagenEpochs.status, 'active'))
        .orderBy(asc(mutagenEpochs.id))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * The active epoch + the sub-epoch straddling `now` (startAt ≤ now ≤ endAt).
 * Null when no epoch is active or no sub-epoch covers the moment. Sub-epochs
 * within an epoch are contiguous + non-overlapping (admin generation), so the
 * straddling sub-epoch is unique.
 */
export async function getActiveSubEpoch(now: Date): Promise<ActiveSubEpoch | null> {
    const rows = await db
        .select()
        .from(mutagenSubEpochs)
        .innerJoin(mutagenEpochs, eq(mutagenSubEpochs.epochId, mutagenEpochs.id))
        .where(
            and(
                eq(mutagenEpochs.status, 'active'),
                lte(mutagenSubEpochs.startAt, now),
                gte(mutagenSubEpochs.endAt, now),
            ),
        )
        .limit(1);
    if (rows.length === 0) return null;
    return { subEpoch: rows[0].mutagen_sub_epochs, epoch: rows[0].mutagen_epochs };
}

export interface SubEpochWindow {
    subEpochIndex: number;
    startAt: Date;
    endAt: Date;
}

/**
 * Pure: computes the contiguous sub-epoch windows that tile [startAt, endAt),
 * each `subEpochWeeks` long, with the final window truncated to endAt. No DB
 * access — the caller (admin activate) inserts these inside a transaction so
 * generation + the status flip are atomic. Kept pure so the window math is
 * unit-verifiable on its own.
 */
export function computeSubEpochWindows(
    startAt: Date,
    endAt: Date,
    subEpochWeeks: number,
): SubEpochWindow[] {
    if (subEpochWeeks < 1) throw new Error('subEpochWeeks must be >= 1');
    const windows: SubEpochWindow[] = [];
    let cursor = startAt;
    let index = 0;
    while (cursor < endAt) {
        const subEnd = addWeeks(cursor, subEpochWeeks);
        const effectiveEnd = subEnd > endAt ? endAt : subEnd;
        windows.push({ subEpochIndex: index, startAt: cursor, endAt: effectiveEnd });
        cursor = effectiveEnd;
        index++;
    }
    return windows;
}
