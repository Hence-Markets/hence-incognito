/* =========================================================
   Hence webapp — Portfolio screen (Watchlist + Holdings + Saved)
   Route: #/watchlist
   Now fully per-user: rows come from the real watchlist (useWatchlist), Holdings is
   the shared live-Hyperliquid <HoldingsView/>, earnings are real (fmp.earningsCalendar),
   and the eye toggle drives which symbols are graphed in "Watchlist vs markets".
   ========================================================= */
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/portfolio.css';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { SvgChart } from '../components/SvgChart';
import { SectionTabs } from '../components/Segmented';
import { PortfolioView } from './Portfolio';
import { fmtPct, cls, icon, toast } from '../lib/ui.js';
import { getTicker } from '../lib/data.js';
import { multiLine } from '../lib/charts.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import * as stash from '../lib/stash';
import { useMarketReady } from '../hooks/useMarket';
import { useWatchlist } from '../hooks/useWatchlist';
import { Skeleton, PanelLoader } from '../components/Loading';
import { customLists, createList, deleteList, addToList, removeFromList, type WatchList } from '../lib/watch';
import { setDockOccupant, clearDockOccupant } from '../lib/dockSlot';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';
// @ts-ignore — JS module
import { safeHttpUrl } from '../lib/safe-html.js';

const RANGES = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '10Y'];
const RANGE_LABEL: Record<string, string> = { '1D': '1-day', '1W': '1-week', '1M': '1-month', '3M': '3-month', YTD: 'YTD', '1Y': '1-year', '10Y': '10-year' };

/* an asset is "real" when Hydromancer has loaded live data for it */
function isReal(sym: string) {
  try { return market.isReady() && !!(getTicker(sym) as any).real; } catch { return false; }
}
const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);

