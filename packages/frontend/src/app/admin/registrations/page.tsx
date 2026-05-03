'use client';

// ============================================================================
// Admin Registrations — Phase 5 item 19 sub-route (NEW per Section 3C gap)
//
// View registered wallets per tournament + admin-driven late registration form.
// Phase 8 (2026-05-04): added Register Wallet form for late additions during
// rank_only-active tournaments (per ZeDef T1 pre-launch Q3b). Form calls the
// existing public /api/register endpoint — gating happens backend-side
// (tournament-manager.ts:registerWallet status guards).
//
// Backend:
//   GET  /api/register/:tournamentId — registration list (routes/registration.ts:62-83)
//   POST /api/register               — register wallet (routes/registration.ts:20-59)
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    listTournaments,
    getRegistrations,
    registerWallet,
    type Tournament,
} from '@/lib/api';
import { Users, ArrowLeft, Search, UserPlus } from 'lucide-react';

interface Registration {
    id: number;
    wallet: string;
    registeredAt: string;
}

function shortWallet(w: string): string {
    if (w.length <= 10) return w;
    return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

export default function AdminRegistrationsPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [loading, setLoading] = useState(true);
    const [regsLoading, setRegsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    // Phase 8: admin-driven late registration form
    const [walletInput, setWalletInput] = useState('');
    const [registering, setRegistering] = useState(false);
    const [regResult, setRegResult] = useState<{ registered: boolean; reason?: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                setLoading(true);
                const data = await listTournaments();
                if (!cancelled) setTournaments(data);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tournaments');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        // Phase 8: clear stale form state when switching tournaments
        setWalletInput('');
        setRegResult(null);

        if (selectedId === null) {
            setRegistrations([]);
            return;
        }
        let cancelled = false;
        async function loadRegs(id: number) {
            try {
                setRegsLoading(true);
                const data = await getRegistrations(id);
                if (!cancelled) setRegistrations(data);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load registrations');
            } finally {
                if (!cancelled) setRegsLoading(false);
            }
        }
        loadRegs(selectedId);
        return () => { cancelled = true; };
    }, [selectedId]);

    const selectedTournament = tournaments.find((t) => t.id === selectedId) ?? null;

    const filtered = search.trim()
        ? registrations.filter((r) => r.wallet.toLowerCase().includes(search.toLowerCase()))
        : registrations;

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (selectedId === null || !walletInput.trim()) return;
        try {
            setRegistering(true);
            setRegResult(null);
            const result = await registerWallet(selectedId, walletInput.trim());
            setRegResult(result);
            if (result.registered) {
                // Refetch so the new wallet appears in the table immediately
                const data = await getRegistrations(selectedId);
                setRegistrations(data);
                setWalletInput('');
            }
        } catch (err) {
            setRegResult({ registered: false, reason: err instanceof Error ? err.message : 'Failed to register' });
        } finally {
            setRegistering(false);
        }
    }

    return (
        <div className="container">
            <header className="page-header">
                <Link
                    href="/admin"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: 'var(--text-muted)',
                        fontSize: '0.8125rem',
                        textDecoration: 'none',
                        marginBottom: 'var(--space-sm)',
                    }}
                >
                    <ArrowLeft size={14} /> Back to Admin
                </Link>
                <h1 className="page-header__title">
                    <Users size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Registrations
                </h1>
                <p className="page-header__subtitle">
                    View registered wallets per tournament. Pick a tournament to load its registrations.
                </p>
            </header>

            {error && (
                <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                    <p style={{ color: 'var(--status-danger)', margin: 0 }}>{error}</p>
                </div>
            )}

            {/* Tournament selector */}
            <section style={{ marginBottom: 'var(--space-lg)' }}>
                <label style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.5rem',
                }}>
                    Tournament
                </label>
                {loading ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading tournaments...</div>
                ) : tournaments.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tournaments yet.</p>
                ) : (
                    <select
                        className="input input--mono"
                        value={selectedId ?? ''}
                        onChange={(e) => setSelectedId(e.target.value ? parseInt(e.target.value, 10) : null)}
                        style={{ minWidth: '320px' }}
                    >
                        <option value="">— pick a tournament —</option>
                        {tournaments.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name} (id:{t.id}, {t.status})
                            </option>
                        ))}
                    </select>
                )}
            </section>

            {/* Selected tournament info + count */}
            {selectedTournament && (
                <section className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                        <div>
                            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                {selectedTournament.name}
                            </h2>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                                {regsLoading
                                    ? 'Loading registrations...'
                                    : `${registrations.length} wallet${registrations.length === 1 ? '' : 's'} registered`}
                            </p>
                        </div>
                        <span className={`badge badge--${selectedTournament.status}`}>{selectedTournament.status}</span>
                    </div>
                </section>
            )}

            {/* Register Wallet form (Phase 8 — late additions for active rank_only) */}
            {selectedId !== null && !regsLoading && (
                <section className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                    <h3 style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        margin: '0 0 var(--space-sm)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                    }}>
                        <UserPlus size={14} />
                        Register Wallet
                    </h3>
                    <form onSubmit={handleRegister} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <input
                            type="text"
                            className="input input--mono"
                            placeholder="Solana wallet address (32-44 chars)..."
                            value={walletInput}
                            onChange={(e) => setWalletInput(e.target.value)}
                            disabled={registering}
                            style={{ flex: 1, minWidth: '320px' }}
                        />
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={registering || !walletInput.trim()}
                        >
                            {registering ? 'Registering…' : 'Register'}
                        </button>
                    </form>
                    {regResult && (
                        <p style={{
                            margin: 'var(--space-xs) 0 0',
                            fontSize: '0.75rem',
                            color: regResult.registered ? 'var(--status-success)' : 'var(--status-warning)',
                        }}>
                            {regResult.registered
                                ? 'Registered. Table refreshed.'
                                : `Not registered: ${regResult.reason ?? 'unknown reason'}`}
                        </p>
                    )}
                    <p style={{ margin: 'var(--space-xs) 0 0', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        Use for late additions during a <code>rank_only</code> active tournament. Backend gates: blocked if status is <code>completed</code>/<code>cancelled</code>; for <code>bracket</code> format, must still be in <code>registration</code>.
                    </p>
                </section>
            )}

            {/* Search + table */}
            {selectedId !== null && !regsLoading && registrations.length > 0 && (
                <>
                    <div style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Search size={14} style={{ color: 'var(--text-muted)' }} />
                        <input
                            type="text"
                            className="input"
                            placeholder="Filter by wallet substring..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ maxWidth: '320px' }}
                        />
                        {search && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {filtered.length} match{filtered.length === 1 ? '' : 'es'}
                            </span>
                        )}
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={{ ...thStyle, textAlign: 'left' }}>Wallet</th>
                                    <th style={{ ...thStyle, textAlign: 'left' }}>Full Address</th>
                                    <th style={thStyle}>Registered At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r, i) => (
                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={tdStyle}>{i + 1}</td>
                                        <td style={{ ...tdStyle, textAlign: 'left', fontFamily: 'var(--font-mono)' }}>
                                            {shortWallet(r.wallet)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                            {r.wallet}
                                        </td>
                                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>
                                            {new Date(r.registeredAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)' }}>
                                            No matches for &quot;{search}&quot;.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {selectedId !== null && !regsLoading && registrations.length === 0 && (
                <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
                        No registrations for this tournament.
                    </p>
                </div>
            )}
        </div>
    );
}

const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'right',
    color: 'var(--text-muted)',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'right',
    color: 'var(--text-secondary)',
};
