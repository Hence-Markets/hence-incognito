/* The three markets Incognito trades — and why it is three and not a hundred.
 *
 * NETTING ONLY WORKS WHERE FLOW CONCENTRATES. `matched = min(longs, shorts)` is computed per
 * market, so twenty orders spread across Avantis' 105 symbols leaves almost every book with a
 * single order and nothing to cross against — the product's entire claim collapses to "we
 * shielded the address", which is the weak half. Three liquid names is what makes the number
 * non-zero. Dark pools in equities work for the same reason: they live in the most traded
 * symbols, never the long tail.
 *
 * It is also what keeps the contract honest — `netEpoch` loops over every market touched, and
 * MAX_MARKETS_PER_EPOCH bounds that loop. Three is comfortably inside it.
 *
 * The pair index is AVANTIS' OWN, taken from GET /v2/pairs. Using their numbering means the
 * uint16 stored on chain is directly the thing the keeper hands to Avantis when routing a
 * residual — no lookup table to drift out of date.
 */

export type Market = { sym: string; pair: number; name: string };

/** Verified against GET /v2/pairs on 2026-08-15. `verifyPairIndices` re-checks at runtime, so
 *  these being stale is loud rather than silent — a wrong index routes to the WRONG MARKET. */
export const MARKETS: Market[] = [
  { sym: 'BTC', pair: 1, name: 'Bitcoin' },
  { sym: 'ETH', pair: 0, name: 'Ethereum' },
  { sym: 'SOL', pair: 2, name: 'Solana' },
];

const BY_SYM = new Map(MARKETS.map((m) => [m.sym, m]));

export const isIncognitoMarket = (sym?: string | null): boolean =>
  !!sym && BY_SYM.has(String(sym).toUpperCase().split(':').pop() || '');

export const marketOf = (sym?: string | null): Market | null =>
  BY_SYM.get(String(sym ?? '').toUpperCase().split(':').pop() || '') ?? null;

/** The on-chain pair index, or null when the symbol is not one we trade. Null must reach the
 *  ticket as a refusal — never a default of 0, which is silently ETH. */
export const pairIndex = (sym?: string | null): number | null => marketOf(sym)?.pair ?? null;

export const marketSymbols = (): string[] => MARKETS.map((m) => m.sym);

/**
 * Check the hardcoded indices against what Avantis actually reports.
 *
 * A wrong index does not fail — it succeeds against a different market, and a residual meant
 * for SOL opens on ETH. That is the worst kind of bug: silent, and only visible in the money.
 * So this runs once at load and screams rather than correcting quietly, because a mismatch
 * means the assumption behind the whole mapping has changed.
 */
export function verifyPairIndices(pairs: any[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const m of MARKETS) {
    const live = pairs.find(
      (p) => String(p?.from ?? '').toUpperCase() === m.sym && !String(p?.symbol ?? '').includes('UPSIDE')
    );
    if (!live) problems.push(`${m.sym}: Avantis no longer lists it`);
    else if (Number(live.index) !== m.pair) {
      problems.push(`${m.sym}: index is ${live.index} on Avantis, ${m.pair} here`);
    }
  }
  if (problems.length) {
    console.error('[incognito] PAIR INDEX MISMATCH — orders would route to the wrong market:', problems);
  }
  return { ok: problems.length === 0, problems };
}
