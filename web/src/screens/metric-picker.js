/* =========================================================
   Compare-metrics popover (Fey chart-metrics dropdown).
   Anchored popover (ChipMenu-style, into #modal-root) with a grouped
   checkbox list; footer = "{n} metrics" pill + Cancel (esc) + Compare (return).
   Selection persists per asset-class in localStorage 'hence.compare.v1'.
   Compare overlays the chosen metric series onto the hero chart as extra
   normalized SVG lines + a legend (reuses the hero chart geometry).
   ========================================================= */
import { icon, toast } from '../lib/ui.js';
import { assetClass, fmpSymbol, chartData } from '../lib/market.js';
import * as fmp from '../lib/fmp.js';

const LS_KEY = 'hence.compare.v1';

/* metric catalog per asset-class. Each metric: { id, label, color, series(sym,range) → number[]|null }.
   Series that need fundamentals are quarterly from FMP; price/volume come from candles. `null` = skip. */
const COLORS = ['#5b6cf0', '#f4c39a', '#a78bfa', '#5fcf91', '#e6c84f', '#22c3e6', '#f08d83', '#e879f9'];

const nums = (arr, pick) => (Array.isArray(arr) ? arr.slice().reverse().map(pick).filter((v) => v != null && !isNaN(v)) : []);

async function priceSeries(sym, range) {
  const d = await chartData(sym, range).catch(() => null);
  return d && d.closes && d.closes.length >= 2 ? d.closes : null;
}
async function volumeSeries(sym, range) {
  const d = await chartData(sym, range).catch(() => null);
  return d && d.ohlc && d.ohlc.length >= 2 ? d.ohlc.map((k) => k.v) : null;
}
async function incomeField(sym, field) {
  const inc = await fmp.incomeStatement(fmpSymbol(sym), 'quarter', 16).catch(() => []);
  const v = nums(inc, (x) => x[field]);
  return v.length >= 2 ? v : null;
}
async function keyMetricField(sym, field) {
  const km = await fmp.raw(`key-metrics?symbol=${fmpSymbol(sym)}&period=quarter&limit=16`, 6 * 3600_000).catch(() => []);
  const v = nums(km, (x) => x[field]);
  return v.length >= 2 ? v : null;
}
async function estimateField(sym, field) {
  const est = await fmp.analystEstimates(fmpSymbol(sym), 'annual', 8).catch(() => []);
  const v = nums(est, (x) => x[field]);
  return v.length >= 2 ? v : null;
}
async function priceTargetSeries(sym, range) {
  // no historical series available → a flat consensus-target line rebases to a reference level
  const pt = await fmp.priceTarget(fmpSymbol(sym)).catch(() => null);
  const px = await priceSeries(sym, range);
  if (!pt || !pt.targetConsensus || !px) return null;
  return px.map(() => pt.targetConsensus);
}

const EQUITY_GROUPS = [
  ['Assets and KPIs', [
    { id: 'price', label: 'Share Price', series: (s, r) => priceSeries(s, r) },
    { id: 'volume', label: 'Volume', series: (s, r) => volumeSeries(s, r) },
    { id: 'mktcap', label: 'Market Cap', series: (s) => keyMetricField(s, 'marketCap') },
    { id: 'revenue', label: 'Revenue Actuals', series: (s) => incomeField(s, 'revenue') },
    { id: 'evsales', label: 'EV/Sales', series: (s) => keyMetricField(s, 'evToSales') },
  ]],
  ['Analyst Estimates', [
    { id: 'pt', label: 'Price Target', series: (s, r) => priceTargetSeries(s, r) },
    { id: 'epsest', label: 'EPS Estimates', series: (s) => estimateField(s, 'epsAvg') },
  ]],
  ['Earnings and Financials', [
    { id: 'epsact', label: 'EPS Actuals', series: (s) => incomeField(s, 'epsdiluted') },
    { id: 'netincome', label: 'Net Income', series: (s) => incomeField(s, 'netIncome') },
    { id: 'pe', label: 'P/E Ratio', series: (s) => keyMetricField(s, 'peRatio') },
  ]],
];
const CRYPTO_GROUPS = [
  ['Assets and KPIs', [
    { id: 'price', label: 'Price', series: (s, r) => priceSeries(s, r) },
    { id: 'volume', label: 'Volume', series: (s, r) => volumeSeries(s, r) },
  ]],
];

const DEFAULTS = { equity: ['mktcap', 'pt', 'netincome'], crypto: ['price', 'volume'], price: ['price', 'volume'] };
const classKey = (sym) => { const c = assetClass(sym); return c === 'equity' ? 'equity' : c === 'crypto' ? 'crypto' : 'price'; };
const groupsFor = (sym) => (classKey(sym) === 'equity' ? EQUITY_GROUPS : CRYPTO_GROUPS);

function loadSelection(sym) {
  const k = classKey(sym);
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (Array.isArray(all[k])) return new Set(all[k]);
  } catch (e) { /* first run */ }
  return new Set(DEFAULTS[k] || []);
}
function saveSelection(sym, set) {
  const k = classKey(sym);
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { /* reset */ }
  all[k] = [...set];
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { /* ignore quota */ }
}

let openEl = null, cleanup = null;
function closePicker() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (openEl) { const el = openEl; openEl = null; el.classList.remove('in'); setTimeout(() => el.remove(), 150); }
}

