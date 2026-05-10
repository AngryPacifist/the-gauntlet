'use client';

// ============================================================================
// Per-Tournament Leaderboard
// Phase 8.i.5.D.4.1: full inline-style + Slate-palette migration to module
// classes from page.module.css. Logic untouched. All helpers preserved verbatim
// including parseLeverageMasterSlug (Day 41 commit 399cbd7 — centralized LM
// slug parser; do NOT inline the regex back).
// ============================================================================

import { useState, useEffect, use, useCallback, useMemo } from 'react';
import {
    getForgeLeaderboard,
    getWalletBreakdown,
    getDailyScores,
    getLeverageMasterLeaderboard,
    registerWallet,
    type ForgeLeaderboard,
    type ForgeEntry,
    type WalletBreakdown,
    type DailyCategoryScore,
    type CategorySlug,
    type LeverageMasterLeaderboard,
    type LeverageMasterLeaderboardEntry,
} from '@/lib/api';
import { QUEST_DESCRIPTIONS, FF_DESCRIPTION, getLeverageMasterDescription, type QuestDescription } from '@/lib/quest-descriptions';
import { CPI_DESCRIPTION } from '@/lib/cpi-description';
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Trophy,
    Flame,
    Ticket,
    Target,
    Info,
    UserPlus,
    X as CloseIcon,
    CheckCircle,
    XCircle,
} from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const QUEST_LABELS: Record<string, string> = {
    all_around: 'All Around',
    top_tick_traveler: 'Top-Tick Traveler',
    bottom_fisher: 'Bottom Fisher',
    risk_manager: 'Risk Manager',
    humble_one: 'Humble One',
    leverage_master_long: 'Leverage Master (Long)',
    leverage_master_short: 'Leverage Master (Short)',
};

// Phase 8 fix: single source of truth for parsing leverage_master_* category slugs.
// Schema: 'leverage_master_<ASSET>_<SIDE>' (per-asset) | 'leverage_master_<SIDE>' (legacy).
// Returns { side, asset } where asset is undefined for legacy slugs OR if the captured
// asset literally equals 'long'/'short' (defensive — preserves the malformed-input
// behavior that the prior `(.+)?_?` regex in CategoryLeaderboard tolerated by accident).
function parseLeverageMasterSlug(category: string): {
    side: 'long' | 'short' | null;
    asset: string | undefined;
} {
    const m = category.match(/^leverage_master_(.+)_(long|short)$/);
    if (m) {
        const [, asset, side] = m;
        if (asset === 'long' || asset === 'short') {
            return { side: side as 'long' | 'short', asset: undefined };
        }
        return { side: side as 'long' | 'short', asset };
    }
    if (category === 'leverage_master_long') return { side: 'long', asset: undefined };
    if (category === 'leverage_master_short') return { side: 'short', asset: undefined };
    return { side: null, asset: undefined };
}

// Phase 4 item 30: returns human label for a category slug.
// Phase 8 fix: parsing logic delegated to parseLeverageMasterSlug for consistency.
function getQuestLabel(category: string): string {
    if (QUEST_LABELS[category]) return QUEST_LABELS[category];
    const { side, asset } = parseLeverageMasterSlug(category);
    if (side && asset) {
        return `Leverage Master ${asset} (${side === 'long' ? 'Long' : 'Short'})`;
    }
    return category;
}

const CPI_COMPONENTS = [
    { key: 'pnlScore', label: 'PnL', color: 'var(--status-success)' },
    { key: 'riskScore', label: 'Risk', color: 'var(--accent-secondary)' },
    { key: 'consistencyScore', label: 'Consistency', color: 'var(--accent-primary)' },
    { key: 'activityScore', label: 'Activity', color: 'var(--status-warning)' },
] as const;

type PageTab = 'general' | 'quests';
type QuestPeriod = 'daily' | '2day' | 'weekly';

// Phase 4 item 30: PERIOD_CATEGORIES.weekly is now per-asset when assetList is populated.
// Legacy fallback (undefined/empty assetList) → static 2-slug list for pre-Phase-4 data.
function getPeriodCategories(
    period: QuestPeriod,
    assetList?: Array<{ symbol: string }>,
): CategorySlug[] {
    switch (period) {
        case 'daily':
            return ['all_around', 'bottom_fisher', 'top_tick_traveler'];
        case '2day':
            return ['risk_manager', 'humble_one'];
        case 'weekly': {
            if (assetList?.length) {
                const slugs: CategorySlug[] = [];
                for (const asset of assetList) {
                    slugs.push(`leverage_master_${asset.symbol}_long` as CategorySlug);
                    slugs.push(`leverage_master_${asset.symbol}_short` as CategorySlug);
                }
                return slugs;
            }
            return ['leverage_master_long', 'leverage_master_short'];
        }
    }
}

