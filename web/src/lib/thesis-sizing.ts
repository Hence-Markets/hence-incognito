/* =========================================================================
   Thesis sizing — how ONE amount becomes per-leg orders.

   Deliberately dependency-free (no viem, no market lookups, no React) so the
   allocation maths can be tested without a wallet or a live universe. The
   executor that consumes it lives in thesis-run.ts.
   ========================================================================= */

// Hyperliquid rejects orders under $10 notional. Enforced per leg, up front.
export const MIN_LEG_USD = 10;

export type PlanLegLike = {
  venue?: string;
  symbol?: string;
  direction?: string;
  sizing?: { mode: 'usd' | 'pct'; value: number } | null;
  question?: string;
  market?: { id?: string; question?: string } | null;
  route?: string;
  label?: string;
  invalidation?: { type?: string; level?: number | null; text?: string } | null;
  target?: { level?: number | null; text?: string | null } | null;
};

/** Why a leg can't be executed here. Prediction legs are expected, not errors. */
export type SkipReason = 'prediction' | 'not-listed' | 'no-price' | 'no-symbol';

export const SKIP_TEXT: Record<SkipReason, string> = {
  prediction: 'Prediction market — open it to trade',
  'not-listed': 'Not listed for live orders',
  'no-price': 'No live price yet',
  'no-symbol': 'No tradeable symbol on this leg',
};

export type RunLeg = {
  i: number;                    // index in the source plan's legs array
  label: string;
  symbol: string;
  coin: string;                 // HL coin — may be a HIP-3 pair like 'xyz:NVDA'
  venue: string;
  direction: string;
  isBuy: boolean;
  mark: number;
  weight: number;               // share of the total across EXECUTABLE legs (sums to 1)
  usd: number;
  maxLev: number;               // 0 until the pre-flight fills it in
  onlyIsolated: boolean;
  skip: SkipReason | null;
  route?: string;
  /** reduce-only trigger levels, extracted from the plan. null = the plan supplied none (or
      supplied one on the wrong side of the market — see buildRunLegs). */
  stop: number | null;
  target: number | null;
};

/** Market lookups, injected so this module stays pure and testable. */
export type MarketLookups = {
  coinFor: (sym: string) => string;
  isTradeable: (sym: string) => boolean;
  markFor: (sym: string) => number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------------------------------------------------------------- weights
   Legs already carry `sizing: {mode:'usd'|'pct', value}` from the copilot's
   validated plan. Convert each to a weight over the EXECUTABLE legs, so a
   skipped prediction leg's share is redistributed rather than lost:

     all 'pct'  → normalize the percentages
     all 'usd'  → each leg's share of the plan's total usd
     mixed/none → equal weight

   Mixed modes are deliberately equal-weighted rather than guessed at: adding a
   $500 leg to two 30% legs has no defensible common denominator. */
export function weightLegs<T extends { sizing?: { mode: 'usd' | 'pct'; value: number } | null }>(legs: T[]): number[] {
  if (!legs.length) return [];
  const modes = new Set(legs.map((l) => (l.sizing && l.sizing.value > 0 ? l.sizing.mode : '')));
  const uniform = modes.size === 1 && !modes.has('');
  const raw = uniform ? legs.map((l) => Math.max(0, l.sizing!.value)) : legs.map(() => 1);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return legs.map(() => 1 / legs.length);
  return raw.map((w) => w / sum);
}

/** Split `total` across the legs by weight, in whole cents, with the rounding
 *  remainder absorbed by the largest leg so the parts sum to exactly `total`. */
export function allocate(weights: number[], total: number): number[] {
  if (!weights.length || !(total > 0)) return weights.map(() => 0);
  const out = weights.map((w) => round2(total * w));
  const drift = round2(total - out.reduce((a, b) => a + b, 0));
  if (drift !== 0) {
    let big = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[big]) big = i;
    out[big] = round2(out[big] + drift);
  }
  return out;
}

/** The smallest total that funds every leg to the $10 minimum, rounded up to a
 *  whole dollar so the message reads like money and not like a float. */
export function minTotalFor(weights: number[]): number {
  const smallest = weights.reduce((m, w) => (w > 0 && w < m ? w : m), 1);
  return smallest > 0 ? Math.ceil(MIN_LEG_USD / smallest) : MIN_LEG_USD;
}

/* ------------------------------------------------------- build the run legs
   Classify every plan leg, weight the executable ones, and allocate. PM legs
   are carried through as skipped-with-a-route so the sheet can still show
   them (and that they were left out) rather than pretending they don't
   exist — Polymarket trading is still flag-gated and not live. */
