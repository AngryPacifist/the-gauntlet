'use client';

// ============================================================================
// /mutagen/[wallet]: per-wallet Mutagen breakdown.
//
// On-demand: the first lookup of a wallet computes its live score (~3-5s);
// subsequent lookups hit the 1h cache. Handles the API's distinct states —
// loading / in-progress (202, auto-retried) / no active epoch (404) / invalid.
//
// The breakdown shows each Activity's WEIGHTED CONTRIBUTION, not just its raw
// score: a raw 188.5 staking score at 5% weight contributes less than a raw 39
// trading score at 30%. Bars are sized by contribution so the weighting reads
// correctly. weighted sum × meta-mutation = total Mutagen.
// ============================================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    getMutagenWalletScore,
    type MutagenWalletResult,
    type MutagenWalletScore,
} from '@/lib/api';
import {
    ChevronLeft, Copy, Check, Sprout, Lock, TrendingUp, Droplets, Megaphone,
    CircleAlert, LoaderCircle, BadgeCheck,
} from 'lucide-react';
import styles from './page.module.css';

const ACTIVITIES = [
    { n: 1, key: 'points_lp_mint', wk: 'a1', label: 'LP minting', Icon: Sprout },
    { n: 2, key: 'points_staking', wk: 'a2', label: 'Staking', Icon: Lock },
    { n: 3, key: 'points_trading', wk: 'a3', label: 'Trading', Icon: TrendingUp },
    { n: 4, key: 'points_adx_lp', wk: 'a4', label: 'ADX-LP', Icon: Droplets },
    { n: 5, key: 'points_marketing', wk: 'a5', label: 'Marketing', Icon: Megaphone },
] as const;

interface ActivityDetail {
    activity: number;
    baseScore: number;
    mutationFactor: number;
    finalScore: number;
    qualified: boolean;
}

