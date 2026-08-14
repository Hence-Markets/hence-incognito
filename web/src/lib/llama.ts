/* =========================================================
   llama.ts — clients for two crypto-depth backend endpoints:
     GET /api/llama?sym=SYM → DefiLlama protocol fees/revenue/TVL
     GET /api/dvol?c=BTC|ETH → Deribit implied-vol (DVOL)
   Both degrade to null / {available:false} when the endpoint 404s
   (the backend is built concurrently — the asset page must never
   break when these are missing). Module-level 1h caches so a
   revisit / re-observe never re-hits the proxy.
   ========================================================= */

export interface LlamaSeries {
  d1?: number; d7?: number; d30?: number; y1?: number;
  chart?: [number, number][];               // [ts, usd]
}
export interface LlamaInfo {
  available: boolean;
  sym: string;
  name?: string;
  slug?: string;
  category?: string;
  tvl?: number;
  mcap?: number;
  tvlHistory?: [number, number][];          // [ts, usd] ≤120
  fees?: LlamaSeries | null;
  revenue?: LlamaSeries | null;
  pf?: number;                              // price / fees
  ps?: number;                              // price / sales(revenue)
}
export interface DvolInfo { available: boolean; dvol?: number; asOf?: number }

const H1 = 3600_000;

function cachedGetter<T>(url: (s: string) => string, miss: T) {
  const cache = new Map<string, { t: number; v: T }>();
  const inflight = new Map<string, Promise<T>>();
  return (sym: string): Promise<T> => {
    const s = String(sym || '').toUpperCase();
    if (!s) return Promise.resolve(miss);
    const e = cache.get(s);
    if (e && Date.now() - e.t < H1) return Promise.resolve(e.v);
    if (inflight.has(s)) return inflight.get(s)!;
    const p = fetch(url(s))
      .then((r) => (r.ok ? r.json() : null))
      .then((v: any) => {
        const val: T = v && !v.error ? v : miss;
        cache.set(s, { t: Date.now(), v: val });
        return val;
      })
      .catch(() => { cache.set(s, { t: Date.now(), v: miss }); return miss; })
      .finally(() => { inflight.delete(s); });
    inflight.set(s, p);
    return p;
  };
}

export const llamaInfo = cachedGetter<LlamaInfo>(
  (s) => `/api/llama?sym=${encodeURIComponent(s)}`,
  { available: false, sym: '' },
);
export const dvol = cachedGetter<DvolInfo>(
  (s) => `/api/dvol?c=${encodeURIComponent(s)}`,
  { available: false },
);
