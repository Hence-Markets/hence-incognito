/* =========================================================================
   Realized P&L of a CLOSED thesis — from Hyperliquid fills.

   Hyperliquid reports `closedPnl` on every closing fill, so the venue already
   did the hard accounting; what this module owns is ATTRIBUTION: which fills
   belong to this thesis.

   And attribution here is honest-best-effort, not exact, because HL nets
   positions per coin. If the user traded SUI by hand while a thesis also
   held SUI, the venue cannot tell those closes apart — nobody can. The rules
   below (own coins only, only after the thesis's first execution) are the
   defensible approximation, and the contract with the UI is: return null
   whenever nothing can honestly be summed, so the screen shows NOTHING
   rather than a confident wrong number. A "$0.00" on a thesis that lost
   money is worse than no figure at all.
   ========================================================================= */
// @ts-ignore — JS module
import { info } from './hydromancer.js';

export type FillLike = {
  coin: string;
  time: number;
  closedPnl?: string | number;
  dir?: string;                   // e.g. 'Open Long', 'Close Long', 'Close Short'
};

export type ExecLike = {
  symbol: string;
  coin?: string | null;
  created_at?: string | null;
};

const ts = (s?: string | null): number => {
  if (!s) return 0;
  const n = new Date(String(s).replace(' ', 'T')).getTime();
  return Number.isFinite(n) ? n : 0;
};

/**
 * Sum the realized P&L of closing fills attributable to a thesis.
 *
 * - Coins match EXACTLY against the execution's recorded coin (so a HIP-3 leg
 *   'xyz:NVDA' never matches a native NVDA fill); the bare symbol is only a
 *   fallback for execution rows written before `coin` was recorded.
 * - Only fills at/after the thesis's FIRST execution count, with a small skew
 *   allowance for clock drift between our row and the venue's fill time.
 * - Only closing fills count: an opening fill's closedPnl is 0 by definition,
 *   but filtering on direction keeps an unrelated same-coin OPEN from a prior
 *   position out of the window entirely.
 *
 * Returns null when there is nothing that can honestly be summed.
 */
export function realizedPnl(executions: ExecLike[], fills: FillLike[]): number | null {
  if (!Array.isArray(executions) || !executions.length || !Array.isArray(fills)) return null;

  const coins = new Set<string>();
  let start = Infinity;
  for (const e of executions) {
    const c = (e.coin || e.symbol || '').toUpperCase();
    if (c) coins.add(c);
    const t = ts(e.created_at);
    if (t > 0) start = Math.min(start, t);
  }
  if (!coins.size || !Number.isFinite(start)) return null;
  start -= 60_000;                                     // clock-skew allowance

  let sum = 0;
  let counted = 0;
  for (const f of fills) {
    const coin = String(f.coin || '').toUpperCase();
    if (!coins.has(coin)) continue;
    if (!(+f.time >= start)) continue;
    if (!/close/i.test(String(f.dir || ''))) continue;
    const pnl = Number(f.closedPnl);
    if (!Number.isFinite(pnl)) continue;
    sum += pnl;
    counted++;
  }
  return counted > 0 ? sum : null;
}

/* one fetch per address per screen-visit — every closed thesis on the page shares it */
let fillsCache: { addr: string; ts: number; p: Promise<FillLike[] | null> } | null = null;

export function userFills(addr: string): Promise<FillLike[] | null> {
  const key = addr.toLowerCase();
  if (fillsCache && fillsCache.addr === key && Date.now() - fillsCache.ts < 30_000) return fillsCache.p;
  const p = info({ type: 'userFills', user: addr, aggregateByTime: true })
    .then((r: any) => (Array.isArray(r) ? r as FillLike[] : null))
    .catch(() => null);
  fillsCache = { addr: key, ts: Date.now(), p };
  return p;
}
