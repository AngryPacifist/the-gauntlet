// ============================================================================
// Database Connection + Drizzle Instance
// ============================================================================

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Resolve .env from the monorepo root (two levels up from packages/backend/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '..', '..', '.env');
dotenv.config({ path: envPath });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    max: 10,
});

export const db = drizzle(pool, { schema });
export { pool };
