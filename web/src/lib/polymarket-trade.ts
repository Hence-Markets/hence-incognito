/* =========================================================================
   Polymarket REAL trading — CLOB V2 (April-2026 upgrade).

   The whole client-side integration behind the `hence.pmtrade` flag:
   - getWalletClient(privyWallet)   → viem WalletClient on Polygon (auto chain-switch)
   - ensureAuth(address)            → derive-or-load the USER's L2 HMAC creds
   - readiness(address)             → chain + pUSD/USDC.e balances + the 5 allowances
   - prepare(market, side, amount)  → order preview {price, size, notional, feeBps}
   - wrapUsdce / approve*           → the on-chain steps (user confirms each in-wallet)
   - placeOrder(args)               → build+sign+post via the SDK, w/ disabled-code fallback

   Keys never leave the browser. L2 creds are the user's own and are held only in
   module memory for the current page session — never persisted or sent to our server.

   Verified against docs.polymarket.com/v2-migration + the shipped
   @polymarket/clob-client-v2 (1.0.8) .d.ts. Contract addresses come from the
   SDK's own getContractConfig(137) so they can't drift from the client.
   ========================================================================= */
import {
  createWalletClient, createPublicClient, custom, http, encodeFunctionData,
  parseUnits, formatUnits, type Hex, type WalletClient,
} from 'viem';
import { polygon } from 'viem/chains';
import {
  ClobClient, Chain, Side, OrderType, SignatureTypeV2, AssetType,
  getContractConfig, type ApiKeyCreds,
} from '@polymarket/clob-client-v2';

/* ------------------------------------------------------------------ config */
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;
const CHAIN_HEX = '0x89'; // 137
// The USDC.e ERC-20 on Polygon (bridged USDC) — the deposit asset that gets
// wrapped into pUSD. Not exposed by getContractConfig, so pinned here.
const USDCE = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Hex;
// CollateralOnramp: wrap(asset, to, amount) turns USDC.e → pUSD.
const COLLATERAL_ONRAMP = '0x93070a847efEf7F70739046A929D47a521F5B8ee' as Hex;
// A generous approval so the user only ever approves once (max uint256).
const MAX_UINT = (2n ** 256n - 1n);

// Resolve the V2 contract set from the SDK itself (single source of truth).
const CC = getContractConfig(CHAIN_ID);
const CONTRACTS = {
  pusd: CC.collateral as Hex,               // pUSD (collateral) ERC-20
  ctf: CC.conditionalTokens as Hex,          // ConditionalTokens ERC-1155
  exchangeV2: CC.exchangeV2 as Hex,          // CTF Exchange V2
  negRiskExchangeV2: CC.negRiskExchangeV2 as Hex, // NegRisk CTF Exchange V2
  usdce: USDCE,
  onramp: COLLATERAL_ONRAMP,
};

/* ------------------------------------------------------------------ ABIs (minimal) */
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const ERC1155_ABI = [
  { name: 'isApprovedForAll', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 'op', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'setApprovalForAll', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'op', type: 'address' }, { name: 'ok', type: 'bool' }], outputs: [] },
] as const;
const ONRAMP_ABI = [
  { name: 'wrap', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

/* ------------------------------------------------------------------ typed errors */
export type PmErrorCode = 'GEO_BLOCKED' | 'NO_GAS' | 'NOT_READY' | 'WRONG_CHAIN' | 'NO_WALLET' | 'REJECTED' | 'CLOB_ERROR';
export class PmError extends Error {
  code: PmErrorCode;
  steps?: ReadinessStep[];
  constructor(code: PmErrorCode, message: string, steps?: ReadinessStep[]) {
    super(message); this.name = 'PmError'; this.code = code; this.steps = steps;
  }
}
// Classify an unknown thrown value into a PmError (geo-block, gas, user-reject…).
function classify(e: any): PmError {
  const msg = (e?.shortMessage || e?.message || String(e || 'Unknown error')).slice(0, 300);
  const low = msg.toLowerCase();
  if (/geo|forbidden|region|restricted|not available in|blocked/.test(low) || e?.status === 451 || e?.status === 403)
    return new PmError('GEO_BLOCKED', 'Polymarket is not available in your region.');
  if (/insufficient funds|gas required|out of gas|not enough (pol|matic)/.test(low))
    return new PmError('NO_GAS', 'Not enough POL for gas on Polygon. Add a little POL to cover network fees.');
  if (/user rejected|denied|user cancel|rejected the request|4001/.test(low))
    return new PmError('REJECTED', 'Request was rejected in your wallet.');
  return new PmError('CLOB_ERROR', msg);
}

/* ------------------------------------------------------------------ L2 credential lifetime
   These HMAC credentials can authorize CLOB activity. Persisting them in Web Storage
   makes any same-origin script compromise durable, so keep them only in memory and
   require a fresh wallet signature after a reload. Purge keys written by older builds. */
const credentialCache = new Map<string, ApiKeyCreds>();
const cacheKey = (addr: string) => String(addr || '').toLowerCase();
function purgeLegacyStoredCreds() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('hence.pmcreds.')) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}
purgeLegacyStoredCreds();

