'use client';

// ============================================================================
// Admin Seasons
//
// Season CRUD + lifecycle (create, start, advance week, complete).
//
// Admin secret: shared via localStorage (key 'adrena_admin_secret').
// Modal-internal-draft pattern preserved.
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
    listSeasons,
    adminCreateSeason,
    adminStartSeason,
    adminAdvanceSeason,
    adminCompleteSeason,
    type Season,
} from '@/lib/api';
import {
    Layers, Plus, Play, ChevronRight, ExternalLink, Terminal,
    Flag, Trophy, Lock, ArrowLeft,
} from 'lucide-react';
import styles from '../page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

function readSecret(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
}

export default function AdminSeasonsPage() {
    const [seasons, setSeasons] = useState<Season[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create season modal
    const [showSeasonModal, setShowSeasonModal] = useState(false);
    const [seasonName, setSeasonName] = useState('');
    const [seasonWeeks, setSeasonWeeks] = useState(3);
    const [seasonQualSlots, setSeasonQualSlots] = useState(4);
    const [creatingSeason, setCreatingSeason] = useState(false);
    const [seasonSecretDraft, setSeasonSecretDraft] = useState('');

    // Action feedback
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [actionLoading, setActionLoading] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    function addLog(msg: string) {
        setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    function commitSecret(value: string) {
        setAdminSecret(value);
        if (value) {
            localStorage.setItem(ADMIN_SECRET_KEY, value);
        } else {
            localStorage.removeItem(ADMIN_SECRET_KEY);
        }
    }

    useEffect(() => {
        setAdminSecret(readSecret());
    }, []);

    useEffect(() => {
        if (!showSeasonModal) setSeasonSecretDraft('');
    }, [showSeasonModal]);

    async function loadAll() {
        try {
            setLoading(true);
            const s = await listSeasons();
            setSeasons(s);
        } catch {
            addLog('Failed to load seasons');
            showToast('Failed to load seasons', 'error');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadAll(); }, []);

    async function handleCreateSeason(e: React.FormEvent) {
        e.preventDefault();
        const effectiveSecret = adminSecret || seasonSecretDraft;
        if (!effectiveSecret) { showToast('Admin secret required', 'error'); return; }
        if (!seasonName.trim()) return;
        try {
            setCreatingSeason(true);
            const result = await adminCreateSeason(seasonName.trim(), {
                weekCount: seasonWeeks,
                qualificationSlots: seasonQualSlots,
            }, effectiveSecret);
            if (!adminSecret && seasonSecretDraft) {
                commitSecret(seasonSecretDraft);
                setSeasonSecretDraft('');
            }
            addLog(`Created season "${seasonName}" (id: ${result.id}): ${seasonWeeks} weeks, ${seasonQualSlots} qual slots`);
            showToast(`Season "${seasonName}" created`, 'success');
            setSeasonName('');
            setShowSeasonModal(false);
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create season';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setCreatingSeason(false); }
    }

    async function handleStartSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminStartSeason(seasonId, adminSecret);
            addLog(`Started season "${name}" → Week 1 tournament #${result.tournamentId}`);
            showToast(`Season "${name}" started`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to start season';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleAdvanceSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminAdvanceSeason(seasonId, adminSecret);
            if (result.nextTournamentId) {
                addLog(`Advanced season "${name}" → Next tournament #${result.nextTournamentId}`);
            } else {
                addLog(`Season "${name}" status: ${result.seasonStatus}`);
            }
            showToast(`Season advanced`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to advance season';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleCompleteSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!confirm(`Complete season "${name}"? This finalizes standings.`)) return;
        try {
            setActionLoading(true);
            await adminCompleteSeason(seasonId, adminSecret);
            addLog(`Completed season "${name}"`);
            showToast(`Season "${name}" completed`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to complete season';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    return (
        <div className="container">
            {toast && (
                <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
                    <span>{toast.message}</span>
                    <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
                </div>
            )}

            <header className="page-header">
                <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.8125rem', textDecoration: 'none', marginBottom: 'var(--space-sm)' }}>
                    <ArrowLeft size={14} /> Back to Admin
                </Link>
                <h1 className="page-header__title">
                    <Layers size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Seasons
                </h1>
                <p className="page-header__subtitle">
                    Multi-week season lifecycle: create, start, advance week, complete.
                </p>
            </header>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Season Controls</h2>
                    <button className="btn btn--primary" onClick={() => setShowSeasonModal(true)}>
                        <Plus size={14} /> New Season
                    </button>
                </div>

                {loading && <div className={styles.center}><div className="spinner" /></div>}
                {!loading && seasons.length === 0 && <p className={styles.emptyText}>No seasons yet. Create one above.</p>}

                {!loading && seasons.map((s) => (
                    <div key={s.id} className={`card ${styles.controlCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <h3 className={styles.controlName}>{s.name}</h3>
                                <span className={styles.controlId}>ID: {s.id} · Week {s.currentWeek} / {s.config?.weekCount ?? '?'}</span>
                            </div>
                            <span className={`badge badge--${s.status}`}>{s.status}</span>
                        </div>

                        <div className={styles.controlActions}>
                            {s.status === 'registration' && (
                                <button className="btn btn--primary" onClick={() => handleStartSeason(s.id, s.name)} disabled={actionLoading}>
                                    <Play size={14} /> Start Season
                                </button>
                            )}
                            {s.status === 'active' && (
                                <>
                                    <button className="btn btn--primary" onClick={() => handleAdvanceSeason(s.id, s.name)} disabled={actionLoading}>
                                        <ChevronRight size={14} /> Advance Week
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleCompleteSeason(s.id, s.name)} disabled={actionLoading}>
                                        <Flag size={14} /> Complete Season
                                    </button>
                                </>
                            )}
                            {s.status === 'completed' && (
                                <span className={styles.completedText}>
                                    <Trophy size={14} style={{ marginRight: 4 }} /> Season complete
                                </span>
                            )}
                            <a href={`/seasons/${s.id}`} className="btn btn--secondary">
                                <ExternalLink size={14} /> View
                            </a>
                        </div>
                    </div>
                ))}
            </section>

            {/* Action Log */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                    <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Action Log
                </h2>
                <div className={styles.logPanel}>
                    {actionLog.length === 0 && <p className={styles.logEmpty}>No actions yet.</p>}
                    {actionLog.map((log, i) => <div key={i} className={styles.logEntry}>{log}</div>)}
                </div>
            </section>

            {/* CREATE SEASON MODAL */}
            {showSeasonModal && (
                <div className={styles.modalOverlay} onClick={() => setShowSeasonModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Create Season</h2>
                            <button className={styles.modalClose} onClick={() => setShowSeasonModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreateSeason} className={styles.modalForm}>
                            {!adminSecret && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>
                                        <Lock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Admin Secret
                                    </label>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        <input type="password" className="input input--mono" placeholder="Required to create. Paste your secret then click Apply."
                                            value={seasonSecretDraft} onChange={(e) => setSeasonSecretDraft(e.target.value)} style={{ flex: 1 }} />
                                        <button type="button" className="btn btn--secondary" disabled={!seasonSecretDraft.trim()}
                                            onClick={() => {
                                                commitSecret(seasonSecretDraft);
                                                setSeasonSecretDraft('');
                                            }}>Apply</button>
                                    </div>
                                    <span className={styles.formHint}>Click Apply to authenticate. Auto-hides once set.</span>
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Season Name</label>
                                <input type="text" className="input" placeholder="e.g., Season 1"
                                    value={seasonName} onChange={(e) => setSeasonName(e.target.value)} autoFocus />
                            </div>

                            <div className={styles.formDivider} />
                            <h3 className={styles.formSectionTitle}>Season Config</h3>

                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Week Count</label>
                                    <input type="number" className="input input--mono" value={seasonWeeks} onChange={(e) => setSeasonWeeks(Number(e.target.value))} min={1} max={52} />
                                    <span className={styles.formHint}>Number of weekly tournaments</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Qualification Slots</label>
                                    <input type="number" className="input input--mono" value={seasonQualSlots} onChange={(e) => setSeasonQualSlots(Number(e.target.value))} min={1} />
                                    <span className={styles.formHint}>Top N qualify for finals</span>
                                </div>
                            </div>

                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowSeasonModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={creatingSeason || !seasonName.trim()}>
                                    <Plus size={14} /> {creatingSeason ? 'Creating...' : 'Create Season'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
