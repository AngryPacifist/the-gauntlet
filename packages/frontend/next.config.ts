import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy API calls to the backend in development
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
  // /register page removed (Phase 3 item 24 — vestigial post nav-restructure).
  // Gauntlet uses inline registration on /tournament/:id; Forge uses the Register
  // button in the Forge page header. 308 permanent tells crawlers + bookmarks
  // the move is final.
  async redirects() {
    return [
      {
        source: '/register',
        destination: '/',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
