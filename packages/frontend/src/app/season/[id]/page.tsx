'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
    getSeason,
    getSeasonStandings,
    type SeasonWithTournaments,
    type SeasonStanding,
} from '@/lib/api';
import { Trophy, Calendar, Star, ArrowRight, Shield, Crown, Users } from 'lucide-react';
import Link from 'next/link';

export default function SeasonDetailPage() {
    const params = useParams();
    const seasonId = parseInt(params.id as string, 10);

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
        const colors: Record<string, string> = {
            registration: '#fbbf24',
            active: '#34d399',
            final: '#a78bfa',
            completed: '#60a5fa',
        };
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                background: `${colors[status] ?? '#666'}22`,
                color: colors[status] ?? '#666',
                border: `1px solid ${colors[status] ?? '#666'}44`,
            }}>
                <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: colors[status] ?? '#666',
                }} />
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    }

    if (loading) {
        return (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#888' }}>
                Loading season...
            </div>
        );
    }

    if (error || !season) {
        return (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#ff6b6b' }}>
                {error || 'Season not found'}
            </div>
        );
    }

    return (
        <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' }}>
            {/* Header */}
            <div style={{ marginBottom: '32px' }}>
                <Link
                    href="/"
                    style={{ color: '#888', fontSize: '14px', textDecoration: 'none' }}
                >
                    ← Back to Dashboard
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
                    <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#e0e0e0', margin: 0 }}>
                        {season.name}
                    </h1>
                    {getStatusBadge(season.status)}
                </div>
                <p style={{ color: '#888', fontSize: '14px', marginTop: '8px' }}>
                    Week {season.currentWeek} of {season.config?.weekCount ?? 7}
                    {' · '}
                    {season.tournaments?.length ?? 0} tournaments
                    {' · '}
                    {standings.length} participants
                </p>
            </div>

            {/* Standings Table */}
            <section style={{ marginBottom: '40px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#e0e0e0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Trophy size={20} />
                    Season Standings
                </h2>

                {standings.length === 0 ? (
                    <p style={{ color: '#888' }}>No standings yet.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333' }}>
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
                                    <tr key={s.id} style={{ borderBottom: '1px solid #222' }}>
                                        <td style={tdStyle}>
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '13px' }}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#34d399' }}>
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
                                                <span style={{ color: '#a78bfa', fontSize: '12px', fontWeight: 600 }}>
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
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#e0e0e0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={20} />
                    Weekly Gauntlets
                </h2>

                <div style={{ display: 'grid', gap: '12px' }}>
                    {(season.tournaments ?? []).map((t) => (
                        <Link
                            key={t.id}
                            href={`/tournament/${t.id}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '16px 20px',
                                background: '#1a1a1a',
                                border: '1px solid #333',
                                borderRadius: '12px',
                                textDecoration: 'none',
                                transition: 'border-color 0.2s',
                            }}
                        >
                            <div>
                                <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '15px' }}>
                                    {t.name}
                                </div>
                                <div style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>
                                    {getStatusBadge(t.status)}
                                </div>
                            </div>
                            <ArrowRight size={16} color="#666" />
                        </Link>
                    ))}
                </div>
            </section>
        </main>
    );
}

const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '14px',
    color: '#ccc',
};
