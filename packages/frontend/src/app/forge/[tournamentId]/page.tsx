'use client';

import { useState, useEffect, use, useCallback } from 'react';
import {
    getForgeLeaderboard,
    getWalletBreakdown,
    getDailyScores,
    type ForgeLeaderboard,
    type ForgeEntry,
    type WalletBreakdown,
    type DailyCategoryScore,
    type CategorySlug,
} from '@/lib/api';
import { QUEST_DESCRIPTIONS, type QuestDescription } from '@/lib/quest-descriptions';
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

const CPI_COMPONENTS = [
    { key: 'pnlScore', label: 'PnL', color: '#22c55e' },
    { key: 'riskScore', label: 'Risk', color: '#3b82f6' },
    { key: 'consistencyScore', label: 'Consistency', color: '#a78bfa' },
    { key: 'activityScore', label: 'Activity', color: '#f59e0b' },
] as const;

type PageTab = 'general' | 'quests';
type QuestPeriod = 'daily' | '2day' | 'weekly';

const PERIOD_CATEGORIES: Record<QuestPeriod, CategorySlug[]> = {
    daily: ['all_around', 'bottom_fisher', 'top_tick_traveler'],
    '2day': ['risk_manager', 'humble_one'],
    weekly: ['leverage_master_long', 'leverage_master_short'],
};

