import { useEffect, useRef, useState } from 'react';
import '../styles/screener.css';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { keycap, fmtPct, cls, logo as logoStr, icon as iconStr } from '../lib/ui.js';
import { useMarketReady } from '../hooks/useMarket';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';
import { openCommandPalette } from './command.js';
// @ts-ignore — JS module
import * as poly from '../lib/polymarket.js';
// @ts-ignore — JS module
import { safeHttpUrl } from '../lib/safe-html.js';

/* sorts the live screener rows support (sym/name/sector/price/daily are always present) */
const SCR_SORTS: { label: string; cmp: (a: any, b: any) => number }[] = [
  { label: 'Sort by name (A–Z)', cmp: (a, b) => String(a.name || a.sym).localeCompare(String(b.name || b.sym)) },
  { label: 'Sort by ticker', cmp: (a, b) => String(a.sym).localeCompare(String(b.sym)) },
  { label: 'Sort by sector', cmp: (a, b) => String(a.sector || '').localeCompare(String(b.sector || '')) },
  { label: 'Sort by daily performance', cmp: (a, b) => (b.daily ?? -1e9) - (a.daily ?? -1e9) },
  { label: 'Sort by price', cmp: (a, b) => (b.price ?? -1) - (a.price ?? -1) },
];

/* ---------- REAL per-class filters ----------
   Types adapt to the selected class; every type opens a value picker; committed
   chips apply real predicates over the row + fundamentals data (no demo slicing). */
const FILTER_TYPES_BY_KIND: Record<string, string[]> = {
  equity: ['Sector', 'Exchange', 'Market cap', 'P/E', 'Earnings date', '24h change'],
  crypto: ['Category', 'Market cap', '24h volume', 'Funding', '24h change'],
  price: ['Category', '24h volume', 'Funding', '24h change'],
  predictions: ['Category', '24h volume', 'Ending'],
};
const CAP_BUCKETS = ['Mega — over 200B', 'Large — 10B to 200B', 'Mid — 2B to 10B', 'Small — under 2B'];
const VALUE_OPTIONS: Record<string, string[]> = {
  Exchange: ['NASDAQ', 'NYSE', 'AMEX'],
  'Market cap': CAP_BUCKETS,
  'P/E': ['Under 15', 'Under 30', 'Over 30', 'Unprofitable (no P/E)'],
  'Earnings date': ['Next 7 days', 'Next 30 days'],
  '24h volume': ['Over $1M', 'Over $10M', 'Over $100M'],
  Funding: ['Positive', 'Negative'],
  '24h change': ['Gainers', 'Losers', 'Over +5%', 'Under −5%'],
  Ending: ['Within 7 days', 'Within 30 days'],
};

/* does one row (+ its filled fundamentals) pass one committed filter? */
function passesFilter(row: any, fund: any, type: string, value: string): boolean {
  const f = fund || {};
  const capOk = (cap: number) =>
    value.startsWith('Mega') ? cap > 200e9
    : value.startsWith('Large') ? cap >= 10e9 && cap <= 200e9
    : value.startsWith('Mid') ? cap >= 2e9 && cap < 10e9
    : cap < 2e9;
  const volV = f.vol != null ? f.vol : row.vol;
  switch (type) {
    case 'Sector': return (f.sector || row.sector || '') === value;
    case 'Category': return (row.cat || '') === value;
    case 'Exchange': return String(f.exchange || '').toUpperCase().includes(value);
    case 'Market cap': return f.cap != null && capOk(Number(f.cap));
    case 'P/E': {
      const pe = f.pe != null ? Number(f.pe) : null;
      if (value.startsWith('Unprofitable')) return pe == null || !isFinite(pe) || pe <= 0;
      if (pe == null || !isFinite(pe) || pe <= 0) return false;
      return value === 'Under 15' ? pe < 15 : value === 'Under 30' ? pe < 30 : pe > 30;
    }
    case 'Earnings date': {
      if (!f.earn) return false;
      const days = Math.round((+new Date(f.earn + 'T00:00:00') - +new Date()) / 86400000);
      return days >= 0 && days <= (value.includes('7') ? 7 : 30);
    }
    case '24h volume': {
      if (volV == null) return false;
      const min = value.includes('$100M') ? 100e6 : value.includes('$10M') ? 10e6 : 1e6;
      return Number(volV) >= min;
    }
    case 'Funding': return f.funding != null && (value === 'Positive' ? f.funding >= 0 : f.funding < 0);
    case '24h change': {
      const d = row.daily != null ? Number(row.daily) : (row.yes != null ? null : null);
      if (d == null || isNaN(d)) return false;
      return value === 'Gainers' ? d >= 0 : value === 'Losers' ? d < 0 : value.startsWith('Over') ? d > 5 : d < -5;
    }
    case 'Ending': {
      if (!row.end) return false;
      const days = Math.round((+new Date(row.end) - +new Date()) / 86400000);
      return days >= 0 && days <= (value.includes('7') ? 7 : 30);
    }
    default: return true;
  }
}