/* ===================================================================== */
/*  SCREEN                                                                */
/* ===================================================================== */
export default function Watchlist() {
  const mktReady = useMarketReady();   // re-run the data effects when the universe finishes loading
  const { symbols, remove } = useWatchlist();

  // arriving via #/portfolio lands on the Portfolio tab (route remounts per pathname)
  const [tab, setTab] = useState<'Portfolio' | 'Watchlist' | 'Saved'>(
    () => (location.hash.startsWith('#/portfolio') ? 'Portfolio' : 'Watchlist'));
  const [saved, setSaved] = useState<stash.StashItem[]>(() => stash.saves());
  // dock/palette clicks between #/portfolio and #/watchlist don't remount (same screen,
  // and replaceState from onTab leaves the router unaware) — sync the tab from the hash.
  // Watchlist-hash only overrides the Portfolio tab so it never yanks the user off Saved.
  useEffect(() => {
    const sync = () => setTab(t =>
      location.hash.startsWith('#/portfolio') ? 'Portfolio'
        : location.hash.startsWith('#/watchlist') && t === 'Portfolio' ? 'Watchlist' : t);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const [range, setRange] = useState('3M');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);      // inline "New section" input visible
  const [sortByRet, setSortByRet] = useState(false);
  // eye-on symbols → included in the "Watchlist vs markets" chart. Default: none (S&P only).
  const [graphed, setGraphed] = useState<Set<string>>(() => new Set());

  // register the "Watchlist" command scope so the dock menu surfaces view/sort/section commands.
  useEffect(() => {
    const scope = {
      id: 'watchlist', label: 'Watchlist', icon: 'bookmark', placeholder: 'Search commands',
      groups: [
        { title: 'View', radio: true, items: (['Portfolio', 'Watchlist', 'Saved'] as const).map((v) => ({
          label: v, icon: v === 'Portfolio' ? 'chart' : v === 'Saved' ? 'book' : 'bookmark',
          checked: tab === v, run: () => { setTab(v); setSelected(new Set()); setCreating(false); if (v === 'Saved') setSaved(stash.saves()); },
        })) },
        { title: 'Sort', radio: true, items: [
          { label: 'Sort by return', icon: 'chart', checked: sortByRet, run: () => setSortByRet(true) },
          { label: 'Sort by name', icon: 'list', checked: !sortByRet, run: () => setSortByRet(false) },
        ] },
        { title: 'Section', items: [
          { label: 'New watchlist section', icon: 'plus', run: () => { setTab('Watchlist'); setCreating(true); } },
        ] },
      ],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
  }, [tab, sortByRet]);

  // custom lists (sections) — reactive to hence:watch
  const [lists, setLists] = useState<WatchList[]>(() => customLists());
  useEffect(() => {
    const on = () => { setLists(customLists()); };
    window.addEventListener('hence:watch', on);
    return () => window.removeEventListener('hence:watch', on);
  }, []);

  // the keyboard "[ ]" timeframe cyclers (dispatched globally in App) step the return
  // range AND flash a transient range TOGGLE into the dock slot — a Fey micro-interaction
  // that surfaces the control without permanently evicting the nav pill.
  const cycleTimer = useRef<number>();
  const cycleToken = useRef<number>();
  useEffect(() => {
    const showRangeToggle = (val: string) => {
      window.clearTimeout(cycleTimer.current);
      cycleToken.current = setDockOccupant({
        kind: 'toggle', lead: 'Returns', value: val,
        options: RANGES.map((r) => ({ key: r, label: r })),
        onChange: (k) => { setRange(k); showRangeToggle(k); },
      });
      cycleTimer.current = window.setTimeout(() => clearDockOccupant(cycleToken.current), 2600);
    };
    const on = (e: Event) => {
      const dir = (e as CustomEvent).detail === -1 ? -1 : 1;
      const cur = rangeRef.current;
      const i = RANGES.indexOf(cur);
      const next = RANGES[i < 0 ? 0 : (i + dir + RANGES.length) % RANGES.length];
      setRange(next);
      if (selRef.current.size === 0) showRangeToggle(next);   // don't clobber the multiselect bar
    };
    window.addEventListener('hence:cyclerange', on);
    return () => { window.removeEventListener('hence:cyclerange', on); window.clearTimeout(cycleTimer.current); };
  }, []);

  // live per-row returns keyed by `${sym}|${range}` → { chg, pct }
  const [liveRet, setLiveRet] = useState<Record<string, { chg: number; pct: number }>>({});
  const [retSettled, setRetSettled] = useState(false);   // range-return fetch window closed
  // real "vs markets" chart svg string
  const [vsHtml, setVsHtml] = useState<string | null>(null);
  const [vsSettled, setVsSettled] = useState(false);     // vs-markets fetch settled → stop the loader even if no chart drew
  const [vsHasBenchmark, setVsHasBenchmark] = useState(false);
  // real relevant-earnings rows (next ~30d, filtered to watchlist); null = loading, [] = none
  const [earnings, setEarnings] = useState<EarnRow[] | null>(null);
  const [earningsError, setEarningsError] = useState(false);

  const newsecRef = useRef<HTMLInputElement>(null);

  /* symbols claimed by custom lists → the rest fall under "Stocks" */
  const stocksSyms = useMemo(() => {
    const claimed = new Set(lists.flatMap((l) => l.symbols));
    return symbols.filter((s) => !claimed.has(s));
  }, [symbols, lists]);

  /* the flat, ordered list of everything visible (for chart + earnings + returns) */
  const allSyms = symbols;

  /* sections to render: custom lists first, then Stocks */
  const sections: WatchList[] = useMemo(
    () => [...lists, { name: 'Stocks', symbols: stocksSyms }],
    [lists, stocksSyms],
  );

  // populate real 24h change into TICKERS for any consumer (idempotent/cached)
  useEffect(() => {
    if (!allSyms.length) return;
    try { market.loadChanges(allSyms.map(market.coinFor)); } catch { /* non-fatal */ }
  }, [allSyms]);

  // focus the inline new-section input when it appears
  useEffect(() => { if (creating && newsecRef.current) newsecRef.current.focus(); }, [creating]);

  /* ----- async: real per-range returns from candles ----- */
  useEffect(() => {
    let alive = true;
    setRetSettled(false);
    if (!market.isReady()) return;
    const jobs = allSyms.filter(isReal).map((sym) =>
      market.chartData(sym, range).then((d: any) => {
        if (!alive || !d || !d.closes || d.closes.length < 2) return;
        const first = d.closes[0], last = d.closes[d.closes.length - 1];
        if (!first) return;
        const chg = last - first, pct = (chg / first) * 100;
        setLiveRet((prev) => ({ ...prev, [`${sym}|${range}`]: { chg, pct } }));
      }).catch(() => { /* unavailable for this range */ }),
    );
    // Once every candle fetch settles, unresolved cells become explicitly unavailable.
    Promise.allSettled(jobs).then(() => { if (alive) setRetSettled(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, allSyms, mktReady]);

  /* ----- async: real "Watchlist vs markets" chart (graphed basket vs SP500) ----- */
  useEffect(() => {
    let alive = true;
    setVsHtml(null); setVsSettled(false); setVsHasBenchmark(false);
    if (!market.isReady()) return;
    const norm = (closes: number[]) => {
      const base = closes[0];
      if (!base) return null;
      return closes.map((c) => ((c / base) - 1) * 100);
    };
    // Only explicitly graphed watchlist symbols are plotted.
    const picks = [...graphed].filter(isReal);
    if (!picks.length) { setVsSettled(true); return; }
    const basketSyms = picks;
    Promise.all([
      Promise.all(basketSyms.map((s) => market.chartData(s, range).catch(() => null))),
      market.chartData('SP500', range).catch(() => null),
    ]).then(([baskets, sp]: any[]) => {
      if (!alive) return;
      // average the normalized series of the picked symbols into one "Watchlist" line
      const normed = (baskets as any[]).map((b) => (b && b.closes && b.closes.length >= 2 ? norm(b.closes) : null)).filter(Boolean) as number[][];
      if (!normed.length) return;
      const len = Math.min(...normed.map((s) => s.length));
      const avg = Array.from({ length: len }, (_, i) => normed.reduce((a, s) => a + s[i], 0) / normed.length);
      const sSeries = sp && sp.closes && sp.closes.length >= 2 ? norm(sp.closes) : null;
      const lines: any[] = [];
      if (sSeries) {
        lines.push({ values: sSeries, color: 'rgba(255,255,255,0.20)', sw: 1.3 });
      }
      lines.push({ values: avg, color: 'rgba(232,164,74,0.95)', sw: 1.6 });
      try {
        setVsHtml(multiLine(lines, { w: 600, h: 230 }));
        setVsHasBenchmark(!!sSeries);
      } catch { /* unavailable */ }
    }).catch(() => { /* unavailable */ }).finally(() => { if (alive) setVsSettled(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, graphed, allSyms, mktReady]);

  /* ----- async: REAL relevant earnings (next ~30d), filtered to the watchlist ----- */
  useEffect(() => {
    let alive = true;
    const stocks = allSyms.filter((s) => getTicker(s)?.world === 'stocks');
    setEarningsError(false);
    if (!stocks.length) { setEarnings([]); return; }
    const from = new Date();
    const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    setEarnings(null);
    fmp.earningsCalendar(yyyymmdd(from), yyyymmdd(to)).then((rows: any[]) => {
      if (!alive) return;
      const set = new Set(stocks.map((s) => s.toUpperCase()));
      const seen = new Set<string>();
      const out: EarnRow[] = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.symbol && set.has(String(r.symbol).toUpperCase()))
        .filter((r) => { const s = String(r.symbol).toUpperCase(); if (seen.has(s)) return false; seen.add(s); return true; })
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(0, 6)
        .map((r) => {
          const sym = String(r.symbol).toUpperCase();
          const est = r.epsEstimated != null ? +r.epsEstimated : null;
          const act = r.epsActual != null ? +r.epsActual : null;
          const val = act != null ? act : est;
          const beat = act != null && est != null ? act >= est : null;
          return { sym, name: getTicker(sym).name, date: fmtEarnDate(r.date, r.time), val: val != null ? val.toFixed(2) : '—', beat };
        });
      setEarnings(out);
    }).catch(() => { if (alive) { setEarnings([]); setEarningsError(true); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSyms]);

  /* ---------------- interactions ---------------- */
  const onTab = (t: 'Portfolio' | 'Watchlist' | 'Saved') => {
    setTab(t);
    setSelected(new Set());
    setCreating(false);
    if (t === 'Saved') setSaved(stash.saves());
    // keep the URL meaningful without remounting (replaceState fires no hashchange)
    const want = t === 'Portfolio' ? '#/portfolio' : '#/watchlist';
    if (!location.hash.startsWith(want)) try { history.replaceState(null, '', want); } catch { /* sandboxed */ }
  };

  const removeSaved = (id: string) => { stash.remove(id); setSaved(stash.saves()); };
  const savedTime = (ts: number) => {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return m + 'm';
    if (m < 1440) return Math.round(m / 60) + 'h';
    return Math.round(m / 1440) + 'd';
  };

  const toggleSel = (s: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  };
  const toggleGraph = (s: string) => {
    setGraphed((prev) => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  };

  /* create/append a named section (real, persisted). Handles: no selection → create an empty
     section; existing name → append the selected symbols; new name → create with the selection. */
  const moveSelectedTo = (name: string) => {
    const nm = name.trim();
    if (!nm) return;
    const sel = [...selected];
    const exists = customLists().some((l) => l.name.toLowerCase() === nm.toLowerCase());
    if (exists) {
      sel.forEach((s) => addToList(nm, s));
      toast(sel.length ? `Added ${sel.length} to ${nm}` : `Section “${nm}” already exists`, { icon: 'check' });
    } else {
      createList(nm, sel);   // empty [] is fine — the section renders an "Add stocks" placeholder
      toast(sel.length ? `Moved ${sel.length} to ${nm}` : `Section “${nm}” created`, { icon: 'check' });
    }
    setSelected(new Set());
    setCreating(false);
  };

  const onBulk = (k: string) => {
    if (k === 'move') {
      setCreating(true);
    } else if (k === 'delete') {
      const syms = [...selected];
      const num = syms.length;
      const lists = customLists();
      // remove from the flat/server list AND from every custom section it appears in
      syms.forEach((s) => { remove(s); lists.forEach((l) => { if (l.symbols.includes(s)) removeFromList(l.name, s); }); });
      setSelected(new Set());
      toast(`${num} ${num === 1 ? 'security' : 'securities'} removed`, { icon: 'close' });
    } else if (k === 'graph') {
      setGraphed((prev) => { const next = new Set(prev); selected.forEach((s) => next.add(s)); return next; });
      setSelected(new Set());
      toast('Added to chart', { icon: 'check' });
    }
  };

  /* ----- the dock morphs into the multiselect bar while rows are selected -----
     (desktop only; the .dock-slot is display:none on mobile, where the in-page
     .pf-bulk bar takes over instead). Keyed on the selection signature so the
     occupant's action closures never go stale. */
  // live mirrors so the always-on event listeners read fresh values without re-subscribing
  const rangeRef = useRef(range); rangeRef.current = range;
  const selRef = useRef(selected); selRef.current = selected;

  const selKey = [...selected].sort().join(',');
  useEffect(() => {
    if (tab !== 'Watchlist' || selected.size === 0) { clearDockOccupant(); return; }
    const n = selected.size;
    setDockOccupant({
      kind: 'multiselect',
      count: n,
      noun: n === 1 ? 'security' : 'securities',
      onClear: () => setSelected(new Set()),
      actions: [
        { label: 'Graph selection', icon: 'chart', onClick: () => onBulk('graph') },
        { label: 'Move to section', icon: 'chevDown', onClick: () => onBulk('move') },
        { label: 'Delete', icon: 'close', danger: true, onClick: () => onBulk('delete') },
      ],
    });
    return () => clearDockOccupant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, tab]);
  // make sure the slot is released when the screen unmounts
  useEffect(() => () => clearDockOccupant(), []);

  /* ---------------- render pieces ---------------- */
  const rowReturn = (sym: string) => liveRet[`${sym}|${range}`] || null;

  const TableRow = ({ sym }: { sym: string }) => {
    const t = getTicker(sym);
    const real = isReal(sym);
    const r = rowReturn(sym);
    // the real per-range return; while it hasn't resolved for a real asset we skeleton the
    // $chg / % cells rather than flashing the 24h value mislabeled as the range return.
    const retReady = !!r;
    const checked = selected.has(sym);
    const eyed = graphed.has(sym);
    return (
      <div className={`pf-row ${checked ? 'sel' : ''}`} data-sym={sym}>
        <button className={`pf-check ${checked ? 'on' : ''}`} aria-label={`Select ${sym}`} onClick={(e) => { e.preventDefault(); toggleSel(sym); }}>{checked ? <Icon name="check" size={12} /> : null}</button>
        <span className="pf-logo"><Logo sym={sym} size={22} /><button className={'pf-eye' + (eyed ? ' on' : '')} aria-label={`Graph ${sym}`} onClick={(e) => { e.preventDefault(); toggleGraph(sym); }}><Icon name={eyed ? 'check' : 'chart'} size={11} /></button></span>
        <a className="pf-id" href={`#/stock/${sym}`}><b>{sym}</b> <span>{t.name}</span></a>
        <span className={'pf-price' + (real ? '' : ' pf-price--dim')}>{real ? market.fmtPrice(t.price) : '—'}</span>
        {real ? (retReady && r ? <>
          <span className={`pf-chg ${cls(r.chg)}`}>{money(r.chg)}</span>
          <span className={`pf-pill ${cls(r.pct)}`}>{fmtPct(r.pct)}</span>
        </> : !retSettled ? <>
          <span className="pf-chg"><Skeleton w={58} h={13} r={5} /></span>
          <span className="pf-pill"><Skeleton w={46} h={16} r={8} /></span>
        </> : <><span className="pf-chg" /><span className="pf-pill pf-pill--dim">—</span></>) : <><span className="pf-chg" /><span className="pf-pill pf-pill--dim">—</span></>}
      </div>
    );
  };

  // "Sort by return" orders only resolved returns; unavailable rows sort last.
  const retPct = (s: string) => liveRet[`${s}|${range}`]?.pct;
  const orderSyms = (syms: string[]) => sortByRet
    ? syms.slice().sort((a, b) => (retPct(b) ?? -Infinity) - (retPct(a) ?? -Infinity))
    : syms.slice().sort((a, b) => String(getTicker(a).name || a).localeCompare(String(getTicker(b).name || b)));

  const tableBody = () => sections.map((sec) => (
    <div key={sec.name}>
      <div className="pf-sec-cap">
        <span>{sec.name}</span>
        {sec.name !== 'Stocks' ? <button className="pf-sec-x" aria-label={`Delete ${sec.name}`} onClick={() => deleteList(sec.name)}><Icon name="close" size={12} /></button> : null}
      </div>
      {sec.symbols.length
        ? orderSyms(sec.symbols).map((s) => <TableRow key={s} sym={s} />)
        : <div className="pf-add-ph"><Icon name="bookmark" size={13} /><span>Add stocks</span></div>}
    </div>
  ));

  /* ----- LEFT column ----- */
  const leftCol = (
    <div className="pf-left" data-sec="insights">
      <div className="pf-card pf-chart-card">
        <div className="pf-card-h"><h3>Watchlist vs markets</h3></div>
        <div className="pf-chart-wrap">
          {/* real candles → the chart; until they land show a brand loader (not a fake random-walk).
             genuinely-empty (market ready, nothing real to plot) → a hint, not a perpetual spinner. */}
          {vsHtml ? (
            <>
              <SvgChart html={vsHtml} className="pf-live-vs" />
            </>
          ) : (vsSettled || (market.isReady() && !allSyms.some(isReal))) ? (
            <div className="pf-earn-empty pf-live-vs">
              {[...graphed].some(isReal)
                ? 'Chart unavailable for this range.'
                : allSyms.some(isReal)
                  ? 'Tap the graph icon on a row to compare it with the S&P 500.'
                  : 'Add a live stock to compare it with the S&P 500.'}
            </div>
          ) : (
            <PanelLoader label="Loading chart…" fill className="pf-live-vs" />
          )}
        </div>
        <div className="pf-legend">
          {vsHasBenchmark
            ? <span className="pf-leg-sp"><i></i>S&amp;P 500</span>
            : <span className="pf-leg-add">S&amp;P 500 unavailable</span>}
          {[...graphed].some(isReal)
            ? <span className="pf-leg-wl"><i></i>Watchlist</span>
            : <span className="pf-leg-add"><Icon name="chart" size={12} /> Tap the graph icon on a row to plot it</span>}
        </div>
      </div>
      <div className="pf-card pf-earn-card">
        <div className="pf-card-h"><span className="pf-cap">Relevant earnings</span><button className="pf-mini-btn"><Icon name="calendar" size={14} /></button></div>
        {earnings === null ? (
          Array.from({ length: 3 }, (_, i) => (
            <div className="pf-earn-row" key={`sk-${i}`}>
              <span className="pf-earn-id"><Skeleton w={120} h={13} r={5} /></span>
              <span className="pf-earn-date"><Skeleton w={54} h={11} r={5} /></span>
              <span className="pf-earn-val"><Skeleton w={34} h={11} r={5} /></span>
              <span className="pf-earn-chip"><Skeleton w={30} h={14} r={7} /></span>
            </div>
          ))
        ) : earningsError ? (
          <div className="pf-earn-empty">Upcoming earnings are unavailable right now.</div>
        ) : earnings.length ? earnings.map((e) => (
          <div className="pf-earn-row" key={e.sym}>
            <span className="pf-earn-id"><b>{e.sym}</b> <small>{e.name}</small></span>
            <span className="pf-earn-date">{e.date}</span>
            <span className="pf-earn-val">{e.val}</span>
            <span className={`pf-earn-chip ${e.beat ? 'beat' : ''}`}>{e.beat === true ? 'Beat' : e.beat === false ? 'Miss' : 'Est.'}</span>
          </div>
        )) : (
          <div className="pf-earn-empty">No upcoming earnings for your watchlist in the next 30 days.</div>
        )}
      </div>
    </div>
  );

  /* ----- RIGHT column ----- */
  const rightCol = (
    <div className="pf-right is-active" data-sec="watchlists">
      {creating ? (
        <div className="pf-newsec">
          <input className="pf-newsec-in" type="text" placeholder="New section" ref={newsecRef}
            onKeyDown={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (e.key === 'Enter' && v) moveSelectedTo(v);
              if (e.key === 'Escape') setCreating(false);
            }} />
          <button className="pf-newsec-cancel" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      ) : (
        <div className="pf-right-h">
          <h3>Your watchlists</h3>
          <div className="pf-right-tools">
            <div className="pf-ranges">
              {RANGES.map((rg) => (
                <button key={rg} className={rg === range ? 'on' : ''} onClick={() => setRange(rg)}>{rg}</button>
              ))}
            </div>
            <div className="pf-tool-grp">
              {/* real-user report: '+' promised "Add symbol" but opened the NEW SECTION form,
                  and the sliders icon read as settings. + now actually adds symbols (the ⌘K
                  search watches/unwatches in place); sections get their own labeled button. */}
              <button className="pf-tool" title="Add symbols (search)" onClick={() => window.dispatchEvent(new CustomEvent('hence:cmdk'))}><Icon name="plus" size={15} /></button>
              <button className="pf-tool" title="New section" onClick={() => setCreating(true)}><Icon name="doc" size={14} /></button>
              <button className={'pf-tool' + (sortByRet ? ' on' : '')} title="Sort by returns" onClick={() => setSortByRet((v) => !v)}><Icon name="chart" size={15} /></button>
            </div>
          </div>
        </div>
      )}
      <div className="pf-thead"><span>Stocks</span><span className="pf-th-price">Price</span><span className="pf-th-ret">{RANGE_LABEL[range]} returns</span></div>
      <div className="pf-rows">
        {allSyms.length ? tableBody() : <div className="pf-wl-empty">Your watchlist is empty. Add symbols from any market page or the ⌘K search.</div>}
      </div>
    </div>
  );

  /* ----- SAVED tab (untouched) ----- */
  const savedCol = (
    <div className="pf-saved">
      <div className="pf-saved-h"><h3>Saved</h3><span className="pf-saved-count">{saved.length} {saved.length === 1 ? 'item' : 'items'}</span></div>
      {saved.length ? (
        <div className="pf-saved-list">
          {saved.map((s) => {
            const sym = (s.symbols && s.symbols[0]) || s.symbol || '';
            const safeUrl = s.url ? safeHttpUrl(s.url) : '';
            const fav = safeUrl ? new URL(safeUrl, location.href).hostname : '';
            return (
              <div className="pf-saved-row" key={s.id}>
                <span className="pf-saved-ic">
                  {sym
                    ? <Logo sym={sym} size={22} />
                    : <img src={`/api/icon?src=fav&c=${encodeURIComponent(fav)}`} alt="" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                </span>
                {safeUrl
                  ? <a className="pf-saved-title" href={safeUrl} target="_blank" rel="noopener noreferrer">{s.title || safeUrl}</a>
                  : <a className="pf-saved-title" href={sym ? `#/stock/${sym}` : '#/'}>{s.title || sym || 'Saved item'}</a>}
                {sym ? <span className="pf-saved-sym">{sym}</span> : null}
                <span className="pf-saved-time">{savedTime(s.ts)}</span>
                <button className="pf-saved-x" aria-label="Remove" onClick={() => removeSaved(s.id)}><Icon name="close" size={13} /></button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pf-saved-empty"><Icon name="book" size={26} /><p>Nothing saved yet. Save stories, assets and setups from your home feed and they’ll show up here.</p></div>
      )}
    </div>
  );

  /* ----- floating bulk-action toolbar ----- */
  const n = selected.size;
  const bulkBar = n ? (
    <div className="pf-bulk">
      <span className="pf-bulk-count">{n} {n === 1 ? 'security' : 'securities'} selected</span>
      <button className="pf-bulk-btn" onClick={() => onBulk('graph')}>Graph selection <Icon name="chart" size={14} /></button>
      <button className="pf-bulk-btn" onClick={() => onBulk('move')}>Move to section <Icon name="chevDown" size={14} /></button>
      <button className="pf-bulk-btn danger" onClick={() => onBulk('delete')}>Delete <Icon name="bookmark" size={14} /></button>
    </div>
  ) : null;

  return (
    <Shell dockActive="portfolio">
      <div className="pf-screen">
        <header className="pf-top">
          <a className="pf-back" href="#/"><Icon name="back" size={18} /><b>Portfolio</b></a>
          <div className="pf-toggle">
            <button className={tab === 'Portfolio' ? 'on' : ''} onClick={() => onTab('Portfolio')}><Icon name="chart" size={14} /> Portfolio</button>
            <button className={tab === 'Watchlist' ? 'on' : ''} onClick={() => onTab('Watchlist')}><Icon name="bookmark" size={14} /> Watchlist</button>
            <button className={tab === 'Saved' ? 'on' : ''} onClick={() => onTab('Saved')}><Icon name="book" size={14} /> Saved</button>
          </div>
        </header>
        {tab === 'Saved' ? savedCol
          : tab === 'Portfolio' ? <div className="pf-holdings-wrap"><PortfolioView embedded /></div>
            : (
              <div className="pf-grid has-sectabs">
                <SectionTabs tabs={[{ key: 'watchlists', label: 'Watchlists' }, { key: 'insights', label: 'Insights' }]} />
                {leftCol}
                {rightCol}
              </div>
            )}
        {tab === 'Watchlist' ? bulkBar : null}
      </div>
    </Shell>
  );
}

/* ---------- helpers ---------- */
type EarnRow = { sym: string; name: string; date: string; val: string; beat: boolean | null };

function fmtEarnDate(date?: string, time?: string): string {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return date;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const t = (time || '').toLowerCase();
  const suffix = t === 'bmo' ? ' · pre-mkt' : t === 'amc' ? ' · post-mkt' : t && /^\d/.test(t) ? ` at ${time}` : '';
  return when + suffix;
}
