/* =========================================================
   Hence webapp — Graph comparison / multi-metric chart builder
   Route: #/compare/:sym  (default TSLA)
   React + TypeScript port of app/screens/compare.js
   ========================================================= */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/compare.css';
import { Icon } from '../components/Icon';
import { SvgChart } from '../components/SvgChart';
import { multiLine, sparkline } from '../lib/charts.js';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import { fmtPct } from '../lib/ui.js';
import { useMarketReady } from '../hooks/useMarket';
import { PanelLoader, Skeleton, SkeletonValue } from '../components/Loading';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';
// @ts-ignore — JS module
import { escapeHtml } from '../lib/safe-html.js';

type Series = { sym: string; metric: string; color: string };

/* an asset is "real" when Hydromancer has loaded live data for it */
const isReal = (sym: string) => { try { return market.isReady() && !!((getTicker(sym) as any) || {}).real; } catch (e) { return false; } };
/* any real data ready at all (used to seed a cross-world default comparison) */
const liveReady = () => { try { return market.isReady(); } catch (e) { return false; } };

/* palette for series accent colours (matches Hence overlay hues) */
const PALETTE = ['#f08d83', '#f4c39a', '#e6c84f', '#5fcf91', '#5b6cf0', '#b89cf0', '#7fd4e0', '#e08fc8'];

const RANGES = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', '10Y'];

/* Price-only presets. Metrics without a connected historical source are not offered. */
function presetFor(sym: string): { series: { sym: string; metric: string }[]; suggestions: string[]; sugMetric: string } {
  const seed: string[] = [];
  if (isReal(sym) && !['BTC', 'ETH', 'SOL'].includes(sym)) seed.push(sym);
  ['BTC', 'ETH', 'SOL'].forEach(s => { if (isReal(s) && !seed.includes(s)) seed.push(s); });
  const sugPool = ['HYPE', 'AVAX', 'DOGE', 'LINK', 'NVDA', 'AAPL', 'GOLD', 'SP500', 'XRP', 'BNB'];
  return {
    series: seed.slice(0, 3).map(s => ({ sym: s, metric: 'Price' })),
    suggestions: sugPool.filter(s => isReal(s) && !seed.includes(s)),
    sugMetric: 'Price',
  };
}

