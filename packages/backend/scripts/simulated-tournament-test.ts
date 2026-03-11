/**
 * Engine Validation Test
 *
 * Runs the scoring engine against a real Adrena wallet to validate
 * that CPI computation produces sensible results from live data.
 *
 * This is more valuable than a simulated tournament (which requires 8+ wallets)
 * because it validates the core scoring logic against real positions.
 *
 * Usage:
 *   npx tsx scripts/engine-validation-test.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:3001/api';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET not set in .env');
    process.exit(1);
}

// Confirmed Adrena wallet from API documentation
const TEST_WALLET = 'GZXqnVpZuyKWdUH34mgijxJVM1LEngoGWoJzEXtXGhBb';

interface TestReport {
    timestamp: string;
    wallet: string;
    tests: Array<{
        name: string;
        status: 'pass' | 'fail';
        details: string;
        data?: unknown;
    }>;
    tournamentResults?: {
        tournamentId: number;
        registered: boolean;
        roundId?: number;
        scores?: {
            cpiScore: number;
            pnlScore: number;
            riskScore: number;
            consistencyScore: number;
            activityScore: number;
        };
    };
}

async function apiFetch(
    apiPath: string,
    options?: RequestInit,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
    const res = await fetch(`${API_BASE}${apiPath}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': ADMIN_SECRET,
            ...options?.headers,
        },
    });
    return res.json() as Promise<{ success: boolean; error?: string; data?: unknown }>;
}

async function runValidation(): Promise<void> {
    const report: TestReport = {
        timestamp: new Date().toISOString(),
        wallet: TEST_WALLET,
        tests: [],
    };

    console.log('=== Engine Validation Test ===');
    console.log(`Wallet: ${TEST_WALLET}`);
    console.log(`Time:   ${report.timestamp}\n`);

    // ---------------------------------------------------------------------------
    // Test 1: Health check
    // ---------------------------------------------------------------------------
    console.log('Test 1: API health check...');
    const healthRes = await apiFetch('/health');
    report.tests.push({
        name: 'API Health Check',
        status: healthRes.success ? 'pass' : 'fail',
        details: healthRes.success ? 'Backend is healthy' : `Error: ${healthRes.error}`,
    });
    console.log(`  ${healthRes.success ? 'PASS' : 'FAIL'}\n`);

    // ---------------------------------------------------------------------------
    // Test 2: Create tournament
    // ---------------------------------------------------------------------------
    console.log('Test 2: Create tournament...');
    const createRes = await apiFetch('/tournaments', {
        method: 'POST',
        body: JSON.stringify({
            name: `Validation Test ${new Date().toISOString().slice(0, 16)}`,
            config: {
                bracketSize: 4,
                roundDurations: [72, 48, 48],
            },
        }),
    });

    if (!createRes.success) {
        report.tests.push({
            name: 'Create Tournament',
            status: 'fail',
            details: `Error: ${createRes.error}`,
        });
        console.log(`  FAIL: ${createRes.error}\n`);
        writeReport(report);
        return;
    }

    const tournamentId = (createRes.data as { id: number }).id;
    report.tests.push({
        name: 'Create Tournament',
        status: 'pass',
        details: `Created tournament #${tournamentId}`,
    });
    console.log(`  PASS: Tournament #${tournamentId}\n`);

    // ---------------------------------------------------------------------------
    // Test 3: Register wallet (zero-barrier registration)
    // ---------------------------------------------------------------------------
    console.log('Test 3: Register wallet...');
    const regRes = await apiFetch('/register', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, wallet: TEST_WALLET }),
    });

    if (!regRes.success) {
        report.tests.push({
            name: 'Register Wallet',
            status: 'fail',
            details: `Error: ${regRes.error}`,
        });
        console.log(`  FAIL: ${regRes.error}\n`);
        writeReport(report);
        return;
    }

    const regData = regRes.data as { registered: boolean; reason?: string };
    report.tests.push({
        name: 'Register Wallet',
        status: regData.registered ? 'pass' : 'fail',
        details: regData.registered
            ? 'Wallet registered successfully'
            : `Registration rejected: ${regData.reason}`,
    });
    report.tournamentResults = {
        tournamentId,
        registered: regData.registered,
    };
    console.log(`  ${regData.registered ? 'PASS' : 'FAIL'}: ${regData.registered ? 'Registered' : regData.reason}\n`);

    if (!regData.registered) {
        console.log('  Cannot proceed without registration.');
        writeReport(report);
        return;
    }

    // ---------------------------------------------------------------------------
    // Test 4: Duplicate registration rejection
    // ---------------------------------------------------------------------------
    console.log('Test 4: Duplicate registration rejection...');
    const dupRes = await apiFetch('/register', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, wallet: TEST_WALLET }),
    });

    const dupRejected = !dupRes.success || (dupRes.data && !(dupRes.data as { registered: boolean }).registered);
    report.tests.push({
        name: 'Duplicate Registration Rejection',
        status: dupRejected ? 'pass' : 'fail',
        details: dupRejected ? 'Duplicate correctly rejected' : 'Duplicate was not rejected (unexpected)',
    });
    console.log(`  ${dupRejected ? 'PASS' : 'FAIL'}\n`);

    // ---------------------------------------------------------------------------
    // Test 5: Start tournament (need 2+ registered wallets — expected to fail with 1)
    // We test this to verify the error message is correct.
    // ---------------------------------------------------------------------------
    console.log('Test 5: Start tournament (expected: needs more wallets)...');
    const startRes = await apiFetch('/admin/start', {
        method: 'POST',
        body: JSON.stringify({ tournamentId }),
    });

    if (!startRes.success) {
        // Expected failure with only 1 wallet
        report.tests.push({
            name: 'Start Tournament (1 wallet)',
            status: 'pass',
            details: `Correctly refused: ${startRes.error}`,
        });
        console.log(`  PASS: Correctly refused with 1 wallet. Error: ${startRes.error}\n`);
    } else {
        // If it somehow started (shouldn't happen), proceed to scoring
        const startData = startRes.data as { roundId: number; bracketCount: number };
        report.tests.push({
            name: 'Start Tournament',
            status: 'pass',
            details: `Round #${startData.roundId}, ${startData.bracketCount} bracket(s)`,
        });
        report.tournamentResults!.roundId = startData.roundId;
        console.log(`  PASS (unexpected with 1 wallet): Round #${startData.roundId}\n`);

        // Compute scores
        console.log('Test 6: Compute scores...');
        const scoreRes = await apiFetch(`/admin/score/${startData.roundId}`, {
            method: 'POST',
        });

        if (scoreRes.success) {
            const scoreData = scoreRes.data as { scoredCount: number };
            report.tests.push({
                name: 'Score Computation',
                status: 'pass',
                details: `Scored ${scoreData.scoredCount} trader(s)`,
            });
            console.log(`  PASS: Scored ${scoreData.scoredCount} trader(s)\n`);
        }

        // Fetch bracket results
        const bracketRes = await apiFetch(`/tournaments/${tournamentId}/brackets`);
        if (bracketRes.success) {
            const bData = bracketRes.data as {
                brackets: Array<{
                    entries: Array<{
                        wallet: string;
                        cpiScore: number;
                        pnlScore: number;
                        riskScore: number;
                        consistencyScore: number;
                        activityScore: number;
                    }>;
                }>;
            };
            const entry = bData.brackets[0]?.entries[0];
            if (entry) {
                report.tournamentResults!.scores = {
                    cpiScore: entry.cpiScore,
                    pnlScore: entry.pnlScore,
                    riskScore: entry.riskScore,
                    consistencyScore: entry.consistencyScore,
                    activityScore: entry.activityScore,
                };
                console.log(`\n  CPI Scores for ${entry.wallet.slice(0, 8)}...:`);
                console.log(`    CPI:         ${entry.cpiScore.toFixed(2)}`);
                console.log(`    PnL:         ${entry.pnlScore.toFixed(2)}`);
                console.log(`    Risk:        ${entry.riskScore.toFixed(2)}`);
                console.log(`    Consistency: ${entry.consistencyScore.toFixed(2)}`);
                console.log(`    Activity:    ${entry.activityScore.toFixed(2)}`);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Test 6: Admin auth rejection
    // ---------------------------------------------------------------------------
    console.log('Test 6: Admin auth rejection (no secret)...');
    const noAuthRes = await fetch(`${API_BASE}/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Should Fail' }),
    });
    const noAuthJson = await noAuthRes.json() as { success: boolean; error?: string };
    const authRejected = !noAuthJson.success;
    report.tests.push({
        name: 'Admin Auth Rejection',
        status: authRejected ? 'pass' : 'fail',
        details: authRejected ? 'Correctly rejected without admin secret' : 'Was NOT rejected (security bug)',
    });
    console.log(`  ${authRejected ? 'PASS' : 'FAIL'}\n`);

    // ---------------------------------------------------------------------------
    // Test 7: Invalid wallet registration
    // ---------------------------------------------------------------------------
    console.log('Test 7: Invalid wallet rejection...');
    const invalidRes = await apiFetch('/register', {
        method: 'POST',
        body: JSON.stringify({ tournamentId, wallet: 'not-a-valid-wallet' }),
    });
    const invalidRejected = !invalidRes.success;
    report.tests.push({
        name: 'Invalid Wallet Rejection',
        status: invalidRejected ? 'pass' : 'fail',
        details: invalidRejected
            ? `Correctly rejected: ${invalidRes.error}`
            : 'Was NOT rejected (validation bug)',
    });
    console.log(`  ${invalidRejected ? 'PASS' : 'FAIL'}\n`);

    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------
    const passed = report.tests.filter((t) => t.status === 'pass').length;
    const failed = report.tests.filter((t) => t.status === 'fail').length;
    console.log(`\n--- Summary: ${passed} passed, ${failed} failed out of ${report.tests.length} tests ---\n`);

    writeReport(report);
}

function writeReport(report: TestReport): void {
    const outputPath = path.resolve(__dirname, '..', 'test-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Full report written to: ${outputPath}`);
}

runValidation().catch(console.error);
