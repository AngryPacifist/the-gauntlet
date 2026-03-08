'use client';

import { useEffect, useState, use } from 'react';
import {
    getTournament,
    getTournamentBrackets,
    registerWallet,
    type TournamentState,
    type Round,
    type Bracket,
} from '@/lib/api';
import styles from './page.module.css';

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const tournamentId = parseInt(id, 10);

    const [tournament, setTournament] = useState<TournamentState | null>(null);
    const [bracketsData, setBracketsData] = useState<{
        round: Round | null;
        brackets: Bracket[];
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Registration
    const [walletInput, setWalletInput] = useState('');
    const [regResult, setRegResult] = useState<{
        eligible: boolean;
        reason?: string;
    } | null>(null);
    const [registering, setRegistering] = useState(false);

    useEffect(() => {
        loadData();
    }, [tournamentId]);

    async function loadData() {
        try {
            setLoading(true);
            const [t, b] = await Promise.all([
                getTournament(tournamentId),
                getTournamentBrackets(tournamentId),
            ]);
            setTournament(t);
            setBracketsData(b);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load tournament');
        } finally {
            setLoading(false);
        }
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (!walletInput.trim()) return;
        try {
            setRegistering(true);
            setRegResult(null);
            const result = await registerWallet(tournamentId, walletInput.trim());
            setRegResult(result);
            if (result.eligible) {
                loadData();
            }
        } catch (err) {
            setRegResult({
                eligible: false,
                reason: err instanceof Error ? err.message : 'Registration failed',
            });
        } finally {
            setRegistering(false);
        }
    }

    function formatWallet(w: string) {
        if (w.length <= 10) return w;
        return `${w.slice(0, 4)}...${w.slice(-4)}`;
    }

    function getTimeRemaining(endTime: string): string {
        const diff = new Date(endTime).getTime() - Date.now();
        if (diff <= 0) return 'Ended';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m remaining`;
    }

    if (loading) {
        return (
            <div className="container">
                <div className={styles.center}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--text-muted)' }}>Loading tournament...</p>
                </div>
            </div>
        );
    }

    if (error || !tournament) {
        return (
            <div className="container">
                <div className={`card ${styles.errorCard}`}>
                    <p>⚠️ {error || 'Tournament not found'}</p>
                    <a href="/" className="btn btn--secondary">← Back</a>
                </div>
            </div>
        );
    }

    const activeRound = tournament.rounds.find((r) => r.status === 'active');
    const completedRounds = tournament.rounds.filter((r) => r.status === 'completed');

    return (
        <div className="container">
            {/* Header */}
            <header className="page-header">
                <div className={styles.headerRow}>
                    <div>
                        <h1 className="page-header__title">{tournament.name}</h1>
                        <p className="page-header__subtitle">
                            {tournament.status === 'registration' && '📋 Registration is open — join now!'}
                            {tournament.status === 'active' && activeRound && (
                                <>⚔️ {activeRound.name} — {getTimeRemaining(activeRound.endTime)}</>
                            )}
                            {tournament.status === 'completed' && '🏆 Tournament completed!'}
                        </p>
                    </div>
                    <span className={`badge badge--${tournament.status}`}>
                        {tournament.status}
                    </span>
                </div>
            </header>

            {/* Stats */}
            <div className={`stat-grid ${styles.stats}`}>
                <div className="card stat-card">
                    <div className="stat-card__label">Registered</div>
                    <div className="stat-card__value stat-card__value--accent">
                        {tournament.registrationCount}
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label">Eligible</div>
                    <div className="stat-card__value">{tournament.eligibleCount}</div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label">Current Round</div>
                    <div className="stat-card__value">
                        {activeRound ? activeRound.roundNumber : completedRounds.length || '—'}
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label">Bracket Size</div>
                    <div className="stat-card__value">{tournament.config.bracketSize}</div>
                </div>
            </div>

            {/* Registration Form */}
            {tournament.status === 'registration' && (
                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Register Your Wallet</h2>
                    <form onSubmit={handleRegister} className={styles.regForm}>
                        <input
                            type="text"
                            className="input input--mono"
                            placeholder="Enter your Solana wallet address..."
                            value={walletInput}
                            onChange={(e) => setWalletInput(e.target.value)}
                            disabled={registering}
                        />
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={registering || !walletInput.trim()}
                        >
                            {registering ? 'Checking...' : 'Register'}
                        </button>
                    </form>
                    {regResult && (
                        <div
                            className={`${styles.regResult} ${regResult.eligible ? styles.regSuccess : styles.regFail
                                }`}
                        >
                            {regResult.eligible
                                ? '✅ Successfully registered! You are eligible for the tournament.'
                                : `❌ ${regResult.reason}`}
                        </div>
                    )}
                </section>
            )}

            {/* Brackets */}
            {bracketsData && bracketsData.brackets.length > 0 && (
                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>
                        {bracketsData.round
                            ? `Round ${bracketsData.round.roundNumber}: ${bracketsData.round.name}`
                            : 'Brackets'}
                    </h2>

                    {bracketsData.round && (
                        <p className={styles.roundMeta}>
                            <span className={`badge badge--${bracketsData.round.status}`}>
                                {bracketsData.round.status}
                            </span>
                            {bracketsData.round.status === 'active' && (
                                <span className={styles.countdown}>
                                    ⏱ {getTimeRemaining(bracketsData.round.endTime)}
                                </span>
                            )}
                        </p>
                    )}

                    <div className={styles.bracketsGrid}>
                        {bracketsData.brackets.map((bracket) => (
                            <div key={bracket.id} className={`card ${styles.bracketCard}`}>
                                <div className={styles.bracketHeader}>
                                    <h3>Bracket {bracket.bracketNumber}</h3>
                                    <span className={styles.bracketCount}>
                                        {bracket.entries.length} traders
                                    </span>
                                </div>

                                <div className={styles.entriesList}>
                                    {bracket.entries.map((entry, idx) => (
                                        <div
                                            key={entry.id}
                                            className={`${styles.entryRow} ${entry.eliminated ? styles.entryEliminated : ''
                                                } ${entry.advanced ? styles.entryAdvanced : ''}`}
                                        >
                                            <div className={styles.entryRank}>#{idx + 1}</div>
                                            <div className={styles.entryInfo}>
                                                <a href={`/trader/${entry.wallet}`} className="wallet-address">
                                                    {formatWallet(entry.wallet)}
                                                </a>
                                            </div>
                                            <div className={styles.entryScore}>
                                                <span className={styles.cpiValue}>
                                                    {entry.cpiScore.toFixed(1)}
                                                </span>
                                                <span className={styles.cpiLabel}>CPI</span>
                                            </div>
                                            <div className={styles.entryStatus}>
                                                {entry.eliminated && (
                                                    <span className="badge badge--eliminated">OUT</span>
                                                )}
                                                {entry.advanced && (
                                                    <span className="badge badge--advanced">ADV</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Score breakdown bars */}
                                {bracket.entries.length > 0 && bracket.entries[0].cpiScore > 0 && (
                                    <div className={styles.scoreBreakdown}>
                                        <div className={styles.scoreRow}>
                                            <span className={styles.scoreLabel}>PnL</span>
                                            <div className="score-bar">
                                                <div
                                                    className="score-bar__fill score-bar__fill--pnl"
                                                    style={{ width: `${bracket.entries[0].pnlScore}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className={styles.scoreRow}>
                                            <span className={styles.scoreLabel}>Risk</span>
                                            <div className="score-bar">
                                                <div
                                                    className="score-bar__fill score-bar__fill--risk"
                                                    style={{ width: `${bracket.entries[0].riskScore}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className={styles.scoreRow}>
                                            <span className={styles.scoreLabel}>Consistency</span>
                                            <div className="score-bar">
                                                <div
                                                    className="score-bar__fill score-bar__fill--consistency"
                                                    style={{ width: `${bracket.entries[0].consistencyScore}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className={styles.scoreRow}>
                                            <span className={styles.scoreLabel}>Activity</span>
                                            <div className="score-bar">
                                                <div
                                                    className="score-bar__fill score-bar__fill--activity"
                                                    style={{ width: `${bracket.entries[0].activityScore}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Round History */}
            {completedRounds.length > 0 && (
                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Round History</h2>
                    <div className={styles.roundHistory}>
                        {completedRounds.map((r) => (
                            <div key={r.id} className={`card ${styles.roundCard}`}>
                                <div className={styles.roundInfo}>
                                    <span className={styles.roundNumber}>Round {r.roundNumber}</span>
                                    <span className={styles.roundName}>{r.name}</span>
                                </div>
                                <span className="badge badge--completed">Completed</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
