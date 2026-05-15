'use client';

// ============================================================================
// Admin Tournaments
//
// Tournament CRUD + lifecycle (create, start, score, advance, cancel, delete) +
// raffle controls (compute, draw, verify, reset) + category scoring trigger.
//
// Admin secret: shared via localStorage (key 'adrena_admin_secret').
// Modal-internal-draft pattern preserved.
// ============================================================================

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
    listTournaments,
    createTournament,
    updateTournament,
    deleteTournament,
    getTournamentBrackets,
    adminStartTournament,
    adminComputeScores,
    adminAdvanceRound,
    adminCancelTournament,
    adminComputeRaffle,
    adminDrawRaffle,
    verifyRaffleDraw,
    adminScoreCategories,
    adminResetRaffle,
    adminGetTradableAssets,
    getTokenUSDPrices,
    type Tournament,
    type TournamentConfig,
} from '@/lib/api';
import {
    Trophy, Plus, Play, BarChart3, ChevronRight, Trash2, Ban,
    ExternalLink, Terminal, Ticket, Sparkles, CheckCircle2,
    CalendarDays, Lock, RotateCcw, Flame, Swords, ArrowLeft, Compass, Pencil,
} from 'lucide-react';
import { Select } from '@/components/Select';
import { Tooltip } from '@/components/Tooltip';
import styles from '../page.module.css';

const ADMIN_SECRET_KEY = 'adrena_admin_secret';

// feed_id is sourced from the backend /admin/tradable-assets response
// (derived from autonom's source_feed_id in /last-trading-prices) so the
// frontend doesn't carry a parallel hardcoded map.

// Preset prize distribution templates: manual array entry is error-prone,
// preset rule + total pool is cleaner. Admin enters Total Pool; system
// auto-derives skill+raffle arrays from (skillSharePct, raffleSharePct)
// split + (skillCurve, raffleCurve) percentages. Each curve sums to 100.
type PrizeTemplate = {
    id: string;
    label: string;
    skillSharePct: number;       // % of total pool going to skill prizes
    raffleSharePct: number;      // % going to raffle (skillShare + raffleShare = 100)
    skillCurve: number[];        // % within skill share, summing to 100
    raffleCurve: number[];       // % within raffle share, summing to 100
};

const PRIZE_TEMPLATES: PrizeTemplate[] = [
    {
        id: 'standard-80-20-6',
        label: 'Standard 80/20 — 6 skill ranks, 5 raffle winners',
        skillSharePct: 80, raffleSharePct: 20,
        skillCurve: [31.25, 22.5, 17.5, 12.5, 10, 6.25],   // sums to 100
        raffleCurve: [40, 25, 20, 10, 5],                   // sums to 100
    },
    {
        id: 'standard-70-30-5',
        label: 'Standard 70/30 — 5 skill ranks, 5 raffle winners',
        skillSharePct: 70, raffleSharePct: 30,
        skillCurve: [40, 25, 17, 11, 7],                    // sums to 100
        raffleCurve: [40, 25, 20, 10, 5],                   // sums to 100
    },
    {
        id: 'flat-50-50-3',
        label: 'Flat 50/50 — 3 skill ranks, 3 raffle winners',
        skillSharePct: 50, raffleSharePct: 50,
        skillCurve: [50, 30, 20],                           // sums to 100
        raffleCurve: [50, 30, 20],                          // sums to 100
    },
    {
        id: 'winner-take-most-90-10',
        label: 'Winner-take-most 90/10 — single skill winner, 5 raffle winners',
        skillSharePct: 90, raffleSharePct: 10,
        skillCurve: [100],                                  // sums to 100
        raffleCurve: [40, 25, 20, 10, 5],                   // sums to 100
    },
];