/* main entry — anchored at the trigger button. sym required to key data + persistence. */
export function openMetricPicker(sym, anchor) {
  const s = String(sym || 'TSLA').toUpperCase();
  const root = document.getElementById('modal-root');
  if (!root) return;
  closePicker();

  const groups = groupsFor(s);
  const metaById = new Map();
  groups.forEach(([, items]) => items.forEach((m, i) => metaById.set(m.id, m)));
  const sel = loadSelection(s);

  const rows = groups.map(([g, items]) => `
    <div class="cmp-group">
      <div class="cmp-group__h">${g}</div>
      ${items.map((m) => {
        const on = sel.has(m.id);
        return `<label class="cmp-item" data-mid="${m.id}">
          <span class="checkbox ${on ? 'on' : ''}" data-cb>${on ? icon('check', 11) : ''}</span>
          <span class="cmp-item__lb">${m.label}</span></label>`;
      }).join('')}
    </div>`).join('');

  const menu = document.createElement('div');
  menu.className = 'cmp-menu';
  menu.innerHTML = `
    <div class="cmp-menu__body">${rows}</div>
    <div class="cmp-menu__foot">
      <span class="cmp-count">${sel.size} ${sel.size === 1 ? 'metric' : 'metrics'}</span>
      <span class="cmp-foot-actions">
        <button class="btn-ghost" data-cmp-cancel>Cancel <kbd>esc</kbd></button>
        <button class="btn btn--light cmp-go" data-cmp-go>Compare <kbd>return</kbd></button>
      </span>
    </div>`;
  root.appendChild(menu);
  openEl = menu;

  // position below the anchor, clamped to the viewport (flip up if it overflows)
  const W = 300;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 40, right: 340, top: 120, bottom: 148 };
  const H = menu.offsetHeight || 360;
  let left = Math.min(r.left, window.innerWidth - W - 12);
  if (left < 12) left = 12;
  let top = r.bottom + 6;
  if (top + H > window.innerHeight - 12) top = Math.max(12, r.top - H - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('in'));

  const refreshCount = () => {
    const n = menu.querySelectorAll('.checkbox.on').length;
    const c = menu.querySelector('.cmp-count'); if (c) c.textContent = `${n} ${n === 1 ? 'metric' : 'metrics'}`;
  };
  const onClick = (e) => {
    const item = e.target.closest?.('.cmp-item');
    if (item) {
      e.preventDefault();
      const cb = item.querySelector('[data-cb]');
      cb.classList.toggle('on');
      cb.innerHTML = cb.classList.contains('on') ? icon('check', 11) : '';
      refreshCount();
      return;
    }
    if (e.target.closest?.('[data-cmp-cancel]')) { closePicker(); return; }
    if (e.target.closest?.('[data-cmp-go]')) { commit(); return; }
  };
  const commit = () => {
    const chosen = [...menu.querySelectorAll('.cmp-item')]
      .filter((it) => it.querySelector('.checkbox.on'))
      .map((it) => it.dataset.mid);
    const set = new Set(chosen);
    saveSelection(s, set);
    closePicker();
    applyCompare(s, chosen.map((id) => metaById.get(id)).filter(Boolean));
  };
  menu.addEventListener('click', onClick);

  const onOutside = (e) => { if (openEl && !openEl.contains(e.target)) closePicker(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePicker(); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  cleanup = () => {
    menu.removeEventListener('click', onClick);
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

/* Fetch each selected metric's series and overlay them (normalized to the chart box)
   onto the hero chart SVG, with a legend. Silently skips series that don't resolve. */
async function applyCompare(sym, metrics) {
  const chartEl = document.querySelector('[data-live-chart]');
  const svg = chartEl && chartEl.querySelector('svg.chart');
  if (!svg) { toast('Chart not ready'); return; }
  const range = (chartEl.dataset.range) || '1Y';

  // clear a prior overlay + legend
  svg.querySelectorAll('.cmp-overlay').forEach((n) => n.remove());
  const wrap = chartEl.parentElement;
  wrap && wrap.querySelectorAll('.cmp-legend').forEach((n) => n.remove());

  toast('Comparing metrics…', { spinner: true, sticky: true });
  const resolved = [];
  let ci = 0;
  for (const m of metrics) {
    let vals = null;
    try { vals = await m.series(sym, range); } catch (e) { vals = null; }
    if (vals && vals.length >= 2) resolved.push({ label: m.label, vals, color: COLORS[ci % COLORS.length] });
    ci++;
  }
  if (!resolved.length) { toast('No comparable series for this asset', { icon: 'alert' }); return; }

  // viewBox geometry (priceChart uses 0 0 760 230 with pad 6)
  const vb = (svg.getAttribute('viewBox') || '0 0 760 230').split(/\s+/).map(Number);
  const W = vb[2] || 760, H = vb[3] || 230, pad = 6;
  const smooth = (pts) => {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
    return d;
  };
  const paths = resolved.map((s) => {
    const max = Math.max(...s.vals), min = Math.min(...s.vals), span = (max - min) || 1;
    const step = (W - pad * 2) / (s.vals.length - 1);
    const p = s.vals.map((v, i) => [pad + i * step, H - pad - ((v - min) / span) * (H - pad * 2)]);
    return `<path class="cmp-overlay" d="${smooth(p)}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 3" opacity="0.9"/>`;
  }).join('');
  svg.insertAdjacentHTML('beforeend', paths);

  const legend = document.createElement('div');
  legend.className = 'cmp-legend';
  legend.innerHTML = resolved.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  if (wrap) wrap.appendChild(legend);
  toast(`Comparing ${resolved.length} ${resolved.length === 1 ? 'metric' : 'metrics'}`, { icon: 'check' });
}
