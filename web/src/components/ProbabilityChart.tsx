import { useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import { PanelLoader } from './Loading';

/* =========================================================================
   ProbabilityChart — the prediction-market counterpart to TradingChart.
   Same lightweight-charts engine as the perp chart (one charting library
   across the whole terminal), but an AREA series of the YES probability over
   time (0–100%), with a crosshair + a hover legend that reads out the exact
   probability and date at the cursor. Fed by poly.priceHistory().
   ========================================================================= */
type Pt = { t: number; p: number };   // t = Unix SECONDS (Polymarket prices-history), p = 0..1

const UP = '#2fbf8f', DOWN = '#e8736e';

export function ProbabilityChart({ data, up, resetKey }: { data: Pt[] | null; up: boolean; resetKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const [hover, setHover] = useState<{ v: number; t: number } | null>(null);
  const lastRef = useRef<{ v: number; t: number } | null>(null);

  // create once
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth || 680,
      height: el.clientHeight || 300,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a8a92', fontFamily: 'inherit', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.05)', style: LineStyle.Dashed } },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(255,255,255,0.22)', width: 1, style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: 'rgba(255,255,255,0.22)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#26272d' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: false, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScale: false, handleScroll: false,   // a probability history is a fixed window — no pan/zoom
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: up ? UP : DOWN,
      topColor: up ? 'rgba(47,191,143,0.24)' : 'rgba(232,115,110,0.24)',
      bottomColor: 'rgba(47,191,143,0.01)',
      lineWidth: 2,
      priceLineVisible: true, priceLineColor: 'rgba(255,255,255,0.18)', priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      crosshairMarkerVisible: true, crosshairMarkerRadius: 4,
      priceFormat: { type: 'custom', minMove: 0.1, formatter: (v: number) => `${v.toFixed(1)}%` },
    });
    chartRef.current = chart;
    seriesRef.current = area;

    chart.subscribeCrosshairMove((param) => {
      const sd: any = param.seriesData?.get(area as any);
      if (param.time && sd && typeof sd.value === 'number') setHover({ v: sd.value, t: Number(param.time) });
      else setHover(null);
    });

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch { /* noop */ } try { chart.remove(); } catch { /* noop */ } chartRef.current = null; seriesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recolor when the current side flips up/down
  useEffect(() => {
    seriesRef.current?.applyOptions({
      lineColor: up ? UP : DOWN,
      topColor: up ? 'rgba(47,191,143,0.24)' : 'rgba(232,115,110,0.24)',
    });
  }, [up]);

  // data updates — dedupe by time, sort ascending, map to percentage.
  // Polymarket prices-history t is already Unix SECONDS (do NOT /1000) — lightweight-charts
  // wants seconds too. On empty/short data we CLEAR the series + legend so a new market/
  // timeframe can never keep showing the previous one's curve or a stale "now" readout.
  useEffect(() => {
    const chart = chartRef.current, s = seriesRef.current;
    if (!chart || !s) return;
    const byT = new Map<number, number>();
    for (const d of (data || [])) { const sec = Math.floor(d.t); if (sec > 0 && isFinite(d.p)) byT.set(sec, d.p * 100); }
    const pts = Array.from(byT, ([time, value]) => ({ time: time as any, value })).sort((a, b) => (a.time as number) - (b.time as number));
    if (pts.length < 2) { s.setData([]); lastRef.current = null; setHover(null); return; }
    s.setData(pts);
    chart.timeScale().fitContent();
    const last = pts[pts.length - 1];
    lastRef.current = { v: last.value, t: last.time as number };
  }, [data, resetKey]);

  const shown = hover || lastRef.current;
  const dateStr = shown ? new Date(shown.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  return (
    <div className="pt-chart-canvas">
      <div className="pt-chart-host" ref={ref} />
      {shown ? (
        <div className="pt-chart-legend">
          <b className={up ? 'up' : 'down'}>{shown.v.toFixed(1)}%</b>
          <span>{hover ? dateStr : 'now'}</span>
        </div>
      ) : null}
      {!data ? <div className="pt-chart-load"><PanelLoader label="Loading probability history…" size={26} /></div> : null}
    </div>
  );
}
