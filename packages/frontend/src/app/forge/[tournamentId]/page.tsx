'use client';

import { useState, useEffect, use } from 'react';
import {
    getForgeLeaderboard,
    getWalletBreakdown,
    type ForgeLeaderboard,
    type ForgeEntry,
    type WalletBreakdown,
} from '@/lib/api';
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Trophy,
    Flame,
    Ticket,
    Target,
} from 'lucide-react';
import Link from 'next/link';

// Quest category display names for the breakdown panel
const QUEST_LABELS: Record<string, string> = {
    all_around: 'All Around',
    top_tick_traveler: 'Top-Tick Traveler',
    bottom_fisher: 'Bottom Fisher',
    risk_manager: 'Risk Manager',
    humble_one: 'Humble One',
    leverage_master_long: 'Leverage Master (Long)',
    leverage_master_short: 'Leverage Master (Short)',
};

export default function ForgePage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const resolvedParams = use(params);
    const tournamentId = parseInt(resolvedParams.tournamentId, 10);

    const [data, setData] = useState<ForgeLeaderboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Expanded row tracking — wallet → breakdown data
    const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
    const [breakdown, setBreakdown] = useState<WalletBreakdown | null>(null);
    const [breakdownLoading, setBreakdownLoading] = useState(false);

    // Wallet search
    const [searchQuery, setSearchQuery] = useState('');

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
            <div style={{ marginBottom: '2rem' }}>
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

            {/* Search */}
            <div style={{ marginBottom: '1rem' }}>
                <input
                    type="text"
                    placeholder="Search by wallet address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
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
                            <th style={thStyle}>PnL</th>
                            <th style={thStyle}>Risk</th>
                            <th style={thStyle}>Consistency</th>
                            <th style={thStyle}>Activity</th>
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
                        {filteredEntries.map((entry) => (
                            <ForgeRow
                                key={entry.wallet}
                                entry={entry}
                                isExpanded={expandedWallet === entry.wallet}
                                onToggle={() => toggleExpand(entry.wallet)}
                                breakdown={expandedWallet === entry.wallet ? breakdown : null}
                                breakdownLoading={expandedWallet === entry.wallet && breakdownLoading}
                            />
                        ))}
                        {filteredEntries.length === 0 && (
                            <tr>
                                <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                                    {searchQuery ? 'No wallets match your search' : 'No participants yet'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// Forge Row — expandable with quest breakdown
// --------------------------------------------------------------------------
interface ForgeRowProps {
    entry: ForgeEntry;
    isExpanded: boolean;
    onToggle: () => void;
    breakdown: WalletBreakdown | null;
    breakdownLoading: boolean;
}

function ForgeRow({ entry, isExpanded, onToggle, breakdown, breakdownLoading }: ForgeRowProps) {
    const shortWallet = entry.wallet.slice(0, 4) + '...' + entry.wallet.slice(-4);
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
                <td style={{ ...tdStyle, textAlign: 'left', fontFamily: 'monospace', color: '#94a3b8' }}>
                    {shortWallet}
                </td>
                <td style={tdStyle}>{entry.cpiScore.toFixed(1)}</td>
                <td style={tdStyle}>{entry.pnlScore.toFixed(1)}</td>
                <td style={tdStyle}>{entry.riskScore.toFixed(1)}</td>
                <td style={tdStyle}>{entry.consistencyScore.toFixed(1)}</td>
                <td style={tdStyle}>{entry.activityScore.toFixed(1)}</td>
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
                    <td colSpan={12} style={{ padding: '0', background: '#0f172a' }}>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
                            <h4 style={{ color: '#e2e8f0', margin: '0 0 0.75rem', fontSize: '0.8125rem', fontWeight: 600 }}>
                                Quest Breakdown — {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                            </h4>
                            {breakdownLoading ? (
                                <p style={{ color: '#64748b', fontSize: '0.8125rem' }}>Loading quest data...</p>
                            ) : breakdown ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                    {Object.entries(QUEST_LABELS).map(([key, label]) => {
                                        const catData = breakdown.breakdown[key];
                                        return (
                                            <div
                                                key={key}
                                                style={{
                                                    padding: '0.75rem', borderRadius: '8px',
                                                    background: '#1e293b', border: '1px solid #334155',
                                                }}
                                            >
                                                <p style={{ color: '#94a3b8', fontSize: '0.6875rem', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    {label}
                                                </p>
                                                <p style={{ color: '#f1f5f9', fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                                                    {catData ? catData.totalScore.toFixed(2) : '—'}
                                                </p>
                                                <p style={{ color: '#64748b', fontSize: '0.6875rem', margin: '2px 0 0' }}>
                                                    {catData ? `${catData.daysScored} day${catData.daysScored !== 1 ? 's' : ''} scored` : 'No data'}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p style={{ color: '#64748b', fontSize: '0.8125rem' }}>No quest data available.</p>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// Shared cell styles
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
