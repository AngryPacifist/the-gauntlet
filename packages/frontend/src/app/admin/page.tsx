'use client';

import { useState, useEffect } from 'react';
import {
    listTournaments,
    createTournament,
    deleteTournament,
    getTournamentBrackets,
    adminStartTournament,
    adminComputeScores,
    adminAdvanceRound,
    type Tournament,
} from '@/lib/api';
import styles from './page.module.css';

export default function AdminPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create form
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);

    // Action feedback
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        loadTournaments();
    }, []);

    async function loadTournaments() {
        try {
            setLoading(true);
            const data = await listTournaments();
            setTournaments(data);
        } catch {
            addLog('❌ Failed to load tournaments');
        } finally {
            setLoading(false);
        }
    }

    function addLog(msg: string) {
        setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;
        try {
            setCreating(true);
            const result = await createTournament(newName.trim(), undefined, adminSecret);
            addLog(`✅ Created tournament "${newName}" (id: ${result.id})`);
            setNewName('');
            loadTournaments();
        } catch (err) {
            addLog(`❌ ${err instanceof Error ? err.message : 'Failed to create'}`);
        } finally {
            setCreating(false);
        }
    }

    async function handleStart(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('❌ Enter admin secret first');
            return;
        }
        try {
            setActionLoading(true);
            const result = await adminStartTournament(tournamentId, adminSecret);
            addLog(
                `✅ Started "${tournamentName}": Round 1 created with ${result.bracketCount} bracket(s)`,
            );
            loadTournaments();
        } catch (err) {
            addLog(`❌ ${err instanceof Error ? err.message : 'Failed to start'}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleScore(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('❌ Enter admin secret first');
            return;
        }
        try {
            setActionLoading(true);
            // First get the active round
            const data = await getTournamentBrackets(tournamentId);
            if (!data.round) {
                addLog('❌ No active round found');
                return;
            }
            const result = await adminComputeScores(data.round.id, adminSecret);
            addLog(
                `✅ Scored "${tournamentName}" Round ${data.round.roundNumber}: ${result.scoredCount} entries`,
            );
            loadTournaments();
        } catch (err) {
            addLog(`❌ ${err instanceof Error ? err.message : 'Failed to score'}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleAdvance(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('❌ Enter admin secret first');
            return;
        }
        try {
            setActionLoading(true);
            const result = await adminAdvanceRound(tournamentId, adminSecret);
            if (result.completed) {
                addLog(`🏆 "${tournamentName}" completed!`);
            } else {
                addLog(
                    `✅ "${tournamentName}": ${result.advanced} advanced, ${result.eliminated} eliminated`,
                );
            }
            loadTournaments();
        } catch (err) {
            addLog(`❌ ${err instanceof Error ? err.message : 'Failed to advance'}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDelete(tournamentId: number, tournamentName: string) {
        if (!adminSecret) {
            addLog('❌ Enter admin secret first');
            return;
        }
        if (!confirm(`Delete "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await deleteTournament(tournamentId, adminSecret);
            addLog(`🗑️ Deleted "${tournamentName}"`);
            loadTournaments();
        } catch (err) {
            addLog(`❌ ${err instanceof Error ? err.message : 'Failed to delete'}`);
        } finally {
            setActionLoading(false);
        }
    }

    return (
        <div className="container">
            <header className="page-header">
                <h1 className="page-header__title">🛡️ Admin Panel</h1>
                <p className="page-header__subtitle">
                    Create tournaments, manage rounds, and control the Battle Royale.
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
                        {adminSecret ? '🔓 Authenticated' : '🔒 Required for admin actions'}
                    </span>
                </div>
            </section>

            {/* Create Tournament */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Create Tournament</h2>
                <form onSubmit={handleCreate} className={styles.createForm}>
                    <input
                        type="text"
                        className="input"
                        placeholder="Tournament name (e.g., Battle Royale Season 1)"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        disabled={creating}
                    />
                    <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={creating || !newName.trim()}
                    >
                        {creating ? 'Creating...' : '+ Create'}
                    </button>
                </form>
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
                                        🚀 Start Tournament
                                    </button>
                                    <button
                                        className="btn btn--danger"
                                        onClick={() => handleDelete(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        🗑️ Delete
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
                                        📊 Compute Scores
                                    </button>
                                    <button
                                        className="btn btn--danger"
                                        onClick={() => handleAdvance(t.id, t.name)}
                                        disabled={actionLoading}
                                    >
                                        ⚡ Advance Round
                                    </button>
                                </>
                            )}
                            {t.status === 'completed' && (
                                <span className={styles.completedText}>🏆 Tournament is complete</span>
                            )}
                            <a
                                href={`/tournament/${t.id}`}
                                className="btn btn--secondary"
                            >
                                View →
                            </a>
                        </div>
                    </div>
                ))}
            </section>

            {/* Action Log */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Action Log</h2>
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
        </div>
    );
}
