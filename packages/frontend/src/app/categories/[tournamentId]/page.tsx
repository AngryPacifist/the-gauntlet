'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    getCategoryLeaderboard,
    getDailyScores,
    type CategoryLeaderboardEntry,
    type DailyCategoryScore,
} from '@/lib/api';
import { Target, Compass, Trophy, Calendar } from 'lucide-react';
import Link from 'next/link';

type TabType = 'all-around' | 'fisher';

export default function CategoriesPage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const searchParams = useSearchParams();
    const tournamentId = parseInt(rawId, 10);

    const [tab, setTab] = useState<TabType>(
        (searchParams.get('tab') as TabType) || 'all-around',
    );
    const [leaderboard, setLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    const [dailyDate, setDailyDate] = useState<string>('');
    const [dailyScores, setDailyScores] = useState<DailyCategoryScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isNaN(tournamentId)) {
            loadLeaderboard();
        }
    }, [tournamentId, tab]);

    useEffect(() => {
        if (dailyDate && !isNaN(tournamentId)) {
            loadDailyScores();
        }
    }, [dailyDate, tab]);

    async function loadLeaderboard() {
        try {
            setLoading(true);
            const data = await getCategoryLeaderboard(tournamentId, tab);
            setLeaderboard(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
        } finally {
            setLoading(false);
        }
    }

    async function loadDailyScores() {
        try {
            const data = await getDailyScores(tournamentId, tab, dailyDate);
            setDailyScores(data);
        } catch (err) {
            console.error('Failed to load daily scores:', err);
        }
    }

    if (isNaN(tournamentId)) {
        return (
            <div className="container">
                <div className="card" style={{ marginTop: 'var(--space-2xl)', padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--status-danger)' }}>Invalid tournament ID</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            {/* Header */}
            <header className="page-header">
                <Link
                    href={`/tournament/${tournamentId}`}
                    style={{ color: 'var(--text-muted)', fontSize: '14px', textDecoration: 'none' }}
                >
                    ← Back to Tournament
                </Link>
                <h1 className="page-header__title">
                    Daily Categories
                </h1>
                <p className="page-header__subtitle">
                    Tournament #{tournamentId} — Tactical side competitions
                </p>
            </header>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                <button
                    onClick={() => setTab('all-around')}
                    style={{
                        ...tabBtnStyle,
                        background: tab === 'all-around' ? 'var(--status-success-bg)' : 'var(--bg-card)',
                        borderColor: tab === 'all-around' ? 'var(--status-success)' : 'var(--border-default)',
                        color: tab === 'all-around' ? 'var(--status-success)' : 'var(--text-muted)',
                    }}
                >
                    <Compass size={14} />
                    All Around Trader
                </button>
                <button
                    onClick={() => setTab('fisher')}
                    style={{
                        ...tabBtnStyle,
                        background: tab === 'fisher' ? 'rgba(108, 92, 231, 0.1)' : 'var(--bg-card)',
                        borderColor: tab === 'fisher' ? 'var(--accent-primary)' : 'var(--border-default)',
                        color: tab === 'fisher' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}
                >
                    <Target size={14} />
                    Top Bottom Fisher
                </button>
            </div>

            {/* Description */}
            <div className="card" style={{
                padding: 'var(--space-md) var(--space-lg)',
                marginBottom: 'var(--space-lg)',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
            }}>
                {tab === 'all-around' ? (
                    <>
                        <strong style={{ color: 'var(--status-success)' }}>All Around Trader</strong> — Best ROI per unique
                        asset traded each day. Trade across more assets to maximize your score.
                        Minimum $1,000 trade size, 200 points cap per asset.
                    </>
                ) : (
                    <>
                        <strong style={{ color: 'var(--accent-primary)' }}>Top Bottom Fisher</strong> — Catch the best
                        entry price relative to the day&apos;s price extremes. Longs near the day&apos;s low
                        and shorts near the day&apos;s high earn rank points, multiplied by ROI.
                    </>
                )}
            </div>

            {/* Cumulative Leaderboard */}
            <section style={{ marginBottom: 'var(--space-2xl)' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <Trophy size={18} />
                    Cumulative Leaderboard
                </h2>

                {loading ? (
                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                ) : error ? (
                    <p style={{ color: 'var(--status-danger)' }}>{error}</p>
                ) : leaderboard.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No scores yet for this category.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={thStyle}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Total Score</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Days Active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((entry, i) => (
                                    <tr key={entry.wallet} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={tdStyle}>
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                                            {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: tab === 'all-around' ? 'var(--status-success)' : 'var(--accent-primary)',
                                        }}>
                                            {typeof entry.totalScore === 'number' ? entry.totalScore.toFixed(1) : entry.totalScore}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            {entry.daysScored}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* Daily Breakdown */}
            <section>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <Calendar size={18} />
                    Daily Breakdown
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                    <input
                        type="date"
                        value={dailyDate}
                        onChange={(e) => setDailyDate(e.target.value)}
                        className="input"
                        style={{
                            width: 'auto',
                        }}
                    />
                </div>

                {dailyDate && dailyScores.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={thStyle}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyScores.map((s, i) => (
                                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={tdStyle}>{i + 1}</td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: tab === 'all-around' ? 'var(--status-success)' : 'var(--accent-primary)',
                                        }}>
                                            {typeof s.score === 'number' ? s.score.toFixed(1) : s.score}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : dailyDate ? (
                    <p style={{ color: 'var(--text-muted)' }}>No scores for {dailyDate}</p>
                ) : (
                    <p style={{ color: 'var(--text-muted)' }}>Select a date to view daily results.</p>
                )}
            </section>
        </div>
    );
}

const tabBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all var(--transition-default)',
};

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
