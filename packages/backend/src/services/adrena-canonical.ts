// ============================================================================
// Adrena Canonical Static Data (Phase 8.k)
//
// Source-of-truth: synced from https://github.com/AdrenaFoundation/adrena-abi
// pinned at commit b7ff6fb59a86b87fcf8084c213a4d7d2c20a8562
// (release/39 canonical, version 2.1.0-release39, snapshotted 2026-05-04).
//
// Replaces Phase 8.h's runtime two-source HTTP join (/last-trading-prices +
// /liquidity-info) for /admin/tradable-assets. Maps below mirror four
// authoritative sources in the abi repo:
//   - configs/oracles/autonom.mainnet.json    → 9 symbols + Pyth Lazer feed_ids
//   - configs/oracles/feed_metadata.json      → sessioned[] flag (RWA = true)
//   - configs/pools_manifest.json             → synthetic-custody PDAs (RWAs)
//   - src/lib.rs:46-50 constants              → SPL token mints (USDC/BONK/JITO/WBTC)
//
// CRITICAL distinction (D47, caught during gate-3 verification 2026-05-04):
// `pools_manifest.json:custodies[]` contains on-chain Custody account PDAs
// (e.g. Dk523LZ... for USDC custody) — NOT SPL token mints. Engines match
// `position.token_account_mint === asset.mint` against SPL TOKEN MINTS, so
// the value stored in our `mint` field must come from src/lib.rs constants
// (USDC_MINT, BONK_MINT, JITO_MINT, WBTC_MINT) — empirically equal to the
// pre-8.k live `/liquidity-info?pool_name=main-pool` response. Conflating
// these two would silently break ALL crypto scoring on T2+ tournaments.
//
// ----------------------------------------------------------------------------
// Re-sync procedure when Adrena ships a new release:
//   1. cd <adrena-abi-readonly-clone> && git pull
//   2. Diff the 4 source locations above against the values below.
//   3. Update the maps + bump the commit hash + sync-date comment.
//   4. Run `npm run dev -w packages/backend` and verify /admin/tradable-assets
//      returns the expected 9-entry shape via curl.
//
// Why static-mirror over @adrena/abi github dep (D44):
//   - We're a tournament engine, not a core Adrena consumer (no IDL or PDA
//     derivation needed). Just three small maps.
//   - github-direct npm installs are slower/less reliable than registry installs.
//   - The abi loader exports .ts files (uncompiled); production tsc resolution
//     would need additional config.
//   - Adrena's own frontend isn't yet on @adrena/abi (per their README "Out of
//     scope" list), so we'd be early adopters carrying compatibility risk.
//   - Release cadence is roughly twice per year; sync overhead ~5 minutes.
// ============================================================================

// --- Pyth Lazer feed_id per Adrena symbol (autonom.mainnet.json) ---
//
// Used by services/pyth-client.ts for the Pyth Lazer fallback OHLC fetch path
// (Phase 8.f primary is Pyth Benchmarks via ADRENA_TO_PYTH_SYMBOL in types.ts).
// The "autonom_feed_id" in the abi repo equals the Pyth Lazer feed_id used by
// www.adrena.trade/api/oracle-bars?feed_id=<id>. WBTC is aliased to BTC's
// canonical (3001) per the abi repo comment — Autonom backend signs each
// requested alias separately, so on-chain receives feed_id=32 (BTC) and
// feed_id=33 (WBTC) with the same price.
export const ADRENA_TO_LAZER_FEED_ID: Record<string, number> = {
    SOL: 3005,
    JITOSOL: 3023,
    BTC: 3001,
    WBTC: 3001,
    BONK: 3016,
    USDC: 4001,
    XAU: 2056,
    XAG: 2069,
    WTI: 2035,
};

// --- Sessioned flag per symbol (feed_metadata.json) ---
//
// true  = market-hours-restricted (RWAs only — XAU/XAG/WTI).
// false = 24/7 (crypto).
// Surfaced via /admin/tradable-assets so admin UI can label RWA assets
// without re-deriving from symbol prefix.
export const ADRENA_SESSIONED: Record<string, boolean> = {
    SOL: false, JITOSOL: false, BTC: false, WBTC: false, BONK: false, USDC: false,
    XAU: true, XAG: true, WTI: true,
};

