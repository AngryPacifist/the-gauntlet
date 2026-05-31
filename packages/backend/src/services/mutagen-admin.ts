// ============================================================================
// Mutagen R2 — admin domain logic (epoch lifecycle + marketing + bootstrap)
// ============================================================================
//
// Behind the admin routes in routes/admin.ts, which supply the ADMIN_SECRET
// auth (router.use middleware) + the thin HTTP layer. This module is
// framework-free so the verifier can drive it directly.
//
// Failures return a tagged `code` so the route maps to the right HTTP status
// (not_found→404, conflict→409, bad_request→400) without string-sniffing.
// ============================================================================

import { eq } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { db } from '../db/index.js';
import {
    mutagenEpochs,
    mutagenSubEpochs,
    mutagenMarketingAwards,
    registrations,
} from '../db/schema.js';
import { DEFAULT_EPOCH_CONFIG, type EpochConfig } from './mutagen-scorer-types.js';
import { getActiveEpoch, getActiveSubEpoch, computeSubEpochWindows } from './mutagen-epoch.js';
import { AdrenaClient } from './adrena-client.js';
import { scoreWalletForSubEpoch } from './mutagen-aggregator.js';

const adrenaClient = new AdrenaClient();

type EpochRow = typeof mutagenEpochs.$inferSelect;

export type AdminFail = {
    ok: false;
    code: 'not_found' | 'conflict' | 'bad_request';
    error: string;
};

const bad = (error: string): AdminFail => ({ ok: false, code: 'bad_request', error });

// ---------- config validation ----------

/**
 * Structural safety only — NOT opinion-policing ZeDef's tuning. The one
 * invariant that would corrupt scoring if violated: Activity weights must sum
 * to 1.0. Bracket shapes / multipliers are deliberately left to the admin.
 */
export function validateEpochConfig(config: EpochConfig): string | null {
    const w = config?.weights;
    if (!w) return 'config.weights is missing';
    const sum = w.a1 + w.a2 + w.a3 + w.a4 + w.a5;
    if (!Number.isFinite(sum) || Math.abs(sum - 1.0) > 1e-6) {
        return `config.weights must sum to 1.0 (got ${sum})`;
    }
    return null;
}

// ---------- epoch CRUD ----------

export interface CreateEpochInput {
    name: string;
    startAt: Date;
    endAt: Date;
    subEpochWeeks?: number;
    config?: EpochConfig;
}

export async function createEpoch(
    input: CreateEpochInput,
): Promise<{ ok: true; epoch: EpochRow } | AdminFail> {
    if (!input.name) return bad('name is required');
    if (!(input.startAt instanceof Date) || isNaN(input.startAt.getTime())) return bad('a valid startAt is required');
    if (!(input.endAt instanceof Date) || isNaN(input.endAt.getTime())) return bad('a valid endAt is required');
    if (input.endAt <= input.startAt) return bad('endAt must be after startAt');
    const subEpochWeeks = input.subEpochWeeks ?? 3;
    if (subEpochWeeks < 1) return bad('subEpochWeeks must be >= 1');
    const config = input.config ?? DEFAULT_EPOCH_CONFIG;
    const configErr = validateEpochConfig(config);
    if (configErr) return bad(configErr);

    const [epoch] = await db
        .insert(mutagenEpochs)
        .values({
            name: input.name,
            status: 'registration',
            startAt: input.startAt,
            endAt: input.endAt,
            subEpochWeeks,
            config,
        })
        .returning();
    return { ok: true, epoch };
}

export async function listEpochs(): Promise<EpochRow[]> {
    return db.select().from(mutagenEpochs).orderBy(mutagenEpochs.id);
}

export async function getEpochById(id: number): Promise<EpochRow | null> {
    const [epoch] = await db.select().from(mutagenEpochs).where(eq(mutagenEpochs.id, id)).limit(1);
    return epoch ?? null;
}

