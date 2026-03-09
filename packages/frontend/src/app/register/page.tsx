'use client';

import { useState, useEffect } from 'react';
import { listTournaments, registerWallet, type Tournament } from '@/lib/api';
import {
    CheckCircle,
    AlertTriangle,
    XCircle,
    ShieldCheck,
    Clock,
    Swords,
} from 'lucide-react';
import Link from 'next/link';

export default function RegisterPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
    const [wallet, setWallet] = useState('');
    const [loading, setLoading] = useState(false);
    const [tournamentsLoading, setTournamentsLoading] = useState(true);
    const [result, setResult] = useState<{
        type: 'success' | 'ineligible' | 'error';
        message: string;
    } | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const all = await listTournaments();
                const registering = all.filter((t) => t.status === 'registration');
                setTournaments(registering);
                if (registering.length > 0) {
                    setSelectedTournamentId(registering[0].id);
                }
            } catch (err) {
                console.error('Failed to load tournaments:', err);
            } finally {
                setTournamentsLoading(false);
            }
        }
        load();
    }, []);

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedTournamentId || !wallet.trim()) return;

        setLoading(true);
        setResult(null);

        try {
            const res = await registerWallet(selectedTournamentId, wallet.trim());
            if (res.eligible) {
                setResult({
                    type: 'success',
                    message: 'Registration successful! Your wallet is eligible and has been registered.',
                });
                setWallet('');
            } else {
                setResult({
                    type: 'ineligible',
                    message: res.reason || 'Your wallet is not eligible for this tournament.',
                });
            }
        } catch (err) {
            setResult({
                type: 'error',
                message: err instanceof Error ? err.message : 'Registration failed',
            });
        } finally {
            setLoading(false);
        }
    }

    const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);

    return (
        <div className="page-container">
            <div className="register-hero">
                <h1>
                    <span className="gradient-text">Enter The Gauntlet</span>
                </h1>
                <p className="hero-subtitle">
                    Register your Solana wallet to compete. Your trading history will be verified for eligibility.
                </p>
            </div>

            {tournamentsLoading ? (
                <div className="loading-state">Loading tournaments...</div>
            ) : tournaments.length === 0 ? (
                <div className="empty-state">
                    <ShieldCheck size={48} strokeWidth={1.5} />
                    <h2>No Open Tournaments</h2>
                    <p>There are no tournaments currently accepting registrations. Check back soon!</p>
                    <Link href="/" className="btn btn-secondary">
                        View All Tournaments
                    </Link>
                </div>
            ) : (
                <div className="register-content">
                    <div className="register-card">
                        <form onSubmit={handleRegister} className="register-form">
                            <div className="form-group">
                                <label htmlFor="tournament-select">Tournament</label>
                                <select
                                    id="tournament-select"
                                    value={selectedTournamentId ?? ''}
                                    onChange={(e) => setSelectedTournamentId(Number(e.target.value))}
                                    className="form-select"
                                >
                                    {tournaments.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="wallet-input">Solana Wallet Address</label>
                                <input
                                    id="wallet-input"
                                    type="text"
                                    value={wallet}
                                    onChange={(e) => setWallet(e.target.value)}
                                    placeholder="Enter your Solana wallet address..."
                                    className="form-input"
                                    minLength={32}
                                    maxLength={44}
                                    required
                                />
                                <span className="form-hint">
                                    Must be 32-44 characters. Your Adrena trading history will be checked.
                                </span>
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg"
                                disabled={loading || !wallet.trim() || !selectedTournamentId}
                            >
                                {loading ? 'Checking eligibility...' : 'Register'}
                            </button>
                        </form>

                        {result && (
                            <div className={`result-banner result-${result.type} animate-in`}>
                                <span className="result-icon">
                                    {result.type === 'success' ? (
                                        <CheckCircle size={20} />
                                    ) : result.type === 'ineligible' ? (
                                        <AlertTriangle size={20} />
                                    ) : (
                                        <XCircle size={20} />
                                    )}
                                </span>
                                <span>{result.message}</span>
                            </div>
                        )}
                    </div>

                    {selectedTournament && (
                        <div className="tournament-info-card">
                            <h3>Tournament Details</h3>
                            <div className="info-grid">
                                <div className="info-item">
                                    <span className="info-label">
                                        <Swords size={12} style={{ marginRight: 4 }} /> Format
                                    </span>
                                    <span className="info-value">
                                        The Gauntlet ({selectedTournament.config.bracketSize} per bracket)
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">
                                        <Clock size={12} style={{ marginRight: 4 }} /> Round Duration
                                    </span>
                                    <span className="info-value">{selectedTournament.config.roundDurationHours} hours</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Elimination Rate</span>
                                    <span className="info-value">{(1 - selectedTournament.config.advanceRatio) * 100}% per round</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Min. Historical Trades</span>
                                    <span className="info-value">{selectedTournament.config.minHistoricalTrades} closed positions</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Max Inactivity</span>
                                    <span className="info-value">{selectedTournament.config.maxDaysInactive} days</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Anti-Wash Filter</span>
                                    <span className="info-value">Trades &lt;{selectedTournament.config.minTradeDurationSec}s excluded</span>
                                </div>
                            </div>

                            <div className="scoring-summary">
                                <h4>CPI Scoring</h4>
                                <div className="scoring-weights">
                                    <div className="weight-item">
                                        <span className="weight-bar" style={{ width: '35%' }}></span>
                                        <span className="weight-label">PnL (35%)</span>
                                    </div>
                                    <div className="weight-item">
                                        <span className="weight-bar weight-risk" style={{ width: '25%' }}></span>
                                        <span className="weight-label">Risk (25%)</span>
                                    </div>
                                    <div className="weight-item">
                                        <span className="weight-bar weight-consistency" style={{ width: '25%' }}></span>
                                        <span className="weight-label">Consistency (25%)</span>
                                    </div>
                                    <div className="weight-item">
                                        <span className="weight-bar weight-activity" style={{ width: '15%' }}></span>
                                        <span className="weight-label">Activity (15%)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