export function loadCreds(addr: string): ApiKeyCreds | null {
  const c = credentialCache.get(cacheKey(addr));
  return (c && c.key && c.secret && c.passphrase) ? c : null;
}
function saveCreds(addr: string, c: ApiKeyCreds) {
  credentialCache.set(cacheKey(addr), c);
}
export function clearCreds(addr?: string) {
  if (addr) credentialCache.delete(cacheKey(addr));
  else credentialCache.clear();
  purgeLegacyStoredCreds();
}

/* ------------------------------------------------------------------ wallet + rpc clients */
// Loosely typed on purpose: viem 2.52's strict PublicClient generics fight the
// bundler at read-call sites for minimal ABIs, and we only need readContract here.
let _pub: any = null;
// Read-only Polygon client for balance/allowance reads. Uses the public RPC;
// swap for a keyed endpoint later if rate-limited.
export function publicClient(): any {
  if (_pub) return _pub;
  _pub = createPublicClient({ chain: polygon, transport: http('https://polygon-rpc.com') });
  return _pub;
}

// Bridge a Privy wallet → viem WalletClient on Polygon, switching the wallet's
// active chain to Polygon (0x89) first (adding it if the wallet doesn't know it).
export async function getWalletClient(privyWallet: any, address: string): Promise<WalletClient> {
  if (!privyWallet || !address) throw new PmError('NO_WALLET', 'No wallet connected.');
  const provider = await privyWallet.getEthereumProvider();
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (err: any) {
    // 4902 = chain unknown to the wallet → add it, then it's active.
    if (err?.code === 4902 || /unrecognized chain|not been added/i.test(err?.message || '')) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_HEX, chainName: 'Polygon',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'],
        }],
      });
    } else if (err?.code === 4001) {
      throw new PmError('REJECTED', 'You declined switching to Polygon.');
    } else {
      throw classify(err);
    }
  }
  return createWalletClient({ account: address as Hex, chain: polygon, transport: custom(provider) });
}

// Read the chainId the wallet is currently on (for the readiness check).
async function currentChainId(privyWallet: any): Promise<number | null> {
  try {
    const provider = await privyWallet.getEthereumProvider();
    const hex = await provider.request({ method: 'eth_chainId' });
    return parseInt(hex, 16);
  } catch { return null; }
}

/* ------------------------------------------------------------------ CLOB client factory */
// Build a ClobClient bound to the user's wallet + (optional) L2 creds.
// builderCode is applied via builderConfig so every order inherits it (the SDK
// copies it into each order unless the order overrides). Pass undefined to omit
// attribution entirely (the disabled-code fallback path).
function makeClient(wallet: WalletClient, address: string, creds?: ApiKeyCreds, builderCode?: string): ClobClient {
  return new ClobClient({
    host: HOST,
    chain: Chain.POLYGON,
    signer: wallet,
    creds,
    signatureType: SignatureTypeV2.EOA,   // funder = the EOA itself (no proxy)
    funderAddress: address,
    builderConfig: builderCode ? { builderCode } : undefined,
  });
}

