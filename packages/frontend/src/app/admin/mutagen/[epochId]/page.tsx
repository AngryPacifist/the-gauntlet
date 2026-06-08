'use client';

// ============================================================================
// /admin/mutagen/[epochId]: epoch detail. Config editor (structured form +
// raw-JSON tab) + lifecycle (activate / complete) + marketing award + bootstrap.
// Config is read-only once activated. Utilitarian admin.
// ============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    adminGetMutagenEpoch,
    adminUpdateMutagenEpochConfig,
    adminActivateMutagenEpoch,
    adminCompleteMutagenEpoch,
    adminMutagenMarketingAward,
    adminMutagenBootstrap,
    adminDeleteMutagenEpoch,
    type MutagenEpoch,
} from '@/lib/api';
import { ChevronLeft, Play, CircleCheck, Save, Megaphone, Rocket, Trash2 } from 'lucide-react';
import styles from '../../page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

// Mirrors backend EpochConfig (services/mutagen-scorer-types.ts). Local to the
// admin form; the wire type (api.ts MutagenEpoch.config) stays Record<string,
// unknown>, so we cast at the read/write boundary. The form covers every field
// (weights, per-activity scalars / multipliers / brackets / increments, meta,
// prize); the Raw-JSON tab remains as a power-user escape.
type UsdBracket = Array<{ minUsd: number; maxUsd: number | null; pts: number }>;
type CountBracket = Array<{ minCount: number; maxCount: number | null; pts: number }>;
type EpochConfig = {
    weights: { a1: number; a2: number; a3: number; a4: number; a5: number };
    activity1: { sizeBrackets: UsdBracket; lockTierMultipliers: Record<string, number>; lockUsdCap: number; mutationIncrements: number[]; qualifyingThreshold: number };
    activity2: { stakeTierMultipliers: Record<string, number>; sizeBrackets: UsdBracket; voteScoreCurve: CountBracket; mutationIncrements: number[]; qualifyingThreshold: number };
    activity3: { mode: 'volume_brackets' | 'wrap_existing_formula'; existingFormulaWeight: number; volumeBrackets: UsdBracket; topPctTiers: Array<{ maxPct: number; pts: number }>; varietyEnabled: boolean; varietyMinVolumePerAsset: number; varietyBrackets: CountBracket; mutationIncrements: number[]; qualifyingThreshold: number };
    activity4: { pools: Array<{ address: string; enabled: boolean; weight: number; label: string }>; sizeBrackets: UsdBracket; mutationIncrements: number[]; qualifyingThreshold: number };
    activity5: { referrerBrackets: UsdBracket; perRefereePts: number; refereeCap: number; mutationIncrements: number[]; qualifyingThreshold: number };
    metaMutationTable: Record<number, number>;
    prizePool: { type: 'fixed' | 'percent_fees'; value: number; denominatedIn: 'ADX' | 'USDC' };
};

