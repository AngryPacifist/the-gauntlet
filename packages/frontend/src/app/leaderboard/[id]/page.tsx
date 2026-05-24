'use client';

// ============================================================================
// Per-Tournament Leaderboard.
//
// Note: parseLeverageMasterSlug centralizes parsing of `leverage_master_*`
// slugs. Do NOT inline that regex back; it has accumulated defensive
// edge-case behavior.
// ============================================================================

import { useState, useEffect, use, useCallback, useMemo } from 'react';
import {
    getForgeLeaderboard,
    getTournament,
    getWalletBreakdown,
    getDailyScores,
    getLeverageMasterLeaderboard,
    getTokenUSDPrices,
    getPayouts,
    registerWallet,
    type ForgeLeaderboard,
    type ForgeEntry,
    type WalletBreakdown,
    type DailyCategoryScore,
    type CategorySlug,
    type LeverageMasterLeaderboard,
    type LeverageMasterMergedEntry,
    type TournamentState,
    type TokenUSDPrice,
    type PayoutRow,
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
import { Tooltip } from '@/components/Tooltip';
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

// Single source of truth for parsing leverage_master_* category slugs.
// Schema: 'leverage_master_<ASSET>_<SIDE>' (per-asset) | 'leverage_master_<SIDE>' (legacy).
// Returns { side, asset } where asset is undefined for legacy slugs OR if the captured
// asset literally equals 'long'/'short' (defensive: preserves the malformed-input
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

// Returns human label for a category slug.
// Parsing logic is delegated to parseLeverageMasterSlug for consistency.
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

// PERIOD_CATEGORIES.weekly is per-asset when assetList is populated.
// Legacy fallback (undefined/empty assetList) → static 2-slug list for older data.
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

function shortWallet(wallet: string): string {
    return wallet.slice(0, 4) + '...' + wallet.slice(-4);
}

// --------------------------------------------------------------------------
// Multi-token prize helpers.
//
// resolveTokens: extract the tokens[] array from a prizeTable, synthesizing
// a single-sponsor virtual entry from legacy { currency, totalPool } when
// `tokens` is absent (single-currency fallback). Return type matches the
// full schema (mint? + staticUsdPrice?) so callers can pass directly to
// getTokenUSDPrices.
// --------------------------------------------------------------------------
type ResolvedToken = {
    sponsor: string;
    symbol: string;
    amount: number;
    mint?: string;
    staticUsdPrice?: number;
};

function resolveTokens(prizeTable: NonNullable<ForgeLeaderboard['tournament']['config']['prizeTable']>):
    ResolvedToken[] {
    if (prizeTable.tokens && prizeTable.tokens.length > 0) return prizeTable.tokens;
    return [{
        sponsor: 'Adrena',
        symbol: prizeTable.currency,
        amount: prizeTable.totalPool,
    }];
}

function formatTokenAmount(amount: number, symbol: string): string {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}`;
}

function formatUSD(value: number): string {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
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
            const entry = d.longEntry as { proximity: number; roi: number; status?: string } | null;
            const pairs = [
                { label: 'Bottom Accuracy', value: entry ? `${(entry.proximity * 100).toFixed(2)}%` : '-' },
                { label: 'ROI', value: entry ? `${(entry.roi * 100).toFixed(2)}%` : '-' },
            ];
            if (entry?.status === 'open') {
                pairs.push({ label: 'Status', value: 'OPEN: close to score' });
            }
            return pairs;
        }
        case 'top_tick_traveler': {
            const entry = d.shortEntry as { proximity: number; roi: number; status?: string } | null;
            const pairs = [
                { label: 'Top Accuracy', value: entry ? `${(entry.proximity * 100).toFixed(2)}%` : '-' },
                { label: 'ROI', value: entry ? `${(entry.roi * 100).toFixed(2)}%` : '-' },
            ];
            if (entry?.status === 'open') {
                pairs.push({ label: 'Status', value: 'OPEN: close to score' });
            }
            return pairs;
        }
        case 'risk_manager':
        case 'humble_one': {
            const trade = d.bestTrade as { roi: number } | null;
            return [
                { label: 'ROI', value: trade ? `${(trade.roi * 100).toFixed(2)}%` : '-' },
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

// Extend skillPrizes via geometric decay so K > skillPrizes.length fields
// still distribute the full pool to all top% wallets. Decay ratio is derived
// from the curve's existing tail (last two values' ratio), clamped to (0, 1]
// to prevent curve inversion when admin configures a non-monotonic curve.
// Floor at 1 prevents underflow at very large K (cumulative decay can
// produce sub-1 values; we want every slot non-zero). At K ≤ skillPrizes
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
    // tournamentState is fetched in parallel with the forge leaderboard for
    // completed/cancelled tournaments; its rounds[].endTime drives the
    // Quest-Leaderboards date-navigator cap so users don't land on or navigate
    // to post-tournament dates that show empty or partial-day data.
    const [tournamentState, setTournamentState] = useState<TournamentState | null>(null);
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
    // Live LM leaderboard from quest_progress (not week-boundary). Drives the
    // Quest Leaderboards Weekly tab so step progress shows mid-week, matching
    // the expanded-row LM display.
    const [lmLeaderboard, setLmLeaderboard] = useState<LeverageMasterLeaderboard | null>(null);

    // Registration modal state
    const [showRegModal, setShowRegModal] = useState(false);
    const [walletInput, setWalletInput] = useState('');
    const [registering, setRegistering] = useState(false);
    const [regResult, setRegResult] = useState<{ registered: boolean; reason?: string } | null>(null);

    useEffect(() => {
        async function load() {
            try {
                // Parallel-fetch the forge leaderboard + tournament state (rounds[].endTime
                // powers the post-completion date-navigator cap; the second fetch is fire-and-
                // forget for active tournaments and just slightly delays the page render for
                // completed ones). Promise.all so a single network roundtrip in practice.
                const [result, tstate] = await Promise.all([
                    getForgeLeaderboard(tournamentId),
                    getTournament(tournamentId),
                ]);
                setData(result);
                setTournamentState(tstate);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [tournamentId]);

    // Max date the Quest-Leaderboards navigator should allow.
    // For active tournaments: today. For completed/cancelled:
    // (round endTime UTC date - 1 day) = last full UTC day of trading. Hides
    // partial-end-day fragments + empty Week N+1 from the navigator entirely.
    const maxQuestDate = useMemo(() => {
        const today = todayUTC();
        if (!tournamentState) return today;
        const status = tournamentState.status;
        if (status !== 'completed' && status !== 'cancelled') return today;
        const mainRound = tournamentState.rounds.find((r) => r.type === 'main');
        if (!mainRound) return today;
        const endDate = new Date(mainRound.endTime);
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        return formatDate(endDate);
    }, [tournamentState]);

    // Snap initial questDate to the cap when the tournament-state load reveals
    // a completed/cancelled tournament. Only fires once on the null → loaded
    // transition so user navigation isn't overridden afterward.
    useEffect(() => {
        if (tournamentState && maxQuestDate < todayUTC()) {
            setQuestDate(maxQuestDate);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tournamentState]);

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

    // Fetch live LM leaderboard for the Weekly tab.
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
            // Also fetch live LM leaderboard when Weekly tab is active.
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
            return next > maxQuestDate ? maxQuestDate : next;
        });
    }

    function jumpToToday() {
        setQuestDate(maxQuestDate);
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
                {/* PrizeInfo header renders on BOTH Forge and Gauntlet
                   tournaments, since Gauntlet is also a prized contest with
                   the same topPercentCutoff semantics. Splits inside PrizeInfo
                   conditionally render per weight (Skill / Raffle hidden
                   when their respective weight is 0). */}
                {data.tournament.config.prizeTable && (
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

            {/* Fallen Fighters info: shown for bracket tournaments */}
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
                    tournamentId={tournamentId}
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
                    tournamentStatus={data.tournament.status}
                    maxQuestDate={maxQuestDate}
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
    tournamentId: number;
    entries: ForgeEntry[];
    expandedWallet: string | null;
    breakdown: WalletBreakdown | null;
    breakdownLoading: boolean;
    searchQuery: string;
    onSearch: (q: string) => void;
    onToggle: (wallet: string) => void;
    isForge: boolean;
    prizeTable?: NonNullable<ForgeLeaderboard['tournament']['config']['prizeTable']>;
    topPercentCutoff?: number;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}

function GeneralLeaderboard({
    tournamentId, entries, expandedWallet, breakdown, breakdownLoading,
    searchQuery, onSearch, onToggle, isForge, prizeTable, topPercentCutoff, assetList,
}: GeneralLeaderboardProps) {
    // Per-rank token amounts. Map<rank, perWalletTokens[]>. USD is computed live
    // in PrizeCellMultiToken from tokens × usdPrices (don't store stale USD here;
    // tokens are amount-denominated, USD is a derived view that updates per
    // Pyth/Jupiter/static poll).
    const prizesByRank = useMemo<Map<number, Array<{ symbol: string; amount: number }>>>(() => {
        const map = new Map<number, Array<{ symbol: string; amount: number }>>();
        if (!prizeTable) return map;

        const tokens = resolveTokens(prizeTable);
        const totalWeight = prizeTable.skillPrizes.reduce((a, b) => a + b, 0)
                          + prizeTable.rafflePrizes.reduce((a, b) => a + b, 0);
        const skillWeight = prizeTable.skillPrizes.reduce((a, b) => a + b, 0);
        if (totalWeight === 0) return map;

        // Pro-rata scale + geometric-decay extension so every top% wallet gets
        // a non-zero share. Each rank gets a fraction of totalWeight, applied
        // to every token.
        const rankCounts = new Map<number, number>();
        for (const e of entries) {
            if (!e.isTopPercent) continue;
            rankCounts.set(e.rank, (rankCounts.get(e.rank) ?? 0) + 1);
        }
        const totalTopCount = Array.from(rankCounts.values()).reduce((a, b) => a + b, 0);
        const extendedPrizes = extendSkillPrizes(prizeTable.skillPrizes, totalTopCount);
        const usedWeights = extendedPrizes.slice(0, totalTopCount).reduce((a, b) => a + b, 0);
        const scale = usedWeights > 0 ? skillWeight / usedWeights : 1;

        for (const [rank, count] of rankCounts) {
            let sumWeights = 0;
            for (let i = 0; i < count; i++) {
                sumWeights += extendedPrizes[rank - 1 + i] ?? 0;
            }
            const rankWeightShare = (sumWeights * scale) / count / totalWeight;  // fraction of totalWeight per wallet at this rank
            const perWallet = tokens.map((t) => ({ symbol: t.symbol, amount: rankWeightShare * t.amount }));
            map.set(rank, perWallet);
        }
        return map;
    }, [entries, prizeTable]);

    // Dedupe price-fetch tokens by symbol (first-occurrence wins for mint +
    // staticUsdPrice). Multi-sponsor tournaments with the same token query
    // Pyth/Jupiter once.
    const tokens = useMemo(() => prizeTable ? resolveTokens(prizeTable) : [], [prizeTable]);
    const priceFetchTokens = useMemo(() => {
        const seen = new Map<string, { symbol: string; mint?: string; staticUsdPrice?: number }>();
        for (const t of tokens) {
            if (!seen.has(t.symbol)) {
                seen.set(t.symbol, { symbol: t.symbol, mint: t.mint, staticUsdPrice: t.staticUsdPrice });
            }
        }
        return Array.from(seen.values());
    }, [tokens]);
    const [usdPrices, setUsdPrices] = useState<Record<string, TokenUSDPrice> | null>(null);
    useEffect(() => {
        if (priceFetchTokens.length === 0) return;
        let cancelled = false;
        getTokenUSDPrices(priceFetchTokens)
            .then((p) => { if (!cancelled) setUsdPrices(p); })
            .catch(() => { if (!cancelled) setUsdPrices(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(priceFetchTokens)]);

    // Fetch payouts.rows to surface raffle prizes on the leaderboard PRIZE
    // column. Skill rows derive from prizesByRank above (live); we pull only
    // raffle rows from /payouts. Pre-draw: /payouts returns no raffle rows →
    // rafflePrizesByWallet stays empty → raffle-tier wallets render `—`
    // (current behavior preserved).
    const [rafflePayoutRows, setRafflePayoutRows] = useState<PayoutRow[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        getPayouts(tournamentId)
            .then((p) => {
                if (cancelled) return;
                setRafflePayoutRows(p.rows.filter((r) => r.category === 'raffle'));
            })
            .catch(() => {
                if (!cancelled) setRafflePayoutRows(null);
            });
        return () => { cancelled = true; };
    }, [tournamentId]);

    const rafflePrizesByWallet = useMemo(() => {
        const map = new Map<string, { drawPosition: number; tokens: Array<{ symbol: string; amount: number }> }>();
        if (!rafflePayoutRows) return map;
        for (const r of rafflePayoutRows) {
            if (r.drawPosition == null) continue;  // defensive: raffle rows always have drawPosition
            map.set(r.wallet, {
                drawPosition: r.drawPosition,
                tokens: r.tokens.map((t) => ({ symbol: t.symbol, amount: t.amount })),
            });
        }
        return map;
    }, [rafflePayoutRows]);

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
                                rafflePrizesByWallet={rafflePrizesByWallet}
                                usdPrices={usdPrices}
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
// Forge Row: expandable with CPI + quest breakdown bars
// --------------------------------------------------------------------------

interface ForgeRowProps {
    entry: ForgeEntry;
    isExpanded: boolean;
    onToggle: () => void;
    breakdown: WalletBreakdown | null;
    breakdownLoading: boolean;
    isForge: boolean;
    prizeTable?: NonNullable<ForgeLeaderboard['tournament']['config']['prizeTable']>;
    prizesByRank: Map<number, Array<{ symbol: string; amount: number }>>;
    rafflePrizesByWallet: Map<string, { drawPosition: number; tokens: Array<{ symbol: string; amount: number }> }>;
    usdPrices: Record<string, TokenUSDPrice> | null;
    topPercentCutoff?: number;
    assetList?: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}

function ForgeRow({
    entry, isExpanded, onToggle, breakdown, breakdownLoading, isForge,
    prizeTable, prizesByRank, rafflePrizesByWallet, usdPrices,
    topPercentCutoff, assetList,
}: ForgeRowProps) {
    const rankClass = rankBadgeClass(entry.rank);
    // 3-way prize column branch.
    const skillTokens = entry.isTopPercent && prizeTable ? prizesByRank.get(entry.rank) : undefined;
    const raffleEntry = !entry.isTopPercent ? rafflePrizesByWallet.get(entry.wallet) : undefined;

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
                    {skillTokens
                        ? <PrizeCellMultiToken tokens={skillTokens} usdPrices={usdPrices} />
                        : raffleEntry
                            ? <PrizeCellMultiToken
                                tokens={raffleEntry.tokens}
                                usdPrices={usdPrices}
                                drawPosition={raffleEntry.drawPosition} />
                            : '-'}
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
                                            <HorizontalBar
                                                key={key}
                                                label={label}
                                                value={entry[key as keyof ForgeEntry] as number}
                                                max={100}
                                                color={color}
                                            />
                                        ))}
                                    </div>
                                    <div>
                                        <h4 className={styles.breakdownHeading}>Trader Statistics</h4>
                                        <TraderStatisticsPanel cpiDetails={breakdown?.cpiDetails ?? null} />
                                    </div>
                                    <div>
                                        <h4 className={styles.breakdownHeading}>Category Scores</h4>
                                        {breakdown ? (
                                            <QuestBreakdownBars breakdown={breakdown} />
                                        ) : (
                                            <p className={styles.breakdownEmpty}>No quest data available.</p>
                                        )}
                                    </div>
                                    {breakdown && assetList && assetList.length > 0 && (
                                        <LeverageMasterBreakdown
                                            questProgress={breakdown.questProgress}
                                            assetList={assetList}
                                        />
                                    )}
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
// Trader Statistics Panel
//
// Consolidates ROI / Liquidations · Max DD / Profitable Days · Win Rate /
// Trades · Volume into a dedicated middle panel in the expanded row.
//
// Empty state (cpiDetails === null): renders 4 '—' placeholder rows so the
// panel still has shape. All-zero trade counts: renders the literal zeros
// (truthful for new wallets with no activity).
// --------------------------------------------------------------------------

function formatVolume(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(0);
}

function TraderStatisticsPanel({ cpiDetails }: {
    cpiDetails: WalletBreakdown['cpiDetails'];
}) {
    if (!cpiDetails) {
        return (
            <div className={styles.traderStatsPanel}>
                <div className={styles.traderStatRow}>
                    <span className={styles.traderStatLabel}>ROI</span>
                    <span className={styles.traderStatValue}>-</span>
                </div>
                <div className={styles.traderStatRow}>
                    <span className={styles.traderStatLabel}>Liquidations · Max DD</span>
                    <span className={styles.traderStatValue}>-</span>
                </div>
                <div className={styles.traderStatRow}>
                    <span className={styles.traderStatLabel}>Profitable Days · Win Rate</span>
                    <span className={styles.traderStatValue}>-</span>
                </div>
                <div className={styles.traderStatRow}>
                    <span className={styles.traderStatLabel}>Trades · Volume</span>
                    <span className={styles.traderStatValue}>-</span>
                </div>
            </div>
        );
    }
    const winRate = cpiDetails.totalClosedTrades > 0
        ? `${((cpiDetails.winningTrades / cpiDetails.totalClosedTrades) * 100).toFixed(0)}%`
        : '-';
    return (
        <div className={styles.traderStatsPanel}>
            <div className={styles.traderStatRow}>
                <span className={styles.traderStatLabel}>ROI</span>
                <span className={styles.traderStatValue}>{(cpiDetails.roi * 100).toFixed(2)}%</span>
            </div>
            <div className={styles.traderStatRow}>
                <span className={styles.traderStatLabel}>Liquidations · Max DD</span>
                <span className={styles.traderStatValue}>
                    {cpiDetails.liquidatedCount}/{cpiDetails.totalCount} · {(cpiDetails.drawdownRatio * 100).toFixed(2)}%
                </span>
            </div>
            <div className={styles.traderStatRow}>
                <span className={styles.traderStatLabel}>Profitable Days · Win Rate</span>
                <span className={styles.traderStatValue}>
                    {cpiDetails.profitableDays}/{cpiDetails.totalTradingDays} · {winRate}
                </span>
            </div>
            <div className={styles.traderStatRow}>
                <span className={styles.traderStatLabel}>Trades · Volume</span>
                <span className={styles.traderStatValue}>
                    {cpiDetails.tradeCount} · ${formatVolume(cpiDetails.totalVolume)}
                </span>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// Quest Breakdown Bars (inside expanded row)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// LM Split-Background Grid
//
// Renders one cell per leverage step with a two-tone background:
//   - left half = green when Long achieved at that step
//   - right half = red when Short achieved
//   - grey when neither
// Used by BOTH the General Leaderboard expanded row AND the Weekly tab
// merged-row table. Inline component by design; both consumers live in
// this same file.
// --------------------------------------------------------------------------
function LMSplitBgGrid({
    stepLabels, stepsCompletedLong, stepsCompletedShort,
}: {
    stepLabels: string[];
    stepsCompletedLong: boolean[];
    stepsCompletedShort: boolean[];
}) {
    return (
        <div className={styles.lmSplitBgRow}>
            {stepLabels.map((label, i) => {
                const longDone = stepsCompletedLong[i] === true;
                const shortDone = stepsCompletedShort[i] === true;
                const cls = [
                    styles.lmSplitBgCell,
                    longDone ? styles.lmSplitBgCellLongDone : '',
                    shortDone ? styles.lmSplitBgCellShortDone : '',
                ].filter(Boolean).join(' ');
                const titleParts: string[] = [];
                if (longDone) titleParts.push('Long ✓');
                if (shortDone) titleParts.push('Short ✓');
                const tooltipText = titleParts.length > 0 ? `${label}: ${titleParts.join(', ')}` : `${label} (none)`;
                return (
                    <Tooltip key={`${label}-${i}`} content={tooltipText}>
                        <span className={cls}>
                            <span className={styles.lmSplitBgCellLabel}>{label}</span>
                        </span>
                    </Tooltip>
                );
            })}
        </div>
    );
}

function QuestBreakdownBars({ breakdown }: { breakdown: WalletBreakdown }) {
    // Non-LM categories only; LM moved to LeverageMasterBreakdown so it can
    // span the full breakdownGrid width (step cells need room to fit one
    // row per asset).
    const allEntries = Object.entries(breakdown.breakdown).map(([key, data]) => ({
        key,
        label: getQuestLabel(key),
        score: data?.totalScore ?? 0,
    }));
    const nonLmEntries = allEntries.filter((e) => !e.key.startsWith('leverage_master_'));
    const maxScore = Math.max(...nonLmEntries.map((e) => Math.abs(e.score)), 1);

    return (
        <>
            {nonLmEntries.map(({ key, label, score }) => (
                <HorizontalBar key={key} label={label} value={score} max={maxScore} color="var(--accent-primary)" />
            ))}
        </>
    );
}

// --------------------------------------------------------------------------
// Leverage Master Breakdown (full-width row in expanded breakdownGrid)
//
// Renders the per-asset LM progress strip. Lives outside QuestBreakdownBars
// so it can occupy a row of its own in the grid (grid-column: 1 / -1 via
// .lmExpandedGroup), giving each asset's step cells the horizontal room to
// stay on one line instead of wrapping inside a narrow column.
// --------------------------------------------------------------------------
function LeverageMasterBreakdown({
    questProgress, assetList,
}: {
    questProgress: WalletBreakdown['questProgress'];
    assetList: Array<{ symbol: string; lmSteps?: number[]; lmTolerance?: number }>;
}) {
    type LmAsset = {
        symbol: string;
        stepLabels: string[];
        longCount: number;
        shortCount: number;
        stepTotal: number;
        long: boolean[];
        short: boolean[];
    };
    const lmAssets: LmAsset[] = [];
    for (const asset of assetList) {
        const progress = questProgress?.byAsset?.[asset.symbol];
        const stepTotal = asset.lmSteps?.length ?? 10;
        const stepLabels = asset.lmSteps && asset.lmSteps.length > 0
            ? asset.lmSteps.map((v) => `${v}x`)
            : Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}x`);
        lmAssets.push({
            symbol: asset.symbol,
            stepLabels,
            longCount: progress?.longCount ?? 0,
            shortCount: progress?.shortCount ?? 0,
            stepTotal,
            long: progress?.long ?? new Array(stepTotal).fill(false),
            short: progress?.short ?? new Array(stepTotal).fill(false),
        });
    }

    return (
        <div className={styles.lmExpandedGroup}>
            <div className={styles.lmExpandedHeading}>Leverage Master (current week)</div>
            {lmAssets.map((a) => (
                <div key={a.symbol} className={styles.lmExpandedRow}>
                    <div className={styles.lmExpandedRowHeader}>
                        <span className={styles.lmExpandedSymbol}>{a.symbol}</span>
                        <span className={styles.lmExpandedCounter}>
                            L <span className={a.longCount > 0 ? styles.lmCounterActive : ''}>{a.longCount}/{a.stepTotal}</span>
                            {' · '}
                            S <span className={a.shortCount > 0 ? styles.lmCounterActive : ''}>{a.shortCount}/{a.stepTotal}</span>
                        </span>
                    </div>
                    <LMSplitBgGrid stepLabels={a.stepLabels} stepsCompletedLong={a.long} stepsCompletedShort={a.short} />
                </div>
            ))}
        </div>
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
    tournamentStatus: string;
    maxQuestDate: string;
}

