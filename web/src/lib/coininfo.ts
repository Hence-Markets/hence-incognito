/* =========================================================
   coininfo.ts — client for GET /api/coininfo?c=SYM (server caches 7d).
   Adds a module-level 1h cache so a page revisit / About-swap render
   never re-hits the proxy. Powers the crypto "About" identity card:
   description + category pills + market facts (rank/mcap/fdv/ATH) +
   link buttons (Website / X / CoinGecko / Whitepaper / Explorer).
   ========================================================= */

export interface CoinInfo {
  symbol: string;
  name: string;
  description: string;
  links: {
    homepage?: string;
    twitter?: string;
    coingecko?: string;
    whitepaper?: string;
    explorer?: string;
  };
  categories: string[];
  market: {
    rank?: number;
    mcap?: number;
    fdv?: number;
    supply_circ?: number;
    supply_total?: number;
    ath?: number;
    ath_date?: string;
    // ---- v2 additive fields (present after the coininfo backend upgrade; may be absent) ----
    high_24h?: number;
    low_24h?: number;
    atl?: number;
    atl_date?: string;
  };
  // ---- v2 additive fields ----
  sentiment_up_pct?: number;                 // CoinGecko community up-vote %
  community?: { telegram?: number; reddit?: number };
  dev?: { stars?: number; commits_4w?: number; prs_merged?: number; repo?: string };
  price_change?: { d7?: number; d30?: number; y1?: number };  // % changes
}

const H1 = 3600_000;
const _cache = new Map<string, { t: number; v: CoinInfo | null }>();
const _inflight = new Map<string, Promise<CoinInfo | null>>();

export function coinInfo(sym: string): Promise<CoinInfo | null> {
  const s = String(sym || '').toUpperCase();
  if (!s) return Promise.resolve(null);
  const e = _cache.get(s);
  if (e && Date.now() - e.t < H1) return Promise.resolve(e.v);
  if (_inflight.has(s)) return _inflight.get(s)!;
  const p = fetch(`/api/coininfo?c=${encodeURIComponent(s)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((v: any) => {
      // treat an error payload or a nameless shell as a miss (cache the null so we don't retry)
      const val: CoinInfo | null = v && !v.error && v.name ? v : null;
      _cache.set(s, { t: Date.now(), v: val });
      return val;
    })
    .catch(() => {
      _cache.set(s, { t: Date.now(), v: null });
      return null;
    })
    .finally(() => { _inflight.delete(s); });
  _inflight.set(s, p);
  return p;
}
