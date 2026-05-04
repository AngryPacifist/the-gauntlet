'use client';

// ============================================================================
// Daily Categories — Per-tournament page
// Phase 8.i.5.D.4.5: inline-style cleanup. Local tabBtnStyle/thStyle/tdStyle
// helpers dropped; module classes from page.module.css. Per-category accent
// colors stay inline (5 distinct category brand colors — intentional, not
// part of the Adrena palette migration).
// ============================================================================

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
import styles from './page.module.css';

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
                <div className="card error-state">
                    <p>Invalid tournament ID</p>
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
            <div className={styles.tabRow}>
                {categoryTabs.map((catTab) => {
                    const Icon = catTab.icon;
                    const isActive = tab === catTab.slug;
                    return (
                        <button
                            key={catTab.slug}
                            onClick={() => setTab(catTab.slug)}
                            className={styles.tabBtn}
                            style={isActive ? {
                                background: catTab.colorBg,
                                borderColor: catTab.color,
                                color: catTab.color,
                            } : undefined}
                        >
                            <Icon size={14} />
                            {catTab.label}
                        </button>
                    );
                })}
            </div>

            {/* Description */}
            <div className={`card ${styles.descCard}`}>
                <strong style={{ color: activeTab.color }}>{activeTab.label}</strong> &mdash; {activeTab.description}
            </div>

            {/* Cumulative Leaderboard */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
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
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Wallet</th>
                                    <th className={styles.thRight}>Total Score</th>
                                    <th className={styles.thRight}>Days Active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((entry, i) => (
                                    <tr key={entry.wallet}>
                                        <td>
                                            <span style={getRankStyle(computeCompetitionRank(leaderboard, i) - 1)}>
                                                {computeCompetitionRank(leaderboard, i)}
                                            </span>
                                        </td>
                                        <td className={styles.tdMono}>
                                            {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                        </td>
                                        <td className={styles.tdRight} style={{ fontWeight: 600, color: activeTab.color }}>
                                            {typeof entry.totalScore === 'number' ? entry.totalScore.toFixed(1) : entry.totalScore}
                                        </td>
                                        <td className={styles.tdRight}>
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
                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>
                        <Zap size={18} />
                        Step Progress
                    </h2>
                    <div className={`card ${styles.lmCard}`}>
                        <p className={styles.lmIntro}>
                            Each badge represents a leverage tier. Open a position at the target leverage (±2x tolerance) to complete a step.
                        </p>

                        {/* Wallet input for quest lookup */}
                        <div className={styles.lmInputRow}>
                            <input
                                type="text"
                                className={`input input--mono ${styles.lmInput}`}
                                placeholder="Enter wallet address to view progress..."
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                            />
                            <button
                                className={`btn btn--secondary ${styles.lmBtn}`}
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
                            <p className={styles.lmWalletHint}>
                                {walletParam.slice(0, 4)}...{walletParam.slice(-4)}
                            </p>
                        )}

                        <LeverageBadgeGrid
                            steps={(() => {
                                // Phase 4 item 30: read per-asset ladder from byAsset map.
                                // Legacy slugs (no asset) use '__legacy__' key.
                                const assetKey = leverageTabAsset ?? '__legacy__';
                                const asset = questData?.byAsset?.[assetKey];
                                // Phase 7.a: derive default step count from tournament config when no asset data yet
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                const defaultLen = configEntry?.lmSteps?.length ?? 10;
                                if (!asset) return Array(defaultLen).fill(false);
                                return leverageTabSide === 'long' ? asset.long : asset.short;
                            })()}
                            stepValues={(() => {
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                return configEntry?.lmSteps;
                            })()}
                            color={activeTab.color}
                        />
                    </div>
                </section>
            )}

            {/* Daily Breakdown */}
            <section>
                <h2 className={styles.sectionTitle}>
                    <Calendar size={18} />
                    Daily Breakdown
                </h2>
                <div className={styles.dateInputRow}>
                    <input
                        type="date"
                        value={dailyDate}
                        onChange={(e) => setDailyDate(e.target.value)}
                        className={`input ${styles.dateInput}`}
                    />
                </div>

                {dailyDate && dailyScores.length > 0 ? (
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Wallet</th>
                                    <th className={styles.thRight}>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyScores.map((s, i) => (
                                    <tr key={s.id}>
                                        <td>{i + 1}</td>
                                        <td className={styles.tdMono}>
                                            {s.wallet.slice(0, 4)}...{s.wallet.slice(-4)}
                                        </td>
                                        <td className={styles.tdRight} style={{ fontWeight: 600, color: activeTab.color }}>
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
    if (index === 0) return { fontWeight: 700, color: 'var(--accent-gold)' };
    if (index === 1) return { fontWeight: 700, color: 'var(--accent-silver)' };
    if (index === 2) return { fontWeight: 700, color: 'var(--accent-bronze)' };
    return {};
}

// ---- Leverage Master Badge Grid ----
// Phase 7.a: const LEVERAGE_LABELS removed — labels are now generated per render
// from the stepValues prop (per-asset ladder: e.g. [10,20,...,100] for crypto,
// [1.5,2,2.5,3,3.5,4,4.5] for sub-10x RWA). Falls back to legacy crypto labels
// when stepValues is undefined (pre-Phase-7 tournaments).

function LeverageBadgeGrid({ steps, stepValues, color }: { steps: boolean[]; stepValues?: number[]; color: string }) {
    const completedCount = steps.filter(Boolean).length;
    const total = steps.length;
    // Phase 7.a: per-asset step values when present; default to crypto 10x ladder labels otherwise.
    const labels = stepValues && stepValues.length === total
        ? stepValues.map((v) => `${v}x`)
        : Array.from({ length: total }, (_, i) => `${(i + 1) * 10}x`);

    return (
        <div>
            <div className={styles.badgeGrid}>
                {labels.map((label, i) => {
                    const completed = steps[i];
                    return (
                        <div
                            key={`${label}-${i}`}
                            className={styles.lmBadge}
                            style={completed ? {
                                borderColor: color,
                                background: `${color}15`,
                            } : undefined}
                        >
                            <span className={styles.badgeLabel} style={completed ? { color } : undefined}>
                                {label}
                            </span>
                            <span className={styles.badgeStatus} style={completed ? { color } : undefined}>
                                {completed ? '✓' : '—'}
                            </span>
                        </div>
                    );
                })}
            </div>
            <p className={styles.badgeProgress} style={completedCount > 0 ? { color } : undefined}>
                {completedCount}/{total} steps completed
            </p>
        </div>
    );
}
