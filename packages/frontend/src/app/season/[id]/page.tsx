'use client';

import { useEffect, useState, use } from 'react';
import {
    getSeason,
    getSeasonStandings,
    type SeasonWithTournaments,
    type SeasonStanding,
} from '@/lib/api';
import { Trophy, Calendar, ArrowRight, Crown } from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

export default function SeasonDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const seasonId = parseInt(id, 10);

    const [season, setSeason] = useState<SeasonWithTournaments | null>(null);
    const [standings, setStandings] = useState<SeasonStanding[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isNaN(seasonId)) {
            loadData();
        }
    }, [seasonId]);

    async function loadData() {
        try {
            setLoading(true);
            const [seasonData, standingsData] = await Promise.all([
                getSeason(seasonId),
                getSeasonStandings(seasonId),
            ]);
            setSeason(seasonData);
            setStandings(standingsData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load season');
        } finally {
            setLoading(false);
        }
    }

    function getStatusBadge(status: string) {
        return (
            <span className={`badge badge--${status}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    }

    if (loading) {
        return (
            <div className="container">
                <div className={styles.center}>
                    <div className="spinner" />
                    <p>Loading season...</p>
                </div>
            </div>
        );
    }

    if (error || !season) {
        return (
            <div className="container">
                <div className={`card ${styles.errorCard}`}>
                    <p>{error || 'Season not found'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className="page-header">
                <Link href="/seasons" className={styles.backLink}>← Back to Seasons</Link>
                <div className={styles.titleRow}>
                    <h1 className="page-header__title" style={{ marginBottom: 0 }}>
                        {season.name}
                    </h1>
                    {getStatusBadge(season.status)}
                </div>
                <p className="page-header__subtitle">
                    Week {season.currentWeek} of {season.config?.weekCount ?? 7}
                    {' · '}
                    {season.tournaments?.length ?? 0} tournaments
                    {' · '}
                    {standings.length} participants
                </p>
            </header>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                    <Trophy size={20} />
                    Season Standings
                </h2>

                {standings.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No standings yet.</p>
                ) : (
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Wallet</th>
                                    <th className={styles.thRight}>Points</th>
                                    <th className={styles.thRight}>Weeks</th>
                                    <th className={styles.thRight}>Best</th>
                                    <th className={styles.thCenter}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {standings.map((s, i) => (
                                    <tr key={s.id}>
                                        <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                                        <td className={styles.tdMono}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td className={styles.points}>{s.totalPoints}</td>
                                        <td className={styles.tdRight}>{s.weeksParticipated}</td>
                                        <td className={styles.tdRight}>
                                            {s.bestPlacement !== null ? `#${s.bestPlacement}` : '—'}
                                        </td>
                                        <td className={styles.tdCenter}>
                                            {s.qualifiedForFinal ? (
                                                <span className={styles.qualified}>
                                                    <Crown size={12} /> Qualified
                                                </span>
                                            ) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section>
                <h2 className={styles.sectionTitle}>
                    <Calendar size={20} />
                    Weekly Gauntlets
                </h2>

                <div className={styles.weeklyGrid}>
                    {(season.tournaments ?? []).map((t) => (
                        <Link
                            key={t.id}
                            href={`/tournament/${t.id}`}
                            className={`card card--hoverable ${styles.weeklyRow}`}
                        >
                            <div>
                                <div className={styles.weeklyName}>{t.name}</div>
                                <div className={styles.weeklyStatus}>{getStatusBadge(t.status)}</div>
                            </div>
                            <ArrowRight size={16} className={styles.weeklyArrow} />
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
