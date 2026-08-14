/* =========================================================
   Public client config (served by serve.py GET /api/config).
   Non-secret values only — currently the Hyperliquid builder code
   (fee monetization). Cached in-memory for 5 minutes so the terminal
   can check it cheaply on every order without re-fetching.
   ========================================================= */

export type HenceConfig = {
  /** Hyperliquid builder address (lowercase). Empty string = builder-fee feature OFF. */
  hlBuilder: string;
  /** Builder fee in TENTHS OF A BASIS POINT (10 → 1bp → 0.01%). Perps cap 100 (0.1%). */
  hlBuilderFee: number;
  /** Polymarket builder code (bytes32, from polymarket.com/settings builder tab).
   *  Empty string = no builder attribution (orders placed without a builder code). */
  pmBuilderCode: string;
  /** Polymarket builder fee in basis points, for the UI disclosure line. Default 0. */
  pmBuilderFeeBps: number;
  /** xyz rebate campaign: true = zero Hence fee on xyz: coins, venue fees rebated server-side. */
  xyzRebate: boolean;
};

const EMPTY: HenceConfig = { hlBuilder: '', hlBuilderFee: 10, pmBuilderCode: '', pmBuilderFeeBps: 0, xyzRebate: false };
const TTL = 5 * 60_000;

let _cache: { at: number; cfg: HenceConfig } | null = null;
let _inflight: Promise<HenceConfig> | null = null;

export async function getConfig(): Promise<HenceConfig> {
  if (_cache && Date.now() - _cache.at < TTL) return _cache.cfg;
  if (_inflight) return _inflight;
  _inflight = fetch('/api/config', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : EMPTY))
    .then((j: any) => {
      const cfg: HenceConfig = {
        hlBuilder: typeof j?.hlBuilder === 'string' ? j.hlBuilder.trim().toLowerCase() : '',
        hlBuilderFee: Number.isFinite(+j?.hlBuilderFee) ? +j.hlBuilderFee : 10,
        // Read defensively — absent field = no Polymarket builder attribution.
        pmBuilderCode: typeof j?.pmBuilderCode === 'string' ? j.pmBuilderCode.trim() : '',
        pmBuilderFeeBps: Number.isFinite(+j?.pmBuilderFeeBps) ? +j.pmBuilderFeeBps : 0,
        xyzRebate: j?.xyzRebate === true,
      };
      _cache = { at: Date.now(), cfg };
      return cfg;
    })
    .catch(() => _cache?.cfg ?? EMPTY)
    .finally(() => { _inflight = null; });
  return _inflight;
}

/** Format a tenths-of-a-bp fee as a percent string, e.g. 10 → "0.01%". */
export function feeToPercent(tenthsBps: number): string {
  // tenths-of-bp → percent: 1 bp = 0.01%, and f=10 → 1bp; so percent = f / 1000.
  const pct = tenthsBps / 1000;
  // trim trailing zeros: 0.01, 0.025, etc.
  return `${parseFloat(pct.toFixed(4))}%`;
}
