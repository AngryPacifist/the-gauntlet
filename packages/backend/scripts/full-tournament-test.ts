/**
 * Adrena: The Gauntlet — Comprehensive Integration Test
 *
 * Single integrated flow testing both Phase 1 (tournament lifecycle) and
 * Phase 2 (season lifecycle, category endpoints).
 *
 * Flow:
 *   1. Create season (with backtest tournament config)
 *   2. Start season → auto-creates Week 1 tournament
 *   3. Register 30 real Adrena wallets for Week 1 tournament
 *   4. Start → Score → Display → Advance the tournament
 *   5. Verify season status, standings
 *   6. Verify category endpoints
 *   7. Verify admin auth rejection
 *
 * Usage:
 *   npx tsx packages/backend/scripts/full-tournament-test.ts 2>&1
 */

import 'dotenv/config';

const BACKEND_API = 'http://localhost:3001/api';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET not set in .env');
    process.exit(1);
}

// Wallets sourced from the Adrena Mutagen Leaderboard (app.adrena.trade)
const LEADERBOARD_WALLETS = [
    'DaVA8ciisvFhW5fLfmHYEDfNDXjKJv8NtBdYUzZ2iY86',
    'ErVgLQB4hwGe9xegP6R83E6WE1tcRokcsEY1WT9xa9po',
    '8anmrYFmdX6ZUX6ceLfDV7vxuGtnG1v77uqGnjTkf6Wy',
    'EgDYVEsGJtk3pzxxP2E3ctPyUbnCgDDfXcE1cf4gHPNj',
    '3NCrJhLN62RNkAV9qYpA6qJfyWdKTtUpEEiZhfCLzUa7',
    'HjcswYCPRK576h8fJsQLALuYS4GzEyycaTRy2zCyNjqW',
    '7QYoineP55hDmikbPUwsZ57sErE1ztTvhMhwCk8zV5Pu',
    'DWcFRJrpzsrn624983W3qTuYccYnwLnL582gQ8CLohvY',
    'F179GtjoSKgeLDkFR2B5cCN4oTqFpkzQuboonojJb5Z1',
    '6ALGMay8AmcywGAX72ho7JbSucD7zeh4hwMVyXDb9zgy',
    'sigMag9SUGdtwwcH23QDkA3tUCEKTnrSKLcZwF3V4ig',
    '4N69yzFFVrdqBuQi81fdJ7w7JdX5t2hpwKh6potdKMX4',
    'CDUwP2FrQBKNMmr9zsPnneb9KmqWPi453sjdz1qf2bg6',
    'C9jxD53Thg73XgTeb2ehh2LcNjWFs4Pa1jaBCtBgcHnt',
    '8umPs96cv2UYpnDKeUshdUx6Xd3g4CfknrrM1gUg6fbN',
    'A6ELwd76fHMMCtTRRyKXEpeTjeX8C5aN2P1uYsz3qW6j',
    '4QLQUhJEqML1cLvS3baGrHP2TJHjXgUQLE7d2LCGLsLu',
    'Am1B44zvUodKPahohUUjdHjs4HbfhaB7vjroqxzxfy9j',
    '56yW76VPSviUX5YnVnTmxfWYvg9nsAN2c7iUyx8uCcoS',
    '8EJMQy74GJobcozVweMkcPNboGtiCee8qpzjWa5vWHM4',
    '59k6t2RKY9m5QB7rkHYuQZHrQ9Xuf9ywXLrBxp49pKuw',
    'B3qwaaDGVr8qFFr2vg2sFAzETvfgzHo7QHzQCqewcsU8',
    '2o1odPv3HBNwCeQo1rUnAwPLLYc4MrLmexiWcYE7ei6N',
    'HZHXUquiJDkgFjTErxziw97qAhpVDQbjpb58iN2ks5hp',
    '6iGVCaVPn1AHyxvXkocQWfSH61iYxmDLDWRMzRJcFCgQ',
    '4PcPViGTjhiuj9gLPzxnjoCRg1Hu1M3vyfHabG2JqqpH',
    'dutoz9dc3E4kwm53WS7tFJnMRgaLUxzo8jhYLiVgXiS',
    '2SwMcnwKapYzHp2qVnMPKoq2ZuNuouUCd2eeQTqbAowA',
    '7XfwQavG7r9qkRBrDZJZZYjLgZZ37kfau49LJjMjMshJ',
    'GZXqnVpZuyKWdUH34mgijxJVM1LEngoGWoJzEXtXGhBb',
];

