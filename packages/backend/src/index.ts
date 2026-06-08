// ============================================================================
// Express Server Entry Point
// ============================================================================

// Boot-time env validation. Side effect of importing config/env.js is loading
// the monorepo-root .env via path traversal; calling validateEnv() throws
// loudly if any required var is missing. Must run before any module that
// reads process.env directly.
import { validateEnv } from './config/env.js';
validateEnv();

// Boot-time PDA sanity check. Verifies Adrena's program-derived mint
// addresses still reproduce the canonical pubkeys pinned in
// solana-constants.ts. Throws loudly if Adrena's program ID or seed scheme
// has changed upstream, protecting against silent corruption in every
// Mutagen scorer.
import { assertCanonicalPdas } from './services/adrena-pda.js';
assertCanonicalPdas();

import express from 'express';
import cors from 'cors';
import tournamentRoutes from './routes/tournaments.js';
import registrationRoutes from './routes/registration.js';
import adminRoutes from './routes/admin.js';
import bracketsRoutes from './routes/brackets.js';
import seasonsRoutes from './routes/seasons.js';
import categoriesRoutes from './routes/categories.js';
import questRoutes from './routes/quests.js';
import raffleRoutes from './routes/raffle.js';
import leaderboardRoutes from './routes/leaderboard.js';
import priceRoutes from './routes/prices.js';
import mutagenRoutes from './routes/mutagen.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        data: {
            service: 'adrena-the-gauntlet',
            status: 'healthy',
            timestamp: new Date().toISOString(),
        },
    });
});

// API Routes
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/register', registrationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/brackets', bracketsRoutes);
app.use('/api/seasons', seasonsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/raffle', raffleRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/prices', priceRoutes);
// Mutagen read API. Mounted at /api because its two routes have distinct
// prefixes: /api/mutagen-leaderboard and /api/mutagen/wallet/:wallet.
app.use('/api', mutagenRoutes);

// 404 handler
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   ⚔️  ADRENA: THE GAUNTLET                         ║
║   Trading Competition Engine                     ║
║                                                  ║
║   Server running on port ${PORT}                  ║
║   API: http://localhost:${PORT}/api               ║
║                                                  ║
╚══════════════════════════════════════════════════╝
  `);

    // Start automated tournament scheduler
    startScheduler();
});

// Graceful shutdown
function shutdown(signal: string) {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    server.close(() => {
        console.log('[Server] HTTP server closed');
        process.exit(0);
    });
    // Force exit after 10 seconds if server doesn't close
    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
