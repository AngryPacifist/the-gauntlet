'use client';

// ============================================================================
// Admin Landing
//
// Command center index for /admin. Sub-routes:
//   - /admin/tournaments   : Tournament CRUD + lifecycle + raffle + categories
//   - /admin/seasons       : Season CRUD + lifecycle
//   - /admin/registrations : View registered wallets per tournament
//   - /admin/analytics     : Analytics + daily metrics + anomaly detection
//
// Admin secret stored in localStorage (key 'adrena_admin_secret'), shared across
// all admin sub-routes. Each sub-route reads on mount; this landing provides the
// canonical entry point. Modal-internal-draft pattern preserved on Create modals
// in tournaments + seasons sub-routes.
//
// Admin is URL-only, not in nav.
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Trophy, Layers, Users, BarChart3, Lock, Unlock, ChevronRight, Dna } from 'lucide-react';
import styles from './page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

interface SubRoute {
    href: string;
    label: string;
    icon: React.ReactNode;
    description: string;
}

const SUB_ROUTES: SubRoute[] = [
    {
        href: '/admin/tournaments',
        label: 'Tournaments',
        icon: <Trophy size={20} />,
        description: 'Create, start, score, advance, cancel, delete tournaments. Raffle controls. Category scoring.',
    },
    {
        href: '/admin/seasons',
        label: 'Seasons',
        icon: <Layers size={20} />,
        description: 'Multi-week season lifecycle: create, start, advance week, complete.',
    },
    {
        href: '/admin/registrations',
        label: 'Registrations',
        icon: <Users size={20} />,
        description: 'View registered wallets per tournament.',
    },
    {
        href: '/admin/analytics',
        label: 'Analytics',
        icon: <BarChart3 size={20} />,
        description: 'Round stats, top performers. Daily position metrics + quest anomaly detection.',
    },
    {
        href: '/admin/mutagen',
        label: 'Mutagen',
        icon: <Dna size={20} />,
        description: 'Mutagen epochs: create, configure scoring weights, activate, marketing awards, bootstrap.',
    },
];

export default function AdminLandingPage() {
    const [adminSecret, setAdminSecret] = useState('');
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
        setAdminSecret(stored);
        setHydrated(true);
    }, []);

    function saveSecret(value: string) {
        setAdminSecret(value);
        if (value) {
            localStorage.setItem(ADMIN_SECRET_KEY, value);
        } else {
            localStorage.removeItem(ADMIN_SECRET_KEY);
        }
    }

    return (
        <div className="container">
            <header className="page-header">
                <h1 className="page-header__title">
                    <Shield size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Admin Command Center
                </h1>
                <p className="page-header__subtitle">
                    Tournament + season lifecycle, registrations, analytics. URL-only, not in nav.
                </p>
            </header>

            {/* Authentication, shared via localStorage across all admin sub-routes */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Authentication</h2>
                <div className={styles.secretRow}>
                    <input
                        type="password"
                        className="input input--mono"
                        placeholder="Enter admin secret..."
                        value={adminSecret}
                        onChange={(e) => saveSecret(e.target.value)}
                    />
                    <span className={styles.secretHint}>
                        {hydrated && adminSecret ? (
                            <><Unlock size={14} style={{ color: 'var(--status-success)', marginRight: 4 }} /> Authenticated · saved in localStorage</>
                        ) : (
                            <><Lock size={14} style={{ marginRight: 4 }} /> Required for admin actions across all sub-routes</>
                        )}
                    </span>
                </div>
            </section>

            {/* Sub-route grid */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Sections</h2>
                <div className={styles.subRouteGrid}>
                    {SUB_ROUTES.map((route) => (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={`card card--hoverable ${styles.subRouteCard}`}
                        >
                            <div className={styles.subRouteHead}>
                                <span className={styles.subRouteIcon}>{route.icon}</span>
                                <h3 className={styles.subRouteLabel}>{route.label}</h3>
                                <span className={styles.subRouteArrow}>
                                    <ChevronRight size={16} />
                                </span>
                            </div>
                            <p className={styles.subRouteDesc}>
                                {route.description}
                            </p>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