export async function updateEpochConfig(
    id: number,
    config: EpochConfig,
): Promise<{ ok: true; epoch: EpochRow } | AdminFail> {
    const epoch = await getEpochById(id);
    if (!epoch) return { ok: false, code: 'not_found', error: `epoch ${id} not found` };
    if (epoch.status === 'completed') {
        return { ok: false, code: 'conflict', error: 'cannot edit config of a completed epoch' };
    }
    const configErr = validateEpochConfig(config);
    if (configErr) return bad(configErr);
    const [updated] = await db
        .update(mutagenEpochs)
        .set({ config })
        .where(eq(mutagenEpochs.id, id))
        .returning();
    return { ok: true, epoch: updated };
}

export async function activateEpoch(
    id: number,
): Promise<{ ok: true; epoch: EpochRow; subEpochIds: number[] } | AdminFail> {
    const epoch = await getEpochById(id);
    if (!epoch) return { ok: false, code: 'not_found', error: `epoch ${id} not found` };
    if (epoch.status !== 'registration') {
        return { ok: false, code: 'conflict', error: `can only activate a 'registration' epoch (is '${epoch.status}')` };
    }
    if (epoch.endAt <= epoch.startAt) return bad('epoch endAt must be after startAt');
    const existingActive = await getActiveEpoch();
    if (existingActive) {
        return { ok: false, code: 'conflict', error: `epoch ${existingActive.id} is already active; complete it first` };
    }
    const configErr = validateEpochConfig(epoch.config as EpochConfig);
    if (configErr) return bad(configErr);

    // Atomic: insert sub-epochs + flip status together. A partial failure rolls
    // back fully, so re-running activate works — vs. a non-transactional run
    // that could wedge the epoch (orphan sub-epochs the unique index would then
    // block on retry). The transaction is pure-DB + short (no RPC inside).
    const windows = computeSubEpochWindows(epoch.startAt, epoch.endAt, epoch.subEpochWeeks);
    const { updated, subEpochIds } = await db.transaction(async (tx) => {
        const ids: number[] = [];
        for (const w of windows) {
            const [inserted] = await tx
                .insert(mutagenSubEpochs)
                .values({
                    epochId: epoch.id,
                    subEpochIndex: w.subEpochIndex,
                    startAt: w.startAt,
                    endAt: w.endAt,
                })
                .returning({ id: mutagenSubEpochs.id });
            ids.push(inserted.id);
        }
        const [u] = await tx
            .update(mutagenEpochs)
            .set({ status: 'active' })
            .where(eq(mutagenEpochs.id, epoch.id))
            .returning();
        return { updated: u, subEpochIds: ids };
    });
    return { ok: true, epoch: updated, subEpochIds };
}

export async function completeEpoch(
    id: number,
): Promise<{ ok: true; epoch: EpochRow } | AdminFail> {
    const epoch = await getEpochById(id);
    if (!epoch) return { ok: false, code: 'not_found', error: `epoch ${id} not found` };
    if (epoch.status !== 'active') {
        return { ok: false, code: 'conflict', error: `can only complete an 'active' epoch (is '${epoch.status}')` };
    }
    const [updated] = await db
        .update(mutagenEpochs)
        .set({ status: 'completed' })
        .where(eq(mutagenEpochs.id, id))
        .returning();
    return { ok: true, epoch: updated };
}

// ---------- marketing awards (Activity 5 social / discord) ----------

export interface MarketingAwardInput {
    wallet: string;
    activityType: string;
    amount: number;
    reason?: string;
    awardedBy?: string;
    source?: string;
}

export async function addMarketingAward(
    input: MarketingAwardInput,
): Promise<{ ok: true; awardId: number; subEpochId: number } | AdminFail> {
    if (!input.wallet || !input.activityType) return bad('wallet and activityType are required');
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
        return bad('amount must be a finite number');
    }
    try {
        new PublicKey(input.wallet);
    } catch {
        return bad('invalid wallet address');
    }
    const active = await getActiveSubEpoch(new Date());
    if (!active) return bad('no active sub-epoch to award into');

    const [award] = await db
        .insert(mutagenMarketingAwards)
        .values({
            subEpochId: active.subEpoch.id,
            wallet: input.wallet,
            source: input.source ?? 'admin',
            activityType: input.activityType,
            amount: String(input.amount),
            reason: input.reason ?? null,
            awardedBy: input.awardedBy ?? null,
        })
        .returning({ id: mutagenMarketingAwards.id });
    return { ok: true, awardId: award.id, subEpochId: active.subEpoch.id };
}

