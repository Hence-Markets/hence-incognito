/* =========================================================
   Hyperliquid order execution — high level.
   Resolves the asset index + size decimals from /info `meta`,
   converts a USD notional into a wire order, signs it with the
   user's wallet (browser-side, via hyperliquid-sign), and relays
   it to /api/exchange. No keys server-side.
   ========================================================= */
import { meta, perpDexs, info } from './hydromancer.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  buildOrderAction, buildCancelAction, buildUpdateLeverageAction, signL1Action, signApproveBuilderFee, signApproveAgent, signWithdraw, signUsdClassTransfer, floatToWire, roundSize, roundPrice,
  type SignTypedDataFn, type OrderInput, type BuilderCode,
} from './hyperliquid-sign';

const EXCHANGE = '/api/exchange';

// ---- testnet verification mode (opt-in) ----
// `localStorage['hl.testnet']==='1'` routes /info + /exchange to Hyperliquid TESTNET,
// called DIRECTLY from the browser (testnet CORS is open) rather than through the
// serve.py /api/exchange proxy (which targets MAINNET). Off by default → mainnet via proxy.
const HL_TESTNET_INFO = 'https://api.hyperliquid-testnet.xyz/info';
const HL_TESTNET_EXCHANGE = 'https://api.hyperliquid-testnet.xyz/exchange';
const HL_MAINNET_INFO = 'https://api.hyperliquid.xyz/info';

// Hyperliquid "market" orders are IOC limits. We cap the acceptable execution
// price 3% away from the current mark; this is price protection, not an estimate
// that the order will actually slip by 3%.
export const MARKET_PRICE_PROTECTION = 0.03;

export function isTestnet(): boolean {
  // The local toggle is a developer verification aid. Production builds can never
  // be silently rerouted to testnet by browser storage or a stale deployment env var.
  if (!import.meta.env.DEV) return false;
  try { return localStorage.getItem('hl.testnet') === '1'; } catch { return false; }
}

let _metaCache: { at: number; testnet: boolean; universe: any[] } | null = null;
async function universe(): Promise<any[]> {
  const testnet = isTestnet();
  if (_metaCache && _metaCache.testnet === testnet && Date.now() - _metaCache.at < 5 * 60_000) return _metaCache.universe;
  const m: any = testnet
    ? await fetch(HL_TESTNET_INFO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    }).then((res) => res.json())
    : await meta(null);
  if (!m || typeof m !== 'object') throw new Error('Hyperliquid market metadata is unavailable.');
  const u: any[] = (m && m.universe) || [];
  if (u.length) _metaCache = { at: Date.now(), testnet, universe: u };
  return u;
}

// asset index + size decimals + leverage limits for a coin. Native perps index by their position
// in the main universe; HIP-3 (builder-deployed) perps like "xyz:NVDA" use the HL encoding
//   asset = 100000 + perp_dex_index * 10000 + index_in_meta
// where perp_dex_index is the coin's dex position in perpDexs (index 0 = null native dex) and
// index_in_meta is the coin's position in that dex's own meta universe. Verified against the live
// API (xyz is perp_dex_index 1, so xyz:NVDA at meta index 2 → 110002).
export async function assetInfo(coin: string): Promise<{ index: number; szDecimals: number; maxLeverage: number; onlyIsolated: boolean }> {
  if (coin.includes(':')) {
    const dex = coin.slice(0, coin.indexOf(':'));
    if (!/^[a-z0-9]{1,16}$/.test(dex)) throw new Error('Invalid Hyperliquid dex.');
    const [dexs, m] = await Promise.all([perpDexs() as Promise<any[]>, meta(dex) as Promise<any>]);
    const dexIndex = (dexs || []).findIndex((d: any) => d && d.name === dex);
    if (dexIndex < 0) throw new Error(`Unknown perp dex: ${dex}`);
    const uni: any[] = (m && m.universe) || [];
    const i = uni.findIndex((a: any) => a.name === coin);
    if (i < 0) throw new Error(`Unknown perp market: ${coin}`);
    const a = uni[i];
    return { index: 100000 + dexIndex * 10000 + i, szDecimals: a.szDecimals ?? 4, maxLeverage: a.maxLeverage ?? 1, onlyIsolated: !!a.onlyIsolated };
  }
  if (!/^[A-Za-z0-9._-]{1,24}$/.test(coin)) throw new Error('Invalid Hyperliquid market symbol.');
  const u = await universe();
  const i = u.findIndex((a: any) => a.name === coin);
  if (i < 0) throw new Error(`Unknown perp market: ${coin}`);
  return { index: i, szDecimals: u[i].szDecimals ?? 4, maxLeverage: u[i].maxLeverage ?? 1, onlyIsolated: !!u[i].onlyIsolated };
}

