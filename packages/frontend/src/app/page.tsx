'use client';

import { useEffect, useState } from 'react';
import { listTournaments, type Tournament } from '@/lib/api';
import styles from './page.module.css';

export default function DashboardPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTournaments();
  }, []);

  async function loadTournaments() {
    try {
      setLoading(true);
      const data = await listTournaments();
      setTournaments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
    } finally {
      setLoading(false);
    }
  }

  const statusLabel: Record<string, string> = {
    registration: '📋 Registration Open',
    active: '⚔️ Battle In Progress',
    completed: '🏆 Completed',
    cancelled: '❌ Cancelled',
  };

  return (
    <div className="container">
      <header className="page-header">
        <h1 className="page-header__title">⚔️ Adrena Battle Royale</h1>
        <p className="page-header__subtitle">
          Bracket-style elimination trading competitions. Survive or be eliminated.
        </p>
      </header>

      {loading && (
        <div className={styles.center}>
          <div className="spinner" />
          <p className={styles.loadingText}>Loading tournaments...</p>
        </div>
      )}

      {error && (
        <div className={`card ${styles.errorCard}`}>
          <p>⚠️ {error}</p>
          <button className="btn btn--secondary" onClick={loadTournaments}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && tournaments.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          <div className={styles.emptyIcon}>🏟️</div>
          <h2>No Tournaments Yet</h2>
          <p className={styles.emptyText}>
            No Battle Royale tournaments have been created. Go to the{' '}
            <a href="/admin">Admin Panel</a> to create one.
          </p>
        </div>
      )}

      {!loading && tournaments.length > 0 && (
        <div className={styles.tournamentGrid}>
          {tournaments.map((t) => (
            <a
              key={t.id}
              href={`/tournament/${t.id}`}
              className={`card ${styles.tournamentCard}`}
            >
              <div className={styles.tournamentCardHeader}>
                <h2 className={styles.tournamentName}>{t.name}</h2>
                <span className={`badge badge--${t.status}`}>
                  {t.status}
                </span>
              </div>

              <p className={styles.tournamentStatus}>
                {statusLabel[t.status] || t.status}
              </p>

              <div className={styles.tournamentMeta}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Bracket Size</span>
                  <span className={styles.metaValue}>{t.config.bracketSize}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Round Duration</span>
                  <span className={styles.metaValue}>{t.config.roundDurationHours}h</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Min Trades</span>
                  <span className={styles.metaValue}>{t.config.minHistoricalTrades}</span>
                </div>
              </div>

              <div className={styles.tournamentFooter}>
                <span className={styles.dateText}>
                  Created {new Date(t.createdAt).toLocaleDateString()}
                </span>
                <span className={styles.arrowIcon}>→</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
