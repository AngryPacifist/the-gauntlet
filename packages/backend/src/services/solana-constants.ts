// ============================================================================
// Solana on-chain constants: single source of truth
// ============================================================================
//
// Program IDs, token mints, pool addresses, account-layout offsets, and
// discriminators used across the Mutagen engine. All values are
// chain-invariant facts (not env-configurable, not secret).
//
// Every value here is a chain-invariant fact, verified empirically on mainnet.
// ============================================================================

import { PublicKey } from '@solana/web3.js';

// ---------- Adrena ----------
export const ADRENA_PROGRAM_ID = new PublicKey('13gDzEXCdocbj8iAiqrScGo47NiSuYENGsRqi3SEAwet');
export const ADRENA_MAIN_POOL = new PublicKey('4bQRutgDJs6vuh6ZcWaPVXiQaBzbHketjbCDjL4oRN34');
export const ADRENA_COMMODITIES_POOL = new PublicKey('GN2hyBVHcUitWETeDfAoeXDMqow1x8StqdRFnGaUB2vb');

// UserStaking account (Adrena native staking, per Activity 1 + 2)
export const ADRENA_USER_STAKING_SIZE = 3904;
export const ADRENA_USER_STAKING_DISCRIMINATOR = new Uint8Array([
    0x22, 0x53, 0xca, 0x5d, 0x19, 0xf3, 0x3f, 0x36,
]);

// Staking pool account (one per staked-token mint, 2304 bytes)
export const ADRENA_STAKING_POOL_SIZE = 2304;

// ---------- Token mints ----------
// ADX + ALP mint pubkeys are PDAs of the Adrena program. The values below
// are the canonical pubkeys (verified empirically); the future adrena-pda
// helper module will re-assert this match at boot via assertCanonicalPdas().
export const ADX_MINT = new PublicKey('AuQaustGiaqxRvj2gtCdrd22PBzTn8kM3kEPEkZCtuDw');
export const ALP_MINT = new PublicKey('4yCLi5yWGzpTWMQ1iWHG5CrGYAdBkhyEdsuSugjDUqwj');
export const RWALP_MINT = new PublicKey('GMZ7hCGeHyDr1giM4dyP2eTkj9GQ2T1G9cBDridLz5Cx');
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ---------- SPL Governance + AdrenaDAO realm ----------
export const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');
export const ADRENADAO_REALM = new PublicKey('GWe1VYTRMujAtGVhSLwSn4YPsXBLe5qfkzNAYAKD44Nk');
export const ADRENADAO_GOVERNANCES: ReadonlyArray<PublicKey> = [
    new PublicKey('HbzDAYnhidh35woSLmbqCgvjc52ZUPPQfN1fGDa7CTXx'),
    new PublicKey('HgeoVqTTMQ9K5GZAUpPKaz5PS8Rn55yR5e5SwmB3DbKB'),
];

// SPL Gov account-type discriminator (byte at offset 0)
export const SPL_GOV_ACCOUNT_TYPE = {
    Uninitialized: 0,
    GovernanceV1: 3,
    VoteRecordV2: 12,
    ProposalV2: 14,
    TokenOwnerRecordV2: 17,
    GovernanceV2: 18,
} as const;

// Memcmp offsets inside SPL Gov structs
//   TokenOwnerRecord: realm at offset 1, governing_token_owner at offset 65
//   VoteRecord:       governing_token_owner at offset 33
export const SPL_GOV_OFFSET = {
    TOR_REALM: 1,
    TOR_GOVERNING_TOKEN_OWNER: 65,
    VOTE_RECORD_GOVERNING_TOKEN_OWNER: 33,
} as const;

// ---------- Meteora DLMM ----------
export const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

// The 2 incentivized ADX-Meteora pools (enabled by default in
// DEFAULT_EPOCH_CONFIG)
export const METEORA_POOL_ADX_SOL = new PublicKey('JCaK6qFS4e3YDAnmR2L84KhnrDf5NMwgRjbXgFvxFDnX');
export const METEORA_POOL_ADX_USDC = new PublicKey('JCYMX9Nx7DTUdguptRR5LLSc62MEbNmFYsbT5R9yCDGy');

// 4 extra POL pools (per docs.adrena.xyz useful-links). All currently
// dormant; disabled by default in DEFAULT_EPOCH_CONFIG. Admin can enable
// per-epoch if any wake up.
export const METEORA_POOL_ALP_USDC = new PublicKey('4wM3eJMduZBFytW6VqV5DC2CaSovRrM2RJG8bJkroqLD');
export const METEORA_POOL_ALP_SOL = new PublicKey('39xxvte8BMaW7qBxeedFk9iauG42vxFsTA7yzM9X9cQN');
export const RAYDIUM_POOL_ADX_SOL = new PublicKey('7KFMHSyLzeEFebofSLS4zFbHZgkSDJY3CWpd9rJq2Jio');
export const RAYDIUM_POOL_ADX_USDC = new PublicKey('2QNwSWsp1deYmNbuZgjFrZ55jnUbiwGrnPk6FMiZ1mEf');

// ---------- Streamflow ----------
// Kept for a future StreamflowLockSource. Activity 1 currently uses the
// Adrena native primitive, so these are not enumerated yet.
export const STREAMFLOW_STREAMS_PROGRAM_ID = new PublicKey('strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m');
export const STREAMFLOW_ALIGNED_PROGRAM_ID = new PublicKey('aSTRM2NKoKxNnkmLWk9sz3k74gKBk9t7bpPrTGxMszH');

// Streamflow Stream account (Lock + Vesting)
export const STREAMFLOW_STREAM_SIZE = 1104;
export const STREAMFLOW_STREAM_DISCRIMINATOR = new Uint8Array([
    172, 138, 115, 242, 121, 67, 183, 26,
]);
export const STREAMFLOW_OFFSET = {
    SENDER: 49,
    RECIPIENT: 113,
    MINT: 177,
    CLOSED: 671,
} as const;
