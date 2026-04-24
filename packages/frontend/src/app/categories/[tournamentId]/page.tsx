'use client';

import { useEffect, useState, use, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
    getCategoryLeaderboard,
    getDailyScores,
    getQuestProgress,
    getTournament,
    type CategoryLeaderboardEntry,
    type DailyCategoryScore,
    type CategorySlug,
    type QuestProgressDetails,
    type TournamentState,
} from '@/lib/api';
import { Compass, Target, TrendingUp, Shield, Trophy, Calendar, Zap } from 'lucide-react';
import Link from 'next/link';

// Phase 4: base tabs (non-LM). LM tabs are per-asset, appended dynamically below.
interface CategoryTab {
    slug: CategorySlug;
    label: string;
    icon: typeof Compass;
    color: string;
    colorBg: string;
    description: string;
}
const BASE_CATEGORY_TABS: CategoryTab[] = [
    {
        slug: 'all_around',
        label: 'All Around',
        icon: Compass,
        color: 'var(--status-success)',
        colorBg: 'var(--status-success-bg)',
        description: 'Best ROI per unique asset traded each day. Trade across more assets to maximize your score.',
    },
    {
        slug: 'top_tick_traveler',
        label: 'Top-Tick Traveler',
        icon: TrendingUp,
        color: 'var(--accent-primary)',
        colorBg: 'rgba(108, 92, 231, 0.1)',
        description: 'Catch the best short entry relative to the day\'s high — sharpest shorts score highest.',
    },
    {
        slug: 'bottom_fisher',
        label: 'Bottom Fisher',
        icon: Target,
        color: '#e17055',
        colorBg: 'rgba(225, 112, 85, 0.1)',
        description: 'Catch the best long entry relative to the day\'s low — sharpest longs score highest.',
    },
    {
        slug: 'risk_manager',
        label: 'Risk Manager',
        icon: Shield,
        color: '#00b894',
        colorBg: 'rgba(0, 184, 148, 0.1)',
        description: 'Best stop-loss trade in a 2-day window. The tightest loss wins. Requires SL/TP to be set.',
    },
    {
        slug: 'humble_one',
        label: 'The Humble One',
        icon: Trophy,
        color: '#fdcb6e',
        colorBg: 'rgba(253, 203, 110, 0.1)',
        description: 'Best take-profit trade in a 2-day window. Disciplined profit-taking rewarded. Requires SL/TP to be set.',
    },
];