// read-only leverage limits for the ticket UI (max leverage + whether the asset is isolated-only)
export async function marketLimits(coin: string): Promise<{ maxLeverage: number; onlyIsolated: boolean }> {
  const { maxLeverage, onlyIsolated } = await assetInfo(coin);
  return { maxLeverage, onlyIsolated };
}

export type PlaceOrderParams = {
  coin: string;
  isBuy: boolean;
  usd: number;              // notional in USD (terminal "Amount")
  markPrice: number;        // current mark — drives sizing + market price
  type: 'Market' | 'Limit';
  limitPrice?: number;      // required for Limit
  reduceOnly?: boolean;
  slippage?: number;        // market price-protection fraction, default 3%
  builder?: BuilderCode | null; // optional Hyperliquid builder code (fee monetization)
};

export type ExecResult =
  | { ok: true; status: 'filled' | 'resting'; detail: any; raw: any }
  | { ok: false; error: string; raw?: any };

function parseOrderResponse(raw: any): ExecResult {
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') {
    return { ok: false, error: typeof raw.response === 'string' ? raw.response : JSON.stringify(raw.response), raw };
  }
  const st = raw?.response?.data?.statuses?.[0];
  if (!st) return { ok: false, error: 'Unexpected exchange response', raw };
  if (st.error) return { ok: false, error: st.error, raw };
  if (st.filled) return { ok: true, status: 'filled', detail: st.filled, raw };
  if (st.resting) return { ok: true, status: 'resting', detail: st.resting, raw };
  return { ok: false, error: 'Unknown order status', raw };
}

// Build → sign → submit a single order. Returns a normalized result.
export { builderForCoin } from './builder-waiver';
import { builderForCoin } from './builder-waiver';
import { rebateWaiverActive } from './rebate-status';

