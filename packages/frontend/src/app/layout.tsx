'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Swords } from 'lucide-react';
import './globals.css';
import { listTournaments } from '@/lib/api';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Phase 5 item 18: dynamic "Tournament" link target.
  // - Resolves to the current active tournament (singleton per item 21).
  // - Falls back to most-recent completed tournament (D-18.1).
  // - Format-aware: Forge (rank_only) → /leaderboard/:id, Gauntlet (bracket) → /tournament/:id
  //   (the bracket-format /tournament/:id auto-redirects to /leaderboard/:id for rank_only,
  //    so direct routing avoids the bounce flash).
  // - Disabled (renders as non-clickable span) if zero tournaments exist (cold start).
  // - Fetched once on mount. Admin actions in another tab → user refreshes to update.
  const [tournamentLink, setTournamentLink] = useState<{ href: string; disabled: boolean }>({
    href: '#',
    disabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const all = await listTournaments();
        if (cancelled) return;
        if (all.length === 0) {
          setTournamentLink({ href: '#', disabled: true });
          return;
        }
        // Prefer active; else most-recent completed; else most-recent overall (createdAt DESC).
        const target =
          all.find((t) => t.status === 'active')
          ?? all.find((t) => t.status === 'completed')
          ?? all[0];
        const isForge = target.config?.format === 'rank_only';
        const href = isForge ? `/leaderboard/${target.id}` : `/tournament/${target.id}`;
        setTournamentLink({ href, disabled: false });
      } catch (err) {
        console.error('[Layout] Failed to resolve Tournament link target:', err);
        if (!cancelled) setTournamentLink({ href: '#', disabled: true });
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, []);

  // Phase 5 item 18: simplified 3-link nav.
  // Removed from nav: Dashboard, The Forge, Admin (D-18.2 keeps `/` reachable via logo + direct URL;
  // Forge URL-only at /forge; Admin URL-only at /admin per Round 3 + definitive item 19).
  // Logo (below) keeps "The Gauntlet" platform branding (D-18.5) and links to / (D-18.4).
  const navLinks: Array<{ href: string; label: string; disabled: boolean }> = [
    { href: tournamentLink.href, label: 'Tournament', disabled: tournamentLink.disabled },
    { href: '/seasons', label: 'Seasons', disabled: false },
    { href: '/leaderboard', label: 'Leaderboard', disabled: false },
  ];

  return (
    <html lang="en">
      <head>
        <title>Adrena: The Gauntlet — Trading Competition Engine</title>
        <meta
          name="description"
          content="Bracket-style elimination trading competitions on Adrena. Compete, survive, conquer."
        />
      </head>
      <body>
        {/* Trailing slash intentional: hides nav on /leaderboard/[id] (per-tournament view, Phase 1 item 1)
            but SHOWS nav on /leaderboard (Phase 5 cumulative LB, item 20 — nav-accessible feature). */}
        {!pathname.startsWith('/leaderboard/') && (
          <nav className="nav">
            <div className="container nav__inner">
              <Link href="/" className="nav__logo">
                <Swords size={20} strokeWidth={2.5} />
                <span className="nav__logo-text">The Gauntlet</span>
              </Link>
              <div className="nav__links">
                {navLinks.map((link) => {
                  // Disabled link (Tournament with no tournaments to point to): non-clickable span.
                  // Skip active-state computation since there's no destination.
                  if (link.disabled) {
                    return (
                      <span
                        key={link.label}
                        className="nav__link"
                        title="No tournament available"
                        style={{ opacity: 0.4, cursor: 'not-allowed' }}
                      >
                        {link.label}
                      </span>
                    );
                  }
                  // Active match: pathname starts with the link's href.
                  // Tournament link's href is dynamic (`/tournament/:id` or `/leaderboard/:id`)
                  // so startsWith handles both shapes correctly.
                  const isActive = pathname.startsWith(link.href);
                  return (
                    <Link
                      key={link.label}
                      href={link.href}
                      className={`nav__link${isActive ? ' nav__link--active' : ''}`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