// ---------- bootstrap (one-time R2 seeding) ----------

export interface BootstrapSources {
    adrenaLeaderboard: number;
    forgeRegistrations: number;
    unique: number;
}

export interface BootstrapResult {
    ok: boolean;
    error?: string;
    queued?: number;
    scored?: number;
    sources?: BootstrapSources;
}

let isBootstrapRunning = false;

/**
 * Pure-ish gather: Adrena's current leaderboard (top N, client-sliced) UNION
 * the Forge registrants, deduped. No scoring — separated so the gather logic is
 * verifiable without scoring dozens of live wallets.
 */
export async function gatherBootstrapWallets(
    topN: number,
): Promise<{ wallets: string[]; sources: BootstrapSources }> {
    const cappedTopN = Math.min(Math.max(1, topN), 500);
    const adrenaRows = await adrenaClient.getAdrenaMutagenLeaderboard(cappedTopN);
    const forgeRegs = await db.selectDistinct({ wallet: registrations.wallet }).from(registrations);

    const walletSet = new Set<string>();
    for (const r of adrenaRows) walletSet.add(r.user_wallet);
    for (const r of forgeRegs) walletSet.add(r.wallet);
    const wallets = [...walletSet];
    return {
        wallets,
        sources: {
            adrenaLeaderboard: adrenaRows.length,
            forgeRegistrations: forgeRegs.length,
            unique: wallets.length,
        },
    };
}

/**
 * One-time R2 seeding: gather wallets, then score them for the current
 * sub-epoch. Default is fire-and-forget (responds immediately, scores in the
 * background, rate-limit-safe via sequential per-wallet scoring). The on-demand
 * API path remains the source of truth — every wallet is also scored on first
 * search — so this is best-effort warmup, NOT durable across restarts. If
 * recurring re-seeds ever matter, the upgrade is a small queue table processed
 * by the existing scheduler (see commit notes).
 *
 * `background: false` awaits completion — used by the verifier (and small runs)
 * to score deterministically and avoid a teardown race.
 */
export async function bootstrapSeed(
    topN: number,
    opts: { background?: boolean } = {},
): Promise<BootstrapResult> {
    const background = opts.background ?? true;
    if (isBootstrapRunning) return { ok: false, error: 'a bootstrap run is already in progress' };

    const active = await getActiveSubEpoch(new Date());
    if (!active) return { ok: false, error: 'no active sub-epoch; activate an epoch first' };

    const { wallets, sources } = await gatherBootstrapWallets(topN);
    const sub = active.subEpoch;
    const epoch = active.epoch;

    const runScoring = async (): Promise<number> => {
        let scored = 0;
        console.log(`[mutagen-bootstrap] Scoring ${wallets.length} wallets for sub-epoch ${sub.id}...`);
        for (const wallet of wallets) {
            try {
                await scoreWalletForSubEpoch(
                    new PublicKey(wallet),
                    sub.id,
                    sub.startAt,
                    sub.endAt,
                    epoch.config as EpochConfig,
                );
                scored++;
            } catch (e) {
                console.warn(`[mutagen-bootstrap] ${wallet} failed:`, e instanceof Error ? e.message : e);
            }
        }
        console.log(`[mutagen-bootstrap] Done: ${scored}/${wallets.length} scored for sub-epoch ${sub.id}`);
        return scored;
    };

    isBootstrapRunning = true;
    if (background) {
        void (async () => {
            try {
                await runScoring();
            } finally {
                isBootstrapRunning = false;
            }
        })();
        return { ok: true, queued: wallets.length, sources };
    }

    try {
        const scored = await runScoring();
        return { ok: true, queued: wallets.length, scored, sources };
    } finally {
        isBootstrapRunning = false;
    }
}
