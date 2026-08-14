/* =========================================================
   venueBalances — REAL balances for the Accounts sheet, per venue:

     wallet       on-chain USDC + ETH across Ethereum / Arbitrum / Base
                  (public RPC reads via viem — keyless, client-side)
     hyperliquid  account equity from the clearinghouse (native + xyz dexes),
                  unified-account aware (spot USDC = perp collateral)
     polymarket   USDC + USDC.e on Polygon (the PM collateral our Receive flow
                  funds) + open-position value from PM's public data API

   Everything is read-only and best-effort: any venue that fails reads as null
   (shown as "—"), never a fake zero. ETH is priced from the app's own market
   data; USDC counts as $1.
   ========================================================= */
import { createPublicClient, http, formatUnits, type Hex } from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
// @ts-ignore — JS module
import { info } from './hydromancer.js';
import { spotUsdcState, accountAbstraction, isUnifiedMode } from './hyperliquid-exchange';
// @ts-ignore — JS module
import { getTicker } from './data.js';

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

// canonical USDC per chain (native issuance; polygon also has bridged USDC.e — PM's original collateral).
// RPCs are pinned to endpoints VERIFIED CORS-open from the browser (2026-07-16): viem's defaults
// for mainnet/polygon reject browser calls (merkle.io non-JSON, polygon-rpc.com key-gated).
const RPC: Record<string, string> = {
  [mainnet.id]: 'https://ethereum-rpc.publicnode.com',
  [arbitrum.id]: 'https://arb1.arbitrum.io/rpc',
  [base.id]: 'https://mainnet.base.org',
  [polygon.id]: 'https://polygon-bor-rpc.publicnode.com',
};
const CHAINS = [
  { id: 'ethereum', label: 'Ethereum', chain: mainnet, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Hex, native: 'ETH' },
  { id: 'arbitrum', label: 'Arbitrum', chain: arbitrum, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex, native: 'ETH' },
  { id: 'base', label: 'Base', chain: base, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex, native: 'ETH' },
] as const;
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Hex;   // native USDC
const POLYGON_USDCE = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Hex;  // bridged USDC.e (PM collateral)

const clients = new Map<string, any>();
const client = (c: any) => {
  if (!clients.has(c.id)) clients.set(c.id, createPublicClient({ chain: c, transport: http(RPC[c.id]) }));
  return clients.get(c.id);
};

const ethPrice = () => { try { return Number(getTicker('ETH')?.price) || 0; } catch { return 0; } };

export type VAsset = { chain: string; symbol: string; amount: number; usd: number };
export type WalletBalances = { total: number; assets: VAsset[] };
export type HlBalances = { total: number; withdrawable: number; positions: number; uPnl: number };
export type PmBalances = { total: number; cash: number; positionsUsd: number; assets: VAsset[] };
export type Snapshot = {
  wallet: WalletBalances | null;
  hyperliquid: HlBalances | null;
  polymarket: PmBalances | null;
  total: number;          // sum of the venues that DID load
  partial: boolean;       // true when any venue failed (total is a lower bound)
};

async function erc20(chain: any, token: Hex, addr: string, decimals = 6): Promise<number> {
  const bal = await client(chain).readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr as Hex] }) as bigint;
  return Number(formatUnits(bal, decimals));
}
async function native(chain: any, addr: string): Promise<number> {
  const bal = await client(chain).getBalance({ address: addr as Hex }) as bigint;
  return Number(formatUnits(bal, 18));
}

/* ---- on-chain wallet (any EVM address — the Hence wallet or a linked external one) ---- */
export async function walletBalances(addr: string): Promise<WalletBalances | null> {
  const px = ethPrice();
  const reads = CHAINS.flatMap((c) => [
    erc20(c.chain, c.usdc, addr).then((amount) => ({ chain: c.label, symbol: 'USDC', amount, usd: amount })).catch(() => null),
    native(c.chain, addr).then((amount) => ({ chain: c.label, symbol: 'ETH', amount, usd: amount * px })).catch(() => null),
  ]);
  const rows = (await Promise.all(reads)).filter(Boolean) as VAsset[];
  if (!rows.length) return null;                                  // every chain failed → unknown, not $0
  const assets = rows.filter((a) => a.usd >= 0.01).sort((a, b) => b.usd - a.usd);
  return { total: assets.reduce((s, a) => s + a.usd, 0), assets };
}