const EXAMPLE_TEMPLATES = ['Recovering Technology', 'Recession Resilient', 'Recession recovery play', 'Blue chip dividends'];

/* ---------- helpers ---------- */
function fmtPrice(p: any) {
  try { return market.fmtPrice ? market.fmtPrice(p) : '$' + Number(p).toFixed(2); }
  catch (e) { return '$' + Number(p).toFixed(2); }
}

/* ---------- asset-type-aware column profiles ---------- */
const PROFILES: Record<string, any> = {
  equity: {
    grid: 'minmax(210px,1.7fr) minmax(96px,0.95fr) minmax(78px,0.8fr) minmax(56px,0.6fr) minmax(84px,0.82fr) minmax(72px,0.7fr) minmax(104px,1fr) minmax(84px,0.82fr) minmax(82px,0.8fr) minmax(92px,0.9fr)',
    cols: [
      { key: 'co', label: 'Company' }, { key: 'sector', label: 'Sector', sec: true },
      { key: 'cap', label: 'Mkt cap', num: true }, { key: 'pe', label: 'P/E', num: true },
      { key: 'ebitda', label: 'EBITDA', num: true }, { key: 'evs', label: 'EV/Sales', num: true },
      { key: 'earn', label: 'Earnings date', num: true }, { key: 'vol', label: 'Avg volume', num: true },
      { key: 'price', label: 'Price', num: true }, { key: 'daily', label: '24h', perf: true },
    ],
  },
  crypto: {
    grid: 'minmax(200px,1.7fr) minmax(100px,0.95fr) minmax(88px,0.85fr) minmax(80px,0.8fr) minmax(94px,0.92fr) minmax(98px,0.95fr) minmax(98px,0.95fr) minmax(84px,0.82fr)',
    cols: [
      { key: 'co', label: 'Asset' }, { key: 'cat', label: 'Category', sec: true },
      { key: 'price', label: 'Price', num: true }, { key: 'daily', label: '24h', perf: true },
      { key: 'cap', label: 'Market cap', num: true }, { key: 'vol', label: '24h volume', num: true },
      { key: 'oi', label: 'Open interest', num: true }, { key: 'funding', label: 'Funding', num: true },
    ],
  },
  price: {   // commodity / fx / index — bulk-servable columns (High/Low needed a per-symbol
             // candle sweep; funding/OI/volume all arrive in the ONE /api/screener/hl call)
    grid: 'minmax(200px,1.7fr) minmax(110px,1fr) minmax(94px,0.9fr) minmax(82px,0.8fr) minmax(98px,0.95fr) minmax(98px,0.95fr) minmax(90px,0.88fr)',
    cols: [
      { key: 'co', label: 'Asset' }, { key: 'cat', label: 'Category', sec: true },
      { key: 'price', label: 'Price', num: true }, { key: 'daily', label: '24h', perf: true },
      { key: 'vol', label: '24h volume', num: true }, { key: 'oi', label: 'Open interest', num: true },
      { key: 'funding', label: 'Funding', num: true },
    ],
  },
  predictions: {  // Polymarket event markets
    grid: 'minmax(300px,2.4fr) minmax(110px,1fr) minmax(86px,0.85fr) minmax(98px,0.95fr) minmax(98px,0.95fr) minmax(92px,0.9fr)',
    cols: [
      { key: 'co', label: 'Market' }, { key: 'cat', label: 'Category', sec: true },
      { key: 'yes', label: 'Yes', perf: true }, { key: 'vol', label: '24h volume', num: true },
      { key: 'liq', label: 'Liquidity', num: true }, { key: 'end', label: 'Ends', num: true },
    ],
  },
};
PROFILES.equity.kind = 'equity'; PROFILES.crypto.kind = 'crypto'; PROFILES.price.kind = 'price'; PROFILES.predictions.kind = 'predictions';
const profileFor = (klass: string) => PROFILES[klass === 'equity' ? 'equity' : klass === 'crypto' ? 'crypto' : klass === 'predictions' ? 'predictions' : 'price'];
const CLASS_TABS: [string, string][] = [['crypto', 'Crypto'], ['equity', 'Stocks'], ['commodity', 'Commodities'], ['fx', 'FX'], ['index', 'Indices'], ['predictions', 'Predictions']];