// L1 sign (one EIP-712 signature) to derive-or-create the user's L2 creds,
// caching them in memory per-address. Idempotent within a page session; reloads
// intentionally require a fresh signature.
export async function ensureAuth(privyWallet: any, address: string): Promise<ApiKeyCreds> {
  const existing = loadCreds(address);
  if (existing) return existing;
  const wallet = await getWalletClient(privyWallet, address);
  const client = makeClient(wallet, address);
  let creds: ApiKeyCreds;
  try {
    creds = await client.createOrDeriveApiKey();
  } catch (e) {
    throw classify(e);
  }
  saveCreds(address, creds);
  return creds;
}

/* ------------------------------------------------------------------ geoblock */
// Polymarket's own eligibility verdict for the CALLER'S IP (their official builder
// guidance: check client-side before order submission). Browser-direct on purpose —
// proxying would check the server's IP, not the user's — and it also catches VPN/
// datacenter IPs a static country list never could. Fail-OPEN on network errors:
// this gate is honest UX, PM enforces for real at order time regardless.
export type GeoblockStatus = { blocked: boolean; country: string; region?: string };
let geoCache: { at: number; v: GeoblockStatus } | null = null;
export async function geoblock(): Promise<GeoblockStatus | null> {
  if (geoCache && Date.now() - geoCache.at < 10 * 60_000) return geoCache.v;
  try {
    const r = await fetch('https://polymarket.com/api/geoblock', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const g = await r.json();
    const v: GeoblockStatus = { blocked: !!g.blocked, country: String(g.country || ''), region: g.region ? String(g.region) : undefined };
    geoCache = { at: Date.now(), v };
    return v;
  } catch { return null; }
}

/* ------------------------------------------------------------------ readiness */
export type ReadinessStep =
  | 'chain' | 'wrap' | 'approve_pusd_exchange' | 'approve_pusd_negrisk'
  | 'approve_ctf_exchange' | 'approve_ctf_negrisk';

export type Readiness = {
  onPolygon: boolean;
  pusdBalance: number;    // human units
  usdceBalance: number;   // human units
  allowances: {
    pusdExchange: boolean;
    pusdNegRisk: boolean;
    ctfExchange: boolean;
    ctfNegRisk: boolean;
  };
  // ordered list of steps still outstanding (empty = fully ready to trade)
  missing: ReadinessStep[];
  ready: boolean;
};

// A threshold above which we treat an ERC-20 allowance as "approved" (we set
// max-uint, so anything near that is our approval; guards against dust grants).
const ALLOW_OK = MAX_UINT / 2n;

// Read the full trading-readiness of an address from Polygon (no writes).
// Works for a zero-balance address (renders the step list correctly).
export async function readiness(privyWallet: any, address: string): Promise<Readiness> {
  const pub = publicClient();
  const acct = address as Hex;
  const [chainId, pusdBal, usdceBal, aPusdEx, aPusdNr, aCtfEx, aCtfNr] = await Promise.all([
    currentChainId(privyWallet),
    pub.readContract({ address: CONTRACTS.pusd, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] }).catch(() => 0n),
    pub.readContract({ address: CONTRACTS.usdce, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] }).catch(() => 0n),
    pub.readContract({ address: CONTRACTS.pusd, abi: ERC20_ABI, functionName: 'allowance', args: [acct, CONTRACTS.exchangeV2] }).catch(() => 0n),
    pub.readContract({ address: CONTRACTS.pusd, abi: ERC20_ABI, functionName: 'allowance', args: [acct, CONTRACTS.negRiskExchangeV2] }).catch(() => 0n),
    pub.readContract({ address: CONTRACTS.ctf, abi: ERC1155_ABI, functionName: 'isApprovedForAll', args: [acct, CONTRACTS.exchangeV2] }).catch(() => false),
    pub.readContract({ address: CONTRACTS.ctf, abi: ERC1155_ABI, functionName: 'isApprovedForAll', args: [acct, CONTRACTS.negRiskExchangeV2] }).catch(() => false),
  ]);

  const onPolygon = chainId === CHAIN_ID;
  const pusdBalance = Number(formatUnits(pusdBal as bigint, 6));
  const usdceBalance = Number(formatUnits(usdceBal as bigint, 6));
  const allowances = {
    pusdExchange: (aPusdEx as bigint) >= ALLOW_OK,
    pusdNegRisk: (aPusdNr as bigint) >= ALLOW_OK,
    ctfExchange: aCtfEx === true,
    ctfNegRisk: aCtfNr === true,
  };

  const missing: ReadinessStep[] = [];
  if (!onPolygon) missing.push('chain');
  // "wrap" is surfaced whenever there's non-dust USDC.e sitting unwrapped — it isn't usable
  // as collateral until wrapped. Gating on usdceBalance alone keeps this in lockstep with the
  // panel's step-list selection (which also keys off the USDC.e balance).
  if (usdceBalance > 0.01) missing.push('wrap');
  if (!allowances.pusdExchange) missing.push('approve_pusd_exchange');
  if (!allowances.pusdNegRisk) missing.push('approve_pusd_negrisk');
  if (!allowances.ctfExchange) missing.push('approve_ctf_exchange');
  if (!allowances.ctfNegRisk) missing.push('approve_ctf_negrisk');

  // "ready" = on-chain plumbing done (chain + approvals). Collateral sufficiency is a separate
  // funding concern enforced at order time (PmTradePanel.runOrder blocks on pUSD < order size).
  const ready = onPolygon && allowances.pusdExchange && allowances.pusdNegRisk
    && allowances.ctfExchange && allowances.ctfNegRisk;

  return { onPolygon, pusdBalance, usdceBalance, allowances, missing, ready };
}

