'use client';

// ============================================================================
// Admin Registrations: per-tournament wallet browser + late-registration form.
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
import { Select } from '@/components/Select';
import styles from '../page.module.css';

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
                <Link href="/admin" className={styles.adminHeaderLink}>
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

            <section className={styles.regsSelectorRow}>
                <label className={styles.regsLabel}>Tournament</label>
                {loading ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading tournaments...</div>
                ) : tournaments.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tournaments yet.</p>
                ) : (
                    <div className={styles.regsSelector}>
                        <Select
                            ariaLabel="Pick a tournament"
                            value={selectedId === null ? '' : String(selectedId)}
                            onChange={(v) => setSelectedId(v ? parseInt(v, 10) : null)}
                            placeholder="Pick a tournament"
                            options={tournaments.map((t) => ({
                                value: String(t.id),
                                label: t.name,
                                hint: `id:${t.id}, ${t.status}`,
                            }))}
                        />
                    </div>
                )}
            </section>

            {selectedTournament && (
                <section className={`card ${styles.regsContextCard}`}>
                    <div className={styles.regsContextRow}>
                        <div>
                            <h2 className={styles.regsContextName}>{selectedTournament.name}</h2>
                            <p className={styles.regsContextSub}>
                                {regsLoading
                                    ? 'Loading registrations...'
                                    : `${registrations.length} wallet${registrations.length === 1 ? '' : 's'} registered`}
                            </p>
                        </div>
                        <span className={`badge badge--${selectedTournament.status}`}>{selectedTournament.status}</span>
                    </div>
                </section>
            )}

            {selectedId !== null && !regsLoading && (
                <section className={`card ${styles.regsFormCard}`}>
                    <h3 className={styles.regsFormHeading}>
                        <UserPlus size={14} />
                        Register Wallet
                    </h3>
                    <form onSubmit={handleRegister} className={styles.regsForm}>
                        <input
                            type="text"
                            className={`input input--mono ${styles.regsFormInput}`}
                            placeholder="Solana wallet address (32-44 chars)..."
                            value={walletInput}
                            onChange={(e) => setWalletInput(e.target.value)}
                            disabled={registering}
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
                        <p className={`${styles.regsFormResult} ${regResult.registered ? styles.regsFormResultOk : styles.regsFormResultErr}`}>
                            {regResult.registered
                                ? 'Registered. Table refreshed.'
                                : `Not registered: ${regResult.reason ?? 'unknown reason'}`}
                        </p>
                    )}
                    <p className={styles.regsFormHint}>
                        Use for late additions during a <code>rank_only</code> active tournament. Backend gates: blocked if status is <code>completed</code>/<code>cancelled</code>; for <code>bracket</code> format, must still be in <code>registration</code>.
                    </p>
                </section>
            )}

            {selectedId !== null && !regsLoading && registrations.length > 0 && (
                <>
                    <div className={styles.regsSearchRow}>
                        <Search size={14} style={{ color: 'var(--text-muted)' }} />
                        <input
                            type="text"
                            className={`input ${styles.regsSearch}`}
                            placeholder="Filter by wallet substring..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <span className={styles.regsCount}>
                                {filtered.length} match{filtered.length === 1 ? '' : 'es'}
                            </span>
                        )}
                    </div>

                    <div className={`card ${styles.regsTableCard}`}>
                        <table className={styles.regsTable}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th className={styles.regsThLeft}>Wallet</th>
                                    <th className={styles.regsThLeft}>Full Address</th>
                                    <th>Registered At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r, i) => (
                                    <tr key={r.id}>
                                        <td>{i + 1}</td>
                                        <td className={`${styles.regsTdLeft} ${styles.regsTdMono}`}>
                                            {shortWallet(r.wallet)}
                                        </td>
                                        <td className={`${styles.regsTdLeft} ${styles.regsTdMono} ${styles.regsTdSmall}`}>
                                            {r.wallet}
                                        </td>
                                        <td className={styles.regsTdMono}>
                                            {new Date(r.registeredAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className={styles.regsNoMatch}>
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
                <div className={`card ${styles.regsEmpty}`}>
                    <p className={styles.regsEmptyText}>
                        No registrations for this tournament.
                    </p>
                </div>
            )}
        </div>
    );
}
