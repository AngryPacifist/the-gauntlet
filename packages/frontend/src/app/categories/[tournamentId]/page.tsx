'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    getCategoryLeaderboard,
    getDailyScores,
    type CategoryLeaderboardEntry,
    type DailyCategoryScore,
    type CategorySlug,
} from '@/lib/api';
import { Compass, Target, TrendingUp, Shield, Trophy, Calendar } from 'lucide-react';
import Link from 'next/link';

// Category configuration — single source of truth for tab rendering
const CATEGORY_TABS: Array<{
    slug: CategorySlug;
    label: string;
    icon: typeof Compass;
    color: string;
    colorBg: string;
    description: string;
}> = [
    {
        slug: 'all_around',
        label: 'All Around',
        icon: Compass,
        color: 'var(--status-success)',
        colorBg: 'var(--status-success-bg)',
        description: 'Best ROI per unique asset traded each day. Trade across more assets to maximize your score. Minimum $500 trade size, 25 points cap per asset.',
    },
    {
        slug: 'top_tick_traveler',
        label: 'Top-Tick Traveler',
        icon: TrendingUp,
        color: 'var(--accent-primary)',
        colorBg: 'rgba(108, 92, 231, 0.1)',
        description: 'Catch the best short entry relative to the day\'s high. Top 3 earn rank points (3, 2, 1) multiplied by ROI.',
    },
    {
        slug: 'bottom_fisher',
        label: 'Bottom Fisher',
        icon: Target,
        color: '#e17055',
        colorBg: 'rgba(225, 112, 85, 0.1)',
        description: 'Catch the best long entry relative to the day\'s low. Top 3 earn rank points (3, 2, 1) multiplied by ROI.',
    },
    {
        slug: 'risk_manager',
        label: 'Risk Manager',
        icon: Shield,
        color: '#00b894',
        colorBg: 'rgba(0, 184, 148, 0.1)',
        description: 'Best stop-loss trade by ROI in a 2-day window. The tightest loss wins. Requires SL/TP to be set.',
    },
    {
        slug: 'humble_one',
        label: 'The Humble One',
        icon: Trophy,
        color: '#fdcb6e',
        colorBg: 'rgba(253, 203, 110, 0.1)',
        description: 'Best take-profit trade by ROI in a 2-day window. Disciplined profit-taking rewarded. Requires SL/TP to be set.',
    },
];

export default function CategoriesPage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const searchParams = useSearchParams();
    const tournamentId = parseInt(rawId, 10);

    const initialTab = (searchParams.get('tab') as CategorySlug) || 'all_around';
    const [tab, setTab] = useState<CategorySlug>(
        CATEGORY_TABS.some(t => t.slug === initialTab) ? initialTab : 'all_around',
    );
    const [leaderboard, setLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    const [dailyDate, setDailyDate] = useState<string>('');
    const [dailyScores, setDailyScores] = useState<DailyCategoryScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const activeTab = CATEGORY_TABS.find(t => t.slug === tab)!;

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
                    &larr; Back to Tournament
                </Link>
                <h1 className="page-header__title">
                    Daily Categories
                </h1>
                <p className="page-header__subtitle">
                    Tournament #{tournamentId} &mdash; Tactical side competitions
                </p>
            </header>

            {/* Dynamic Tabs */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
                {CATEGORY_TABS.map((catTab) => {
                    const Icon = catTab.icon;
                    const isActive = tab === catTab.slug;
                    return (
                        <button
                            key={catTab.slug}
                            onClick={() => setTab(catTab.slug)}
                            style={{
                                ...tabBtnStyle,
                                background: isActive ? catTab.colorBg : 'var(--bg-card)',
                                borderColor: isActive ? catTab.color : 'var(--border-default)',
                                color: isActive ? catTab.color : 'var(--text-muted)',
                            }}
                        >
                            <Icon size={14} />
                            {catTab.label}
                        </button>
                    );
                })}
            </div>

            {/* Description */}
            <div className="card" style={{
                padding: 'var(--space-md) var(--space-lg)',
                marginBottom: 'var(--space-lg)',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
            }}>
                <strong style={{ color: activeTab.color }}>{activeTab.label}</strong> &mdash; {activeTab.description}
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
                                            <span style={getRankStyle(i)}>{i + 1}</span>
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                                            {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: activeTab.color,
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
                                            color: activeTab.color,
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

function getRankStyle(index: number): React.CSSProperties {
    if (index === 0) return { fontWeight: 700, color: '#ffd700' };
    if (index === 1) return { fontWeight: 700, color: '#c0c0c0' };
    if (index === 2) return { fontWeight: 700, color: '#cd7f32' };
    return {};
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