/* ------------------------------------------------------------------ on-chain step actions
   Each returns the tx hash. The user confirms every one in their wallet.
   These are the eth_sendTransaction writes the readiness step buttons trigger. */

async function sendTx(wallet: WalletClient, address: string, to: Hex, data: Hex): Promise<Hex> {
  try {
    // viem's sendTransaction via the injected provider (Privy confirms it).
    return await wallet.sendTransaction({ account: address as Hex, chain: polygon, to, data } as any);
  } catch (e) {
    throw classify(e);
  }
}

// Switch the connected wallet to Polygon (the "chain" step).
export async function switchChain(privyWallet: any, address: string): Promise<void> {
  await getWalletClient(privyWallet, address); // performs the switch/add
}

// wrap(amount) on the CollateralOnramp: USDC.e → pUSD. Requires a prior USDC.e
// approval to the onramp, which we ensure here (approve → wrap, two confirmations).
export async function wrapUsdce(privyWallet: any, address: string, amount: number): Promise<Hex | void> {
  const wallet = await getWalletClient(privyWallet, address);
  const pub = publicClient();
  const amt = parseUnits(amount.toFixed(6), 6);
  if (amt <= 0n) return;   // nothing to wrap (guards the wrapAmount=0 default)
  const readAllow = () => pub.readContract({
    address: CONTRACTS.usdce, abi: ERC20_ABI, functionName: 'allowance',
    args: [address as Hex, CONTRACTS.onramp],
  }).catch(() => 0n) as Promise<bigint>;
  let allow = await readAllow();
  if (allow < amt) {
    const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.onramp, MAX_UINT] });
    const approveHash = await sendTx(wallet, address, CONTRACTS.usdce, approveData);
    // sendTransaction resolves on submission, not inclusion — wait for the approval to be MINED,
    // then RE-READ the allowance: if it didn't actually land (dropped / replaced / cancelled) we
    // must NOT submit wrap(), whose transferFrom would revert on a still-zero allowance.
    await pub.waitForTransactionReceipt({ hash: approveHash }).catch(() => {});
    allow = await readAllow();
    if (allow < amt) throw new Error('USDC.e approval was not confirmed on-chain — please retry the wrap step.');
  }
  const wrapData = encodeFunctionData({ abi: ONRAMP_ABI, functionName: 'wrap', args: [CONTRACTS.usdce, address as Hex, amt] });
  const wrapHash = await sendTx(wallet, address, CONTRACTS.onramp, wrapData);
  // Wait for the wrap to be MINED before returning so the caller's readiness re-check reads
  // post-wrap balances (pUSD up, USDC.e drained) — otherwise the Wrap button re-enables on a
  // stale snapshot and a second click submits a duplicate, reverting wrap.
  await pub.waitForTransactionReceipt({ hash: wrapHash }).catch(() => {});
  return wrapHash;
}