export async function placeOrder(signTypedData: SignTypedDataFn, p: PlaceOrderParams): Promise<ExecResult> {
  const orderType = String(p.type);
  if (orderType !== 'Market' && orderType !== 'Limit') {
    return { ok: false, error: 'Only native Hyperliquid Market and Limit orders are available.' };
  }
  const isMarket = p.type === 'Market';
  if (!Number.isFinite(p.usd) || p.usd <= 0) return { ok: false, error: 'Enter a valid order amount.' };
  if (!Number.isFinite(p.markPrice) || p.markPrice <= 0) return { ok: false, error: 'No price available for this market yet.' };
  if (!isMarket && (!Number.isFinite(p.limitPrice) || (p.limitPrice ?? 0) <= 0)) {
    return { ok: false, error: 'Enter a valid limit price.' };
  }

  const slippage = p.slippage ?? MARKET_PRICE_PROTECTION;
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 0.1) {
    return { ok: false, error: 'Invalid market price-protection value.' };
  }

  let index: number;
  let szDecimals: number;
  try {
    ({ index, szDecimals } = await assetInfo(p.coin));
  } catch (e: any) {
    return { ok: false, error: e?.message || 'This market is not available for live orders.' };
  }
  const refPx = isMarket ? p.markPrice : p.limitPrice!;

  // "Amount" is USD notional at the order's own reference price. In particular,
  // a limit order should not silently change notional when its limit differs from mark.
  const size = roundSize(p.usd / refPx, szDecimals);
  if (!(size > 0)) return { ok: false, error: 'Order size rounds to zero — increase the amount.' };

  const price = isMarket
    ? roundPrice(p.isBuy ? refPx * (1 + slippage) : refPx * (1 - slippage), szDecimals)
    : roundPrice(refPx, szDecimals);

  const order: OrderInput = {
    assetIndex: index, isBuy: p.isBuy, price, size,
    reduceOnly: p.reduceOnly ?? false,
    tif: isMarket ? 'Ioc' : 'Gtc',
  };
  // builder (if attached) is appended as the LAST action key inside buildOrderAction —
  // it participates in the msgpack hash, so the SAME object must be posted below.
  let builder = p.builder ?? null;
  try {
    const { getConfig } = await import('./config');       // lazy: keeps this module wallet-page light
    // per-user aware: open campaign (config) OR whitelisted tester (/api/me/rebates) —
    // fail-closed, so the normal disclosed fee is charged whenever status is unknown
    builder = builderForCoin(p.coin, builder, await rebateWaiverActive());
  } catch { /* config unreachable → builder unchanged; never block an order on a flag */ }
  const action = buildOrderAction([order], builder);
  const nonce = Date.now();
  const testnet = isTestnet();
  const signature = await signL1Action({ signTypedData, action, nonce, isMainnet: !testnet, vaultAddress: null });

  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const raw = await res.json().catch(() => null);
  return parseOrderResponse(raw);
}

/* ---------------- position TP/SL (trigger orders) ----------------
   Reduce-only trigger orders tied to a position (grouping 'positionTpsl' — the same
   batch HL's own frontend sends). For isMarket triggers `p` is the post-trigger
   slippage cap (5% beyond the trigger, mirroring HL's price protection). Fee-free
   by design, like Close. */
export type TpslParams = {
  coin: string;
  positionSide: 'Long' | 'Short';   // the position being protected
  sz: number;                       // position size to cover (full size for classic TP/SL)
  tp?: number;                      // take-profit trigger price
  sl?: number;                      // stop-loss trigger price
};

export async function placeTpsl(signTypedData: SignTypedDataFn, p: TpslParams): Promise<ExecResult> {
  if (!p.tp && !p.sl) return { ok: false, error: 'Set a take-profit or stop-loss price.' };
  if ((p.tp && !(p.tp > 0)) || (p.sl && !(p.sl > 0))) return { ok: false, error: 'Trigger prices must be positive.' };
  if (!Number.isFinite(p.sz) || p.sz <= 0) return { ok: false, error: 'No position size to protect.' };

  let index: number; let szDecimals: number;
  try { ({ index, szDecimals } = await assetInfo(p.coin)); }
  catch (e: any) { return { ok: false, error: e?.message || 'This market is not available for live orders.' }; }

  const size = roundSize(p.sz, szDecimals);
  if (!(size > 0)) return { ok: false, error: 'Position size rounds to zero.' };
  const isBuy = p.positionSide === 'Short';               // the closing direction
  const PROT = 0.05;                                       // 5% post-trigger slippage cap
  const cap = (trig: number) => roundPrice(isBuy ? trig * (1 + PROT) : trig * (1 - PROT), szDecimals);

  const orders: OrderInput[] = [];
  if (p.tp) orders.push({ assetIndex: index, isBuy, price: cap(p.tp), size, reduceOnly: true,
    trigger: { isMarket: true, triggerPx: roundPrice(p.tp, szDecimals), tpsl: 'tp' } });
  if (p.sl) orders.push({ assetIndex: index, isBuy, price: cap(p.sl), size, reduceOnly: true,
    trigger: { isMarket: true, triggerPx: roundPrice(p.sl, szDecimals), tpsl: 'sl' } });

  const action = buildOrderAction(orders, null, 'positionTpsl');
  const nonce = Date.now();
  const testnet = isTestnet();
  const signature = await signL1Action({ signTypedData, action, nonce, isMainnet: !testnet, vaultAddress: null });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const raw = await res.json().catch(() => null);
  // a two-order batch (tp + sl) can partially fail — surface EVERY error, not just [0]
  if (raw && raw.status !== 'err') {
    const sts: any[] = raw?.response?.data?.statuses || [];
    const errs = sts.filter((s) => s && s.error).map((s) => s.error);
    if (errs.length) return { ok: false, error: errs.join(' · '), raw };
    if (sts.length) return { ok: true, status: 'resting', detail: sts.find((s) => s.resting)?.resting || sts[0], raw };
  }
  return parseOrderResponse(raw);
}

