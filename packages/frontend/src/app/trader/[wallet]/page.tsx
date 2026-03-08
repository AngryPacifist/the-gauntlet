'use client';

import { useEffect, useState, use } from 'react';
import {
    listTournaments,
    getTraderProfile,
    type Tournament,
    type TraderProfile,
} from '@/lib/api';
import styles from './page.module.css';

export default function TraderPage({ params }: { params: Promise<{ wallet: string }> }) {
    const { wallet } = use(params);

    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
    const [profile, setProfile] = useState<TraderProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadTournaments();
    }, []);

    useEffect(() => {
        if (selectedTournamentId !== null) {
            loadProfile(selectedTournamentId);
        }
    }, [selectedTournamentId, wallet]);

    async function loadTournaments() {
        try {
            const ts = await listTournaments();
            setTournaments(ts);
            if (ts.length > 0) {
                setSelectedTournamentId(ts[0].id);
            } else {
                setLoading(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load tournaments');
            setLoading(false);
        }
    }

    async function loadProfile(tournamentId: number) {
        try {
            setLoading(true);
            setError(null);
            const data = await getTraderProfile(tournamentId, wallet);
            setProfile(data);
        } catch (err) {
            setProfile(null);
            setError(err instanceof Error ? err.message : 'Trader not found');
        } finally {
            setLoading(false);
        }
    }

    function formatWallet(w: string) {
        if (w.length <= 12) return w;
        return `${w.slice(0, 6)}...${w.slice(-6)}`;
    }

    function getStatusLabel(round: TraderProfile['rounds'][0]): string {
        if (round.advanced) return 'Advanced';
        if (round.eliminated) return 'Eliminated';
        return 'Competing';
    }

    function getStatusClass(round: TraderProfile['rounds'][0]): string {
        if (round.advanced) return styles.statusAdvanced;
        if (round.eliminated) return styles.statusEliminated;
        return styles.statusCompeting;
    }

    return (
        <div className="container">
            <header className="page-header">
                <div className={styles.headerRow}>
                    <div>
                        <h1 className="page-header__title">Trader Profile</h1>
                        <p className={`page-header__subtitle ${styles.walletDisplay}`}>
                            {formatWallet(wallet)}
                        </p>
                    </div>
                    {tournaments.length > 1 && (
                        <select
                            className={styles.tournamentSelect}
                            value={selectedTournamentId ?? ''}
                            onChange={(e) => setSelectedTournamentId(parseInt(e.target.value, 10))}
                        >
                            {tournaments.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    )}
                </div>
            </header>

            {loading && (
                <div className={styles.center}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--text-muted)' }}>Loading profile...</p>
                </div>
            )}

            {error && !loading && (
                <div className={`card ${styles.errorCard}`}>
                    <p>{error}</p>
                    <p className={styles.hint}>
                        This wallet may not be registered in the selected tournament.
                    </p>
                </div>
            )}

            {profile && !loading && (
                <>
                    {/* Tournament context */}
                    <div className={`card ${styles.contextCard}`}>
                        <span className={styles.contextLabel}>Tournament</span>
                        <a href={`/tournament/${profile.tournament.id}`} className={styles.contextLink}>
                            {profile.tournament.name}
                        </a>
                    </div>

                    {/* Per-round performance */}
                    {profile.rounds.length === 0 ? (
                        <div className={`card ${styles.emptyCard}`}>
                            <p>No round data yet. This trader is registered but the tournament may not have started.</p>
                        </div>
                    ) : (
                        profile.rounds.map((round) => (
                            <div key={round.roundNumber} className={`card ${styles.roundCard}`}>
                                <div className={styles.roundHeader}>
                                    <div>
                                        <h2 className={styles.roundTitle}>
                                            Round {round.roundNumber}: {round.roundName}
                                        </h2>
                                        <span className={styles.bracketInfo}>
                                            Bracket {round.bracketNumber}
                                        </span>
                                    </div>
                                    <span className={`${styles.statusBadge} ${getStatusClass(round)}`}>
                                        {getStatusLabel(round)}
                                    </span>
                                </div>

                                {/* CPI Score */}
                                <div className={styles.cpiSection}>
                                    <div className={styles.cpiTotal}>
                                        <span className={styles.cpiLabel}>CPI</span>
                                        <span className={styles.cpiValue}>{round.scores.cpiScore.toFixed(1)}</span>
                                    </div>
                                </div>

                                {/* Score breakdown */}
                                <div className={styles.scoreGrid}>
                                    <div className={styles.scoreItem}>
                                        <div className={styles.scoreHeader}>
                                            <span className={styles.scoreName}>PnL</span>
                                            <span className={styles.scoreValue}>{round.scores.pnlScore.toFixed(1)}</span>
                                        </div>
                                        <div className="score-bar">
                                            <div
                                                className="score-bar__fill score-bar__fill--pnl"
                                                style={{ width: `${round.scores.pnlScore}%` }}
                                            />
                                        </div>
                                        <span className={styles.scoreWeight}>35% weight</span>
                                    </div>

                                    <div className={styles.scoreItem}>
                                        <div className={styles.scoreHeader}>
                                            <span className={styles.scoreName}>Risk</span>
                                            <span className={styles.scoreValue}>{round.scores.riskScore.toFixed(1)}</span>
                                        </div>
                                        <div className="score-bar">
                                            <div
                                                className="score-bar__fill score-bar__fill--risk"
                                                style={{ width: `${round.scores.riskScore}%` }}
                                            />
                                        </div>
                                        <span className={styles.scoreWeight}>25% weight</span>
                                    </div>

                                    <div className={styles.scoreItem}>
                                        <div className={styles.scoreHeader}>
                                            <span className={styles.scoreName}>Consistency</span>
                                            <span className={styles.scoreValue}>{round.scores.consistencyScore.toFixed(1)}</span>
                                        </div>
                                        <div className="score-bar">
                                            <div
                                                className="score-bar__fill score-bar__fill--consistency"
                                                style={{ width: `${round.scores.consistencyScore}%` }}
                                            />
                                        </div>
                                        <span className={styles.scoreWeight}>25% weight</span>
                                    </div>

                                    <div className={styles.scoreItem}>
                                        <div className={styles.scoreHeader}>
                                            <span className={styles.scoreName}>Activity</span>
                                            <span className={styles.scoreValue}>{round.scores.activityScore.toFixed(1)}</span>
                                        </div>
                                        <div className="score-bar">
                                            <div
                                                className="score-bar__fill score-bar__fill--activity"
                                                style={{ width: `${round.scores.activityScore}%` }}
                                            />
                                        </div>
                                        <span className={styles.scoreWeight}>15% weight</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </>
            )}
        </div>
    );
}