const PERIOD_LABELS: Record<QuestPeriod, string> = {
    daily: 'Daily',
    '2day': '2 Day',
    weekly: 'Weekly',
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function stepDate(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return formatDate(d);
}

function todayUTC(): string {
    return formatDate(new Date());
}

function formatPrize(amount: number): string {
    return amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function shortWallet(wallet: string): string {
    return wallet.slice(0, 4) + '...' + wallet.slice(-4);
}

function extractQuestColumns(
    category: string,
    details: unknown,
    assetListLength?: number,
): { label: string; value: string }[] {
    if (!details || typeof details !== 'object') return [];
    const d = details as Record<string, unknown>;

    switch (category) {
        case 'all_around': {
            const scores = d.assetScores as Array<{ bestROI: number }> | undefined;
            const count = scores?.length ?? 0;
            const avgRoi = scores && scores.length > 0
                ? scores.reduce((s, a) => s + a.bestROI, 0) / scores.length
                : 0;
            const denom = assetListLength ?? 4;
            return [
                { label: 'Eligible Trades', value: `${count}/${denom}` },
                { label: 'ROI', value: `${(avgRoi * 100).toFixed(2)}%` },
            ];
        }
        case 'bottom_fisher': {
            const entry = d.longEntry as { proximity: number; roi: number } | null;
            return [
                { label: '% from Bottom', value: entry ? `${(entry.proximity * 100).toFixed(2)}%` : '—' },
                { label: 'ROI', value: entry ? `${(entry.roi * 100).toFixed(2)}%` : '—' },
            ];
        }
        case 'top_tick_traveler': {
            const entry = d.shortEntry as { proximity: number; roi: number } | null;
            return [
                { label: '% from Top', value: entry ? `${(entry.proximity * 100).toFixed(2)}%` : '—' },
                { label: 'ROI', value: entry ? `${(entry.roi * 100).toFixed(2)}%` : '—' },
            ];
        }
        case 'risk_manager':
        case 'humble_one': {
            const trade = d.bestTrade as { roi: number } | null;
            return [
                { label: 'ROI', value: trade ? `${(trade.roi * 100).toFixed(2)}%` : '—' },
            ];
        }
        default: {
            if (category.startsWith('leverage_master_')) {
                const count = (d.stepCount as number) ?? 0;
                const total = (d.stepCountTotal as number) ?? 10;
                return [
                    { label: 'Steps', value: `${count}/${total}` },
                ];
            }
            return [];
        }
    }
}

function rankBadgeClass(rank: number): string {
    if (rank === 1) return styles.rankBadge1;
    if (rank === 2) return styles.rankBadge2;
    if (rank === 3) return styles.rankBadge3;
    return '';
}

// Phase 8.q: extend skillPrizes via geometric decay so K > skillPrizes.length
// fields still distribute the full pool to all top% wallets. Decay ratio is
// derived from the curve's existing tail (last two values' ratio), clamped to
// (0, 1] to prevent curve inversion when admin configures a non-monotonic
// curve. Floor at 1 ADX prevents underflow at very large K (cumulative decay
// can produce sub-1 values; we want every slot non-zero). At K ≤ skillPrizes
// length: returns the original array (no allocation).
function extendSkillPrizes(skillPrizes: number[], K: number): number[] {
    if (K <= skillPrizes.length) return skillPrizes;
    if (skillPrizes.length === 0) return [];
    const len = skillPrizes.length;
    const tail2 = skillPrizes[len - 1];
    const tail1 = len >= 2 ? skillPrizes[len - 2] : tail2 * 2;
    const rawRatio = tail1 > 0 ? tail2 / tail1 : 0.5;
    const decayRatio = Math.min(Math.max(rawRatio, 0), 1);
    const extended = [...skillPrizes];
    while (extended.length < K) {
        const next = extended[extended.length - 1] * decayRatio;
        extended.push(Math.max(next, 1));
    }
    return extended;
}

// --------------------------------------------------------------------------
// Page Component
// --------------------------------------------------------------------------

export default function LeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const tournamentId = parseInt(resolvedParams.id, 10);

    const [data, setData] = useState<ForgeLeaderboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PageTab>('general');

    // General tab state
    const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
    const [breakdownCache, setBreakdownCache] = useState<Map<string, WalletBreakdown>>(new Map());
    const [breakdownLoading, setBreakdownLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Quest tab state
    const [questPeriod, setQuestPeriod] = useState<QuestPeriod>('daily');
    const [questDate, setQuestDate] = useState(todayUTC());
    const [questScores, setQuestScores] = useState<Map<string, DailyCategoryScore[]>>(new Map());
    const [questLoading, setQuestLoading] = useState(false);
    const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
    // Round 2 (LM-2 + LM-3): live LM leaderboard from quest_progress (not week-boundary).
    // Replaces dailyCategoryScores dependency for the Quest Leaderboards Weekly tab so
    // step progress shows mid-week — matches the c.5+a.2 expanded-row LM display.
    const [lmLeaderboard, setLmLeaderboard] = useState<LeverageMasterLeaderboard | null>(null);

    // Registration modal state (Item 3)
    const [showRegModal, setShowRegModal] = useState(false);
    const [walletInput, setWalletInput] = useState('');
    const [registering, setRegistering] = useState(false);
    const [regResult, setRegResult] = useState<{ registered: boolean; reason?: string } | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const result = await getForgeLeaderboard(tournamentId);
                setData(result);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [tournamentId]);

    const loadQuestScores = useCallback(async (period: QuestPeriod, date: string) => {
        setQuestLoading(true);
        const categories = getPeriodCategories(period, data?.tournament?.config?.assetList);
        const newScores = new Map<string, DailyCategoryScore[]>();
        try {
            const results = await Promise.allSettled(
                categories.map(async (cat) => {
                    const scores = await getDailyScores(tournamentId, cat, date);
                    return { cat, scores };
                }),
            );
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    newScores.set(result.value.cat, result.value.scores);
                }
            }
        } catch { /* ignore */ }
        setQuestScores(newScores);
        setQuestLoading(false);
    }, [tournamentId]);

    // Round 2 (LM-2 + LM-3): fetch live LM leaderboard for the Weekly tab.
    // Passes questDate so backend resolves the displayed week (supports the
    // Weekly date navigator).
    const loadLmLeaderboard = useCallback(async (date: string) => {
        try {
            const data = await getLeverageMasterLeaderboard(tournamentId, undefined, date);
            setLmLeaderboard(data);
        } catch {
            setLmLeaderboard(null);
        }
    }, [tournamentId]);

    useEffect(() => {
        if (activeTab === 'quests') {
            loadQuestScores(questPeriod, questDate);
            // Round 2: also fetch live LM leaderboard when Weekly tab is active.
            if (questPeriod === 'weekly') {
                loadLmLeaderboard(questDate);
            }
        }
    }, [activeTab, questPeriod, questDate, loadQuestScores, loadLmLeaderboard]);

    async function toggleExpand(wallet: string) {
        if (expandedWallet === wallet) {
            setExpandedWallet(null);
            return;
        }
        setExpandedWallet(wallet);

        if (breakdownCache.has(wallet)) return;

        setBreakdownLoading(true);
        try {
            const result = await getWalletBreakdown(tournamentId, wallet);
            setBreakdownCache((prev) => {
                const next = new Map(prev);
                next.set(wallet, result);
                return next;
            });
        } catch {
            // Failure: don't cache; user can retry by collapse + re-expand.
        } finally {
            setBreakdownLoading(false);
        }
    }

    function toggleRules(category: string) {
        setExpandedRules((prev) => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    }

    function navigateDate(direction: number) {
        const step = questPeriod === 'weekly' ? 7 : questPeriod === '2day' ? 2 : 1;
        setQuestDate((prev) => {
            const next = stepDate(prev, direction * step);
            return next > todayUTC() ? todayUTC() : next;
        });
    }

    function jumpToToday() {
        setQuestDate(todayUTC());
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (!walletInput.trim()) return;
        try {
            setRegistering(true);
            setRegResult(null);
            const result = await registerWallet(tournamentId, walletInput.trim());
            setRegResult(result);
            if (result.registered) {
                getForgeLeaderboard(tournamentId)
                    .then(setData)
                    .catch((err) => console.error('[Forge] leaderboard reload failed after registration:', err));
                setTimeout(() => {
                    setShowRegModal(false);
                    setWalletInput('');
                    setRegResult(null);
                }, 1500);
            }
        } catch (err) {
            setRegResult({
                registered: false,
                reason: err instanceof Error ? err.message : 'Registration failed',
            });
        } finally {
            setRegistering(false);
        }
    }

    const filteredEntries = data?.entries.filter((e) =>
        searchQuery ? e.wallet.toLowerCase().includes(searchQuery.toLowerCase()) : true,
    ) ?? [];

    const searchedWallet = useMemo<string | null>(() => {
        if (!searchQuery || !data) return null;
        const match = data.entries.find((e) =>
            e.wallet.toLowerCase().includes(searchQuery.toLowerCase()),
        );
        return match?.wallet ?? null;
    }, [searchQuery, data]);

    const breakdown = expandedWallet ? breakdownCache.get(expandedWallet) ?? null : null;

    if (loading) {
        return (
            <div className="loading-state">
                <Flame size={48} className={styles.flameIcon} style={{ animation: 'pulse 2s infinite' }} />
                <p>Loading leaderboard...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container">
                <div className="card error-state">
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const isForge = data.tournament.config?.format === 'rank_only';
    const pageTitle = isForge ? 'The Forge' : 'Leaderboard';

    return (
        <div className={styles.page}>
            <div className={styles.headerWrap}>
                {!isForge && (
                    <Link href={`/tournament/${tournamentId}`} className={styles.backLink}>
                        <ArrowLeft size={16} /> Back to Tournament
                    </Link>
                )}

                <div className={styles.headerRow}>
                    <Flame size={32} className={styles.flameIcon} />
                    <div className={styles.titleBlock}>
                        <div className={styles.titleRow}>
                            <h1 className={styles.title}>
                                {pageTitle}
                            </h1>
                            {isForge && <StatusBadge status={data.tournament.status} />}
                        </div>
                        <p className={styles.subtitle}>
                            {data.tournament.name} • {data.totalParticipants} participants • Top {data.top30Cutoff} earn skill prizes
                        </p>
                    </div>
                    {isForge && <RegisterButton status={data.tournament.status} onClick={() => setShowRegModal(true)} />}
                </div>
                {isForge && data.tournament.config.prizeTable && (
                    <PrizeInfo prizeTable={data.tournament.config.prizeTable} topPercentCutoff={data.tournament.config.topPercentCutoff} />
                )}
            </div>

            {/* Page-level tabs */}
            <div className={styles.pageTabs}>
                {(['general', 'quests'] as PageTab[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`${styles.pageTab} ${activeTab === tab ? styles.pageTabActive : ''}`}
                    >
                        {tab === 'general' ? 'General Leaderboard' : 'Quest Leaderboards'}
                    </button>
                ))}
            </div>

            {/* Fallen Fighters info — shown for bracket tournaments */}
            {data.tournament.config?.format === 'bracket' && (
                <div className={styles.ffCard}>
                    <Info size={18} className={styles.ffCardIcon} />
                    <div>
                        <p className={styles.ffCardTitle}>{FF_DESCRIPTION.title}</p>
                        <p className={styles.ffCardDesc}>{FF_DESCRIPTION.description}</p>
                    </div>
                </div>
            )}

            {/* Tab content */}
            {activeTab === 'general' ? (
                <GeneralLeaderboard
                    entries={filteredEntries}
                    expandedWallet={expandedWallet}
                    breakdown={breakdown}
                    breakdownLoading={breakdownLoading}
                    searchQuery={searchQuery}
                    onSearch={setSearchQuery}
                    onToggle={toggleExpand}
                    isForge={isForge}
                    prizeTable={data.tournament.config.prizeTable}
                    topPercentCutoff={data.tournament.config.topPercentCutoff}
                    assetList={data?.tournament?.config?.assetList}
                />
            ) : (
                <QuestLeaderboards
                    questPeriod={questPeriod}
                    questDate={questDate}
                    questScores={questScores}
                    questLoading={questLoading}
                    expandedRules={expandedRules}
                    assetList={data?.tournament?.config?.assetList}
                    onPeriodChange={setQuestPeriod}
                    onNavigateDate={navigateDate}
                    onToggleRules={toggleRules}
                    onJumpToToday={jumpToToday}
                    searchQuery={searchQuery}
                    onSearch={setSearchQuery}
                    searchedWallet={searchedWallet}
                    isForge={isForge}
                    lmLeaderboard={lmLeaderboard}
                />
            )}

            {showRegModal && (
                <RegisterModal
                    walletInput={walletInput}
                    onWalletChange={setWalletInput}
                    registering={registering}
                    regResult={regResult}
                    onSubmit={handleRegister}
                    onClose={() => {
                        setShowRegModal(false);
                        setWalletInput('');
                        setRegResult(null);
                    }}
                />
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// General Leaderboard Tab
// --------------------------------------------------------------------------

interface GeneralLeaderboardProps {
    entries: ForgeEntry[];
    expandedWallet: string | null;
    breakdown: WalletBreakdown | null;
    breakdownLoading: boolean;
    searchQuery: string;
    onSearch: (q: string) => void;
    onToggle: (wallet: string) => void;
    isForge: boolean;
    prizeTable?: {
        totalPool: number;
        currency: string;
        skillPrizes: number[];
        rafflePrizes: number[];
    };
    topPercentCutoff?: number;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}

function GeneralLeaderboard({
    entries, expandedWallet, breakdown, breakdownLoading,
    searchQuery, onSearch, onToggle, isForge, prizeTable, topPercentCutoff, assetList,
}: GeneralLeaderboardProps) {
    const prizesByRank = useMemo<Map<number, number>>(() => {
        const map = new Map<number, number>();
        if (!prizeTable) return map;
        const rankCounts = new Map<number, number>();
        for (const e of entries) {
            if (!e.isTopPercent) continue;
            rankCounts.set(e.rank, (rankCounts.get(e.rank) ?? 0) + 1);
        }
        // Phase 8.n: pro-rata scale so the configured skill pool always flows
        // fully to active top% wallets. K = total top% count; usedWeights sums
        // the first K (extended) skillPrizes slots. Scale = totalSkillPool /
        // usedWeights. K = length → scale = 1 (configured values). K < length
        // → scale > 1 (boost active wallets to consume full pool). Total
        // payout always sums to sum(skillPrizes).
        // Phase 8.q: when K > skillPrizes.length, extend the curve via
        // geometric decay (using the configured tail ratio) so every top%
        // wallet gets a non-zero prize. Without extension, ranks past
        // skillPrizes.length got 0 ADX while displaying TOP 30% chip — fixed.
        const totalTopCount = Array.from(rankCounts.values()).reduce((a, b) => a + b, 0);
        const totalSkillPool = prizeTable.skillPrizes.reduce((a, b) => a + b, 0);
        const extendedPrizes = extendSkillPrizes(prizeTable.skillPrizes, totalTopCount);
        const usedWeights = extendedPrizes.slice(0, totalTopCount).reduce((a, b) => a + b, 0);
        const scale = usedWeights > 0 ? totalSkillPool / usedWeights : 1;
        for (const [rank, count] of rankCounts) {
            let sum = 0;
            for (let i = 0; i < count; i++) {
                sum += extendedPrizes[rank - 1 + i] ?? 0;
            }
            map.set(rank, (sum * scale) / count);
        }
        return map;
    }, [entries, prizeTable]);

    return (
        <>
            <CPIExplanation />
            <input
                type="text"
                className={`input ${styles.searchInput}`}
                placeholder="Search by wallet address..."
                value={searchQuery}
                onChange={(e) => onSearch(e.target.value)}
            />

            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th></th>
                            <th className={styles.thLeft}>Rank</th>
                            <th className={styles.thLeft}>Wallet</th>
                            <th>CPI</th>
                            <th>Quests</th>
                            <th>Final</th>
                            <th>Prize</th>
                            <th>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <Ticket size={12} /> Tickets
                                </span>
                            </th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) => (
                            <ForgeRow
                                key={entry.wallet}
                                entry={entry}
                                isExpanded={expandedWallet === entry.wallet}
                                onToggle={() => onToggle(entry.wallet)}
                                breakdown={expandedWallet === entry.wallet ? breakdown : null}
                                breakdownLoading={expandedWallet === entry.wallet && breakdownLoading}
                                isForge={isForge}
                                prizeTable={prizeTable}
                                prizesByRank={prizesByRank}
                                topPercentCutoff={topPercentCutoff}
                                assetList={assetList}
                            />
                        ))}
                        {entries.length === 0 && (
                            <tr>
                                <td colSpan={9} className={styles.emptyRow}>
                                    {searchQuery ? 'No wallets match your search' : 'No participants yet'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// --------------------------------------------------------------------------
// Forge Row — expandable with CPI + quest breakdown bars
// --------------------------------------------------------------------------

interface ForgeRowProps {
    entry: ForgeEntry;
    isExpanded: boolean;
    onToggle: () => void;
    breakdown: WalletBreakdown | null;
    breakdownLoading: boolean;
    isForge: boolean;
    prizeTable?: {
        totalPool: number;
        currency: string;
        skillPrizes: number[];
        rafflePrizes: number[];
    };
    prizesByRank: Map<number, number>;
    topPercentCutoff?: number;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}

function ForgeRow({ entry, isExpanded, onToggle, breakdown, breakdownLoading, isForge, prizeTable, prizesByRank, topPercentCutoff, assetList }: ForgeRowProps) {
    const rankClass = rankBadgeClass(entry.rank);

    return (
        <>
            <tr
                onClick={onToggle}
                className={`${styles.row} ${isExpanded ? styles.rowExpanded : ''}`}
            >
                <td>
                    {isExpanded ? <ChevronDown size={14} className={styles.chevron} /> : <ChevronRight size={14} className={styles.chevron} />}
                </td>
                <td className={styles.tdLeft}>
                    <span className={`${styles.rankBadge} ${rankClass}`}>
                        {entry.rank <= 3 && <Trophy size={14} />}
                        #{entry.rank}
                    </span>
                </td>
                <td className={styles.tdLeft}>
                    {isForge ? (
                        <span className={styles.walletText}>{shortWallet(entry.wallet)}</span>
                    ) : (
                        <Link
                            href={`/trader/${entry.wallet}`}
                            onClick={(e) => e.stopPropagation()}
                            className={styles.walletLink}
                        >
                            {shortWallet(entry.wallet)}
                        </Link>
                    )}
                </td>
                <td>{entry.cpiScore.toFixed(1)}</td>
                <td>
                    <span className={styles.questPoints}>
                        <Target size={12} /> {entry.questPoints.toFixed(2)}
                    </span>
                </td>
                <td className={styles.finalScore}>
                    {entry.finalScore.toFixed(2)}
                </td>
                <td className={styles.prizeCol}>
                    {entry.isTopPercent && prizeTable
                        ? `${formatPrize(prizesByRank.get(entry.rank) ?? 0)} ${prizeTable.currency}`
                        : '—'}
                </td>
                <td className={entry.isTopPercent ? styles.ticketColTop : styles.ticketColRaffle}>
                    {entry.raffleTickets}
                </td>
                <td>
                    <span className={`${styles.statusChip} ${entry.isTopPercent ? styles.statusChipTop : styles.statusChipRaffle}`}>
                        {entry.isTopPercent
                            ? `TOP ${Math.round((topPercentCutoff ?? 0.30) * 100)}%`
                            : 'RAFFLE'}
                    </span>
                </td>
            </tr>

            {isExpanded && (
                <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                        <div className={styles.expandedRow}>
                            {breakdownLoading ? (
                                <p className={styles.breakdownEmpty}>Loading breakdown...</p>
                            ) : (
                                <div className={styles.breakdownGrid}>
                                    <div>
                                        <h4 className={styles.breakdownHeading}>CPI Breakdown</h4>
                                        {CPI_COMPONENTS.map(({ key, label, color }) => (
                                            <CPIBarWithDetails
                                                key={key}
                                                componentKey={key}
                                                label={label}
                                                value={entry[key as keyof ForgeEntry] as number}
                                                color={color}
                                                cpiDetails={breakdown?.cpiDetails ?? null}
                                            />
                                        ))}
                                    </div>
                                    <div>
                                        <h4 className={styles.breakdownHeading}>Category Scores</h4>
                                        {breakdown ? (
                                            <QuestBreakdownBars breakdown={breakdown} assetList={assetList} />
                                        ) : (
                                            <p className={styles.breakdownEmpty}>No quest data available.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// --------------------------------------------------------------------------
// Horizontal Bar Component
// --------------------------------------------------------------------------

interface HorizontalBarProps {
    label: string;
    value: number;
    max: number;
    color: string;
}

function HorizontalBar({ label, value, max, color }: HorizontalBarProps) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (
        <div className={styles.hbar}>
            <div className={styles.hbarHeader}>
                <span className={styles.hbarLabel}>{label}</span>
                <span className={styles.hbarValue}>{value.toFixed(1)}</span>
            </div>
            <div className={styles.hbarTrack}>
                <div className={styles.hbarFill} style={{ width: `${pct}%`, background: color }} />
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// CPI Bar with granular details (Phase 8 item c.1-4)
//
// Wraps HorizontalBar and renders the underlying inputs (ROI / Liq% /
// Max DD% / Profitable Days / Win Rate / Trade Count / Volume) below
// each CPI sub-bar. cpiDetails comes from the wallet-breakdown endpoint;
// null = recompute failed (rare), gracefully renders just the bar.
// --------------------------------------------------------------------------

interface CPIBarWithDetailsProps {
    componentKey: string;
    label: string;
    value: number;
    color: string;
    cpiDetails: WalletBreakdown['cpiDetails'];
}

function formatVolume(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(0);
}

function CPIBarWithDetails({ componentKey, label, value, color, cpiDetails }: CPIBarWithDetailsProps) {
    return (
        <div>
            <HorizontalBar label={label} value={value} max={100} color={color} />
            {cpiDetails && (
                <div className={styles.cpiSubText}>
                    {componentKey === 'pnlScore' && (
                        <>ROI: {(cpiDetails.roi * 100).toFixed(2)}%</>
                    )}
                    {componentKey === 'riskScore' && (
                        <>
                            Liquidations: {cpiDetails.liquidatedCount}/{cpiDetails.totalCount}
                            {' · '}
                            Max DD: {(cpiDetails.drawdownRatio * 100).toFixed(2)}%
                        </>
                    )}
                    {componentKey === 'consistencyScore' && (
                        <>
                            Profitable days: {cpiDetails.profitableDays}/{cpiDetails.totalTradingDays}
                            {' · '}
                            Win rate: {cpiDetails.totalClosedTrades > 0
                                ? `${((cpiDetails.winningTrades / cpiDetails.totalClosedTrades) * 100).toFixed(0)}%`
                                : '—'}
                        </>
                    )}
                    {componentKey === 'activityScore' && (
                        <>
                            Trades: {cpiDetails.tradeCount}
                            {' · '}
                            Volume: ${formatVolume(cpiDetails.totalVolume)}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// Quest Breakdown Bars (inside expanded row)
// --------------------------------------------------------------------------

function QuestBreakdownBars({
    breakdown, assetList,
}: {
    breakdown: WalletBreakdown;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}) {
    // Phase 8 item (c.5)+(a.2): split LM categories from non-LM. Non-LM render
    // as horizontal bars (existing). LM categories aggregate by asset and
    // render compact step-count rows (current-week step progress, not
    // leaderboard score which is 0.0 mid-week).
    const allEntries = Object.entries(breakdown.breakdown).map(([key, data]) => ({
        key,
        label: getQuestLabel(key),
        score: data?.totalScore ?? 0,
    }));
    const nonLmEntries = allEntries.filter((e) => !e.key.startsWith('leverage_master_'));
    const maxScore = Math.max(...nonLmEntries.map((e) => Math.abs(e.score)), 1);

    // Group LM step counts by asset using the questProgress payload.
    // Asset-keyed step counts come from questProgress.byAsset; fall back to 0/0
    // when no progress data is available (legacy or fetch failure).
    const lmAssets: Array<{
        symbol: string;
        longCount: number;
        shortCount: number;
        stepTotal: number;
    }> = [];
    if (assetList?.length) {
        for (const asset of assetList) {
            const progress = breakdown.questProgress?.byAsset?.[asset.symbol];
            const stepTotal = asset.lmSteps?.length ?? 10;
            lmAssets.push({
                symbol: asset.symbol,
                longCount: progress?.longCount ?? 0,
                shortCount: progress?.shortCount ?? 0,
                stepTotal,
            });
        }
    }

    return (
        <>
            {nonLmEntries.map(({ key, label, score }) => (
                <HorizontalBar key={key} label={label} value={score} max={maxScore} color="var(--accent-primary)" />
            ))}
            {lmAssets.length > 0 && (
                <div className={styles.lmCompactGroup}>
                    <div className={styles.lmCompactHeading}>Leverage Master (current week)</div>
                    {lmAssets.map(({ symbol, longCount, shortCount, stepTotal }) => (
                        <div key={symbol} className={styles.lmCompactRow}>
                            <span className={styles.lmCompactSymbol}>{symbol}</span>
                            <span className={styles.lmCompactSide}>
                                L:{' '}
                                <span className={longCount > 0 ? styles.lmCompactCountActive : styles.lmCompactCount}>
                                    {longCount}/{stepTotal}
                                </span>
                            </span>
                            <span className={styles.lmCompactSide}>
                                S:{' '}
                                <span className={shortCount > 0 ? styles.lmCompactCountActive : styles.lmCompactCount}>
                                    {shortCount}/{stepTotal}
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

// --------------------------------------------------------------------------
// Quest Leaderboards Tab
// --------------------------------------------------------------------------

interface QuestLeaderboardsProps {
    questPeriod: QuestPeriod;
    questDate: string;
    questScores: Map<string, DailyCategoryScore[]>;
    questLoading: boolean;
    expandedRules: Set<string>;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
    onPeriodChange: (p: QuestPeriod) => void;
    onNavigateDate: (dir: number) => void;
    onToggleRules: (cat: string) => void;
    onJumpToToday: () => void;
    searchQuery: string;
    onSearch: (q: string) => void;
    searchedWallet: string | null;
    isForge: boolean;
    lmLeaderboard: LeverageMasterLeaderboard | null;
}

function QuestLeaderboards({
    questPeriod, questDate, questScores, questLoading,
    expandedRules, assetList, onPeriodChange, onNavigateDate, onToggleRules, onJumpToToday,
    searchQuery, onSearch, searchedWallet, isForge, lmLeaderboard,
}: QuestLeaderboardsProps) {
    const periodLabel = questPeriod === 'daily' ? `Day: ${questDate}`
        : questPeriod === '2day' ? `Window: ${questDate}`
        : `Week: ${questDate}`;

    const isToday = questDate === todayUTC();

    return (
        <>
            <input
                type="text"
                className={`input ${styles.searchInput}`}
                placeholder="Search by wallet address..."
                value={searchQuery}
                onChange={(e) => onSearch(e.target.value)}
            />
            <div className={styles.periodTabs}>
                {(Object.keys(PERIOD_LABELS) as QuestPeriod[]).map((p) => (
                    <button
                        key={p}
                        onClick={() => onPeriodChange(p)}
                        className={`${styles.periodTab} ${questPeriod === p ? styles.periodTabActive : ''}`}
                    >
                        {PERIOD_LABELS[p]}
                    </button>
                ))}

                <div className={styles.dateNav}>
                    <button onClick={() => onNavigateDate(-1)} className={styles.dateNavBtn}>
                        <ChevronLeft size={16} />
                    </button>
                    <span className={styles.dateLabel}>
                        {periodLabel}
                        {questDate <= todayUTC() && (
                            <span className={`${styles.dateChip} ${isToday ? styles.dateChipLive : styles.dateChipFinal}`}>
                                {isToday ? 'LIVE' : 'FINAL'}
                            </span>
                        )}
                    </span>
                    <button onClick={() => onNavigateDate(1)} className={styles.dateNavBtn}>
                        <ChevronRight size={16} />
                    </button>
                    <button
                        onClick={onJumpToToday}
                        disabled={isToday}
                        title={isToday ? 'Already on today' : 'Jump to today'}
                        className={styles.todayBtn}
                    >
                        Today
                    </button>
                </div>
            </div>

            {questLoading ? (
                <div className={styles.noData}>
                    Loading quest data...
                </div>
            ) : questPeriod === 'weekly' && assetList?.length ? (
                // Phase 8 item (c.5b) + Round 2 (LM-2 + LM-3): aggregate per-asset
                // cards. Round 2: data sourced from /api/quests/:tournamentId/leaderboard
                // (live quest_progress) instead of getDailyScores (week-boundary
                // dailyCategoryScores rows). Mid-week step progress now visible.
                assetList.map((asset) => {
                    const assetData = lmLeaderboard?.byAssetSide[asset.symbol];
                    return (
                        <LeverageMasterAssetCard
                            key={asset.symbol}
                            assetSymbol={asset.symbol}
                            longEntries={assetData?.long ?? []}
                            shortEntries={assetData?.short ?? []}
                            isRulesExpanded={expandedRules.has(`leverage_master_${asset.symbol}`)}
                            onToggleRules={() => onToggleRules(`leverage_master_${asset.symbol}`)}
                            isForge={isForge}
                            searchedWallet={searchedWallet}
                            lmSteps={asset.lmSteps}
                            lmTolerance={asset.lmTolerance}
                        />
                    );
                })
            ) : (
                getPeriodCategories(questPeriod, assetList).map((cat) => (
                    <CategoryLeaderboard
                        key={cat}
                        category={cat}
                        scores={questScores.get(cat) ?? []}
                        isRulesExpanded={expandedRules.has(cat)}
                        onToggleRules={() => onToggleRules(cat)}
                        isForge={isForge}
                        searchedWallet={searchedWallet}
                        assetListLength={assetList?.length}
                        assetList={assetList}
                    />
                ))
            )}
        </>
    );
}

// --------------------------------------------------------------------------
// Single Category Leaderboard
// --------------------------------------------------------------------------

interface CategoryLeaderboardProps {
    category: string;
    scores: DailyCategoryScore[];
    isRulesExpanded: boolean;
    onToggleRules: () => void;
    isForge: boolean;
    searchedWallet: string | null;
    assetListLength?: number;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}

function CategoryLeaderboard({ category, scores, isRulesExpanded, onToggleRules, isForge, searchedWallet, assetListLength, assetList }: CategoryLeaderboardProps) {
    // Phase 8 fix: slug parsing centralized via parseLeverageMasterSlug.
    const { side: lmSide, asset: lmAsset } = parseLeverageMasterSlug(category);
    const lmAssetConfig = lmAsset ? assetList?.find((a) => a.symbol === lmAsset) : undefined;
    const questInfo: QuestDescription | undefined = lmSide
        ? getLeverageMasterDescription(lmSide, lmAsset, lmAssetConfig?.lmSteps, lmAssetConfig?.lmTolerance)
        : QUEST_DESCRIPTIONS[category];
    const label = getQuestLabel(category);

    const fullSorted = [...scores]
        .filter((s) => !s.wallet.startsWith('__'))
        .sort((a, b) => b.score - a.score);
    const sorted = fullSorted.slice(0, 5);

    const searchedEntry = searchedWallet
        ? fullSorted.find((s) => s.wallet === searchedWallet)
        : null;
    const searchedRank = searchedEntry
        ? fullSorted.indexOf(searchedEntry) + 1
        : null;
    const searchedInTop5 = searchedRank !== null && searchedRank <= 5;
    const showRow6 = searchedWallet !== null && !searchedInTop5;

    const sampleColumns = sorted.length > 0
        ? extractQuestColumns(category, sorted[0].details, assetListLength)
        : [];

    return (
        <div className={styles.categoryCard}>
            <div className={styles.categoryHeader}>
                <div className={styles.categoryTitleRow}>
                    <h3 className={styles.categoryTitle}>{label}</h3>
                    <button onClick={onToggleRules} className={styles.rulesToggle}>
                        <Info size={12} />
                        {isRulesExpanded ? 'Hide rules' : 'Show rules'}
                    </button>
                </div>
                {questInfo && (
                    <p className={styles.categoryTagline}>{questInfo.tagline}</p>
                )}
            </div>

            {isRulesExpanded && questInfo && (
                <div className={styles.rulesPanel}>
                    <p className={styles.rulesDesc}>{questInfo.description}</p>
                    <ul className={styles.rulesList}>
                        {questInfo.rules.map((rule, i) => (
                            <li key={i}>{rule}</li>
                        ))}
                    </ul>
                </div>
            )}

            {sorted.length > 0 ? (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.thLeft} style={{ width: '60px' }}>Rank</th>
                            <th className={styles.thLeft}>Wallet</th>
                            {sampleColumns.map((col) => (
                                <th key={col.label}>{col.label}</th>
                            ))}
                            <th>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((score, idx) => {
                            const cols = extractQuestColumns(category, score.details, assetListLength);
                            const rowRankClass = rankBadgeClass(idx + 1);
                            return (
                                <tr
                                    key={score.wallet}
                                    className={score.wallet === searchedWallet ? styles.rowSearched : ''}
                                >
                                    <td className={styles.tdLeft}>
                                        <span className={`${styles.rankBadge} ${rowRankClass}`}>
                                            {idx < 3 && <Trophy size={12} />}
                                            #{idx + 1}
                                        </span>
                                    </td>
                                    <td className={styles.tdLeft}>
                                        {isForge ? (
                                            <span className={styles.walletText}>{shortWallet(score.wallet)}</span>
                                        ) : (
                                            <Link href={`/trader/${score.wallet}`} className={styles.walletLink}>
                                                {shortWallet(score.wallet)}
                                            </Link>
                                        )}
                                    </td>
                                    {cols.map((col) => (
                                        <td key={col.label}>{col.value}</td>
                                    ))}
                                    <td className={styles.finalScore}>
                                        {score.score.toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                        {showRow6 && (
                            <tr className={styles.row6Border}>
                                {searchedEntry ? (
                                    <>
                                        <td className={styles.tdLeft}>
                                            <span className={styles.row6Rank}>#{searchedRank}</span>
                                        </td>
                                        <td className={styles.tdLeft}>
                                            <span className={styles.walletText}>{shortWallet(searchedWallet!)}</span>
                                        </td>
                                        {extractQuestColumns(category, searchedEntry.details, assetListLength).map((col) => (
                                            <td key={col.label}>{col.value}</td>
                                        ))}
                                        <td className={styles.finalScore}>
                                            {searchedEntry.score.toFixed(2)}
                                        </td>
                                    </>
                                ) : (
                                    <td colSpan={2 + sampleColumns.length + 1} className={styles.row6Empty}>
                                        <span className={styles.row6EmptyWallet}>{shortWallet(searchedWallet!)}</span>
                                        — Not ranked in this category
                                    </td>
                                )}
                            </tr>
                        )}
                    </tbody>
                </table>
            ) : (
                <div className={styles.noData}>No data for this period.</div>
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// Leverage Master — Aggregated per-asset card (Phase 8 item c.5b)
//
// Shows both Long and Short ladders for one asset, side-by-side (stacks
// vertically on narrow screens). Replaces the 2 separate `CategoryLeaderboard`
// cards (one per side) per asset with a single combined card. Reduces the
// Weekly period card count from 12 (6 assets × 2 sides) to 6 (one per asset).
// --------------------------------------------------------------------------

interface LeverageMasterAssetCardProps {
    assetSymbol: string;
    longEntries: LeverageMasterLeaderboardEntry[];
    shortEntries: LeverageMasterLeaderboardEntry[];
    isRulesExpanded: boolean;
    onToggleRules: () => void;
    isForge: boolean;
    searchedWallet: string | null;
    lmSteps?: number[];
    lmTolerance?: number;
}

function LeverageMasterAssetCard({
    assetSymbol, longEntries, shortEntries,
    isRulesExpanded, onToggleRules, isForge, searchedWallet,
    lmSteps, lmTolerance,
}: LeverageMasterAssetCardProps) {
    const questInfo = getLeverageMasterDescription('long', assetSymbol, lmSteps, lmTolerance);

    return (
        <div className={styles.categoryCard}>
            <div className={styles.categoryHeader}>
                <div className={styles.categoryTitleRow}>
                    <h3 className={styles.categoryTitle}>Leverage Master {assetSymbol}</h3>
                    <button onClick={onToggleRules} className={styles.rulesToggle}>
                        <Info size={12} />
                        {isRulesExpanded ? 'Hide rules' : 'Show rules'}
                    </button>
                </div>
                {questInfo && (
                    <p className={styles.categoryTagline}>{questInfo.tagline}</p>
                )}
            </div>

            {isRulesExpanded && questInfo && (
                <div className={styles.rulesPanel}>
                    <p className={styles.rulesDesc}>{questInfo.description}</p>
                </div>
            )}

            <div className={styles.lmAssetSplitGrid}>
                <LeverageMasterSubLeaderboard
                    sideLabel="Long"
                    entries={longEntries}
                    lmSteps={lmSteps}
                    isForge={isForge}
                    searchedWallet={searchedWallet}
                />
                <LeverageMasterSubLeaderboard
                    sideLabel="Short"
                    entries={shortEntries}
                    lmSteps={lmSteps}
                    isForge={isForge}
                    searchedWallet={searchedWallet}
                />
            </div>
        </div>
    );
}

interface LeverageMasterSubLeaderboardProps {
    sideLabel: 'Long' | 'Short';
    entries: LeverageMasterLeaderboardEntry[];
    lmSteps?: number[];
    isForge: boolean;
    searchedWallet: string | null;
}

// Round 2 (LM-2 + LM-3): rewritten to consume LeverageMasterLeaderboardEntry
// from /api/quests/:tournamentId/leaderboard. Adds Progress column with
// gray-dominant badge cells per ZeDef's "what they are MISSING" preference
// (un-completed steps visually emphasized; completed pop in accent color).
// Plus Steps + Points columns matching ZeDef's mockup (B2-4).
function LeverageMasterSubLeaderboard({
    sideLabel, entries, lmSteps, isForge, searchedWallet,
}: LeverageMasterSubLeaderboardProps) {
    const top5 = entries.slice(0, 5);
    const searchedEntry = searchedWallet
        ? entries.find((e) => e.wallet === searchedWallet) ?? null
        : null;
    const searchedInTop5 = !!(searchedEntry && top5.some((e) => e.wallet === searchedEntry.wallet));
    const showRow6 = searchedEntry !== null && !searchedInTop5;

    // Per-asset step labels (e.g., [10, 20, ..., 100] for crypto, [1.5, 2, ..., 4.5]
    // for RWAs). Fallback to default crypto labels if lmSteps undefined (legacy).
    const stepLabels = lmSteps && lmSteps.length > 0
        ? lmSteps.map((v) => `${v}x`)
        : Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}x`);

    return (
        <div className={styles.lmAssetSubBoard}>
            <div className={styles.lmAssetSubHeader}>{sideLabel}</div>
            {top5.length === 0 ? (
                <p className={styles.noScoresText}>No scores yet</p>
            ) : (
                <table className={styles.lmAssetSubTable}>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Wallet</th>
                            <th>Progress</th>
                            <th>Steps</th>
                            <th>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {top5.map((e) => (
                            <LMRow
                                key={e.wallet}
                                entry={e}
                                stepLabels={stepLabels}
                                isForge={isForge}
                                isSearched={searchedWallet === e.wallet}
                            />
                        ))}
                        {showRow6 && searchedEntry && (
                            <LMRow
                                key={`searched-${searchedEntry.wallet}`}
                                entry={searchedEntry}
                                stepLabels={stepLabels}
                                isForge={isForge}
                                isSearched
                            />
                        )}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function LMRow({
    entry, stepLabels, isForge, isSearched,
}: {
    entry: LeverageMasterLeaderboardEntry;
    stepLabels: string[];
    isForge: boolean;
    isSearched: boolean;
}) {
    return (
        <tr className={isSearched ? styles.rowSearched : undefined}>
            <td>{entry.rank}</td>
            <td>
                {isForge ? (
                    <span className={styles.walletLink}>{shortWallet(entry.wallet)}</span>
                ) : (
                    <Link href={`/trader/${entry.wallet}`} className={styles.walletLink}>
                        {shortWallet(entry.wallet)}
                    </Link>
                )}
            </td>
            <td>
                <div className={styles.lmBadgeRow}>
                    {stepLabels.map((label, i) => {
                        const completed = entry.stepsCompleted[i] === true;
                        return (
                            <span
                                key={`${label}-${i}`}
                                className={`${styles.lmBadgeCell} ${completed ? styles.lmBadgeCellDone : ''}`}
                                title={`${label}${completed ? ' ✓' : ' (missing)'}`}
                            >
                                {label}
                            </span>
                        );
                    })}
                </div>
            </td>
            <td>{entry.stepCount}/{entry.stepTotal}</td>
            <td>{entry.points > 0 ? entry.points.toFixed(2) : '—'}</td>
        </tr>
    );
}

// --------------------------------------------------------------------------
// Status Badge — tournament lifecycle indicator in the Forge header
// --------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
    const config = ({
        registration: { className: styles.statusBadgeRegistration, label: 'REGISTRATION' },
        active:       { className: styles.statusBadgeActive, label: 'ACTIVE' },
        completed:    { className: styles.statusBadgeCompleted, label: 'COMPLETED' },
        cancelled:    { className: styles.statusBadgeCancelled, label: 'CANCELLED' },
    } as Record<string, { className: string; label: string }>)[status];

    if (!config) return null;

    return (
        <span className={`${styles.statusBadge} ${config.className}`}>
            {config.label}
        </span>
    );
}

// --------------------------------------------------------------------------
// Register Button — opens wallet-input modal on the Forge page
// --------------------------------------------------------------------------

function RegisterButton({ status, onClick }: {
    status: string;
    onClick: () => void;
}) {
    const isOpen = status === 'registration' || status === 'active';
    const tooltip = isOpen ? undefined : 'Registration closed';

    return (
        <button
            onClick={isOpen ? onClick : undefined}
            title={tooltip}
            disabled={!isOpen}
            className={styles.registerBtn}
        >
            <UserPlus size={14} /> Register
        </button>
    );
}

// --------------------------------------------------------------------------
// Register Modal — wallet input + submit for Forge registration
// --------------------------------------------------------------------------

function RegisterModal({
    walletInput, onWalletChange, registering, regResult, onSubmit, onClose,
}: {
    walletInput: string;
    onWalletChange: (v: string) => void;
    registering: boolean;
    regResult: { registered: boolean; reason?: string } | null;
    onSubmit: (e: React.FormEvent) => void;
    onClose: () => void;
}) {
    return (
        <div onClick={onClose} className={styles.modalOverlay}>
            <div onClick={(e) => e.stopPropagation()} className={styles.modalCard}>
                <div className={styles.modalHead}>
                    <h2 className={styles.modalTitle}>Register for The Forge</h2>
                    <button onClick={onClose} className={styles.modalCloseBtn}>
                        <CloseIcon size={20} />
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    <label className={styles.modalLabel}>
                        Solana Wallet Address
                    </label>
                    <input
                        type="text"
                        value={walletInput}
                        onChange={(e) => onWalletChange(e.target.value)}
                        placeholder="Enter your wallet..."
                        disabled={registering}
                        className={`input input--mono ${styles.modalInput}`}
                    />

                    <div className={styles.modalActions}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={registering}
                            className="btn btn--secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={registering || !walletInput.trim()}
                            className="btn btn--primary"
                        >
                            {registering ? 'Registering...' : 'Register'}
                        </button>
                    </div>
                </form>

                {regResult && (
                    <div className={`${styles.regResult} ${regResult.registered ? styles.regResultOk : styles.regResultErr}`}>
                        {regResult.registered
                            ? <><CheckCircle size={16} /> Registered! You&apos;re in the Forge.</>
                            : <><XCircle size={16} /> {regResult.reason ?? 'Registration failed'}</>
                        }
                    </div>
                )}
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// Prize Info — totals displayed in the Forge header
// --------------------------------------------------------------------------

function PrizeInfo({ prizeTable, topPercentCutoff }: {
    prizeTable: {
        totalPool: number;
        currency: string;
        skillPrizes: number[];
        rafflePrizes: number[];
    };
    topPercentCutoff?: number;
}) {
    const skillTotal = prizeTable.skillPrizes.reduce((sum, v) => sum + v, 0);
    const raffleTotal = prizeTable.rafflePrizes.reduce((sum, v) => sum + v, 0);
    const formatAmount = (n: number) => n.toLocaleString('en-US');

    return (
        <div className={styles.prizeBanner}>
            <div className={styles.prizeMain}>
                <div className={styles.prizeLabel}>Total Prize Pool</div>
                <div className={styles.prizeValue}>
                    {formatAmount(prizeTable.totalPool)} {prizeTable.currency}
                </div>
            </div>
            <div className={styles.prizeSplits}>
                <div className={styles.prizeSplit}>
                    <div className={styles.prizeSplitLabel}>
                        Top {Math.round((topPercentCutoff ?? 0.30) * 100)}% Skill
                    </div>
                    <div className={styles.prizeSplitValueSkill}>
                        {formatAmount(skillTotal)} {prizeTable.currency}
                    </div>
                </div>
                <div className={styles.prizeSplit}>
                    <div className={styles.prizeSplitLabel}>Raffle</div>
                    <div className={styles.prizeSplitValueRaffle}>
                        {formatAmount(raffleTotal)} {prizeTable.currency}
                    </div>
                </div>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// CPI Explanation — expandable "How Scoring Works" panel on the General tab
// --------------------------------------------------------------------------

function CPIExplanation() {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={styles.cpiPanel}>
            <button
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className={styles.cpiToggle}
            >
                <div className={styles.cpiToggleInner}>
                    <Info size={16} className={styles.flameIcon} style={{ flexShrink: 0 }} />
                    <div className={styles.cpiTextWrap}>
                        <div className={styles.cpiTitle}>{CPI_DESCRIPTION.title}</div>
                        {!expanded && (
                            <div className={styles.cpiTagline}>{CPI_DESCRIPTION.tagline}</div>
                        )}
                    </div>
                </div>
                {expanded
                    ? <ChevronDown size={16} className={styles.chevron} style={{ flexShrink: 0 }} />
                    : <ChevronRight size={16} className={styles.chevron} style={{ flexShrink: 0 }} />}
            </button>

            {expanded && (
                <div className={styles.cpiBody}>
                    <p className={styles.cpiPara}>{CPI_DESCRIPTION.tagline}</p>
                    {CPI_DESCRIPTION.sections.map((section) => (
                        <div key={section.heading} className={styles.cpiSection}>
                            <h4 className={styles.cpiSectionHead}>{section.heading}</h4>
                            {section.paragraph && (
                                <p className={styles.cpiPara}>{section.paragraph}</p>
                            )}
                            {section.items && (
                                <ul className={styles.cpiList}>
                                    {section.items.map((item, i) => (
                                        <li key={i} className={styles.cpiListItem}>{item}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