/* ---------------- builder-fee: query + approve ----------------
   maxBuilderFee: how many tenths-of-a-bp the user has already approved for this builder.
   0 = not yet approved (or approved below any positive fee). */
export async function queryMaxBuilderFee(user: string, builder: string): Promise<number> {
  const url = isTestnet() ? HL_TESTNET_INFO : HL_MAINNET_INFO;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'maxBuilderFee', user, builder: builder.toLowerCase() }),
    });
    const v = await res.json().catch(() => 0);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// Sign the one-time ApproveBuilderFee (user-signed) and submit it to /exchange.
// maxFeeRate is a percent string, e.g. "0.01%". Returns a normalized result.
export async function approveBuilderFee(
  signTypedData: SignTypedDataFn,
  opts: { builder: string; maxFeeRate: string },
): Promise<{ ok: true; raw: any } | { ok: false; error: string; raw?: any }> {
  const testnet = isTestnet();
  const { action, nonce, signature } = await signApproveBuilderFee(signTypedData, {
    builder: opts.builder,
    maxFeeRate: opts.maxFeeRate,
    isMainnet: !testnet,
  });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') {
    return { ok: false, error: typeof raw.response === 'string' ? raw.response : JSON.stringify(raw.response), raw };
  }
  if (raw.status === 'ok') return { ok: true, raw };
  return { ok: false, error: 'Unexpected approval response', raw };
}

// Quote what an order will look like before signing — for the confirm sheet.
export async function quoteOrder(p: PlaceOrderParams): Promise<{ size: number; price: number; szDecimals: number; index: number }> {
  const orderType = String(p.type);
  if (orderType !== 'Market' && orderType !== 'Limit') throw new Error('Only native Hyperliquid Market and Limit orders are available.');
  if (!Number.isFinite(p.usd) || p.usd <= 0) throw new Error('Enter a valid order amount.');
  if (!Number.isFinite(p.markPrice) || p.markPrice <= 0) throw new Error('No price available for this market yet.');
  if (p.type === 'Limit' && (!Number.isFinite(p.limitPrice) || (p.limitPrice ?? 0) <= 0)) throw new Error('Enter a valid limit price.');
  const { index, szDecimals } = await assetInfo(p.coin);
  const isMarket = p.type === 'Market';
  const refPx = isMarket ? p.markPrice : p.limitPrice!;
  const size = roundSize(p.usd / refPx, szDecimals);
  const slippage = p.slippage ?? MARKET_PRICE_PROTECTION;
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 0.1) throw new Error('Invalid market price-protection value.');
  const price = isMarket
    ? roundPrice(p.isBuy ? refPx * (1 + slippage) : refPx * (1 - slippage), szDecimals)
    : roundPrice(refPx || 0, szDecimals);
  return { size, price, szDecimals, index };
}

