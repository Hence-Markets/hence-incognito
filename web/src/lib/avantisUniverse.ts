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

export function isAvantisSymbol(sym?: string | null): boolean {
  if (!avantisReady()) return true;
  return !!sym && allow!.has(String(sym).toUpperCase());
}

export const avantisSymbols = (): string[] => (allow ? [...allow] : []);

/** Watchlist seed, intersected with what Avantis actually lists.
 *
 *  CORRECTED: I first stripped every equity here, assuming Avantis was crypto-only. It is not
 *  — it lists NVDA, AAPL, TSLA, MSFT, AMD, AMZN, AVGO, BABA, COIN, commodities (BRENT) and FX.
 *  Seven of Hence's ten defaults are genuinely tradeable; only GOOGL, GOLD and SP500 are not.
 *  Checked against GET /v2/pairs rather than assumed. */
export const INCOGNITO_WATCH = ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'TSLA', 'MSFT', 'EUR'];