function availableClasses(): string[] {
  if (!market.isReady || !market.isReady()) return ['equity', 'predictions'];
  try {
    const present = new Set(market.getUniverse().map((a: any) => market.assetClass(a.sym)));
    present.add('predictions');            // event markets come from Polymarket, not the perp universe
    const list = CLASS_TABS.map((c) => c[0]).filter((k) => present.has(k));
    return list.length ? list : ['equity', 'predictions'];
  } catch (e) { return ['equity', 'predictions']; }
}

/* Polymarket rows for the Predictions class (module cache; one fetch per session, 60s server cache) */
let _pred: any[] | null = null;
let _predP: Promise<any[]> | null = null;
let _predTried = false;                // a completed attempt (even empty) → show empty state, not skeleton
let _predFailed = false;
function loadPredictions(): Promise<any[]> {
  if (_pred) return Promise.resolve(_pred);
  if (_predP) return _predP;
  _predP = poly.markets(48).then((ms: any[]) => {
    const rows = (ms || []).map((m: any) => ({
      sym: 'pm-' + m.id, id: m.id, icon: m.icon || '', name: m.question, cat: m.category || 'Other',
      yes: m.yes, vol: m.volume24hr, liq: m.liquidity, end: m.endDate, price: null, daily: null,
    }));
    if (rows.length) _pred = rows;   // only cache a REAL result — a transient failure must retry
    _predTried = true;
    _predFailed = false;
    return rows;
  }).catch(() => { _predTried = true; _predFailed = true; return []; }).finally(() => { _predP = null; });   // clear inflight so a failure re-fetches
  return _predP;
}

/* live universe rows for one asset class */
function rowsForClass(klass: string): any[] | null {
  // predictions: cached rows → them; a completed-but-empty attempt → [] (empty state); else null (skeleton)
  if (klass === 'predictions') return _pred != null ? _pred : (_predTried ? [] : null);
  if (!market.isReady || !market.isReady()) return null;
  try {
    const uni = market.getUniverse().filter((a: any) => market.assetClass(a.sym) === klass);
    return uni.slice(0, klass === 'equity' ? 36 : 28).map((a: any) => {
      const t = getTicker(a.sym) || {};
      return {
        sym: a.sym, name: a.name, cat: a.cat,
        // Sector is supplied by the real equity fundamentals response, never the
        // universe's generic "Equities" category placeholder.
        sector: klass === 'equity' ? undefined : a.cat,
        price: (t.real && t.price != null ? Number(t.price) : null),
        daily: (t.real && t.chgPct != null ? Number(t.chgPct) : null),
      };
    });
  } catch (e) { return null; }
}

/* fundamentals per symbol, filled by the aggregated endpoints — module-scoped so the values
   survive remounts AND back real filtering (was: values lived only in patched DOM cells) */
const FUND: Record<string, any> = {};
/* merge only DEFINED fields — a failed/partial aggregate response must never overwrite
   previously-good values with undefined */
function mergeFund(sym: string, obj: Record<string, any>) {
  const cur = FUND[sym] || (FUND[sym] = {});
  for (const k in obj) if (obj[k] !== undefined) cur[k] = obj[k];
}
/* compact count (avg volume): 269M / 88.7M / 8.1M — no leading $ */
function fmtCount(v: any) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}

