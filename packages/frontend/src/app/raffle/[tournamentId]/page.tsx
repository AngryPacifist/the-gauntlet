'use client';

import { useEffect, useState, use } from 'react';
import {
    getRaffleResults,
    getTournament,
    type RaffleResult,
    type TournamentState,
} from '@/lib/api';
import { Ticket, Trophy, Users, Hash, ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

export default function RafflePage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId: rawId } = use(params);
    const tournamentId = parseInt(rawId, 10);

    const [results, setResults] = useState<RaffleResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [walletSearch, setWalletSearch] = useState('');
    const [highlightedWallet, setHighlightedWallet] = useState<string | null>(null);
    const [tournament, setTournament] = useState<TournamentState | null>(null);

    useEffect(() => {
        if (!isNaN(tournamentId)) {
            loadResults();
            getTournament(tournamentId).then(setTournament).catch(() => setTournament(null));
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
            const el = document.getElementById(`raffle-row-${found.wallet}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            setHighlightedWallet(null);
            alert('Wallet not found in raffle results.');
        }
    }

    function computeRank(index: number): number {
        const score = results[index].finalScore;
        for (let j = 0; j < index; j++) {
            if (results[j].finalScore === score) {
                return j + 1;
            }
        }
        return index + 1;
    }

    const totalParticipants = results.length;
    const totalTickets = results.reduce((sum, r) => sum + r.ticketCount, 0);
    const eligibleCount = results.filter(r => !r.isTopPercent && r.ticketCount > 0 && r.closedPositionCount >= (tournament?.config.raffleMinClosedPositions ?? 10)).length;
    const winnerCount = results.filter(r => r.isWinner).length;
    const hasDrawn = winnerCount > 0;

    if (isNaN(tournamentId)) {
        return (
            <div className="container">
                <div className={`card ${styles.errorCard}`}>
                    <p>Invalid tournament ID</p>
                </div>
            </div>
        );
    }

    function rankClassName(rank: number): string {
        if (rank === 1) return 'rank-1';
        if (rank === 2) return 'rank-2';
        if (rank === 3) return 'rank-3';
        return '';
    }

    return (
        <div className="container">
            <header className="page-header">
                <Link href={`/tournament/${tournamentId}`} className={styles.backLink}>
                    <ArrowLeft size={14} />
                    Back to Tournament
                </Link>
                <h1 className="page-header__title">Raffle</h1>
                <p className="page-header__subtitle">
                    Tournament #{tournamentId} &mdash; Engagement-weighted draw
                </p>
            </header>

            {!loading && !error && results.length > 0 && (
                <div className={`stat-grid ${styles.statGrid}`}>
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
                            <div className="stat-card__value" style={{ color: 'var(--accent-gold)' }}>{winnerCount}</div>
                        </div>
                    )}
                </div>
            )}

            <div className={`card ${styles.formulaCard}`}>
                <strong className={styles.formulaTitle}>Ticket Formula</strong> &mdash;{' '}
                <code className={styles.formulaCode}>
                    floor(CPI &times; {tournament?.config.cpiTicketMultiplier ?? 0.5}) + floor(Quest Points &times; {tournament?.config.questTicketMultiplier ?? 20})
                </code>
                <span className={styles.formulaRules}>
                    Eligibility: {tournament?.config.raffleMinClosedPositions ?? 10}+ closed positions, not in top {Math.round((tournament?.config.topPercentCutoff ?? 0.30) * 100)}% by final score, tickets &gt; 0.
                    Top {Math.round((tournament?.config.topPercentCutoff ?? 0.30) * 100)}% are excluded from the raffle but compete for main prizes.
                </span>
            </div>

            <div className={`card ${styles.searchCard}`}>
                <div className={styles.searchRow}>
                    <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                        type="text"
                        className={`input input--mono ${styles.searchInput}`}
                        placeholder="Paste your wallet address to find your tickets..."
                        value={walletSearch}
                        onChange={(e) => setWalletSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleWalletSearch(); }}
                    />
                    <button
                        className={`btn btn--secondary ${styles.searchBtn}`}
                        onClick={handleWalletSearch}
                        disabled={!walletSearch.trim()}
                    >
                        Find
                    </button>
                </div>
            </div>

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
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Wallet</th>
                                <th className={styles.thRight}>CPI</th>
                                <th className={styles.thRight}>Quest Pts</th>
                                <th className={styles.thRight}>Tickets</th>
                                <th className={styles.thCenter}>Status</th>
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
                                        className={isHighlighted ? styles.rowHighlighted : ''}
                                    >
                                        <td>
                                            <span className={rankClassName(rank)}>{rank}</span>
                                        </td>
                                        <td className={styles.tdMono}>
                                            <Link href={`/trader/${entry.wallet}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                                                {entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}
                                            </Link>
                                        </td>
                                        <td className={styles.tdRight}>{entry.cpiScore.toFixed(1)}</td>
                                        <td className={styles.tdRight}>{entry.questPoints.toFixed(2)}</td>
                                        <td className={`${styles.tdRight} ${entry.ticketCount > 0 ? styles.ticketsHas : styles.ticketsZero}`}>
                                            {entry.ticketCount}
                                        </td>
                                        <td className={styles.tdCenter}>
                                            {entry.isWinner ? (
                                                <span className={`${styles.statusBadge} ${styles.statusBadgeWinner}`}>WINNER</span>
                                            ) : entry.isTopPercent ? (
                                                <span className={`${styles.statusBadge} ${styles.statusBadgeTop}`}>
                                                    TOP {Math.round((tournament?.config.topPercentCutoff ?? 0.30) * 100)}%
                                                </span>
                                            ) : entry.closedPositionCount < (tournament?.config.raffleMinClosedPositions ?? 10) ? (
                                                <span className={`${styles.statusBadge} ${styles.statusBadgeIneligible}`}>
                                                    &lt;{tournament?.config.raffleMinClosedPositions ?? 10} TRADES
                                                </span>
                                            ) : entry.ticketCount > 0 ? (
                                                <span className={`${styles.statusBadge} ${styles.statusBadgeEligible}`}>ELIGIBLE</span>
                                            ) : (
                                                <span className={`${styles.statusBadge} ${styles.statusBadgeIneligible}`}>0 TICKETS</span>
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
