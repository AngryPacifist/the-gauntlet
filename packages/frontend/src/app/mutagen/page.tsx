'use client';

// ============================================================================
// /mutagen: public Mutagen leaderboard + wallet search.
//
// Search routes to /mutagen/[wallet] (on-demand live score). Leaderboard reads
// existing rows: Current sub-epoch (default) or Cumulative across the epoch.
// Reuses the global .leaderboard-table / .rank-badge styling (native to Forge).
// ============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    getMutagenLeaderboard,
    type MutagenLeaderboardRow,
    type MutagenLeaderboardView,
} from '@/lib/api';
import { Search, Dna } from 'lucide-react';
import styles from './page.module.css';

function shortWallet(w: string): string {
    return w.length <= 12 ? w : `${w.slice(0, 4)}…${w.slice(-4)}`;
}
function fmt(n: number, d = 1): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function MutagenLeaderboardPage() {
    const router = useRouter();
    const [view, setView] = useState<MutagenLeaderboardView>('current');
    const [rows, setRows] = useState<MutagenLeaderboardRow[] | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [q, setQ] = useState('');

    useEffect(() => {
        let cancelled = false;
        setRows(null);
        setErr(null);
        getMutagenLeaderboard(view)
            .then((r) => { if (!cancelled) setRows(r); })
            .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load leaderboard'); });
        return () => { cancelled = true; };
    }, [view]);

    function onSearch(e: FormEvent) {
        e.preventDefault();
        const w = q.trim();
        if (w) router.push(`/mutagen/${encodeURIComponent(w)}`);
    }

    return (
        <div className="container">
            <div className={styles.head}>
                <div>
                    <h1 className={styles.title}>
                        <Dna size={24} className={styles.titleIcon} /> Mutagen Leaderboard
                    </h1>
                    <p className={styles.sub}>Live R2 scoring across 5 activities · search any wallet for its live breakdown</p>
                </div>
                <form className={styles.search} onSubmit={onSearch}>
                    <Search size={16} />
                    <input
                        className={styles.searchInput}
                        placeholder="Search any wallet address…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        spellCheck={false}
                    />
                </form>
            </div>

            <div className="tabs">
                <button className={`tab ${view === 'current' ? 'tab--active' : ''}`} onClick={() => setView('current')}>
                    Current sub-epoch
                </button>
                <button className={`tab ${view === 'cumulative' ? 'tab--active' : ''}`} onClick={() => setView('cumulative')}>
                    Cumulative (epoch)
                </button>
            </div>

            {!rows && !err && (
                <div className="loading-state"><div className="spinner" /><p>Loading leaderboard…</p></div>
            )}
            {err && <div className="card error-state"><p>{err}</p></div>}
            {rows && rows.length === 0 && (
                <div className="card empty-state">
                    <p className="empty-state__title">No scores yet</p>
                    <p>Search a wallet above to compute the first live score — it joins the board automatically.</p>
                </div>
            )}
            {rows && rows.length > 0 && (
                <div className="leaderboard-table-container">
                    <table className="leaderboard-table">
                        <thead>
                            <tr>
                                <th className="col-rank">#</th>
                                <th>Wallet</th>
                                <th className="col-score">LP-mint</th>
                                <th className="col-score">Staking</th>
                                <th className="col-score">Trading</th>
                                <th className="col-score">ADX-LP</th>
                                <th className="col-score">Marketing</th>
                                <th className="col-score">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.user_wallet}>
                                    <td className="col-rank">
                                        <span className={`rank-badge ${r.rank <= 3 ? `rank-${r.rank}` : ''}`}>{r.rank}</span>
                                    </td>
                                    <td>
                                        <Link href={`/mutagen/${r.user_wallet}`} className="wallet-link">{shortWallet(r.user_wallet)}</Link>
                                    </td>
                                    <Cell n={r.points_lp_mint} />
                                    <Cell n={r.points_staking} />
                                    <Cell n={r.points_trading} />
                                    <Cell n={r.points_adx_lp} />
                                    <Cell n={r.points_marketing} />
                                    <td className={`col-score ${styles.tot} ${r.rank === 1 ? styles.totTop : ''}`}>{fmt(r.total_points, 2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Cell({ n }: { n: number }) {
    return <td className={`col-score ${n > 0 ? '' : styles.zero}`}>{fmt(n)}</td>;
}
