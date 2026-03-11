// ============================================================================
// Express Server Entry Point
// ============================================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import tournamentRoutes from './routes/tournaments.js';
import registrationRoutes from './routes/registration.js';
import adminRoutes from './routes/admin.js';
import bracketsRoutes from './routes/brackets.js';
import seasonsRoutes from './routes/seasons.js';
import categoriesRoutes from './routes/categories.js';
import { startScheduler } from './services/scheduler.js';

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
app.listen(PORT, () => {
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

export default app;