// Set the account's per-asset leverage + margin mode (isCross=false → isolated). A user-signed L1
// action — same signing scheme as orders/cancels. Leverage persists on the asset until changed and
// applies to the whole position, not just the next order. Clamped to the asset's max on the way out.
export async function updateLeverage(signTypedData: SignTypedDataFn, coin: string, leverage: number, isCross: boolean): Promise<ExecResult> {
  const { index, maxLeverage } = await assetInfo(coin);
  const lev = Math.max(1, Math.min(Math.floor(leverage), maxLeverage || 50));
  const action = buildUpdateLeverageAction(index, isCross, lev);
  const nonce = Date.now();
  const testnet = isTestnet();
  const signature = await signL1Action({ signTypedData, action, nonce, isMainnet: !testnet, vaultAddress: null });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') return { ok: false, error: String(raw.response), raw };
  if (raw.status === 'ok') return { ok: true, status: 'resting', detail: { leverage: lev, isCross }, raw };
  return { ok: false, error: 'Unknown leverage-update status', raw };
}

// Withdraw USDC from the Hyperliquid perps account to Arbitrum. A user-signed withdraw3 action
// (see signWithdraw). HL charges a $1 fee and funds arrive as native USDC on Arbitrum at
// `destination` (default the account itself) in a few minutes. amount is the USD amount string.
export async function withdraw(signTypedData: SignTypedDataFn, destination: string, amountUsd: number): Promise<ExecResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) return { ok: false, error: 'Invalid destination address.' };
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: 'Enter a valid withdrawal amount.' };
  const testnet = isTestnet();
  const { action, nonce, signature } = await signWithdraw(signTypedData, { destination, amount: String(amountUsd), isMainnet: !testnet });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') return { ok: false, error: String(raw.response), raw };
  if (raw.status === 'ok') return { ok: true, status: 'resting', detail: { amount: String(amountUsd), destination }, raw };
  return { ok: false, error: 'Unknown withdraw status', raw };
}

// Move USDC between the spot and perp balances (usdClassTransfer). A Bridge2 deposit lands in
// SPOT; perps trading + withdrawal use PERP, so a deposit is followed by toPerp=true. Instant.
export async function usdClassTransfer(signTypedData: SignTypedDataFn, amountUsd: number, toPerp: boolean): Promise<ExecResult> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: 'Enter a valid amount.' };
  const testnet = isTestnet();
  const { action, nonce, signature } = await signUsdClassTransfer(signTypedData, { amount: floatToWire(amountUsd), toPerp, isMainnet: !testnet });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') return { ok: false, error: String(raw.response), raw };
  if (raw.status === 'ok') return { ok: true, status: 'resting', detail: { amount: amountUsd, toPerp }, raw };
  return { ok: false, error: 'Unknown transfer status', raw };
}

// ---- agent (API) wallets: sign L1 actions without a per-trade wallet popup ----
// Generate a fresh trading key. It NEVER touches the wallet; the master approves it once via
// approveAgent, then this key signs orders/cancels/leverage locally (chainId 1337 is fine for a
// raw key). It can trade but cannot withdraw/transfer funds.
export function newAgentKey(): { privateKey: Hex; address: string } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

// Turn a stored agent private key into a SignTypedDataFn usable by signL1Action (drop-in for the
// wallet signer). Local signing → no popup, and no chainId-match enforcement.
export function agentSigner(privateKey: string): SignTypedDataFn {
  const account = privateKeyToAccount(privateKey as Hex);
  return (td) => account.signTypedData({
    domain: td.domain as any,
    types: td.types as any,
    primaryType: td.primaryType as any,
    message: td.message as any,
  }) as Promise<Hex>;
}

// One-time: the MASTER wallet approves `agentAddress` to trade on its behalf.
export async function approveAgent(signTypedData: SignTypedDataFn, agentAddress: string, agentName: string): Promise<ExecResult> {
  const testnet = isTestnet();
  const { action, nonce, signature } = await signApproveAgent(signTypedData, { agentAddress, agentName, isMainnet: !testnet });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') return { ok: false, error: String(raw.response), raw };
  if (raw.status === 'ok') return { ok: true, status: 'resting', detail: { agentAddress, agentName }, raw };
  return { ok: false, error: 'Unknown approveAgent status', raw };
}