export default function CategoriesPage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const searchParams = useSearchParams();
    const tournamentId = parseInt(rawId, 10);

    const [tournament, setTournament] = useState<TournamentState | null>(null);

    // Phase 4: compute tabs dynamically from tournament config.
    const categoryTabs = useMemo<CategoryTab[]>(() => {
        const tabs: CategoryTab[] = [...BASE_CATEGORY_TABS];
        const assetList = tournament?.config?.assetList;
        if (assetList?.length) {
            for (const asset of assetList) {
                tabs.push(
                    { slug: `leverage_master_${asset.symbol}_long` as CategorySlug, label: `LM ${asset.symbol} (Long)`, icon: Zap, color: '#e84393', colorBg: 'rgba(232, 67, 147, 0.1)', description: `Leverage ladders for ${asset.symbol} long positions.` },
                    { slug: `leverage_master_${asset.symbol}_short` as CategorySlug, label: `LM ${asset.symbol} (Short)`, icon: Zap, color: '#0984e3', colorBg: 'rgba(9, 132, 227, 0.1)', description: `Leverage ladders for ${asset.symbol} short positions.` },
                );
            }
        } else {
            // Legacy fallback: 2-tab static layout for pre-Phase-4 tournaments
            tabs.push(
                { slug: 'leverage_master_long' as CategorySlug, label: 'Leverage (Long)', icon: Zap, color: '#e84393', colorBg: 'rgba(232, 67, 147, 0.1)', description: 'Leverage ladders for long positions.' },
                { slug: 'leverage_master_short' as CategorySlug, label: 'Leverage (Short)', icon: Zap, color: '#0984e3', colorBg: 'rgba(9, 132, 227, 0.1)', description: 'Leverage ladders for short positions.' },
            );
        }
        return tabs;
    }, [tournament?.config?.assetList]);

    const initialTab = (searchParams.get('tab') as CategorySlug) || 'all_around';
    const [tab, setTab] = useState<CategorySlug>(initialTab);
    const [leaderboard, setLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    const [dailyDate, setDailyDate] = useState<string>('');
    const [dailyScores, setDailyScores] = useState<DailyCategoryScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Wallet-scoped quest progress for the badge grid
    const router = useRouter();
    const walletParam = searchParams.get('wallet') || '';
    const [walletInput, setWalletInput] = useState(walletParam);
    const [questData, setQuestData] = useState<QuestProgressDetails | null>(null);

    const activeTab = categoryTabs.find(t => t.slug === tab) ?? categoryTabs[0];
    // Phase 4 item 30: leverage tabs now include per-asset slugs (leverage_master_SYMBOL_long/_short)
    const isLeverageTab = tab.startsWith('leverage_master_');
    // Extract asset from tab slug: leverage_master_SOL_long → 'SOL'
    // Legacy slugs (leverage_master_long / _short) have no asset → undefined
    const leverageTabAsset = isLeverageTab
        ? (() => {
            const match = tab.match(/^leverage_master_(.+)_(long|short)$/);
            return match?.[1] && match[1] !== 'long' && match[1] !== 'short' ? match[1] : undefined;
        })()
        : undefined;
    const leverageTabSide: 'long' | 'short' = tab.endsWith('_long') ? 'long' : 'short';

    useEffect(() => {
        if (!isNaN(tournamentId)) {
            loadLeaderboard();
        }
    }, [tournamentId, tab]);

    // Phase 4: fetch tournament config for dynamic tabs
    useEffect(() => {
        if (!isNaN(tournamentId)) {
            getTournament(tournamentId).then(setTournament).catch(() => setTournament(null));
        }
    }, [tournamentId]);

    useEffect(() => {
        if (dailyDate && !isNaN(tournamentId)) {
            loadDailyScores();
        }
    }, [dailyDate, tab]);

    // Fetch quest progress when wallet param is present and a leverage tab is active
    useEffect(() => {
        if (walletParam && isLeverageTab && !isNaN(tournamentId)) {
            getQuestProgress(tournamentId, walletParam)
                .then(setQuestData)
                .catch(() => setQuestData(null));
        } else {
            setQuestData(null);
        }
    }, [walletParam, tab, tournamentId]);

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
                {categoryTabs.map((catTab) => {
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
                                            <span style={getRankStyle(computeCompetitionRank(leaderboard, i) - 1)}>
                                                {computeCompetitionRank(leaderboard, i)}
                                            </span>
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

            {/* Leverage Master Badge Grid (shown only for leverage tabs) */}
            {isLeverageTab && (
                <section style={{ marginBottom: 'var(--space-2xl)' }}>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <Zap size={18} />
                        Step Progress
                    </h2>
                    <div className="card" style={{ padding: 'var(--space-lg)' }}>
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                            Each badge represents a leverage tier. Open a position at the target leverage (\u00b12x tolerance) to complete a step.
                        </p>

                        {/* Wallet input for quest lookup */}
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', alignItems: 'center' }}>
                            <input
                                type="text"
                                className="input input--mono"
                                placeholder="Enter wallet address to view progress..."
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                                style={{ flex: 1, fontSize: '13px' }}
                            />
                            <button
                                className="btn btn--secondary"
                                style={{ fontSize: '13px', padding: '8px 16px', whiteSpace: 'nowrap' }}
                                onClick={() => {
                                    if (walletInput.trim()) {
                                        const params = new URLSearchParams(searchParams.toString());
                                        params.set('wallet', walletInput.trim());
                                        router.replace(`?${params.toString()}`, { scroll: false });
                                    }
                                }}
                                disabled={!walletInput.trim()}
                            >
                                View Progress
                            </button>
                        </div>

                        {walletParam && (
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', fontFamily: 'var(--font-mono)' }}>
                                {walletParam.slice(0, 4)}...{walletParam.slice(-4)}
                            </p>
                        )}

                        <LeverageBadgeGrid
                            steps={(() => {
                                // Phase 4 item 30: read per-asset ladder from byAsset map.
                                // Legacy slugs (no asset) use '__legacy__' key.
                                const assetKey = leverageTabAsset ?? '__legacy__';
                                const asset = questData?.byAsset?.[assetKey];
                                if (!asset) return Array(10).fill(false);
                                return leverageTabSide === 'long' ? asset.long : asset.short;
                            })()}
                            color={activeTab.color}
                        />
                    </div>
                </section>
            )}

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

/**
 * Standard competition ranking: tied entries share the same rank.
 * For entry at index i, rank = index of first entry with the same score + 1.
 */
function computeCompetitionRank(entries: CategoryLeaderboardEntry[], index: number): number {
    const score = entries[index].totalScore;
    for (let j = 0; j < index; j++) {
        if (entries[j].totalScore === score) {
            return j + 1;
        }
    }
    return index + 1;
}

function getRankStyle(index: number): React.CSSProperties {
    if (index === 0) return { fontWeight: 700, color: '#ffd700' };
    if (index === 1) return { fontWeight: 700, color: '#c0c0c0' };
    if (index === 2) return { fontWeight: 700, color: '#cd7f32' };
    return {};
}

// ---- Leverage Master Badge Grid ----

const LEVERAGE_LABELS = ['10x', '20x', '30x', '40x', '50x', '60x', '70x', '80x', '90x', '100x'];

function LeverageBadgeGrid({ steps, color }: { steps: boolean[]; color: string }) {
    const completedCount = steps.filter(Boolean).length;

    return (
        <div>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 'var(--space-sm)',
                marginBottom: 'var(--space-md)',
            }}>
                {LEVERAGE_LABELS.map((label, i) => {
                    const completed = steps[i];
                    return (
                        <div
                            key={label}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 'var(--space-sm) var(--space-xs)',
                                borderRadius: 'var(--radius-md)',
                                border: `1px solid ${completed ? color : 'var(--border-default)'}`,
                                background: completed ? `${color}15` : 'var(--bg-card)',
                                transition: 'all var(--transition-default)',
                                minHeight: '56px',
                            }}
                        >
                            <span style={{
                                fontSize: '16px',
                                fontWeight: 700,
                                color: completed ? color : 'var(--text-muted)',
                            }}>
                                {label}
                            </span>
                            <span style={{
                                fontSize: '11px',
                                color: completed ? color : 'var(--text-muted)',
                                marginTop: '2px',
                            }}>
                                {completed ? '✓' : '—'}
                            </span>
                        </div>
                    );
                })}
            </div>
            <p style={{
                fontSize: '13px',
                color: completedCount > 0 ? color : 'var(--text-muted)',
                fontWeight: 600,
            }}>
                {completedCount}/10 steps completed
            </p>
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