function shortWallet(w: string): string {
    return w.length <= 14 ? w : `${w.slice(0, 6)}…${w.slice(-6)}`;
}
function fmt(n: number, d = 2): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function MutagenWalletPage() {
    const params = useParams();
    const wallet = (Array.isArray(params.wallet) ? params.wallet[0] : params.wallet) ?? '';

    const [result, setResult] = useState<MutagenWalletResult | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let attempts = 0;
        setResult(null);
        setErr(null);

        async function load() {
            try {
                const r = await getMutagenWalletScore(wallet);
                if (cancelled) return;
                setResult(r);
                setErr(null);
                // On-demand: first hit may be mid-compute under a lock. Auto-retry.
                if (r.state === 'in_progress' && attempts < 12) {
                    attempts++;
                    timer = setTimeout(load, 3000);
                }
            } catch (e) {
                if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load score');
            }
        }
        load();
        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [wallet]);

    function copyWallet() {
        navigator.clipboard?.writeText(wallet).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }

    // ---- states ----
    if (err) {
        return (
            <div className="container">
                <BackLink />
                <div className="card error-state"><p>{err}</p></div>
            </div>
        );
    }
    if (!result) {
        return (
            <div className="container">
                <BackLink />
                <div className={styles.stateBox}>
                    <LoaderCircle size={30} className={styles.spin} />
                    <div className={styles.stateTitle}>Computing live score…</div>
                    <div className={styles.stateDesc}>
                        Reading on-chain stakes, votes, LP &amp; trades for this wallet. The first lookup takes a few seconds.
                    </div>
                </div>
            </div>
        );
    }
    if (result.state === 'in_progress') {
        return (
            <div className="container">
                <BackLink />
                <div className={styles.stateBox}>
                    <LoaderCircle size={30} className={styles.spin} />
                    <div className={styles.stateTitle}>Scoring in progress</div>
                    <div className={styles.stateDesc}>Another request is computing this wallet. Retrying automatically…</div>
                </div>
            </div>
        );
    }
    if (result.state === 'no_epoch') {
        return (
            <div className="container">
                <BackLink />
                <div className={styles.stateBox}>
                    <CircleAlert size={28} className={styles.stateIcon} />
                    <div className={styles.stateTitle}>No active epoch</div>
                    <div className={styles.stateDesc}>Scoring opens once an epoch is activated. Check back shortly.</div>
                </div>
            </div>
        );
    }
    if (result.state === 'invalid') {
        return (
            <div className="container">
                <BackLink />
                <div className="card error-state"><p>Not a valid wallet address.</p></div>
            </div>
        );
    }

    // ---- ok ----
    const data: MutagenWalletScore = result.data;
    const details = data.details as { activities?: ActivityDetail[] } | null;
    const byActivity = (n: number) => details?.activities?.find((a) => a.activity === n);

    const acts = ACTIVITIES.map((a) => {
        const raw = data[a.key] as number;
        const weight = data.weights[a.wk];
        const contribution = raw * weight;
        const d = byActivity(a.n);
        return {
            ...a,
            raw,
            weight,
            contribution,
            base: d?.baseScore ?? raw,
            mutation: d?.mutationFactor ?? 1,
            qualified: d?.qualified ?? raw > 0,
        };
    });
    const maxContribution = Math.max(...acts.map((x) => x.contribution), 0.0001);

    return (
        <div className="container">
            <BackLink />

            <div className={styles.hero}>
                <div className={styles.heroTop}>
                    <span className={styles.walletPill}>
                        <span className={styles.dot} />
                        {shortWallet(wallet)}
                        <button className={styles.iconBtn} onClick={copyWallet} title="Copy address">
                            {copied ? <Check size={15} /> : <Copy size={15} />}
                        </button>
                    </span>
                    <span className={styles.secLabel}>
                        Sub-epoch #{data.sub_epoch_id} · {data.cached ? (data.stale ? 'cached (refreshing)' : 'cached') : 'just computed'}
                    </span>
                </div>

                <div className={styles.heroBody}>
                    <div className={styles.totalBlock}>
                        <span className={styles.secLabel}>Total Mutagen</span>
                        <span className={styles.totalNum}>{fmt(data.total_points)}</span>
                    </div>
                    <div className={styles.metaSide}>
                        <span className={styles.secLabel}>Cross-activity meta-mutation</span>
                        <div className={styles.metaChip}>
                            <span className={styles.metaX}>×{fmt(data.meta_mutation_multiplier)}</span>
                            <span className={styles.metaLbl}>Meta multiplier</span>
                        </div>
                        <div className={styles.qualDots}>
                            {[1, 2, 3, 4, 5].map((i) => (
                                <span
                                    key={i}
                                    className={`${styles.pip} ${i <= (data.qualified_count ?? 0) ? styles.pipOn : ''}`}
                                />
                            ))}
                            <span className={styles.qualText}>
                                {data.qualified_count ?? 0} of 5 activities qualified
                            </span>
                        </div>
                    </div>
                </div>

                <div className={styles.formula}>
                    <span className={styles.fItem}><span className={styles.fTag}>Weighted sum</span><span className={styles.fVal}>{fmt(data.weighted_sum ?? 0)}</span></span>
                    <span className={styles.fOp}>×</span>
                    <span className={styles.fItem}><span className={styles.fTag}>Meta</span><span className={styles.fVal}>{fmt(data.meta_mutation_multiplier)}</span></span>
                    <span className={styles.fOp}>=</span>
                    <span className={styles.fItem}><span className={styles.fTag}>Total Mutagen</span><span className={styles.fRes}>{fmt(data.total_points)}</span></span>
                </div>
            </div>

            <div className={styles.panel}>
                <div className={styles.panelHead}>
                    <span className={styles.panelTitle}>Activity breakdown</span>
                    <span className={styles.secLabel}>raw score × weight = contribution</span>
                </div>

                {acts.map((a) => {
                    const off = a.contribution <= 0;
                    const width = off ? 2 : Math.max(4, (a.contribution / maxContribution) * 100);
                    return (
                        <div key={a.n} className={`${styles.act} ${off ? styles.actOff : ''}`}>
                            <div className={styles.actName}>
                                <span className={styles.actIcon}><a.Icon size={18} /></span>
                                <span>
                                    <span className={styles.actNm}>{a.label}</span>
                                    <span className={styles.actWt}>{fmt(a.weight * 100, 0)}% weight</span>
                                </span>
                            </div>
                            <div className={styles.actBarWrap}>
                                <div className={styles.actBar}><div className={styles.actFill} style={{ width: `${width}%` }} /></div>
                                <div className={styles.actDetail}>
                                    {off ? (
                                        <span className={styles.muted}>no qualifying activity this epoch</span>
                                    ) : (
                                        <>
                                            <span className={styles.b}>base {fmt(a.base, 1)}</span>
                                            {a.mutation > 1 ? <> × {fmt(a.mutation)} mutation</> : null}
                                            {' = '}<span className={styles.b}>{fmt(a.raw, 1)}</span> raw
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className={styles.actRight}>
                                <div className={`${styles.actContrib} ${off ? styles.actContribZero : ''}`}>{fmt(a.contribution)}</div>
                                {a.qualified ? (
                                    <span className={styles.check}><BadgeCheck size={12} /> Qualified</span>
                                ) : (
                                    <span className={styles.dash}>— Not qualified</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function BackLink() {
    return (
        <Link href="/mutagen" className={styles.back}>
            <ChevronLeft size={15} /> Back to leaderboard
        </Link>
    );
}
