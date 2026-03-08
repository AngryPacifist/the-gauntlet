import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Adrena Battle Royale — Trading Competition Engine',
  description:
    'Bracket-style elimination trading competitions on Adrena. Compete, survive, conquer.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="container nav__inner">
            <a href="/" className="nav__logo">
              <span className="nav__logo-icon">⚔️</span>
              <span className="nav__logo-text">Battle Royale</span>
            </a>
            <div className="nav__links">
              <a href="/" className="nav__link">Dashboard</a>
              <a href="/register" className="nav__link">Register</a>
              <a href="/admin" className="nav__link">Admin</a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
