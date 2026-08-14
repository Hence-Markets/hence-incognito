/* =========================================================
   Hydromancer client — talks to the local proxy (/api/info),
   which injects the secret Bearer key server-side. Mirrors the
   Hyperliquid POST /info shape with `type` values + HIP-3 support.
   ========================================================= */
import { decode } from './msgpack.js';
const ENDPOINT = '/api/info';
const _cache = new Map();      // key -> { t, v }
const _inflight = new Map();   // key -> Promise

/* `cached: true` asks the SERVER for a long-TTL answer (see HYDRO_CACHED_TTL in serve.py).
   Use it on read-only surfaces that don't need live ticks — chiefly someone else's portfolio,
   where the default 3s server TTL sits under the poll interval and so passes nearly every read
   through to the keyed upstream. It can only make an answer staler, never fresher, so it is
   safe for the server to honour from anyone. */
export async function info(body, { cacheKey, ttl = 0, cached = false } = {}) {
  const key = (cached ? 'c|' : '') + (cacheKey || JSON.stringify(body));
  if (ttl) {
    const e = _cache.get(key);
    if (e && Date.now() - e.t < ttl) return e.v;
  }
  if (_inflight.has(key)) return _inflight.get(key);
  const p = fetch(ENDPOINT + (cached ? '?cached=1' : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(v => {
      if (v && v.error) throw new Error(v.error);
      if (ttl) _cache.set(key, { t: Date.now(), v });
      return v;
    })
    .finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

/* ---- typed helpers ---- */
export const perpDexs = () => info({ type: 'perpDexs' }, { ttl: 5 * 60_000, cacheKey: 'perpDexs' });
export const meta = (dex) => info(dex ? { type: 'meta', dex } : { type: 'meta' }, { ttl: 5 * 60_000, cacheKey: 'meta:' + (dex || '_') });
export const allMids = () => info({ type: 'allMids', dex: 'ALL_DEXS' }, { ttl: 4_000, cacheKey: 'allMids' });
export const assetContext = (coins) => info({ type: 'assetContext', coins });
export const candleSnapshot = (coin, interval, startTime, endTime) =>
  info({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } },
    { ttl: 30_000, cacheKey: `candle:${coin}:${interval}:${startTime}:${endTime}` });

/* ---- richer real data (all confirmed live) ---- */
// [[coin, category], ...] across every DEX — category ∈ crypto|stocks|commodities|indices|fx
export const perpCategories = () => info({ type: 'perpCategories' }, { ttl: 30 * 60_000, cacheKey: 'perpCategories' });

// ONE bulk 24h-change snapshot for the whole perp universe → { fullCoin: {px, chg} }.
// Served by serve.py /api/changes (public HL metaAndAssetCtxs, cached 60s server-side); replaces
// the per-coin daily-candle sweep that used to fire hundreds of /api/info calls on page load.
// Returns null on any failure so callers can skip gracefully (never throws, never bursts).
export async function bulkChanges() {
  try {
    const r = await fetch('/api/changes', { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const v = await r.json();
    return (v && typeof v === 'object' && !v.error) ? v : null;
  } catch (e) {
    return null;
  }
}
// { category, description, displayName, keywords[] } — real "About this asset" text
export const perpAnnotation = (coin) => info({ type: 'perpAnnotation', coin }, { ttl: 60 * 60_000, cacheKey: 'annot:' + coin });
// hourly [{ coin, fundingRate, time }] — current = last element
export const fundingHistory = (coin, startTime, endTime) =>
  info({ type: 'fundingHistory', coin, startTime, endTime }, { ttl: 60_000, cacheKey: 'funding:' + coin + ':' + startTime });
// { specialStatuses, time } — exchange health + server time
export const exchangeStatus = () => info({ type: 'exchangeStatus' }, { ttl: 30_000, cacheKey: 'exchangeStatus' });
// { totalNetDeposit } — venue TVL for a HIP-3 dex
export const perpDexStatus = (dex) => info({ type: 'perpDexStatus', dex }, { ttl: 5 * 60_000, cacheKey: 'dexStatus:' + dex });
// [sym, ...] symbols currently at their open-interest cap
export const perpsAtOiCap = () => info({ type: 'perpsAtOpenInterestCap' }, { ttl: 5 * 60_000, cacheKey: 'oiCap' });

// Recent trades (taker fills) for a coin. Hydromancer's /info doesn't proxy `recentTrades`,
// but Hyperliquid's public /info does and serves it CORS-open (no key needed) — so we hit it
// directly. Returns [{coin, side:'A'|'B', px, sz, time, hash, tid}]; `side` is the AGGRESSOR:
// 'B' = taker bought (up/green), 'A' = taker sold (down/red). Native coins only; HIP-3
// (e.g. "xyz:NVDA") isn't on the public venue → empty array (caller shows "No recent trades").
const HL_PUBLIC_INFO = 'https://api.hyperliquid.xyz/info';
export async function recentTrades(coin) {
  const r = await fetch(HL_PUBLIC_INFO, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'recentTrades', coin }),
  });
  const v = await r.json();
  return Array.isArray(v) ? v : [];
}

// real L2 order book — returns msgpack [coin, time, [bids, asks], …]; each level [px, sz, n]
export async function l2Book(coin) {
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin }) });
  const buf = new Uint8Array(await r.arrayBuffer());
  const d = decode(buf);
  if (!Array.isArray(d) || d.length < 3 || !Array.isArray(d[2])) return null;
  const lvl = (a) => (a || []).map(l => ({ px: +l[0], sz: +l[1], n: +l[2] || 0 })).filter(x => x.px > 0);
  return { coin: d[0], time: d[1], bids: lvl(d[2][0]), asks: lvl(d[2][1]) };
}
