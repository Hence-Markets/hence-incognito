import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

// Same lightweight-charts setup as the vanilla makeChart(), now a proper npm import
// fed by our own Hydromancer candles — works for crypto, trade.xyz RWA and (later) predictions.
//
// History backfill: when the user zooms/pans left toward the start of the loaded data, we ask the
// parent for older bars via onNeedHistory(). The parent prepends them and re-passes `candles`; we
// then shift the visible logical range by the number of bars added so the view doesn't jump (the
// standard lightweight-charts prepend correction). onNeedHistory resolves to how many bars were
// prepended — 0 means "no more history". We stop paging once that happens twice in a row, and reset
// that end-of-history flag whenever the symbol/timeframe changes (signalled via the `resetKey` prop).
export function TradingChart({
  candles,
  onNeedHistory,
  resetKey,
  error,
  onRetry,
}: {
  candles: Candle[] | null;
  onNeedHistory?: () => Promise<number>;
  resetKey?: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);          // LWC renders here (no React-managed children)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const csRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const vsRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  // paging guards live in refs so the visible-range subscription (created once per chart) can read
  // the freshest values without being torn down and re-subscribed on every data update.
  const loadingRef = useRef(false);       // single in-flight backfill at a time
  const doneRef = useRef(false);          // end-of-history reached (two empty pages in a row)
  const emptyStreakRef = useRef(0);       // consecutive onNeedHistory() → 0 results
  const prevLenRef = useRef(0);           // series length before the latest data update
  // Programmatic view changes (initial fitContent + the post-prepend shift) fire the same
  // visible-range event as a user zoom/pan. Without this guard they'd re-trigger backfill and
  // cascade many pages on load. We stamp `suppressUntilRef` right before every programmatic view
  // change and ignore range events for a short window after — so ONLY genuine user navigation to
  // the left edge pages in more history.
  const suppressUntilRef = useRef(0);
  const onNeedRef = useRef(onNeedHistory);
  onNeedRef.current = onNeedHistory;

  // Reset all paging state when the symbol/timeframe changes.
  useEffect(() => {
    loadingRef.current = false;
    doneRef.current = false;
    emptyStreakRef.current = 0;
    prevLenRef.current = 0;
    suppressUntilRef.current = 0;
  }, [resetKey]);

  // Create the chart once (per mount). Data updates happen in a separate effect so we don't tear
  // down the chart — and lose the visible range / zoom — on every candle change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth || 700,
      height: el.clientHeight || 360,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a8a92', fontFamily: 'inherit', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.18)', width: 1, style: 2, labelBackgroundColor: '#26272d' },
        horzLine: { color: 'rgba(255,255,255,0.18)', width: 1, style: 2, labelBackgroundColor: '#26272d' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#2fbf8f', downColor: '#e8736e', borderUpColor: '#2fbf8f', borderDownColor: '#e8736e',
      wickUpColor: '#2fbf8f', wickDownColor: '#e8736e',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
    });
    const vs = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chartRef.current = chart;
    csRef.current = cs;
    vsRef.current = vs;

    // Backfill trigger: when the left edge of the visible range nears the start of the data, ask the
    // parent for older bars. Guarded so only one request is in flight and we stop at end-of-history.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || !onNeedRef.current) return;
      if (loadingRef.current || doneRef.current) return;
      if (Date.now() < suppressUntilRef.current) return;   // ignore our own programmatic view changes
      if (range.from < 15) {
        loadingRef.current = true;
        Promise.resolve(onNeedRef.current())
          .then((added) => {
            if (!added || added <= 0) {
              emptyStreakRef.current += 1;
              if (emptyStreakRef.current >= 2) doneRef.current = true;   // end of history
            } else {
              emptyStreakRef.current = 0;
            }
          })
          .catch(() => { /* transient — allow a later retry */ })
          .finally(() => { loadingRef.current = false; });
      }
    });

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      try { ro.disconnect(); } catch { /* noop */ }
      try { chart.remove(); } catch { /* noop */ }
      chartRef.current = null; csRef.current = null; vsRef.current = null;
    };
  }, []);

  // Data updates: set series data and preserve the user's view when older bars are prepended.
  useEffect(() => {
    const chart = chartRef.current, cs = csRef.current, vs = vsRef.current;
    if (!chart || !cs || !vs) return;
    if (!candles || candles.length < 2) return;

    const last = candles[candles.length - 1].c;
    const prec = last >= 1000 ? 1 : last >= 100 ? 2 : last >= 1 ? 3 : last >= 0.01 ? 5 : 7;
    cs.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: Math.pow(10, -prec) } });

    const prevLen = prevLenRef.current;
    const added = candles.length - prevLen;   // >0 when history was prepended (or first paint)
    // Capture the current view so we can shift it after prepends keep the same bars on screen.
    const beforeRange = chart.timeScale().getVisibleLogicalRange();

    // setData + the fitContent/shift below all emit visible-range events; suppress backfill for them
    // so our own view management can't cascade into unbounded paging. Genuine user zoom/pan (which
    // happens after this window) still pages normally.
    suppressUntilRef.current = Date.now() + 350;
    cs.setData(candles.map((k) => ({ time: Math.floor(k.t / 1000) as any, open: k.o, high: k.h, low: k.l, close: k.c })));
    vs.setData(candles.map((k) => ({ time: Math.floor(k.t / 1000) as any, value: k.v, color: k.c >= k.o ? 'rgba(47,191,143,0.32)' : 'rgba(232,115,110,0.32)' })));

    if (prevLen === 0) {
      // first paint for this symbol/tf → frame the data
      chart.timeScale().fitContent();
    } else if (added > 0 && beforeRange) {
      // History prepended: shift the logical range right by `added` so the same bars stay in view.
      chart.timeScale().setVisibleLogicalRange({ from: beforeRange.from + added, to: beforeRange.to + added });
    }
    // added <= 0 (e.g. live tail merge that only mutated the last bar, or an equal-length update):
    // leave the view untouched.
    suppressUntilRef.current = Date.now() + 350;   // re-stamp: fitContent/shift fire async on next frame
    prevLenRef.current = candles.length;
  }, [candles]);

  const showError = !!error && (!candles || candles.length < 2);
  // The LWC host (ref) has NO React-managed children — React and lightweight-charts must not fight
  // over the same node. Overlays are absolutely-positioned siblings inside the positioned wrapper.
  return (
    <div className="term__chart-canvas" data-bars={candles ? candles.length : 0}>
      <div className="term__chart-host" ref={ref} />
      {showError ? (
        <div className="term__chart-err">
          <span>Couldn’t load the chart</span>
          {onRetry ? <button className="term__chart-retry" onClick={onRetry}>Retry</button> : null}
        </div>
      ) : !candles ? (
        <div className="term__loading">Loading chart…</div>
      ) : null}
    </div>
  );
}