// --- main-pool SPL token mints per symbol (src/lib.rs:46-50, abi repo) ---
//
// CRITICAL: these are SPL token mint pubkeys, NOT custody account PDAs.
// Engines match `position.token_account_mint === asset.mint`, so the value
// stored in our `mint` field MUST be the SPL token mint of the underlying
// custody token.
//
// Sourced from src/lib.rs constants (USDC_MINT, BONK_MINT, JITO_MINT,
// WBTC_MINT) — NOT from pools_manifest.custodies[] which is custody PDAs.
//
// ----------------------------------------------------------------------------
// EMPIRICAL VERIFICATION (T-30min audit before T1 launch, 2026-05-04):
// curl https://datapi.adrena.trade/position?user_wallet=<ZeDef_wallet>&limit=1000
// across 732 real positions covering all 6 T1 assets. Findings:
//
//   position.symbol           position.token_account_mint
//   ───────────────           ─────────────────────────────────────────────
//   "Bonk"          (mixed)   DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
//   "JitoSOL"       (mixed)   J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn
//   "WBTC"          (upper)   3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh
//   "XAU"|"XAG"|"WTI"         11111111111111111111111111111111  (sentinel)
//   (no "SOL" or "BTC" symbol ever appears in /position data)
//
// IMPLICATIONS:
// 1. SOL/BTC trading on Adrena post-Apr-29 routes through jitoSOL/WBTC
//    custodies. /position records position.token_account_mint = JITO_MINT
//    (for SOL trades) and WBTC_MINT (for BTC trades). To capture SOL trades
//    in scoring, asset.mint MUST be set to JITO_MINT. Same for BTC.
// 2. RWA positions use a SENTINEL system-program mint (11111…), confirming
//    D45 — they have no real SPL token mint, so engine matching CANNOT use
//    `mint`. Symbol fallback is the only viable path. Since /position
//    returns "XAU"/"XAG"/"WTI" (uppercase), our uppercase asset symbols
//    match exactly.
// 3. /position symbol casing is INCONSISTENT with /liquidity-info and
//    /last-trading-prices (which use uppercase). Engine matching by symbol
//    fallback is case-sensitive — so any asset relying on symbol fallback
//    (RWAs) needs case-exact match against /position output.
//
// ALIAS WARNING for admin: SOL and JITOSOL share the same mint (JITO_MINT)
// because they're the same custody. Admin must NOT add both to one
// tournament's assetList — engine would double-count every JitoSOL position
// once per asset entry. Same for BTC and WBTC. The frontend dropdown could
// flag this in a follow-up; for now, admin discretion.
// ----------------------------------------------------------------------------
const MAIN_POOL_TOKEN_MINT_BY_SYMBOL: Record<string, string> = {
    SOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',     // JITO_MINT — SOL trades use jitoSOL custody (alias of JITOSOL below)
    JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // src/lib.rs JITO_MINT (same mint as SOL — admin pick one or the other)
    BTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',     // WBTC_MINT — BTC trades use WBTC custody (alias of WBTC below)
    WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',    // src/lib.rs WBTC_MINT (same mint as BTC — admin pick one or the other)
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',    // src/lib.rs BONK_MINT
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',    // src/lib.rs USDC_MINT (collateral; rarely scored as a tradable asset)
};