function readSecret(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(ADMIN_SECRET_KEY) ?? '';
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

export default function AdminTournamentsPage() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loading, setLoading] = useState(true);
    const [adminSecret, setAdminSecret] = useState('');

    // Create tournament modal (also reused as Edit modal).
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [modalSecretDraft, setModalSecretDraft] = useState('');
    // When non-null, the modal is in EDIT mode for this tournament id.
    // Submit branches: createTournament (null) vs updateTournament (number).
    // Restricted to `registration` status (Edit button only renders for that status).
    const [editingTournamentId, setEditingTournamentId] = useState<number | null>(null);

    // Config fields
    const [cfgFormat, setCfgFormat] = useState<'bracket' | 'rank_only'>('bracket');
    const [cfgBracketSize, setCfgBracketSize] = useState(8);
    const [cfgAdvanceRatio, setCfgAdvanceRatio] = useState(0.5);
    const [cfgRoundDurations, setCfgRoundDurations] = useState('72, 48, 48');
    const [cfgMinCollateral, setCfgMinCollateral] = useState(25);
    const [cfgMinDuration, setCfgMinDuration] = useState(120);
    const [cfgAllAroundMinTradeUsd, setCfgAllAroundMinTradeUsd] = useState(500);
    const [cfgRiskManagerMinSize, setCfgRiskManagerMinSize] = useState(1000);
    const [cfgAllAroundMaxPointsPerAsset, setCfgAllAroundMaxPointsPerAsset] = useState(25);
    const [cfgFisherRankPoints, setCfgFisherRankPoints] = useState('3, 2, 1');
    const [cfgDailyQuestPoints, setCfgDailyQuestPoints] = useState('0.2, 0.15, 0.1, 0.05, 0.01');
    const [cfgMultidayQuestPoints, setCfgMultidayQuestPoints] = useState('0.3, 0.25, 0.2, 0.15, 0.1');
    const [cfgTopPercentCutoff, setCfgTopPercentCutoff] = useState(0.30);
    const [cfgRaffleMinClosedPositions, setCfgRaffleMinClosedPositions] = useState(10);
    const [cfgCpiTicketMultiplier, setCfgCpiTicketMultiplier] = useState(0.5);
    const [cfgQuestTicketMultiplier, setCfgQuestTicketMultiplier] = useState(20);
    const [cfgUseHistoricalWindow, setCfgUseHistoricalWindow] = useState(false);
    const [cfgHistoricalWindowDays, setCfgHistoricalWindowDays] = useState(90);
    const [cfgAssetCount, setCfgAssetCount] = useState(4);
    const [cfgPrizeEnabled, setCfgPrizeEnabled] = useState(false);
    const [cfgPrizeTotalPool, setCfgPrizeTotalPool] = useState(1000);
    const [cfgPrizeCurrency, setCfgPrizeCurrency] = useState<'ADX' | 'USDC'>('ADX');
    const [cfgSkillPrizes, setCfgSkillPrizes] = useState('500, 300, 200');
    const [cfgRafflePrizes, setCfgRafflePrizes] = useState('100, 50, 25');
    // Preset prize distribution mode + state.
    // 'manual' (default) = admin types arrays directly.
    // 'preset' = admin selects template + customizes shares/curves; arrays auto-derive.
    const [cfgPrizeMode, setCfgPrizeMode] = useState<'manual' | 'preset'>('manual');
    const [cfgPresetTemplateId, setCfgPresetTemplateId] = useState<string>(PRIZE_TEMPLATES[0].id);
    const [cfgSkillSharePct, setCfgSkillSharePct] = useState<number>(PRIZE_TEMPLATES[0].skillSharePct);
    const [cfgRaffleSharePct, setCfgRaffleSharePct] = useState<number>(PRIZE_TEMPLATES[0].raffleSharePct);
    const [cfgSkillCurve, setCfgSkillCurve] = useState<string>(PRIZE_TEMPLATES[0].skillCurve.join(', '));
    const [cfgRaffleCurve, setCfgRaffleCurve] = useState<string>(PRIZE_TEMPLATES[0].raffleCurve.join(', '));
    const [cfgAssetList, setCfgAssetList] = useState<Array<{ symbol: string; mint?: string; joinedAt: string; feed_id?: number; lmSteps?: string; lmTolerance?: string }>>([]);
    // Multi-token sponsor entry.
    // Each sponsor contributes a list of tokens with amounts. skillPrizes +
    // rafflePrizes arrays become rank-weight ratios (same shape, reinterpreted).
    // Token entry fields:
    //   - symbol: 'ADX' | 'JTO' | 'USDC' | custom string
    //   - amount: token-denominated quantity (NOT USD)
    //   - mint: optional SPL mint; overrides KNOWN_PRIZE_TOKEN_MINT for this
    //     symbol. Required if admin enters a custom symbol Jupiter can't
    //     resolve via the server-side default map.
    //   - staticUsdPrice: optional fallback USD/token; used by prices.ts only
    //     when both Pyth + Jupiter return null for this token.
    //   - custom: UI flag, true when symbol isn't one of {ADX, JTO, USDC}.
    const [cfgSponsors, setCfgSponsors] = useState<Array<{
        name: string;
        tokens: Array<{
            symbol: string;
            amount: number;
            mint?: string;
            staticUsdPrice?: number;
            custom?: boolean;
        }>;
    }>>([]);
    const [cfgTokenUSDPrices, setCfgTokenUSDPrices] = useState<Record<string, number>>({});
    // State type matches /admin/tradable-assets enriched response.
    // mint = main-pool SPL token mint (set for SOL/JITOSOL/BTC/WBTC/BONK/USDC; undefined for RWAs).
    // synthetic_custody_mint = commodities-pool RWA synthetic-custody PDA (XAU/XAG/WTI only, informational).
    const [cfgTradableAssets, setCfgTradableAssets] = useState<Array<{
        symbol: string;
        feed_id: number;
        sessioned: boolean;
        mint?: string;
        synthetic_custody_mint?: string;
        pool_name: 'main-pool' | 'commodities-pool';
    }>>([]);
    const [cfgTradableAssetsError, setCfgTradableAssetsError] = useState<string | null>(null);

    // Raffle draw modal
    const [showDrawModal, setShowDrawModal] = useState(false);
    const [drawTournamentId, setDrawTournamentId] = useState<number | null>(null);
    const [drawBlockHash, setDrawBlockHash] = useState('');
    const [drawPrizeCount, setDrawPrizeCount] = useState(3);

    // Category scoring modal
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categoryTournamentId, setCategoryTournamentId] = useState<number | null>(null);
    const [categoryDate, setCategoryDate] = useState(new Date().toISOString().split('T')[0]);

    // Action feedback
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [actionLoading, setActionLoading] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showToast(message: string, type: 'success' | 'error') {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    function addLog(msg: string) {
        setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    // Hydrate admin secret from localStorage on mount
    useEffect(() => {
        setAdminSecret(readSecret());
    }, []);

    useEffect(() => {
        if (!showCreateModal) setModalSecretDraft('');
    }, [showCreateModal]);

    const loadTradableAssetsIfReady = async (secret: string) => {
        if (!secret || cfgTradableAssets.length > 0) return;
        try {
            const assets = await adminGetTradableAssets(secret);
            setCfgTradableAssets(assets);
            setCfgTradableAssetsError(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load tradable assets';
            setCfgTradableAssetsError(msg);
            addLog(`Warning: ${msg}. Asset list dropdown falling back to free-text.`);
        }
    };

    async function loadAll() {
        try {
            setLoading(true);
            const t = await listTournaments();
            setTournaments(t);
        } catch {
            addLog('Failed to load tournaments');
            showToast('Failed to load tournaments', 'error');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadAll(); }, []);

    function resetConfigDefaults() {
        // Also clear edit-mode state so next modal-open is a fresh CREATE.
        setEditingTournamentId(null);
        setNewName('');
        setCfgFormat('bracket');
        setCfgBracketSize(8);
        setCfgAdvanceRatio(0.5);
        setCfgRoundDurations('72, 48, 48');
        setCfgMinCollateral(25);
        setCfgMinDuration(120);
        setCfgAllAroundMinTradeUsd(500);
        setCfgRiskManagerMinSize(1000);
        setCfgAllAroundMaxPointsPerAsset(25);
        setCfgFisherRankPoints('3, 2, 1');
        setCfgDailyQuestPoints('0.2, 0.15, 0.1, 0.05, 0.01');
        setCfgMultidayQuestPoints('0.3, 0.25, 0.2, 0.15, 0.1');
        setCfgTopPercentCutoff(0.30);
        setCfgRaffleMinClosedPositions(10);
        setCfgCpiTicketMultiplier(0.5);
        setCfgQuestTicketMultiplier(20);
        setCfgUseHistoricalWindow(false);
        setCfgHistoricalWindowDays(90);
        setCfgAssetCount(4);
        setCfgPrizeEnabled(false);
        setCfgPrizeTotalPool(1000);
        setCfgPrizeCurrency('ADX');
        setCfgSkillPrizes('500, 300, 200');
        setCfgRafflePrizes('100, 50, 25');
        // Reset preset state to first template's defaults
        setCfgPrizeMode('manual');
        setCfgPresetTemplateId(PRIZE_TEMPLATES[0].id);
        setCfgSkillSharePct(PRIZE_TEMPLATES[0].skillSharePct);
        setCfgRaffleSharePct(PRIZE_TEMPLATES[0].raffleSharePct);
        setCfgSkillCurve(PRIZE_TEMPLATES[0].skillCurve.join(', '));
        setCfgRaffleCurve(PRIZE_TEMPLATES[0].raffleCurve.join(', '));
        setCfgAssetList([]);
        // Reset multi-token sponsor state.
        setCfgSponsors([]);
        setCfgTokenUSDPrices({});
    }

    function commitSecret(value: string) {
        setAdminSecret(value);
        if (value) {
            localStorage.setItem(ADMIN_SECRET_KEY, value);
        } else {
            localStorage.removeItem(ADMIN_SECRET_KEY);
        }
    }

    // Populate Create modal state from an existing tournament.
    // Used by handleOpenEdit to pre-fill the form for an EDIT operation.
    // Mirrors resetConfigDefaults but reads from `t.config` instead of defaults.
    function populateCfgFromTournament(t: Tournament) {
        const c = t.config;
        setNewName(t.name);
        setCfgFormat(c.format);
        setCfgBracketSize(c.bracketSize);
        setCfgAdvanceRatio(c.advanceRatio);
        setCfgRoundDurations(c.roundDurations.join(', '));
        setCfgMinCollateral(c.minPositionCollateral);
        setCfgMinDuration(c.minTradeDurationSec);
        setCfgAllAroundMinTradeUsd(c.allAroundMinTradeUsd);
        setCfgRiskManagerMinSize(c.riskManagerMinSize);
        setCfgAllAroundMaxPointsPerAsset(c.allAroundMaxPointsPerAsset);
        setCfgFisherRankPoints(c.fisherRankPoints.join(', '));
        setCfgDailyQuestPoints(c.dailyQuestPoints.join(', '));
        setCfgMultidayQuestPoints(c.multidayQuestPoints.join(', '));
        setCfgTopPercentCutoff(c.topPercentCutoff);
        setCfgRaffleMinClosedPositions(c.raffleMinClosedPositions);
        setCfgCpiTicketMultiplier(c.cpiTicketMultiplier);
        setCfgQuestTicketMultiplier(c.questTicketMultiplier);
        setCfgUseHistoricalWindow(c.useHistoricalWindow);
        setCfgHistoricalWindowDays(c.historicalWindowDays);
        setCfgAssetCount(c.supportedAssetCount);

        if (c.prizeTable) {
            setCfgPrizeEnabled(true);
            setCfgPrizeTotalPool(c.prizeTable.totalPool);
            setCfgPrizeCurrency(c.prizeTable.currency as 'ADX' | 'USDC');
            setCfgSkillPrizes(c.prizeTable.skillPrizes.join(', '));
            setCfgRafflePrizes(c.prizeTable.rafflePrizes.join(', '));
        } else {
            setCfgPrizeEnabled(false);
            setCfgPrizeTotalPool(1000);
            setCfgPrizeCurrency('ADX');
            setCfgSkillPrizes('500, 300, 200');
            setCfgRafflePrizes('100, 50, 25');
        }
        // Edit mode always opens in manual (existing tournaments persist arrays,
        // not percentages; admin can switch to preset to re-derive if desired).
        setCfgPrizeMode('manual');
        setCfgPresetTemplateId(PRIZE_TEMPLATES[0].id);
        setCfgSkillSharePct(PRIZE_TEMPLATES[0].skillSharePct);
        setCfgRaffleSharePct(PRIZE_TEMPLATES[0].raffleSharePct);
        setCfgSkillCurve(PRIZE_TEMPLATES[0].skillCurve.join(', '));
        setCfgRaffleCurve(PRIZE_TEMPLATES[0].raffleCurve.join(', '));

        if (c.assetList && c.assetList.length > 0) {
            setCfgAssetList(c.assetList.map((a) => ({
                symbol: a.symbol,
                mint: a.mint,
                joinedAt: a.joinedAt,
                feed_id: a.feed_id,
                lmSteps: a.lmSteps && a.lmSteps.length > 0 ? a.lmSteps.join(',') : undefined,
                lmTolerance: a.lmTolerance != null ? String(a.lmTolerance) : undefined,
            })));
        } else {
            setCfgAssetList([]);
        }

        // Hydrate sponsors from tokens[] when present.
        // Group flat tokens by sponsor (matches admin form's nested shape).
        if (c.prizeTable?.tokens && c.prizeTable.tokens.length > 0) {
            const grouped = new Map<string, Array<{
                symbol: string; amount: number; mint?: string;
                staticUsdPrice?: number; custom?: boolean;
            }>>();
            for (const t of c.prizeTable.tokens) {
                const arr = grouped.get(t.sponsor) ?? [];
                arr.push({
                    symbol: t.symbol,
                    amount: t.amount,
                    mint: t.mint,
                    staticUsdPrice: t.staticUsdPrice,
                    custom: !['ADX', 'JTO', 'USDC'].includes(t.symbol),
                });
                grouped.set(t.sponsor, arr);
            }
            setCfgSponsors(Array.from(grouped, ([name, tokens]) => ({ name, tokens })));
        } else {
            setCfgSponsors([]);
        }
    }

    // Open Create modal in EDIT mode for an existing tournament.
    // Restricted by caller to `registration` status (Edit button only renders for that).
    function handleOpenEdit(t: Tournament) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        populateCfgFromTournament(t);
        setEditingTournamentId(t.id);
        setShowCreateModal(true);
        // Trigger tradable-assets fetch if not yet loaded (same as create flow)
        loadTradableAssetsIfReady(adminSecret);
    }

    // Live prize-totals descriptor.
    // Warns when skill+raffle sum doesn't match cfgPrizeTotalPool (otherwise
    // the arrays can quietly disagree with the headline total).
    const prizeSums = useMemo(() => {
        const parse = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
        const skillTotal = parse(cfgSkillPrizes).reduce((a, b) => a + b, 0);
        const raffleTotal = parse(cfgRafflePrizes).reduce((a, b) => a + b, 0);
        const combined = skillTotal + raffleTotal;
        const matches = combined === cfgPrizeTotalPool;
        return { skillTotal, raffleTotal, combined, matches };
    }, [cfgSkillPrizes, cfgRafflePrizes, cfgPrizeTotalPool]);

    // Auto-derive skill/raffle arrays from preset shares + curves.
    // Runs only when in preset mode. The live descriptor above still catches
    // mismatches (e.g. curve doesn't sum to 100, share% don't sum to 100).
    // Defensive: NaN/negative inputs collapse to 0 to prevent "NaN, NaN, ..."
    // strings appearing in cfgSkillPrizes/cfgRafflePrizes if admin pastes garbage
    // into a number input.
    useEffect(() => {
        if (cfgPrizeMode !== 'preset') return;
        const parsePcts = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
        const totalPool = isFinite(cfgPrizeTotalPool) && cfgPrizeTotalPool >= 0 ? cfgPrizeTotalPool : 0;
        const skillShare = isFinite(cfgSkillSharePct) && cfgSkillSharePct >= 0 ? cfgSkillSharePct : 0;
        const raffleShare = isFinite(cfgRaffleSharePct) && cfgRaffleSharePct >= 0 ? cfgRaffleSharePct : 0;
        const skillPool = totalPool * skillShare / 100;
        const rafflePool = totalPool * raffleShare / 100;
        const skillPcts = parsePcts(cfgSkillCurve);
        const rafflePcts = parsePcts(cfgRaffleCurve);
        const skillArr = skillPcts.map(pct => Math.round(skillPool * pct / 100));
        const raffleArr = rafflePcts.map(pct => Math.round(rafflePool * pct / 100));
        setCfgSkillPrizes(skillArr.join(', '));
        setCfgRafflePrizes(raffleArr.join(', '));
    }, [cfgPrizeMode, cfgPrizeTotalPool, cfgSkillSharePct, cfgRaffleSharePct, cfgSkillCurve, cfgRaffleCurve]);

    // Fetch live USD prices for tokens the admin has entered. Dedupe by
    // symbol+mint so multi-sponsor tournaments with the same token query
    // Pyth/Jupiter once. Static prices are surfaced per-row in the indicator
    // below; they are not stored in this map (which only holds live
    // Pyth/Jupiter results).
    useEffect(() => {
        const fetchTokens = (() => {
            const seen = new Map<string, { symbol: string; mint?: string }>();
            for (const s of cfgSponsors) {
                for (const t of s.tokens) {
                    const sym = t.symbol.trim();
                    if (!sym) continue;
                    const key = `${sym}|${t.mint ?? ''}`;
                    if (!seen.has(key)) seen.set(key, { symbol: sym, mint: t.mint });
                }
            }
            return Array.from(seen.values());
        })();
        if (fetchTokens.length === 0) return;
        getTokenUSDPrices(fetchTokens).then((data) => {
            const map: Record<string, number> = {};
            for (const [sym, v] of Object.entries(data)) {
                if (v.usd !== null && v.usd !== undefined && v.source !== 'static') {
                    map[sym] = v.usd;
                }
            }
            setCfgTokenUSDPrices(map);
        }).catch(() => { /* ignore */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(cfgSponsors.flatMap((s) => s.tokens.map((t) => ({ symbol: t.symbol, mint: t.mint }))))]);

    // When admin selects a different template, load its shares + curves.
    function handleTemplateChange(templateId: string) {
        const tpl = PRIZE_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;
        setCfgPresetTemplateId(templateId);
        setCfgSkillSharePct(tpl.skillSharePct);
        setCfgRaffleSharePct(tpl.raffleSharePct);
        setCfgSkillCurve(tpl.skillCurve.join(', '));
        setCfgRaffleCurve(tpl.raffleCurve.join(', '));
    }

    // ── Tournament handlers ──────────────────────────────────────────────────

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;

        const effectiveSecret = adminSecret || modalSecretDraft;
        if (!effectiveSecret) {
            showToast('Admin secret required', 'error');
            return;
        }

        const parseNums = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n));
        const durations = parseNums(cfgRoundDurations).filter((n) => n > 0);
        const fisherRankPoints = parseNums(cfgFisherRankPoints);
        const dailyQuestPoints = parseNums(cfgDailyQuestPoints);
        const multidayQuestPoints = parseNums(cfgMultidayQuestPoints);
        const skillPrizes = parseNums(cfgSkillPrizes);
        const rafflePrizes = parseNums(cfgRafflePrizes);

        if (fisherRankPoints.length !== 3) {
            showToast('Fisher rank points must have exactly 3 entries (1st/2nd/3rd)', 'error');
            return;
        }
        if (dailyQuestPoints.length !== 5) {
            showToast('Daily quest points must have exactly 5 entries (ranks 1-5)', 'error');
            return;
        }
        if (multidayQuestPoints.length !== 5) {
            showToast('Multi-day quest points must have exactly 5 entries (ranks 1-5)', 'error');
            return;
        }
        if (cfgAssetList.some((a) => !a.symbol.trim())) {
            showToast('Every asset must have a non-empty symbol', 'error');
            return;
        }

        // Validate per-asset lmSteps + lmTolerance (block submit on error,
        // matches existing fisherRankPoints validation pattern above).
        for (const a of cfgAssetList) {
            if (a.lmSteps && a.lmSteps.trim()) {
                const parsed = a.lmSteps.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
                if (parsed.length === 0) {
                    showToast(`Asset ${a.symbol}: lmSteps must be positive numbers (e.g. 10,20,30)`, 'error');
                    return;
                }
                const ascending = parsed.every((v, idx) => idx === 0 || v > parsed[idx - 1]);
                if (!ascending) {
                    showToast(`Asset ${a.symbol}: lmSteps must be strictly ascending (e.g. 10,20,30 not 10,20,15)`, 'error');
                    return;
                }
            }
            if (a.lmTolerance && a.lmTolerance.trim()) {
                const t = Number(a.lmTolerance.trim());
                if (isNaN(t) || t <= 0) {
                    showToast(`Asset ${a.symbol}: lmTolerance must be a positive number`, 'error');
                    return;
                }
            }
        }

        const config: Partial<TournamentConfig> = {
            format: cfgFormat,
            bracketSize: cfgBracketSize,
            advanceRatio: cfgAdvanceRatio,
            roundDurations: durations.length > 0 ? durations : (cfgFormat === 'rank_only' ? [336] : [72, 48, 48]),
            minPositionCollateral: cfgMinCollateral,
            minTradeDurationSec: cfgMinDuration,
            supportedAssetCount: cfgAssetCount,
            topPercentCutoff: cfgTopPercentCutoff,
            allAroundMinTradeUsd: cfgAllAroundMinTradeUsd,
            allAroundMaxPointsPerAsset: cfgAllAroundMaxPointsPerAsset,
            fisherRankPoints,
            dailyQuestPoints,
            multidayQuestPoints,
            raffleMinClosedPositions: cfgRaffleMinClosedPositions,
            cpiTicketMultiplier: cfgCpiTicketMultiplier,
            questTicketMultiplier: cfgQuestTicketMultiplier,
            riskManagerMinSize: cfgRiskManagerMinSize,
            useHistoricalWindow: cfgUseHistoricalWindow,
            historicalWindowDays: cfgHistoricalWindowDays,
        };

        if (cfgPrizeEnabled) {
            // Validate sponsors + build multi-token prizeTable. Sponsors section
            // replaces the single Currency dropdown; tokens carry sponsor name,
            // symbol, amount, optional mint, and optional staticUsdPrice.
            if (cfgSponsors.length === 0) {
                showToast('At least one sponsor required when prize table is enabled', 'error');
                return;
            }
            const tokenPairs = new Set<string>();
            for (const s of cfgSponsors) {
                if (!s.name.trim()) {
                    showToast('Every sponsor must have a name', 'error');
                    return;
                }
                for (const t of s.tokens) {
                    if (!t.symbol.trim()) {
                        showToast(`Sponsor ${s.name}: token symbol required`, 'error');
                        return;
                    }
                    if (t.amount <= 0) {
                        showToast(`Sponsor ${s.name}: token ${t.symbol} amount must be > 0`, 'error');
                        return;
                    }
                    // Mint validation: if supplied, must look like a base58 pubkey
                    // (32-44 chars). Lightweight check; real verification happens
                    // when Jupiter fails to find it. Empty mint OK (server falls
                    // back to KNOWN_PRIZE_TOKEN_MINT for ADX/JTO/USDC).
                    if (t.mint && t.mint.trim()) {
                        const m = t.mint.trim();
                        if (m.length < 32 || m.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(m)) {
                            showToast(`Sponsor ${s.name}: token ${t.symbol} mint must be a valid base58 pubkey (32-44 chars)`, 'error');
                            return;
                        }
                    }
                    // staticUsdPrice validation: if supplied, must be > 0.
                    if (t.staticUsdPrice !== undefined && (isNaN(t.staticUsdPrice) || t.staticUsdPrice <= 0)) {
                        showToast(`Sponsor ${s.name}: token ${t.symbol} static USD price must be > 0`, 'error');
                        return;
                    }
                    const pairKey = `${s.name.trim()}|${t.symbol.trim()}`;
                    if (tokenPairs.has(pairKey)) {
                        showToast(`Duplicate (sponsor, token) pair: ${s.name} + ${t.symbol}`, 'error');
                        return;
                    }
                    tokenPairs.add(pairKey);
                }
            }
            const flatTokens = cfgSponsors.flatMap((s) =>
                s.tokens.map((t) => {
                    const item: { sponsor: string; symbol: string; amount: number; mint?: string; staticUsdPrice?: number } = {
                        sponsor: s.name.trim(),
                        symbol: t.symbol.trim(),
                        amount: t.amount,
                    };
                    if (t.mint && t.mint.trim()) item.mint = t.mint.trim();
                    if (t.staticUsdPrice !== undefined && t.staticUsdPrice > 0) item.staticUsdPrice = t.staticUsdPrice;
                    return item;
                }),
            );
            // Legacy `totalPool` + `currency` derived from sponsors for backward-compat.
            // New code reads `tokens` directly; legacy fields kept so older
            // consumers (single-currency Drizzle JSONB shape) still parse.
            const primaryToken = flatTokens[0];
            config.prizeTable = {
                totalPool: flatTokens.reduce((a, t) => a + t.amount, 0),
                currency: primaryToken?.symbol ?? 'ADX',
                skillPrizes,
                rafflePrizes,
                tokens: flatTokens,
            };
        }
        if (cfgAssetList.length > 0) {
            config.assetList = cfgAssetList.map((a) => {
                // assetList entry shape includes feed_id, lmSteps, and lmTolerance.
                const item: { symbol: string; mint?: string; joinedAt: string; feed_id?: number; lmSteps?: number[]; lmTolerance?: number } = {
                    symbol: a.symbol.trim(),
                    joinedAt: a.joinedAt,
                };
                if (a.mint && a.mint.trim()) item.mint = a.mint.trim();
                if (typeof a.feed_id === 'number' && a.feed_id > 0) item.feed_id = a.feed_id;
                // lmSteps + lmTolerance: already validated above, just parse + assign
                if (a.lmSteps && a.lmSteps.trim()) {
                    const parsed = a.lmSteps.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
                    if (parsed.length > 0) item.lmSteps = parsed;
                }
                if (a.lmTolerance && a.lmTolerance.trim()) {
                    const t = Number(a.lmTolerance.trim());
                    if (!isNaN(t) && t > 0) item.lmTolerance = t;
                }
                return item;
            });
        }

        try {
            setCreating(true);
            // Branch on edit mode: update existing vs create new.
            if (editingTournamentId !== null) {
                await updateTournament(editingTournamentId, { name: newName.trim(), config }, effectiveSecret);
                if (!adminSecret && modalSecretDraft) {
                    commitSecret(modalSecretDraft);
                    setModalSecretDraft('');
                }
                addLog(`Updated tournament "${newName}" (id: ${editingTournamentId})`);
                showToast(`Tournament "${newName}" updated`, 'success');
            } else {
                const result = await createTournament(newName.trim(), config, effectiveSecret);
                if (!adminSecret && modalSecretDraft) {
                    commitSecret(modalSecretDraft);
                    setModalSecretDraft('');
                }
                addLog(`Created tournament "${newName}" (id: ${result.id})`);
                showToast(`Tournament "${newName}" created`, 'success');
            }
            resetConfigDefaults();
            setShowCreateModal(false);
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : (editingTournamentId !== null ? 'Failed to update' : 'Failed to create');
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally {
            setCreating(false);
        }
    }

    async function handleStart(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminStartTournament(tournamentId, adminSecret);
            addLog(`Started "${tournamentName}": Round 1 with ${result.bracketCount} bracket(s)`);
            showToast(`"${tournamentName}" started`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to start';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleScore(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const data = await getTournamentBrackets(tournamentId);
            if (!data.round) {
                addLog('Error: No active round found');
                showToast('No active round found', 'error');
                setActionLoading(false);
                return;
            }
            const result = await adminComputeScores(data.round.id, adminSecret);
            addLog(`Scored "${tournamentName}" Round ${data.round.roundNumber}: ${result.scoredCount} entries`);
            showToast(`Scores computed: ${result.scoredCount} entries`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to score';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleAdvance(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminAdvanceRound(tournamentId, adminSecret);
            if (result.completed) {
                addLog(`"${tournamentName}" completed!`);
                showToast(`"${tournamentName}" completed!`, 'success');
            } else {
                addLog(`"${tournamentName}": ${result.advanced} advanced, ${result.eliminated} eliminated`);
                showToast(`Round advanced: ${result.advanced} advanced`, 'success');
            }
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to advance';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleCancel(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!confirm(`Cancel "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await adminCancelTournament(tournamentId, adminSecret);
            addLog(`Cancelled "${tournamentName}"`);
            showToast(`"${tournamentName}" cancelled`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to cancel';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleDelete(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!confirm(`Delete "${tournamentName}"? This cannot be undone.`)) return;
        try {
            setActionLoading(true);
            await deleteTournament(tournamentId, adminSecret);
            addLog(`Deleted "${tournamentName}"`);
            showToast(`"${tournamentName}" deleted`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleComputeRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminComputeRaffle(tournamentId, adminSecret);
            addLog(`Raffle computed for "${tournamentName}": ${result.total} entries, ${result.eligible} eligible, ${result.excluded} excluded (top %)`);
            showToast(`Raffle: ${result.eligible} eligible of ${result.total}`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to compute raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleDrawRaffle(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !drawTournamentId) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!drawBlockHash.trim()) { showToast('Block hash is required', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminDrawRaffle(drawTournamentId, drawBlockHash.trim(), drawPrizeCount, adminSecret);
            addLog(`Raffle drawn for tournament #${drawTournamentId}: ${result.winners.length} winner(s): ${result.winners.map((w) => w.slice(0, 8) + '...').join(', ')}`);
            showToast(`${result.winners.length} raffle winner(s) drawn!`, 'success');
            setShowDrawModal(false);
            setDrawBlockHash('');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to draw raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleVerifyRaffle(tournamentId: number) {
        try {
            setActionLoading(true);
            const result = await verifyRaffleDraw(tournamentId);
            if (result.verified) {
                addLog(`Raffle draw #${result.drawId} VERIFIED ✓`);
                showToast('Raffle draw verified ✓', 'success');
            } else {
                addLog(`Raffle verification FAILED: ${result.mismatches.join(', ')}`);
                showToast('Verification failed; see log', 'error');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to verify';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleResetRaffle(tournamentId: number, tournamentName: string) {
        if (!adminSecret) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        if (!confirm(`Reset raffle draw for "${tournamentName}"? This will clear all winners and the audit trail.`)) return;
        try {
            setActionLoading(true);
            const result = await adminResetRaffle(tournamentId, adminSecret);
            addLog(`Raffle reset for "${tournamentName}": ${result.deletedDraws} draw(s) deleted, ${result.resetWinners} winner(s) cleared`);
            showToast(`Raffle reset: ${result.resetWinners} winners cleared`, 'success');
            loadAll();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to reset raffle';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    async function handleScoreCategories(e: React.FormEvent) {
        e.preventDefault();
        if (!adminSecret || !categoryTournamentId) { showToast('Enter admin secret on /admin landing first', 'error'); return; }
        try {
            setActionLoading(true);
            const result = await adminScoreCategories(categoryTournamentId, categoryDate, adminSecret);
            addLog(`Categories scored for tournament #${result.tournamentId} on ${result.date}: ${result.walletsScored} wallets, ${result.ohlcAssetsAvailable} OHLC assets`);
            showToast(`Categories scored: ${result.walletsScored} wallets`, 'success');
            setShowCategoryModal(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to score categories';
            addLog(`Error: ${msg}`);
            showToast(msg, 'error');
        } finally { setActionLoading(false); }
    }

    return (
        <div className="container">
            {toast && (
                <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
                    <span>{toast.message}</span>
                    <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
                </div>
            )}

            <header className="page-header">
                <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.8125rem', textDecoration: 'none', marginBottom: 'var(--space-sm)' }}>
                    <ArrowLeft size={14} /> Back to Admin
                </Link>
                <h1 className="page-header__title">
                    <Trophy size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Tournaments
                </h1>
                <p className="page-header__subtitle">
                    Create, start, score, advance, cancel, delete tournaments. Raffle controls + category scoring.
                </p>
            </header>

            {/* Tournament Controls */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Tournament Controls</h2>
                    <button className="btn btn--primary" onClick={() => {
                        setShowCreateModal(true);
                        loadTradableAssetsIfReady(adminSecret);
                    }}>
                        <Plus size={14} /> New Tournament
                    </button>
                </div>

                {loading && <div className={styles.center}><div className="spinner" /></div>}
                {!loading && tournaments.length === 0 && <p className={styles.emptyText}>No tournaments yet. Create one above.</p>}

                {!loading && tournaments.map((t) => (
                    <div key={t.id} className={`card ${styles.controlCard}`}>
                        <div className={styles.controlHeader}>
                            <div>
                                <h3 className={styles.controlName}>{t.name}</h3>
                                <span className={styles.controlId}>ID: {t.id} · {t.config.format === 'rank_only' ? 'Forge' : 'Gauntlet'}</span>
                            </div>
                            <span className={`badge badge--${t.status}`}>{t.status}</span>
                        </div>

                        <div className={styles.controlActions}>
                            {t.status === 'registration' && (
                                <>
                                    {/* Edit button: opens Create modal in edit mode, only for registration status */}
                                    <button className="btn btn--secondary" onClick={() => handleOpenEdit(t)} disabled={actionLoading}>
                                        <Pencil size={14} /> Edit
                                    </button>
                                    <button className="btn btn--primary" onClick={() => handleStart(t.id, t.name)} disabled={actionLoading}>
                                        <Play size={14} /> Start
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleDelete(t.id, t.name)} disabled={actionLoading}>
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </>
                            )}
                            {t.status === 'active' && (
                                <>
                                    <button className="btn btn--secondary" onClick={() => handleScore(t.id, t.name)} disabled={actionLoading}>
                                        <BarChart3 size={14} /> Score
                                    </button>
                                    {t.config.format !== 'rank_only' && (
                                        <button className="btn btn--primary" onClick={() => handleAdvance(t.id, t.name)} disabled={actionLoading}>
                                            <ChevronRight size={14} /> Advance
                                        </button>
                                    )}
                                    <button className="btn btn--secondary" onClick={() => { setCategoryTournamentId(t.id); setShowCategoryModal(true); }} disabled={actionLoading}>
                                        <CalendarDays size={14} /> Score Categories
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => handleComputeRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <Ticket size={14} /> Compute Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => {
                                        setDrawTournamentId(t.id);
                                        // Lock prizeCount to rafflePrizes.length on modal open.
                                        const len = t.config.prizeTable?.rafflePrizes?.length;
                                        setDrawPrizeCount(len && len > 0 ? len : 3);
                                        setShowDrawModal(true);
                                    }} disabled={actionLoading}>
                                        <Sparkles size={14} /> Draw Raffle
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleResetRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <RotateCcw size={14} /> Reset Draw
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleCancel(t.id, t.name)} disabled={actionLoading}>
                                        <Ban size={14} /> Cancel
                                    </button>
                                </>
                            )}
                            {t.status === 'completed' && (
                                <>
                                    <span className={styles.completedText}>
                                        <Trophy size={14} style={{ marginRight: 4 }} /> Complete
                                    </span>
                                    <button className="btn btn--secondary" onClick={() => handleComputeRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <Ticket size={14} /> Compute Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => {
                                        setDrawTournamentId(t.id);
                                        // Lock prizeCount to rafflePrizes.length on modal open.
                                        const len = t.config.prizeTable?.rafflePrizes?.length;
                                        setDrawPrizeCount(len && len > 0 ? len : 3);
                                        setShowDrawModal(true);
                                    }} disabled={actionLoading}>
                                        <Sparkles size={14} /> Draw Raffle
                                    </button>
                                    <button className="btn btn--secondary" onClick={() => handleVerifyRaffle(t.id)} disabled={actionLoading}>
                                        <CheckCircle2 size={14} /> Verify Draw
                                    </button>
                                    <button className="btn btn--danger" onClick={() => handleResetRaffle(t.id, t.name)} disabled={actionLoading}>
                                        <RotateCcw size={14} /> Reset Draw
                                    </button>
                                </>
                            )}
                            {/* Quick-links to view-side pages */}
                            {t.config.format === 'rank_only' ? (
                                <a href={`/leaderboard/${t.id}`} className="btn btn--secondary">
                                    <ExternalLink size={14} /> View Forge
                                </a>
                            ) : (
                                <>
                                    <a href={`/tournament/${t.id}`} className="btn btn--secondary">
                                        <ExternalLink size={14} /> View
                                    </a>
                                    <a href={`/leaderboard/${t.id}`} className="btn btn--secondary">
                                        <BarChart3 size={14} /> Leaderboard
                                    </a>
                                </>
                            )}
                            <a href={`/categories/${t.id}`} className="btn btn--secondary">
                                <CalendarDays size={14} /> Categories
                            </a>
                            <Link href="/admin/analytics" className="btn btn--secondary">
                                <Compass size={14} /> Analytics
                            </Link>
                        </div>
                    </div>
                ))}
            </section>

            {/* Action Log */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                    <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Action Log
                </h2>
                <div className={styles.logPanel}>
                    {actionLog.length === 0 && <p className={styles.logEmpty}>No actions yet.</p>}
                    {actionLog.map((log, i) => <div key={i} className={styles.logEntry}>{log}</div>)}
                </div>
            </section>

            {/* CREATE TOURNAMENT MODAL */}
            {showCreateModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>
                                {editingTournamentId !== null ? `Edit Tournament #${editingTournamentId}` : 'Create Tournament'}
                            </h2>
                            <button className={styles.modalClose} onClick={() => setShowCreateModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreate} className={styles.modalForm}>
                            {!adminSecret && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>
                                        <Lock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Admin Secret
                                    </label>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        <input type="password" className="input input--mono" placeholder="Required to create. Paste your secret then click Apply."
                                            value={modalSecretDraft} onChange={(e) => setModalSecretDraft(e.target.value)} style={{ flex: 1 }} />
                                        <button type="button" className="btn btn--secondary" disabled={!modalSecretDraft.trim()}
                                            onClick={() => {
                                                const draft = modalSecretDraft;
                                                commitSecret(draft);
                                                setModalSecretDraft('');
                                                loadTradableAssetsIfReady(draft);
                                            }}>Apply</button>
                                    </div>
                                    <span className={styles.formHint}>Click Apply to authenticate. Auto-hides once set.</span>
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament Name</label>
                                <input type="text" className="input" placeholder="e.g., The Gauntlet Pilot"
                                    value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                            </div>

                            <div className={styles.formDivider} />

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Format</label>
                                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                    <button type="button" className={`btn ${cfgFormat === 'bracket' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('bracket'); setCfgRoundDurations('72, 48, 48'); }} style={{ flex: 1 }}>
                                        <Swords size={14} /> Gauntlet
                                    </button>
                                    <button type="button" className={`btn ${cfgFormat === 'rank_only' ? 'btn--primary' : 'btn--secondary'}`}
                                        onClick={() => { setCfgFormat('rank_only'); setCfgRoundDurations('336'); }} style={{ flex: 1 }}>
                                        <Flame size={14} /> Forge
                                    </button>
                                </div>
                                <span className={styles.formHint}>
                                    {cfgFormat === 'bracket' ? 'Bracket elimination with rounds (The Gauntlet)' : 'Flat leaderboard, open registration (The Forge)'}
                                </span>
                            </div>

                            <h3 className={styles.formSectionTitle}>Round / Bracket</h3>
                            <div className={styles.formGrid}>
                                {cfgFormat === 'bracket' && (
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Bracket Size</label>
                                        <input type="number" className="input input--mono" value={cfgBracketSize} onChange={(e) => setCfgBracketSize(Number(e.target.value))} min={2} />
                                        <span className={styles.formHint}>Traders per bracket in Round 1</span>
                                    </div>
                                )}
                                {cfgFormat === 'bracket' && (
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Advance Ratio</label>
                                        <input type="number" className="input input--mono" value={cfgAdvanceRatio} onChange={(e) => setCfgAdvanceRatio(Number(e.target.value))} min={0.1} max={0.9} step={0.1} />
                                        <span className={styles.formHint}>Fraction that survive each round</span>
                                    </div>
                                )}
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>{cfgFormat === 'rank_only' ? 'Competition Duration (hours)' : 'Round Durations (hours)'}</label>
                                <input type="text" className="input input--mono" value={cfgRoundDurations} onChange={(e) => setCfgRoundDurations(e.target.value)}
                                    placeholder={cfgFormat === 'rank_only' ? '336' : '72, 48, 48'} />
                                <span className={styles.formHint}>{cfgFormat === 'rank_only' ? 'Total competition length in hours (e.g., 336 = 14 days)' : 'Comma-separated hours per round (R1, R2, R3)'}</span>
                            </div>

                            <h3 className={styles.formSectionTitle}>Anti-Gaming Filters</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Collateral ($)</label>
                                    <input type="number" className="input input--mono" value={cfgMinCollateral} onChange={(e) => setCfgMinCollateral(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Min collateral for CPI + quest trades</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Trade Duration (s)</label>
                                    <input type="number" className="input input--mono" value={cfgMinDuration} onChange={(e) => setCfgMinDuration(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Wash-trade filter (seconds, e.g. 240 = 4 min)</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>All Around Min Trade ($)</label>
                                    <input type="number" className="input input--mono" value={cfgAllAroundMinTradeUsd} onChange={(e) => setCfgAllAroundMinTradeUsd(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Quest-specific minimum exit size in USD (default 500)</span>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Risk Manager Min Size ($)</label>
                                    <input type="number" className="input input--mono" value={cfgRiskManagerMinSize} onChange={(e) => setCfgRiskManagerMinSize(Number(e.target.value))} min={0} />
                                    <span className={styles.formHint}>Minimum trade exit size in USD for RM eligibility (default 1000)</span>
                                </div>
                            </div>

                            <h3 className={styles.formSectionTitle}>Scoring Policy</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>All Around Max Points/Asset</label>
                                    <input type="number" className="input input--mono" value={cfgAllAroundMaxPointsPerAsset} onChange={(e) => setCfgAllAroundMaxPointsPerAsset(Number(e.target.value))} min={1} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Supported Assets (count)</label>
                                    <input type="number" className="input input--mono" value={cfgAssetCount} onChange={(e) => setCfgAssetCount(Number(e.target.value))} min={1} />
                                </div>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Fisher Rank Points</label>
                                <input type="text" className="input input--mono" value={cfgFisherRankPoints} onChange={(e) => setCfgFisherRankPoints(e.target.value)} placeholder="3, 2, 1" />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Daily Quest Points (ranks 1-5)</label>
                                <input type="text" className="input input--mono" value={cfgDailyQuestPoints} onChange={(e) => setCfgDailyQuestPoints(e.target.value)} placeholder="0.2, 0.15, 0.1, 0.05, 0.01" />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Multi-Day Quest Points (ranks 1-5)</label>
                                <input type="text" className="input input--mono" value={cfgMultidayQuestPoints} onChange={(e) => setCfgMultidayQuestPoints(e.target.value)} placeholder="0.3, 0.25, 0.2, 0.15, 0.1" />
                            </div>

                            <h3 className={styles.formSectionTitle}>Raffle Policy</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Top % Cutoff (skill prizes)</label>
                                    <input type="number" className="input input--mono" value={cfgTopPercentCutoff} onChange={(e) => setCfgTopPercentCutoff(Number(e.target.value))} min={0.01} max={0.99} step={0.01} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Min Closed Positions</label>
                                    <input type="number" className="input input--mono" value={cfgRaffleMinClosedPositions} onChange={(e) => setCfgRaffleMinClosedPositions(Number(e.target.value))} min={0} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>CPI Ticket Multiplier</label>
                                    <input type="number" className="input input--mono" value={cfgCpiTicketMultiplier} onChange={(e) => setCfgCpiTicketMultiplier(Number(e.target.value))} min={0} step={0.1} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Quest Ticket Multiplier</label>
                                    <input type="number" className="input input--mono" value={cfgQuestTicketMultiplier} onChange={(e) => setCfgQuestTicketMultiplier(Number(e.target.value))} min={0} step={1} />
                                </div>
                            </div>

                            <h3 className={styles.formSectionTitle}>Backtest Mode</h3>
                            <div className={styles.formGroup} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="cfg-use-hist" checked={cfgUseHistoricalWindow} onChange={(e) => setCfgUseHistoricalWindow(e.target.checked)} />
                                <label htmlFor="cfg-use-hist" style={{ cursor: 'pointer' }}>Use historical window (instead of live round dates)</label>
                            </div>
                            {cfgUseHistoricalWindow && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Historical Window (days)</label>
                                    <input type="number" className="input input--mono" value={cfgHistoricalWindowDays} onChange={(e) => setCfgHistoricalWindowDays(Number(e.target.value))} min={1} />
                                </div>
                            )}

                            <h3 className={styles.formSectionTitle}>Prize Distribution</h3>
                            <div className={styles.formGroup} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="cfg-prize-enabled" checked={cfgPrizeEnabled} onChange={(e) => setCfgPrizeEnabled(e.target.checked)} />
                                <label htmlFor="cfg-prize-enabled" style={{ cursor: 'pointer' }}>Enable prize table (skill + raffle prize amounts)</label>
                            </div>
                            {cfgPrizeEnabled && (
                                <>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Total Pool (informational; overridden by sum of sponsor token amounts at submit)</label>
                                        <input type="number" className="input input--mono" value={cfgPrizeTotalPool} onChange={(e) => setCfgPrizeTotalPool(Number(e.target.value))} min={0} />
                                        <span className={styles.formHint}>Used by Preset mode below to derive Skill/Raffle arrays. After submit, the saved `totalPool` is replaced with `sum(sponsors.tokens.amount)`.</span>
                                    </div>

                                    {/* Sponsors section: admin adds sponsors; each sponsor adds tokens
                                        (symbol + amount + optional mint + optional static USD). Live USD
                                        running total derives from current Pyth/Jupiter prices. */}
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Sponsors / Token Pool</label>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                                            Each sponsor contributes one or more tokens. Live USD totals derive from current prices.
                                            Optional per-token mint lets you add any SPL token without a code change;
                                            optional static USD/token is used only if Pyth + Jupiter both return null.
                                        </div>
                                        {cfgSponsors.map((sponsor, sIdx) => (
                                            <div key={sIdx} className={styles.sponsorRow}>
                                                <input type="text" className="input" placeholder="Sponsor name (e.g. Adrena Foundation)"
                                                    value={sponsor.name}
                                                    onChange={(e) => setCfgSponsors((prev) => prev.map((s, j) => j === sIdx ? { ...s, name: e.target.value } : s))}
                                                    style={{ flex: 1 }} />
                                                <button type="button" className="btn btn--secondary"
                                                    onClick={() => setCfgSponsors((prev) => prev.filter((_, j) => j !== sIdx))}>×</button>
                                                <div className={styles.sponsorTokensWrap}>
                                                    {sponsor.tokens.map((tok, tIdx) => (
                                                        <div key={tIdx} className={styles.sponsorTokenRow}>
                                                            <Select
                                                                ariaLabel="Token symbol"
                                                                value={tok.symbol}
                                                                onChange={(symbol) => {
                                                                    const fromKnown = ['ADX', 'JTO', 'USDC'].includes(symbol);
                                                                    setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                                        ? { ...s, tokens: s.tokens.map((t, k) => k === tIdx
                                                                            ? { ...t, symbol, custom: !fromKnown }
                                                                            : t) }
                                                                        : s));
                                                                }}
                                                                placeholder="Select token"
                                                                options={[
                                                                    { value: 'ADX', label: 'ADX' },
                                                                    { value: 'JTO', label: 'JTO' },
                                                                    { value: 'USDC', label: 'USDC' },
                                                                    // Admin can type a non-standard symbol in the mint field
                                                                    // below; engine + display handle it as 'custom: true'.
                                                                ]}
                                                            />
                                                            <input type="number" className="input input--mono" placeholder="Amount"
                                                                value={tok.amount}
                                                                onChange={(e) => setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                                    ? { ...s, tokens: s.tokens.map((t, k) => k === tIdx
                                                                        ? { ...t, amount: Number(e.target.value) }
                                                                        : t) }
                                                                    : s))}
                                                                min={0} />
                                                            {/* Optional mint override. */}
                                                            <Tooltip content="Optional SPL token mint pubkey. Required for custom tokens Jupiter can't resolve via the server-side default map. Empty for ADX/JTO/USDC.">
                                                                <input type="text" className="input input--mono" placeholder="Mint (optional)"
                                                                    value={tok.mint ?? ''}
                                                                    onChange={(e) => {
                                                                        const m = e.target.value.trim() || undefined;
                                                                        setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                                            ? { ...s, tokens: s.tokens.map((t, k) => k === tIdx
                                                                                ? { ...t, mint: m }
                                                                                : t) }
                                                                            : s));
                                                                    }} />
                                                            </Tooltip>
                                                            {/* Optional static USD fallback. */}
                                                            <Tooltip content="Optional static USD/token fallback. Used only when both Pyth + Jupiter return null. Leave empty for live-only pricing.">
                                                                <input type="number" className="input input--mono" placeholder="Static $/tok (optional)"
                                                                    value={tok.staticUsdPrice ?? ''}
                                                                    step="0.000001" min="0"
                                                                    onChange={(e) => {
                                                                        const v = e.target.value.trim();
                                                                        const num = v ? Number(v) : undefined;
                                                                        setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                                            ? { ...s, tokens: s.tokens.map((t, k) => k === tIdx
                                                                                ? { ...t, staticUsdPrice: (num != null && !isNaN(num) && num > 0) ? num : undefined }
                                                                                : t) }
                                                                            : s));
                                                                    }} />
                                                            </Tooltip>
                                                            <span className={styles.sponsorTokenUSDHint}>
                                                                {(() => {
                                                                    const live = cfgTokenUSDPrices[tok.symbol];
                                                                    const usdPerTok = live != null && live > 0
                                                                        ? live
                                                                        : (tok.staticUsdPrice ?? 0);
                                                                    const indicator = live != null && live > 0
                                                                        ? 'live'
                                                                        : (tok.staticUsdPrice ? 'static' : 'n/a');
                                                                    return `≈ $${(tok.amount * usdPerTok).toLocaleString('en-US', { maximumFractionDigits: 0 })} (${indicator})`;
                                                                })()}
                                                            </span>
                                                            <button type="button" className="btn btn--secondary"
                                                                onClick={() => setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                                    ? { ...s, tokens: s.tokens.filter((_, k) => k !== tIdx) }
                                                                    : s))}>×</button>
                                                        </div>
                                                    ))}
                                                    <button type="button" className="btn btn--secondary"
                                                        onClick={() => setCfgSponsors((prev) => prev.map((s, j) => j === sIdx
                                                            ? { ...s, tokens: [...s.tokens, { symbol: 'ADX', amount: 0 }] }
                                                            : s))}>
                                                        + Add token
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        <button type="button" className="btn btn--secondary"
                                            onClick={() => setCfgSponsors((prev) => [...prev, { name: '', tokens: [{ symbol: 'ADX', amount: 0 }] }])}>
                                            + Add sponsor
                                        </button>
                                        <div className={styles.sponsorTotalRow}>
                                            <strong>Total USD (live):</strong> ${cfgSponsors.reduce((sum, s) =>
                                                sum + s.tokens.reduce((sm, t) => {
                                                    const live = cfgTokenUSDPrices[t.symbol];
                                                    const usdPerTok = live != null && live > 0 ? live : (t.staticUsdPrice ?? 0);
                                                    return sm + t.amount * usdPerTok;
                                                }, 0), 0
                                            ).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                        </div>
                                    </div>
                                    {/* Mode toggle (Manual / Preset) */}
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Distribution Mode</label>
                                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                            <button type="button" className={`btn ${cfgPrizeMode === 'manual' ? 'btn--primary' : 'btn--secondary'}`}
                                                onClick={() => setCfgPrizeMode('manual')} style={{ flex: 1 }}>
                                                Manual (type arrays directly)
                                            </button>
                                            <button type="button" className={`btn ${cfgPrizeMode === 'preset' ? 'btn--primary' : 'btn--secondary'}`}
                                                onClick={() => setCfgPrizeMode('preset')} style={{ flex: 1 }}>
                                                Preset (Total Pool + percentages)
                                            </button>
                                        </div>
                                        <span className={styles.formHint}>
                                            {cfgPrizeMode === 'manual'
                                                ? 'Type skill + raffle arrays directly. Totals descriptor below flags mismatches.'
                                                : 'Pick template + customize percentages. Skill/Raffle prize arrays auto-derived (read-only).'}
                                        </span>
                                    </div>
                                    {/* Preset-only inputs (template dropdown + share% + curves) */}
                                    {cfgPrizeMode === 'preset' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label className={styles.formLabel}>Template</label>
                                                <Select
                                                    ariaLabel="Prize distribution template"
                                                    value={cfgPresetTemplateId}
                                                    onChange={handleTemplateChange}
                                                    options={PRIZE_TEMPLATES.map((t) => ({
                                                        value: t.id,
                                                        label: t.label,
                                                    }))}
                                                />
                                                <span className={styles.formHint}>Selecting a template loads its shares + curves into the inputs below. Edit freely to customize.</span>
                                            </div>
                                            <div className={styles.formGrid}>
                                                <div className={styles.formGroup}>
                                                    <label className={styles.formLabel}>Skill Share %</label>
                                                    <input type="number" className="input input--mono" value={cfgSkillSharePct}
                                                        onChange={(e) => setCfgSkillSharePct(Number(e.target.value))} min={0} max={100} step={1} />
                                                </div>
                                                <div className={styles.formGroup}>
                                                    <label className={styles.formLabel}>Raffle Share %</label>
                                                    <input type="number" className="input input--mono" value={cfgRaffleSharePct}
                                                        onChange={(e) => setCfgRaffleSharePct(Number(e.target.value))} min={0} max={100} step={1} />
                                                </div>
                                            </div>
                                            <div className={styles.formGroup}>
                                                <label className={styles.formLabel}>Skill Curve % (rank 1, 2, 3, ...)</label>
                                                <input type="text" className="input input--mono" value={cfgSkillCurve} onChange={(e) => setCfgSkillCurve(e.target.value)} placeholder="31.25, 22.5, 17.5, 12.5, 10, 6.25" />
                                                <span className={styles.formHint}>Each rank's % within Skill Share. Should sum to 100.</span>
                                            </div>
                                            <div className={styles.formGroup}>
                                                <label className={styles.formLabel}>Raffle Curve % (winner 1, 2, 3, ...)</label>
                                                <input type="text" className="input input--mono" value={cfgRaffleCurve} onChange={(e) => setCfgRaffleCurve(e.target.value)} placeholder="40, 25, 20, 10, 5" />
                                                <span className={styles.formHint}>Each winner position's % within Raffle Share. Should sum to 100.</span>
                                            </div>
                                        </>
                                    )}
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Skill Prizes (rank 1, 2, 3, ...)</label>
                                        <input type="text" className="input input--mono" value={cfgSkillPrizes}
                                            onChange={(e) => setCfgSkillPrizes(e.target.value)}
                                            placeholder="500, 300, 200"
                                            readOnly={cfgPrizeMode === 'preset'}
                                            style={cfgPrizeMode === 'preset' ? { opacity: 0.7, cursor: 'not-allowed' } : undefined} />
                                        {cfgPrizeMode === 'preset' && (
                                            <span className={styles.formHint}>Auto-derived from preset shares + curves above.</span>
                                        )}
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Raffle Prizes (winner 1, 2, 3, ...)</label>
                                        <input type="text" className="input input--mono" value={cfgRafflePrizes}
                                            onChange={(e) => setCfgRafflePrizes(e.target.value)}
                                            placeholder="100, 50, 25"
                                            readOnly={cfgPrizeMode === 'preset'}
                                            style={cfgPrizeMode === 'preset' ? { opacity: 0.7, cursor: 'not-allowed' } : undefined} />
                                        {cfgPrizeMode === 'preset' && (
                                            <span className={styles.formHint}>Auto-derived from preset shares + curves above.</span>
                                        )}
                                    </div>
                                    {/* Live prize-totals descriptor: warns when sums don't match Total Pool */}
                                    <div style={{
                                        padding: '0.5rem 0.75rem',
                                        background: prizeSums.matches ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                        border: `1px solid ${prizeSums.matches ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
                                        borderRadius: '6px',
                                        fontSize: '0.8125rem',
                                        color: prizeSums.matches ? '#22c55e' : '#fbbf24',
                                        fontFamily: 'monospace',
                                    }}>
                                        <strong>{prizeSums.matches ? '✓' : '⚠'}</strong>
                                        {' '}Skill total: {prizeSums.skillTotal.toLocaleString('en-US')}
                                        {' | '}Raffle total: {prizeSums.raffleTotal.toLocaleString('en-US')}
                                        {' | '}Combined: {prizeSums.combined.toLocaleString('en-US')}
                                        {prizeSums.matches
                                            ? ' (matches Total Pool)'
                                            : ` (Total Pool: ${cfgPrizeTotalPool.toLocaleString('en-US')})`}
                                    </div>
                                </>
                            )}

                            <h3 className={styles.formSectionTitle}>Asset List</h3>
                            <p className={styles.formHint} style={{ marginBottom: '0.5rem' }}>
                                Tradable assets scored in this tournament. Leave empty for the permissive fallback (engine accepts all symbols observed).
                            </p>
                            {!adminSecret && cfgTradableAssets.length === 0 && !cfgTradableAssetsError && (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                                    Enter admin secret in the field at the top of this modal to load the asset dropdown.
                                </p>
                            )}
                            {cfgTradableAssetsError && (
                                <p style={{ color: 'var(--status-warning)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                                    Asset list fetch failed; falling back to free-text.
                                </p>
                            )}
                            {cfgAssetList.map((asset, i) => (
                                <div key={i} className={styles.assetRow}>
                                    {/* Labeled grid + Custom Select.
                                     * Custom Select replaces a native <select>+free-text fallback.
                                     * If cfgTradableAssets empty (admin secret not yet loaded), Select shows "No options".
                                     * Hint combines both `mint` (main-pool SPL token mint) AND `synthetic_custody_mint`
                                     * (commodities-pool RWA synth PDA): both must remain admin-visible. Engines do NOT
                                     * match against synth PDA (RWA position.token_account_mint = "1111…"). */}
                                    <div className={styles.assetRowField}>
                                        <label className={styles.assetRowFieldLabel}>Symbol</label>
                                        <Select
                                            ariaLabel="Asset symbol"
                                            value={asset.symbol}
                                            onChange={(symbol) => {
                                                const fromApi = cfgTradableAssets.find((tt) => tt.symbol === symbol);
                                                setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, symbol, mint: fromApi?.mint, feed_id: fromApi?.feed_id } : a));
                                            }}
                                            placeholder="Select asset"
                                            options={cfgTradableAssets.map((tt) => {
                                                const parts = [
                                                    tt.mint ? `${tt.mint.slice(0, 4)}…${tt.mint.slice(-4)}` : null,
                                                    tt.synthetic_custody_mint ? `synth: ${tt.synthetic_custody_mint.slice(0, 4)}…${tt.synthetic_custody_mint.slice(-4)}` : null,
                                                ].filter((p): p is string => p !== null);
                                                return {
                                                    value: tt.symbol,
                                                    label: tt.symbol,
                                                    hint: parts.length > 0 ? parts.join(' / ') : undefined,
                                                };
                                            })}
                                        />
                                    </div>
                                    <div className={styles.assetRowField}>
                                        <label className={styles.assetRowFieldLabel}>Feed ID</label>
                                        <Tooltip content="Pyth Lazer feed_id (auto-filled for known symbols; override if needed)">
                                            <input type="number" className="input input--mono"
                                                placeholder="feed_id"
                                                value={asset.feed_id ?? ''}
                                                onChange={(e) => {
                                                    const v = e.target.value ? Number(e.target.value) : undefined;
                                                    setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, feed_id: v } : a));
                                                }} />
                                        </Tooltip>
                                    </div>
                                    <span className={styles.assetRowJoinedAt}>joined: {asset.joinedAt}</span>
                                    <div className={styles.assetRowField}>
                                        <label className={styles.assetRowFieldLabel}>LM Steps (CSV)</label>
                                        <Tooltip content="Comma-separated step values (e.g. 10,20,30,40,50,60,70,80,90,100). Leave empty for crypto default.">
                                            <input type="text" className="input input--mono"
                                                placeholder="lmSteps CSV"
                                                value={asset.lmSteps ?? ''}
                                                onChange={(e) => setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, lmSteps: e.target.value } : a))} />
                                        </Tooltip>
                                    </div>
                                    <div className={styles.assetRowField}>
                                        <label className={styles.assetRowFieldLabel}>± Tol</label>
                                        <Tooltip content="Tolerance window (default 2 for crypto; ~0.2 for sub-10x RWA ladders)">
                                            <input type="number" className="input input--mono"
                                                placeholder="±tol"
                                                value={asset.lmTolerance ?? ''}
                                                onChange={(e) => setCfgAssetList((prev) => prev.map((a, j) => j === i ? { ...a, lmTolerance: e.target.value } : a))}
                                                step="0.01" min="0.01" />
                                        </Tooltip>
                                    </div>
                                    <button type="button" className={`btn btn--secondary ${styles.assetRowRemove}`}
                                        onClick={() => setCfgAssetList((prev) => prev.filter((_, j) => j !== i))}
                                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>×</button>
                                </div>
                            ))}
                            <button type="button" className="btn btn--secondary"
                                onClick={() => setCfgAssetList((prev) => [...prev, { symbol: '', mint: '', joinedAt: todayUtc() }])}
                                style={{ marginTop: '0.5rem' }}>
                                <Plus size={14} /> Add Asset
                            </button>

                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => { resetConfigDefaults(); setShowCreateModal(false); }}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={creating || !newName.trim()}>
                                    {editingTournamentId !== null
                                        ? <><Pencil size={14} /> {creating ? 'Saving...' : 'Save Changes'}</>
                                        : <><Plus size={14} /> {creating ? 'Creating...' : 'Create Tournament'}</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* RAFFLE DRAW MODAL */}
            {showDrawModal && (
                <div className={styles.modalOverlay} onClick={() => setShowDrawModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}><Sparkles size={18} style={{ marginRight: 6 }} /> Draw Raffle Winners</h2>
                            <button className={styles.modalClose} onClick={() => setShowDrawModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleDrawRaffle} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={drawTournamentId ?? ''} readOnly />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Bitcoin Block Hash</label>
                                <input type="text" className="input input--mono" placeholder="000000000000000000024bead8df69990852c202..."
                                    value={drawBlockHash} onChange={(e) => setDrawBlockHash(e.target.value)} autoFocus />
                                <span className={styles.formHint}>Deterministic seed: use a recent Bitcoin block hash for verifiability.</span>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Number of Winners</label>
                                <input type="number" className="input input--mono" value={drawPrizeCount} readOnly disabled
                                    style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                                <span className={styles.formHint}>
                                    Locked to <code>rafflePrizes.length</code> from tournament config; prevents a prizeCount/rafflePrizes mismatch.
                                </span>
                            </div>
                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowDrawModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={actionLoading || !drawBlockHash.trim()}>
                                    <Sparkles size={14} /> {actionLoading ? 'Drawing...' : 'Execute Draw'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* CATEGORY SCORING MODAL */}
            {showCategoryModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCategoryModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}><CalendarDays size={18} style={{ marginRight: 6 }} /> Score Daily Categories</h2>
                            <button className={styles.modalClose} onClick={() => setShowCategoryModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleScoreCategories} className={styles.modalForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tournament ID</label>
                                <input type="number" className="input input--mono" value={categoryTournamentId ?? ''} readOnly />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Date (YYYY-MM-DD)</label>
                                <input type="date" className="input input--mono" value={categoryDate} onChange={(e) => setCategoryDate(e.target.value)} />
                            </div>
                            <div className={styles.modalActions}>
                                <button type="button" className="btn btn--secondary" onClick={() => setShowCategoryModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={actionLoading}>
                                    <BarChart3 size={14} /> {actionLoading ? 'Scoring...' : 'Score Categories'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
