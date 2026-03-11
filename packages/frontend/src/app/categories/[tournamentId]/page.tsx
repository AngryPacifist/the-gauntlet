'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
    getCategoryLeaderboard,
    getDailyScores,
    type CategoryLeaderboardEntry,
    type DailyCategoryScore,
} from '@/lib/api';
import { Target, Compass, Trophy, Calendar } from 'lucide-react';
import Link from 'next/link';

type TabType = 'all-around' | 'fisher';

export default function CategoriesPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const tournamentId = parseInt(params.tournamentId as string, 10);

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
        return <div style={{ padding: '60px', textAlign: 'center', color: '#ff6b6b' }}>Invalid tournament ID</div>;
    }

    return (
        <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <Link
                    href={`/tournament/${tournamentId}`}
                    style={{ color: '#888', fontSize: '14px', textDecoration: 'none' }}
                >
                    ← Back to Tournament
                </Link>
                <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#e0e0e0', marginTop: '12px' }}>
                    Daily Categories
                </h1>
                <p style={{ color: '#888', fontSize: '14px', marginTop: '4px' }}>
                    Tournament #{tournamentId} — Tactical side competitions
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                <button
                    onClick={() => setTab('all-around')}
                    style={{
                        ...tabBtnStyle,
                        background: tab === 'all-around' ? '#34d39922' : '#1a1a1a',
                        borderColor: tab === 'all-around' ? '#34d399' : '#333',
                        color: tab === 'all-around' ? '#34d399' : '#888',
                    }}
                >
                    <Compass size={14} />
                    All Around Trader
                </button>
                <button
                    onClick={() => setTab('fisher')}
                    style={{
                        ...tabBtnStyle,
                        background: tab === 'fisher' ? '#a78bfa22' : '#1a1a1a',
                        borderColor: tab === 'fisher' ? '#a78bfa' : '#333',
                        color: tab === 'fisher' ? '#a78bfa' : '#888',
                    }}
                >
                    <Target size={14} />
                    Top Bottom Fisher
                </button>
            </div>

            {/* Description */}
            <div style={{
                padding: '16px 20px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '12px',
                marginBottom: '24px',
                fontSize: '14px',
                color: '#aaa',
                lineHeight: 1.6,
            }}>
                {tab === 'all-around' ? (
                    <>
                        <strong style={{ color: '#34d399' }}>All Around Trader</strong> — Best ROI per unique
                        asset traded each day. Trade across more assets to maximize your score.
                        Minimum $1,000 trade size, 200 points cap per asset.
                    </>
                ) : (
                    <>
                        <strong style={{ color: '#a78bfa' }}>Top Bottom Fisher</strong> — Catch the best
                        entry price relative to the day&apos;s price extremes. Longs near the day&apos;s low
                        and shorts near the day&apos;s high earn rank points, multiplied by ROI.
                    </>
                )}
            </div>

            {/* Cumulative Leaderboard */}
            <section style={{ marginBottom: '40px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#e0e0e0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Trophy size={18} />
                    Cumulative Leaderboard
                </h2>

                {loading ? (
                    <p style={{ color: '#888' }}>Loading...</p>
                ) : error ? (
                    <p style={{ color: '#ff6b6b' }}>{error}</p>
                ) : leaderboard.length === 0 ? (
                    <p style={{ color: '#888' }}>No scores yet for this category.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={thStyle}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Total Score</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Days Active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((entry, i) => (
                                    <tr key={entry.wallet} style={{ borderBottom: '1px solid #222' }}>
                                        <td style={tdStyle}>
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '13px' }}>
                                            {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: tab === 'all-around' ? '#34d399' : '#a78bfa',
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
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#e0e0e0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={18} />
                    Daily Breakdown
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <input
                        type="date"
                        value={dailyDate}
                        onChange={(e) => setDailyDate(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            background: '#1a1a1a',
                            border: '1px solid #333',
                            borderRadius: '8px',
                            color: '#e0e0e0',
                            fontSize: '14px',
                        }}
                    />
                </div>

                {dailyDate && dailyScores.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={thStyle}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyScores.map((s, i) => (
                                    <tr key={s.id} style={{ borderBottom: '1px solid #222' }}>
                                        <td style={tdStyle}>{i + 1}</td>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '13px' }}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: tab === 'all-around' ? '#34d399' : '#a78bfa',
                                        }}>
                                            {typeof s.score === 'number' ? s.score.toFixed(1) : s.score}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : dailyDate ? (
                    <p style={{ color: '#888' }}>No scores for {dailyDate}</p>
                ) : (
                    <p style={{ color: '#888' }}>Select a date to view daily results.</p>
                )}
            </section>
        </main>
    );
}

const tabBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    border: '1px solid #333',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
};

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
