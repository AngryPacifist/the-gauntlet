'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSeasons, type Season } from '@/lib/api';
import { Trophy, Calendar, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

export default function SeasonsPage() {
    const [seasons, setSeasons] = useState<Season[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadSeasons();
    }, []);

    async function loadSeasons() {
        try {
            setLoading(true);
            const data = await listSeasons();
            setSeasons(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load seasons');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="container">
                <div className={styles.center}>
                    <div className="spinner" />
                    <p className={styles.loading}>Loading seasons...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container">
                <div className={`card ${styles.errorCard}`}>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className="page-header">
                <h1 className="page-header__title">
                    <Trophy size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Seasons
                </h1>
                <p className="page-header__subtitle">
                    Multi-week competitive seasons with qualification rounds and Grand Finals
                </p>
            </header>

            {seasons.length === 0 ? (
                <div className={`card ${styles.empty}`}>
                    <p className={styles.emptyTitle}>No seasons yet.</p>
                    <p className={styles.emptySub}>
                        Seasons are created by admins from the Admin panel.
                    </p>
                </div>
            ) : (
                <div className={styles.cardGrid}>
                    {seasons.map((season, idx) => (
                        <Link
                            key={season.id}
                            href={`/season/${season.id}`}
                            className={`card card--hoverable ${styles.seasonCard}`}
                            style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                            <div className={styles.cardHead}>
                                <h2 className={styles.cardName}>{season.name}</h2>
                                <span className={`badge badge--${season.status}`}>
                                    {season.status}
                                </span>
                            </div>

                            <div className={styles.cardStats}>
                                <div className={styles.cardStat}>
                                    <span className={styles.cardStat__label}>
                                        <Calendar size={10} />
                                        Week
                                    </span>
                                    <span className={styles.cardStat__value}>
                                        {season.currentWeek} / {season.config.weekCount}
                                    </span>
                                </div>
                                <div className={styles.cardStat}>
                                    <span className={styles.cardStat__label}>Qualification Slots</span>
                                    <span className={styles.cardStat__value}>
                                        {season.config.qualificationSlots}
                                    </span>
                                </div>
                            </div>

                            <div className={styles.cardFooter}>
                                View Season <ChevronRight size={12} />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
