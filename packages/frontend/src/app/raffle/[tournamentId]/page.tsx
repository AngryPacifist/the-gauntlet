'use client';

import { useEffect, useState, use } from 'react';
import {
    getRaffleResults,
    type RaffleResult,
} from '@/lib/api';
import { Ticket, Trophy, Users, Hash, ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';

export default function RafflePage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const tournamentId = parseInt(rawId, 10);

    const [results, setResults] = useState<RaffleResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [walletSearch, setWalletSearch] = useState('');
    const [highlightedWallet, setHighlightedWallet] = useState<string | null>(null);

    useEffect(() => {
        if (!isNaN(tournamentId)) {
            loadResults();
        }
    }, [tournamentId]);

    async function loadResults() {
        try {
            setLoading(true);
            const data = await getRaffleResults(tournamentId);
            setResults(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load raffle results');
        } finally {
            setLoading(false);
        }
    }

    function handleWalletSearch() {
        const needle = walletSearch.trim().toLowerCase();
        if (!needle) return;

        const found = results.find(r => r.wallet.toLowerCase() === needle);
        if (found) {
            setHighlightedWallet(found.wallet);
            // Scroll to the row
            const el = document.getElementById(`raffle-row-${found.wallet}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            setHighlightedWallet(null);
            alert('Wallet not found in raffle results.');
        }
    }

    /**
     * Standard competition ranking: tied entries share the same rank.
     * For entry at index i, rank = index of first entry with the same score + 1.
     */
    function computeRank(index: number): number {
        const score = results[index].finalScore;
        for (let j = 0; j < index; j++) {
            if (results[j].finalScore === score) {
                return j + 1;
            }
        }
        return index + 1;
    }

    // Computed stats
    const totalParticipants = results.length;
    const totalTickets = results.reduce((sum, r) => sum + r.ticketCount, 0);
    const eligibleCount = results.filter(r => !r.isTopPercent && r.ticketCount > 0 && r.closedPositionCount >= 10).length;
    const winnerCount = results.filter(r => r.isWinner).length;
    const hasDrawn = winnerCount > 0;

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
                    style={{ color: 'var(--text-muted)', fontSize: '14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                    <ArrowLeft size={14} />
                    Back to Tournament
                </Link>
                <h1 className="page-header__title">
                    Raffle
                </h1>
                <p className="page-header__subtitle">
                    Tournament #{tournamentId} &mdash; Engagement-weighted draw
                </p>
            </header>

            {/* Summary Stats */}
            {!loading && !error && results.length > 0 && (
                <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 'var(--space-xl)' }}>
                    <div className="card stat-card">
                        <div className="stat-card__label">
                            <Users size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            Participants
                        </div>
                        <div className="stat-card__value">{totalParticipants}</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-card__label">
                            <Ticket size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            Total Tickets
                        </div>
                        <div className="stat-card__value stat-card__value--accent">{totalTickets.toLocaleString()}</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-card__label">
                            <Hash size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            Eligible
                        </div>
                        <div className="stat-card__value">{eligibleCount}</div>
                    </div>
                    {hasDrawn && (
                        <div className="card stat-card">
                            <div className="stat-card__label">
                                <Trophy size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                Winners
                            </div>
                            <div className="stat-card__value" style={{ color: '#ffd700' }}>{winnerCount}</div>
                        </div>
                    )}
                </div>
            )}

            {/* Ticket Formula */}
            <div className="card" style={{
                padding: 'var(--space-md) var(--space-lg)',
                marginBottom: 'var(--space-lg)',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
            }}>
                <strong style={{ color: 'var(--accent-primary)' }}>Ticket Formula</strong> &mdash;{' '}
                <code style={{ fontSize: '13px', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: '4px' }}>
                    floor(CPI &times; 0.5) + floor(Quest Points &times; 20)
                </code>
                <br />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Eligibility: 10+ closed positions, not in top 30% by final score, tickets &gt; 0.
                    Top 30% are excluded from the raffle but compete for main prizes.
                </span>
            </div>

            {/* Wallet Search */}
            <div className="card" style={{
                padding: 'var(--space-md) var(--space-lg)',
                marginBottom: 'var(--space-lg)',
            }}>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                        type="text"
                        className="input input--mono"
                        placeholder="Paste your wallet address to find your tickets..."
                        value={walletSearch}
                        onChange={(e) => setWalletSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleWalletSearch(); }}
                        style={{ flex: 1, fontSize: '13px' }}
                    />
                    <button
                        className="btn btn--secondary"
                        style={{ fontSize: '13px', padding: '8px 16px', whiteSpace: 'nowrap' }}
                        onClick={handleWalletSearch}
                        disabled={!walletSearch.trim()}
                    >
                        Find
                    </button>
                </div>
            </div>

            {/* Results Table */}
            {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
            ) : error ? (
                <p style={{ color: 'var(--status-danger)' }}>{error}</p>
            ) : results.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)' }}>
                        No raffle data yet. Tickets are computed after tournament scoring is finalized.
                    </p>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                                <th style={thStyle}>#</th>
                                <th style={thStyle}>Wallet</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>CPI</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Quest Pts</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Tickets</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((entry, i) => {
                                const rank = computeRank(i);
                                const isHighlighted = highlightedWallet === entry.wallet;

                                return (
                                    <tr
                                        key={entry.wallet}
                                        id={`raffle-row-${entry.wallet}`}
                                        style={{
                                            borderBottom: '1px solid var(--border-subtle)',
                                            background: isHighlighted ? 'rgba(108, 92, 231, 0.08)' : undefined,
                                            transition: 'background 0.3s ease',
                                        }}
                                    >
                                        <td style={tdStyle}>
                                            <span style={getRankStyle(rank - 1)}>{rank}</span>
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                                            <Link
                                                href={`/trader/${entry.wallet}`}
                                                style={{ color: 'inherit', textDecoration: 'none' }}
                                            >
                                                {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                            </Link>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            {entry.cpiScore.toFixed(1)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            {entry.questPoints.toFixed(2)}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 700,
                                            fontSize: '15px',
                                            color: entry.ticketCount > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                                        }}>
                                            {entry.ticketCount}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            {entry.isWinner ? (
                                                <span style={badgeStyle('#ffd700', 'rgba(255, 215, 0, 0.1)')}>
                                                    WINNER
                                                </span>
                                            ) : entry.isTopPercent ? (
                                                <span style={badgeStyle('#fdcb6e', 'rgba(253, 203, 110, 0.1)')}>
                                                    TOP 30%
                                                </span>
                                            ) : entry.closedPositionCount < 10 ? (
                                                <span style={badgeStyle('var(--text-muted)', 'var(--bg-elevated)')}>
                                                    &lt;10 TRADES
                                                </span>
                                            ) : entry.ticketCount > 0 ? (
                                                <span style={badgeStyle('#00b894', 'rgba(0, 184, 148, 0.1)')}>
                                                    ELIGIBLE
                                                </span>
                                            ) : (
                                                <span style={badgeStyle('var(--text-muted)', 'var(--bg-elevated)')}>
                                                    0 TICKETS
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function getRankStyle(index: number): React.CSSProperties {
    if (index === 0) return { fontWeight: 700, color: '#ffd700' };
    if (index === 1) return { fontWeight: 700, color: '#c0c0c0' };
    if (index === 2) return { fontWeight: 700, color: '#cd7f32' };
    return {};
}

function badgeStyle(color: string, bg: string): React.CSSProperties {
    return {
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        color,
        background: bg,
        border: `1px solid ${color}30`,
    };
}

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