// Public spot USDC balance for an address. Used to detect deposits that landed in spot, where a
// failed read and a zero balance mean opposite things — so an unreadable state stays 0 here only
// because the caller is asking "did money arrive yet?", and "don't know" behaves like "not yet".
export async function spotUsdcBalance(address: string): Promise<number> {
  return (await spotUsdcState(address))?.total ?? 0;
}

// Full unified-USDC state for an address. Under HL unified-account / portfolio-margin mode
// the USDC that collateralizes perp positions lives HERE, not in clearinghouseState:
//   total     — the whole USDC balance
//   hold      — the portion locked as margin by open positions
//   available — free collateral after maintenance margin (HL's own "tokenToAvailableAfterMaintenance")
// Goes through our /api/info proxy (not direct to the venue) so it is cached, rate-limited and
// observable — a public profile can otherwise fire this at any address from every visitor's
// browser, where we can neither see nor throttle it.
//
// Returns NULL on failure, never zeros. Under unified mode this call IS the account's equity, so
// answering a network error with `{total: 0}` renders a funded account as $0 — wrong in the most
// misleading direction, and invisible because it looks like a legitimately empty wallet.
export async function spotUsdcState(address: string, opts: { cached?: boolean } = {}):
Promise<{ total: number; hold: number; available: number } | null> {
  try {
    const d: any = await info({ type: 'spotClearinghouseState', user: address }, { cached: !!opts.cached });
    if (!d || typeof d !== 'object' || d.error) return null;
    const usdc = (d?.balances || []).find((b: any) => b.coin === 'USDC');
    const total = usdc ? Number(usdc.total) : 0;
    const hold = usdc ? Number(usdc.hold) : 0;
    // token 0 is USDC; tokenToAvailableAfterMaintenance is [tokenId, availStr][]
    const avEntry = (d?.tokenToAvailableAfterMaintenance || []).find((e: any) => Number(e[0]) === 0);
    const available = avEntry != null ? Number(avEntry[1]) : Math.max(0, total - hold);
    return { total, hold, available };
  } catch { return null; }
}

// Account abstraction mode: "unifiedAccount" | "portfolioMargin" | "disabled" | "default" | ...
// In the spot-collateral modes (unifiedAccount / portfolioMargin) perp collateral is the spot
// USDC balance and usdClassTransfer is rejected ("Action disabled when unified account is active").
export type HlAbstractionMode = 'unifiedAccount' | 'portfolioMargin' | 'disabled' | 'default' | string;
export async function accountAbstraction(address: string, opts: { cached?: boolean } = {}): Promise<HlAbstractionMode | null> {
  try {
    const d: any = await info({ type: 'userAbstraction', user: address }, { cached: !!opts.cached });
    if (d && typeof d === 'object' && d.error) return null;
    return typeof d === 'string' ? d : (d?.abstraction ?? null);
  } catch { return null; }
}

// True when the account uses spot USDC as unified perp collateral (no spot↔perp transfer).
export function isUnifiedMode(mode: HlAbstractionMode | null | undefined): boolean {
  return mode === 'unifiedAccount' || mode === 'portfolioMargin';
}

export async function cancelOrder(signTypedData: SignTypedDataFn, coin: string, oid: number): Promise<ExecResult> {
  const { index } = await assetInfo(coin);
  const action = buildCancelAction([{ assetIndex: index, oid }]);
  const nonce = Date.now();
  const testnet = isTestnet();
  const signature = await signL1Action({ signTypedData, action, nonce, isMainnet: !testnet, vaultAddress: null });
  const res = await fetch(testnet ? HL_TESTNET_EXCHANGE : EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const raw = await res.json().catch(() => null);
  if (!raw) return { ok: false, error: 'No response from exchange' };
  if (raw.status === 'err') return { ok: false, error: String(raw.response), raw };
  const st = raw?.response?.data?.statuses?.[0];
  if (st === 'success') return { ok: true, status: 'resting', detail: { oid }, raw };
  if (st && st.error) return { ok: false, error: st.error, raw };
  return { ok: false, error: 'Unknown cancel status', raw };
}
