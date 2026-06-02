'use client';

// ============================================================================
// /admin/mutagen — epoch list + create. Utilitarian admin tooling; reuses the
// existing admin modal/toast/form classes. ADMIN_SECRET via localStorage,
// shared with the rest of /admin.
// ============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
    adminListMutagenEpochs,
    adminCreateMutagenEpoch,
    type MutagenEpoch,
} from '@/lib/api';
import { Dna, Plus, ChevronRight, ChevronLeft, Lock, Unlock } from 'lucide-react';
import styles from '../page.module.css';
import local from './page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminMutagenPage() {
    const [secret, setSecret] = useState('');
    const [hydrated, setHydrated] = useState(false);
    const [epochs, setEpochs] = useState<MutagenEpoch[] | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

    // create-form fields
    const [name, setName] = useState('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [weeks, setWeeks] = useState('3');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const s = localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
        setSecret(s);
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated || !secret) return;
        let cancelled = false;
        setEpochs(null);
        setErr(null);
        adminListMutagenEpochs(secret)
            .then((e) => { if (!cancelled) setEpochs(e); })
            .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load epochs'); });
        return () => { cancelled = true; };
    }, [hydrated, secret]);

    function saveSecret(v: string) {
        setSecret(v);
        if (v) localStorage.setItem(ADMIN_SECRET_KEY, v);
        else localStorage.removeItem(ADMIN_SECRET_KEY);
    }

    function showToast(msg: string, type: 'success' | 'error') {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    }

    async function refresh() {
        try {
            setEpochs(await adminListMutagenEpochs(secret));
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'Failed to refresh', 'error');
        }
    }

    async function create(e: FormEvent) {
        e.preventDefault();
        if (!name || !startAt || !endAt) return;
        setSubmitting(true);
        try {
            await adminCreateMutagenEpoch(
                {
                    name,
                    startAt: new Date(startAt).toISOString(),
                    endAt: new Date(endAt).toISOString(),
                    subEpochWeeks: Number(weeks) || 3,
                },
                secret,
            );
            setShowCreate(false);
            setName(''); setStartAt(''); setEndAt(''); setWeeks('3');
            showToast('Epoch created', 'success');
            refresh();
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'Create failed', 'error');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="container">
            {toast && (
                <div className={`${styles.toast} ${toast.type === 'success' ? styles.toast_success : styles.toast_error}`}>
                    {toast.msg}
                    <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
                </div>
            )}

            <Link href="/admin" className={styles.adminHeaderLink}><ChevronLeft size={14} /> Admin</Link>
            <header className="page-header" style={{ paddingTop: 0 }}>
                <h1 className="page-header__title">
                    <Dna size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Mutagen Epochs
                </h1>
                <p className="page-header__subtitle">Create, configure, and run R2 scoring epochs.</p>
            </header>

            {/* secret */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Authentication</h2>
                <div className={styles.secretRow}>
                    <input
                        type="password"
                        className="input input--mono"
                        placeholder="Enter admin secret…"
                        value={secret}
                        onChange={(e) => saveSecret(e.target.value)}
                    />
                    <span className={styles.secretHint}>
                        {hydrated && secret
                            ? <><Unlock size={14} style={{ color: 'var(--status-success)', marginRight: 4, verticalAlign: 'middle' }} /> Authenticated</>
                            : <><Lock size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Required</>}
                    </span>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Epochs</h2>
                    <button className="btn btn--primary" onClick={() => setShowCreate(true)} disabled={!secret}>
                        <Plus size={16} /> Create epoch
                    </button>
                </div>

                {!secret && <p className={styles.emptyText}>Enter your admin secret to manage epochs.</p>}
                {secret && err && <div className="card error-state"><p>{err}</p></div>}
                {secret && !err && !epochs && <div className="loading-state"><div className="spinner" /><p>Loading…</p></div>}
                {secret && epochs && epochs.length === 0 && <p className={styles.emptyText}>No epochs yet. Create one to begin.</p>}

                {epochs && epochs.map((ep) => (
                    <Link key={ep.id} href={`/admin/mutagen/${ep.id}`} className={`card card--hoverable ${local.epochCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <div className={styles.controlName}>{ep.name}</div>
                                <div className={styles.controlId}>
                                    #{ep.id} · {fmtDate(ep.startAt)} → {fmtDate(ep.endAt)} · {ep.subEpochWeeks}-week sub-epochs
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                <span className={`badge badge--${ep.status}`}>{ep.status}</span>
                                <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                            </div>
                        </div>
                    </Link>
                ))}
            </section>

            {showCreate && (
                <div className={styles.modalOverlay} onClick={() => setShowCreate(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <span className={styles.modalTitle}>Create epoch</span>
                            <button className={styles.modalClose} onClick={() => setShowCreate(false)}>×</button>
                        </div>
                        <form className={styles.modalForm} onSubmit={create}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Name</label>
                                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mutagen Epoch 1" required />
                            </div>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Start</label>
                                    <input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>End</label>
                                    <input type="datetime-local" className="input" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
                                </div>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Sub-epoch length (weeks)</label>
                                <input type="number" min={1} className="input" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
                                <span className={styles.formHint}>Config defaults to the standard 30/5/30/30/5 weights — tune it after creating, on the epoch page.</span>
                            </div>
                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create epoch'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
