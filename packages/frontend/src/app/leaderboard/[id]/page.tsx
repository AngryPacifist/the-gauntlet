'use client';

import { useState, useEffect, use, useCallback, useMemo } from 'react';
import {
    getForgeLeaderboard,
    getWalletBreakdown,
    getDailyScores,
    registerWallet,
    type ForgeLeaderboard,
    type ForgeEntry,
    type WalletBreakdown,
    type DailyCategoryScore,
    type CategorySlug,
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

// Phase 4 item 30: returns human label for a category slug.
// Handles the 5 non-LM + 2 legacy LM slugs from QUEST_LABELS above,
// plus per-asset LM slugs (leverage_master_SYMBOL_long/_short) via regex parse.
function getQuestLabel(category: string): string {
    if (QUEST_LABELS[category]) return QUEST_LABELS[category];
    const match = category.match(/^leverage_master_(.+)_(long|short)$/);
    if (match) {
        const [, symbol, side] = match;
        return `Leverage Master ${symbol} (${side === 'long' ? 'Long' : 'Short'})`;
    }
    return category;
}

const CPI_COMPONENTS = [
    { key: 'pnlScore', label: 'PnL', color: '#22c55e' },
    { key: 'riskScore', label: 'Risk', color: '#3b82f6' },
    { key: 'consistencyScore', label: 'Consistency', color: '#a78bfa' },
    { key: 'activityScore', label: 'Activity', color: '#f59e0b' },
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
    // Integer → "500"; split prize → "237.50"; larger → "1,234.56" (en-US thousands separator).
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
            // Phase 4 V8: denominator from assetList when populated, fallback 4 for legacy tournaments
            const denom = assetListLength ?? 4;
            return [
                { label: 'Eligible Trades', value: `${count}/${denom}` },
                { label: 'ROI', value: `${(avgRoi * 100).toFixed(2)}%` },
            ];
        }
        case 'bottom_fisher': {
            const entry = d.longEntry as { proximity: number; roi: number } | null;
            if (!entry) return [];
            return [
                { label: '% from Bottom', value: `${(entry.proximity * 100).toFixed(2)}%` },
                { label: 'ROI', value: `${(entry.roi * 100).toFixed(2)}%` },
            ];
        }
        case 'top_tick_traveler': {
            const entry = d.shortEntry as { proximity: number; roi: number } | null;
            if (!entry) return [];
            return [
                { label: '% from Top', value: `${(entry.proximity * 100).toFixed(2)}%` },
                { label: 'ROI', value: `${(entry.roi * 100).toFixed(2)}%` },
            ];
        }
        case 'risk_manager':
        case 'humble_one': {
            const trade = d.bestTrade as { roi: number } | null;
            if (!trade) return [];
            return [
                { label: 'ROI', value: `${(trade.roi * 100).toFixed(2)}%` },
            ];
        }
        default: {
            // Phase 4 item 30: LM slugs are per-asset (leverage_master_${symbol}_${side}).
            // Legacy slugs (leverage_master_long/_short) also match — backend emits
            // stepCount in details for both cases.
            if (category.startsWith('leverage_master_')) {
                const count = (d.stepCount as number) ?? 0;
                return [
                    { label: 'Steps', value: `${count}/10` },
                ];
            }
            return [];
        }
    }
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
    // Phase 6: cache breakdowns by wallet so re-expanding the same wallet is instant.
    // The single `breakdown` value flowing to JSX is derived below from this map.
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
        // Phase 4 item 30: categories for weekly tab are per-asset from tournament.config.assetList
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

    useEffect(() => {
        if (activeTab === 'quests') {
            loadQuestScores(questPeriod, questDate);
        }
    }, [activeTab, questPeriod, questDate, loadQuestScores]);

    async function toggleExpand(wallet: string) {
        if (expandedWallet === wallet) {
            setExpandedWallet(null);
            return;
        }
        setExpandedWallet(wallet);

        // Phase 6: cache hit → no fetch, no loading flicker.
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
                // Fire-and-forget reload: a reload failure must NOT overwrite success state.
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

    // Resolve searchQuery to a specific wallet from the tournament roster.
    // First-match wins for ambiguous substrings. Used by Quest Leaderboards for row 6.
    const searchedWallet = useMemo<string | null>(() => {
        if (!searchQuery || !data) return null;
        const match = data.entries.find((e) =>
            e.wallet.toLowerCase().includes(searchQuery.toLowerCase()),
        );
        return match?.wallet ?? null;
    }, [searchQuery, data]);

    // Phase 6: derive `breakdown` from cache + currently-expanded wallet so all
    // downstream JSX (GeneralLeaderboard prop, ForgeRow prop, QuestBreakdownBars consumer)
    // continue receiving the same `WalletBreakdown | null` shape — zero JSX/interface
    // changes required.
    const breakdown = expandedWallet ? breakdownCache.get(expandedWallet) ?? null : null;

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                    <Flame size={48} style={{ margin: '0 auto 16px', animation: 'pulse 2s infinite' }} />
                    <p>Loading leaderboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>
                <p>{error}</p>
            </div>
        );
    }

    if (!data) return null;

    // Determine page title based on tournament format
    const isForge = data.tournament.config?.format === 'rank_only';
    const pageTitle = isForge ? 'The Forge' : 'Leaderboard';

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                {!isForge && (
                    <Link
                        href={`/tournament/${tournamentId}`}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                            color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem',
                            textDecoration: 'none',
                        }}
                    >
                        <ArrowLeft size={16} /> Back to Tournament
                    </Link>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <Flame size={32} color="#f59e0b" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                                {pageTitle}
                            </h1>
                            {isForge && <StatusBadge status={data.tournament.status} />}
                        </div>
                        <p style={{ color: '#94a3b8', margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
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
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {(['general', 'quests'] as PageTab[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '0.5rem 1.25rem', borderRadius: '9999px', border: 'none',
                            fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
                            background: activeTab === tab ? '#f59e0b' : '#1e293b',
                            color: activeTab === tab ? '#0f172a' : '#94a3b8',
                            transition: 'all 0.15s',
                        }}
                    >
                        {tab === 'general' ? 'General Leaderboard' : 'Quest Leaderboards'}
                    </button>
                ))}
            </div>

            {/* Fallen Fighters info — shown for bracket tournaments */}
            {data.tournament.config?.format === 'bracket' && (
                <div style={{
                    marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem',
                    background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)',
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                }}>
                    <Info size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <p style={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.8125rem', margin: 0 }}>
                            {FF_DESCRIPTION.title}
                        </p>
                        <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: '0.25rem 0 0', lineHeight: 1.5 }}>
                            {FF_DESCRIPTION.description}
                        </p>
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
    topPercentCutoff?: number;  // Phase 4 V9: dynamic TOP N% rendering
}