export function buildRunLegs(legs: PlanLegLike[], total: number, m: MarketLookups): RunLeg[] {
  const classified = (legs || []).map((l, i): RunLeg => {
    const symbol = String(l.symbol || '').toUpperCase();
    const dir = String(l.direction || '').toLowerCase();
    const isPm = l.venue === 'prediction' || dir === 'yes' || dir === 'no';
    const coin = !isPm && symbol ? m.coinFor(symbol) : '';
    const mark = !isPm && symbol ? m.markFor(symbol) : 0;
    const skip: SkipReason | null =
      isPm ? 'prediction'
      : !symbol ? 'no-symbol'
      : !coin || !m.isTradeable(symbol) ? 'not-listed'
      : !(mark > 0) ? 'no-price'
      : null;
    // The plan's stop (a PRICE-type invalidation) and target become real reduce-only trigger
    // orders after the leg fills. The server validates sides at plan time, but plans saved
    // BEFORE that validation existed are still in the database — so the side is re-checked
    // here against the live mark. A wrong-sided trigger fires the instant it reaches the
    // book, which is a market close dressed up as protection; better no trigger than that.
    const inv = l.invalidation;
    let stop = inv && inv.type === 'price' && Number.isFinite(Number(inv.level)) ? Number(inv.level) : null;
    let target = l.target && Number.isFinite(Number(l.target.level)) ? Number(l.target.level) : null;
    if (mark > 0 && !isPm) {
      const long = dir !== 'short';
      if (stop != null && (long ? stop >= mark : stop <= mark)) stop = null;
      if (target != null && (long ? target <= mark : target >= mark)) target = null;
    }
    return {
      i, symbol, coin, mark, skip, stop, target,
      label: l.label || symbol || (l.market && l.market.question) || l.question || `Leg ${i + 1}`,
      venue: String(l.venue || 'perp'),
      direction: dir,
      isBuy: dir !== 'short' && dir !== 'no',
      weight: 0, usd: 0, maxLev: 0, onlyIsolated: false,
      route: l.route,
    };
  });

  const live = classified.filter((l) => !l.skip);
  const weights = weightLegs(live.map((l) => legs[l.i] || {}));
  const amounts = allocate(weights, total);
  live.forEach((l, k) => { l.weight = weights[k]; l.usd = amounts[k]; });
  return classified;
}

/* ---------------------------------------------------------------- pre-flight */
export type PreflightIssue = { kind: 'amount' | 'nothing' | 'margin'; message: string };

/** Blocking problems with the run as configured. Empty array = safe to sign. */
export function preflight(legs: RunLeg[], total: number, leverage: number, available: number | null): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const live = legs.filter((l) => !l.skip);
  if (!live.length) {
    out.push({ kind: 'nothing', message: 'No leg of this thesis can be traded on Hence yet.' });
    return out;
  }
  if (!(total > 0)) {
    out.push({ kind: 'amount', message: 'Enter an amount to put behind this thesis.' });
    return out;
  }
  const min = minTotalFor(live.map((l) => l.weight));
  if (live.some((l) => l.usd < MIN_LEG_USD)) {
    // Say why raising LEVERAGE doesn't clear this. The exchange minimum is on the order's
    // position size, and leverage only changes the margin posted against it — so a $10 basket
    // at 10x is still three ~$3 orders, all of them rejected. Without this the leverage
    // control sitting right next to the amount reads as the obvious fix, and isn't.
    out.push({
      kind: 'amount',
      message: `Increase to at least $${min.toLocaleString()} — each leg needs $${MIN_LEG_USD}+ of position. `
        + 'Leverage lowers the margin you post, not the order size.',
    });
  }
  const margin = live.reduce((s, l) => s + l.usd, 0) / Math.max(1, leverage);
  const short = marginShortfall(margin, available);
  if (short) out.push({ kind: 'margin', message: short });
  return out;
}

/** The ONE margin rule: can this order be collateralised? Every surface that asks — run
 *  sheet, terminal ticket, dock quick-trade — must answer identically; divergent answers to
 *  the same question is how a UI stops being believed. Returns the gap when the order
 *  cannot be funded, or null when it can. Surfaces choose their own PRESENTATION (a modal
 *  can afford a sentence, a ticket row cannot) but never their own arithmetic. */
export function marginGap(marginRequired: number, available: number | null): { needed: number; available: number } | null {
  if (available == null || !(marginRequired > 0) || marginRequired <= available) return null;
  return { needed: marginRequired, available };
}

/** The sentence form, for surfaces with room for prose (run sheet, toasts). */
export function marginShortfall(marginRequired: number, available: number | null): string | null {
  const gap = marginGap(marginRequired, available);
  return gap ? `Needs $${gap.needed.toFixed(2)} of margin — you have $${gap.available.toFixed(2)} available.` : null;
}
