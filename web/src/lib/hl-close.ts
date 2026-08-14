/* =========================================================================
   Closing a Hyperliquid position — the one implementation.

   This existed twice (the terminal and the terminal's account card) before the
   portfolio needed a third for "close this thesis". The details that must not
   drift between call sites:

     - the mark is derived from the POSITION (positionValue / sz), not from a
       ticker, so a close always prices against what the venue thinks you hold;
     - reduceOnly, always — a close must never be able to flip you long/short;
     - the builder fee is attached with prompt:false, so an exit is never
       interrupted by a one-time approval signature;
     - the fill emits trade_submitted, because the revenue dashboard sums it.
   ========================================================================= */
import { placeOrder, MARKET_PRICE_PROTECTION } from './hyperliquid-exchange';
import { resolveBuilder } from './builder-fee';
import { track } from './analytics';
import type { RunWithAgent } from './hl-run';
import type { SignTypedDataFn } from './hyperliquid-sign';

export type ClosablePosition = {
  coin: string;
  side: 'Long' | 'Short';
  sz: number;
  entryPx: number;
  positionValue: number;
};

export type CloseResult =
  | { ok: true; status: string; size?: number; price?: number }
  | { ok: false; error: string };

/**
 * Market-close `pct`% of a position. `source` distinguishes where the close came
 * from in telemetry (terminal vs portfolio vs a whole-thesis exit).
 */
export async function closePosition(
  runWithAgent: RunWithAgent,
  sign: SignTypedDataFn,
  address: string,
  p: ClosablePosition,
  opts: { pct?: number; slippage?: number; source?: string; thesisId?: number | string | null } = {},
): Promise<CloseResult> {
  const pct = Math.min(100, Math.max(1, opts.pct ?? 100));
  // price against the venue's own view of the position, not a ticker that may be stale
  const mark = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
  if (!(mark > 0)) return { ok: false, error: 'No live price to close against' };

  const notional = p.sz * (pct / 100) * mark;
  if (!(notional > 0)) return { ok: false, error: 'Nothing to close' };

  const bf = await resolveBuilder(sign, address, notional, { prompt: false });
  const r: any = await runWithAgent((s) => placeOrder(s, {
    coin: p.coin,
    isBuy: p.side === 'Short',          // closing a short BUYS it back
    usd: notional,
    markPrice: mark,
    type: 'Market',
    reduceOnly: true,
    slippage: opts.slippage ?? MARKET_PRICE_PROTECTION,
    builder: bf.builder,
  }));

  if (!r || 'error' in r) return { ok: false, error: (r && r.error) || 'Close failed' };

  track('trade_submitted', {
    coin: p.coin, side: p.side === 'Short' ? 'buy' : 'sell', status: r.status,
    usd: notional, venue: String(p.coin).includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
    builder_attached: !!bf.builder, hence_fee_usd: bf.feeUsd, market: 'perp',
    source: opts.source || 'close', thesis_id: opts.thesisId ?? null,
  });

  const d = r.detail || {};
  return { ok: true, status: r.status, size: Number(d.totalSz ?? d.sz ?? 0) || undefined, price: Number(d.avgPx ?? d.px ?? 0) || undefined };
}

export type CloseAllOutcome = {
  closed: { coin: string; result: CloseResult }[];
  failed: { coin: string; error: string }[];
};

/**
 * Close EVERY open position, sequentially, through the same rail as a single close.
 *
 * Sequential on purpose: each close prices against the venue's current view, and a batch
 * that fires twenty market orders at once is how a cascade of partial fills turns into
 * slippage nobody asked for. One at a time, collect what actually happened, report both
 * lists — this is somebody's entire book, so "assume it worked" is not an option.
 *
 * The CALLER owns the confirmation. This function will close whatever it is handed.
 */
export async function closeAllPositions(
  runWithAgent: RunWithAgent,
  sign: SignTypedDataFn,
  address: string,
  positions: ClosablePosition[],
  opts: { slippage?: number; onOne?: (coin: string, r: CloseResult) => void } = {},
): Promise<CloseAllOutcome> {
  const out: CloseAllOutcome = { closed: [], failed: [] };
  for (const p of positions) {
    try {
      const r = await closePosition(runWithAgent, sign, address, p,
        { pct: 100, slippage: opts.slippage, source: 'close_all' });
      opts.onOne?.(p.coin, r);
      if (r.ok) out.closed.push({ coin: p.coin, result: r });
      else out.failed.push({ coin: p.coin, error: r.error });
    } catch (e: any) {
      // one rejection must not strand the rest of the book un-attempted
      out.failed.push({ coin: p.coin, error: e?.message || 'Close failed' });
    }
  }
  return out;
}