/* ---- Hyperliquid equity (mirrors useHlAccount's unified-mode balance model) ---- */
export async function hlBalances(addr: string): Promise<HlBalances | null> {
  try {
    const [s, sx, sp, md] = await Promise.all([
      info({ type: 'clearinghouseState', user: addr }).catch(() => null),
      info({ type: 'clearinghouseState', user: addr, dex: 'xyz' }).catch(() => null),
      spotUsdcState(addr).catch(() => null),
      accountAbstraction(addr).catch(() => null),
    ]);
    if (!s || typeof s !== 'object' || !s.marginSummary) return null;
    const positions = [...(s.assetPositions || []), ...((sx && sx.assetPositions) || [])].map((ap: any) => ap.position);
    const uPnl = positions.reduce((a: number, p: any) => a + (+p.unrealizedPnl || 0), 0);
    if (isUnifiedMode(md) && sp) {
      return { total: sp.total + uPnl, withdrawable: sp.available, positions: positions.length, uPnl };
    }
    const accountValue = +s.marginSummary.accountValue || 0;
    return { total: accountValue, withdrawable: +s.withdrawable || 0, positions: positions.length, uPnl };
  } catch { return null; }
}

/* ---- Polymarket: Polygon USDC collateral + open-position value (public data API) ---- */
export async function pmBalances(addr: string): Promise<PmBalances | null> {
  const [usdc, usdce, val] = await Promise.all([
    erc20(polygon, POLYGON_USDC, addr).catch(() => null),
    erc20(polygon, POLYGON_USDCE, addr).catch(() => null),
    fetch('/api/poly/data/value?user=' + encodeURIComponent(addr.toLowerCase()))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const row = Array.isArray(j) ? j[0] : j;
        const v = row && (row.value ?? row.total ?? null);
        return v == null ? null : Number(v) || 0;
      })
      .catch(() => null),
  ]);
  if (usdc == null && usdce == null && val == null) return null;
  const assets: VAsset[] = [];
  if (usdc && usdc >= 0.01) assets.push({ chain: 'Polygon', symbol: 'USDC', amount: usdc, usd: usdc });
  if (usdce && usdce >= 0.01) assets.push({ chain: 'Polygon', symbol: 'USDC.e', amount: usdce, usd: usdce });
  const cash = (usdc || 0) + (usdce || 0);
  const positionsUsd = val || 0;
  return { total: cash + positionsUsd, cash, positionsUsd, assets };
}

/* ---- cached aggregate for ambient surfaces (the WalletChip) ----
   The sheet loads fresh on open; the chip re-renders on every screen, so it reads
   through a short TTL cache with in-flight dedupe (a failed load is not cached). */
const snapCache = new Map<string, { ts: number; p: Promise<Snapshot> }>();
export function snapshotCached(addr: string, ttlMs = 60_000): Promise<Snapshot> {
  const k = addr.toLowerCase();
  const hit = snapCache.get(k);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.p;
  const p = loadSnapshot(addr);
  snapCache.set(k, { ts: Date.now(), p });
  p.catch(() => snapCache.delete(k));
  return p;
}

/* ---- multi-wallet aggregate for the headline chips ----
   FULL snapshot for the primary (embedded) wallet — it's the trading identity — plus
   ON-CHAIN balances for every other linked wallet (their own venue accounts aren't
   Hence-managed; matches the Accounts sheet's external rows). Cached per address. */
const wbCache = new Map<string, { ts: number; p: Promise<WalletBalances | null> }>();
function walletBalancesCached(addr: string, ttlMs = 60_000): Promise<WalletBalances | null> {
  const k = addr.toLowerCase();
  const hit = wbCache.get(k);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.p;
  const p = walletBalances(addr);
  wbCache.set(k, { ts: Date.now(), p });
  p.catch(() => wbCache.delete(k));
  return p;
}
export async function snapshotCachedAll(primary: string, linked: string[] = []): Promise<Snapshot | null> {
  if (!primary) return null;
  const others = [...new Set(linked.map((a) => (a || '').toLowerCase()).filter((a) => a && a !== primary.toLowerCase()))];
  const [base, exts] = await Promise.all([
    snapshotCached(primary),
    Promise.all(others.map((a) => walletBalancesCached(a).catch(() => null))),
  ]);
  const extTotal = exts.reduce((s, w) => s + (w ? w.total : 0), 0);
  return { ...base, total: base.total + extTotal, partial: base.partial || exts.some((e) => e == null) };
}

