'use client';

import { useEffect, useState, useRef, use } from 'react';
import {
    getTournament,
    getTournamentBrackets,
    registerWallet,
    type TournamentState,
    type Round,
    type Bracket,
} from '@/lib/api';
import {
    ArrowLeft,
    Clock,
    Users,
    Layers,
    Swords,
    CheckCircle,
    XCircle,
    Trophy,
    ChevronRight,
    BarChart3,
    Compass,
} from 'lucide-react';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
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
    const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

    // Registration
    const [walletInput, setWalletInput] = useState('');
    const [regResult, setRegResult] = useState<{
        registered: boolean;
        reason?: string;
    } | null>(null);
    const [registering, setRegistering] = useState(false);

    // Live clock for countdown timer
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        loadData();
    }, [tournamentId]);

    const initialLoadRef = useRef(true);

    // Load brackets when selected round changes (skip initial — loadData already fetched)
    useEffect(() => {
        if (selectedRoundId !== null) {
            if (initialLoadRef.current) {
                initialLoadRef.current = false;
                return;
            }
            loadBrackets(selectedRoundId);
        }
    }, [selectedRoundId]);

    // Tick the clock every 60s so countdown timers update
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, []);

    // Poll for data updates while tournament is active or in registration
    useEffect(() => {
        if (!tournament) return;
        if (tournament.status !== 'active' && tournament.status !== 'registration') return;
        const interval = setInterval(loadData, 60_000);
        return () => clearInterval(interval);
    }, [tournament?.status]);

    async function loadData() {
        try {
            setLoading(true);
            const [t, b] = await Promise.all([
                getTournament(tournamentId),
                getTournamentBrackets(tournamentId),
            ]);
            setTournament(t);
            setBracketsData(b);
            // Set selected round to the most recent
            if (b.round) {
                setSelectedRoundId(b.round.id);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load tournament');
        } finally {
            setLoading(false);
        }
    }

    async function loadBrackets(roundId: number) {
        try {
            const b = await getTournamentBrackets(tournamentId, roundId);
            setBracketsData(b);
        } catch (err) {
            console.error('Failed to load brackets for round:', err);
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
            if (result.registered) {
                loadData();
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

    function formatWallet(w: string) {
        if (w.length <= 10) return w;
        return `${w.slice(0, 4)}...${w.slice(-4)}`;
    }

    function getTimeRemaining(endTime: string): string {
        const diff = new Date(endTime).getTime() - now;
        if (diff <= 0) return 'Round ended — awaiting advancement';
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
                    <p>{error || 'Tournament not found'}</p>
                    <Link href="/" className="btn btn--secondary">
                        <ArrowLeft size={14} /> Back
                    </Link>
                </div>
            </div>
        );
    }

    const activeRound = tournament.rounds.find((r) => r.status === 'active');
    const completedRounds = tournament.rounds.filter((r) => r.status === 'completed');
    const allRounds = tournament.rounds;

    // Determine the advance ratio to calculate elimination line
    const advanceRatio = tournament.config.advanceRatio;

    return (
        <div className="container">
            {/* Header */}
            <header className="page-header">
                <Link href="/" className={styles.backLink}>
                    <ArrowLeft size={14} /> Back to Dashboard
                </Link>
                <div className={styles.headerRow}>
                    <div>
                        <h1 className="page-header__title">{tournament.name}</h1>
                        <p className="page-header__subtitle">
                            {tournament.status === 'registration' && (
                                <><Clock size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Registration is open — join now</>
                            )}
                            {tournament.status === 'active' && activeRound && (
                                <><Swords size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {activeRound.name} — {getTimeRemaining(activeRound.endTime)}</>
                            )}
                            {tournament.status === 'completed' && (
                                <><Trophy size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Tournament completed</>
                            )}
                        </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <ShareButton
                            text={`\u{2694}\u{FE0F} Check out ${tournament.name} — a Battle Royale trading competition on @AdrenaProtocol!\n\n${tournament.registrationCount} traders competing across ${allRounds.length} round${allRounds.length !== 1 ? 's' : ''}\n\n#AdrenaGauntlet`}
                        />
                        <span className={`badge badge--${tournament.status}`}>
                            {tournament.status}
                        </span>
                    </div>
                </div>
            </header>

            {/* Stats */}
            <div className={`stat-grid ${styles.stats}`}>
                <div className="card stat-card">
                    <div className="stat-card__label">
                        <Users size={12} style={{ marginRight: 4 }} />
                        Registered
                    </div>
                    <div className="stat-card__value stat-card__value--accent">
                        {tournament.registrationCount}
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label">Current Round</div>
                    <div className="stat-card__value">
                        {activeRound ? activeRound.roundNumber : completedRounds.length || '—'}
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-card__label">
                        <Layers size={12} style={{ marginRight: 4 }} />
                        Bracket Size
                    </div>
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
                            className={`${styles.regResult} ${regResult.registered ? styles.regSuccess : styles.regFail}`}
                        >
                            {regResult.registered ? (
                                <><CheckCircle size={16} style={{ marginRight: 6, flexShrink: 0 }} /> Successfully registered! You're in the tournament.</>
                            ) : (
                                <><XCircle size={16} style={{ marginRight: 6, flexShrink: 0 }} /> {regResult.reason}</>
                            )}
                        </div>
                    )}
                </section>
            )}

            {/* Round Selector Tabs — split into Main Bracket and Fallen Fighters */}
            {allRounds.length > 0 && (() => {
                const mainRounds = allRounds.filter((r) => (r.type ?? 'main') === 'main');
                const consolationRounds = allRounds.filter((r) => r.type === 'consolation');
                return (
                    <section className={styles.section}>
                        {mainRounds.length > 0 && (
                            <>
                                <div className={styles.roundGroupLabel}>Main Bracket</div>
                                <div className={styles.roundTabs}>
                                    {mainRounds.map((r) => (
                                        <button
                                            key={r.id}
                                            className={`${styles.roundTab} ${selectedRoundId === r.id ? styles.roundTabActive : ''}`}
                                            onClick={() => setSelectedRoundId(r.id)}
                                        >
                                            <span className={styles.roundTabNumber}>R{r.roundNumber}</span>
                                            <span className={styles.roundTabName}>{r.name}</span>
                                            {r.status === 'active' && (
                                                <span className={styles.roundTabLive}>LIVE</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        {consolationRounds.length > 0 && (
                            <>
                                <div className={`${styles.roundGroupLabel} ${styles.roundGroupLabelConsolation}`}>Fallen Fighters</div>
                                <div className={styles.roundTabs}>
                                    {consolationRounds.map((r) => (
                                        <button
                                            key={r.id}
                                            className={`${styles.roundTab} ${styles.roundTabConsolation} ${selectedRoundId === r.id ? styles.roundTabActive : ''}`}
                                            onClick={() => setSelectedRoundId(r.id)}
                                        >
                                            <span className={styles.roundTabNumber}>R{r.roundNumber}</span>
                                            <span className={styles.roundTabName}>{r.name}</span>
                                            {r.status === 'active' && (
                                                <span className={styles.roundTabLive}>LIVE</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </section>
                );
            })()}

            {/* Brackets */}
            {bracketsData && bracketsData.brackets.length > 0 && (
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>
                            {bracketsData.round
                                ? `Round ${bracketsData.round.roundNumber}: ${bracketsData.round.name}`
                                : 'Brackets'}
                        </h2>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                            {allRounds.some(r => r.status === 'completed') && (
                                <Link
                                    href={`/tournament/${tournamentId}/analytics`}
                                    className="btn btn--secondary"
                                    style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
                                >
                                    <BarChart3 size={14} /> Analytics
                                </Link>
                            )}
                            <Link
                                href={`/leaderboard/${tournamentId}`}
                                className="btn btn--secondary"
                                style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
                            >
                                Leaderboard <ChevronRight size={14} />
                            </Link>
                            <Link
                                href={`/categories/${tournamentId}`}
                                className="btn btn--secondary"
                                style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
                            >
                                <Compass size={14} /> Categories
                            </Link>
                        </div>
                    </div>

                    {bracketsData.round && bracketsData.round.status === 'active' && (
                        <p className={styles.roundMeta}>
                            <span className={`badge badge--${bracketsData.round.status}`}>
                                {bracketsData.round.status}
                            </span>
                            <span className={styles.countdown}>
                                <Clock size={14} style={{ marginRight: 4 }} />
                                {getTimeRemaining(bracketsData.round.endTime)}
                            </span>
                        </p>
                    )}

                    <div className={styles.bracketsGrid}>
                        {bracketsData.brackets.map((bracket) => {
                            // Calculate elimination line index
                            const entryCount = bracket.entries.length;
                            const advanceCount = Math.ceil(entryCount * advanceRatio);

                            return (
                                <div key={bracket.id} className={`card ${styles.bracketCard}`}>
                                    <div className={styles.bracketHeader}>
                                        <h3>Bracket {bracket.bracketNumber}</h3>
                                        <span className={styles.bracketCount}>
                                            {bracket.entries.length} traders
                                        </span>
                                    </div>

                                    <div className={styles.entriesList}>
                                        {bracket.entries.map((entry, idx) => (
                                            <div key={entry.id}>
                                                {/* Elimination line */}
                                                {idx === advanceCount && entryCount > 1 && (
                                                    <div className={styles.eliminationLine}>
                                                        <span className={styles.eliminationText}>Elimination Line</span>
                                                    </div>
                                                )}
                                                <div
                                                    className={`${styles.entryRow} ${entry.eliminated ? styles.entryEliminated : ''
                                                        } ${entry.advanced ? styles.entryAdvanced : ''}`}
                                                >
                                                    <div className={styles.entryRank}>#{idx + 1}</div>
                                                    <div className={styles.entryInfo}>
                                                        <Link href={`/trader/${entry.wallet}?tournamentId=${tournamentId}`} className="wallet-address">
                                                            {formatWallet(entry.wallet)}
                                                        </Link>
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
                                                {/* Per-trader collapsible score breakdown */}
                                                {entry.cpiScore > 0 && (
                                                    <details className={styles.entryDetails}>
                                                        <summary className={styles.scoreToggle}>Score Breakdown</summary>
                                                        <div className={styles.scoreBreakdown}>
                                                            <div className={styles.scoreRow}>
                                                                <span className={styles.scoreLabel}>PnL</span>
                                                                <div className="score-bar">
                                                                    <div
                                                                        className="score-bar__fill score-bar__fill--pnl"
                                                                        style={{ width: `${entry.pnlScore}%` }}
                                                                    />
                                                                </div>
                                                                <span className={styles.scoreValue}>{entry.pnlScore.toFixed(1)}</span>
                                                            </div>
                                                            <div className={styles.scoreRow}>
                                                                <span className={styles.scoreLabel}>Risk</span>
                                                                <div className="score-bar">
                                                                    <div
                                                                        className="score-bar__fill score-bar__fill--risk"
                                                                        style={{ width: `${entry.riskScore}%` }}
                                                                    />
                                                                </div>
                                                                <span className={styles.scoreValue}>{entry.riskScore.toFixed(1)}</span>
                                                            </div>
                                                            <div className={styles.scoreRow}>
                                                                <span className={styles.scoreLabel}>Consistency</span>
                                                                <div className="score-bar">
                                                                    <div
                                                                        className="score-bar__fill score-bar__fill--consistency"
                                                                        style={{ width: `${entry.consistencyScore}%` }}
                                                                    />
                                                                </div>
                                                                <span className={styles.scoreValue}>{entry.consistencyScore.toFixed(1)}</span>
                                                            </div>
                                                            <div className={styles.scoreRow}>
                                                                <span className={styles.scoreLabel}>Activity</span>
                                                                <div className="score-bar">
                                                                    <div
                                                                        className="score-bar__fill score-bar__fill--activity"
                                                                        style={{ width: `${entry.activityScore}%` }}
                                                                    />
                                                                </div>
                                                                <span className={styles.scoreValue}>{entry.activityScore.toFixed(1)}</span>
                                                            </div>
                                                        </div>
                                                    </details>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
