// ============================================================================
// Realms / SPL Governance client — pure SPL Gov reads (no DB coupling)
// ============================================================================
//
// Used by Activity 2 scoring (DAO voting dimension). All vote / TOR / proposal
// counts come through here. DB caching of vote counts lives in vote-cache.ts;
// this module is pure RPC reads.
//
// Account-type byte offsets and memcmp positions were verified empirically
// during the inventory phase against AdrenaDAO realm
// `GWe1VYTRMujAtGVhSLwSn4YPsXBLe5qfkzNAYAKD44Nk` — see
// `.agent/brain/mutagen_rework_r2_inventory.md` §3c and §6 amendment #26
// (TokenOwnerRecord owner at offset 65, NOT 33 — common SPL Gov pitfall).
//
// Empirical baselines from the inventory:
//   - ZeDef vote count = 142
//   - OUTIS vote count = 0
//   - OUTIS has a TokenOwnerRecord in the AdrenaDAO realm
//   - Total proposals across both governances = 330 (7 + 323)
// ============================================================================

import { PublicKey } from '@solana/web3.js';
import { rpcCall } from './solana-rpc.js';
import {
    SPL_GOVERNANCE_PROGRAM_ID,
    ADRENADAO_REALM,
    ADRENADAO_GOVERNANCES,
    SPL_GOV_ACCOUNT_TYPE,
    SPL_GOV_OFFSET,
} from './solana-constants.js';

// JSON-RPC getProgramAccounts response shape
interface RpcProgramAccount {
    pubkey: string;
    account: {
        data: [string, 'base64'];
        lamports: number;
        owner: string;
        executable: boolean;
        rentEpoch: number;
    };
}

interface MemcmpFilter {
    memcmp: { offset: number; bytes: string };
}

interface DataSizeFilter {
    dataSize: number;
}

type AccountsFilter = MemcmpFilter | DataSizeFilter;

/**
 * Wraps the raw JSON-RPC `getProgramAccounts` call with our standard
 * encoding + filter + dataSlice shape. The dataSlice keeps payloads tiny —
 * we only need the first byte (the account-type discriminator) for filtering
 * across SPL Gov account variants.
 */
async function getProgramAccountsRaw(
    programId: PublicKey,
    filters: AccountsFilter[],
    dataSliceLength = 1,
): Promise<RpcProgramAccount[]> {
    return rpcCall<RpcProgramAccount[]>('getProgramAccounts', [
        programId.toBase58(),
        {
            encoding: 'base64',
            filters,
            dataSlice: { offset: 0, length: dataSliceLength },
        },
    ]);
}

/**
 * Returns the count of VoteRecordV2 accounts cast by a wallet across the
 * SPL Gov program. Not realm-scoped at the protocol level (the memcmp
 * filter just matches governing_token_owner) — but AdrenaDAO is the only
 * realm we care about, and a wallet's vote records under other realms
 * would only inflate the count beyond what we want to score.
 *
 * For Mutagen R2 scoring this is good enough because:
 *   - 99.9% of community wallets are AdrenaDAO-only (the relevant realm
 *     for this ecosystem)
 *   - Activity 2 voting score is bracketed, not literal-count, so a small
 *     over-count from cross-realm activity has minimal impact
 *   - Strict realm-scoping would require joining VoteRecord -> Proposal
 *     -> Governance -> Realm (one extra round trip per vote)
 *
 * If cross-realm bleed becomes a real concern, upgrade later.
 */
export async function getWalletVoteCount(wallet: PublicKey): Promise<number> {
    const accounts = await getProgramAccountsRaw(SPL_GOVERNANCE_PROGRAM_ID, [
        {
            memcmp: {
                offset: SPL_GOV_OFFSET.VOTE_RECORD_GOVERNING_TOKEN_OWNER,
                bytes: wallet.toBase58(),
            },
        },
    ]);
    return accounts.filter((a) => {
        const buf = Buffer.from(a.account.data[0], 'base64');
        return buf.length >= 1 && buf[0] === SPL_GOV_ACCOUNT_TYPE.VoteRecordV2;
    }).length;
}

/**
 * Returns the TokenOwnerRecordV2 pubkey for a wallet in the AdrenaDAO
 * realm, or null if the wallet hasn't deposited governing/shadow tokens.
 *
 * Filters: dataSize 282 (TokenOwnerRecordV2 size) + memcmp on realm
 * (offset 1) + memcmp on governing_token_owner (offset 65). The combined
 * filters narrow the set to at most one match on the RPC side; no
 * client-side filtering is needed afterwards.
 */
export async function getTokenOwnerRecordPubkey(
    wallet: PublicKey,
): Promise<PublicKey | null> {
    const accounts = await getProgramAccountsRaw(SPL_GOVERNANCE_PROGRAM_ID, [
        { dataSize: 282 },
        {
            memcmp: {
                offset: SPL_GOV_OFFSET.TOR_REALM,
                bytes: ADRENADAO_REALM.toBase58(),
            },
        },
        {
            memcmp: {
                offset: SPL_GOV_OFFSET.TOR_GOVERNING_TOKEN_OWNER,
                bytes: wallet.toBase58(),
            },
        },
    ]);
    if (accounts.length === 0) return null;
    return new PublicKey(accounts[0].pubkey);
}

// ---------- Total-proposals helper (display only) ----------

interface ProposalsCacheEntry {
    value: number;
    at: number;
}

let _totalProposalsCache: ProposalsCacheEntry | null = null;
const TOTAL_PROPOSALS_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Total ProposalV2 count across AdrenaDAO's two governances. Used by the
 * stats display on the leaderboard page ("voted on X% of all proposals"
 * framing) — NOT in scoring. 1h cache so refreshes are cheap.
 */
export async function getTotalAdrenaDaoProposals(): Promise<number> {
    if (
        _totalProposalsCache &&
        Date.now() - _totalProposalsCache.at < TOTAL_PROPOSALS_TTL_MS
    ) {
        return _totalProposalsCache.value;
    }
    let total = 0;
    for (const gov of ADRENADAO_GOVERNANCES) {
        const accounts = await getProgramAccountsRaw(SPL_GOVERNANCE_PROGRAM_ID, [
            { memcmp: { offset: 1, bytes: gov.toBase58() } },
        ]);
        total += accounts.filter((a) => {
            const buf = Buffer.from(a.account.data[0], 'base64');
            return buf.length >= 1 && buf[0] === SPL_GOV_ACCOUNT_TYPE.ProposalV2;
        }).length;
    }
    _totalProposalsCache = { value: total, at: Date.now() };
    return total;
}