function QuestLeaderboards({
    questPeriod, questDate, questScores, questLoading,
    expandedRules, assetList, onPeriodChange, onNavigateDate, onToggleRules, onJumpToToday,
    searchQuery, onSearch, searchedWallet, isForge, lmLeaderboard, tournamentStatus, maxQuestDate,
}: QuestLeaderboardsProps) {
    const periodLabel = questPeriod === 'daily' ? `Day: ${questDate}`
        : questPeriod === '2day' ? `Window: ${questDate}`
        : `Week: ${questDate}`;

    const isToday = questDate === todayUTC();
    // Chip says LIVE only when the date is today AND the tournament is still
    // scoring. Without this status gate, the chip kept saying LIVE on today's
    // view even after a tournament went 'completed' (scheduler scoring stops
    // on status flip; chip was unaware).
    const isLive = isToday && tournamentStatus === 'active';
    // For completed/cancelled tournaments the rightmost reachable date is
    // maxQuestDate (= round endDate - 1 day). For active tournaments
    // maxQuestDate === todayUTC() so semantics are unchanged.
    const isAtMax = questDate === maxQuestDate;
    const isCompleted = tournamentStatus === 'completed' || tournamentStatus === 'cancelled';
    const todayBtnLabel = isCompleted ? 'Latest' : 'Today';

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
                            <span className={`${styles.dateChip} ${isLive ? styles.dateChipLive : styles.dateChipFinal}`}>
                                {isLive ? 'LIVE' : 'FINAL'}
                            </span>
                        )}
                    </span>
                    <button onClick={() => onNavigateDate(1)} className={styles.dateNavBtn}>
                        <ChevronRight size={16} />
                    </button>
                    <Tooltip content={isAtMax ? `Already on ${todayBtnLabel.toLowerCase()}` : `Jump to ${todayBtnLabel.toLowerCase()}`}>
                        <button
                            onClick={onJumpToToday}
                            disabled={isAtMax}
                            className={styles.todayBtn}
                        >
                            {todayBtnLabel}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {questLoading ? (
                <div className={styles.noData}>
                    Loading quest data...
                </div>
            ) : questPeriod === 'weekly' && assetList?.length ? (
                // Aggregate per-asset cards. Data sourced from
                // /api/quests/:tournamentId/leaderboard (live quest_progress) instead
                // of getDailyScores (week-boundary dailyCategoryScores rows).
                // Mid-week step progress is visible.
                assetList.map((asset) => {
                    const entries = lmLeaderboard?.byAsset[asset.symbol] ?? [];
                    return (
                        <LeverageMasterAssetCard
                            key={asset.symbol}
                            assetSymbol={asset.symbol}
                            entries={entries}
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
    // Slug parsing is centralized via parseLeverageMasterSlug.
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
                                        : Not ranked in this category
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
// Leverage Master: Merged per-asset card.
//
// One table per asset showing both Long + Short progression per wallet in
// a single row. Progress column uses split-background cells (green = Long,
// red = Short, grey = neither).
// --------------------------------------------------------------------------

interface LeverageMasterAssetCardProps {
    assetSymbol: string;
    entries: LeverageMasterMergedEntry[];
    isRulesExpanded: boolean;
    onToggleRules: () => void;
    isForge: boolean;
    searchedWallet: string | null;
    lmSteps?: number[];
    lmTolerance?: number;
}

function LeverageMasterAssetCard({
    assetSymbol, entries,
    isRulesExpanded, onToggleRules, isForge, searchedWallet,
    lmSteps, lmTolerance,
}: LeverageMasterAssetCardProps) {
    const questInfo = getLeverageMasterDescription('long', assetSymbol, lmSteps, lmTolerance);
    const top5 = entries.slice(0, 5);
    const searchedEntry = searchedWallet
        ? entries.find((e) => e.wallet === searchedWallet) ?? null
        : null;
    const searchedInTop5 = !!(searchedEntry && top5.some((e) => e.wallet === searchedEntry.wallet));
    const showRow6 = searchedEntry !== null && !searchedInTop5;
    const stepLabels = lmSteps && lmSteps.length > 0
        ? lmSteps.map((v) => `${v}x`)
        : Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}x`);

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

            {top5.length === 0 ? (
                <div className={styles.noScoresText} style={{ padding: 'var(--space-md)' }}>No scores yet</div>
            ) : (
                <table className={styles.lmMergedTable}>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Wallet</th>
                            <th>Progress (L · S per step)</th>
                            <th>Steps</th>
                            <th>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {top5.map((e) => (
                            <LMMergedRow
                                key={e.wallet}
                                entry={e}
                                stepLabels={stepLabels}
                                isForge={isForge}
                                isSearched={searchedWallet === e.wallet}
                            />
                        ))}
                        {showRow6 && searchedEntry && (
                            <LMMergedRow
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

function LMMergedRow({
    entry, stepLabels, isForge, isSearched,
}: {
    entry: LeverageMasterMergedEntry;
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
                <LMSplitBgGrid
                    stepLabels={stepLabels}
                    stepsCompletedLong={entry.stepsCompletedLong}
                    stepsCompletedShort={entry.stepsCompletedShort}
                />
            </td>
            <td className={styles.lmMergedCounterCell}>
                L <span className={entry.longCount > 0 ? styles.lmCounterActive : ''}>{entry.longCount}/{entry.stepTotal}</span>
                {' · '}
                S <span className={entry.shortCount > 0 ? styles.lmCounterActive : ''}>{entry.shortCount}/{entry.stepTotal}</span>
            </td>
            <td className={styles.finalScore}>
                {entry.totalPoints > 0 ? entry.totalPoints.toFixed(2) : '-'}
            </td>
        </tr>
    );
}

// --------------------------------------------------------------------------
// Status Badge: tournament lifecycle indicator in the Forge header.
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
// Register Button: opens wallet-input modal on the Forge page.
// --------------------------------------------------------------------------

function RegisterButton({ status, onClick }: {
    status: string;
    onClick: () => void;
}) {
    const isOpen = status === 'registration' || status === 'active';
    const tooltip = isOpen ? undefined : 'Registration closed';

    return (
        <Tooltip content={tooltip}>
            <button
                onClick={isOpen ? onClick : undefined}
                disabled={!isOpen}
                className={styles.registerBtn}
            >
                <UserPlus size={14} /> Register
            </button>
        </Tooltip>
    );
}

// --------------------------------------------------------------------------
// Register Modal: wallet input + submit for Forge registration.
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
// Prize Info: multi-token header for Forge + Gauntlet.
// --------------------------------------------------------------------------
//
// Renders: USD live total + "Sponsored by X · Y" + "Distributed in ADX, JTO" +
// per-split (Skill / Raffle) USD breakdowns. Each split is conditional on
// its respective weight > 0 (hides $0 Raffle on skill-only configs).
//
// USD is computed live via the Pyth → Jupiter → admin static cascade.
// If all sources fail for a token, that token contributes 0 to the USD
// total but its token amount + sponsor still display in the tooltip.

function PrizeInfo({ prizeTable, topPercentCutoff }: {
    prizeTable: NonNullable<ForgeLeaderboard['tournament']['config']['prizeTable']>;
    topPercentCutoff?: number;
}) {
    const tokens = resolveTokens(prizeTable);
    // Dedupe by symbol: first-occurrence wins for mint + static.
    const priceFetchTokens = useMemo(() => {
        const seen = new Map<string, { symbol: string; mint?: string; staticUsdPrice?: number }>();
        for (const t of tokens) {
            if (!seen.has(t.symbol)) {
                seen.set(t.symbol, { symbol: t.symbol, mint: t.mint, staticUsdPrice: t.staticUsdPrice });
            }
        }
        return Array.from(seen.values());
    }, [tokens]);
    const symbols = useMemo(() => priceFetchTokens.map((t) => t.symbol), [priceFetchTokens]);
    const [usdPrices, setUsdPrices] = useState<Record<string, TokenUSDPrice> | null>(null);

    useEffect(() => {
        let cancelled = false;
        getTokenUSDPrices(priceFetchTokens)
            .then((p) => { if (!cancelled) setUsdPrices(p); })
            .catch(() => { if (!cancelled) setUsdPrices(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(priceFetchTokens)]);

    // Compute weight + USD totals.
    const skillWeight = prizeTable.skillPrizes.reduce((a, b) => a + b, 0);
    const raffleWeight = prizeTable.rafflePrizes.reduce((a, b) => a + b, 0);
    const totalWeight = skillWeight + raffleWeight;
    const skillFrac = totalWeight > 0 ? skillWeight / totalWeight : 0;
    const raffleFrac = totalWeight > 0 ? raffleWeight / totalWeight : 0;

    const totalUSD = tokens.reduce((sum, t) => {
        const p = usdPrices?.[t.symbol]?.usd;
        return sum + (p !== null && p !== undefined ? t.amount * p : 0);
    }, 0);
    const skillUSD = totalUSD * skillFrac;
    const raffleUSD = totalUSD * raffleFrac;

    // Sponsor + symbol summaries.
    const sponsors = useMemo(() => Array.from(new Set(tokens.map((t) => t.sponsor))), [tokens]);
    const sponsorsDisplay = sponsors.length <= 4
        ? sponsors.join(' · ')
        : `${sponsors.slice(0, 3).join(' · ')} · +${sponsors.length - 3} more`;
    const symbolsDisplay = symbols.join(', ');

    const tokenBreakdown = tokens
        .map((t) => `${t.sponsor}: ${formatTokenAmount(t.amount, t.symbol)}`)
        .join('\n');

    return (
        <div className={styles.prizeBanner}>
            <div className={styles.prizeMain}>
                <div className={styles.prizeLabel}>Total Prize Pool</div>
                <Tooltip content={tokenBreakdown}>
                    <div className={styles.prizeValue}>
                        {usdPrices ? formatUSD(totalUSD) : '-'}
                    </div>
                </Tooltip>
                <div className={styles.prizeSubtitle}>Sponsored by {sponsorsDisplay}</div>
                <div className={styles.prizeSubtitle}>Distributed in {symbolsDisplay}</div>
            </div>
            <div className={styles.prizeSplits}>
                {/* Conditionally render each split based on its weight. Forge
                    tournaments typically have both skill + raffle; Gauntlet
                    tournaments often have skill-only. Hiding the empty split
                    avoids "$0 Raffle" wart on Gauntlet. */}
                {skillWeight > 0 && (
                    <div className={styles.prizeSplit}>
                        <div className={styles.prizeSplitLabel}>
                            Top {Math.round((topPercentCutoff ?? 0.30) * 100)}% Skill
                        </div>
                        <Tooltip content={`${formatUSD(skillUSD)} (${(skillFrac * 100).toFixed(0)}% of pool)`}>
                            <div className={styles.prizeSplitValueSkill}>
                                {usdPrices ? formatUSD(skillUSD) : '-'}
                            </div>
                        </Tooltip>
                    </div>
                )}
                {raffleWeight > 0 && (
                    <div className={styles.prizeSplit}>
                        <div className={styles.prizeSplitLabel}>Raffle</div>
                        <Tooltip content={`${formatUSD(raffleUSD)} (${(raffleFrac * 100).toFixed(0)}% of pool)`}>
                            <div className={styles.prizeSplitValueRaffle}>
                                {usdPrices ? formatUSD(raffleUSD) : '-'}
                            </div>
                        </Tooltip>
                    </div>
                )}
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// PrizeCellMultiToken: per-row PRIZE column for both skill + raffle.
//
// Renders USD live + token-breakdown tooltip. For raffle rows, `drawPosition`
// is provided so the tooltip prefixes "Raffle slot #N". If usdPrices is
// still loading or `tokens` is empty, renders `—`.
// --------------------------------------------------------------------------
function PrizeCellMultiToken({
    tokens, usdPrices, drawPosition,
}: {
    tokens: Array<{ symbol: string; amount: number }> | undefined;
    usdPrices: Record<string, TokenUSDPrice> | null;
    drawPosition?: number;
}) {
    if (!tokens || tokens.length === 0) return <>-</>;
    const usd = tokens.reduce((s, t) => {
        const p = usdPrices?.[t.symbol]?.usd;
        return s + (p !== null && p !== undefined ? t.amount * p : 0);
    }, 0);
    const breakdownParts = tokens.map((t) => formatTokenAmount(t.amount, t.symbol));
    if (drawPosition !== undefined) breakdownParts.unshift(`Raffle slot #${drawPosition}`);
    const breakdown = breakdownParts.join('\n');
    return (
        <Tooltip content={breakdown}>
            <span>
                {usdPrices ? formatUSD(usd) : '-'}
            </span>
        </Tooltip>
    );
}

// --------------------------------------------------------------------------
// CPI Explanation: expandable "How Scoring Works" panel on the General tab.
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
