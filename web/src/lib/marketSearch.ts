/* =========================================================
   marketSearch.ts — the shared universe search/rank used by BOTH the ⌘K MarketSelect
   palette (Terminal) and the watchlist drawer's "Search symbols" overlay, so the two
   surfaces search the same universe (native crypto + HIP-3/trade.xyz stocks) with the
   same popular-first → biggest-mover → alphabetical ranking. Extracted from
   MarketSelect's `rows` useMemo (was duplicated inline).
   ========================================================= */
import { getTicker } from './data.js';
import * as market from './market.js';
import { isAvantisSymbol } from './avantisUniverse';

// Avantis lists equities as well as crypto and FX, so this stays close to Hence's own order.
// Dropped only what the venue does not carry: GOOGL, GOLD, SP500, HYPE, XRP, SUI.
export const POPULAR = ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'TSLA', 'MSFT', 'DOGE', 'AVAX', 'ARB', 'LINK', 'EUR'];
export const popRank = (s: string) => { const i = POPULAR.indexOf(s); return i < 0 ? 999 : i; };

export type SearchOpts = { world?: 'crypto' | 'stocks'; liveOnly?: boolean; watch?: Set<string>; limit?: number };

// filtered + ranked universe rows ({ sym, name, coin, world, cat, maxLev, dex }).
export function searchMarkets(query: string, opts: SearchOpts = {}): any[] {
  if (!market.isReady()) return [];
  // INCOGNITO: every order routes to Avantis, so the universe is Avantis'. This is the one
  // shared filter point — its own header notes it feeds both the palette and the drawer — so
  // narrowing here narrows both. No-ops until the allowlist resolves (see avantisUniverse).
  let list = market.getUniverse().filter((a: any) => isAvantisSymbol(a.sym));
  if (opts.world === 'crypto') list = list.filter((a: any) => a.world === 'crypto');
  else if (opts.world === 'stocks') list = list.filter((a: any) => a.world === 'stocks');
  if (opts.watch) list = list.filter((a: any) => opts.watch!.has(a.sym));
  if (opts.liveOnly) list = list.filter((a: any) => { const t = getTicker(a.sym); return t && t.real && t.price > 0; });
  const qq = query.trim().toLowerCase();
  if (qq) list = list.filter((a: any) =>
    a.sym.toLowerCase().includes(qq) || (a.name || '').toLowerCase().includes(qq) || (a.cat || '').toLowerCase().includes(qq));
  const ranked = list.slice().sort((x: any, y: any) => {
    const pr = popRank(x.sym) - popRank(y.sym); if (pr) return pr;
    const cx = Math.abs(getTicker(x.sym).chgPct || 0), cy = Math.abs(getTicker(y.sym).chgPct || 0);
    if (cy !== cx) return cy - cx;
    return x.sym < y.sym ? -1 : 1;
  });
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

// the "Popular" seed list for the drawer's empty-query state — popular tickers that exist
// in the loaded universe, in POPULAR order.
export function popularMarkets(limit = 12): any[] {
  if (!market.isReady()) return [];
  const uni = market.getUniverse().filter((a: any) => isAvantisSymbol(a.sym));
  const bySym = new Map(uni.map((a: any) => [a.sym, a]));
  return POPULAR.map((s) => bySym.get(s)).filter(Boolean).slice(0, limit);
}
