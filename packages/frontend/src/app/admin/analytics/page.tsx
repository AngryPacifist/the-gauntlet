'use client';

// ============================================================================
// Admin Analytics — Phase 5 item 19 sub-route
// Phase 8.i.5.D.4.2: inline-style cleanup. Slate-palette literals + repeating
// table inline styles → module classes from admin/page.module.css.
//
// Tournament analytics + daily position metrics + quest anomaly detection.
// Extracted from monolithic /admin/page.tsx (pre-Phase-5).
//
// Admin secret: shared via localStorage (key 'adrena_admin_secret').
// Daily metrics + anomaly endpoints are admin-protected; analytics is public.
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
    listTournaments,
    getTournamentAnalytics,
    adminGetDailyAnalytics,
    adminGetAnomalies,
    type Tournament,
    type TournamentAnalytics,
    type AdminDailyAnalytics,
    type AdminAnomalyAnalytics,
} from '@/lib/api';
import { BarChart3, ArrowLeft, Activity, AlertTriangle } from 'lucide-react';
import styles from '../page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

function readSecret(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
}

function shortWallet(w: string): string {
    return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

export default function AdminAnalyticsPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

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

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    useEffect(() => {
        setAdminSecret(readSecret());
    }, []);

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const t = await listTournaments();
                setTournaments(t);
            } catch {
                showToast('Failed to load tournaments', 'error');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

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
            showToast(err instanceof Error ? err.message : 'Failed to load analytics', 'error');
            setAnalyticsId(null);
        } finally {
            setAnalyticsLoading(false);
        }
    }

    async function handleLoadDaily(tournamentId: number) {
        if (dailyId === tournamentId) {
            setDailyId(null);
            setDailyData(null);
            return;
        }
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        setDailyId(tournamentId);
        setDailyLoading(true);
        try {
            const data = await adminGetDailyAnalytics(tournamentId, dailyDate, adminSecret);
            setDailyData(data);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load daily metrics', 'error');
            setDailyId(null);
        } finally {
            setDailyLoading(false);
        }
    }

    async function handleRefreshDaily(tournamentId: number) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        setDailyLoading(true);
        try {
            const data = await adminGetDailyAnalytics(tournamentId, dailyDate, adminSecret);
            setDailyData(data);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load daily metrics', 'error');
        } finally {
            setDailyLoading(false);
        }
    }

    async function handleLoadAnomalies(tournamentId: number) {
        if (anomalyId === tournamentId) {
            setAnomalyId(null);
            setAnomalyData(null);
            return;
        }
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        setAnomalyId(tournamentId);
        setAnomalyLoading(true);
        try {
            const data = await adminGetAnomalies(tournamentId, adminSecret);
            setAnomalyData(data);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load anomalies', 'error');
            setAnomalyId(null);
        } finally {
            setAnomalyLoading(false);
        }
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
                <Link href="/admin" className={styles.adminHeaderLink}>
                    <ArrowLeft size={14} /> Back to Admin
                </Link>
                <h1 className="page-header__title">
                    <BarChart3 size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Analytics
                </h1>
                <p className="page-header__subtitle">
                    Per-tournament round stats, daily position metrics, and quest streak anomaly detection.
                </p>
            </header>

            {loading && <div className={styles.center}><div className="spinner" /></div>}
            {!loading && tournaments.length === 0 && <p className={styles.emptyText}>No tournaments yet.</p>}

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
                        <button className="btn btn--secondary" onClick={() => handleLoadAnalytics(t.id)}>
                            <BarChart3 size={14} /> {analyticsId === t.id ? 'Hide Analytics' : 'Analytics'}
                        </button>
                        <button className="btn btn--secondary" onClick={() => handleLoadDaily(t.id)}>
                            <Activity size={14} /> {dailyId === t.id ? 'Hide Daily Metrics' : 'Daily Metrics'}
                        </button>
                        <button className="btn btn--secondary" onClick={() => handleLoadAnomalies(t.id)}>
                            <AlertTriangle size={14} /> {anomalyId === t.id ? 'Hide Anomalies' : 'Anomalies'}
                        </button>
                    </div>

                    {/* Analytics panel */}
                    {analyticsId === t.id && (
                        <div className={styles.analyticsPanel}>
                            {analyticsLoading ? (
                                <div className={styles.analyticsLoading}>Loading analytics...</div>
                            ) : analyticsData ? (
                                <>
                                    <div className={styles.analyticsStatRow}>
                                        <div className={styles.analyticsStat}>
                                            <strong>{analyticsData.tournament.totalTraders}</strong> traders
                                        </div>
                                        <div className={styles.analyticsStat}>
                                            <strong>{analyticsData.tournament.totalRounds}</strong> rounds
                                        </div>
                                        <div className={styles.analyticsStat}>
                                            <strong>{analyticsData.tournament.totalRegistrations}</strong> registrations
                                        </div>
                                    </div>
                                    {analyticsData.roundStats.length > 0 && (
                                        <>
                                            <h4 className={styles.analyticsHead}>Round Progression</h4>
                                            <div className={styles.analyticsTableWrap}>
                                                <table className={styles.analyticsTable}>
                                                    <thead>
                                                        <tr>
                                                            <th>Round</th>
                                                            <th className={styles.analyticsThRight}>Traders</th>
                                                            <th className={styles.analyticsThRight}>Elim.</th>
                                                            <th className={styles.analyticsThRight}>Adv.</th>
                                                            <th className={styles.analyticsThRight}>Avg CPI</th>
                                                            <th className={styles.analyticsThRight}>Max CPI</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {analyticsData.roundStats.map((r, i) => (
                                                            <tr key={`${r.roundName}-${i}`}>
                                                                <td>{r.roundName}</td>
                                                                <td className={`${styles.analyticsTdRight} ${styles.analyticsTdMuted}`}>{r.traderCount}</td>
                                                                <td className={`${styles.analyticsTdRight} ${styles.analyticsTdDanger}`}>{r.eliminatedCount}</td>
                                                                <td className={`${styles.analyticsTdRight} ${styles.analyticsTdSuccess}`}>{r.advancedCount}</td>
                                                                <td className={`${styles.analyticsTdRight} ${styles.analyticsTdMono}`}>{r.avgCpi.toFixed(1)}</td>
                                                                <td className={`${styles.analyticsTdRight} ${styles.analyticsTdWarning}`}>{r.maxCpi.toFixed(1)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    )}
                                    {analyticsData.componentInsights && (
                                        <>
                                            <h4 className={styles.analyticsHead}>Component Insights (Advanced vs Eliminated)</h4>
                                            <div className={styles.componentInsightGrid}>
                                                {(['pnl', 'risk', 'consistency', 'activity'] as const).map((key) => (
                                                    <div key={key} className={styles.insightTile}>
                                                        <div className={styles.insightLabel}>{key}</div>
                                                        <div className={styles.insightAdvanced}>
                                                            {analyticsData.componentInsights!.advancedAvg[key].toFixed(1)}
                                                        </div>
                                                        <div className={styles.insightVs}>vs</div>
                                                        <div className={styles.insightEliminated}>
                                                            {analyticsData.componentInsights!.eliminatedAvg[key].toFixed(1)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {analyticsData.topPerformers.length > 0 && (
                                        <>
                                            <h4 className={styles.analyticsHead}>Top Performers</h4>
                                            <div className={styles.performersList}>
                                                {analyticsData.topPerformers.slice(0, 5).map((p, i) => (
                                                    <div key={`${p.wallet}-${p.roundNumber}`} className={styles.performerRow}>
                                                        <span className={`${styles.performerRank} ${i === 0 ? styles.performerRankFirst : styles.performerRankOther}`}>#{i + 1}</span>
                                                        <span className={styles.performerWallet}>{shortWallet(p.wallet)}</span>
                                                        <span className={styles.performerCpi}>{p.cpiScore.toFixed(1)}</span>
                                                        <span className={styles.performerRound}>{p.roundName}</span>
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
                        <div className={styles.analyticsPanel}>
                            <div className={styles.dailyMetricsHead}>
                                <h4 className={styles.dailyMetricsTitle}>Daily Position Metrics</h4>
                                <input
                                    type="date"
                                    className={`input input--mono ${styles.dailyMetricsDate}`}
                                    value={dailyDate}
                                    onChange={(e) => setDailyDate(e.target.value)}
                                />
                                <button
                                    className={`btn btn--secondary ${styles.dailyMetricsBtn}`}
                                    onClick={() => handleRefreshDaily(t.id)}
                                    disabled={dailyLoading}
                                >
                                    {dailyLoading ? 'Loading...' : 'Fetch'}
                                </button>
                            </div>
                            {dailyLoading ? (
                                <div className={styles.analyticsLoading}>Loading daily metrics...</div>
                            ) : dailyData ? (
                                <>
                                    <div className={styles.dailyStatGrid}>
                                        <div className={styles.dailyStatTile}>
                                            <div className={styles.dailyStatLabel}>Active Traders</div>
                                            <div className={styles.dailyStatValue}>{dailyData.stats.activeTraders}</div>
                                        </div>
                                        <div className={styles.dailyStatTile}>
                                            <div className={styles.dailyStatLabel}>Total Trades</div>
                                            <div className={styles.dailyStatValue}>{dailyData.stats.totalTrades}</div>
                                        </div>
                                        {dailyData.stats.fees && (
                                            <div className={styles.dailyStatTile}>
                                                <div className={styles.dailyStatLabel}>Total Fees</div>
                                                <div className={`${styles.dailyStatValue} ${styles.dailyStatValueWarning}`}>${dailyData.stats.fees.total.toFixed(2)}</div>
                                            </div>
                                        )}
                                    </div>
                                    {dailyData.stats.size && (
                                        <div className={styles.dailyMetricsLine}>
                                            <strong>Position Size:</strong> min ${dailyData.stats.size.min.toFixed(2)} / max ${dailyData.stats.size.max.toFixed(2)} / avg ${dailyData.stats.size.avg.toFixed(2)}
                                        </div>
                                    )}
                                    {dailyData.stats.leverage && (
                                        <div className={styles.dailyMetricsLine}>
                                            <strong>Leverage at Open:</strong> min {dailyData.stats.leverage.min.toFixed(1)}x / max {dailyData.stats.leverage.max.toFixed(1)}x / avg {dailyData.stats.leverage.avg.toFixed(1)}x
                                        </div>
                                    )}
                                    {dailyData.walletMetrics.length > 0 && (
                                        <div className={styles.analyticsTableWrap}>
                                            <table className={styles.analyticsTable}>
                                                <thead>
                                                    <tr>
                                                        <th>Wallet</th>
                                                        <th className={styles.analyticsThRight}>Trades</th>
                                                        <th className={styles.analyticsThRight}>L/S</th>
                                                        <th className={styles.analyticsThRight}>Avg Size</th>
                                                        <th className={styles.analyticsThRight}>Avg Lev.</th>
                                                        <th className={styles.analyticsThRight}>Fees</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {dailyData.walletMetrics.slice(0, 20).map((w) => (
                                                        <tr key={w.wallet}>
                                                            <td className={styles.analyticsTdMono}>{shortWallet(w.wallet)}</td>
                                                            <td className={styles.analyticsTdRight}>{w.tradeCount}</td>
                                                            <td className={`${styles.analyticsTdRight} ${styles.analyticsTdMuted}`}>{w.longCount}/{w.shortCount}</td>
                                                            <td className={`${styles.analyticsTdRight} ${styles.analyticsTdMono}`}>${w.avgSize.toFixed(2)}</td>
                                                            <td className={`${styles.analyticsTdRight} ${styles.analyticsTdMono}`}>{w.avgLeverage.toFixed(1)}x</td>
                                                            <td className={`${styles.analyticsTdRight} ${styles.analyticsTdWarning}`}>${w.totalFees.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className={styles.dailyEmpty}>Select a date and click Fetch</div>
                            )}
                        </div>
                    )}

                    {/* Anomaly detection panel */}
                    {anomalyId === t.id && (
                        <div className={styles.analyticsPanel}>
                            <h4 className={styles.analyticsHead}>Quest Anomaly Detection</h4>
                            {anomalyLoading ? (
                                <div className={styles.analyticsLoading}>Scanning for anomalies...</div>
                            ) : anomalyData ? (
                                <>
                                    <div className={styles.anomalyHead}>
                                        Streak threshold: <strong>{anomalyData.streakThreshold}+ consecutive days</strong> in top 5 ·{' '}
                                        <strong className={`${styles.anomalyHeadCount} ${anomalyData.anomalyCount > 0 ? styles.anomalyHeadCountWarn : styles.anomalyHeadCountSafe}`}>
                                            {anomalyData.anomalyCount}
                                        </strong> anomalies detected
                                    </div>
                                    {anomalyData.anomalies.length > 0 ? (
                                        <div className={styles.analyticsTableWrap}>
                                            <table className={styles.analyticsTable}>
                                                <thead>
                                                    <tr>
                                                        <th>Wallet</th>
                                                        <th>Category</th>
                                                        <th className={styles.analyticsThRight}>Streak</th>
                                                        <th>Dates</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {anomalyData.anomalies.map((a, i) => (
                                                        <tr key={`${a.wallet}-${a.category}-${i}`}>
                                                            <td className={styles.analyticsTdMono}>{shortWallet(a.wallet)}</td>
                                                            <td>{a.category.replace(/_/g, ' ')}</td>
                                                            <td className={`${styles.analyticsTdRight} ${a.streakLength >= 5 ? styles.anomalyStreakSevere : styles.anomalyStreakModerate}`}>{a.streakLength}d</td>
                                                            <td className={styles.anomalyDates}>{a.dates[0]} → {a.dates[a.dates.length - 1]}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className={styles.anomalyEmpty}>✓ No anomalies detected</div>
                                    )}
                                </>
                            ) : null}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
