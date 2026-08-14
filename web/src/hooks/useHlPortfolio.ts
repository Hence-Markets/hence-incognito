import { useEffect, useState } from 'react';
import { info } from '../lib/hydromancer.js';

/* =========================================================
   useHlPortfolio — the connected wallet's real equity curve.

   Reads Hyperliquid's public {type:'portfolio', user} via our /api/info proxy (which routes
   this per-user, keyless read straight to the public venue). The response is a positional list
   of [windowName, {accountValueHistory:[[tsMs, value], …], pnlHistory, vlm}] entries; we keep
   just the accountValueHistory per window. Polls every 60s (equity moves slowly; positions/
   balances live on the faster useHlAccount poll).
   ========================================================= */

export type PfPoint = [number, number]; // [tsMs, accountValue]
export type PfWindows = Record<string, PfPoint[]>; // 'day' | 'week' | 'month' | 'allTime' | perp*

export function useHlPortfolio(address?: string) {
  const [windows, setWindows] = useState<PfWindows | null>(null);
  const [pnlWindows, setPnlWindows] = useState<PfWindows | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!address) { setWindows(null); setPnlWindows(null); setLoaded(false); return; }
    let alive = true;
    const load = async () => {
      try {
        const raw = await info({ type: 'portfolio', user: address });
        if (!alive) return;
        const map: PfWindows = {};
        const pnl: PfWindows = {};
        const clean = (hist: any) => (Array.isArray(hist)
          ? hist.map((p: any) => [Number(p?.[0]), Number(p?.[1])] as PfPoint)
              .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
          : null);
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            const name = Array.isArray(entry) ? entry[0] : null;
            if (typeof name !== 'string' || !entry[1]) continue;
            const av = clean(entry[1].accountValueHistory);
            const pn = clean(entry[1].pnlHistory);   // cumulative P&L over the window
            if (av) map[name] = av;
            if (pn) pnl[name] = pn;
          }
        }
        setWindows(map);
        setPnlWindows(pnl);
        setLoaded(true);
      } catch { if (alive) setLoaded(true); }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [address]);

  return { windows, pnlWindows, loaded };
}

/* Extract the equity series for a home-chart range tab, time-clipped so it aligns with the
   asset chart's window. Picks the finest-resolution source window, clips to the range's span,
   and falls back to the full source when the account is younger than the window (few points).
   Returns the raw value series (for the overlay line) + the window %-change (for the chip). */
const RANGE_DAYS: Record<string, number> = { '1M': 30, '3M': 90, '1Y': 365, '2Y': 730 };

export function pfSeriesForRange(windows: PfWindows | null, range: string): { values: number[]; pct: number } {
  const empty = { values: [] as number[], pct: 0 };
  if (!windows) return empty;
  // 1M has a dedicated finer window; everything longer comes from allTime (HL's longest curve).
  const src = range === '1M' ? (windows.month || windows.allTime) : (windows.allTime || windows.month);
  if (!src || src.length < 2) return empty;

  const now = Date.now();
  let days = RANGE_DAYS[range];
  if (range === 'YTD') {
    const jan1 = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    days = Math.max(1, (now - jan1) / 86_400_000);
  }
  const cutoff = days ? now - days * 86_400_000 : 0;
  let pts = cutoff ? src.filter(([t]) => t >= cutoff) : src.slice();
  if (pts.length < 2) pts = src.slice(); // account younger than the window → show all we have

  const values = pts.map(([, v]) => v);
  const first = values[0], last = values[values.length - 1];
  const pct = first ? (last - first) / first * 100 : 0;
  return { values, pct };
}
