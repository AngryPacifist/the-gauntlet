'use client';

import { useState, useEffect, useRef } from 'react';
import {
    listTournaments,
    createTournament,
    deleteTournament,
    getTournamentBrackets,
    adminStartTournament,
    adminComputeScores,
    adminAdvanceRound,
    adminCancelTournament,
    type Tournament,
} from '@/lib/api';
import {
    Shield,
    Lock,
    Unlock,
    Plus,
    Play,
    BarChart3,
    ChevronRight,
    Trash2,
    Ban,
    Trophy,
    ExternalLink,
    Terminal,
} from 'lucide-react';
import styles from './page.module.css';

export default function AdminPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);

    // Config fields (defaults match DEFAULT_TOURNAMENT_CONFIG)
    const [cfgBracketSize, setCfgBracketSize] = useState(8);
    const [cfgAdvanceRatio, setCfgAdvanceRatio] = useState(0.5);
    const [cfgRoundDurations, setCfgRoundDurations] = useState('72, 48, 48');
    const [cfgMinCollateral, setCfgMinCollateral] = useState(25);
    const [cfgMinDuration, setCfgMinDuration] = useState(120);
    const [cfgLeverageThreshold, setCfgLeverageThreshold] = useState(30);
    const [cfgAssetCount, setCfgAssetCount] = useState(4);

    // Action feedback
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [actionLoading, setActionLoading] = useState(false);

    // Toast notification
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    useEffect(() => {
        loadTournaments();
    }, []);

    async function loadTournaments() {
        try {
            setLoading(true);
            const data = await listTournaments();
            setTournaments(data);
        } catch {
            addLog('Failed to load tournaments');
            showToast('Failed to load tournaments', 'error');
        } finally {
            setLoading(false);
        }
    }

    function addLog(msg: string) {
        setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    function resetConfigDefaults() {
        setNewName('');
        setCfgBracketSize(8);
        setCfgAdvanceRatio(0.5);
        setCfgRoundDurations('72, 48, 48');
        setCfgMinCollateral(25);
        setCfgMinDuration(120);
        setCfgLeverageThreshold(30);
        setCfgAssetCount(4);
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;

        const durations = cfgRoundDurations
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n) && n > 0);

        const config = {
            bracketSize: cfgBracketSize,
            advanceRatio: cfgAdvanceRatio,
            roundDurations: durations.length > 0 ? durations : [72, 48, 48],
            minPositionCollateral: cfgMinCollateral,
            minTradeDurationSec: cfgMinDuration,
            leveragePenaltyThreshold: cfgLeverageThreshold,
            supportedAssetCount: cfgAssetCount,
        };

        try {
            setCreating(true);
            const result = await createTournament(newName.trim(), config, adminSecret);
            addLog(`Created tournament "${newName}" (id: ${result.id}) with custom config`);
            showToast(`Tournament "${newName}" created`, 'success');
            resetConfigDefaults();
            setShowCreateModal(false);
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setCreating(false);
        }
    }

    async function handleStart(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('Error: Enter admin secret first');
            showToast('Enter admin secret first', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const result = await adminStartTournament(tournamentId, adminSecret);
            addLog(
                `Started "${tournamentName}": Round 1 created with ${result.bracketCount} bracket(s)`,
            );
            showToast(`"${tournamentName}" started`, 'success');
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to start';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleScore(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('Error: Enter admin secret first');
            showToast('Enter admin secret first', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const data = await getTournamentBrackets(tournamentId);
            if (!data.round) {
                addLog('Error: No active round found');
                showToast('No active round found', 'error');
                setActionLoading(false);
                return;
            }
            const result = await adminComputeScores(data.round.id, adminSecret);
            addLog(
                `Scored "${tournamentName}" Round ${data.round.roundNumber}: ${result.scoredCount} entries`,
            );
            showToast(`Scores computed: ${result.scoredCount} entries`, 'success');
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to score';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleAdvance(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('Error: Enter admin secret first');
            showToast('Enter admin secret first', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const result = await adminAdvanceRound(tournamentId, adminSecret);
            if (result.completed) {
                addLog(`"${tournamentName}" completed!`);
                showToast(`"${tournamentName}" completed!`, 'success');
            } else {
                addLog(
                    `"${tournamentName}": ${result.advanced} advanced, ${result.eliminated} eliminated`,
                );
                showToast(`Round advanced: ${result.advanced} advanced, ${result.eliminated} eliminated`, 'success');
            }
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to advance';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleCancel(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('Error: Enter admin secret first');
            showToast('Enter admin secret first', 'error');
            return;
        }
        if (!confirm(`Cancel "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await adminCancelTournament(tournamentId, adminSecret);
            addLog(`Cancelled "${tournamentName}"`);
            showToast(`"${tournamentName}" cancelled`, 'success');
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to cancel';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDelete(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('Error: Enter admin secret first');
            showToast('Enter admin secret first', 'error');
            return;
        }
        if (!confirm(`Delete "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await deleteTournament(tournamentId, adminSecret);
            addLog(`Deleted "${tournamentName}"`);
            showToast(`"${tournamentName}" deleted`, 'success');
            loadTournaments();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    return (
        <div className="container">
            {/* Toast notification */}
            {toast && (
                <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
                    <span>{toast.message}</span>
                    <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
                </div>
            )}

            <header className="page-header">
                <h1 className="page-header__title">
                    <Shield size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Admin Panel
                </h1>
                <p className="page-header__subtitle">
                    Create tournaments, manage rounds, and control The Gauntlet.
                </p>
            </header>

            {/* Admin Secret */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Authentication</h2>
                <div className={styles.secretRow}>
                    <input
                        type="password"
                        className="input input--mono"
                        placeholder="Enter admin secret..."
                        value={adminSecret}
                        onChange={(e) => setAdminSecret(e.target.value)}
                    />
                    <span className={styles.secretHint}>
                        {adminSecret ? (
                            <><Unlock size={14} style={{ color: 'var(--status-success)', marginRight: 4 }} /> Authenticated</>
                        ) : (
                            <><Lock size={14} style={{ marginRight: 4 }} /> Required for admin actions</>
                        )}
                    </span>
                </div>
            </section>

            {/* Create Tournament */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Create Tournament</h2>
                <button
                    className="btn btn--primary"
                    onClick={() => setShowCreateModal(true)}
                >
                    <Plus size={14} />
                    New Tournament
                </button>
            </section>

            {/* Tournament Controls */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Tournament Controls</h2>

                {loading && (
                    <div className={styles.center}>
                        <div className="spinner" />
                    </div>
                )}

                {!loading && tournaments.length === 0 && (
                    <p className={styles.emptyText}>No tournaments yet. Create one above.</p>
                )}

                {!loading && tournaments.map((t) => (
                    <div key={t.id} className={`card ${styles.controlCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <h3 className={styles.controlName}>{t.name}</h3>
                                <span className={styles.controlId}>ID: {t.id}</span>
                            </div>
                            <span className={`badge badge--${t.status}`}>{t.status}</span>
                        </div>

                        <div className={styles.controlActions}>
                            {t.status === 'registration' && (
                                <>
                                    <button
                                        className="btn btn--primary"
                                        onClick={() => handleStart(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        <Play size={14} /> Start Tournament
                                    </button>
                                    <button
                                        className="btn btn--danger"
                                        onClick={() => handleDelete(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </>
                            )}
                            {t.status === 'active' && (
                                <>
                                    <button
                                        className="btn btn--secondary"
                                        onClick={() => handleScore(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        <BarChart3 size={14} /> Compute Scores
                                    </button>
                                    <button
                                        className="btn btn--primary"
                                        onClick={() => handleAdvance(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        <ChevronRight size={14} /> Advance Round
                                    </button>
                                    <button
                                        className="btn btn--danger"
                                        onClick={() => handleCancel(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        <Ban size={14} /> Cancel
                                    </button>
                                </>
                            )}
                            {t.status === 'completed' && (
                                <span className={styles.completedText}>
                                    <Trophy size={14} style={{ marginRight: 4 }} /> Tournament is complete
                                </span>
                            )}
                            <a
                                href={`/tournament/${t.id}`}
                                className="btn btn--secondary"
                            >
                                <ExternalLink size={14} /> View
                            </a>
                        </div>
                    </div>
                ))}
            </section>

            {/* Action Log */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                    <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                    Action Log
                </h2>
                <div className={styles.logPanel}>
                    {actionLog.length === 0 && (
                        <p className={styles.logEmpty}>No actions yet.</p>
                    )}
                    {actionLog.map((log, i) => (
                        <div key={i} className={styles.logEntry}>
                            {log}
                        </div>
                    ))}
                </div>
            </section>

            {/* Create Tournament Modal */}
            {showCreateModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Create Tournament</h2>
                            <button
                                className={styles.modalClose}
                                onClick={() => setShowCreateModal(false)}
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>
                                    {adminSecret ? (
                                        <><Unlock size={12} style={{ color: 'var(--status-success)', marginRight: 4 }} />Admin Secret</>
                                    ) : (
                                        <><Lock size={12} style={{ marginRight: 4 }} />Admin Secret</>
                                    )}
                                </label>
                                <input
                                    type="password"
                                    className="input input--mono"
                                    placeholder="Enter admin secret..."
                                    value={adminSecret}
                                    onChange={(e) => setAdminSecret(e.target.value)}
                                />
                                <span className={styles.formHint}>Required for all admin actions</span>
                            </div>

                            <div className={styles.formDivider} />

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="e.g., The Gauntlet Pilot"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className={styles.formDivider} />
                            <h3 className={styles.formSectionTitle}>Configuration</h3>

                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Bracket Size</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgBracketSize}
                                        onChange={(e) => setCfgBracketSize(Number(e.target.value))}
                                        min={2}
                                    />
                                    <span className={styles.formHint}>Traders per bracket in Round 1</span>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Advance Ratio</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgAdvanceRatio}
                                        onChange={(e) => setCfgAdvanceRatio(Number(e.target.value))}
                                        min={0.1}
                                        max={0.9}
                                        step={0.1}
                                    />
                                    <span className={styles.formHint}>Fraction that survive each round</span>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Collateral ($)</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgMinCollateral}
                                        onChange={(e) => setCfgMinCollateral(Number(e.target.value))}
                                        min={0}
                                    />
                                    <span className={styles.formHint}>Min collateral for a trade to count</span>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Trade Duration (s)</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgMinDuration}
                                        onChange={(e) => setCfgMinDuration(Number(e.target.value))}
                                        min={0}
                                    />
                                    <span className={styles.formHint}>Min seconds a trade must be open</span>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Leverage Threshold</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgLeverageThreshold}
                                        onChange={(e) => setCfgLeverageThreshold(Number(e.target.value))}
                                        min={1}
                                    />
                                    <span className={styles.formHint}>Leverage above this penalizes Risk score</span>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Supported Assets</label>
                                    <input
                                        type="number"
                                        className="input input--mono"
                                        value={cfgAssetCount}
                                        onChange={(e) => setCfgAssetCount(Number(e.target.value))}
                                        min={1}
                                    />
                                    <span className={styles.formHint}>Number of tradeable assets on Adrena</span>
                                </div>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Round Durations (hours)</label>
                                <input
                                    type="text"
                                    className="input input--mono"
                                    value={cfgRoundDurations}
                                    onChange={(e) => setCfgRoundDurations(e.target.value)}
                                    placeholder="72, 48, 48"
                                />
                                <span className={styles.formHint}>Comma-separated hours per round (R1, R2, R3)</span>
                            </div>

                            <div className={styles.modalActions}>
                                <button
                                    type="button"
                                    className="btn btn--secondary"
                                    onClick={() => { resetConfigDefaults(); setShowCreateModal(false); }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn--primary"
                                    disabled={creating || !newName.trim()}
                                >
                                    <Plus size={14} />
                                    {creating ? 'Creating...' : 'Create Tournament'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
