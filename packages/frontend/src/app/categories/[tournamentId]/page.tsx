'use client';

// ============================================================================
// Daily Categories: per-tournament page.
//
// Per-category accent colors stay inline (5 distinct category brand colors).
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

// Base tabs (non-LM). LM tabs are per-asset, appended dynamically below.
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

// Normalize URL tab slug. With aggregated LM tabs, old bookmarks like
// ?tab=leverage_master_SOL_long no longer match any tab in the categoryTabs
// array (which uses leverage_master_SOL). Map legacy per-side slugs to
// aggregated form + capture the side for the in-tab toggle's default.
function normalizeLmTab(raw: string): { tab: string; initialSide: 'long' | 'short' } {
    const m = raw.match(/^leverage_master_(.+)_(long|short)$/);
    if (m && m[1] !== 'long' && m[1] !== 'short') {
        return { tab: `leverage_master_${m[1]}`, initialSide: m[2] as 'long' | 'short' };
    }
    return { tab: raw, initialSide: 'long' };
}

export default function CategoriesPage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const searchParams = useSearchParams();
    const tournamentId = parseInt(rawId, 10);

    const [tournament, setTournament] = useState<TournamentState | null>(null);

    // Phase 4: compute tabs dynamically from tournament config.
    // Phase 8 item (c.5c): LM tabs aggregated per-asset (one tab per asset
    // showing both Long and Short ladders inside) instead of per-(asset,side).
    // Reduces LM tab count from 12 → 6 for assetList of length 6.
    const categoryTabs = useMemo<CategoryTab[]>(() => {
        const tabs: CategoryTab[] = [...BASE_CATEGORY_TABS];
        const assetList = tournament?.config?.assetList;
        if (assetList?.length) {
            for (const asset of assetList) {
                tabs.push({
                    slug: `leverage_master_${asset.symbol}` as CategorySlug,
                    label: `LM ${asset.symbol}`,
                    icon: Zap,
                    color: '#a29bfe',
                    colorBg: 'rgba(162, 155, 254, 0.1)',
                    description: `Leverage ladders for ${asset.symbol} (long + short combined).`,
                });
            }
        } else {
            // Legacy fallback: older tournaments still use 2-tab per-side layout
            tabs.push(
                { slug: 'leverage_master_long' as CategorySlug, label: 'Leverage (Long)', icon: Zap, color: '#e84393', colorBg: 'rgba(232, 67, 147, 0.1)', description: 'Leverage ladders for long positions.' },
                { slug: 'leverage_master_short' as CategorySlug, label: 'Leverage (Short)', icon: Zap, color: '#0984e3', colorBg: 'rgba(9, 132, 227, 0.1)', description: 'Leverage ladders for short positions.' },
            );
        }
        return tabs;
    }, [tournament?.config?.assetList]);

    // Normalize legacy per-side URLs to aggregated form
    const rawInitialTab = searchParams.get('tab') || 'all_around';
    const { tab: normalizedInitialTab, initialSide: normalizedInitialSide } = normalizeLmTab(rawInitialTab);
    const [tab, setTab] = useState<CategorySlug>(normalizedInitialTab as CategorySlug);
    const [leaderboard, setLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    // Aggregated LM tabs need TWO leaderboards (long + short).
    // Track them separately; non-LM tabs continue to use single `leaderboard` state.
    const [longLeaderboard, setLongLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    const [shortLeaderboard, setShortLeaderboard] = useState<CategoryLeaderboardEntry[]>([]);
    const [leverageActiveSide, setLeverageActiveSide] = useState<'long' | 'short'>(normalizedInitialSide);
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
    // Leverage tabs are aggregated per-asset (`leverage_master_SOL`) via tab
    // generation; legacy per-side URLs are normalized to aggregated form via
    // `normalizeLmTab` above so old bookmarks still land on the right tab.
    const isLeverageTab = tab.startsWith('leverage_master_');
    const leverageTabAsset = isLeverageTab
        ? (() => {
            // Aggregated form (current): leverage_master_<asset>
            const aggMatch = tab.match(/^leverage_master_([A-Z0-9_]+)$/);
            if (aggMatch && aggMatch[1] !== 'long' && aggMatch[1] !== 'short') {
                return aggMatch[1];
            }
            // Legacy per-side (defensive: should be normalized away by normalizeLmTab,
            // but keep for in-flight state).
            const sideMatch = tab.match(/^leverage_master_(.+)_(long|short)$/);
            if (sideMatch && sideMatch[1] !== 'long' && sideMatch[1] !== 'short') {
                return sideMatch[1];
            }
            return undefined;
        })()
        : undefined;

    useEffect(() => {
        if (!isNaN(tournamentId)) {
            loadLeaderboard();
        }
    }, [tournamentId, tab]);

    // Fetch tournament config for dynamic tabs
    useEffect(() => {
        if (!isNaN(tournamentId)) {
            getTournament(tournamentId).then(setTournament).catch(() => setTournament(null));
        }
    }, [tournamentId]);

    useEffect(() => {
        if (dailyDate && !isNaN(tournamentId)) {
            loadDailyScores();
        }
    }, [dailyDate, tab, leverageActiveSide]);

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
            // Aggregated LM tabs need TWO leaderboards.
            if (isLeverageTab && leverageTabAsset) {
                const [longData, shortData] = await Promise.all([
                    getCategoryLeaderboard(tournamentId, `leverage_master_${leverageTabAsset}_long` as CategorySlug),
                    getCategoryLeaderboard(tournamentId, `leverage_master_${leverageTabAsset}_short` as CategorySlug),
                ]);
                setLongLeaderboard(longData);
                setShortLeaderboard(shortData);
                setLeaderboard([]);
            } else {
                const data = await getCategoryLeaderboard(tournamentId, tab);
                setLeaderboard(data);
                setLongLeaderboard([]);
                setShortLeaderboard([]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
        } finally {
            setLoading(false);
        }
    }

    async function loadDailyScores() {
        try {
            // For aggregated LM tab, daily-breakdown reads the side selected
            // via the in-tab toggle (`leverageActiveSide`).
            const effectiveSlug: CategorySlug = isLeverageTab && leverageTabAsset
                ? (`leverage_master_${leverageTabAsset}_${leverageActiveSide}` as CategorySlug)
                : tab;
            const data = await getDailyScores(tournamentId, effectiveSlug, dailyDate);
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
                ) : isLeverageTab && leverageTabAsset ? (
                    // Aggregated per-asset display: Long + Short stacked
                    <div className={styles.lmAggregatedSplit}>
                        <LeverageSubLeaderboard sideLabel="Long" entries={longLeaderboard} accentColor={activeTab.color} />
                        <LeverageSubLeaderboard sideLabel="Short" entries={shortLeaderboard} accentColor={activeTab.color} />
                    </div>
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

                        {/* Show BOTH long + short badge grids */}
                        <div className={styles.lmBadgeGroupHeading}>Long ladder</div>
                        <LeverageBadgeGrid
                            steps={(() => {
                                const assetKey = leverageTabAsset ?? '__legacy__';
                                const asset = questData?.byAsset?.[assetKey];
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                const defaultLen = configEntry?.lmSteps?.length ?? 10;
                                if (!asset) return Array(defaultLen).fill(false);
                                return asset.long;
                            })()}
                            stepValues={(() => {
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                return configEntry?.lmSteps;
                            })()}
                            color="#e84393"
                        />
                        <div className={styles.lmBadgeGroupHeading}>Short ladder</div>
                        <LeverageBadgeGrid
                            steps={(() => {
                                const assetKey = leverageTabAsset ?? '__legacy__';
                                const asset = questData?.byAsset?.[assetKey];
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                const defaultLen = configEntry?.lmSteps?.length ?? 10;
                                if (!asset) return Array(defaultLen).fill(false);
                                return asset.short;
                            })()}
                            stepValues={(() => {
                                const configEntry = tournament?.config?.assetList?.find(a => a.symbol === leverageTabAsset);
                                return configEntry?.lmSteps;
                            })()}
                            color="#0984e3"
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
                {/* For aggregated LM tab, side toggle */}
                {isLeverageTab && leverageTabAsset && (
                    <div className={styles.lmSideToggleRow}>
                        <button
                            onClick={() => setLeverageActiveSide('long')}
                            className={`${styles.lmSideToggle} ${leverageActiveSide === 'long' ? styles.lmSideToggleActive : ''}`}
                        >
                            Long
                        </button>
                        <button
                            onClick={() => setLeverageActiveSide('short')}
                            className={`${styles.lmSideToggle} ${leverageActiveSide === 'short' ? styles.lmSideToggleActive : ''}`}
                        >
                            Short
                        </button>
                    </div>
                )}
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

// ---- Aggregated per-side leaderboard inside an LM tab ----
function LeverageSubLeaderboard({
    sideLabel, entries, accentColor,
}: {
    sideLabel: 'Long' | 'Short';
    entries: CategoryLeaderboardEntry[];
    accentColor: string;
}) {
    return (
        <div className={styles.lmAggregatedHalf}>
            <div className={styles.lmAggregatedHeader}>{sideLabel}</div>
            {entries.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No scores yet for {sideLabel.toLowerCase()}.</p>
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
                            {entries.map((entry, i) => (
                                <tr key={entry.wallet}>
                                    <td>
                                        <span style={getRankStyle(computeCompetitionRank(entries, i) - 1)}>
                                            {computeCompetitionRank(entries, i)}
                                        </span>
                                    </td>
                                    <td className={styles.tdMono}>
                                        {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                    </td>
                                    <td className={styles.tdRight} style={{ fontWeight: 600, color: accentColor }}>
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
        </div>
    );
}

// ---- Leverage Master Badge Grid ----
// Labels are generated per render from the stepValues prop (per-asset ladder:
// e.g. [10,20,...,100] for crypto, [1.5,2,2.5,3,3.5,4,4.5] for sub-10x RWA).
// Falls back to legacy crypto labels when stepValues is undefined.

function LeverageBadgeGrid({ steps, stepValues, color }: { steps: boolean[]; stepValues?: number[]; color: string }) {
    const completedCount = steps.filter(Boolean).length;
    const total = steps.length;
    // Per-asset step values when present; default to crypto 10x ladder labels otherwise.
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
