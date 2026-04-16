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
    adminComputeRaffle,
    adminDrawRaffle,
    verifyRaffleDraw,
    adminScoreCategories,
    adminResetRaffle,
    getTournamentAnalytics,
    adminGetDailyAnalytics,
    adminGetAnomalies,
    listSeasons,
    adminCreateSeason,
    adminStartSeason,
    adminAdvanceSeason,
    adminCompleteSeason,
    type Tournament,
    type Season,
    type TournamentAnalytics,
    type AdminDailyAnalytics,
    type AdminAnomalyAnalytics,
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
    Ticket,
    Sparkles,
    CheckCircle2,
    CalendarDays,
    Layers,
    Flag,
    RotateCcw,
    Flame,
    Swords,
    Activity,
    AlertTriangle,
} from 'lucide-react';
import styles from './page.module.css';

export default function AdminPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [seasons, setSeasons] = useState<Season[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create tournament modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);

    // Config fields (defaults match DEFAULT_TOURNAMENT_CONFIG)
    const [cfgFormat, setCfgFormat] = useState<'bracket' | 'rank_only'>('bracket');
    const [cfgBracketSize, setCfgBracketSize] = useState(8);
    const [cfgAdvanceRatio, setCfgAdvanceRatio] = useState(0.5);
    const [cfgRoundDurations, setCfgRoundDurations] = useState('72, 48, 48');
    const [cfgMinCollateral, setCfgMinCollateral] = useState(25);
    const [cfgMinDuration, setCfgMinDuration] = useState(120);
    const [cfgAssetCount, setCfgAssetCount] = useState(4);

    // Create season modal
    const [showSeasonModal, setShowSeasonModal] = useState(false);
    const [seasonName, setSeasonName] = useState('');
    const [seasonWeeks, setSeasonWeeks] = useState(3);
    const [seasonQualSlots, setSeasonQualSlots] = useState(4);
    const [creatingSeason, setCreatingSeason] = useState(false);

    // Raffle draw modal
    const [showDrawModal, setShowDrawModal] = useState(false);
    const [drawTournamentId, setDrawTournamentId] = useState<number | null>(null);
    const [drawBlockHash, setDrawBlockHash] = useState('');
    const [drawPrizeCount, setDrawPrizeCount] = useState(3);

    // Category scoring modal
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categoryTournamentId, setCategoryTournamentId] = useState<number | null>(null);
    const [categoryDate, setCategoryDate] = useState(new Date().toISOString().split('T')[0]);

    // Action feedback
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [actionLoading, setActionLoading] = useState(false);

    // Analytics
    const [analyticsId, setAnalyticsId] = useState<number | null>(null);
    const [analyticsData, setAnalyticsData] = useState<TournamentAnalytics | null>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);

    // Daily metrics
    const [dailyId, setDailyId] = useState<number | null>(null);
    const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
    const [dailyData, setDailyData] = useState<AdminDailyAnalytics | null>(null);
    const [dailyLoading, setDailyLoading] = useState(false);

    // Anomaly detection
    const [anomalyId, setAnomalyId] = useState<number | null>(null);
    const [anomalyData, setAnomalyData] = useState<AdminAnomalyAnalytics | null>(null);
    const [anomalyLoading, setAnomalyLoading] = useState(false);

    // Toast notification
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    useEffect(() => {
        loadAll();
    }, []);

    async function loadAll() {
        try {
            setLoading(true);
            const [t, s] = await Promise.all([listTournaments(), listSeasons()]);
            setTournaments(t);
            setSeasons(s);
        } catch {
            addLog('Failed to load data');
            showToast('Failed to load data', 'error');
        } finally {
            setLoading(false);
        }
    }

    function addLog(msg: string) {
        setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    function resetConfigDefaults() {
        setNewName('');
        setCfgFormat('bracket');
        setCfgBracketSize(8);
        setCfgAdvanceRatio(0.5);
        setCfgRoundDurations('72, 48, 48');
        setCfgMinCollateral(25);
        setCfgMinDuration(120);
        setCfgAssetCount(4);
    }

    // ── Tournament handlers ──────────────────────────────────────────────────

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;

        const durations = cfgRoundDurations
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n) && n > 0);

        const config = {
            format: cfgFormat,
            bracketSize: cfgBracketSize,
            advanceRatio: cfgAdvanceRatio,
            roundDurations: durations.length > 0 ? durations : (cfgFormat === 'rank_only' ? [336] : [72, 48, 48]),
            minPositionCollateral: cfgMinCollateral,
            minTradeDurationSec: cfgMinDuration,
            supportedAssetCount: cfgAssetCount,
        };

        try {
            setCreating(true);
            const result = await createTournament(newName.trim(), config, adminSecret);
            addLog(`Created tournament "${newName}" (id: ${result.id})`);
            showToast(`Tournament "${newName}" created`, 'success');
            resetConfigDefaults();
            setShowCreateModal(false);
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setCreating(false);
        }
    }

    async function handleStart(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminStartTournament(tournamentId, adminSecret);
            addLog(`Started "${tournamentName}": Round 1 with ${result.bracketCount} bracket(s)`);
            showToast(`"${tournamentName}" started`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to start';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleScore(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
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
            addLog(`Scored "${tournamentName}" Round ${data.round.roundNumber}: ${result.scoredCount} entries`);
            showToast(`Scores computed: ${result.scoredCount} entries`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to score';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleAdvance(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminAdvanceRound(tournamentId, adminSecret);
            if (result.completed) {
                addLog(`"${tournamentName}" completed!`);
                showToast(`"${tournamentName}" completed!`, 'success');
            } else {
                addLog(`"${tournamentName}": ${result.advanced} advanced, ${result.eliminated} eliminated`);
                showToast(`Round advanced: ${result.advanced} advanced`, 'success');
            }
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to advance';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleCancel(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        if (!confirm(`Cancel "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await adminCancelTournament(tournamentId, adminSecret);
            addLog(`Cancelled "${tournamentName}"`);
            showToast(`"${tournamentName}" cancelled`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to cancel';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDelete(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        if (!confirm(`Delete "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await deleteTournament(tournamentId, adminSecret);
            addLog(`Deleted "${tournamentName}"`);
            showToast(`"${tournamentName}" deleted`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    // ── Raffle handlers ──────────────────────────────────────────────────────

    async function handleComputeRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminComputeRaffle(tournamentId, adminSecret);
            addLog(`Raffle computed for "${tournamentName}": ${result.total} entries, ${result.eligible} eligible, ${result.excluded} excluded (top %)`);
            showToast(`Raffle: ${result.eligible} eligible of ${result.total}`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to compute raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDrawRaffle(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !drawTournamentId) { showToast('Enter admin secret first', 'error'); return; }
        if (!drawBlockHash.trim()) { showToast('Block hash is required', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminDrawRaffle(drawTournamentId, drawBlockHash.trim(), drawPrizeCount, adminSecret);
            addLog(`Raffle drawn for tournament #${drawTournamentId}: ${result.winners.length} winner(s) — ${result.winners.map(w => w.slice(0, 8) + '...').join(', ')}`);
            showToast(`${result.winners.length} raffle winner(s) drawn!`, 'success');
            setShowDrawModal(false);
            setDrawBlockHash('');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to draw raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleVerifyRaffle(tournamentId: number) {
        try {
            setActionLoading(true);
            const result = await verifyRaffleDraw(tournamentId);
            if (result.verified) {
                addLog(`Raffle draw #${result.drawId} VERIFIED ✓`);
                showToast('Raffle draw verified ✓', 'success');
            } else {
                addLog(`Raffle verification FAILED: ${result.mismatches.join(', ')}`);
                showToast('Verification failed — see log', 'error');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to verify';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleResetRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        if (!confirm(`Reset raffle draw for "${tournamentName}"? This will clear all winners and the audit trail.`)) return;
        try {
            setActionLoading(true);
            const result = await adminResetRaffle(tournamentId, adminSecret);
            addLog(`Raffle reset for "${tournamentName}": ${result.deletedDraws} draw(s) deleted, ${result.resetWinners} winner(s) cleared`);
            showToast(`Raffle reset: ${result.resetWinners} winners cleared`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to reset raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    // ── Category scoring handler ─────────────────────────────────────────────

    async function handleScoreCategories(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !categoryTournamentId) { showToast('Enter admin secret first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminScoreCategories(categoryTournamentId, categoryDate, adminSecret);
            addLog(`Categories scored for tournament #${result.tournamentId} on ${result.date}: ${result.walletsScored} wallets, ${result.ohlcAssetsAvailable} OHLC assets`);
            showToast(`Categories scored: ${result.walletsScored} wallets`, 'success');
            setShowCategoryModal(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to score categories';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setActionLoading(false);
        }
    }

    // ── Analytics handler ─────────────────────────────────────────────────────

    async function handleLoadAnalytics(tournamentId: number) {
        if (analyticsId === tournamentId) {
            setAnalyticsId(null);
            setAnalyticsData(null);
            return;
        }
        setAnalyticsId(tournamentId);
        setAnalyticsLoading(true);
        try {
            const data = await getTournamentAnalytics(tournamentId);
            setAnalyticsData(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load analytics';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
            setAnalyticsId(null);
        } finally {
            setAnalyticsLoading(false);
        }
    }

    // ── Daily metrics handler ─────────────────────────────────────────────────

    async function handleLoadDaily(tournamentId: number) {
        if (dailyId === tournamentId) {
            setDailyId(null);
            setDailyData(null);
            return;
        }
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        setDailyId(tournamentId);
        setDailyLoading(true);
        try {
            const data = await adminGetDailyAnalytics(tournamentId, dailyDate, adminSecret);
            setDailyData(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load daily metrics';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
            setDailyId(null);
        } finally {
            setDailyLoading(false);
        }
    }

    async function handleRefreshDaily(tournamentId: number) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        setDailyLoading(true);
        try {
            const data = await adminGetDailyAnalytics(tournamentId, dailyDate, adminSecret);
            setDailyData(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load daily metrics';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setDailyLoading(false);
        }
    }

    // ── Anomaly detection handler ─────────────────────────────────────────────

    async function handleLoadAnomalies(tournamentId: number) {
        if (anomalyId === tournamentId) {
            setAnomalyId(null);
            setAnomalyData(null);
            return;
        }
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        setAnomalyId(tournamentId);
        setAnomalyLoading(true);
        try {
            const data = await adminGetAnomalies(tournamentId, adminSecret);
            setAnomalyData(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load anomalies';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
            setAnomalyId(null);
        } finally {
            setAnomalyLoading(false);
        }
    }

    // ── Season handlers ──────────────────────────────────────────────────────

    async function handleCreateSeason(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
        if (!seasonName.trim()) return;
        try {
            setCreatingSeason(true);
            const result = await adminCreateSeason(seasonName.trim(), {
                weekCount: seasonWeeks,
                qualificationSlots: seasonQualSlots,
            }, adminSecret);
            addLog(`Created season "${seasonName}" (id: ${result.id}) — ${seasonWeeks} weeks, ${seasonQualSlots} qual slots`);
            showToast(`Season "${seasonName}" created`, 'success');
            setSeasonName('');
            setShowSeasonModal(false);
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create season';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setCreatingSeason(false);
        }
    }

    async function handleStartSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
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
        } finally {
            setActionLoading(false);
        }
    }

    async function handleAdvanceSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
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
        } finally {
            setActionLoading(false);
        }
    }

    async function handleCompleteSeason(seasonId: number, name: string) {
        if (!adminSecret) { showToast('Enter admin secret first', 'error'); return; }
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
        } finally {
            setActionLoading(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

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
                    Manage tournaments, seasons, raffles, and daily categories.
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

            {/* ═══════════════════ TOURNAMENT CONTROLS ═══════════════════ */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>
                        <Trophy size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                        Tournament Controls
                    </h2>
                    <button className="btn btn--primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={14} /> New Tournament
                    </button>
                </div>

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
                            {/* Main flow buttons */}
                            {t.status === 'registration' && (
                                <>
                                    <button className="btn btn--primary" onClick={() => handleStart(t.id, t.name)} disabled={actionLoading}>
                                        <Play size={14} /> Start
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleDelete(t.id, t.name)} disabled={actionLoading}>
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </>
                            )}
                            {t.status === 'active' && (
                                <>
                                    <button className="btn btn--secondary" onClick={() => handleScore(t.id, t.name)} disabled={actionLoading}>
                                        <BarChart3 size={14} /> Score
                                    </button>
                                    {t.config.format !== 'rank_only' && (
                                    <button className="btn btn--primary" onClick={() => handleAdvance(t.id, t.name)} disabled={actionLoading}>
                                        <ChevronRight size={14} /> Advance
                                    </button>
                                    )}
                                    <button className="btn btn--secondary" onClick={() => { setCategoryTournamentId(t.id); setShowCategoryModal(true); }} disabled={actionLoading}>
                                        <CalendarDays size={14} /> Categories
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => handleComputeRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <Ticket size={14} /> Compute Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => { setDrawTournamentId(t.id); setShowDrawModal(true); }} disabled={actionLoading}>
                                        <Sparkles size={14} /> Draw Raffle
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleResetRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <RotateCcw size={14} /> Reset Draw
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleCancel(t.id, t.name)} disabled={actionLoading}>
                                        <Ban size={14} /> Cancel
                                    </button>
                                </>
                            )}
                            {t.status === 'completed' && (
                                <>
                                    <span className={styles.completedText}>
                                        <Trophy size={14} style={{ marginRight: 4 }} /> Complete
                                    </span>
                                    <button className="btn btn--secondary" onClick={() => handleComputeRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <Ticket size={14} /> Compute Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => { setDrawTournamentId(t.id); setShowDrawModal(true); }} disabled={actionLoading}>
                                        <Sparkles size={14} /> Draw Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => handleVerifyRaffle(t.id)} disabled={actionLoading}>
                                        <CheckCircle2 size={14} /> Verify Draw
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleResetRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <RotateCcw size={14} /> Reset Draw
                                    </button>
                                </>
                            )}
                            {t.config.format === 'rank_only' ? (
                                <a href={`/leaderboard/${t.id}`} className="btn btn--secondary">
                                    <ExternalLink size={14} /> View
                                </a>
                            ) : (
                                <>
                                    <a href={`/tournament/${t.id}`} className="btn btn--secondary">
                                        <ExternalLink size={14} /> View
                                    </a>
                                    <a href={`/leaderboard/${t.id}`} className="btn btn--secondary">
                                        <BarChart3 size={14} /> Leaderboard
                                    </a>
                                </>
                            )}
                            <button className="btn btn--secondary" onClick={() => handleLoadAnalytics(t.id)} disabled={actionLoading}>
                                <BarChart3 size={14} /> Analytics
                            </button>
                            <button className="btn btn--secondary" onClick={() => handleLoadDaily(t.id)} disabled={actionLoading}>
                                <Activity size={14} /> Daily Metrics
                            </button>
                            <button className="btn btn--secondary" onClick={() => handleLoadAnomalies(t.id)} disabled={actionLoading}>
                                <AlertTriangle size={14} /> Anomalies
                            </button>
                        </div>

                        {/* Analytics panel */}
                        {analyticsId === t.id && (
                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                {analyticsLoading ? (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)' }}>Loading analytics...</div>
                                ) : analyticsData ? (
                                    <>
                                        {/* Summary */}
                                        <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                                <strong style={{ color: 'var(--text-primary)' }}>{analyticsData.tournament.totalTraders}</strong> traders
                                            </div>
                                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                                <strong style={{ color: 'var(--text-primary)' }}>{analyticsData.tournament.totalRounds}</strong> rounds
                                            </div>
                                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                                <strong style={{ color: 'var(--text-primary)' }}>{analyticsData.tournament.totalRegistrations}</strong> registrations
                                            </div>
                                        </div>

                                        {/* Round Stats Table */}
                                        {analyticsData.roundStats.length > 0 && (
                                            <>
                                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>Round Progression</h4>
                                                <div style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
                                                    <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Round</th>
                                                                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Traders</th>
                                                                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Elim.</th>
                                                                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Adv.</th>
                                                                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg CPI</th>
                                                                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Max CPI</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {analyticsData.roundStats.map((r, i) => (
                                                                <tr key={`${r.roundName}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                                    <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>{r.roundName}</td>
                                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.traderCount}</td>
                                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>{r.eliminatedCount}</td>
                                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#22c55e' }}>{r.advancedCount}</td>
                                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.avgCpi.toFixed(1)}</td>
                                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{r.maxCpi.toFixed(1)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </>
                                        )}

                                        {/* Component Insights */}
                                        {analyticsData.componentInsights && (
                                            <>
                                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>Component Insights (Advanced vs Eliminated)</h4>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                                                    {(['pnl', 'risk', 'consistency', 'activity'] as const).map((key) => (
                                                        <div key={key} style={{ padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{key}</div>
                                                            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
                                                                {analyticsData.componentInsights!.advancedAvg[key].toFixed(1)}
                                                            </div>
                                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>vs</div>
                                                            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
                                                                {analyticsData.componentInsights!.eliminatedAvg[key].toFixed(1)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}

                                        {/* Top Performers */}
                                        {analyticsData.topPerformers.length > 0 && (
                                            <>
                                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>Top Performers</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {analyticsData.topPerformers.slice(0, 5).map((p, i) => (
                                                        <div key={`${p.wallet}-${p.roundNumber}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '4px 8px', fontSize: '0.75rem' }}>
                                                            <span style={{ color: i === 0 ? '#f59e0b' : 'var(--text-muted)', fontWeight: 700, width: '20px' }}>#{i + 1}</span>
                                                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p.wallet.slice(0, 4)}...{p.wallet.slice(-4)}</span>
                                                            <span style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b', fontWeight: 600 }}>{p.cpiScore.toFixed(1)}</span>
                                                            <span style={{ color: 'var(--text-muted)' }}>{p.roundName}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </>
                                ) : null}
                            </div>
                        )}

                        {/* Daily Metrics panel */}
                        {dailyId === t.id && (
                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                                    <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Daily Position Metrics</h4>
                                    <input
                                        type="date"
                                        className="input input--mono"
                                        value={dailyDate}
                                        onChange={(e) => setDailyDate(e.target.value)}
                                        style={{ maxWidth: '180px', fontSize: '0.75rem' }}
                                    />
                                    <button className="btn btn--secondary" onClick={() => handleRefreshDaily(t.id)} disabled={dailyLoading} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                                        {dailyLoading ? 'Loading...' : 'Fetch'}
                                    </button>
                                </div>
                                {dailyLoading ? (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)' }}>Loading daily metrics...</div>
                                ) : dailyData ? (
                                    <>
                                        {/* Aggregate stats */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                                            <div style={{ padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Traders</div>
                                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{dailyData.stats.activeTraders}</div>
                                            </div>
                                            <div style={{ padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Trades</div>
                                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{dailyData.stats.totalTrades}</div>
                                            </div>
                                            {dailyData.stats.fees && (
                                                <div style={{ padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Fees</div>
                                                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f59e0b' }}>${dailyData.stats.fees.total.toFixed(2)}</div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Min/Max/Avg rows */}
                                        {dailyData.stats.size && (
                                            <div style={{ marginBottom: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                <strong>Position Size:</strong> min ${dailyData.stats.size.min.toFixed(2)} / max ${dailyData.stats.size.max.toFixed(2)} / avg ${dailyData.stats.size.avg.toFixed(2)}
                                            </div>
                                        )}
                                        {dailyData.stats.leverage && (
                                            <div style={{ marginBottom: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                <strong>Leverage at Open:</strong> min {dailyData.stats.leverage.min.toFixed(1)}x / max {dailyData.stats.leverage.max.toFixed(1)}x / avg {dailyData.stats.leverage.avg.toFixed(1)}x
                                            </div>
                                        )}
                                        {dailyData.stats.tradesPerTrader && (
                                            <div style={{ marginBottom: 'var(--space-md)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                <strong>Trades/Trader:</strong> min {dailyData.stats.tradesPerTrader.min} / max {dailyData.stats.tradesPerTrader.max} / avg {dailyData.stats.tradesPerTrader.avg.toFixed(1)}
                                            </div>
                                        )}

                                        {/* Per-wallet table */}
                                        {dailyData.walletMetrics.length > 0 && (
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Wallet</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Trades</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>L/S</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Size</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Lev.</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Fees</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {dailyData.walletMetrics.slice(0, 20).map((w) => (
                                                            <tr key={w.wallet} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{w.wallet.slice(0, 4)}...{w.wallet.slice(-4)}</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-primary)' }}>{w.tradeCount}</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{w.longCount}/{w.shortCount}</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>${w.avgSize.toFixed(2)}</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{w.avgLeverage.toFixed(1)}x</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>${w.totalFees.toFixed(2)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>Select a date and click Fetch</div>
                                )}
                            </div>
                        )}

                        {/* Anomaly detection panel */}
                        {anomalyId === t.id && (
                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>Quest Anomaly Detection</h4>
                                {anomalyLoading ? (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)' }}>Scanning for anomalies...</div>
                                ) : anomalyData ? (
                                    <>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
                                            Streak threshold: <strong style={{ color: 'var(--text-primary)' }}>{anomalyData.streakThreshold}+ consecutive days</strong> in top 5 •{' '}
                                            <strong style={{ color: anomalyData.anomalyCount > 0 ? '#f59e0b' : '#22c55e' }}>{anomalyData.anomalyCount}</strong> anomalies detected
                                        </div>
                                        {anomalyData.anomalies.length > 0 ? (
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Wallet</th>
                                                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Category</th>
                                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Streak</th>
                                                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Dates</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {anomalyData.anomalies.map((a, i) => (
                                                            <tr key={`${a.wallet}-${a.category}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{a.wallet.slice(0, 4)}...{a.wallet.slice(-4)}</td>
                                                                <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>{a.category.replace(/_/g, ' ')}</td>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: a.streakLength >= 5 ? '#ef4444' : '#f59e0b' }}>{a.streakLength}d</td>
                                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{a.dates[0]} → {a.dates[a.dates.length - 1]}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: '#22c55e', fontSize: '0.8125rem' }}>✓ No anomalies detected</div>
                                        )}
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>
                ))}
            </section>

            {/* ═══════════════════ SEASON CONTROLS ═══════════════════ */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>
                        <Layers size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                        Season Controls
                    </h2>
                    <button className="btn btn--primary" onClick={() => setShowSeasonModal(true)}>
                        <Plus size={14} /> New Season
                    </button>
                </div>

                {!loading && seasons.length === 0 && (
                    <p className={styles.emptyText}>No seasons yet. Create one above.</p>
                )}

                {!loading && seasons.map((s) => (
                    <div key={s.id} className={`card ${styles.controlCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <h3 className={styles.controlName}>{s.name}</h3>
                                <span className={styles.controlId}>
                                    ID: {s.id} · Week {s.currentWeek} / {s.config?.weekCount ?? '?'}
                                </span>
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

            {/* ═══════════════════ CREATE TOURNAMENT MODAL ═══════════════════ */}
            {showCreateModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Create Tournament</h2>
                            <button className={styles.modalClose} onClick={() => setShowCreateModal(false)}>×</button>
                        </div>

                        <form onSubmit={handleCreate} className={styles.modalForm}>
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

                            {/* Format selector */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Format</label>
                                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                    <button
                                        type="button"
                                        className={`btn ${cfgFormat === 'bracket' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('bracket'); setCfgRoundDurations('72, 48, 48'); }}
                                        style={{ flex: 1 }}
                                    >
                                        <Swords size={14} /> Gauntlet
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn ${cfgFormat === 'rank_only' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('rank_only'); setCfgRoundDurations('336'); }}
                                        style={{ flex: 1 }}
                                    >
                                        <Flame size={14} /> Forge
                                    </button>
                                </div>
                                <span className={styles.formHint}>
                                    {cfgFormat === 'bracket'
                                        ? 'Bracket elimination with rounds — The Gauntlet'
                                        : 'Flat leaderboard, open registration — The Forge'}
                                </span>
                            </div>

                            <h3 className={styles.formSectionTitle}>Configuration</h3>

                            <div className={styles.formGrid}>
                                {cfgFormat === 'bracket' && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Bracket Size</label>
                                    <input type="number" className="input input--mono" value={cfgBracketSize} onChange={(e) => setCfgBracketSize(Number(e.target.value))} min={2} />
                                    <span className={styles.formHint}>Traders per bracket in Round 1</span>
                                </div>
                                )}
                                {cfgFormat === 'bracket' && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Advance Ratio</label>
                                    <input type="number" className="input input--mono" value={cfgAdvanceRatio} onChange={(e) => setCfgAdvanceRatio(Number(e.target.value))} min={0.1} max={0.9} step={0.1} />
                                    <span className={styles.formHint}>Fraction that survive each round</span>
                                </div>
                                )}
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Collateral ($)</label>
                                    <input type="number" className="input input--mono" value={cfgMinCollateral} onChange={(e) => setCfgMinCollateral(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Min collateral for a trade to count</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Trade Duration (s)</label>
                                    <input type="number" className="input input--mono" value={cfgMinDuration} onChange={(e) => setCfgMinDuration(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Min seconds a trade must be open</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Supported Assets</label>
                                    <input type="number" className="input input--mono" value={cfgAssetCount} onChange={(e) => setCfgAssetCount(Number(e.target.value))} min={1} />
                                    <span className={styles.formHint}>Number of tradeable assets on Adrena</span>
                                </div>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>
                                    {cfgFormat === 'rank_only' ? 'Competition Duration (hours)' : 'Round Durations (hours)'}
                                </label>
                                <input type="text" className="input input--mono" value={cfgRoundDurations} onChange={(e) => setCfgRoundDurations(e.target.value)} placeholder={cfgFormat === 'rank_only' ? '336' : '72, 48, 48'} />
                                <span className={styles.formHint}>
                                    {cfgFormat === 'rank_only'
                                        ? 'Total competition length in hours (e.g., 336 = 14 days)'
                                        : 'Comma-separated hours per round (R1, R2, R3)'}
                                </span>
                            </div>

                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => { resetConfigDefaults(); setShowCreateModal(false); }}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={creating || !newName.trim()}>
                                    <Plus size={14} /> {creating ? 'Creating...' : 'Create Tournament'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ═══════════════════ CREATE SEASON MODAL ═══════════════════ */}
            {showSeasonModal && (
                <div className={styles.modalOverlay} onClick={() => setShowSeasonModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Create Season</h2>
                            <button className={styles.modalClose} onClick={() => setShowSeasonModal(false)}>×</button>
                        </div>

                        <form onSubmit={handleCreateSeason} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Season Name</label>
                                <input type="text" className="input" placeholder="e.g., Season 1" value={seasonName} onChange={(e) => setSeasonName(e.target.value)} autoFocus />
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

            {/* ═══════════════════ RAFFLE DRAW MODAL ═══════════════════ */}
            {showDrawModal && (
                <div className={styles.modalOverlay} onClick={() => setShowDrawModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>
                                <Sparkles size={18} style={{ marginRight: 6 }} />
                                Draw Raffle Winners
                            </h2>
                            <button className={styles.modalClose} onClick={() => setShowDrawModal(false)}>×</button>
                        </div>

                        <form onSubmit={handleDrawRaffle} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={drawTournamentId ?? ''} readOnly />
                                <span className={styles.formHint}>Auto-filled from the tournament card</span>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Bitcoin Block Hash</label>
                                <input
                                    type="text"
                                    className="input input--mono"
                                    placeholder="000000000000000000024bead8df69990852c202..."
                                    value={drawBlockHash}
                                    onChange={(e) => setDrawBlockHash(e.target.value)}
                                    autoFocus
                                />
                                <span className={styles.formHint}>
                                    Deterministic seed — use a recent Bitcoin block hash for verifiability
                                </span>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Number of Winners</label>
                                <input type="number" className="input input--mono" value={drawPrizeCount} onChange={(e) => setDrawPrizeCount(Number(e.target.value))} min={1} max={100} />
                                <span className={styles.formHint}>How many winners to draw from the eligible pool</span>
                            </div>

                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowDrawModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={actionLoading || !drawBlockHash.trim()}>
                                    <Sparkles size={14} /> {actionLoading ? 'Drawing...' : 'Execute Draw'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ═══════════════════ CATEGORY SCORING MODAL ═══════════════════ */}
            {showCategoryModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCategoryModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>
                                <CalendarDays size={18} style={{ marginRight: 6 }} />
                                Score Daily Categories
                            </h2>
                            <button className={styles.modalClose} onClick={() => setShowCategoryModal(false)}>×</button>
                        </div>

                        <form onSubmit={handleScoreCategories} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={categoryTournamentId ?? ''} readOnly />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Date (YYYY-MM-DD)</label>
                                <input
                                    type="date"
                                    className="input input--mono"
                                    value={categoryDate}
                                    onChange={(e) => setCategoryDate(e.target.value)}
                                />
                                <span className={styles.formHint}>
                                    Scores all registered wallets for this date in all category dimensions
                                </span>
                            </div>

                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowCategoryModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={actionLoading}>
                                    <BarChart3 size={14} /> {actionLoading ? 'Scoring...' : 'Score Categories'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