/* "Tmrw, 5:00 AM"-style screener earnings label from a YYYY-MM-DD date string */
function fmtEarnDate(dateStr: string) {
  if (!dateStr) return null;
  const d: any = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  const today: any = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tmrw';
  if (diff === -1) return 'Yesterday';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

/* raw shimmer pill for a not-yet-loaded cell (styles/loading.css, globally imported) */
function skelPill(w = 46) {
  return `<span class="skeleton skeleton--inline" style="width:${w}px"></span>`;
}
/* fundamentals columns that arrive later via fillFundamentals() DOM-patching — for
   live rows these have no value on first paint, so render a shimmer (not a bare —)
   until patchCell() swaps in the real value (or clearPendingSkeletons() → —). */
const PENDING_KEYS: Record<string, string> = {
  sector: '64', cap: '58', pe: '40', ebitda: '54', evs: '44', earn: '72', vol: '54',
  oi: '58', funding: '48', liq: '58', end: '52',
};

/* ---------- cell / row rendering (HTML strings, matching vanilla DOM) ---------- */
const escH = (s: any) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/* kind-aware fundamentals formatting (values come RAW from FUND / prediction rows) */
function fmtFund(kind: string, key: string, v: any, row: any): { html: string; cls?: string } | null {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return null;
  switch (key) {
    case 'cap': case 'ebitda': case 'oi': case 'liq': return { html: market.fmtUsd(v) };
    case 'vol': return { html: kind === 'equity' ? fmtCount(v) : market.fmtUsd(v) };
    case 'pe': case 'evs': return { html: Number(v).toFixed(2) };
    case 'earn': { const l = fmtEarnDate(v); return l ? { html: l } : null; }
    case 'funding': return { html: (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%', cls: cls(v) };
    case 'sector': return { html: escH(v) };
    case 'end': { const d: any = new Date(v); if (isNaN(d)) return null; const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return { html: `${MON[d.getMonth()]} ${d.getDate()}` }; }
    default: return { html: escH(v) };
  }
}

function cellHTML(c: any, row: any, kind: string, filled: boolean) {
  if (c.key === 'co') {
    if (kind === 'predictions') {
      const iconUrl = safeHttpUrl(row.icon);
      return `<span class="scr-co">${iconUrl ? `<img class="scr-pm-ic" src="${escH(iconUrl)}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : '<span class="scr-pm-ic scr-pm-ic--ph">◆</span>'}<span class="scr-nm scr-pm-q">${escH(row.name)}</span></span>`;
    }
    return `<span class="scr-co">${logoStr(row.sym, 22)}<b class="scr-tk">${escH(row.sym)}</b><span class="scr-nm">${escH(row.name || row.sym)}</span></span>`;
  }
  if (c.perf) {
    if (c.key === 'yes') {
      const y = row.yes;
      return `<span class="scr-perf">${(y == null || isNaN(y)) ? '<span class="scr-na">—</span>' : `<span class="scr-pill ${y >= 0.5 ? 'up' : 'down'}">${Math.round(y * 100)}% Yes</span>`}</span>`;
    }
    const v = row.daily;
    return `<span class="scr-perf" data-cell="daily">${(v == null || isNaN(v)) ? '<span class="scr-na">—</span>' : `<span class="scr-pill ${cls(v)}">${fmtPct(v)}</span>`}</span>`;
  }
  if (c.key === 'price') {
    const val = (row.price != null && !isNaN(row.price)) ? fmtPrice(row.price) : '—';
    return `<span class="scr-num${val === '—' ? ' scr-na' : ''}" data-cell="price">${val}</span>`;
  }
  // fundamentals: the row's own value (predictions) else the aggregate-filled FUND value.
  // Sector is special: equity rows carry a.cat ('Equities') as a placeholder, but the REAL
  // value is the FMP industry from FUND — prefer it so the column matches what the filter uses.
  const raw = c.key === 'sector'
    ? ((FUND[row.sym] || {}).sector ?? row.sector)
    : (row[c.key] != null ? row[c.key] : (FUND[row.sym] || {})[c.key]);
  const f = fmtFund(kind, c.key, raw, row);
  if (f) return `<span class="${c.sec ? 'scr-sec' : 'scr-num'}${f.cls ? ' ' + f.cls : ''}" data-cell="${c.key}">${f.html}</span>`;
  // no value yet: shimmer while the aggregate is inflight, — once it settled without one
  if (!filled && PENDING_KEYS[c.key]) {
    return `<span class="scr-num scr-pending" data-cell="${c.key}">${skelPill(Number(PENDING_KEYS[c.key]))}</span>`;
  }
  return `<span class="${c.sec ? 'scr-sec' : 'scr-num'} scr-na" data-cell="${c.key}">—</span>`;
}

/* ---------- skeleton table (first-load, before market.isReady()) ---------- */
function skelRowHTML(profile: any) {
  const cells = profile.cols.map((c: any) => {
    if (c.key === 'co') {
      return `<span class="scr-co"><span class="skeleton" style="width:22px;height:22px;border-radius:6px"></span><span class="skeleton" style="width:44px;height:12px;border-radius:5px;margin-left:2px"></span><span class="skeleton" style="width:96px;height:11px;border-radius:5px"></span></span>`;
    }
    if (c.perf) return `<span class="scr-perf">${skelPill(48)}</span>`;
    if (c.sec) return `<span class="scr-sec">${skelPill(64)}</span>`;
    return `<span class="scr-num">${skelPill(52)}</span>`;
  }).join('');
  return `<span class="scr-row scr-row--skel" style="grid-template-columns:${profile.grid}">${cells}</span>`;
}
function skelTableHTML(profile: any, count = 14) {
  return `<div class="scr-table" aria-busy="true">
    <div class="scr-head" style="grid-template-columns:${profile.grid}">
      ${profile.cols.map((c: any) => `<span class="${c.key === 'co' ? 'scr-co' : c.perf ? 'scr-perf' : c.sec ? 'scr-sec' : 'scr-num'}">${c.key === 'co' ? 'Company' : c.label}</span>`).join('')}
    </div>
    <div class="scr-body">${Array.from({ length: count }, () => skelRowHTML(profile)).join('')}</div>
  </div>`;
}
function rowHTML(row: any, profile: any, filled = false) {
  const href = profile.kind === 'predictions' ? `#/terminal/m/${escH(row.id)}` : `#/stock/${escH(row.sym)}`;
  return `<a class="scr-row" href="${href}" data-row="${escH(row.sym)}" style="grid-template-columns:${profile.grid}">
    ${profile.cols.map((c: any) => cellHTML(c, row, profile.kind, filled)).join('')}
  </a>`;
}
function tableInnerHTML(rows: any[], profile: any, filled = false) {
  return `<div class="scr-table">
    <div class="scr-head" style="grid-template-columns:${profile.grid}">
      ${profile.cols.map((c: any) => `<span class="${c.key === 'co' ? 'scr-co' : c.perf ? 'scr-perf' : c.sec ? 'scr-sec' : 'scr-num'}">${c.key === 'co' ? `${c.label} <span class="scr-count">${rows.length}</span>` : c.label}</span>`).join('')}
    </div>
    <div class="scr-body">${rows.map((r) => rowHTML(r, profile, filled)).join('')}</div>
  </div>
  <div class="scr-copyright">Live market data from connected providers.</div>`;
}

export default function Screener() {
  const ready = useMarketReady();

  /* state */
  const [filters, setFilters] = useState<{ type: string; value: string | null }[]>([]);
  const [popover, setPopover] = useState<string | null>(null); // 'add' | 'value' | 'templates' | 'save'
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [klass, setKlass] = useState('crypto');
  const [sortIdx, setSortIdx] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);

  // register the "Screener" command scope so the dock menu surfaces the Sort commands with a
  // scope chip (Fey pattern). Re-registers on sortIdx so the active sort shows a check.
  useEffect(() => {
    const scope = {
      id: 'screener', label: 'Screener', icon: 'sliders', placeholder: 'Search commands', radio: true,
      groups: [{ title: 'Sort', items: SCR_SORTS.map((s, i) => ({ label: s.label, icon: 'sliders', checked: i === sortIdx, run: () => setSortIdx(i) })) }],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
  }, [sortIdx]);

  /* effective class — fall back to first available when current is missing */
  let effKlass = klass;
  if (ready && !availableClasses().includes(effKlass)) effKlass = availableClasses()[0];

  /* current rows + profile — while the universe/prices load, flag loading so the
     stage shows a skeleton table. Committed filter chips apply REAL predicates. */
  function currentRows() {
    if (!ready && effKlass !== 'predictions') return { rows: [] as any[], profile: PROFILES.equity, loading: true };
    const base = rowsForClass(effKlass);
    if (base == null) return { rows: [] as any[], profile: profileFor(effKlass), loading: true };
    let rows = base;
    for (const f of filters) {
      if (f.value == null) continue;
      rows = rows.filter((r) => passesFilter(r, FUND[r.sym], f.type, f.value as string));
    }
    if (sortIdx != null && SCR_SORTS[sortIdx]) rows = rows.slice().sort(SCR_SORTS[sortIdx].cmp);
    return { rows, profile: profileFor(effKlass), loading: false };
  }
  const { rows, profile, loading } = currentRows();

  function closePop() { setPopover(null); setPendingType(null); }

  /* ---------- aggregated fundamentals fill ----------
     Was: 5-6 HTTP calls PER ROW re-issued on every render (≈170 requests per visit, per
     user). Now: ONE /api/screener/hl for crypto/commodity/fx/index, ONE POST
     /api/screener/equity for stocks — both server-cached so every user shares one upstream
     read, kept warm by the server's background refresher. Values land in FUND (module map)
     and cells render straight from it, so re-renders never refetch. */
  const [filled, setFilled] = useState(false);
  const [, force] = useState(0);

  /* one aggregate fetch per class visit (+ a 60s live-stats refresh for perp classes) */
  useEffect(() => {
    let alive = true;
    setFilled(false);
    const run = async () => {
      try {
        if (effKlass === 'predictions') {
          await loadPredictions();
          if (alive) setFilled(true);
          return;
        }
        if (!market.isReady || !market.isReady()) return;
        const base = rowsForClass(effKlass) || [];
        const syms = base.map((r) => r.sym);
        if (!syms.length) { if (alive) setFilled(true); return; }
        if (effKlass === 'equity') {
          const pairs = syms.map((s) => ({ s, fs: (() => { try { return market.fmpSymbol(s); } catch { return s; } })() }));
          const d = await fetch('/api/screener/equity', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ syms: pairs.map((p) => p.fs) }),
          }).then((r) => r.json()).catch(() => null);
          const table = (d && d.rows) || {};
          pairs.forEach(({ s, fs }) => {
            const r = table[fs] || {};
            // merge only DEFINED values so a failed/partial response never wipes good data
            mergeFund(s, { sector: r.sector || undefined, exchange: r.exchange || undefined,
              cap: r.cap, pe: r.pe, evs: r.evs, ebitda: r.ebitda, earn: r.earnDate || undefined, vol: r.avgVol });
          });
        } else {
          const map: any = await market.bulkScreenerStats().catch(() => null) || {};
          syms.forEach((s) => {
            const h = map[market.coinFor(s)] || {};
            mergeFund(s, { vol: h.vol, oi: h.oi, funding: h.fundingApr });
          });
          if (alive) setFilled(true);
          if (effKlass === 'crypto') {
            // crypto market caps: small batched quotes (60s-cached client+server side)
            const missing = syms.filter((s) => (FUND[s] || {}).cap == null);
            for (let i = 0; i < missing.length; i += 6) {
              if (!alive) return;
              await Promise.all(missing.slice(i, i + 6).map((s) =>
                fmp.quote(market.fmpSymbol(s)).then((q: any) => { if (q && q.marketCap) FUND[s] = { ...(FUND[s] || {}), cap: q.marketCap }; }).catch(() => {})));
            }
          }
        }
      } catch (e) { /* never throw */ }
      if (alive) { setFilled(true); force((n) => n + 1); }   // repaint with the freshly-filled FUND
    };
    run();
    // perp-class live stats (funding/OI/vol) refresh once a minute — one bulk call, shared cache
    const iv = effKlass !== 'equity' && effKlass !== 'predictions'
      ? window.setInterval(() => {
          market.bulkScreenerStats().then((map: any) => {
            if (!alive || !map) return;
            (rowsForClass(effKlass) || []).forEach((r) => {
              const h = map[market.coinFor(r.sym)] || {};
              mergeFund(r.sym, { vol: h.vol, oi: h.oi, funding: h.fundingApr });
            });
            force((n) => n + 1);
          }).catch(() => {});
        }, 60_000)
      : 0;
    return () => { alive = false; if (iv) window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, effKlass]);

  /* ---------- live 24h change for the shown symbols ---------- */
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    try {
      const r = rowsForClass(effKlass);
      if (!r || !r.length) return;
      const coins = r.map((row) => market.coinFor(row.sym));
      market.loadChanges(coins).then(() => { if (alive) force((n) => n + 1); }).catch(() => {});
    } catch (e) { /* changes remain unavailable */ }
    const on = () => { if (alive) force((n) => n + 1); };
    window.addEventListener('market:changes', on as any);
    return () => { alive = false; window.removeEventListener('market:changes', on as any); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, effKlass]);

  /* Escape closes the popover */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && popover) closePop(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [popover]);

  /* ---------- handlers ---------- */
  const switchClass = (k: string) => {
    if (k === effKlass) return;
    setKlass(k);
    setFilters([]);
    setPopover(null);
  };
  const undoFilter = () => setFilters((f) => f.slice(0, -1));
  const removeChip = (i: number) => setFilters((f) => f.filter((_, idx) => idx !== i));
  const clearAll = () => setFilters([]);

  /* every filter type opens a REAL value picker; Sector/Category values come from the
     data actually on screen, the rest from curated option lists */
  const valueOptions = (t: string): string[] => {
    if (t === 'Sector') {
      const s = new Set<string>();
      (rowsForClass(effKlass) || []).forEach((r) => { const v = (FUND[r.sym] || {}).sector || r.sector; if (v) s.add(v); });
      return [...s].sort();
    }
    if (t === 'Category') {
      const s = new Set<string>();
      (rowsForClass(effKlass) || []).forEach((r) => { if (r.cat) s.add(r.cat); });
      return [...s].sort();
    }
    return VALUE_OPTIONS[t] || [];
  };
  const pickType = (t: string) => { setPendingType(t); setPopover('value'); };
  const setValue = (v: string) => {
    setFilters((f) => [...f, { type: pendingType || 'Sector', value: v }]);
    closePop();
  };
  /* outside-click closes the popover (matches vanilla's delegated check) */
  const onStageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (popover && !target.closest('[data-pop]')) closePop();
  };

  /* ---------- popover content ---------- */
  function renderPopover() {
    if (popover === 'add') {
      return (
        <div className="scr-pop scr-pop--add" data-pop>
          <div className="scr-pop-input">
            <input type="text" placeholder="Type a filter" autoFocus />
            <kbd className="keycap">S</kbd>
          </div>
          <div className="scr-pop-list">
            {(FILTER_TYPES_BY_KIND[profile.kind] || FILTER_TYPES_BY_KIND.equity).map((t, i) => (
              <button key={t} className={`scr-pop-item ${i === 0 ? 'on' : ''}`} onClick={() => pickType(t)}>{t}</button>
            ))}
          </div>
        </div>
      );
    }
    if (popover === 'value') {
      const label = (pendingType || '').toLowerCase();
      const opts = valueOptions(pendingType || '');
      return (
        <div className="scr-pop scr-pop--value" data-pop>
          <div className="scr-pop-input">
            <input type="text" placeholder={`Search ${label} values`} autoFocus />
            <kbd className="keycap">S</kbd>
          </div>
          <div className="scr-pop-list">
            {opts.length ? opts.map((x, i) => (
              <button key={x} className={`scr-pop-item ${i === 0 ? 'on' : ''}`} onClick={() => setValue(x)}>{x}</button>
            )) : <div className="scr-pop-item scr-na">No values yet — data still loading</div>}
          </div>
        </div>
      );
    }
    // (sort moved to the dock command menu — see the Screener cmdScope registration)
    if (popover === 'templates') {
      return (
        <div className="scr-pop scr-pop--tpl" data-pop>
          <div className="scr-pop-crumb"><span dangerouslySetInnerHTML={{ __html: logoStr('NVDA', 14) }} /> Screener</div>
          <div className="scr-pop-cap">Template tools</div>
          <div className="scr-pop-row scr-na">
            <span dangerouslySetInnerHTML={{ __html: iconStr('doc', 14) }} />Saving is unavailable in this build
          </div>
          <div className="scr-pop-cap">Example templates · preview</div>
          {EXAMPLE_TEMPLATES.map((t) => (
            <button key={t} className="scr-pop-row" disabled title="Preview only">
              <span dangerouslySetInnerHTML={{ __html: iconStr('doc', 14) }} />{t}
            </button>
          ))}
          <div className="scr-pop-foot scr-tpl-foot">
            <span className="scr-tpl-summary">Examples are visual previews and do not alter the screener.</span>
          </div>
        </div>
      );
    }
    return null;
  }

  /* ---------- class tabs ---------- */
  const labelOf = (k: string) => (CLASS_TABS.find((c) => c[0] === k) || [k, k])[1];
  const classList = availableClasses();

  return (
    <Shell dockActive="markets">
      <div className="scr" ref={wrapRef}>
        <div className="scr-bar">
          <div className="scr-bar-l">
            <a className="icon-btn scr-back" href="#/economy"><Icon name="back" size={18} /></a>
            <b className="scr-title">Screener</b>
            {classList.length >= 2 && (
              <div className="scr-classtabs">
                {classList.map((k) => (
                  <button key={k} className={k === effKlass ? 'on' : ''} onClick={() => switchClass(k)}>{labelOf(k)}</button>
                ))}
              </div>
            )}
            <div className="scr-chips">
              {filters.map((f, i) => (
                f.value == null ? (
                  <span className="scr-chip scr-chip--empty" key={i}>
                    <span className="scr-chip-k">{f.type}</span>
                  </span>
                ) : (
                  <span className="scr-chip" key={i}>
                    <span className="scr-chip-k">{f.type}</span>
                    <span className="scr-chip-v">{f.value}</span>
                    <button className="scr-chip-x" aria-label="Remove filter" onClick={(e) => { e.preventDefault(); removeChip(i); }}>
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                )
              ))}
              <button className="icon-btn scr-addbtn" aria-label="Add a filter" onClick={() => { setPopover('add'); setPendingType(null); }}>
                {filters.length ? <Icon name="plus" size={15} /> : <><Icon name="plus" size={14} /> <span>Add a filter</span></>}
              </button>
            </div>
          </div>
          <div className="scr-bar-r">
            <button className="icon-btn" aria-label="Remove last filter" onClick={undoFilter}><Icon name="back" size={16} /></button>
            <button className="icon-btn" aria-label="Sort" onClick={() => openCommandPalette()}><Icon name="sliders" size={16} /></button>
            <button className="icon-btn" aria-label="Templates" onClick={() => setPopover((p) => (p === 'templates' ? null : 'templates'))}><Icon name="doc" size={16} /></button>
          </div>
        </div>
        <div className="scr-stage" onClick={onStageClick}>
          {loading ? (
            <div dangerouslySetInnerHTML={{ __html: skelTableHTML(profile) }} />
          ) : rows.length ? (
            <div dangerouslySetInnerHTML={{ __html: tableInnerHTML(rows, profile, filled) }} />
          ) : (
            <ScrEmpty onClear={clearAll} unavailable={effKlass === 'predictions' && _predFailed} />
          )}
          {popover ? renderPopover() : null}
        </div>
      </div>
    </Shell>
  );
}

