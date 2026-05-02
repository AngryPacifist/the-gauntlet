'use client';

// ============================================================================
// Admin Tournaments — Phase 5 item 19 sub-route
//
// Tournament CRUD + lifecycle (create, start, score, advance, cancel, delete) +
// raffle controls (compute, draw, verify, reset) + category scoring trigger.
// Extracted from monolithic /admin/page.tsx (pre-Phase-5).
//
// Admin secret: shared via localStorage (key 'adrena_admin_secret').
// Modal-internal-draft pattern preserved (Phase 4 admin UX fix).
// ============================================================================

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
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
    adminGetTradableAssets,
    type Tournament,
    type TournamentConfig,
} from '@/lib/api';
import {
    Trophy, Plus, Play, BarChart3, ChevronRight, Trash2, Ban,
    ExternalLink, Terminal, Ticket, Sparkles, CheckCircle2,
    CalendarDays, Lock, RotateCcw, Flame, Swords, ArrowLeft, Compass,
} from 'lucide-react';
import styles from '../page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

function readSecret(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

export default function AdminTournamentsPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create tournament modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [modalSecretDraft, setModalSecretDraft] = useState('');

    // Config fields
    const [cfgFormat, setCfgFormat] = useState<'bracket' | 'rank_only'>('bracket');
    const [cfgBracketSize, setCfgBracketSize] = useState(8);
    const [cfgAdvanceRatio, setCfgAdvanceRatio] = useState(0.5);
    const [cfgRoundDurations, setCfgRoundDurations] = useState('72, 48, 48');
    const [cfgMinCollateral, setCfgMinCollateral] = useState(25);
    const [cfgMinDuration, setCfgMinDuration] = useState(120);
    const [cfgAllAroundMinTradeUsd, setCfgAllAroundMinTradeUsd] = useState(500);
    const [cfgRiskManagerMinSize, setCfgRiskManagerMinSize] = useState(1000);
    const [cfgAllAroundMaxPointsPerAsset, setCfgAllAroundMaxPointsPerAsset] = useState(25);
    const [cfgFisherRankPoints, setCfgFisherRankPoints] = useState('3, 2, 1');
    const [cfgDailyQuestPoints, setCfgDailyQuestPoints] = useState('0.2, 0.15, 0.1, 0.05, 0.01');
    const [cfgMultidayQuestPoints, setCfgMultidayQuestPoints] = useState('0.3, 0.25, 0.2, 0.15, 0.1');
    const [cfgTopPercentCutoff, setCfgTopPercentCutoff] = useState(0.30);
    const [cfgRaffleMinClosedPositions, setCfgRaffleMinClosedPositions] = useState(10);
    const [cfgCpiTicketMultiplier, setCfgCpiTicketMultiplier] = useState(0.5);
    const [cfgQuestTicketMultiplier, setCfgQuestTicketMultiplier] = useState(20);
    const [cfgUseHistoricalWindow, setCfgUseHistoricalWindow] = useState(false);
    const [cfgHistoricalWindowDays, setCfgHistoricalWindowDays] = useState(90);
    const [cfgAssetCount, setCfgAssetCount] = useState(4);
    const [cfgPrizeEnabled, setCfgPrizeEnabled] = useState(false);
    const [cfgPrizeTotalPool, setCfgPrizeTotalPool] = useState(1000);
    const [cfgPrizeCurrency, setCfgPrizeCurrency] = useState<'ADX' | 'USDC'>('ADX');
    const [cfgSkillPrizes, setCfgSkillPrizes] = useState('500, 300, 200');
    const [cfgRafflePrizes, setCfgRafflePrizes] = useState('100, 50, 25');
    const [cfgAssetList, setCfgAssetList] = useState<Array<{ symbol: string; mint?: string; joinedAt: string }>>([]);
    const [cfgTradableAssets, setCfgTradableAssets] = useState<Array<{ symbol: string; mint: string }>>([]);
    const [cfgTradableAssetsError, setCfgTradableAssetsError] = useState<string | null>(null);

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

    // Hydrate admin secret from localStorage on mount
    useEffect(() => {
        setAdminSecret(readSecret());
    }, []);

    useEffect(() => {
        if (!showCreateModal) setModalSecretDraft('');
    }, [showCreateModal]);

    const loadTradableAssetsIfReady = async (secret: string) => {
        if (!secret || cfgTradableAssets.length > 0) return;
        try {
            const assets = await adminGetTradableAssets(secret);
            setCfgTradableAssets(assets);
            setCfgTradableAssetsError(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load tradable assets';
            setCfgTradableAssetsError(msg);
            addLog(`Warning: ${msg} — asset list dropdown falling back to free-text`);
        }
    };

    async function loadAll() {
        try {
            setLoading(true);
            const t = await listTournaments();
            setTournaments(t);
        } catch {
            addLog('Failed to load tournaments');
            showToast('Failed to load tournaments', 'error');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadAll(); }, []);

    function resetConfigDefaults() {
        setNewName('');
        setCfgFormat('bracket');
        setCfgBracketSize(8);
        setCfgAdvanceRatio(0.5);
        setCfgRoundDurations('72, 48, 48');
        setCfgMinCollateral(25);
        setCfgMinDuration(120);
        setCfgAllAroundMinTradeUsd(500);
        setCfgRiskManagerMinSize(1000);
        setCfgAllAroundMaxPointsPerAsset(25);
        setCfgFisherRankPoints('3, 2, 1');
        setCfgDailyQuestPoints('0.2, 0.15, 0.1, 0.05, 0.01');
        setCfgMultidayQuestPoints('0.3, 0.25, 0.2, 0.15, 0.1');
        setCfgTopPercentCutoff(0.30);
        setCfgRaffleMinClosedPositions(10);
        setCfgCpiTicketMultiplier(0.5);
        setCfgQuestTicketMultiplier(20);
        setCfgUseHistoricalWindow(false);
        setCfgHistoricalWindowDays(90);
        setCfgAssetCount(4);
        setCfgPrizeEnabled(false);
        setCfgPrizeTotalPool(1000);
        setCfgPrizeCurrency('ADX');
        setCfgSkillPrizes('500, 300, 200');
        setCfgRafflePrizes('100, 50, 25');
        setCfgAssetList([]);
    }

    function commitSecret(value: string) {
        setAdminSecret(value);
        if (value) {
            localStorage.setItem(ADMIN_SECRET_KEY, value);
        } else {
            localStorage.removeItem(ADMIN_SECRET_KEY);
        }
    }

    // Phase 7.c: live prize-totals descriptor.
    // Warns when skill+raffle sum doesn't match cfgPrizeTotalPool — ZeDef Apr 29
    // hit this footgun (100k Total Pool, 1175 in array sums).
    const prizeSums = useMemo(() => {
        const parse = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
        const skillTotal = parse(cfgSkillPrizes).reduce((a, b) => a + b, 0);
        const raffleTotal = parse(cfgRafflePrizes).reduce((a, b) => a + b, 0);
        const combined = skillTotal + raffleTotal;
        const matches = combined === cfgPrizeTotalPool;
        return { skillTotal, raffleTotal, combined, matches };
    }, [cfgSkillPrizes, cfgRafflePrizes, cfgPrizeTotalPool]);

    // ── Tournament handlers ──────────────────────────────────────────────────

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;

        const effectiveSecret = adminSecret || modalSecretDraft;
        if (!effectiveSecret) {
            showToast('Admin secret required', 'error');
            return;
        }

        const parseNums = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n));
        const durations = parseNums(cfgRoundDurations).filter((n) => n > 0);
        const fisherRankPoints = parseNums(cfgFisherRankPoints);
        const dailyQuestPoints = parseNums(cfgDailyQuestPoints);
        const multidayQuestPoints = parseNums(cfgMultidayQuestPoints);
        const skillPrizes = parseNums(cfgSkillPrizes);
        const rafflePrizes = parseNums(cfgRafflePrizes);

        if (fisherRankPoints.length !== 3) {
            showToast('Fisher rank points must have exactly 3 entries (1st/2nd/3rd)', 'error');
            return;
        }
        if (dailyQuestPoints.length !== 5) {
            showToast('Daily quest points must have exactly 5 entries (ranks 1-5)', 'error');
            return;
        }
        if (multidayQuestPoints.length !== 5) {
            showToast('Multi-day quest points must have exactly 5 entries (ranks 1-5)', 'error');
            return;
        }
        if (cfgAssetList.some((a) => !a.symbol.trim())) {
            showToast('Every asset must have a non-empty symbol', 'error');
            return;
        }

        const config: Partial<TournamentConfig> = {
            format: cfgFormat,
            bracketSize: cfgBracketSize,
            advanceRatio: cfgAdvanceRatio,
            roundDurations: durations.length > 0 ? durations : (cfgFormat === 'rank_only' ? [336] : [72, 48, 48]),
            minPositionCollateral: cfgMinCollateral,
            minTradeDurationSec: cfgMinDuration,
            supportedAssetCount: cfgAssetCount,
            topPercentCutoff: cfgTopPercentCutoff,
            allAroundMinTradeUsd: cfgAllAroundMinTradeUsd,
            allAroundMaxPointsPerAsset: cfgAllAroundMaxPointsPerAsset,
            fisherRankPoints,
            dailyQuestPoints,
            multidayQuestPoints,
            raffleMinClosedPositions: cfgRaffleMinClosedPositions,
            cpiTicketMultiplier: cfgCpiTicketMultiplier,
            questTicketMultiplier: cfgQuestTicketMultiplier,
            riskManagerMinSize: cfgRiskManagerMinSize,
            useHistoricalWindow: cfgUseHistoricalWindow,
            historicalWindowDays: cfgHistoricalWindowDays,
        };

        if (cfgPrizeEnabled) {
            config.prizeTable = { totalPool: cfgPrizeTotalPool, currency: cfgPrizeCurrency, skillPrizes, rafflePrizes };
        }
        if (cfgAssetList.length > 0) {
            config.assetList = cfgAssetList.map((a) => {
                const item: { symbol: string; mint?: string; joinedAt: string } = {
                    symbol: a.symbol.trim(),
                    joinedAt: a.joinedAt,
                };
                if (a.mint && a.mint.trim()) item.mint = a.mint.trim();
                return item;
            });
        }

        try {
            setCreating(true);
            const result = await createTournament(newName.trim(), config, effectiveSecret);
            if (!adminSecret && modalSecretDraft) {
                commitSecret(modalSecretDraft);
                setModalSecretDraft('');
            }
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
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleScore(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleAdvance(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleCancel(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleDelete(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleComputeRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleDrawRaffle(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !drawTournamentId) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!drawBlockHash.trim()) { showToast('Block hash is required', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminDrawRaffle(drawTournamentId, drawBlockHash.trim(), drawPrizeCount, adminSecret);
            addLog(`Raffle drawn for tournament #${drawTournamentId}: ${result.winners.length} winner(s) — ${result.winners.map((w) => w.slice(0, 8) + '...').join(', ')}`);
            showToast(`${result.winners.length} raffle winner(s) drawn!`, 'success');
            setShowDrawModal(false);
            setDrawBlockHash('');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to draw raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
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
        } finally { setActionLoading(false); }
    }

    async function handleResetRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
        } finally { setActionLoading(false); }
    }

    async function handleScoreCategories(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !categoryTournamentId) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
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
                    <Trophy size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Tournaments
                </h1>
                <p className="page-header__subtitle">
                    Create, start, score, advance, cancel, delete tournaments. Raffle controls + category scoring.
                </p>
            </header>

            {/* Tournament Controls */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Tournament Controls</h2>
                    <button className="btn btn--primary" onClick={() => {
                        setShowCreateModal(true);
                        loadTradableAssetsIfReady(adminSecret);
                    }}>
                        <Plus size={14} /> New Tournament
                    </button>
                </div>

                {loading && <div className={styles.center}><div className="spinner" /></div>}
                {!loading && tournaments.length === 0 && <p className={styles.emptyText}>No tournaments yet. Create one above.</p>}

                {!loading && tournaments.map((t) => (
                    <div key={t.id} className={`card ${styles.controlCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <h3 className={styles.controlName}>{t.name}</h3>
                                <span className={styles.controlId}>ID: {t.id} · {t.config.format === 'rank_only' ? 'Forge' : 'Gauntlet'}</span>
                            </div>
                            <span className={`badge badge--${t.status}`}>{t.status}</span>
                        </div>

                        <div className={styles.controlActions}>
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
                                    <button className="btn btn--secondary" onClick={() => {
                                        setDrawTournamentId(t.id);
                                        // Phase 7.d: lock prizeCount to rafflePrizes.length on modal open.
                                        const len = t.config.prizeTable?.rafflePrizes?.length;
                                        setDrawPrizeCount(len && len > 0 ? len : 3);
                                        setShowDrawModal(true);
                                    }} disabled={actionLoading}>
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
                                    <button className="btn btn--secondary" onClick={() => {
                                        setDrawTournamentId(t.id);
                                        // Phase 7.d: lock prizeCount to rafflePrizes.length on modal open.
                                        const len = t.config.prizeTable?.rafflePrizes?.length;
                                        setDrawPrizeCount(len && len > 0 ? len : 3);
                                        setShowDrawModal(true);
                                    }} disabled={actionLoading}>
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
                            {/* Quick-links — Section 3C "link to Forge pages" */}
                            {t.config.format === 'rank_only' ? (
                                <a href={`/leaderboard/${t.id}`} className="btn btn--secondary">
                                    <ExternalLink size={14} /> View Forge
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
                            <a href={`/categories/${t.id}`} className="btn btn--secondary">
                                <CalendarDays size={14} /> Categories
                            </a>
                            <Link href="/admin/analytics" className="btn btn--secondary">
                                <Compass size={14} /> Analytics
                            </Link>
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

            {/* CREATE TOURNAMENT MODAL */}
            {showCreateModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Create Tournament</h2>
                            <button className={styles.modalClose} onClick={() => setShowCreateModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreate} className={styles.modalForm}>
                            {!adminSecret && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>
                                        <Lock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Admin Secret
                                    </label>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        <input type="password" className="input input--mono" placeholder="Required to create — paste your secret + click Apply"
                                            value={modalSecretDraft} onChange={(e) => setModalSecretDraft(e.target.value)} style={{ flex: 1 }} />
                                        <button type="button" className="btn btn--secondary" disabled={!modalSecretDraft.trim()}
                                            onClick={() => {
                                                const draft = modalSecretDraft;
                                                commitSecret(draft);
                                                setModalSecretDraft('');
                                                loadTradableAssetsIfReady(draft);
                                            }}>Apply</button>
                                    </div>
                                    <span className={styles.formHint}>Click Apply to authenticate. Auto-hides once set.</span>
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament Name</label>
                                <input type="text" className="input" placeholder="e.g., The Gauntlet Pilot"
                                    value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                            </div>

                            <div className={styles.formDivider} />

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Format</label>
                                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                    <button type="button" className={`btn ${cfgFormat === 'bracket' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('bracket'); setCfgRoundDurations('72, 48, 48'); }} style={{ flex: 1 }}>
                                        <Swords size={14} /> Gauntlet
                                    </button>
                                    <button type="button" className={`btn ${cfgFormat === 'rank_only' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('rank_only'); setCfgRoundDurations('336'); }} style={{ flex: 1 }}>
                                        <Flame size={14} /> Forge
                                    </button>
                                </div>
                                <span className={styles.formHint}>
                                    {cfgFormat === 'bracket' ? 'Bracket elimination with rounds — The Gauntlet' : 'Flat leaderboard, open registration — The Forge'}
                                </span>
                            </div>

                            <h3 className={styles.formSectionTitle}>Round / Bracket</h3>
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
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>{cfgFormat === 'rank_only' ? 'Competition Duration (hours)' : 'Round Durations (hours)'}</label>
                                <input type="text" className="input input--mono" value={cfgRoundDurations} onChange={(e) => setCfgRoundDurations(e.target.value)}
                                    placeholder={cfgFormat === 'rank_only' ? '336' : '72, 48, 48'} />
                                <span className={styles.formHint}>{cfgFormat === 'rank_only' ? 'Total competition length in hours (e.g., 336 = 14 days)' : 'Comma-separated hours per round (R1, R2, R3)'}</span>
                            </div>

                            <h3 className={styles.formSectionTitle}>Anti-Gaming Filters</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Collateral ($)</label>
                                    <input type="number" className="input input--mono" value={cfgMinCollateral} onChange={(e) => setCfgMinCollateral(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Min collateral for CPI + quest trades</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Trade Duration (s)</label>
                                    <input type="number" className="input input--mono" value={cfgMinDuration} onChange={(e) => setCfgMinDuration(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Wash-trade filter (e.g., 240 = 4 min for test)</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>All Around Min Trade ($)</label>
                                    <input type="number" className="input input--mono" value={cfgAllAroundMinTradeUsd} onChange={(e) => setCfgAllAroundMinTradeUsd(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Quest-specific min exit_size (test: 100 / prod: 500)</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Risk Manager Min Size ($)</label>
                                    <input type="number" className="input input--mono" value={cfgRiskManagerMinSize} onChange={(e) => setCfgRiskManagerMinSize(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Minimum trade exit_size for RM eligibility (test: 500 / prod: 1000)</span>
                                </div>
                            </div>

                            <h3 className={styles.formSectionTitle}>Scoring Policy</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>All Around Max Points/Asset</label>
                                    <input type="number" className="input input--mono" value={cfgAllAroundMaxPointsPerAsset} onChange={(e) => setCfgAllAroundMaxPointsPerAsset(Number(e.target.value))} min={1} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Supported Assets (count)</label>
                                    <input type="number" className="input input--mono" value={cfgAssetCount} onChange={(e) => setCfgAssetCount(Number(e.target.value))} min={1} />
                                </div>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Fisher Rank Points</label>
                                <input type="text" className="input input--mono" value={cfgFisherRankPoints} onChange={(e) => setCfgFisherRankPoints(e.target.value)} placeholder="3, 2, 1" />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Daily Quest Points (ranks 1-5)</label>
                                <input type="text" className="input input--mono" value={cfgDailyQuestPoints} onChange={(e) => setCfgDailyQuestPoints(e.target.value)} placeholder="0.2, 0.15, 0.1, 0.05, 0.01" />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Multi-Day Quest Points (ranks 1-5)</label>
                                <input type="text" className="input input--mono" value={cfgMultidayQuestPoints} onChange={(e) => setCfgMultidayQuestPoints(e.target.value)} placeholder="0.3, 0.25, 0.2, 0.15, 0.1" />
                            </div>

                            <h3 className={styles.formSectionTitle}>Raffle Policy</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Top % Cutoff (skill prizes)</label>
                                    <input type="number" className="input input--mono" value={cfgTopPercentCutoff} onChange={(e) => setCfgTopPercentCutoff(Number(e.target.value))} min={0.01} max={0.99} step={0.01} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Closed Positions</label>
                                    <input type="number" className="input input--mono" value={cfgRaffleMinClosedPositions} onChange={(e) => setCfgRaffleMinClosedPositions(Number(e.target.value))} min={0} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>CPI Ticket Multiplier</label>
                                    <input type="number" className="input input--mono" value={cfgCpiTicketMultiplier} onChange={(e) => setCfgCpiTicketMultiplier(Number(e.target.value))} min={0} step={0.1} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Quest Ticket Multiplier</label>
                                    <input type="number" className="input input--mono" value={cfgQuestTicketMultiplier} onChange={(e) => setCfgQuestTicketMultiplier(Number(e.target.value))} min={0} step={1} />
                                </div>
                            </div>

                            <h3 className={styles.formSectionTitle}>Backtest Mode</h3>
                            <div className={styles.formGroup} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="cfg-use-hist" checked={cfgUseHistoricalWindow} onChange={(e) => setCfgUseHistoricalWindow(e.target.checked)} />
                                <label htmlFor="cfg-use-hist" style={{ cursor: 'pointer' }}>Use historical window (instead of live round dates)</label>
                            </div>
                            {cfgUseHistoricalWindow && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Historical Window (days)</label>
                                    <input type="number" className="input input--mono" value={cfgHistoricalWindowDays} onChange={(e) => setCfgHistoricalWindowDays(Number(e.target.value))} min={1} />
                                </div>
                            )}

                            <h3 className={styles.formSectionTitle}>Prize Distribution</h3>
                            <div className={styles.formGroup} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="cfg-prize-enabled" checked={cfgPrizeEnabled} onChange={(e) => setCfgPrizeEnabled(e.target.checked)} />
                                <label htmlFor="cfg-prize-enabled" style={{ cursor: 'pointer' }}>Enable prize table (skill + raffle prize amounts)</label>
                            </div>
                            {cfgPrizeEnabled && (
                                <>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Total Pool</label>
                                            <input type="number" className="input input--mono" value={cfgPrizeTotalPool} onChange={(e) => setCfgPrizeTotalPool(Number(e.target.value))} min={0} />
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Currency</label>
                                            <select value={cfgPrizeCurrency} onChange={(e) => setCfgPrizeCurrency(e.target.value as 'ADX' | 'USDC')} className="input">
                                                <option value="ADX">ADX</option>
                                                <option value="USDC">USDC</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Skill Prizes (rank 1, 2, 3, ...)</label>
                                        <input type="text" className="input input--mono" value={cfgSkillPrizes} onChange={(e) => setCfgSkillPrizes(e.target.value)} placeholder="500, 300, 200" />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Raffle Prizes (winner 1, 2, 3, ...)</label>
                                        <input type="text" className="input input--mono" value={cfgRafflePrizes} onChange={(e) => setCfgRafflePrizes(e.target.value)} placeholder="100, 50, 25" />
                                    </div>
                                    {/* Phase 7.c: live prize-totals descriptor — warns when sums don't match Total Pool */}
                                    <div style={{
                                        padding: '0.5rem 0.75rem',
                                        background: prizeSums.matches ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                        border: `1px solid ${prizeSums.matches ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
                                        borderRadius: '6px',
                                        fontSize: '0.8125rem',
                                        color: prizeSums.matches ? '#22c55e' : '#fbbf24',
                                        fontFamily: 'monospace',
                                    }}>
                                        <strong>{prizeSums.matches ? '✓' : '⚠'}</strong>
                                        {' '}Skill total: {prizeSums.skillTotal.toLocaleString('en-US')}
                                        {' | '}Raffle total: {prizeSums.raffleTotal.toLocaleString('en-US')}
                                        {' | '}Combined: {prizeSums.combined.toLocaleString('en-US')}
                                        {prizeSums.matches
                                            ? ' (matches Total Pool)'
                                            : ` (Total Pool: ${cfgPrizeTotalPool.toLocaleString('en-US')})`}
                                    </div>
                                </>
                            )}

                            <h3 className={styles.formSectionTitle}>Asset List</h3>
                            <p className={styles.formHint} style={{ marginBottom: '0.5rem' }}>
                                Tradable assets scored in this tournament. Leave empty for engine fallback (permissive — all symbols observed).
                            </p>
                            {!adminSecret && cfgTradableAssets.length === 0 && !cfgTradableAssetsError && (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                                    Enter admin secret in the field at the top of this modal to load the asset dropdown.
                                </p>
                            )}
                            {cfgTradableAssetsError && (
                                <p style={{ color: 'var(--status-warning)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                                    Asset list fetch failed — falling back to free-text.
                                </p>
                            )}
                            {cfgAssetList.map((asset, i) => (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    {cfgTradableAssets.length > 0 ? (
                                        <select className="input input--mono" value={asset.symbol}
                                            onChange={(e) => {
                                                const selected = cfgTradableAssets.find((tt) => tt.symbol === e.target.value);
                                                setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, symbol: e.target.value, mint: selected?.mint } : a));
                                            }} style={{ flex: 1 }}>
                                            <option value="">— select asset —</option>
                                            {cfgTradableAssets.map((tt) => (
                                                <option key={tt.mint} value={tt.symbol}>{tt.symbol} ({tt.mint.slice(0, 4)}…{tt.mint.slice(-4)})</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input type="text" className="input input--mono" placeholder="SYMBOL (e.g., SOL)" value={asset.symbol}
                                            onChange={(e) => setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, symbol: e.target.value.toUpperCase() } : a))} style={{ flex: 1 }} />
                                    )}
                                    <span className={styles.formHint} style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>joinedAt: {asset.joinedAt}</span>
                                    <button type="button" className="btn btn--secondary"
                                        onClick={() => setCfgAssetList((prev) => prev.filter((_, j) => j !== i))}
                                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Remove</button>
                                </div>
                            ))}
                            <button type="button" className="btn btn--secondary"
                                onClick={() => setCfgAssetList((prev) => [...prev, { symbol: '', mint: '', joinedAt: todayUtc() }])}
                                style={{ marginTop: '0.5rem' }}>
                                <Plus size={14} /> Add Asset
                            </button>

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

            {/* RAFFLE DRAW MODAL */}
            {showDrawModal && (
                <div className={styles.modalOverlay} onClick={() => setShowDrawModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}><Sparkles size={18} style={{ marginRight: 6 }} /> Draw Raffle Winners</h2>
                            <button className={styles.modalClose} onClick={() => setShowDrawModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleDrawRaffle} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={drawTournamentId ?? ''} readOnly />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Bitcoin Block Hash</label>
                                <input type="text" className="input input--mono" placeholder="000000000000000000024bead8df69990852c202..."
                                    value={drawBlockHash} onChange={(e) => setDrawBlockHash(e.target.value)} autoFocus />
                                <span className={styles.formHint}>Deterministic seed — use a recent Bitcoin block hash for verifiability</span>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Number of Winners</label>
                                <input type="number" className="input input--mono" value={drawPrizeCount} readOnly disabled
                                    style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                                <span className={styles.formHint}>
                                    Locked to <code>rafflePrizes.length</code> from tournament config (Phase 7.d) — prevents prizeCount/rafflePrizes mismatch.
                                </span>
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

            {/* CATEGORY SCORING MODAL */}
            {showCategoryModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCategoryModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}><CalendarDays size={18} style={{ marginRight: 6 }} /> Score Daily Categories</h2>
                            <button className={styles.modalClose} onClick={() => setShowCategoryModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleScoreCategories} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={categoryTournamentId ?? ''} readOnly />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Date (YYYY-MM-DD)</label>
                                <input type="date" className="input input--mono" value={categoryDate} onChange={(e) => setCategoryDate(e.target.value)} />
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