const PERIOD_LABELS: Record<QuestPeriod, string> = {
    daily: 'Daily',
    '2day': '2 Day',
    weekly: 'Weekly',
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Format a date as YYYY-MM-DD */
function formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Step a date by N days */
function stepDate(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return formatDate(d);
}

/** Get today in UTC as YYYY-MM-DD */
function todayUTC(): string {
    return formatDate(new Date());
}

/** Truncate wallet for display */
function shortWallet(wallet: string): string {
    return wallet.slice(0, 4) + '...' + wallet.slice(-4);
}

/**
 * Extract category-specific columns from the details JSONB.
 * Field names verified against types.ts L254-327.
 */
function extractQuestColumns(
    category: string,
    details: unknown,
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
            return [
                { label: 'Eligible Trades', value: `${count}/4` },
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
        case 'leverage_master_long': {
            const count = (d.longCount as number) ?? 0;
            const total = (d.long as boolean[])?.length ?? 10;
            return [
                { label: 'Steps', value: `${count}/${total}` },
            ];
        }
        case 'leverage_master_short': {
            const count = (d.shortCount as number) ?? 0;
            const total = (d.short as boolean[])?.length ?? 10;
            return [
                { label: 'Steps', value: `${count}/${total}` },
            ];
        }
        default:
            return [];
    }
}

// --------------------------------------------------------------------------
// Page Component
// --------------------------------------------------------------------------

export default function ForgePage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const resolvedParams = use(params);
    const tournamentId = parseInt(resolvedParams.tournamentId, 10);

    const [data, setData] = useState<ForgeLeaderboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PageTab>('general');

    // General tab state
    const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
    const [breakdown, setBreakdown] = useState<WalletBreakdown | null>(null);
    const [breakdownLoading, setBreakdownLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Quest tab state
    const [questPeriod, setQuestPeriod] = useState<QuestPeriod>('daily');
    const [questDate, setQuestDate] = useState(todayUTC());
    const [questScores, setQuestScores] = useState<Map<string, DailyCategoryScore[]>>(new Map());
    const [questLoading, setQuestLoading] = useState(false);
    const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

    // Load forge leaderboard
    useEffect(() => {
        async function load() {
            try {
                const result = await getForgeLeaderboard(tournamentId);
                setData(result);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load forge leaderboard');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [tournamentId]);

    // Load quest scores when period or date changes
    const loadQuestScores = useCallback(async (period: QuestPeriod, date: string) => {
        setQuestLoading(true);
        const categories = PERIOD_CATEGORIES[period];
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

    // Expand/collapse general leaderboard row
    async function toggleExpand(wallet: string) {
        if (expandedWallet === wallet) {
            setExpandedWallet(null);
            setBreakdown(null);
            return;
        }
        setExpandedWallet(wallet);
        setBreakdownLoading(true);
        try {
            const result = await getWalletBreakdown(tournamentId, wallet);
            setBreakdown(result);
        } catch {
            setBreakdown(null);
        } finally {
            setBreakdownLoading(false);
        }
    }

    // Toggle rule descriptions
    function toggleRules(category: string) {
        setExpandedRules((prev) => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    }

    // Date navigation
    function navigateDate(direction: number) {
        const step = questPeriod === 'weekly' ? 7 : questPeriod === '2day' ? 2 : 1;
        setQuestDate((prev) => stepDate(prev, direction * step));
    }

    // Filter entries by search
    const filteredEntries = data?.entries.filter((e) =>
        searchQuery ? e.wallet.toLowerCase().includes(searchQuery.toLowerCase()) : true,
    ) ?? [];

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                    <Flame size={48} style={{ margin: '0 auto 16px', animation: 'pulse 2s infinite' }} />
                    <p>Loading The Forge...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>
                <p>{error}</p>
                <Link href="/" style={{ color: '#f59e0b', marginTop: '1rem', display: 'inline-block' }}>
                    ← Back to Dashboard
                </Link>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <Link
                    href="/"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem',
                        textDecoration: 'none',
                    }}
                >
                    <ArrowLeft size={16} /> Back to Dashboard
                </Link>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <Flame size={32} color="#f59e0b" />
                    <div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                            The Forge
                        </h1>
                        <p style={{ color: '#94a3b8', margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
                            {data.tournament.name} • {data.totalParticipants} participants • Top {data.top30Cutoff} earn skill prizes
                        </p>
                    </div>
                </div>
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
                />
            ) : (
                <QuestLeaderboards
                    questPeriod={questPeriod}
                    questDate={questDate}
                    questScores={questScores}
                    questLoading={questLoading}
                    expandedRules={expandedRules}
                    onPeriodChange={setQuestPeriod}
                    onNavigateDate={navigateDate}
                    onToggleRules={toggleRules}
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
}

function GeneralLeaderboard({
    entries, expandedWallet, breakdown, breakdownLoading,
    searchQuery, onSearch, onToggle,
}: GeneralLeaderboardProps) {
    return (
        <>
            {/* Search */}
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

            {/* Table */}
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
                            />
                        ))}
                        {entries.length === 0 && (
                            <tr>
                                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
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
}

function ForgeRow({ entry, isExpanded, onToggle, breakdown, breakdownLoading }: ForgeRowProps) {
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
                        {entry.isTopPercent ? 'TOP 30%' : 'RAFFLE'}
                    </span>
                </td>
            </tr>

            {/* Expanded breakdown panel */}
            {isExpanded && (
                <tr>
                    <td colSpan={8} style={{ padding: '0', background: '#0f172a' }}>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
                            {breakdownLoading ? (
                                <p style={{ color: '#64748b', fontSize: '0.8125rem' }}>Loading breakdown...</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    {/* CPI Breakdown */}
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

                                    {/* Quest Breakdown */}
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
    const entries = Object.entries(QUEST_LABELS).map(([key, label]) => ({
        key,
        label,
        score: breakdown.breakdown[key]?.totalScore ?? 0,
    }));

    // Normalize to wallet's own max
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
    onPeriodChange: (p: QuestPeriod) => void;
    onNavigateDate: (dir: number) => void;
    onToggleRules: (cat: string) => void;
}

function QuestLeaderboards({
    questPeriod, questDate, questScores, questLoading,
    expandedRules, onPeriodChange, onNavigateDate, onToggleRules,
}: QuestLeaderboardsProps) {
    const periodLabel = questPeriod === 'daily' ? `Day: ${questDate}`
        : questPeriod === '2day' ? `Window: ${questDate}`
        : `Week: ${questDate}`;

    return (
        <>
            {/* Period sub-tabs */}
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

                {/* Date navigation */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                    <button onClick={() => onNavigateDate(-1)} style={dateNavBtnStyle}>
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ color: '#94a3b8', fontSize: '0.8125rem', minWidth: '140px', textAlign: 'center' }}>
                        {periodLabel}
                    </span>
                    <button onClick={() => onNavigateDate(1)} style={dateNavBtnStyle}>
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* Category leaderboards */}
            {questLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading quest data...
                </div>
            ) : (
                PERIOD_CATEGORIES[questPeriod].map((cat) => (
                    <CategoryLeaderboard
                        key={cat}
                        category={cat}
                        scores={questScores.get(cat) ?? []}
                        isRulesExpanded={expandedRules.has(cat)}
                        onToggleRules={() => onToggleRules(cat)}
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
}

function CategoryLeaderboard({ category, scores, isRulesExpanded, onToggleRules }: CategoryLeaderboardProps) {
    const questInfo: QuestDescription | undefined = QUEST_DESCRIPTIONS[category];
    const label = QUEST_LABELS[category] ?? category;

    // Sort by score DESC, take top 5
    const sorted = [...scores]
        .filter((s) => !s.wallet.startsWith('__'))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    // Determine category-specific columns from the first entry
    const sampleColumns = sorted.length > 0
        ? extractQuestColumns(category, sorted[0].details)
        : [];

    const medalColors = ['#fbbf24', '#94a3b8', '#cd7f32'];

    return (
        <div style={{
            marginBottom: '1.5rem', borderRadius: '12px', border: '1px solid #1e293b',
            background: '#0f172a', overflow: 'hidden',
        }}>
            {/* Category header */}
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

            {/* Expandable rules */}
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

            {/* Top 5 table */}
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
                            const cols = extractQuestColumns(category, score.details);
                            return (
                                <tr key={score.wallet} style={{ borderBottom: '1px solid #1e293b' }}>
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
                                        <Link
                                            href={`/trader/${score.wallet}`}
                                            style={{
                                                fontFamily: 'monospace', color: '#94a3b8',
                                                textDecoration: 'none', borderBottom: '1px dashed #475569',
                                            }}
                                        >
                                            {shortWallet(score.wallet)}
                                        </Link>
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
