'use client';

import { useState, useEffect, use } from 'react';
import { getLeaderboard, getTournament, type TournamentState, type LeaderboardEntry } from '../../../lib/api';
import Link from 'next/link';

export default function LeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const tournamentId = parseInt(resolvedParams.id, 10);

    const [tournament, setTournament] = useState<TournamentState | null>(null);
    const [leaderboard, setLeaderboard] = useState<{ totalRounds: number; entries: LeaderboardEntry[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    if (loading) return <div className="page-container"><div className="loading-state">Loading leaderboard...</div></div>;
    if (error) return <div className="page-container"><div className="error-state">{error}</div></div>;
    if (!tournament || !leaderboard) return <div className="page-container"><div className="error-state">Not found</div></div>;

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <Link href={`/tournament/${tournamentId}`} className="back-link">
                        ← Back to Tournament
                    </Link>
                    <h1>{tournament.name} — Leaderboard</h1>
                    <p className="text-muted">
                        {leaderboard.entries.length} traders ranked across {leaderboard.totalRounds} round{leaderboard.totalRounds !== 1 ? 's' : ''}
                    </p>
                </div>
                <span className={`status-badge status-${tournament.status}`}>
                    {tournament.status}
                </span>
            </div>

            <div className="leaderboard-table-container">
                <table className="leaderboard-table">
                    <thead>
                        <tr>
                            <th className="col-rank">#</th>
                            <th className="col-wallet">Wallet</th>
                            <th className="col-score">CPI</th>
                            <th className="col-score">PnL</th>
                            <th className="col-score">Risk</th>
                            <th className="col-score">Consistency</th>
                            <th className="col-score">Activity</th>
                            <th className="col-round">Last Round</th>
                            <th className="col-status">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leaderboard.entries.map((entry, index) => (
                            <tr
                                key={entry.wallet}
                                className={
                                    entry.advanced ? 'row-advanced' :
                                        entry.eliminated ? 'row-eliminated' : ''
                                }
                            >
                                <td className="col-rank">
                                    <span className={`rank-badge ${index < 3 ? `rank-${index + 1}` : ''}`}>
                                        {index + 1}
                                    </span>
                                </td>
                                <td className="col-wallet">
                                    <Link
                                        href={`/trader/${entry.wallet}?tournamentId=${tournamentId}`}
                                        className="wallet-link"
                                    >
                                        {entry.wallet.slice(0, 10)}...{entry.wallet.slice(-4)}
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
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
