'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSeasons, type Season } from '@/lib/api';
import { Trophy, Calendar, ChevronRight } from 'lucide-react';

export default function SeasonsPage() {
    const [seasons, setSeasons] = useState<Season[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadSeasons();
    }, []);

    async function loadSeasons() {
        try {
            setLoading(true);
            const data = await listSeasons();
            setSeasons(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load seasons');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', padding: 'var(--space-3xl) 0' }}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--text-muted)' }}>Loading seasons...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container">
                <div className="card" style={{ marginTop: 'var(--space-2xl)', padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--status-danger)' }}>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className="page-header">
                <h1 className="page-header__title">
                    <Trophy size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Seasons
                </h1>
                <p className="page-header__subtitle">
                    Multi-week competitive seasons with qualification rounds and Grand Finals
                </p>
            </header>

            {seasons.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>No seasons yet.</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 'var(--space-sm)' }}>
                        Seasons are created by admins from the Admin panel.
                    </p>
                </div>
            ) : (
                <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-lg)' }}>
                    {seasons.map((season, idx) => (
                        <Link
                            key={season.id}
                            href={`/season/${season.id}`}
                            className="card card--hoverable"
                            style={{
                                padding: 'var(--space-lg)',
                                textDecoration: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--space-md)',
                                animation: `fadeInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) ${idx * 0.05}s both`,
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                    {season.name}
                                </h2>
                                <span className={`badge badge--${season.status}`}>
                                    {season.status}
                                </span>
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: '0.8125rem' }}>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <Calendar size={10} style={{ marginRight: 3 }} />
                                        Week
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                                        {season.currentWeek} / {season.config.weekCount}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Qualification Slots
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                                        {season.config.qualificationSlots}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--text-muted)', fontSize: '0.75rem', alignItems: 'center', gap: 4 }}>
                                View Season <ChevronRight size={12} />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