// The four trading approvals, one per step button. Each is a single wallet confirm.
export async function approvePusd(privyWallet: any, address: string, which: 'exchange' | 'negrisk'): Promise<Hex> {
  const wallet = await getWalletClient(privyWallet, address);
  const spender = which === 'exchange' ? CONTRACTS.exchangeV2 : CONTRACTS.negRiskExchangeV2;
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, MAX_UINT] });
  return sendTx(wallet, address, CONTRACTS.pusd, data);
}
export async function approveCtf(privyWallet: any, address: string, which: 'exchange' | 'negrisk'): Promise<Hex> {
  const wallet = await getWalletClient(privyWallet, address);
  const operator = which === 'exchange' ? CONTRACTS.exchangeV2 : CONTRACTS.negRiskExchangeV2;
  const data = encodeFunctionData({ abi: ERC1155_ABI, functionName: 'setApprovalForAll', args: [operator, true] });
  return sendTx(wallet, address, CONTRACTS.ctf, data);
}

// Run a single readiness step by name. The onboarding sheet calls this per button.
export async function runStep(privyWallet: any, address: string, step: ReadinessStep, wrapAmount = 0): Promise<Hex | void> {
  switch (step) {
    case 'chain': return switchChain(privyWallet, address);
    case 'wrap': return wrapUsdce(privyWallet, address, wrapAmount);
    case 'approve_pusd_exchange': return approvePusd(privyWallet, address, 'exchange');
    case 'approve_pusd_negrisk': return approvePusd(privyWallet, address, 'negrisk');
    case 'approve_ctf_exchange': return approveCtf(privyWallet, address, 'exchange');
    case 'approve_ctf_negrisk': return approveCtf(privyWallet, address, 'negrisk');
  }
}

/* ------------------------------------------------------------------ prepare (order preview) */
export type PreparedOrder = {
  tokenID: string;
  side: 'BUY' | 'SELL';
  price: number;      // per-share, 0–1
  size: number;       // shares
  notional: number;   // USDC to spend (BUY)
  feeBps: number;     // builder fee disclosure (bps), 0 if none
  feeUsd: number;     // estimated builder fee in USDC
};

// Preview an order before signing: convert a USDC amount at the best ask into
// shares, and surface the builder-fee disclosure. price defaults to the passed
// executable price (best ask for a BUY); the SDK re-resolves tick size at submit.
export function prepare(
  tokenID: string,
  side: 'Yes' | 'No',
  price: number,
  amountUsd: number,
  feeBps = 0,
): PreparedOrder {
  const px = Math.min(0.999, Math.max(0.001, price || 0));
  const size = px > 0 ? amountUsd / px : 0;
  const feeUsd = (amountUsd * feeBps) / 10_000;
  return {
    tokenID,
    side: 'BUY',            // buying the chosen outcome token (Yes or No token) — always a BUY
    price: px,
    size: Number(size.toFixed(2)),
    notional: amountUsd,
    feeBps,
    feeUsd: Number(feeUsd.toFixed(4)),
  };
}

/* ------------------------------------------------------------------ placeOrder */
export type PlaceResult =
  | { ok: true; orderId?: string; status?: string; builderAttributed: boolean; raw: any }
  | { ok: false; error: string; code: PmErrorCode };