async function backendFetch(
    apiPath: string,
    options?: RequestInit,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
    const res = await fetch(`${BACKEND_API}${apiPath}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': ADMIN_SECRET,
            ...options?.headers,
        },
    });
    return res.json() as Promise<{ success: boolean; error?: string; data?: unknown }>;
}

async function main(): Promise<void> {
    console.log('=== Adrena: The Gauntlet — Comprehensive Integration Test ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Wallets: ${LEADERBOARD_WALLETS.length} (from Adrena Mutagen Leaderboard)\n`);

    // ── Step 1: Create season ─────────────────────────────────────────────
    console.log('Step 1: Creating season...');
    const createSeasonRes = await backendFetch('/seasons', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Integration Test Season',
            config: {
                weekCount: 3,
                qualificationSlots: 4,
                tournamentConfig: {
                    bracketSize: 8,
                    roundDurations: [72, 48, 48],
                    useHistoricalWindow: true,
                    historicalWindowDays: 365,
                },
            },
        }),
    });

    if (!createSeasonRes.success) {
        console.log(`  FAILED: ${createSeasonRes.error}`);
        return;
    }

    const seasonId = (createSeasonRes.data as { id: number }).id;
    console.log(`  Season #${seasonId} created (3 weeks, 4 qualification slots)\n`);

    // ── Step 2: Start season → creates Week 1 tournament ──────────────────
    console.log('Step 2: Starting season (creates Week 1 tournament)...');
    const startSeasonRes = await backendFetch(`/seasons/${seasonId}/start`, { method: 'POST' });

    if (!startSeasonRes.success) {
        console.log(`  FAILED: ${startSeasonRes.error}`);
        return;
    }

    const tournamentId = (startSeasonRes.data as { tournamentId: number }).tournamentId;
    console.log(`  Season started → Week 1 tournament #${tournamentId}\n`);

    // Verify season status
    const seasonDetailRes = await backendFetch(`/seasons/${seasonId}`);
    const seasonDetail = seasonDetailRes.data as { name: string; status: string; currentWeek: number };
    console.log(`  Season status: "${seasonDetail.name}" — ${seasonDetail.status}, week ${seasonDetail.currentWeek}\n`);

    // ── Step 3: Register wallets ──────────────────────────────────────────
    console.log('Step 3: Registering wallets...');
    const results: Array<{ wallet: string; registered: boolean; reason?: string }> = [];

    for (const wallet of LEADERBOARD_WALLETS) {
        const regRes = await backendFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ tournamentId, wallet }),
        });

        if (regRes.success) {
            const data = regRes.data as { registered: boolean; reason?: string };
            results.push({ wallet, registered: data.registered, reason: data.reason });
            const label = data.registered ? 'REGISTERED' : `REJECTED: ${data.reason}`;
            console.log(`  ${wallet.slice(0, 10)}... => ${label}`);
        } else {
            results.push({ wallet, registered: false, reason: regRes.error });
            console.log(`  ${wallet.slice(0, 10)}... => ERROR: ${regRes.error}`);
        }
    }

    const registered = results.filter((r) => r.registered);
    console.log(`\n  Registered: ${registered.length} / ${LEADERBOARD_WALLETS.length}\n`);

    if (registered.length < 2) {
        console.log('  Not enough registered wallets. Aborting.');
        return;
    }

    // ── Step 4: Start tournament ──────────────────────────────────────────
    console.log('Step 4: Starting tournament...');
    const startRes = await backendFetch('/admin/start', {
        method: 'POST',
        body: JSON.stringify({ tournamentId }),
    });

    if (!startRes.success) {
        console.log(`  FAILED: ${startRes.error}`);
        return;
    }

    const startData = startRes.data as { roundId: number; bracketCount: number };
    console.log(`  Round #${startData.roundId} — ${startData.bracketCount} bracket(s)`);
    console.log(`  (Backtest mode: scoring uses 365-day historical window)\n`);

    // ── Step 5: Compute CPI scores ────────────────────────────────────────
    console.log('Step 5: Computing CPI scores (fetching live position data)...');
    console.log('  This takes ~30s — fetching positions for each trader from the Adrena API...');
    const scoreRes = await backendFetch(`/admin/score/${startData.roundId}`, {
        method: 'POST',
    });

    if (!scoreRes.success) {
        console.log(`  FAILED: ${scoreRes.error}`);
        return;
    }

    const scoreData = scoreRes.data as { scoredCount: number };
    console.log(`  Scored ${scoreData.scoredCount} trader(s)\n`);

    // ── Step 6: Display round 1 results ───────────────────────────────────
    console.log('Step 6: Round 1 Results\n');
    const bracketRes = await backendFetch(`/tournaments/${tournamentId}/brackets`);

    if (!bracketRes.success) {
        console.log(`  FAILED: ${bracketRes.error}`);
        return;
    }

    const bData = bracketRes.data as {
        round: { roundNumber: number; name: string };
        brackets: Array<{
            bracketNumber: number;
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

    console.log(`  Round ${bData.round.roundNumber}: "${bData.round.name}"\n`);

    for (const bracket of bData.brackets) {
        console.log(`  Bracket ${bracket.bracketNumber}:`);
        console.log(`  ${'Wallet'.padEnd(16)} ${'CPI'.padStart(7)} ${'PnL'.padStart(7)} ${'Risk'.padStart(7)} ${'Cons'.padStart(7)} ${'Act'.padStart(7)}`);
        console.log(`  ${'---'.padEnd(16)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)}`);

        const sorted = [...bracket.entries].sort((a, b) => b.cpiScore - a.cpiScore);
        const halfIdx = Math.ceil(sorted.length / 2);

        sorted.forEach((entry, idx) => {
            const marker = idx < halfIdx ? ' ADV' : ' OUT';
            console.log(
                `${marker} ${entry.wallet.slice(0, 14)}.. ${entry.cpiScore.toFixed(1).padStart(7)} ${entry.pnlScore.toFixed(1).padStart(7)} ${entry.riskScore.toFixed(1).padStart(7)} ${entry.consistencyScore.toFixed(1).padStart(7)} ${entry.activityScore.toFixed(1).padStart(7)}`,
            );
        });
        console.log('');
    }

    // ── Step 7: Advance round ─────────────────────────────────────────────
    console.log('Step 7: Advancing round (eliminating bottom 50%)...');
    const advanceRes = await backendFetch('/admin/advance', {
        method: 'POST',
        body: JSON.stringify({ tournamentId }),
    });

    if (!advanceRes.success) {
        console.log(`  FAILED: ${advanceRes.error}`);
        return;
    }

    const advanceData = advanceRes.data as {
        nextRoundId?: number;
        advanced?: number;
        eliminated?: number;
        completed?: boolean;
    };

    if (advanceData.completed) {
        console.log(`  Tournament COMPLETED\n`);
    } else {
        console.log(`  Advanced: ${advanceData.advanced}, Eliminated: ${advanceData.eliminated}`);
        console.log(`  Next round: #${advanceData.nextRoundId}\n`);
    }

    // ── Step 8: Season verification ───────────────────────────────────────
    console.log('Step 8: Season verification...');

    // Season detail
    const postRoundDetail = await backendFetch(`/seasons/${seasonId}`);
    const prd = postRoundDetail.data as { name: string; status: string; currentWeek: number };
    console.log(`  Season: "${prd.name}" — ${prd.status}, week ${prd.currentWeek}`);

    // Standings
    const standingsRes = await backendFetch(`/seasons/${seasonId}/standings`);
    const standings = standingsRes.data as unknown[];
    console.log(`  Standings: ${standingsRes.success ? `${standings?.length ?? 0} entries` : `FAILED: ${standingsRes.error}`}`);

    // List seasons
    const listRes = await backendFetch('/seasons');
    const seasonList = listRes.data as unknown[];
    console.log(`  Total seasons: ${listRes.success ? seasonList?.length : `FAILED: ${listRes.error}`}\n`);

    // ── Step 9: Category endpoints ────────────────────────────────────────
    console.log('Step 9: Category endpoints...');
    const today = new Date().toISOString().split('T')[0];

    const endpoints = [
        { label: 'All Around (cumulative)', path: `/categories/${tournamentId}/all-around` },
        { label: `All Around (${today})`, path: `/categories/${tournamentId}/all-around/${today}` },
        { label: 'Fisher (cumulative)', path: `/categories/${tournamentId}/fisher` },
        { label: `Fisher (${today})`, path: `/categories/${tournamentId}/fisher/${today}` },
    ];

    for (const ep of endpoints) {
        const r = await backendFetch(ep.path);
        const d = r.data as unknown[];
        console.log(`  ${ep.label}: ${r.success ? `${d?.length ?? 0} entries` : `FAILED: ${r.error}`}`);
    }

    // ── Step 10: Admin auth rejection ─────────────────────────────────────
    console.log('\nStep 10: Admin auth rejection...');

    // Season create without secret
    const noAuthSeason = await fetch(`${BACKEND_API}/seasons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hack Attempt', config: {} }),
    });
    const noAuthSeasonJson = await noAuthSeason.json() as { success: boolean; error?: string };
    console.log(`  POST /seasons (no secret): ${!noAuthSeasonJson.success ? `Rejected ✓` : 'ALLOWED (bug!)'}`);

    // Tournament create without secret
    const noAuthTournament = await fetch(`${BACKEND_API}/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Should Fail' }),
    });
    const noAuthTournamentJson = await noAuthTournament.json() as { success: boolean; error?: string };
    console.log(`  POST /tournaments (no secret): ${!noAuthTournamentJson.success ? `Rejected ✓` : 'ALLOWED (bug!)'}`);

    console.log('\n=== COMPREHENSIVE TEST COMPLETE ===');
}

main().catch(console.error);
