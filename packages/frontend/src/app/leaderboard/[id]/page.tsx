'use client';

import { useState, useEffect, use } from 'react';
import {
    getLeaderboard,
    getTournament,
    type TournamentState,
    type LeaderboardEntry,
} from '@/lib/api';
import {
    ArrowLeft,
    ArrowUpDown,
    Download,
    Trophy,
} from 'lucide-react';
import Link from 'next/link';

type SortKey = 'rank' | 'cpiScore' | 'pnlScore' | 'riskScore' | 'consistencyScore' | 'activityScore' | 'lastRound';
type SortDir = 'asc' | 'desc';

export default function LeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const tournamentId = parseInt(resolvedParams.id, 10);

    const [tournament, setTournament] = useState<TournamentState | null>(null);
    const [leaderboard, setLeaderboard] = useState<{ totalRounds: number; entries: LeaderboardEntry[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortKey, setSortKey] = useState<SortKey>('rank');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    useEffect(() => {
        async function load() {
            try {
                const [t, lb] = await Promise.all([
                    getTournament(tournamentId),
                    getLeaderboard(tournamentId),
                ]);
                setTournament(t);
                setLeaderboard(lb);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [tournamentId]);

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'rank' ? 'asc' : 'desc');
        }
    }

    function getSortedEntries(): LeaderboardEntry[] {
        if (!leaderboard) return [];
        if (sortKey === 'rank') {
            return sortDir === 'asc' ? leaderboard.entries : [...leaderboard.entries].reverse();
        }
        return [...leaderboard.entries].sort((a, b) => {
            const aVal = a[sortKey as keyof LeaderboardEntry] as number;
            const bVal = b[sortKey as keyof LeaderboardEntry] as number;
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }

    function exportCSV() {
        if (!leaderboard) return;
        const headers = ['Rank', 'Wallet', 'CPI', 'PnL', 'Risk', 'Consistency', 'Activity', 'Last Round', 'Status'];
        const rows = leaderboard.entries.map((e, i) => [
            i + 1,
            e.wallet,
            e.cpiScore.toFixed(1),
            e.pnlScore.toFixed(1),
            e.riskScore.toFixed(1),
            e.consistencyScore.toFixed(1),
            e.activityScore.toFixed(1),
            e.lastRound,
            e.advanced ? 'Advanced' : e.eliminated ? 'Eliminated' : 'Active',
        ]);
        const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gauntlet_leaderboard_${tournamentId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function getRankClass(index: number): string {
        if (index === 0) return 'rank-1';
        if (index === 1) return 'rank-2';
        if (index === 2) return 'rank-3';
        return '';
    }

    if (loading) return <div className="page-container"><div className="loading-state">Loading leaderboard...</div></div>;
    if (error) return <div className="page-container"><div className="error-state">{error}</div></div>;
    if (!tournament || !leaderboard) return <div className="page-container"><div className="error-state">Not found</div></div>;

    const sortedEntries = getSortedEntries();

    function SortHeader({ label, sortKeyProp }: { label: string; sortKeyProp: SortKey }) {
        const isActive = sortKey === sortKeyProp;
        return (
            <th
                onClick={() => handleSort(sortKeyProp)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
            >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {label}
                    <ArrowUpDown
                        size={12}
                        style={{ opacity: isActive ? 1 : 0.3 }}
                    />
                </span>
            </th>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <Link href={`/tournament/${tournamentId}`} className="back-link">
                        <ArrowLeft size={14} style={{ marginRight: 4 }} /> Back to Tournament
                    </Link>
                    <h1>
                        <Trophy size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                        {tournament.name} — Leaderboard
                    </h1>
                    <p className="text-muted">
                        {leaderboard.entries.length} traders ranked across {leaderboard.totalRounds} round{leaderboard.totalRounds !== 1 ? 's' : ''}
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-sm)' }}>
                    <span className={`status-badge status-${tournament.status}`}>
                        {tournament.status}
                    </span>
                    <button
                        className="btn btn--secondary"
                        onClick={exportCSV}
                        style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
                    >
                        <Download size={14} /> CSV
                    </button>
                </div>
            </div>

            <div className="leaderboard-table-container">
                <table className="leaderboard-table">
                    <thead>
                        <tr>
                            <SortHeader label="#" sortKeyProp="rank" />
                            <th className="col-wallet">Wallet</th>
                            <SortHeader label="CPI" sortKeyProp="cpiScore" />
                            <SortHeader label="PnL" sortKeyProp="pnlScore" />
                            <SortHeader label="Risk" sortKeyProp="riskScore" />
                            <SortHeader label="Consistency" sortKeyProp="consistencyScore" />
                            <SortHeader label="Activity" sortKeyProp="activityScore" />
                            <SortHeader label="Last Rd" sortKeyProp="lastRound" />
                            <th className="col-status">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedEntries.map((entry, index) => {
                            // Use original index for rank display when sorted by rank
                            const displayRank = sortKey === 'rank'
                                ? (sortDir === 'asc' ? index + 1 : leaderboard.entries.length - index)
                                : leaderboard.entries.indexOf(entry) + 1;

                            return (
                                <tr
                                    key={entry.wallet}
                                    className={
                                        entry.advanced ? 'row-advanced' :
                                            entry.eliminated ? 'row-eliminated' : ''
                                    }
                                >
                                    <td className="col-rank">
                                        <span className={`rank-badge ${getRankClass(displayRank - 1)}`}>
                                            {displayRank}
                                        </span>
                                    </td>
                                    <td className="col-wallet">
                                        <Link
                                            href={`/trader/${entry.wallet}?tournamentId=${tournamentId}`}
                                            className="wallet-link"
                                        >
                                            {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                        </Link>
                                    </td>
                                    <td className="col-score cpi-score">{entry.cpiScore.toFixed(1)}</td>
                                    <td className="col-score">{entry.pnlScore.toFixed(1)}</td>
                                    <td className="col-score">{entry.riskScore.toFixed(1)}</td>
                                    <td className="col-score">{entry.consistencyScore.toFixed(1)}</td>
                                    <td className="col-score">{entry.activityScore.toFixed(1)}</td>
                                    <td className="col-round">{entry.lastRound}</td>
                                    <td className="col-status">
                                        {entry.advanced ? (
                                            <span className="status-chip chip-advanced">Advanced</span>
                                        ) : entry.eliminated ? (
                                            <span className="status-chip chip-eliminated">Eliminated</span>
                                        ) : (
                                            <span className="status-chip chip-active">Active</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