// --- commodities-pool synthetic-custody PDAs per symbol (pools_manifest.json) ---
//
// commodities-pool (autonom type, address GN2hyBVHcUitWETeDfAoeXDMqow1x8StqdRFnGaUB2vb,
//   deployed 2026-04-23 via DAO bootstrap):
// Synthetic custodies are virtual perpetuals — no underlying SPL token mint.
// These pubkeys are the synthetic Custody account PDAs from
// pools_manifest.synthetic_custodies[]. On-chain order: XAU=0, WTI=1, XAG=2
// (WTI proposal landed before XAG). trade_oracle_feed_id pairs (adrena_feed_id,
// all Autonom): XAU=36, XAG=37, WTI=38. allow_swap=false; users open/close
// positions directly. max_cumulative_long/short_position_size_usd = $500k each side.
//
// EXPOSURE NOTE: surfaced under separate `synthetic_custody_mint` field per
// D45 — informational only. Engines do NOT match against this (they fall
// back to symbol matching for RWAs since `mint` stays undefined).
//
// D45 EMPIRICALLY RATIFIED 2026-05-04: ZeDef wallet RWA positions confirmed
// position.token_account_mint == "11111111111111111111111111111111" (system
// program sentinel) — definitively NOT the synthetic-custody PDA. Engine
// matching against the synth PDA would fail for every RWA position. Symbol
// fallback ('XAU' === 'XAU' etc) is the only viable path. D45 is structurally
// correct; the synth PDA stays informational for admin UI display only.
const COMMODITIES_POOL_SYNTHETIC_CUSTODY_BY_SYMBOL: Record<string, string> = {
    XAU: 'JB86ouHXGYgF4UbPs8yxYdaHudrdsintf5EbBfMydzYt',
    WTI: 'De21TFyUPHkvFsWAt6xJLBBXGp636VuL5cKk2DvfbHiR',
    XAG: 'PexsCkkxpVmY4HNxUjT3U9PEg69kYScc8GukUwn6Q3Q',
};

// ----------------------------------------------------------------------------
// Tradable assets — pre-computed for /admin/tradable-assets
//
// API shape decision (D45, empirically ratified 2026-05-04): RWA synthetic-
// custody mints surface under a SEPARATE optional field `synthetic_custody_mint`
// rather than the existing `mint` field. Empirical: RWA positions return
// position.token_account_mint = "11111111111111111111111111111111" (system
// program sentinel), NOT the synthetic-custody PDA. Engine matching against
// the synth PDA would fail every RWA position. Symbol fallback is the only
// viable path. The synth PDA stays in `synthetic_custody_mint` for admin UI
// display only.
// ----------------------------------------------------------------------------
export interface TradableAsset {
    symbol: string;
    feed_id: number;
    sessioned: boolean;
    /** Standard custody mint — main-pool only. Engine matches positions on this. */
    mint?: string;
    /** Synthetic custody mint — commodities-pool RWAs only. Informational only
     *  pending empirical T1 confirmation that position.token_account_mint
     *  equals synthetic-custody pubkey (D45). */
    synthetic_custody_mint?: string;
    /** Pool the asset trades on. */
    pool_name: 'main-pool' | 'commodities-pool';
}

export function getTradableAssets(): TradableAsset[] {
    const assets: TradableAsset[] = [];

    // main-pool: 6 crypto symbols. All have mints set (post-2026-05-04 fix-it):
    //   SOL/JITOSOL share JITO_MINT (jitoSOL custody — admin picks one);
    //   BTC/WBTC share WBTC_MINT (WBTC custody — admin picks one);
    //   BONK/USDC have their own mints.
    for (const symbol of ['SOL', 'JITOSOL', 'BTC', 'WBTC', 'BONK', 'USDC']) {
        assets.push({
            symbol,
            feed_id: ADRENA_TO_LAZER_FEED_ID[symbol],
            sessioned: ADRENA_SESSIONED[symbol],
            mint: MAIN_POOL_TOKEN_MINT_BY_SYMBOL[symbol],
            pool_name: 'main-pool',
        });
    }

    // commodities-pool: 3 RWA synthetic custodies
    for (const symbol of ['XAU', 'XAG', 'WTI']) {
        assets.push({
            symbol,
            feed_id: ADRENA_TO_LAZER_FEED_ID[symbol],
            sessioned: ADRENA_SESSIONED[symbol],
            synthetic_custody_mint: COMMODITIES_POOL_SYNTHETIC_CUSTODY_BY_SYMBOL[symbol],
            pool_name: 'commodities-pool',
        });
    }

    return assets;
}