function GeneralLeaderboard({
    entries, expandedWallet, breakdown, breakdownLoading,
    searchQuery, onSearch, onToggle, isForge, prizeTable, topPercentCutoff,
}: GeneralLeaderboardProps) {
    // Split-aware prize per rank (accounts for ties).
    // Tied wallets at rank N share (sum of skillPrizes[N-1..N+K-2]) / K.
    const prizesByRank = useMemo<Map<number, number>>(() => {
        const map = new Map<number, number>();
        if (!prizeTable) return map;
        const rankCounts = new Map<number, number>();
        for (const e of entries) {
            if (!e.isTopPercent) continue;
            rankCounts.set(e.rank, (rankCounts.get(e.rank) ?? 0) + 1);
        }
        for (const [rank, count] of rankCounts) {
            let sum = 0;
            for (let i = 0; i < count; i++) {
                sum += prizeTable.skillPrizes[rank - 1 + i] ?? 0;
            }
            map.set(rank, sum / count);
        }
        return map;
    }, [entries, prizeTable]);

    return (
        <>
            <CPIExplanation />
            <div style={{ marginBottom: '1rem' }}>
                <input
                    type="text"
                    placeholder="Search by wallet address..."
                    value={searchQuery}
                    onChange={(e) => onSearch(e.target.value)}
                    style={{
                        width: '100%', maxWidth: '400px', padding: '0.625rem 1rem',
                        background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                        color: '#f1f5f9', fontSize: '0.875rem', outline: 'none',
                    }}
                />
            </div>

            <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #1e293b' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                    <thead>
                        <tr style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
                            <th style={thStyle}></th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Rank</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Wallet</th>
                            <th style={thStyle}>CPI</th>
                            <th style={thStyle}>Quests</th>
                            <th style={thStyle}>Final</th>
                            <th style={thStyle}>Prize</th>
                            <th style={thStyle}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <Ticket size={12} /> Tickets
                                </span>
                            </th>
                            <th style={thStyle}>Status</th>
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
                            />
                        ))}
                        {entries.length === 0 && (
                            <tr>
                                <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
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
    topPercentCutoff?: number;  // Phase 4 V9
}

function ForgeRow({ entry, isExpanded, onToggle, breakdown, breakdownLoading, isForge, prizeTable, prizesByRank, topPercentCutoff }: ForgeRowProps) {
    const medalColors = ['#fbbf24', '#94a3b8', '#cd7f32'];

    return (
        <>
            <tr
                onClick={onToggle}
                style={{
                    borderBottom: '1px solid #1e293b',
                    background: isExpanded ? '#1e293b' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#1a2332'; }}
                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
            >
                <td style={tdStyle}>
                    {isExpanded ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#64748b" />}
                </td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {entry.rank <= 3 && <Trophy size={14} color={medalColors[entry.rank - 1]} />}
                        <span style={{ fontWeight: entry.rank <= 3 ? 700 : 400, color: entry.rank <= 3 ? medalColors[entry.rank - 1] : '#e2e8f0' }}>
                            #{entry.rank}
                        </span>
                    </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>
                    {isForge ? (
                        <span
                            style={{
                                fontFamily: 'monospace', color: '#94a3b8',
                                borderBottom: '1px dashed #475569',
                            }}
                        >
                            {shortWallet(entry.wallet)}
                        </span>
                    ) : (
                        <Link
                            href={`/trader/${entry.wallet}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                fontFamily: 'monospace', color: '#94a3b8', textDecoration: 'none',
                                borderBottom: '1px dashed #475569',
                            }}
                        >
                            {shortWallet(entry.wallet)}
                        </Link>
                    )}
                </td>
                <td style={tdStyle}>{entry.cpiScore.toFixed(1)}</td>
                <td style={{ ...tdStyle, color: '#a78bfa' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Target size={12} /> {entry.questPoints.toFixed(2)}
                    </span>
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#f1f5f9' }}>
                    {entry.finalScore.toFixed(2)}
                </td>
                <td style={{ ...tdStyle, color: '#22c55e' }}>
                    {entry.isTopPercent && prizeTable
                        ? `${formatPrize(prizesByRank.get(entry.rank) ?? 0)} ${prizeTable.currency}`
                        : '—'}
                </td>
                <td style={{ ...tdStyle, color: '#fbbf24' }}>
                    {entry.raffleTickets}
                </td>
                <td style={tdStyle}>
                    <span style={{
                        padding: '2px 8px', borderRadius: '9999px', fontSize: '0.6875rem',
                        fontWeight: 600,
                        background: entry.isTopPercent ? 'rgba(34, 197, 94, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                        color: entry.isTopPercent ? '#22c55e' : '#fbbf24',
                    }}>
                        {entry.isTopPercent
                            ? `TOP ${Math.round((topPercentCutoff ?? 0.30) * 100)}%`
                            : 'RAFFLE'}
                    </span>
                </td>
            </tr>

            {isExpanded && (
                <tr>
                    <td colSpan={9} style={{ padding: '0', background: '#0f172a' }}>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
                            {breakdownLoading ? (
                                <p style={{ color: '#64748b', fontSize: '0.8125rem' }}>Loading breakdown...</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div>
                                        <h4 style={breakdownHeadingStyle}>CPI Breakdown</h4>
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
                                        <h4 style={breakdownHeadingStyle}>Quest Breakdown</h4>
                                        {breakdown ? (
                                            <QuestBreakdownBars breakdown={breakdown} />
                                        ) : (
                                            <p style={{ color: '#64748b', fontSize: '0.8125rem' }}>No quest data available.</p>
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
        <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', marginBottom: '2px' }}>
                <span style={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{value.toFixed(1)}</span>
            </div>
            <div style={{ height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                    height: '100%', width: `${pct}%`, background: color,
                    borderRadius: '3px', transition: 'width 0.3s ease',
                }} />
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// Quest Breakdown Bars (inside expanded row)
// --------------------------------------------------------------------------

function QuestBreakdownBars({ breakdown }: { breakdown: WalletBreakdown }) {
    // Phase 4 item 30: iterate actual breakdown keys (can include per-asset LM slugs),
    // using getQuestLabel for human-readable display names.
    const entries = Object.entries(breakdown.breakdown).map(([key, data]) => ({
        key,
        label: getQuestLabel(key),
        score: data?.totalScore ?? 0,
    }));

    const maxScore = Math.max(...entries.map((e) => Math.abs(e.score)), 1);

    return (
        <>
            {entries.map(({ key, label, score }) => (
                <HorizontalBar key={key} label={label} value={score} max={maxScore} color="#a78bfa" />
            ))}
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
    assetList?: Array<{ symbol: string }>;  // Phase 4: for per-asset LM slug generation
    onPeriodChange: (p: QuestPeriod) => void;
    onNavigateDate: (dir: number) => void;
    onToggleRules: (cat: string) => void;
    onJumpToToday: () => void;
    searchQuery: string;
    onSearch: (q: string) => void;
    searchedWallet: string | null;
    isForge: boolean;
}

function QuestLeaderboards({
    questPeriod, questDate, questScores, questLoading,
    expandedRules, assetList, onPeriodChange, onNavigateDate, onToggleRules, onJumpToToday,
    searchQuery, onSearch, searchedWallet, isForge,
}: QuestLeaderboardsProps) {
    const periodLabel = questPeriod === 'daily' ? `Day: ${questDate}`
        : questPeriod === '2day' ? `Window: ${questDate}`
        : `Week: ${questDate}`;

    return (
        <>
            <div style={{ marginBottom: '1rem' }}>
                <input
                    type="text"
                    placeholder="Search by wallet address..."
                    value={searchQuery}
                    onChange={(e) => onSearch(e.target.value)}
                    style={{
                        width: '100%', maxWidth: '400px', padding: '0.625rem 1rem',
                        background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                        color: '#f1f5f9', fontSize: '0.875rem', outline: 'none',
                    }}
                />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {(Object.keys(PERIOD_LABELS) as QuestPeriod[]).map((p) => (
                    <button
                        key={p}
                        onClick={() => onPeriodChange(p)}
                        style={{
                            padding: '0.375rem 1rem', borderRadius: '8px', border: '1px solid',
                            fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
                            borderColor: questPeriod === p ? '#f59e0b' : '#334155',
                            background: questPeriod === p ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                            color: questPeriod === p ? '#f59e0b' : '#94a3b8',
                            transition: 'all 0.15s',
                        }}
                    >
                        {PERIOD_LABELS[p]}
                    </button>
                ))}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                    <button onClick={() => onNavigateDate(-1)} style={dateNavBtnStyle}>
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ color: '#94a3b8', fontSize: '0.8125rem', minWidth: '180px', textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {periodLabel}
                        {questDate <= todayUTC() && (
                        <span style={{
                            padding: '2px 8px', borderRadius: '9999px',
                            fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.05em',
                            background: questDate === todayUTC() ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                            color: questDate === todayUTC() ? '#22c55e' : '#64748b',
                            ...(questDate === todayUTC() ? { animation: 'pulse 2s infinite' } : {}),
                        }}>
                            {questDate === todayUTC() ? 'LIVE' : 'FINAL'}
                        </span>
                    )}
                    </span>
                    <button onClick={() => onNavigateDate(1)} style={dateNavBtnStyle}>
                        <ChevronRight size={16} />
                    </button>
                    <button
                        onClick={onJumpToToday}
                        disabled={questDate === todayUTC()}
                        title={questDate === todayUTC() ? 'Already on today' : 'Jump to today'}
                        style={{
                            ...dateNavBtnStyle,
                            width: 'auto',
                            padding: '0 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            opacity: questDate === todayUTC() ? 0.4 : 1,
                            cursor: questDate === todayUTC() ? 'not-allowed' : 'pointer',
                            color: questDate === todayUTC() ? '#94a3b8' : '#f59e0b',
                            borderColor: questDate === todayUTC() ? '#334155' : 'rgba(245, 158, 11, 0.4)',
                            background: questDate === todayUTC() ? '#1e293b' : 'rgba(245, 158, 11, 0.1)',
                        }}
                    >
                        Today
                    </button>
                </div>
            </div>

            {questLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading quest data...
                </div>
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
    assetListLength?: number;  // Phase 4 V8: for extractQuestColumns denominator
}

function CategoryLeaderboard({ category, scores, isRulesExpanded, onToggleRules, isForge, searchedWallet, assetListLength }: CategoryLeaderboardProps) {
    // Phase 4 item 30: LM descriptions are per-asset, rendered via helper.
    // Static non-LM entries still come from QUEST_DESCRIPTIONS record.
    const lmMatch = category.match(/^leverage_master_(.+)?_?(long|short)$/);
    const lmSide: 'long' | 'short' | null = category.startsWith('leverage_master_')
        ? (category.endsWith('_long') ? 'long' : 'short')
        : null;
    const lmAsset = lmMatch?.[1] && lmMatch[1] !== 'long' && lmMatch[1] !== 'short'
        ? lmMatch[1]
        : undefined;
    const questInfo: QuestDescription | undefined = lmSide
        ? getLeverageMasterDescription(lmSide, lmAsset)
        : QUEST_DESCRIPTIONS[category];
    const label = getQuestLabel(category);

    // Full sorted list (not sliced) — needed to compute the searched wallet's rank.
    const fullSorted = [...scores]
        .filter((s) => !s.wallet.startsWith('__'))
        .sort((a, b) => b.score - a.score);
    const sorted = fullSorted.slice(0, 5);

    // Row 6 info: is the searched wallet in this category's scores, and where does it rank?
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

    const medalColors = ['#fbbf24', '#94a3b8', '#cd7f32'];

    return (
        <div style={{
            marginBottom: '1.5rem', borderRadius: '12px', border: '1px solid #1e293b',
            background: '#0f172a', overflow: 'hidden',
        }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ color: '#f1f5f9', fontSize: '0.9375rem', fontWeight: 600, margin: 0 }}>
                        {label}
                    </h3>
                    <button
                        onClick={onToggleRules}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#64748b', fontSize: '0.6875rem',
                        }}
                    >
                        <Info size={12} />
                        {isRulesExpanded ? 'Hide rules' : 'Show rules'}
                    </button>
                </div>
                {questInfo && (
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: '0.25rem 0 0', fontStyle: 'italic' }}>
                        {questInfo.tagline}
                    </p>
                )}
            </div>

            {isRulesExpanded && questInfo && (
                <div style={{
                    padding: '0.75rem 1rem', borderBottom: '1px solid #1e293b',
                    background: '#0c1220',
                }}>
                    <p style={{ color: '#cbd5e1', fontSize: '0.75rem', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                        {questInfo.description}
                    </p>
                    <ul style={{ margin: 0, padding: '0 0 0 1.25rem', color: '#94a3b8', fontSize: '0.6875rem', lineHeight: 1.7 }}>
                        {questInfo.rules.map((rule, i) => (
                            <li key={i}>{rule}</li>
                        ))}
                    </ul>
                </div>
            )}

            {sorted.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                            <th style={{ ...thStyle, textAlign: 'left', width: '60px' }}>Rank</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Wallet</th>
                            {sampleColumns.map((col) => (
                                <th key={col.label} style={thStyle}>{col.label}</th>
                            ))}
                            <th style={thStyle}>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((score, idx) => {
                            const cols = extractQuestColumns(category, score.details, assetListLength);
                            return (
                                <tr
                                    key={score.wallet}
                                    style={{
                                        borderBottom: '1px solid #1e293b',
                                        background: score.wallet === searchedWallet ? 'rgba(245, 158, 11, 0.08)' : undefined,
                                        borderLeft: score.wallet === searchedWallet ? '2px solid #f59e0b' : '2px solid transparent',
                                    }}
                                >
                                    <td style={{ ...tdStyle, textAlign: 'left' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            {idx < 3 && <Trophy size={12} color={medalColors[idx]} />}
                                            <span style={{
                                                fontWeight: idx < 3 ? 700 : 400,
                                                color: idx < 3 ? medalColors[idx] : '#e2e8f0',
                                            }}>
                                                #{idx + 1}
                                            </span>
                                        </span>
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'left' }}>
                                        {isForge ? (
                                            <span
                                                style={{
                                                    fontFamily: 'monospace', color: '#94a3b8',
                                                    borderBottom: '1px dashed #475569',
                                                }}
                                            >
                                                {shortWallet(score.wallet)}
                                            </span>
                                        ) : (
                                            <Link
                                                href={`/trader/${score.wallet}`}
                                                style={{
                                                    fontFamily: 'monospace', color: '#94a3b8',
                                                    textDecoration: 'none', borderBottom: '1px dashed #475569',
                                                }}
                                            >
                                                {shortWallet(score.wallet)}
                                            </Link>
                                        )}
                                    </td>
                                    {cols.map((col) => (
                                        <td key={col.label} style={tdStyle}>{col.value}</td>
                                    ))}
                                    <td style={{ ...tdStyle, fontWeight: 600, color: '#f1f5f9' }}>
                                        {score.score.toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                        {showRow6 && (
                            <tr style={{
                                borderBottom: '1px solid #1e293b',
                                borderTop: '1px dashed #334155',
                                background: 'rgba(245, 158, 11, 0.04)',
                            }}>
                                {searchedEntry ? (
                                    <>
                                        <td style={{ ...tdStyle, textAlign: 'left' }}>
                                            <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                                                #{searchedRank}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'left' }}>
                                            <span
                                                style={{
                                                    fontFamily: 'monospace', color: '#94a3b8',
                                                    borderBottom: '1px dashed #475569',
                                                }}
                                            >
                                                {shortWallet(searchedWallet!)}
                                            </span>
                                        </td>
                                        {extractQuestColumns(category, searchedEntry.details, assetListLength).map((col) => (
                                            <td key={col.label} style={tdStyle}>{col.value}</td>
                                        ))}
                                        <td style={{ ...tdStyle, fontWeight: 600, color: '#f1f5f9' }}>
                                            {searchedEntry.score.toFixed(2)}
                                        </td>
                                    </>
                                ) : (
                                    <td
                                        colSpan={2 + sampleColumns.length + 1}
                                        style={{
                                            ...tdStyle,
                                            textAlign: 'center',
                                            color: '#64748b',
                                            fontStyle: 'italic',
                                        }}
                                    >
                                        <span style={{ fontFamily: 'monospace', marginRight: '0.5rem', color: '#94a3b8' }}>
                                            {shortWallet(searchedWallet!)}
                                        </span>
                                        — Not ranked in this category
                                    </td>
                                )}
                            </tr>
                        )}
                    </tbody>
                </table>
            ) : (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                    No data for this period.
                </div>
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// Status Badge — tournament lifecycle indicator in the Forge header
// --------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
    const config = ({
        registration: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', label: 'REGISTRATION' },
        active:       { bg: 'rgba(34, 197, 94, 0.15)',  color: '#22c55e', label: 'ACTIVE' },
        completed:    { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', label: 'COMPLETED' },
        cancelled:    { bg: 'rgba(239, 68, 68, 0.15)',   color: '#ef4444', label: 'CANCELLED' },
    } as Record<string, { bg: string; color: string; label: string }>)[status];

    if (!config) return null;

    return (
        <span style={{
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            background: config.bg,
            color: config.color,
            ...(status === 'active' ? { animation: 'pulse 2s infinite' } : {}),
        }}>
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
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: isOpen ? 'pointer' : 'not-allowed',
                background: isOpen ? '#f59e0b' : '#334155',
                color: isOpen ? '#0f172a' : '#64748b',
                opacity: isOpen ? 1 : 0.7,
                transition: 'all 0.15s',
            }}
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
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 300, padding: '1rem',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
                    padding: '1.5rem', maxWidth: '480px', width: '100%',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h2 style={{ color: '#f1f5f9', fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
                        Register for The Forge
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}>
                        <CloseIcon size={20} />
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
                        Solana Wallet Address
                    </label>
                    <input
                        type="text"
                        value={walletInput}
                        onChange={(e) => onWalletChange(e.target.value)}
                        placeholder="Enter your wallet..."
                        disabled={registering}
                        style={{
                            width: '100%', padding: '0.625rem 1rem',
                            background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
                            color: '#f1f5f9', fontSize: '0.875rem', fontFamily: 'monospace',
                            outline: 'none', marginBottom: '1rem',
                        }}
                    />

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={registering}
                            style={{
                                padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #334155',
                                background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8125rem',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={registering || !walletInput.trim()}
                            style={{
                                padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                                background: walletInput.trim() && !registering ? '#f59e0b' : '#334155',
                                color: walletInput.trim() && !registering ? '#0f172a' : '#64748b',
                                cursor: walletInput.trim() && !registering ? 'pointer' : 'not-allowed',
                                fontWeight: 600, fontSize: '0.8125rem',
                            }}
                        >
                            {registering ? 'Registering...' : 'Register'}
                        </button>
                    </div>
                </form>

                {regResult && (
                    <div style={{
                        marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '8px',
                        background: regResult.registered ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: regResult.registered ? '#22c55e' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem',
                    }}>
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
    topPercentCutoff?: number;  // Phase 4 V9
}) {
    const skillTotal = prizeTable.skillPrizes.reduce((sum, v) => sum + v, 0);
    const raffleTotal = prizeTable.rafflePrizes.reduce((sum, v) => sum + v, 0);
    const formatAmount = (n: number) => n.toLocaleString('en-US');

    return (
        <div style={{
            marginTop: '1rem',
            padding: '1rem 1.25rem',
            borderRadius: '12px',
            background: 'rgba(245, 158, 11, 0.05)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1.5rem',
            flexWrap: 'wrap',
        }}>
            <div>
                <div style={{
                    fontSize: '0.6875rem',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.25rem',
                }}>
                    Total Prize Pool
                </div>
                <div style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: '#fbbf24',
                    fontFamily: 'monospace',
                }}>
                    {formatAmount(prizeTable.totalPool)} {prizeTable.currency}
                </div>
            </div>
            <div style={{ display: 'flex', gap: '2rem' }}>
                <div>
                    <div style={{ fontSize: '0.6875rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                        Top {Math.round((topPercentCutoff ?? 0.30) * 100)}% Skill
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#22c55e', fontFamily: 'monospace' }}>
                        {formatAmount(skillTotal)} {prizeTable.currency}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: '0.6875rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                        Raffle
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#a78bfa', fontFamily: 'monospace' }}>
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
        <div style={{
            marginBottom: '1rem',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            background: '#0f172a',
            overflow: 'hidden',
        }}>
            <button
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: 'none',
                    border: 'none',
                    color: '#f1f5f9',
                    cursor: 'pointer',
                    textAlign: 'left',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <Info size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                            {CPI_DESCRIPTION.title}
                        </div>
                        {!expanded && (
                            <div style={{
                                fontSize: '0.75rem',
                                color: '#94a3b8',
                                fontStyle: 'italic',
                                marginTop: '0.125rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {CPI_DESCRIPTION.tagline}
                            </div>
                        )}
                    </div>
                </div>
                {expanded
                    ? <ChevronDown size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
                    : <ChevronRight size={16} color="#94a3b8" style={{ flexShrink: 0 }} />}
            </button>

            {expanded && (
                <div style={{
                    padding: '0 1rem 1rem',
                    borderTop: '1px solid #1e293b',
                }}>
                    <p style={{
                        color: '#cbd5e1',
                        fontSize: '0.8125rem',
                        margin: '0.75rem 0',
                        lineHeight: 1.5,
                    }}>
                        {CPI_DESCRIPTION.tagline}
                    </p>
                    {CPI_DESCRIPTION.sections.map((section) => (
                        <div key={section.heading} style={{ marginBottom: '1rem' }}>
                            <h4 style={{
                                color: '#f1f5f9',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                margin: '0 0 0.375rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                            }}>
                                {section.heading}
                            </h4>
                            {section.paragraph && (
                                <p style={{
                                    color: '#cbd5e1',
                                    fontSize: '0.8125rem',
                                    margin: '0 0 0.5rem',
                                    lineHeight: 1.5,
                                }}>
                                    {section.paragraph}
                                </p>
                            )}
                            {section.items && (
                                <ul style={{
                                    margin: 0,
                                    padding: '0 0 0 1.25rem',
                                    color: '#94a3b8',
                                    fontSize: '0.75rem',
                                    lineHeight: 1.7,
                                }}>
                                    {section.items.map((item, i) => (
                                        <li key={i} style={{ marginBottom: '0.25rem' }}>{item}</li>
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

// --------------------------------------------------------------------------
// Shared styles
// --------------------------------------------------------------------------

const thStyle: React.CSSProperties = {
    padding: '0.625rem 0.75rem',
    textAlign: 'right',
    color: '#64748b',
    fontSize: '0.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    textAlign: 'right',
    color: '#cbd5e1',
    whiteSpace: 'nowrap',
};

const breakdownHeadingStyle: React.CSSProperties = {
    color: '#e2e8f0', margin: '0 0 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
};

const dateNavBtnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    background: '#1e293b', border: '1px solid #334155',
    color: '#94a3b8', cursor: 'pointer',
};
