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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', padding: 'var(--space-3xl) 0' }}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--text-muted)' }}>Loading season...</p>
                </div>
            </div>
        );
    }

    if (error || !season) {
        return (
            <div className="container">
                <div className="card" style={{ marginTop: 'var(--space-2xl)', padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--status-danger)' }}>{error || 'Season not found'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            {/* Header */}
            <header className="page-header">
                <Link
                    href="/seasons"
                    style={{ color: 'var(--text-muted)', fontSize: '14px', textDecoration: 'none' }}
                >
                    ← Back to Seasons
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
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

            {/* Standings Table */}
            <section style={{ marginBottom: 'var(--space-2xl)' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <Trophy size={20} />
                    Season Standings
                </h2>

                {standings.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No standings yet.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={thStyle}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Points</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Weeks</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Best</th>
                                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {standings.map((s, i) => (
                                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={tdStyle}>
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: 'var(--status-success)' }}>
                                            {s.totalPoints}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            {s.weeksParticipated}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            {s.bestPlacement !== null ? `#${s.bestPlacement}` : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            {s.qualifiedForFinal ? (
                                                <span style={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 600 }}>
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

            {/* Weekly Tournaments */}
            <section>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <Calendar size={20} />
                    Weekly Gauntlets
                </h2>

                <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                    {(season.tournaments ?? []).map((t) => (
                        <Link
                            key={t.id}
                            href={`/tournament/${t.id}`}
                            className="card card--hoverable"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: 'var(--space-md) var(--space-lg)',
                                textDecoration: 'none',
                            }}
                        >
                            <div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '15px' }}>
                                    {t.name}
                                </div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: 'var(--space-xs)' }}>
                                    {getStatusBadge(t.status)}
                                </div>
                            </div>
                            <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}

const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '14px',
    color: 'var(--text-secondary)',
};
