'use client';

// ============================================================================
// Cumulative Leaderboard Page — Phase 5 item 20
//
// Single page at /leaderboard with 3 tabs (D-20.5/D-20.6):
//   - Tournament: current active tournament's slim top-10 view (D-20.8) +
//                 link to existing /leaderboard/[id] for full detail.
//                 Default tab on landing (per definitive item 20).
//   - Season:     current active/recent season's full standings.
//   - All-time:   cross-tournament cumulative finalScore aggregation (D-20.1, D-20.9).
//
// Trailing-slash rule in layout.tsx keeps nav visible here (no /id segment).
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    getCumulativeLeaderboard,
    type CumulativeLeaderboardData,
} from '@/lib/api';
import { Trophy, Calendar, Activity, ChevronRight } from 'lucide-react';

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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-3xl) 0' }}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--text-muted)' }}>Loading leaderboard...</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="container">
                <div className="card" style={{ marginTop: 'var(--space-2xl)', padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--status-danger)' }}>{error ?? 'No data'}</p>
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

            {/* Tab buttons */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-sm)',
                marginBottom: 'var(--space-lg)',
                borderBottom: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
            }}>
                <TabButton active={tab === 'tournament'} onClick={() => setTab('tournament')}>
                    <Trophy size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Tournament
                </TabButton>
                <TabButton active={tab === 'season'} onClick={() => setTab('season')}>
                    <Calendar size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Season
                </TabButton>
                <TabButton active={tab === 'all-time'} onClick={() => setTab('all-time')}>
                    <Activity size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    All-Time
                </TabButton>
            </div>

            {/* Per-tab content */}
            {tab === 'tournament' && <TournamentTab data={data.current} />}
            {tab === 'season' && <SeasonTab data={data.season} />}
            {tab === 'all-time' && <AllTimeTab data={data.allTime} />}
        </div>
    );
}

// --------------------------------------------------------------------------
// TabButton — shared tab control
// --------------------------------------------------------------------------

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                background: active ? 'var(--bg-secondary)' : 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent-primary, #f59e0b)' : '2px solid transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                padding: '0.625rem 1rem',
                fontSize: '0.875rem',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginBottom: '-1px',
            }}
        >
            {children}
        </button>
    );
}

// --------------------------------------------------------------------------
// TournamentTab — slim top-N view of current active tournament (D-20.8)
// --------------------------------------------------------------------------

function TournamentTab({ data }: { data: CumulativeLeaderboardData['current'] }) {
    if (!data.tournament) {
        return <EmptyState message="No tournament available." />;
    }
    const t = data.tournament;
    return (
        <div>
            <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                    <div>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                            {t.name}
                        </h2>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                            {t.format === 'rank_only' ? 'Forge' : 'Gauntlet'} · top {data.topEntries.length} shown
                        </p>
                    </div>
                    <span className={`badge badge--${t.status}`}>{t.status}</span>
                </div>
            </div>

            {data.topEntries.length === 0 ? (
                <EmptyState message="No entries scored yet." />
            ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                                <Th>#</Th>
                                <Th align="left">Wallet</Th>
                                <Th>CPI</Th>
                                <Th>Quests</Th>
                                <Th>Final</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.topEntries.map((e) => (
                                <tr key={e.wallet} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <Td><strong>#{e.rank}</strong></Td>
                                    <Td align="left" mono>{shortWallet(e.wallet)}</Td>
                                    <Td mono>{e.cpiScore.toFixed(1)}</Td>
                                    <Td mono style={{ color: '#a78bfa' }}>{e.questPoints.toFixed(2)}</Td>
                                    <Td mono style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {e.finalScore.toFixed(2)}
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{ marginTop: 'var(--space-md)', textAlign: 'right' }}>
                <Link
                    href={`/leaderboard/${t.id}`}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: 'var(--accent-primary, #f59e0b)',
                        textDecoration: 'none',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                    }}
                >
                    View full leaderboard <ChevronRight size={14} />
                </Link>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// SeasonTab — season standings
// --------------------------------------------------------------------------

function SeasonTab({ data }: { data: CumulativeLeaderboardData['season'] }) {
    if (!data.season) {
        return <EmptyState message="No season available." />;
    }
    const s = data.season;
    return (
        <div>
            <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                    <div>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                            {s.name}
                        </h2>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                            Week {s.currentWeek}
                        </p>
                    </div>
                    <span className={`badge badge--${s.status}`}>{s.status}</span>
                </div>
            </div>

            {data.standings.length === 0 ? (
                <EmptyState message="No standings yet." />
            ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                                <Th>#</Th>
                                <Th align="left">Wallet</Th>
                                <Th>Points</Th>
                                <Th>Weeks Played</Th>
                                <Th>Best Placement</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.standings.map((e) => (
                                <tr key={e.wallet} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <Td><strong>#{e.rank}</strong></Td>
                                    <Td align="left" mono>{shortWallet(e.wallet)}</Td>
                                    <Td mono style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {e.totalPoints}
                                    </Td>
                                    <Td mono>{e.weeksParticipated}</Td>
                                    <Td mono>{e.bestPlacement !== null ? `#${e.bestPlacement}` : '—'}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// AllTimeTab — cross-tournament cumulative finalScore aggregation
// --------------------------------------------------------------------------

function AllTimeTab({ data }: { data: CumulativeLeaderboardData['allTime'] }) {
    if (data.standings.length === 0) {
        return <EmptyState message="No cumulative data yet." />;
    }
    return (
        <div>
            <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Aggregated across <strong style={{ color: 'var(--text-primary)' }}>{data.totalTournaments}</strong> tournament{data.totalTournaments === 1 ? '' : 's'} · ranked by sum of Final Score
                </p>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                            <Th>#</Th>
                            <Th align="left">Wallet</Th>
                            <Th>Total Final Score</Th>
                            <Th>Tournaments Played</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.standings.map((e) => (
                            <tr key={e.wallet} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <Td><strong>#{e.rank}</strong></Td>
                                <Td align="left" mono>{shortWallet(e.wallet)}</Td>
                                <Td mono style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {e.totalFinalScore.toFixed(2)}
                                </Td>
                                <Td mono>{e.tournamentsPlayed}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// EmptyState — shared empty-tab placeholder
// --------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
    return (
        <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>{message}</p>
        </div>
    );
}

// --------------------------------------------------------------------------
// Th / Td — table cell helpers (consistent styling)
// --------------------------------------------------------------------------

function Th({
    children,
    align = 'right',
}: {
    children: React.ReactNode;
    align?: 'left' | 'right';
}) {
    return (
        <th style={{
            padding: '8px 12px',
            textAlign: align,
            color: 'var(--text-muted)',
            fontWeight: 600,
            fontSize: '0.6875rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
        }}>
            {children}
        </th>
    );
}

function Td({
    children,
    align = 'right',
    mono = false,
    style,
}: {
    children: React.ReactNode;
    align?: 'left' | 'right';
    mono?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <td style={{
            padding: '8px 12px',
            textAlign: align,
            fontFamily: mono ? 'var(--font-mono)' : undefined,
            color: 'var(--text-secondary)',
            ...style,
        }}>
            {children}
        </td>
    );
}
