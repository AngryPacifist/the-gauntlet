'use client';

import { useEffect, useState, use } from 'react';
import {
    listTournaments,
    getTraderProfile,
    type Tournament,
    type TraderProfile,
} from '@/lib/api';
import {
    Copy,
    CheckCircle,
    ShieldCheck,
    Skull,
    Swords,
} from 'lucide-react';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import styles from './page.module.css';

export default function TraderPage({ params }: { params: Promise<{ wallet: string }> }) {
    const { wallet } = use(params);

    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
    const [profile, setProfile] = useState<TraderProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

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

    function copyWallet() {
        navigator.clipboard.writeText(wallet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

    function getShareText(): string {
        if (!profile || profile.rounds.length === 0) return '';
        const lastRound = profile.rounds[profile.rounds.length - 1];
        const cpi = lastRound.scores.cpiScore.toFixed(1);
        const tournamentName = profile.tournament.name;
        if (lastRound.advanced && !profile.rounds.some(r => r.eliminated)) {
            // Check if this is the final round (no more rounds after)
            const isWinner = lastRound.advanced && lastRound.roundNumber >= profile.rounds.length;
            if (isWinner) {
                return `\u{1F3C6} Won ${tournamentName} on @AdrenaProtocol! Final CPI: ${cpi}\n\n#AdrenaGauntlet`;
            }
            return `\u{1F5E1}\u{FE0F} Survived ${lastRound.roundName} of ${tournamentName} on @AdrenaProtocol! CPI: ${cpi}\n\n#AdrenaGauntlet`;
        }
        if (lastRound.eliminated) {
            return `\u{2694}\u{FE0F} Fell in ${lastRound.roundName} of ${tournamentName} on @AdrenaProtocol. CPI: ${cpi} | Bringing more heat next time\n\n#AdrenaGauntlet`;
        }
        return `\u{2694}\u{FE0F} Competing in ${lastRound.roundName} of ${tournamentName} on @AdrenaProtocol! CPI: ${cpi}\n\n#AdrenaGauntlet`;
    }

    return (
        <div className="container">
            <header className="page-header">
                <div className={styles.headerRow}>
                    <div>
                        <h1 className="page-header__title">Trader Profile</h1>
                        <div className={styles.walletRow}>
                            <code className={styles.walletDisplay}>{wallet}</code>
                            <button
                                className={styles.copyBtn}
                                onClick={copyWallet}
                                title="Copy wallet address"
                            >
                                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                            </button>
                            {profile && profile.rounds.length > 0 && (
                                <ShareButton text={getShareText()} label="Share" />
                            )}
                        </div>
                    </div>
                    {tournaments.length > 1 && (
                        <div className={styles.tournamentPicker}>
                            {tournaments.map((t) => (
                                <button
                                    key={t.id}
                                    className={`${styles.pickerBtn} ${selectedTournamentId === t.id ? styles.pickerBtnActive : ''}`}
                                    onClick={() => setSelectedTournamentId(t.id)}
                                >
                                    {t.name}
                                </button>
                            ))}
                        </div>
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
                        <Link href={`/tournament/${profile.tournament.id}`} className={styles.contextLink}>
                            {profile.tournament.name}
                        </Link>
                    </div>

                    {/* Journey timeline */}
                    {profile.rounds.length > 0 && (
                        <div className={styles.journey}>
                            <h3 className={styles.journeyTitle}>Journey</h3>
                            <div className={styles.journeyTrack}>
                                {profile.rounds.map((round) => (
                                    <div
                                        key={round.roundNumber}
                                        className={`${styles.journeyNode} ${round.advanced ? styles.journeyAdvanced : ''} ${round.eliminated ? styles.journeyEliminated : ''}`}
                                        title={`${round.roundName}: ${getStatusLabel(round)}`}
                                    >
                                        {round.eliminated ? (
                                            <Skull size={16} />
                                        ) : round.advanced ? (
                                            <ShieldCheck size={16} />
                                        ) : (
                                            <Swords size={16} />
                                        )}
                                        <span className={styles.journeyLabel}>R{round.roundNumber}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Per-round performance */}
                    {profile.rounds.length === 0 ? (
                        <div className={`card ${styles.emptyCard}`}>
                            <p>No round data yet. This trader is registered but the tournament may not have started.</p>
                        </div>
                    ) : (
                        profile.rounds.map((round) => (
                            <div key={round.roundNumber} className={`card ${styles.roundCard}`}>
                                {/* Status banner */}
                                <div className={`${styles.statusBanner} ${getStatusClass(round)}`}>
                                    {getStatusLabel(round)}
                                </div>

                                <div className={styles.roundHeader}>
                                    <div>
                                        <h2 className={styles.roundTitle}>
                                            Round {round.roundNumber}: {round.roundName}
                                        </h2>
                                        <span className={styles.bracketInfo}>
                                            Bracket {round.bracketNumber}
                                        </span>
                                    </div>
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