// Build → sign → post a market BUY of `amountUsd` of the chosen outcome token.
// Attaches the builder code when provided; if the CLOB rejects the order for a
// disabled/invalid builder code, retries once WITHOUT attribution.
export async function placeOrder(
  privyWallet: any,
  address: string,
  creds: ApiKeyCreds,
  tokenID: string,
  amountUsd: number,
  builderCode?: string,
): Promise<PlaceResult> {
  let wallet: WalletClient;
  try {
    wallet = await getWalletClient(privyWallet, address);
  } catch (e) {
    const pe = e instanceof PmError ? e : classify(e);
    return { ok: false, error: pe.message, code: pe.code };
  }

  // One attempt: FOK market BUY. `withBuilder` toggles attribution for the retry.
  const attempt = async (withBuilder: boolean): Promise<any> => {
    const client = makeClient(wallet, address, creds, withBuilder ? builderCode : undefined);
    return client.createAndPostMarketOrder(
      { tokenID, amount: amountUsd, side: Side.BUY, orderType: OrderType.FOK },
      undefined,
      OrderType.FOK,
    );
  };

  try {
    const raw = await attempt(!!builderCode);
    return { ok: true, orderId: raw?.orderID || raw?.orderId, status: raw?.status, builderAttributed: !!builderCode, raw };
  } catch (e: any) {
    // disabled/invalid builder code → CLOB rejects. Retry once with no attribution.
    const msg = (e?.data?.error || e?.message || '').toString().toLowerCase();
    const builderReject = !!builderCode && /builder|attribution|code/.test(msg);
    if (builderReject) {
      try {
        const raw = await attempt(false);
        return { ok: true, orderId: raw?.orderID || raw?.orderId, status: raw?.status, builderAttributed: false, raw };
      } catch (e2) {
        const pe = classify(e2);
        return { ok: false, error: pe.message, code: pe.code };
      }
    }
    const pe = classify(e);
    return { ok: false, error: pe.message, code: pe.code };
  }
}

/* ------------------------------------------------------------------ placeLimitOrder (GTC)
   A resting limit BUY of the chosen outcome token at `price` (0–1), sized from `amountUsd`.
   Verified against the shipped @polymarket/clob-client-v2 .d.ts (createAndPostOrder + UserOrderV2);
   flag-gated + confirm-modal-gated like the market path. Same builder-code retry fallback. */
export async function placeLimitOrder(
  privyWallet: any,
  address: string,
  creds: ApiKeyCreds,
  tokenID: string,
  price: number,
  amountUsd: number,
  builderCode?: string,
): Promise<PlaceResult> {
  const px = Math.min(0.999, Math.max(0.001, price || 0));
  const size = Number((px > 0 ? amountUsd / px : 0).toFixed(2));
  if (size <= 0) return { ok: false, error: 'Order size is zero.', code: 'CLOB_ERROR' };
  let wallet: WalletClient;
  try {
    wallet = await getWalletClient(privyWallet, address);
  } catch (e) {
    const pe = e instanceof PmError ? e : classify(e);
    return { ok: false, error: pe.message, code: pe.code };
  }
  const attempt = async (withBuilder: boolean): Promise<any> => {
    const client = makeClient(wallet, address, creds, withBuilder ? builderCode : undefined);
    return client.createAndPostOrder({ tokenID, price: px, size, side: Side.BUY }, undefined, OrderType.GTC);
  };
  try {
    const raw = await attempt(!!builderCode);
    return { ok: true, orderId: raw?.orderID || raw?.orderId, status: raw?.status, builderAttributed: !!builderCode, raw };
  } catch (e: any) {
    const msg = (e?.data?.error || e?.message || '').toString().toLowerCase();
    if (!!builderCode && /builder|attribution|code/.test(msg)) {
      try {
        const raw = await attempt(false);
        return { ok: true, orderId: raw?.orderID || raw?.orderId, status: raw?.status, builderAttributed: false, raw };
      } catch (e2) { const pe = classify(e2); return { ok: false, error: pe.message, code: pe.code }; }
    }
    const pe = classify(e);
    return { ok: false, error: pe.message, code: pe.code };
  }
}

/* ------------------------------------------------------------------ balance helper (SDK L2 read) */
// The CLOB's own view of the user's collateral/allowance (used for
// userUSDCBalance hints + a sanity check the creds work). Best-effort.
export async function clobBalance(privyWallet: any, address: string, creds: ApiKeyCreds): Promise<number | null> {
  try {
    const wallet = await getWalletClient(privyWallet, address);
    const client = makeClient(wallet, address, creds);
    const r = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return r?.balance != null ? Number(formatUnits(BigInt(r.balance), 6)) : null;
  } catch { return null; }
}