// ---- reusable bracket / list editors ----
type BracketRow = { lo: number; hi: number | null; pts: number };
function BracketEditor({ rows, loLabel, hiLabel, locked, onChange }: { rows: BracketRow[]; loLabel: string; hiLabel: string; locked: boolean; onChange: (rows: BracketRow[]) => void }) {
    const set = (i: number, patch: Partial<BracketRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    return (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
            {rows.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px auto', gap: 'var(--space-sm)', alignItems: 'end', marginBottom: 'var(--space-xs)' }}>
                    <div className={styles.formGroup} style={{ marginBottom: 0 }}><label className={styles.formLabel}>{loLabel}</label><input type="number" className="input" value={r.lo} disabled={locked} onChange={(e) => set(i, { lo: Number(e.target.value) })} /></div>
                    <div className={styles.formGroup} style={{ marginBottom: 0 }}><label className={styles.formLabel}>{hiLabel}</label><input type="number" className="input" placeholder="∞ open" value={r.hi ?? ''} disabled={locked} onChange={(e) => set(i, { hi: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                    <div className={styles.formGroup} style={{ marginBottom: 0 }}><label className={styles.formLabel}>pts</label><input type="number" className="input" value={r.pts} disabled={locked} onChange={(e) => set(i, { pts: Number(e.target.value) })} /></div>
                    <button type="button" className="btn btn--danger" disabled={locked} onClick={() => onChange(rows.filter((_, idx) => idx !== i))} style={{ height: 38 }} aria-label="remove row">×</button>
                </div>
            ))}
            {!locked && <button type="button" className="btn btn--secondary" onClick={() => onChange([...rows, { lo: 0, hi: null, pts: 0 }])}>+ row</button>}
        </div>
    );
}
function TopPctEditor({ rows, locked, onChange }: { rows: Array<{ maxPct: number; pts: number }>; locked: boolean; onChange: (rows: Array<{ maxPct: number; pts: number }>) => void }) {
    const set = (i: number, patch: Partial<{ maxPct: number; pts: number }>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    return (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
            {rows.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 'var(--space-sm)', alignItems: 'end', marginBottom: 'var(--space-xs)' }}>
                    <div className={styles.formGroup} style={{ marginBottom: 0 }}><label className={styles.formLabel}>max percentile (0–1)</label><input type="number" step="0.01" className="input" value={r.maxPct} disabled={locked} onChange={(e) => set(i, { maxPct: Number(e.target.value) })} /></div>
                    <div className={styles.formGroup} style={{ marginBottom: 0 }}><label className={styles.formLabel}>pts</label><input type="number" className="input" value={r.pts} disabled={locked} onChange={(e) => set(i, { pts: Number(e.target.value) })} /></div>
                    <button type="button" className="btn btn--danger" disabled={locked} onClick={() => onChange(rows.filter((_, idx) => idx !== i))} style={{ height: 38 }} aria-label="remove tier">×</button>
                </div>
            ))}
            {!locked && <button type="button" className="btn btn--secondary" onClick={() => onChange([...rows, { maxPct: 0, pts: 0 }])}>+ tier</button>}
        </div>
    );
}
function NumListEditor({ values, locked, onChange }: { values: number[]; locked: boolean; onChange: (v: number[]) => void }) {
    return (
        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
            {values.map((v, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <input type="number" step="0.1" className="input" style={{ width: 80 }} value={v} disabled={locked} onChange={(e) => onChange(values.map((x, idx) => (idx === i ? Number(e.target.value) : x)))} />
                    {!locked && <button type="button" className="btn btn--danger" onClick={() => onChange(values.filter((_, idx) => idx !== i))} aria-label="remove" style={{ padding: '2px 8px' }}>×</button>}
                </span>
            ))}
            {!locked && <button type="button" className="btn btn--secondary" onClick={() => onChange([...values, 0])} style={{ padding: '2px 10px' }}>+</button>}
        </div>
    );
}

