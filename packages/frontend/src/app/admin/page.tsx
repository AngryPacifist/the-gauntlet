'use client';

// ============================================================================
// Admin Landing — Phase 5 item 19
//
// Command center index for /admin. Sub-routes:
//   - /admin/tournaments   — Tournament CRUD + lifecycle + raffle + categories
//   - /admin/seasons       — Season CRUD + lifecycle
//   - /admin/registrations — View registered wallets per tournament (NEW)
//   - /admin/analytics     — Analytics + daily metrics + anomaly detection
//
// Admin secret stored in localStorage (key 'adrena_admin_secret') — shared across
// all admin sub-routes. Each sub-route reads on mount; this landing provides the
// canonical entry point. Modal-internal-draft pattern preserved on Create modals
// in tournaments + seasons sub-routes (Phase 4 admin UX fix).
//
// Admin is URL-only — not in nav (item 18 already shipped that change).
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Trophy, Layers, Users, BarChart3, Lock, Unlock, ChevronRight } from 'lucide-react';
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
                    Tournament + season lifecycle, registrations, analytics. URL-only — not in nav.
                </p>
            </header>

            {/* Authentication — shared via localStorage across all admin sub-routes */}
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
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 'var(--space-md)',
                }}>
                    {SUB_ROUTES.map((route) => (
                        <Link
                            key={route.href}
                            href={route.href}
                            className="card card--hoverable"
                            style={{
                                padding: 'var(--space-lg)',
                                textDecoration: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--space-sm)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                <span style={{ color: 'var(--accent-primary, #f59e0b)' }}>{route.icon}</span>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                    {route.label}
                                </h3>
                                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                                    <ChevronRight size={16} />
                                </span>
                            </div>
                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                {route.description}
                            </p>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
