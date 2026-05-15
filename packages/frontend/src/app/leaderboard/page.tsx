'use client';

// ============================================================================
// Cumulative Leaderboard Page (Tournament / Season / All-Time tabs).
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    getCumulativeLeaderboard,
    type CumulativeLeaderboardData,
} from '@/lib/api';
import { Trophy, Calendar, Activity, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

type Tab = 'tournament' | 'season' | 'all-time';

function shortWallet(w: string): string {
    if (w.length <= 10) return w;
    return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

export default function CumulativeLeaderboardPage() {
    const [data, setData] = useState<CumulativeLeaderboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('tournament');

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                setLoading(true);
                const result = await getCumulativeLeaderboard();
                if (!cancelled) setData(result);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    if (loading) {
        return (
            <div className="container">
                <div className="loading-state">
                    <div className="spinner" />
                    <p>Loading leaderboard...</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="container">
                <div className="card error-state">
                    <p>{error ?? 'No data'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className="page-header">
                <h1 className="page-header__title">
                    <Trophy size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Leaderboard
                </h1>
                <p className="page-header__subtitle">
                    Current tournament, season standings, and all-time cumulative rankings.
                </p>
            </header>

            <div className={styles.tabRow}>
                <button
                    onClick={() => setTab('tournament')}
                    className={`${styles.tabBtn} ${tab === 'tournament' ? styles.tabBtnActive : ''}`}
                >
                    <Trophy size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Tournament
                </button>
                <button
                    onClick={() => setTab('season')}
                    className={`${styles.tabBtn} ${tab === 'season' ? styles.tabBtnActive : ''}`}
                >
                    <Calendar size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Season
                </button>
                <button
                    onClick={() => setTab('all-time')}
                    className={`${styles.tabBtn} ${tab === 'all-time' ? styles.tabBtnActive : ''}`}
                >
                    <Activity size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    All-Time
                </button>
            </div>

            {tab === 'tournament' && <TournamentTab data={data.current} />}
            {tab === 'season' && <SeasonTab data={data.season} />}
            {tab === 'all-time' && <AllTimeTab data={data.allTime} />}
        </div>
    );
}

function TournamentTab({ data }: { data: CumulativeLeaderboardData['current'] }) {
    if (!data.tournament) {
        return <EmptyState message="No tournament available." />;
    }
    const t = data.tournament;
    return (
        <div>
            <div className={`card ${styles.metaCard}`}>
                <div className={styles.metaRow}>
                    <div>
                        <h2 className={styles.metaTitle}>{t.name}</h2>
                        <p className={styles.metaSub}>
                            {t.format === 'rank_only' ? 'Forge' : 'Gauntlet'} · top {data.topEntries.length} shown
                        </p>
                    </div>
                    <span className={`badge badge--${t.status}`}>{t.status}</span>
                </div>
            </div>

            {data.topEntries.length === 0 ? (
                <EmptyState message="No entries scored yet." />
            ) : (
                <div className={`card ${styles.tableCard}`}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th className={styles.thLeft}>Wallet</th>
                                <th>CPI</th>
                                <th>Quests</th>
                                <th>Final</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.topEntries.map((e) => (
                                <tr key={e.wallet}>
                                    <td><strong>#{e.rank}</strong></td>
                                    <td className={`${styles.tdLeft} ${styles.tdMono}`}>{shortWallet(e.wallet)}</td>
                                    <td className={styles.tdMono}>{e.cpiScore.toFixed(1)}</td>
                                    <td className={`${styles.tdMono} ${styles.questPoints}`}>{e.questPoints.toFixed(2)}</td>
                                    <td className={`${styles.tdMono} ${styles.tdStrong}`}>
                                        {e.finalScore.toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className={styles.viewFullWrap}>
                <Link href={`/leaderboard/${t.id}`} className={styles.viewFull}>
                    View full leaderboard <ChevronRight size={14} />
                </Link>
            </div>
        </div>
    );
}

function SeasonTab({ data }: { data: CumulativeLeaderboardData['season'] }) {
    if (!data.season) {
        return <EmptyState message="No season available." />;
    }
    const s = data.season;
    return (
        <div>
            <div className={`card ${styles.metaCard}`}>
                <div className={styles.metaRow}>
                    <div>
                        <h2 className={styles.metaTitle}>{s.name}</h2>
                        <p className={styles.metaSub}>Week {s.currentWeek}</p>
                    </div>
                    <span className={`badge badge--${s.status}`}>{s.status}</span>
                </div>
            </div>

            {data.standings.length === 0 ? (
                <EmptyState message="No standings yet." />
            ) : (
                <div className={`card ${styles.tableCard}`}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th className={styles.thLeft}>Wallet</th>
                                <th>Points</th>
                                <th>Weeks Played</th>
                                <th>Best Placement</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.standings.map((e) => (
                                <tr key={e.wallet}>
                                    <td><strong>#{e.rank}</strong></td>
                                    <td className={`${styles.tdLeft} ${styles.tdMono}`}>{shortWallet(e.wallet)}</td>
                                    <td className={`${styles.tdMono} ${styles.tdStrong}`}>{e.totalPoints}</td>
                                    <td className={styles.tdMono}>{e.weeksParticipated}</td>
                                    <td className={styles.tdMono}>{e.bestPlacement !== null ? `#${e.bestPlacement}` : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function AllTimeTab({ data }: { data: CumulativeLeaderboardData['allTime'] }) {
    if (data.standings.length === 0) {
        return <EmptyState message="No cumulative data yet." />;
    }
    return (
        <div>
            <div className={`card ${styles.metaCard}`}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Aggregated across <strong style={{ color: 'var(--text-primary)' }}>{data.totalTournaments}</strong> tournament{data.totalTournaments === 1 ? '' : 's'} · ranked by sum of Final Score
                </p>
            </div>

            <div className={`card ${styles.tableCard}`}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th className={styles.thLeft}>Wallet</th>
                            <th>Total Final Score</th>
                            <th>Tournaments Played</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.standings.map((e) => (
                            <tr key={e.wallet}>
                                <td><strong>#{e.rank}</strong></td>
                                <td className={`${styles.tdLeft} ${styles.tdMono}`}>{shortWallet(e.wallet)}</td>
                                <td className={`${styles.tdMono} ${styles.tdStrong}`}>{e.totalFinalScore.toFixed(2)}</td>
                                <td className={styles.tdMono}>{e.tournamentsPlayed}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="card empty-state">
            <p>{message}</p>
        </div>
    );
}
