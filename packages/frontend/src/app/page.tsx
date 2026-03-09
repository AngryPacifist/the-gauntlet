'use client';

import { useEffect, useState } from 'react';
import { listTournaments, type Tournament } from '@/lib/api';
import { Swords, Clock, Trophy, XCircle, ArrowRight, Users, ShieldCheck } from 'lucide-react';
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

  function getStatusIcon(status: string) {
    switch (status) {
      case 'registration': return <Clock size={14} />;
      case 'active': return <Swords size={14} />;
      case 'completed': return <Trophy size={14} />;
      case 'cancelled': return <XCircle size={14} />;
      default: return null;
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'registration': return 'Registration Open';
      case 'active': return 'In Progress';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  }

  const activeCount = tournaments.filter((t) => t.status === 'active').length;
  const registrationCount = tournaments.filter((t) => t.status === 'registration').length;
  const totalCount = tournaments.length;

  return (
    <div className="container">
      <header className="page-header">
        <h1 className="page-header__title">The Gauntlet</h1>
        <p className="page-header__subtitle">
          Bracket-style elimination trading competitions. Survive or be eliminated.
        </p>
      </header>

      {/* Summary Stats */}
      {!loading && !error && tournaments.length > 0 && (
        <div className={`stat-grid ${styles.summaryStats}`}>
          <div className="card stat-card">
            <div className="stat-card__label">
              <Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Active
            </div>
            <div className="stat-card__value stat-card__value--accent">{activeCount}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">
              <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Registration
            </div>
            <div className="stat-card__value">{registrationCount}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">
              <Trophy size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Total
            </div>
            <div className="stat-card__value">{totalCount}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className={styles.center}>
          <div className="spinner" />
          <p className={styles.loadingText}>Loading tournaments...</p>
        </div>
      )}

      {error && (
        <div className={`card ${styles.errorCard}`}>
          <p>{error}</p>
          <button className="btn btn--secondary" onClick={loadTournaments}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && tournaments.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          <ShieldCheck size={48} strokeWidth={1.5} className={styles.emptyIcon} />
          <h2>No Tournaments Yet</h2>
          <p className={styles.emptyText}>
            No Gauntlet tournaments have been created. Go to the{' '}
            <a href="/admin">Admin Panel</a> to create one.
          </p>
        </div>
      )}

      {!loading && tournaments.length > 0 && (
        <div className={styles.tournamentGrid}>
          {tournaments.map((t, i) => (
            <a
              key={t.id}
              href={`/tournament/${t.id}`}
              className={`card ${styles.tournamentCard} ${styles[`status_${t.status}`] || ''}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className={styles.tournamentCardHeader}>
                <h2 className={styles.tournamentName}>{t.name}</h2>
                <span className={`badge badge--${t.status}`}>
                  {getStatusIcon(t.status)}
                  <span style={{ marginLeft: 4 }}>{t.status}</span>
                </span>
              </div>

              <p className={styles.tournamentStatus}>
                {getStatusLabel(t.status)}
              </p>

              <div className={styles.tournamentMeta}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>
                    <Users size={10} style={{ marginRight: 3 }} />
                    Bracket Size
                  </span>
                  <span className={styles.metaValue}>{t.config.bracketSize}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>
                    <Clock size={10} style={{ marginRight: 3 }} />
                    Round Duration
                  </span>
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
                <ArrowRight size={16} className={styles.arrowIcon} />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
