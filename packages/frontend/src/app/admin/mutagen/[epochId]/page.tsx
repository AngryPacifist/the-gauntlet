'use client';

// ============================================================================
// /admin/mutagen/[epochId] — epoch detail: config (JSON) editor + lifecycle
// (activate / complete) + marketing award + bootstrap. Utilitarian admin.
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

export default function AdminMutagenEpochPage() {
    const params = useParams();
    const router = useRouter();
    const epochId = Number(Array.isArray(params.epochId) ? params.epochId[0] : params.epochId);

    const [secret, setSecret] = useState('');
    const [hydrated, setHydrated] = useState(false);
    const [epoch, setEpoch] = useState<MutagenEpoch | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

    const [configText, setConfigText] = useState('');
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
                setConfigText(JSON.stringify(e.config, null, 2));
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

    function saveConfig() {
        run('save', async () => {
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(configText);
            } catch {
                showToast('Config is not valid JSON', 'error');
                return;
            }
            await adminUpdateMutagenEpochConfig(epochId, parsed, secret);
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
                            <h2 className={styles.sectionTitle}>Config (JSON)</h2>
                            <button className="btn btn--primary" onClick={saveConfig} disabled={busy !== null || epoch.status !== 'registration'}>
                                <Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save config'}
                            </button>
                        </div>
                        <textarea
                            className="input input--mono"
                            value={configText}
                            onChange={(e) => setConfigText(e.target.value)}
                            readOnly={epoch.status !== 'registration'}
                            spellCheck={false}
                            style={{ minHeight: 360, resize: 'vertical', lineHeight: 1.5, whiteSpace: 'pre' }}
                        />
                        <span className={styles.formHint}>Weights must sum to 1.0 to activate. Config is locked once the epoch is activated — the ruleset is frozen for the life of the epoch.</span>
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