/* ---------- empty state ---------- */
function ScrEmpty({ onClear, unavailable = false }: { onClear: () => void; unavailable?: boolean }) {
  return (
    <>
      <div className="scr-empty">
        <h2>{unavailable ? 'Prediction markets are unavailable' : 'No matches for your selected criteria'}</h2>
        {unavailable
          ? <p>The connected market source did not return data. Try again later.</p>
          : <p>
              Try pressing <span dangerouslySetInnerHTML={{ __html: keycap('delete') }} /> to clear your latest filter, or{' '}
              <span dangerouslySetInnerHTML={{ __html: keycap('⌘') }} /> <span dangerouslySetInnerHTML={{ __html: keycap('delete') }} /> to clear all.
            </p>}
        <div className="scr-empty-ring">
          <span className="scr-empty-dot"><Icon name="compass" size={14} /></span>
          <span className="scr-empty-dot"><Icon name="list" size={14} /></span>
          <span className="scr-empty-dot"><Icon name="heart" size={14} /></span>
          <span className="scr-empty-dot mid"></span>
          <span className="scr-empty-dot"><Icon name="send" size={14} /></span>
          <span className="scr-empty-dot"><Icon name="user" size={14} /></span>
          <span className="scr-empty-dot"><Icon name="chart" size={14} /></span>
        </div>
        {!unavailable ? <button className="scr-clear" onClick={onClear}>Clear all filters</button> : null}
      </div>
      <div className="scr-copyright">Live market data from connected providers.</div>
    </>
  );
}