/* ---- the aggregate the Accounts sheet renders ---- */
export async function loadSnapshot(addr: string): Promise<Snapshot> {
  const [wallet, hyperliquid, polymarket] = await Promise.all([
    walletBalances(addr), hlBalances(addr), pmBalances(addr),
  ]);
  const parts = [wallet?.total, hyperliquid?.total, polymarket?.total];
  const snap: Snapshot = {
    wallet, hyperliquid, polymarket,
    total: parts.reduce((s: number, v) => s + (v || 0), 0),
    partial: parts.some((v) => v == null),
  };
  // a fresh load (e.g. the sheet opening) also primes the ambient cache
  snapCache.set(addr.toLowerCase(), { ts: Date.now(), p: Promise.resolve(snap) });
  return snap;
}

/* ---- Hyperliquid activity: fills + transfers (deposits/withdrawals/class moves) ---- */
export type ActivityRow = { t: number; kind: string; detail: string; usd: number | null };

export async function loadActivity(addr: string, limit = 24): Promise<ActivityRow[] | null> {
  const [fills, ledger] = await Promise.all([
    info({ type: 'userFills', user: addr, aggregateByTime: true }).catch(() => null),
    info({ type: 'userNonFundingLedgerUpdates', user: addr, startTime: Date.now() - 90 * 86_400_000 }).catch(() => null),
  ]);
  if (!Array.isArray(fills) && !Array.isArray(ledger)) return null;
  const rows: ActivityRow[] = [];
  for (const f of (Array.isArray(fills) ? fills : []).slice(0, 60)) {
    const sz = +f.sz || 0, px = +f.px || 0;
    const coin = String(f.coin || '').replace(/^xyz:/, '');
    rows.push({
      t: +f.time || 0,
      kind: (f.side === 'B' ? 'Buy' : 'Sell') + (f.dir && /open|close/i.test(f.dir) ? ' · ' + f.dir : ''),
      detail: `${sz} ${coin} @ ${px.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
      usd: sz * px,
    });
  }
  for (const u of (Array.isArray(ledger) ? ledger : []).slice(0, 40)) {
    const d = u.delta || {};
    const kind = String(d.type || 'transfer');
    const usd = d.usdc != null ? +d.usdc : d.amount != null ? +d.amount : null;
    const label = kind === 'deposit' ? 'Deposit' : kind === 'withdraw' ? 'Withdraw'
      : kind === 'accountClassTransfer' ? 'Spot ⇄ Perp' : kind === 'spotTransfer' ? 'Spot transfer' : kind;
    rows.push({ t: +u.time || 0, kind: label, detail: usd != null ? `$${Math.abs(usd).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` : '', usd });
  }
  rows.sort((a, b) => b.t - a.t);
  return rows.slice(0, limit);
}

/* ---- Polymarket per-position detail (public data-api, proxied for CORS) ----
   entry vs current odds + P&L per event position — the portfolio's predictions table. */
export type PmPosition = {
  title: string; outcome: string; size: number; avgPrice: number; curPrice: number;
  value: number; pnl: number; endDate: string | null; redeemable: boolean; slug: string | null;
};
export async function pmPositions(addr: string): Promise<PmPosition[] | null> {
  try {
    const r = await fetch('/api/poly/data/positions?user=' + encodeURIComponent(addr) + '&sizeThreshold=0.1&limit=100');
    if (!r.ok) return null;
    const rows: any[] = await r.json();
    if (!Array.isArray(rows)) return null;
    return rows.map((p) => ({
      title: String(p.title || p.market || '').slice(0, 120),
      outcome: String(p.outcome || ''),
      size: +p.size || 0,
      avgPrice: +p.avgPrice || 0,
      curPrice: +p.curPrice || 0,
      value: +p.currentValue || (+p.size || 0) * (+p.curPrice || 0),
      pnl: p.cashPnl != null ? +p.cashPnl : ((+p.curPrice || 0) - (+p.avgPrice || 0)) * (+p.size || 0),
      endDate: p.endDate || null,
      redeemable: !!p.redeemable,
      slug: p.slug || p.eventSlug || null,
    })).filter((p) => p.size > 0);
  } catch { return null; }
}
