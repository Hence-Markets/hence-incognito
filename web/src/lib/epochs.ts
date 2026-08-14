/* Epoch data — one shape, two sources.
 *
 * The visualiser renders from this type, never from a contract call directly, so switching
 * from simulated flow to on-chain reads is a change of `source` and nothing else. That matters
 * because the demo has to work before the contract is deployed, and the demo must not quietly
 * become the product: anything simulated is labelled `simulated: true` and the UI says so.
 *
 * The fields mirror HenceIncognito.sol exactly — orderCount, sumLongs, sumShorts, matched,
 * residual — so the on-chain source is a direct mapping with no reshaping.
 */

export type Epoch = {
  id: number;
  closedAt: number;
  orderCount: number;
  /** gross notional submitted into the epoch */
  gross: number;
  sumLongs: number;
  sumShorts: number;
  /** min(longs, shorts) — crossed internally, NEVER reached a public venue */
  matched: number;
  /** |longs - shorts| — the only part Avantis ever sees */
  residual: number;
  simulated: boolean;
};

/** Mirrors MIN_ORDERS_TO_REVEAL in the contract. A total over a small book gives up its parts,
 *  so the aggregate is not publishable below this — and the UI must honour the same rule the
 *  contract enforces, or the screen would show something the chain would have refused. */
export const MIN_ORDERS_TO_REVEAL = 5;

export const canPublishAggregate = (ep: Epoch) => ep.orderCount >= MIN_ORDERS_TO_REVEAL;

/** Long share of the book, as a percentage — only meaningful when publishable. */
export const longShare = (ep: Epoch) =>
  ep.gross === 0 ? 0 : Math.round((ep.sumLongs / ep.gross) * 100);

/** Share of gross that never reached a public venue. The headline number of the whole product. */
export const privateShare = (ep: Epoch) =>
  ep.gross === 0 ? 0 : Math.round((ep.matched * 2 / ep.gross) * 100);

/* ── simulated source ──────────────────────────────────────────────────────────────────────
   Deterministic, so the demo tells the same story twice and a screenshot matches the live
   screen. Sized to look like a real book rather than a tidy one: imbalanced, uneven orders. */

const SEED_ORDERS: { side: 'long' | 'short'; size: number }[] = [
  // Deliberately IMBALANCED. An accidentally-balanced book renders as "100% of this volume
  // stayed private", which reads as rigged and teaches the viewer nothing — the interesting
  // claim is that most of a lopsided book still crosses. Longs ~68% of gross here, so ~64%
  // crosses and a real residual goes out. Numbers that look measured, because they are.
  { side: 'long', size: 12_500 },
  { side: 'short', size: 8_000 },
  { side: 'long', size: 3_200 },
  { side: 'short', size: 4_600 },
  { side: 'long', size: 6_800 },
  { side: 'long', size: 12_100 },
  { side: 'short', size: 5_700 },
  { side: 'long', size: 9_300 },
  { side: 'short', size: 3_300 },
  { side: 'long', size: 2_100 },
];

export function simulatedEpoch(id = 0x19f, at = 0): Epoch {
  const sumLongs = SEED_ORDERS.filter((o) => o.side === 'long').reduce((a, o) => a + o.size, 0);
  const sumShorts = SEED_ORDERS.filter((o) => o.side === 'short').reduce((a, o) => a + o.size, 0);
  // exactly the contract's arithmetic: matched = min, residual = max - min
  const matched = Math.min(sumLongs, sumShorts);
  const residual = Math.max(sumLongs, sumShorts) - matched;
  return {
    id,
    closedAt: at,
    orderCount: SEED_ORDERS.length,
    gross: sumLongs + sumShorts,
    sumLongs,
    sumShorts,
    matched,
    residual,
    simulated: true,
  };
}

/** A book too small to publish an aggregate over — proves the guard is real, not decorative. */
export function simulatedThinEpoch(id = 0x1a0): Epoch {
  const sumLongs = 4_000;
  const sumShorts = 1_500;
  const matched = Math.min(sumLongs, sumShorts);
  return {
    id,
    closedAt: 0,
    orderCount: 3,
    gross: sumLongs + sumShorts,
    sumLongs,
    sumShorts,
    matched,
    residual: Math.max(sumLongs, sumShorts) - matched,
    simulated: true,
  };
}
