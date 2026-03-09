'use client';

import { usePathname } from 'next/navigation';
import { Swords } from 'lucide-react';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Dashboard' },
    { href: '/register', label: 'Register' },
    { href: '/admin', label: 'Admin' },
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
        <nav className="nav">
          <div className="container nav__inner">
            <a href="/" className="nav__logo">
              <Swords size={20} strokeWidth={2.5} />
              <span className="nav__logo-text">The Gauntlet</span>
            </a>
            <div className="nav__links">
              {navLinks.map((link) => {
                const isActive =
                  link.href === '/'
                    ? pathname === '/'
                    : pathname.startsWith(link.href);
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    className={`nav__link${isActive ? ' nav__link--active' : ''}`}
                  >
                    {link.label}
                  </a>
                );
              })}
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
