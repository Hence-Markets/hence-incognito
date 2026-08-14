/* The Incognito universe — Avantis-listed symbols only.
 *
 * The forked terminal inherited Hyperliquid's universe, which is wrong here in a way that
 * fails LATE and badly: the palette happily offers NVDA, the ticket accepts a size, and the
 * order only dies at submission because the venue never listed it. Narrow it at the source.
 *
 * Loaded once from GET /v2/pairs and cached. Until it resolves, `isAvantisSymbol` returns
 * true — the terminal shows the full universe for a beat rather than flashing empty, and the
 * ticket's own venue check is the thing that actually protects an order. This module shapes
 * what is OFFERED; it is not a safety gate.
 *
 * Symbol mapping: Avantis pairs are "BTC/USD" with from='BTC'. Hence keys everything on the
 * bare symbol, so `from` is the join. FX lands naturally too — EUR/USD → 'EUR', which is how
 * Hence names it on the xyz dex.
 */
import { fetchPairs } from './avantis';
import { verifyPairIndices, marketSymbols, isIncognitoMarket } from './markets';
// @ts-ignore — JS module
import { ingestAvantis } from './market.js';

let allow: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;

/** *_UPSIDE are Avantis' own product, not the underlying — they'd collide with the plain
 *  symbol in a universe keyed on `from`, so they are left out of the v1 offering. */
const isUpside = (sym: string) => sym.toUpperCase().includes('UPSIDE');

export function loadAvantisUniverse(): Promise<Set<string>> {
  if (allow) return Promise.resolve(allow);
  if (inflight) return inflight;
  inflight = fetchPairs()
    .then((pairs) => {
      const set = new Set<string>();
      for (const p of pairs) {
        if (!p?.from || isUpside(p.symbol || '')) continue;
        set.add(String(p.from).toUpperCase());
      }
      allow = set;
      // A wrong pair index routes a residual to the WRONG MARKET and nothing errors. Check the
      // hardcoded three against what Avantis actually reports, every load.
      verifyPairIndices(pairs);
      // Push them INTO the universe, don't just filter it afterwards. Filtering left the
      // terminal at the mercy of Hence's xyz dex: when that failed to load, Avantis-listed
      // equities disappeared from a venue that lists them.
      try {
        const r = ingestAvantis(pairs);
        console.info(`[incognito] Avantis universe: ${r.added} added, ${r.tagged} already present, ${r.total} total`);
      } catch (e) {
        console.warn('[incognito] could not ingest Avantis pairs', e);
      }
      try {
        window.dispatchEvent(new CustomEvent('incognito:universe', { detail: set.size }));
      } catch { /* non-browser */ }
      return set;
    })
    .catch((err) => {
      // Fail OPEN for display. A venue outage should not blank the terminal; the ticket
      // still refuses to place, which is where the real protection lives.
      console.warn('[incognito] Avantis universe unavailable, showing full universe', err);
      allow = null;
      inflight = null;
      return new Set<string>();
    });
  return inflight;
}

/** Has the allowlist resolved? Before it does, nothing is filtered. */
export const avantisReady = () => !!allow && allow.size > 0;

/* THE OFFERED UNIVERSE IS THE THREE NETTING MARKETS, not all 105 Avantis symbols.
   Everything Avantis lists is still *tradeable in principle*, but offering it here would spread
   a small book across a hundred markets and leave nothing to cross — see lib/markets.ts. This
   is the one place that narrowing happens, so widening it later is a one-line change. */
export function isAvantisSymbol(sym?: string | null): boolean {
  return isIncognitoMarket(sym);
}

/** The full Avantis listing, for copy that needs to say what the venue supports rather than
 *  what we currently offer. Not used for filtering. */
export const isAvantisListed = (sym?: string | null): boolean => {
  if (!avantisReady()) return true;
  return !!sym && allow!.has(String(sym).toUpperCase());
};

export const avantisSymbols = (): string[] => (allow ? [...allow] : []);

/** The watchlist IS the tradable set here — three markets, so there is nothing to seed beyond
 *  them. (Avantis lists 105 symbols including NVDA, AAPL and FX; we offer three on purpose.) */
export const INCOGNITO_WATCH = marketSymbols();
