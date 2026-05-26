// ============================================================================
// Environment loading + validation + typed access
// ============================================================================
//
// Loads .env from the monorepo root (4 levels up from packages/backend/src/config/).
// Validates that all required vars are present; throws at boot if any are missing.
// Exports a typed `env` object so consumers don't have to do `process.env.X as string`.
//
// IMPORTANT: importing this module triggers .env loading via side effect. Calling
// `validateEnv()` is a one-shot boot-time guard that fails loudly on missing vars.
// ============================================================================

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve .env from the monorepo root.
// File path: packages/backend/src/config/env.ts → 4 `..` → repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '..', '..', '.env');
dotenv.config({ path: ENV_PATH });

const REQUIRED = ['DATABASE_URL', 'ADMIN_SECRET', 'HELIUS_RPC_URL'] as const;

export function validateEnv(): void {
    const missing = REQUIRED.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(
            `[env] missing required vars: ${missing.join(', ')}. ` +
            `Set them in ${ENV_PATH} or your runtime env.`,
        );
    }
}

export const env = {
    DATABASE_URL: process.env.DATABASE_URL as string,
    ADMIN_SECRET: process.env.ADMIN_SECRET as string,
    HELIUS_RPC_URL: process.env.HELIUS_RPC_URL as string,
    ADRENA_API_URL: process.env.ADRENA_API_URL ?? 'https://datapi.adrena.trade',
    PORT: parseInt(process.env.PORT ?? '3001', 10),
    CORS_ORIGIN: process.env.CORS_ORIGIN,
} as const;