function tintOf(hex: string) { const h = hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`; }

function arrowUp() { return '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="var(--up)" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7M9 7h8v8"/></svg>'; }

/* map a value-fraction (0..1) to a top% that matches multiLine's pad inset */
const PAD = 10, PLOT_H = 380;
function topPctFor(frac: number) {
  // multiLine: y = h - pad - frac*(h - 2pad)  →  top% = y/h*100
  const y = PLOT_H - PAD - frac * (PLOT_H - 2 * PAD);
  return (y / PLOT_H) * 100;
}

export default function Compare() {
  const { sym: symParam } = useParams();
  const sym = (symParam || 'TSLA').toUpperCase();
  const ready = useMarketReady(); // kick market.init() + re-render when the universe is ready
  const t = getTicker(sym);

  /* state ----------------------------------------------------------------- */
  const [range, setRange] = useState('1Y');
  const [selected, setSelected] = useState<Series[]>(() =>
    presetFor(sym).series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] })));

  // register the "Compare" command scope — the range switcher as radio commands
  useEffect(() => {
    const scope = {
      id: 'compare', label: 'Compare', icon: 'chart', placeholder: 'Search commands',
      groups: [{ title: 'Range', radio: true, items: RANGES.map((r) => ({ label: r, icon: 'calendar', checked: r === range, run: () => setRange(r) })) }],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
  }, [range]);
  const [sugMetric, setSugMetric] = useState<string>(() => presetFor(sym).sugMetric);
  const [suggestions, setSuggestions] = useState<string[]>(() => presetFor(sym).suggestions.slice());
  const seededFor = useRef('');
  // bump to force a re-render when real candles / change data land
  const [, setTick] = useState(0);
  const repaint = () => setTick((n) => n + 1);
  // True while fetching real candles for the current selection and range.
  const [loadingReal, setLoadingReal] = useState(false);

  // State initializers run before the async universe is ready, so seed the genuine
  // price comparisons once readiness flips. This is the only automatic reset.
  useEffect(() => {
    if (!ready) return;
    const p = presetFor(sym);
    setSelected(p.series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] })));
    setSuggestions(p.suggestions.slice());
    setSugMetric('Price');
    seededFor.current = sym;
  }, [ready, sym]);

  /* LIVE real-data layer ------------------------------------------------- */
  // Normalized %-from-start closes per "sym|range" so wildly different price
  // scales (BTC ~$60k vs a $0.14 memecoin) overlay comparably on one axis.
  const realCache = useRef(new Map<string, number[]>());   // key `${sym}|${range}` -> number[] (percent)
  const realLabels = useRef(new Map<string, string[] | null>()); // key `${sym}|${range}` -> string[] (x labels)
  const realSettled = useRef(new Set<string>()); // empty/error requests become unavailable
  const realKey = (s: string, r: string) => `${s}|${r}`;
  const reqSeq = useRef(0);

  /* convert a candle's closes to percent-from-start: ((c/c0)-1)*100 */
  function normalizePct(closes: number[] | null): number[] | null {
    if (!closes || closes.length < 2) return null;
    const base = closes[0];
    if (!base) return null;
    return closes.map(c => ((c / base) - 1) * 100);
  }

  /* Fetch + cache real normalized series. A failed request stays unavailable. */
  async function loadRealSeries(forRange: string): Promise<boolean> {
    if (!liveReady()) return false;
    const syms = [...new Set(selected.map(s => s.sym))].filter(isReal);
    if (!syms.length) return false;
    let any = false;
    await Promise.all(syms.map(async (s) => {
      const key = realKey(s, forRange);
      if (realCache.current.has(key)) { any = true; return; }
      let d: any = null;
      try { d = await market.chartData(s, forRange); } catch (e) { /* unavailable */ }
      const pct = d && normalizePct(d.closes);
      if (pct) {
        realCache.current.set(key, pct);
        try { realLabels.current.set(key, (d.labels || []).map((ms: number) => market.fmtLabel(ms, forRange))); } catch (e) { realLabels.current.set(key, null); }
        any = true;
      }
      realSettled.current.add(key);
    }));
    return any;
  }

  /* Build one normalized live series. Missing candles stay missing. */
  function valuesFor(s: Series): number[] {
    const real = realCache.current.get(realKey(s.sym, range));
    if (real && real.length) return real;
    return [];
  }

  /* true once we have a real normalized series for this symbol+range */
  function hasReal(s: Series) { const r = realCache.current.get(realKey(s.sym, range)); return !!(r && r.length); }
  /* true when live real data IS expected for this selection+range but the real
     series aren't cached yet — the window during which we should shimmer. */
  function realPending() {
    if (!liveReady()) return false;
    const realSyms = [...new Set(selected.map(s => s.sym))].filter(isReal);
    if (!realSyms.length) return false;
    return realSyms.some(s => {
      const key = realKey(s, range);
      return !(realCache.current.get(key) || []).length && !realSettled.current.has(key);
    });
  }
  /* Current live price, with normalized growth if the quote is momentarily absent. */
  function fmtFor(s: Series, v: number): string {
    if (hasReal(s)) {
      try { const tk: any = getTicker(s.sym); if (tk && tk.real && tk.price != null) return market.fmtPrice(tk.price); } catch (e) {}
      return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    }
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  /* right-edge floating value labels (one per series, at its last value) */
  function valueLabels(): { color: string; topPct: number; tk: string; val: string }[] {
    const active = selected.filter(hasReal);
    const all = active.flatMap(s => valuesFor(s));
    if (!all.length) return [];
    const max = Math.max(...all), min = Math.min(...all), span = max - min || 1;
    return active.map(s => {
      const vals = valuesFor(s);
      const last = vals[vals.length - 1];
      const topPct = topPctFor((last - min) / span);
      return { color: s.color, topPct: Math.max(2, Math.min(96, topPct)), tk: s.sym, val: fmtFor(s, last) };
    });
  }

  /* y-axis gridline values (right rail) */
  function yAxisRows(): { topPct: number; lbl: string }[] {
    const all = selected.filter(hasReal).flatMap(s => valuesFor(s));
    if (!all.length) return [];
    const max = Math.max(...all), min = Math.min(...all), span = max - min || 1;
    return [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = min + span * f;
      const lbl = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
      return { topPct: topPctFor(f), lbl };
    });
  }

  /* the multi-line chart, with interactive crosshair tooltip via points payload */
  type CxRow = { tk: string; c: string; v: string };
  type CxPoint = { fx: number; rows: CxRow[]; l: string };
  function chartData(): { svg: string; points: CxPoint[] } | null {
    const W = 920, H = 380;
    const active = selected.filter(hasReal);
    const lines = active.map(s => ({ values: valuesFor(s), color: s.color, sw: 1.5 }));
    if (!lines.length || lines.some((l) => l.values.length < 2)) return null;
    // build crosshair point payload (per x index, all series stacked)
    const n = lines[0].values.length;
    // prefer real x-axis labels (from candle timestamps) when available
    let labels = Array.from({ length: n }, () => '');
    const realLab = active.map(s => realLabels.current.get(realKey(s.sym, range))).find(l => l && l.length === n);
    if (realLab) labels = realLab;
    const points: CxPoint[] = [];
    for (let i = 0; i < n; i++) {
      points.push({
        fx: i / (n - 1),
        rows: active.map((s, si) => {
          // series can differ in length (real candles); clamp the index defensively
          const lv = lines[si].values;
          const vi = lv[Math.min(i, lv.length - 1)];
          return { tk: s.sym, c: s.color, v: (vi >= 0 ? '+' : '') + vi.toFixed(2) + '%' };
        }),
        l: labels[i],
      });
    }
    return { svg: multiLine(lines, { w: W, h: H, pad: 10 }), points };
  }

  /* BOTTOM: Graph series table ------------------------------------------ */
  type GsRow = { color: string; label: string; idx: number; mn: string; avg: string; mx: string; spark: string; up: boolean; chgPct: number | null };
  type GsGroup = { sym: string; name: string; rows: GsRow[] };
  function seriesTableGroups(): GsGroup[] {
    // group selected by symbol
    const groups: Record<string, { s: Series; idx: number }[]> = {};
    selected.forEach((s, i) => { (groups[s.sym] = groups[s.sym] || []).push({ s, idx: i }); });
    const fullName = (sy: string) => getTicker(sy).name;
    const out: GsGroup[] = [];
    Object.keys(groups).forEach(sy => {
      const rows: GsRow[] = [];
      groups[sy].forEach(({ s, idx }) => {
        const vals = valuesFor(s);
        const real = hasReal(s);
        let chgPct: number | null = null;
        if (real) { try { const tk: any = getTicker(s.sym); if (tk && tk.real && tk.chgPct != null) chgPct = tk.chgPct; } catch (e) {} }
        const up = chgPct != null && chgPct >= 0;
        const label = real ? (() => { try { const tk: any = getTicker(s.sym); return tk && tk.price != null ? market.fmtPrice(tk.price) : 'Price'; } catch (e) { return 'Price'; } })() : 'Price unavailable';
        if (!vals.length) {
          rows.push({ color: s.color, label, idx, mn: '—', avg: '—', mx: '—', spark: '', up: false, chgPct: null });
          return;
        }
        const mn = Math.min(...vals), mx = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const numFmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        rows.push({ color: s.color, label, idx, mn: numFmt(mn), avg: numFmt(avg), mx: numFmt(mx), spark: sparkline(vals, up, 70, 22), up, chgPct });
      });
      out.push({ sym: sy, name: fullName(sy), rows });
    });
    return out;
  }

  /* Fetch real candles for the current selection and range. Never throws. */
  async function syncReal() {
    if (!liveReady()) { setLoadingReal(false); return; }
    // Gap 2: on range / add / remove change, drop into the loading state up-front
    // so the plot shows a shimmer instead of the previous item's real series.
    const pending = realPending();
    setLoadingReal(pending);
    const seq = ++reqSeq.current;
    let any = false;
    try { any = await loadRealSeries(range); } catch (e) { any = false; }
    // ignore stale responses (range/selection changed mid-flight)
    if (seq !== reqSeq.current) return;
    setLoadingReal(false);
    if (any) repaint();
  }
  /* load real 24h changes for the live tickers, then patch the table on resolve */
  function syncChanges() {
    if (!liveReady()) return;
    const coins = [...new Set(selected.map(s => s.sym))].filter(isReal).map(s => { try { return market.coinFor(s); } catch (e) { return s; } });
    if (!coins.length) return;
    try { market.loadChanges(coins).then(() => repaint()).catch(() => {}); } catch (e) {}
  }

  // re-render when global change data arrives + fetch real candles on selection/range change
  useEffect(() => {
    const onChanges = () => repaint();
    window.addEventListener('market:changes', onChanges);
    syncReal();
    syncChanges();
    return () => window.removeEventListener('market:changes', onChanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range]);

  /* interactions --------------------------------------------------------- */
  const addSym = (s: string) => {
    if (!selected.some(x => x.sym === s && x.metric === sugMetric)) {
      realSettled.current.delete(realKey(s, range));
      setSelected(prev => [...prev, { sym: s, metric: sugMetric, color: PALETTE[prev.length % PALETTE.length] }]);
      setSuggestions(prev => prev.filter(x => x !== s));
      // syncReal/syncChanges fire via the [selected,range] effect
    }
  };
  const removeIdx = (i: number) => {
    const removed = selected[i];
    const next = selected.slice();
    next.splice(i, 1);
    // re-color remaining so palette stays consistent
    next.forEach((s, k) => { s.color = PALETTE[k % PALETTE.length]; });
    setSelected(next);
    if (removed && !suggestions.includes(removed.sym) && removed.sym !== sym) {
      setSuggestions(prev => [removed.sym, ...prev]);
    }
  };
  const resetPreset = () => {
    const p = presetFor(sym);
    p.series.forEach((s) => realSettled.current.delete(realKey(s.sym, range)));
    setSelected(p.series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] })));
    setSuggestions(p.suggestions.slice());
    setSugMetric(p.sugMetric);
  };

  /* crosshair tooltip across all series ---------------------------------- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const cxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cd = chartData();
  const pointsRef = useRef<CxPoint[]>([]);
  pointsRef.current = cd ? cd.points : [];

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const cw = wrapRef.current;
    const pts = pointsRef.current;
    if (!cw || !pts.length) return;
    const cx = cxRef.current, line = lineRef.current, tip = tipRef.current;
    if (!cx || !line || !tip) return;
    const r = cw.getBoundingClientRect();
    const rel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.min(pts.length - 1, Math.max(0, Math.round(rel * (pts.length - 1))));
    const p = pts[i];
    cx.hidden = false;
    line.style.left = (p.fx * 100) + '%';
    tip.innerHTML = `<div class="cmp-cx-date">${escapeHtml(p.l)}</div>${p.rows.map(rw => `<div class="cmp-cx-row"><span class="cmp-cx-tk"><i style="background:${rw.c}"></i>${escapeHtml(rw.tk)}</span><span class="cmp-cx-v">${escapeHtml(rw.v)}</span></div>`).join('')}`;
    const tw = tip.offsetWidth || 150;
    let lx = p.fx * r.width + 14;
    if (lx + tw > r.width) lx = p.fx * r.width - tw - 14;
    tip.style.left = lx + 'px';
  };
  const onLeave = () => { if (cxRef.current) cxRef.current.hidden = true; };

  // Suppress numeric overlays while the live request is unresolved.
  const busy = !ready || seededFor.current !== sym || loadingReal || realPending();
  const labels = busy ? [] : valueLabels();
  const yRows = busy ? [] : yAxisRows();
  const groups = seriesTableGroups();
  const axisLabels = selected
    .map((s) => realLabels.current.get(realKey(s.sym, range)))
    .find((xs) => xs && xs.length > 1) || [];
  const xTicks = axisLabels.length
    ? Array.from({ length: Math.min(6, axisLabels.length) }, (_, i) => axisLabels[Math.round(i * (axisLabels.length - 1) / (Math.min(6, axisLabels.length) - 1))])
    : [];

  return (
    <div className="app-chrome">
      <div className="cmp brand-vignette" style={{ ['--tint' as any]: `rgba(${tintOf(t.color)},0.12)` }}>
        <header className="cmp-top">
          <a className="icon-btn" href={`#/stock/${sym}`}><Icon name="back" size={18} /></a>
          <span className="cmp-top__title">Graph comparison</span>
        </header>

        <div className="cmp-grid">
          {/* LEFT: graph selection */}
          <aside className="cmp-side">
            <h2 className="cmp-side__h">Graph selection</h2>
            <div className="cmp-card">
              <div className="cmp-card__head"><span>Compare graphs</span><button className="cmp-mini" aria-label="Reset live comparison" title="Reset live comparison" onClick={resetPreset}><Icon name="refresh" size={13} /></button></div>
              <div className="cmp-chips">
                {selected.map((s, i) => (
                  <div key={i} className="cmp-chip" style={{ ['--c' as any]: s.color }}>
                    <span className="cmp-chip__dot"></span>
                    <span className="cmp-chip__lbl"><b>{s.sym}</b> {s.metric}</span>
                    <button className="cmp-chip__x" aria-label="Remove" onClick={(e) => { e.preventDefault(); removeIdx(i); }}><Icon name="close" size={12} /></button>
                  </div>
                ))}
                {ready && !selected.length ? <div className="muted" style={{ fontSize: 12 }}>No live comparison series available.</div> : null}
              </div>
            </div>
            <div className="cmp-sug-head">Comparison suggestions</div>
            <div className="cmp-sugs">
              {suggestions.map((sg) => (
                <button key={sg} className="cmp-sug" onClick={() => addSym(sg)}>
                  <span className="cmp-sug__dot"></span>
                  <span className="cmp-sug__lbl"><b>{sg}</b> {sugMetric}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* CENTER: chart */}
          <section className="cmp-main">
            <div className="cmp-toolbar">
              <div className="cmp-ranges">
                {RANGES.map(r => (
                  <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
            </div>
            <div className="cmp-plot">
              <div className="cmp-yaxis">
                {busy
                  ? [12, 34, 56, 78, 92].map((topPct, i) => (
                      <div key={i} className="cmp-yrow" style={{ top: topPct + '%' }}><Skeleton w={40} h={10} /></div>
                    ))
                  : yRows.map((row, i) => (
                      <div key={i} className="cmp-yrow" style={{ top: row.topPct + '%' }}><span>{row.lbl}</span></div>
                    ))}
              </div>
              {busy ? (
                <div className="cmp-chart-wrap">
                  <PanelLoader label="Loading live series…" fill />
                </div>
              ) : cd ? (
                <div className="cmp-chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={onLeave}>
                  <SvgChart html={cd.svg} />
                  {labels.map((l, i) => (
                    <div key={i} className="cmp-vlabel" style={{ ['--c' as any]: l.color, top: l.topPct + '%' }}>
                      <span className="cmp-vlabel__tk">{l.tk}</span> {l.val}
                    </div>
                  ))}
                  <div className="cmp-cx" ref={cxRef} hidden>
                    <div className="cmp-cx-line" ref={lineRef}></div>
                    <div className="cmp-cx-tip" ref={tipRef}></div>
                  </div>
                </div>
              ) : (
                <div className="cmp-empty">{selected.length ? 'Live series unavailable for this range.' : 'Add a graph to begin comparing.'}</div>
              )}
            </div>
            <div className="cmp-xaxis">
              {busy
                ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} w={64} h={10} />)
                : xTicks.map((d, i) => <span key={i}>{d}</span>)}
            </div>
          </section>
        </div>

        {/* BOTTOM: graph series table */}
        <section className="cmp-series">
          <div className="cmp-series__head">
            <span>Graph series</span>
            <label className="cmp-toggle"><span>Prices</span><span className="cmp-switch on"></span><span className="cmp-toggle__r">As of &amp; growth timeframes</span></label>
          </div>
          <div className="cmp-gs-table">
            <div className="cmp-gs-colhead">
              <span></span><span></span>
              <span>Minimum</span><span>Average</span><span>Maximum</span>
              <span>Selected graph</span><span>24h change</span><span></span>
            </div>
            {groups.map((g) => (
              <div key={g.sym}>
                <div className="cmp-gs-group"><span className="cmp-gs-tk">{g.sym}</span><span className="cmp-gs-co">{g.name}</span></div>
                {g.rows.map((row) => (
                  <div key={row.idx} className="cmp-gs-row">
                    <span className="cmp-gs-name"><i style={{ background: row.color }}></i>{busy ? <SkeletonValue w={64} /> : row.label}</span>
                    <span className="cmp-gs-metric"><span>Normalized growth</span></span>
                    {busy ? (
                      <>
                        <span className="cmp-gs-num"><SkeletonValue w={52} /></span>
                        <span className="cmp-gs-num"><SkeletonValue w={52} /></span>
                        <span className="cmp-gs-num"><SkeletonValue w={52} /></span>
                        <span className="cmp-gs-spark"><Skeleton w={70} h={22} /></span>
                        <span className="cmp-gs-pct"><SkeletonValue w={48} /></span>
                      </>
                    ) : (
                      <>
                        <span className="cmp-gs-num">{row.mn} <Icon name="chevDown" size={11} /></span>
                        <span className="cmp-gs-num">{row.avg}</span>
                        <span className="cmp-gs-num">{row.mx} {row.spark ? <span dangerouslySetInnerHTML={{ __html: arrowUp() }} /> : null}</span>
                        <span className="cmp-gs-spark" dangerouslySetInnerHTML={{ __html: row.spark }} />
                        {row.chgPct == null
                          ? <span className="cmp-gs-pct muted">—</span>
                          : <span className={'pill ' + (row.up ? 'up' : 'down') + ' cmp-gs-pct'}>{fmtPct(row.chgPct)}</span>}
                      </>
                    )}
                    <button className="cmp-gs-x" onClick={() => removeIdx(row.idx)}><Icon name="close" size={12} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* floating chart-tool toolbar */}
        <div className="cmp-tools">
          {['home', 'chart', 'list', 'sliders', 'doc', 'bookmark', 'analyze'].map((ic, i) => (
            <button key={ic} className={'cmp-tool ' + (i === 1 ? 'on' : '')}><Icon name={ic} size={15} /></button>
          ))}
          <span className="cmp-tools__sep"></span>
          <button className="cmp-tool cmp-tool-search" onClick={() => import('./command.js').then(m => m.openCommandPalette())}><Icon name="search" size={15} /></button>
        </div>
      </div>
    </div>
  );
}
