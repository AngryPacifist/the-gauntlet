'use client';

import { useEffect, useState, use } from 'react';
import {
    getTournamentAnalytics,
    type TournamentAnalytics,
    type RoundStats,
} from '@/lib/api';
import {
    ArrowLeft,
    BarChart3,
    Trophy,
    TrendingUp,
    Users,
    Target,
    Award,
    Calendar,
} from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

export default function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const tournamentId = parseInt(id, 10);

    const [analytics, setAnalytics] = useState<TournamentAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const data = await getTournamentAnalytics(tournamentId);
                setAnalytics(data);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load analytics');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [tournamentId]);

    if (loading) return <div className="container"><div className="loading-state">Loading analytics...</div></div>;
    if (error) return <div className="container"><div className="error-state">{error}</div></div>;
    if (!analytics) return <div className="container"><div className="error-state">Not found</div></div>;

    const { tournament, roundStats, scoreDistribution, componentInsights, topPerformers, categoryData } = analytics;

    // Split rounds by type
    const mainRounds = roundStats.filter(r => r.roundType === 'main');
    const consolationRounds = roundStats.filter(r => r.roundType === 'consolation');

    // Compute max values for bar scaling
    const maxTraderCount = Math.max(...roundStats.map(r => r.traderCount), 1);
    const maxDistCount = Math.max(...scoreDistribution.map(d => d.count), 1);

    function renderFunnel(rounds: RoundStats[], label: string) {
        if (rounds.length === 0) return null;
        return (
            <div>
                <h3 className={styles.funnelGroupLabel}>{label}</h3>
                <div className={styles.funnel}>
                    {rounds.map((round) => {
                        const widthPct = (round.traderCount / maxTraderCount) * 100;
                        const advancedPct = round.traderCount > 0
                            ? (round.advancedCount / round.traderCount) * 100
                            : 0;
                        return (
                            <div key={round.roundNumber} className={styles.funnelRow}>
                                <span className={styles.funnelLabel}>{round.roundName}</span>
                                <div className={styles.funnelBarContainer}>
                                    <div
                                        className={`${styles.funnelBar}${round.roundType === 'consolation' ? ` ${styles.funnelBarConsolation}` : ''}`}
                                        style={{ width: `${widthPct}%` }}
                                    >
                                        <div
                                            className={`${styles.funnelAdvanced}${round.roundType === 'consolation' ? ` ${styles.funnelAdvancedConsolation}` : ''}`}
                                            style={{ width: `${advancedPct}%` }}
                                        />
                                    </div>
                                    <span className={styles.funnelCount}>
                                        {round.advancedCount} / {round.traderCount}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function renderStatsTable(rounds: RoundStats[], label: string) {
        if (rounds.length === 0) return null;
        return (
            <div>
                <h3 className={styles.funnelGroupLabel}>{label}</h3>
                <div className={styles.tableContainer}>
                    <table className={styles.statsTable}>
                        <thead>
                            <tr>
                                <th>Round</th>
                                <th>Traders</th>
                                <th>Avg CPI</th>
                                <th>Min</th>
                                <th>Max</th>
                                <th>Avg PnL</th>
                                <th>Avg Risk</th>
                                <th>Avg Cons.</th>
                                <th>Avg Act.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rounds.map((round) => (
                                <tr key={round.roundNumber}>
                                    <td className={styles.roundNameCell}>{round.roundName}</td>
                                    <td>{round.traderCount}</td>
                                    <td className={styles.cpiCell}>{round.avgCpi.toFixed(1)}</td>
                                    <td>{round.minCpi.toFixed(1)}</td>
                                    <td>{round.maxCpi.toFixed(1)}</td>
                                    <td>{round.avgPnl.toFixed(1)}</td>
                                    <td>{round.avgRisk.toFixed(1)}</td>
                                    <td>{round.avgConsistency.toFixed(1)}</td>
                                    <td>{round.avgActivity.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            {/* Header */}
            <header className="page-header">
                <Link href={`/tournament/${tournamentId}`} className={styles.backLink}>
                    <ArrowLeft size={14} /> Back to Tournament
                </Link>
                <div className={styles.headerRow}>
                    <div>
                        <h1 className="page-header__title">
                            <BarChart3 size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                            {tournament.name} — Analytics
                        </h1>
                        <p className="page-header__subtitle">
                            {tournament.totalTraders} traders across {tournament.totalRounds} round{tournament.totalRounds !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <span className={`badge badge--${tournament.status}`}>
                        {tournament.status}
                    </span>
                </div>
            </header>

            {/* Season Banner */}
            {tournament.season && (
                <div className={`card ${styles.seasonBanner}`}>
                    <Calendar size={16} />
                    <div>
                        <span className={styles.seasonName}>
                            <Link href={`/seasons`}>{tournament.season.name}</Link>
                        </span>
                        <span className={styles.seasonDetail}>
                            Week {tournament.season.weekNumber} of {tournament.season.currentWeek} • Season {tournament.season.status}
                        </span>
                    </div>
                </div>
            )}

            {/* Overview Stats */}
            <div className={`stat-grid ${styles.overviewStats}`}>
                <div className="card stat-card">
                    <div className="stat-card__label"><Users size={12} style={{ marginRight: 4 }} /> Registered</div>
                    <div className="stat-card__value">{tournament.totalRegistrations}</div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label"><Target size={12} style={{ marginRight: 4 }} /> Competed</div>
                    <div className="stat-card__value stat-card__value--accent">{tournament.totalTraders}</div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label"><BarChart3 size={12} style={{ marginRight: 4 }} /> Rounds</div>
                    <div className="stat-card__value">
                        {mainRounds.length}
                        {consolationRounds.length > 0 && (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                                {' '}+ {consolationRounds.length} consolation
                            </span>
                        )}
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label"><TrendingUp size={12} style={{ marginRight: 4 }} /> Avg CPI</div>
                    <div className="stat-card__value stat-card__value--accent">
                        {mainRounds.length > 0 ? (mainRounds.reduce((a, r) => a + r.avgCpi, 0) / mainRounds.length).toFixed(1) : '—'}
                    </div>
                </div>
            </div>

            {roundStats.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p className="text-muted">No scored rounds yet. Analytics will appear once the first round is scored.</p>
                </div>
            )}

            {roundStats.length > 0 && (
                <>
                    {/* Section 1: Elimination Funnel */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>
                            <Users size={16} style={{ marginRight: 6 }} /> Elimination Funnel
                        </h2>
                        <div className="card">
                            {renderFunnel(mainRounds, 'MAIN BRACKET')}
                            {renderFunnel(consolationRounds, 'FALLEN FIGHTERS')}
                            <div className={styles.funnelLegend}>
                                <span><span className={styles.legendDotAdvanced} /> Advanced</span>
                                <span><span className={styles.legendDotEliminated} /> Eliminated</span>
                            </div>
                        </div>
                    </section>

                    {/* Section 2: Round-by-Round Performance */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>
                            <TrendingUp size={16} style={{ marginRight: 6 }} /> Round-by-Round Performance
                        </h2>
                        <div className="card">
                            {renderStatsTable(mainRounds, 'MAIN BRACKET')}
                            {renderStatsTable(consolationRounds, 'FALLEN FIGHTERS')}
                        </div>
                    </section>

                    {/* Section 3: CPI Score Distribution */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>
                            <BarChart3 size={16} style={{ marginRight: 6 }} /> CPI Score Distribution
                        </h2>
                        <div className="card">
                            <div className={styles.histogram}>
                                {scoreDistribution.map((bucket) => (
                                    <div key={bucket.bucket} className={styles.histogramColumn}>
                                        <span className={styles.histogramCount}>
                                            {bucket.count > 0 ? bucket.count : ''}
                                        </span>
                                        <div
                                            className={styles.histogramBar}
                                            style={{ height: `${(bucket.count / maxDistCount) * 100}%` }}
                                        />
                                        <span className={styles.histogramLabel}>{bucket.bucket}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Section 4: What Differentiated Winners? */}
                    {componentInsights && (
                        <section className={styles.section}>
                            <h2 className={styles.sectionTitle}>
                                <Target size={16} style={{ marginRight: 6 }} /> What Differentiated Winners?
                            </h2>
                            <div className="card">
                                <p className={styles.insightSubtitle}>
                                    Average score components for advanced vs eliminated traders
                                </p>
                                <div className={styles.comparison}>
                                    {(['pnl', 'risk', 'consistency', 'activity'] as const).map((key) => {
                                        const advVal = componentInsights.advancedAvg[key];
                                        const elimVal = componentInsights.eliminatedAvg[key];
                                        const label = key === 'pnl' ? 'PnL' : key === 'risk' ? 'Risk' : key === 'consistency' ? 'Consistency' : 'Activity';
                                        return (
                                            <div key={key} className={styles.comparisonRow}>
                                                <span className={styles.comparisonLabel}>{label}</span>
                                                <div className={styles.comparisonBars}>
                                                    <div className={styles.comparisonBarGroup}>
                                                        <div
                                                            className={styles.barAdvanced}
                                                            style={{ width: `${advVal}%` }}
                                                        />
                                                        <span className={styles.barValue}>{advVal.toFixed(1)}</span>
                                                    </div>
                                                    <div className={styles.comparisonBarGroup}>
                                                        <div
                                                            className={styles.barEliminated}
                                                            style={{ width: `${elimVal}%` }}
                                                        />
                                                        <span className={styles.barValue}>{elimVal.toFixed(1)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div className={styles.funnelLegend}>
                                        <span><span className={styles.legendDotAdvanced} /> Advanced</span>
                                        <span><span className={styles.legendDotEliminated} /> Eliminated</span>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Section 5: Top Performers */}
                    {topPerformers.length > 0 && (
                        <section className={styles.section}>
                            <h2 className={styles.sectionTitle}>
                                <Trophy size={16} style={{ marginRight: 6 }} /> Top Performers
                            </h2>
                            <div className={styles.performersGrid}>
                                {topPerformers.map((performer, idx) => (
                                    <div key={`${performer.wallet}-${performer.roundNumber}`} className={`card ${styles.performerCard}`}>
                                        <div className={styles.performerRank}>
                                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                        </div>
                                        <div className={styles.performerInfo}>
                                            <Link
                                                href={`/trader/${performer.wallet}?tournamentId=${tournamentId}`}
                                                className={styles.performerWallet}
                                            >
                                                {performer.wallet.slice(0, 6)}...{performer.wallet.slice(-4)}
                                            </Link>
                                            <span className={styles.performerRound}>{performer.roundName}</span>
                                        </div>
                                        <div className={styles.performerCpi}>
                                            {performer.cpiScore.toFixed(1)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Section 6: Daily Categories */}
                    {(categoryData.allAround.length > 0 || categoryData.fisher.length > 0) && (
                        <section className={styles.section}>
                            <h2 className={styles.sectionTitle}>
                                <Award size={16} style={{ marginRight: 6 }} /> Daily Category Leaders
                            </h2>
                            <div className={styles.categoryGrid}>
                                {categoryData.allAround.length > 0 && (
                                    <div className={`card ${styles.categoryCard}`}>
                                        <h3 className={styles.categoryTitle}>🎯 All Around Trader</h3>
                                        <p className={styles.categoryDesc}>Best ROI per unique asset traded</p>
                                        <div className={styles.categoryList}>
                                            {categoryData.allAround.map((entry, idx) => (
                                                <div key={`ar-${entry.wallet}-${entry.scoreDate}`} className={styles.categoryEntry}>
                                                    <span className={styles.categoryRank}>
                                                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                                    </span>
                                                    <Link
                                                        href={`/trader/${entry.wallet}?tournamentId=${tournamentId}`}
                                                        className={styles.performerWallet}
                                                    >
                                                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                                                    </Link>
                                                    <span className={styles.categoryScore}>{entry.score.toFixed(1)}</span>
                                                    <span className={styles.categoryDate}>{entry.scoreDate}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {categoryData.fisher.length > 0 && (
                                    <div className={`card ${styles.categoryCard}`}>
                                        <h3 className={styles.categoryTitle}>🎣 Top Bottom Fisher</h3>
                                        <p className={styles.categoryDesc}>Entry proximity to daily low/high</p>
                                        <div className={styles.categoryList}>
                                            {categoryData.fisher.map((entry, idx) => (
                                                <div key={`fi-${entry.wallet}-${entry.scoreDate}`} className={styles.categoryEntry}>
                                                    <span className={styles.categoryRank}>
                                                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                                    </span>
                                                    <Link
                                                        href={`/trader/${entry.wallet}?tournamentId=${tournamentId}`}
                                                        className={styles.performerWallet}
                                                    >
                                                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                                                    </Link>
                                                    <span className={styles.categoryScore}>{entry.score.toFixed(1)}</span>
                                                    <span className={styles.categoryDate}>{entry.scoreDate}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