export default function AdminMutagenEpochPage() {
    const params = useParams();
    const router = useRouter();
    const epochId = Number(Array.isArray(params.epochId) ? params.epochId[0] : params.epochId);

    const [secret, setSecret] = useState('');
    const [hydrated, setHydrated] = useState(false);
    const [epoch, setEpoch] = useState<MutagenEpoch | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

    const [config, setConfig] = useState<EpochConfig | null>(null);
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonDraft, setJsonDraft] = useState('');
    const [busy, setBusy] = useState<string | null>(null);

    // forms
    const [awWallet, setAwWallet] = useState('');
    const [awType, setAwType] = useState('social-twitter');
    const [awAmount, setAwAmount] = useState('');
    const [awReason, setAwReason] = useState('');
    const [topN, setTopN] = useState('100');

    useEffect(() => {
        const s = localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
        setSecret(s);
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated || !secret || !Number.isFinite(epochId)) return;
        let cancelled = false;
        setEpoch(null);
        setErr(null);
        adminGetMutagenEpoch(epochId, secret)
            .then((e) => {
                if (cancelled) return;
                setEpoch(e);
                setConfig(e.config as unknown as EpochConfig);
                setJsonDraft(JSON.stringify(e.config, null, 2));
            })
            .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load epoch'); });
        return () => { cancelled = true; };
    }, [hydrated, secret, epochId]);

    function showToast(msg: string, type: 'success' | 'error') {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4500);
    }

    async function reload() {
        try {
            const e = await adminGetMutagenEpoch(epochId, secret);
            setEpoch(e);
        } catch { /* keep previous */ }
    }

    async function run(label: string, fn: () => Promise<void>) {
        setBusy(label);
        try {
            await fn();
        } catch (e) {
            showToast(e instanceof Error ? e.message : `${label} failed`, 'error');
        } finally {
            setBusy(null);
        }
    }

    // ---- structured config updaters ----
    function setW(k: 'a1' | 'a2' | 'a3' | 'a4' | 'a5', v: number) {
        setConfig((c) => (c ? { ...c, weights: { ...c.weights, [k]: v } } : c));
    }
    function setMeta(n: number, v: number) {
        setConfig((c) => (c ? { ...c, metaMutationTable: { ...c.metaMutationTable, [n]: v } } : c));
    }
    function setPrize(p: Partial<EpochConfig['prizePool']>) {
        setConfig((c) => (c ? { ...c, prizePool: { ...c.prizePool, ...p } } : c));
    }
    function setA1(p: Partial<EpochConfig['activity1']>) {
        setConfig((c) => (c ? { ...c, activity1: { ...c.activity1, ...p } } : c));
    }
    function setA2(p: Partial<EpochConfig['activity2']>) {
        setConfig((c) => (c ? { ...c, activity2: { ...c.activity2, ...p } } : c));
    }
    function setA3(p: Partial<EpochConfig['activity3']>) {
        setConfig((c) => (c ? { ...c, activity3: { ...c.activity3, ...p } } : c));
    }
    function setA4(p: Partial<Omit<EpochConfig['activity4'], 'pools'>>) {
        setConfig((c) => (c ? { ...c, activity4: { ...c.activity4, ...p } } : c));
    }
    function setA4Pool(i: number, p: Partial<EpochConfig['activity4']['pools'][number]>) {
        setConfig((c) => (c ? { ...c, activity4: { ...c.activity4, pools: c.activity4.pools.map((pool, idx) => (idx === i ? { ...pool, ...p } : pool)) } } : c));
    }
    function setA5(p: Partial<EpochConfig['activity5']>) {
        setConfig((c) => (c ? { ...c, activity5: { ...c.activity5, ...p } } : c));
    }
    function setLockMult(tier: string, v: number) {
        setConfig((c) => (c ? { ...c, activity1: { ...c.activity1, lockTierMultipliers: { ...c.activity1.lockTierMultipliers, [tier]: v } } } : c));
    }
    function setStakeMult(tier: string, v: number) {
        setConfig((c) => (c ? { ...c, activity2: { ...c.activity2, stakeTierMultipliers: { ...c.activity2.stakeTierMultipliers, [tier]: v } } } : c));
    }

    function applyJson() {
        try {
            setConfig(JSON.parse(jsonDraft) as EpochConfig);
            showToast('JSON applied to the form', 'success');
        } catch {
            showToast('Config is not valid JSON', 'error');
        }
    }

    function saveConfig() {
        run('save', async () => {
            let next: EpochConfig | null = config;
            if (jsonMode) {
                try {
                    next = JSON.parse(jsonDraft) as EpochConfig;
                } catch {
                    showToast('Config is not valid JSON', 'error');
                    return;
                }
                setConfig(next);
            }
            if (!next) return;
            const w = next.weights;
            if (!w) {
                showToast('config.weights is missing', 'error');
                return;
            }
            const sum = w.a1 + w.a2 + w.a3 + w.a4 + w.a5;
            if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-6) {
                showToast(`Weights must sum to 1.0 (currently ${Number.isFinite(sum) ? sum.toFixed(4) : 'NaN'})`, 'error');
                return;
            }
            await adminUpdateMutagenEpochConfig(epochId, next as unknown as Record<string, unknown>, secret);
            showToast('Config saved', 'success');
            reload();
        });
    }

    function activate() {
        run('activate', async () => {
            const res = await adminActivateMutagenEpoch(epochId, secret);
            showToast(`Activated · ${res.subEpochIds.length} sub-epochs generated`, 'success');
            reload();
        });
    }

    function complete() {
        run('complete', async () => {
            await adminCompleteMutagenEpoch(epochId, secret);
            showToast('Epoch completed', 'success');
            reload();
        });
    }

    function award(e: FormEvent) {
        e.preventDefault();
        run('award', async () => {
            const amount = Number(awAmount);
            if (!awWallet || !awType || !Number.isFinite(amount)) {
                showToast('Wallet, type and a numeric amount are required', 'error');
                return;
            }
            const res = await adminMutagenMarketingAward({ wallet: awWallet, activityType: awType, amount, reason: awReason || undefined }, secret);
            showToast(`Awarded ${amount} to sub-epoch #${res.subEpochId}`, 'success');
            setAwWallet(''); setAwAmount(''); setAwReason('');
        });
    }

    function bootstrap(e: FormEvent) {
        e.preventDefault();
        run('bootstrap', async () => {
            const n = Number(topN) || 100;
            const res = await adminMutagenBootstrap(n, secret);
            showToast(`Bootstrap queued ${res.queued} wallets (${res.sources.adrenaLeaderboard} Adrena + ${res.sources.forgeRegistrations} Forge)`, 'success');
        });
    }

    function remove() {
        if (!epoch) return;
        if (!window.confirm(`Delete "${epoch.name}" and ALL its sub-epochs, scores, snapshots, and marketing awards? This cannot be undone.`)) return;
        run('delete', async () => {
            await adminDeleteMutagenEpoch(epochId, secret);
            router.push('/admin/mutagen');
        });
    }

    if (!hydrated) return <div className="container"><div className="loading-state"><div className="spinner" /></div></div>;
    if (!secret) {
        return (
            <div className="container">
                <Link href="/admin/mutagen" className={styles.adminHeaderLink}><ChevronLeft size={14} /> Epochs</Link>
                <div className="card empty-state" style={{ marginTop: 'var(--space-lg)' }}><p>Enter your admin secret on the <Link href="/admin/mutagen">epoch list</Link> first.</p></div>
            </div>
        );
    }

    return (
        <div className="container">
            {toast && (
                <div className={`${styles.toast} ${toast.type === 'success' ? styles.toast_success : styles.toast_error}`}>
                    {toast.msg}
                    <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
                </div>
            )}

            <Link href="/admin/mutagen" className={styles.adminHeaderLink}><ChevronLeft size={14} /> Epochs</Link>

            {err && <div className="card error-state"><p>{err}</p></div>}
            {!err && !epoch && <div className="loading-state"><div className="spinner" /><p>Loading…</p></div>}

            {epoch && (
                <>
                    <header className="page-header" style={{ paddingTop: 0 }}>
                        <h1 className="page-header__title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                            {epoch.name}
                            <span className={`badge badge--${epoch.status}`}>{epoch.status}</span>
                        </h1>
                        <p className="page-header__subtitle">
                            Epoch #{epoch.id} · {epoch.subEpochWeeks}-week sub-epochs
                        </p>
                    </header>

                    {/* lifecycle */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>Lifecycle</h2>
                        <div className={styles.controlActions}>
                            <button
                                className="btn btn--primary"
                                disabled={epoch.status !== 'registration' || busy !== null}
                                onClick={activate}
                            >
                                <Play size={16} /> {busy === 'activate' ? 'Activating…' : 'Activate'}
                            </button>
                            <button
                                className="btn btn--secondary"
                                disabled={epoch.status !== 'active' || busy !== null}
                                onClick={complete}
                            >
                                <CircleCheck size={16} /> {busy === 'complete' ? 'Completing…' : 'Complete'}
                            </button>
                            <span className={styles.completedText}>
                                {epoch.status === 'registration' && 'Activate to generate sub-epochs and open scoring.'}
                                {epoch.status === 'active' && 'Scoring is live for this epoch.'}
                                {epoch.status === 'completed' && 'This epoch is closed.'}
                            </span>
                        </div>
                    </section>

                    {/* config */}
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2 className={styles.sectionTitle}>Config</h2>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <button
                                    className="btn btn--secondary"
                                    type="button"
                                    onClick={() => { if (!jsonMode && config) setJsonDraft(JSON.stringify(config, null, 2)); setJsonMode(!jsonMode); }}
                                    disabled={!config}
                                >
                                    {jsonMode ? 'Form view' : 'Raw JSON'}
                                </button>
                                <button className="btn btn--primary" onClick={saveConfig} disabled={busy !== null || epoch.status !== 'registration' || !config}>
                                    <Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save config'}
                                </button>
                            </div>
                        </div>

                        {epoch.status !== 'registration' && (
                            <p className={styles.formHint} style={{ marginBottom: 'var(--space-md)' }}>
                                Config is frozen: editing is only allowed while the epoch is in registration. Activation locks the ruleset.
                            </p>
                        )}

                        {!config && <p className={styles.emptyText}>Loading config…</p>}

                        {config && jsonMode && (
                            <>
                                <textarea
                                    className="input input--mono"
                                    value={jsonDraft}
                                    onChange={(e) => setJsonDraft(e.target.value)}
                                    readOnly={epoch.status !== 'registration'}
                                    spellCheck={false}
                                    style={{ minHeight: 360, resize: 'vertical', lineHeight: 1.5, whiteSpace: 'pre', width: '100%' }}
                                />
                                <div style={{ marginTop: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                    <button className="btn btn--secondary" type="button" onClick={applyJson} disabled={epoch.status !== 'registration'}>Apply JSON to form</button>
                                    <span className={styles.formHint} style={{ margin: 0 }}>Edit brackets / increments here, Apply, then Save.</span>
                                </div>
                            </>
                        )}

                        {config && !jsonMode && (() => {
                            const c = config!;
                            const locked = epoch.status !== 'registration';
                            const wsum = c.weights.a1 + c.weights.a2 + c.weights.a3 + c.weights.a4 + c.weights.a5;
                            const wok = Math.abs(wsum - 1) < 1e-6;
                            const wLabels = ['LP', 'Staking', 'Trading', 'ADX-LP', 'Marketing'];
                            return (
                                <>
                                    <div className={styles.formSectionTitle}>
                                        Weights
                                        <span style={{ marginLeft: 8, color: wok ? 'var(--status-success)' : 'var(--status-danger)' }}>
                                            Σ {wsum.toFixed(2)} {wok ? '✓' : ': must equal 1.0'}
                                        </span>
                                    </div>
                                    <div className={styles.formGrid}>
                                        {(['a1', 'a2', 'a3', 'a4', 'a5'] as const).map((k, i) => (
                                            <div className={styles.formGroup} key={k}>
                                                <label className={styles.formLabel}>{wLabels[i]} ({k})</label>
                                                <input type="number" step="0.01" className="input" value={c.weights[k]} disabled={locked} onChange={(e) => setW(k, Number(e.target.value))} />
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Meta-mutation (qualified Activities → multiplier)</div>
                                    <div className={styles.formGrid}>
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <div className={styles.formGroup} key={n}>
                                                <label className={styles.formLabel}>{n} qualified</label>
                                                <input type="number" step="0.01" className="input" value={c.metaMutationTable[n] ?? 1} disabled={locked} onChange={(e) => setMeta(n, Number(e.target.value))} />
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Prize pool</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Type</label>
                                            <select className="input" value={c.prizePool.type} disabled={locked} onChange={(e) => setPrize({ type: e.target.value as 'fixed' | 'percent_fees' })}>
                                                <option value="fixed">fixed</option>
                                                <option value="percent_fees">percent_fees</option>
                                            </select>
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Value</label>
                                            <input type="number" className="input" value={c.prizePool.value} disabled={locked} onChange={(e) => setPrize({ value: Number(e.target.value) })} />
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Denominated in</label>
                                            <select className="input" value={c.prizePool.denominatedIn} disabled={locked} onChange={(e) => setPrize({ denominatedIn: e.target.value as 'ADX' | 'USDC' })}>
                                                <option value="ADX">ADX</option>
                                                <option value="USDC">USDC</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Activity 1 — LP minting</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Qualifying threshold</label><input type="number" className="input" value={c.activity1.qualifyingThreshold} disabled={locked} onChange={(e) => setA1({ qualifyingThreshold: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Per-lock USD cap</label><input type="number" className="input" value={c.activity1.lockUsdCap} disabled={locked} onChange={(e) => setA1({ lockUsdCap: Number(e.target.value) })} /></div>
                                        {['30', '90', '180', '360'].map((t) => (
                                            <div className={styles.formGroup} key={t}><label className={styles.formLabel}>Lock {t}d ×</label><input type="number" step="0.1" className="input" value={c.activity1.lockTierMultipliers[t] ?? 1} disabled={locked} onChange={(e) => setLockMult(t, Number(e.target.value))} /></div>
                                        ))}
                                    </div>
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-md)' }}>Size brackets (USD)</label>
                                    <BracketEditor rows={c.activity1.sizeBrackets.map((b) => ({ lo: b.minUsd, hi: b.maxUsd, pts: b.pts }))} loLabel="min USD" hiLabel="max USD" locked={locked} onChange={(rows) => setA1({ sizeBrackets: rows.map((r) => ({ minUsd: r.lo, maxUsd: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Mutation increments (per extra qualified dim)</label>
                                    <NumListEditor values={c.activity1.mutationIncrements} locked={locked} onChange={(v) => setA1({ mutationIncrements: v })} />

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Activity 2 — Staking + Voting</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Qualifying threshold</label><input type="number" className="input" value={c.activity2.qualifyingThreshold} disabled={locked} onChange={(e) => setA2({ qualifyingThreshold: Number(e.target.value) })} /></div>
                                        {['0', '90', '180', '360', '540'].map((t) => (
                                            <div className={styles.formGroup} key={t}><label className={styles.formLabel}>Stake {t}d ×</label><input type="number" step="0.1" className="input" value={c.activity2.stakeTierMultipliers[t] ?? 1} disabled={locked} onChange={(e) => setStakeMult(t, Number(e.target.value))} /></div>
                                        ))}
                                    </div>
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-md)' }}>Size brackets (USD)</label>
                                    <BracketEditor rows={c.activity2.sizeBrackets.map((b) => ({ lo: b.minUsd, hi: b.maxUsd, pts: b.pts }))} loLabel="min USD" hiLabel="max USD" locked={locked} onChange={(rows) => setA2({ sizeBrackets: rows.map((r) => ({ minUsd: r.lo, maxUsd: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Vote-score curve (vote count → pts)</label>
                                    <BracketEditor rows={c.activity2.voteScoreCurve.map((b) => ({ lo: b.minCount, hi: b.maxCount, pts: b.pts }))} loLabel="min count" hiLabel="max count" locked={locked} onChange={(rows) => setA2({ voteScoreCurve: rows.map((r) => ({ minCount: r.lo, maxCount: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Mutation increments</label>
                                    <NumListEditor values={c.activity2.mutationIncrements} locked={locked} onChange={(v) => setA2({ mutationIncrements: v })} />

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Activity 3 — Trading</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Qualifying threshold</label><input type="number" className="input" value={c.activity3.qualifyingThreshold} disabled={locked} onChange={(e) => setA3({ qualifyingThreshold: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Volume mode</label><select className="input" value={c.activity3.mode} disabled={locked} onChange={(e) => setA3({ mode: e.target.value as 'volume_brackets' | 'wrap_existing_formula' })}><option value="wrap_existing_formula">wrap_existing_formula</option><option value="volume_brackets">volume_brackets</option></select></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Existing-formula weight</label><input type="number" step="0.1" className="input" value={c.activity3.existingFormulaWeight} disabled={locked} onChange={(e) => setA3({ existingFormulaWeight: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Variety min volume / asset</label><input type="number" className="input" value={c.activity3.varietyMinVolumePerAsset} disabled={locked} onChange={(e) => setA3({ varietyMinVolumePerAsset: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Asset variety</label><label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}><input type="checkbox" checked={c.activity3.varietyEnabled} disabled={locked} onChange={(e) => setA3({ varietyEnabled: e.target.checked })} /> enabled</label></div>
                                    </div>
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-md)' }}>Volume brackets (USD)</label>
                                    <BracketEditor rows={c.activity3.volumeBrackets.map((b) => ({ lo: b.minUsd, hi: b.maxUsd, pts: b.pts }))} loLabel="min USD" hiLabel="max USD" locked={locked} onChange={(rows) => setA3({ volumeBrackets: rows.map((r) => ({ minUsd: r.lo, maxUsd: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Forge top-% tiers</label>
                                    <TopPctEditor rows={c.activity3.topPctTiers} locked={locked} onChange={(rows) => setA3({ topPctTiers: rows })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Variety brackets (distinct assets → pts)</label>
                                    <BracketEditor rows={c.activity3.varietyBrackets.map((b) => ({ lo: b.minCount, hi: b.maxCount, pts: b.pts }))} loLabel="min count" hiLabel="max count" locked={locked} onChange={(rows) => setA3({ varietyBrackets: rows.map((r) => ({ minCount: r.lo, maxCount: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Mutation increments</label>
                                    <NumListEditor values={c.activity3.mutationIncrements} locked={locked} onChange={(v) => setA3({ mutationIncrements: v })} />

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Activity 4 — ADX-LP pools</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Qualifying threshold</label><input type="number" className="input" value={c.activity4.qualifyingThreshold} disabled={locked} onChange={(e) => setA4({ qualifyingThreshold: Number(e.target.value) })} /></div>
                                    </div>
                                    {c.activity4.pools.map((pool, i) => (
                                        <div key={pool.address} className={styles.formGrid} style={{ alignItems: 'end', marginBottom: 'var(--space-sm)' }}>
                                            <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                                <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <input type="checkbox" checked={pool.enabled} disabled={locked} onChange={(e) => setA4Pool(i, { enabled: e.target.checked })} /> {pool.label}
                                                </label>
                                                <span className={styles.controlId}>{pool.address.slice(0, 14)}…</span>
                                            </div>
                                            <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                                <label className={styles.formLabel}>Weight</label>
                                                <input type="number" step="0.1" className="input" value={pool.weight} disabled={locked} onChange={(e) => setA4Pool(i, { weight: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    ))}
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-md)' }}>Size brackets (USD)</label>
                                    <BracketEditor rows={c.activity4.sizeBrackets.map((b) => ({ lo: b.minUsd, hi: b.maxUsd, pts: b.pts }))} loLabel="min USD" hiLabel="max USD" locked={locked} onChange={(rows) => setA4({ sizeBrackets: rows.map((r) => ({ minUsd: r.lo, maxUsd: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Mutation increments</label>
                                    <NumListEditor values={c.activity4.mutationIncrements} locked={locked} onChange={(v) => setA4({ mutationIncrements: v })} />

                                    <div className={styles.formDivider} />
                                    <div className={styles.formSectionTitle}>Activity 5 — Marketing</div>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Qualifying threshold</label><input type="number" className="input" value={c.activity5.qualifyingThreshold} disabled={locked} onChange={(e) => setA5({ qualifyingThreshold: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Per-referee points</label><input type="number" className="input" value={c.activity5.perRefereePts} disabled={locked} onChange={(e) => setA5({ perRefereePts: Number(e.target.value) })} /></div>
                                        <div className={styles.formGroup}><label className={styles.formLabel}>Referee cap</label><input type="number" className="input" value={c.activity5.refereeCap} disabled={locked} onChange={(e) => setA5({ refereeCap: Number(e.target.value) })} /></div>
                                    </div>
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-md)' }}>Referrer brackets (epoch USDC earned → pts)</label>
                                    <BracketEditor rows={c.activity5.referrerBrackets.map((b) => ({ lo: b.minUsd, hi: b.maxUsd, pts: b.pts }))} loLabel="min USD" hiLabel="max USD" locked={locked} onChange={(rows) => setA5({ referrerBrackets: rows.map((r) => ({ minUsd: r.lo, maxUsd: r.hi, pts: r.pts })) })} />
                                    <label className={styles.formLabel} style={{ marginTop: 'var(--space-sm)' }}>Mutation increments</label>
                                    <NumListEditor values={c.activity5.mutationIncrements} locked={locked} onChange={(v) => setA5({ mutationIncrements: v })} />

                                    <span className={styles.formHint}>The Raw JSON tab remains as a power-user escape. Weights must sum to 1.0 to save.</span>
                                </>
                            );
                        })()}
                    </section>

                    {/* marketing award */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}><Megaphone size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Marketing award (Activity 5)</h2>
                        <form onSubmit={award}>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Wallet</label>
                                    <input className="input input--mono" value={awWallet} onChange={(e) => setAwWallet(e.target.value)} placeholder="wallet address" />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Activity type</label>
                                    <input className="input" value={awType} onChange={(e) => setAwType(e.target.value)} placeholder="social-twitter / discord-event" />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Amount (points)</label>
                                    <input type="number" className="input" value={awAmount} onChange={(e) => setAwAmount(e.target.value)} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Reason (optional)</label>
                                    <input className="input" value={awReason} onChange={(e) => setAwReason(e.target.value)} />
                                </div>
                            </div>
                            <button type="submit" className="btn btn--secondary" disabled={busy !== null || epoch.status !== 'active'}>
                                {busy === 'award' ? 'Awarding…' : 'Award points'}
                            </button>
                            <span className={styles.formHint} style={{ marginLeft: 'var(--space-md)' }}>
                                Awards land in the current sub-epoch · requires an active epoch · the wallet&apos;s score refreshes within seconds.
                            </span>
                        </form>
                    </section>

                    {/* bootstrap */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}><Rocket size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Bootstrap (one-time seed)</h2>
                        <form onSubmit={bootstrap} className={styles.secretRow}>
                            <input type="number" min={1} className="input" style={{ maxWidth: 140 }} value={topN} onChange={(e) => setTopN(e.target.value)} />
                            <button type="submit" className="btn btn--secondary" disabled={busy !== null || epoch.status !== 'active'}>
                                {busy === 'bootstrap' ? 'Queuing…' : 'Seed wallets'}
                            </button>
                            <span className={styles.secretHint}>Scores top-N Adrena-leaderboard + Forge wallets in the background. Best-effort warmup.</span>
                        </form>
                    </section>

                    {/* danger zone */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>Danger zone</h2>
                        <div className={styles.controlActions}>
                            <button className="btn btn--danger" disabled={busy !== null} onClick={remove}>
                                <Trash2 size={16} /> {busy === 'delete' ? 'Deleting…' : 'Delete epoch'}
                            </button>
                            <span className={styles.completedText}>
                                Permanently removes this epoch and all its sub-epochs, scores, snapshots, and awards.
                            </span>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
