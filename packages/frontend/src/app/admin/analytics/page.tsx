'use client';

// ============================================================================
// Admin Analytics — Phase 5 item 19 sub-route
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
                <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.8125rem', textDecoration: 'none', marginBottom: 'var(--space-sm)' }}>
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
                        <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                            {analyticsLoading ? (
                                <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)' }}>Loading analytics...</div>
                            ) : analyticsData ? (
                                <>
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
                                <input type="date" className="input input--mono" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} style={{ maxWidth: '180px', fontSize: '0.75rem' }} />
                                <button className="btn btn--secondary" onClick={() => handleRefreshDaily(t.id)} disabled={dailyLoading} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                                    {dailyLoading ? 'Loading...' : 'Fetch'}
                                </button>
                            </div>
                            {dailyLoading ? (
                                <div style={{ textAlign: 'center', padding: 'var(--space-md)', color: 'var(--text-muted)' }}>Loading daily metrics...</div>
                            ) : dailyData ? (
                                <>
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
                                        Streak threshold: <strong style={{ color: 'var(--text-primary)' }}>{anomalyData.streakThreshold}+ consecutive days</strong> in top 5 ·{' '}
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
        </div>
    );
}
