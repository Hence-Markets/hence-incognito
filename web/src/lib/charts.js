/* =========================================================
   Hence webapp — SVG chart helpers (no dependencies)
   ========================================================= */

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}
/* straight segments through each point — for sparse/categorical x-axes (e.g. bond tenors:
   1M..30Y) where smoothPath's horizontal-tangent bezier creates a false "plateau/step" look
   whenever a run of similar values is followed by a jump. True kinks read as more honest. */
function straightPath(pts) {
  if (pts.length < 2) return '';
  return `M ${pts[0][0]},${pts[0][1]}` + pts.slice(1).map(([x, y]) => ` L ${x},${y}`).join('');
}
function pts(values, w, h, pad) {
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
}

let uid = 0;
const nid = (p) => `${p}${++uid}`;

/* area chart with subtle gradient fill */
/* sparse x-axis row under a chart — ≤8 of the labels, ends pinned */
export function xAxisRow(labels) {
  if (!labels || labels.length < 2) return '';
  const n = labels.length;
  const maxTicks = Math.min(8, n);
  const idxs = [...new Set(Array.from({ length: maxTicks }, (_, k) => Math.round((k / (maxTicks - 1)) * (n - 1))))];
  return `<div class="chart-xaxis">${idxs.map(i => `<span>${labels[i]}</span>`).join('')}</div>`;
}

/* wrap any svg in the crosshair markup initCharts() wires (shared hover mechanism) */
function hoverWrap(svg, data, labels, xaxis) {
  return `<div class="chart-wrap" data-points='${JSON.stringify(data).replace(/'/g, '&#39;')}'>${svg}
    <div class="cx" hidden><div class="cx-line"></div><div class="cx-dot"></div><div class="cx-tip"></div></div>
  </div>${xaxis && labels ? xAxisRow(labels) : ''}`;
}

export function areaChart(values, opts = {}) {
  const { w = 600, h = 200, pad = 6, stroke = 'rgba(255,255,255,0.78)', fill = 'rgba(255,255,255,0.10)', sw = 1.4, className = '',
          labels = null, fmt = null, xaxis = false } = opts;
  const p = pts(values, w, h, pad);
  const line = smoothPath(p);
  const area = line + ` L ${p[p.length - 1][0]},${h} L ${p[0][0]},${h} Z`;
  const id = nid('ag');
  const svg = `<svg class="chart ${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${fill}"/><stop offset="100%" stop-color="transparent"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>`;
  if (labels || fmt) {
    const f = fmt || ((v) => String(v));
    const data = p.map(([x, y], i) => ({ fx: x / w, fy: y / h, l: labels ? labels[i] : '', v: f(values[i]) }));
    return hoverWrap(svg, data, labels, xaxis);
  }
  return svg;
}

/* line only (e.g. multi-series) */
export function linePath(values, opts = {}) {
  const { w = 600, h = 200, pad = 6, stroke = '#fff', sw = 1.4, dash = '' } = opts;
  const line = smoothPath(pts(values, w, h, pad));
  return `<path d="${line}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
}

export function multiLine(seriesList, opts = {}) {
  const { w = 600, h = 220, pad = 8, labels = null, fmt = null, xaxis = false } = opts;
  const all = seriesList.flatMap(s => s.values);
  const max = Math.max(...all), min = Math.min(...all);
  const span = max - min || 1;
  const paths = seriesList.map(s => {
    const step = (w - pad * 2) / (s.values.length - 1);
    return s.values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
  });
  const body = seriesList.map((s, si) =>
    `<path d="${smoothPath(paths[si])}" fill="none" stroke="${s.color}" stroke-width="${s.sw || 1.4}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round"/>`
  ).join('');
  const svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
  // hover: index off the FIRST (subject) series; each series sampled at its own
  // proportional index so different-length benchmarks still read correctly
  if ((labels || fmt) && seriesList.length && seriesList[0].values.length > 1) {
    const f = fmt || ((v) => String(v));
    const n0 = seriesList[0].values.length;
    const data = seriesList[0].values.map((_, i) => {
      const rel = i / (n0 - 1);
      const parts = seriesList.map((s, si) => {
        const j = Math.round(rel * (s.values.length - 1));
        return `<i style="background:${s.color}"></i>${s.name ? s.name + ' ' : ''}${f(s.values[j])}`;
      });
      return { fx: paths[0][i][0] / w, fy: paths[0][i][1] / h, l: labels ? labels[i] : '', v: parts.join(' · ') };
    });
    return hoverWrap(svg, data, labels, xaxis);
  }
  return svg;
}

/* volume / generic bars */
export function barChart(values, opts = {}) {
  const { w = 600, h = 200, gap = 0.32, colors = null, baseColor = 'rgba(255,255,255,0.18)',
          labels = null, fmt = null, xaxis = false } = opts;
  const max = Math.max(...values) || 1;
  const bw = w / values.length;
  const body = values.map((v, i) => {
    const bh = (v / max) * (h - 4);
    const c = colors ? colors[i] : baseColor;
    return `<rect x="${i * bw + bw * gap / 2}" y="${h - bh}" width="${bw * (1 - gap)}" height="${bh}" rx="1.5" fill="${c}"/>`;
  }).join('');
  const svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
  if (labels || fmt) {
    const f = fmt || ((v) => String(v));
    // snap to bar centers; tip anchors at each bar's top
    const data = values.map((v, i) => ({
      fx: (i * bw + bw / 2) / w,
      fy: Math.max(0.04, (h - (v / max) * (h - 4)) / h),
      l: labels ? labels[i] : '',
      v: f(v, i),
    }));
    return hoverWrap(svg, data, labels, xaxis);
  }
  return svg;
}

/* sparkline for table rows */
export function sparkline(values, up, w = 56, h = 16) {
  const line = smoothPath(pts(values, w, h, 1.5));
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${line}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

/* grouped bars: arr of [reportedVals?, estimateVals?] style → here pass groups */
export function groupedBars(groups, opts = {}) {
  // groups: [{label, value, color}]
  const { w = 600, h = 200 } = opts;
  return barChart(groups.map(g => g.value), { w, h, colors: groups.map(g => g.color), gap: 0.4 });
}

/* spider / radar chart for analyst ratings */
export function spider(values, labels, opts = {}) {
  const { size = 240, max = Math.max(...values) } = opts;
  const cx = size / 2, cy = size / 2, R = size * 0.36;
  const n = values.length;
  const angle = i => (Math.PI * 2 * i) / n - Math.PI / 2;
  const ring = (frac) => Array.from({ length: n }, (_, i) => {
    const a = angle(i); return `${cx + Math.cos(a) * R * frac},${cy + Math.sin(a) * R * frac}`;
  }).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${ring(f)}" fill="none" stroke="rgba(255,255,255,0.08)"/>`).join('');
  const spokes = Array.from({ length: n }, (_, i) => {
    const a = angle(i); return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}" stroke="rgba(255,255,255,0.08)"/>`;
  }).join('');
  const poly = values.map((v, i) => {
    const a = angle(i), f = v / (max || 1);
    return `${cx + Math.cos(a) * R * f},${cy + Math.sin(a) * R * f}`;
  }).join(' ');
  const dots = values.map((v, i) => {
    const a = angle(i), f = v / (max || 1);
    return `<circle cx="${cx + Math.cos(a) * R * f}" cy="${cy + Math.sin(a) * R * f}" r="2.5" fill="#e6c84f"/>`;
  }).join('');
  const lbls = labels.map((l, i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 14);
    const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    const txt = Array.isArray(l) ? `${l[0]} <tspan class="sup" dy="-3">${l[1]}</tspan>` : l;
    return `<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="spider-lbl">${txt}</text>`;
  }).join('');
  const mx = 40; // horizontal margin so side labels never clip
  return `<svg viewBox="${-mx} -6 ${size + mx * 2} ${size + 12}" class="spider">
    ${grid}${spokes}
    <polygon points="${poly}" fill="rgba(230,200,79,0.16)" stroke="#e6c84f" stroke-width="1.4"/>
    ${dots}${lbls}
  </svg>`;
}

/* ----- interactive price chart with hover crosshair + tooltip ----- */
function fracs(values, w, h, pad) {
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const px = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
  return { px, fr: px.map(([x, y]) => [x / w, y / h]) };
}

export function priceChart(values, opts = {}) {
  const { w = 900, h = 230, pad = 6, stroke = 'rgba(255,255,255,0.8)', fill = 'rgba(255,255,255,0.06)',
          sw = 1.4, labels = null, fmt = (v) => v.toFixed(2), dot = true, nodes = false, nodeColor = 'rgba(255,255,255,0.8)', nodeR = 2.2, suffix = '', smooth = true } = opts;
  const { px, fr } = fracs(values, w, h, pad);
  const line = smooth ? smoothPath(px) : straightPath(px);
  const area = line + ` L ${px[px.length - 1][0]},${h} L ${px[0][0]},${h} Z`;
  const id = nid('pg');
  const last = px[px.length - 1];
  const nodeDots = nodes ? px.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${nodeR}" fill="${nodeColor}"/>`).join('') : '';
  const data = fr.map(([fx, fy], i) => ({ fx, fy, l: labels ? labels[i] : '', v: fmt(values[i]) + suffix }));
  return `<div class="chart-wrap" data-points='${JSON.stringify(data).replace(/'/g, '&#39;')}'>
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${fill}"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
      ${nodeDots}
      ${dot ? `<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff"/>` : ''}
    </svg>
    <div class="cx" hidden><div class="cx-line"></div><div class="cx-dot"></div><div class="cx-tip"></div></div>
  </div>`;
}

/* combo: volume bars + price line sharing one box */
export function comboChart(values, vol, opts = {}) {
  const { w = 900, h = 230 } = opts;
  return `<div style="position:relative">
    <div style="height:${Math.round(h * 0.78)}px">${priceChart(values, { ...opts, w, h: Math.round(h * 0.78) })}</div>
    <div style="height:${Math.round(h * 0.22)}px;opacity:.6">${barChart(vol, { w, h: Math.round(h * 0.22), baseColor: 'rgba(255,255,255,0.14)', gap: 0.5 })}</div>
  </div>`;
}

/* diverging area (green above zero, red below) for spread chart. Interactive: same
   .chart-wrap/.cx crosshair markup as priceChart, wired by the same initCharts(). */
export function divergingArea(values, opts = {}) {
  const { w = 600, h = 180, pad = 8, labels = null, fmt = (v) => v.toFixed(2), smooth = true } = opts;
  const max = Math.max(...values, 0.1), min = Math.min(...values, -0.1), span = max - min || 1;
  const zeroY = h - pad - ((0 - min) / span) * (h - pad * 2);
  const step = (w - pad * 2) / (values.length - 1);
  const p = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = smooth ? smoothPath(p) : straightPath(p);
  const areaUp = line + ` L ${p[p.length - 1][0]},${zeroY} L ${p[0][0]},${zeroY} Z`;
  const idU = nid('du'), idD = nid('dd');
  const last = p[p.length - 1];
  const data = p.map(([x, y], i) => ({ fx: x / w, fy: y / h, l: labels ? labels[i] : '', v: fmt(values[i]) }));
  return `<div class="chart-wrap" data-points='${JSON.stringify(data).replace(/'/g, '&#39;')}'>
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <clipPath id="${idU}"><rect x="0" y="0" width="${w}" height="${zeroY}"/></clipPath>
        <clipPath id="${idD}"><rect x="0" y="${zeroY}" width="${w}" height="${h - zeroY}"/></clipPath>
      </defs>
      <path d="${areaUp}" fill="rgba(63,185,132,0.18)" clip-path="url(#${idU})"/>
      <path d="${areaUp}" fill="rgba(229,72,77,0.18)" clip-path="url(#${idD})"/>
      <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="2 3"/>
      <path d="${line}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.3"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff"/>
    </svg>
    <div class="cx" hidden><div class="cx-line"></div><div class="cx-dot"></div><div class="cx-tip"></div></div>
  </div>`;
}

/* wire crosshair behaviour after mount */
export function initCharts(root) {
  root.querySelectorAll('.chart-wrap[data-points]').forEach(wrap => {
    let pts;
    try { pts = JSON.parse(wrap.getAttribute('data-points').replace(/&#39;/g, "'")); } catch (e) { return; }
    if (!pts || !pts.length) return;
    const cx = wrap.querySelector('.cx'), line = wrap.querySelector('.cx-line'), d = wrap.querySelector('.cx-dot'), tip = wrap.querySelector('.cx-tip');
    const move = (e) => {
      const r = wrap.getBoundingClientRect();
      const rel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const i = Math.min(pts.length - 1, Math.max(0, Math.round(rel * (pts.length - 1))));
      const p = pts[i];
      cx.hidden = false;
      line.style.left = (p.fx * 100) + '%';
      d.style.left = (p.fx * 100) + '%'; d.style.top = (p.fy * 100) + '%';
      tip.innerHTML = `${p.l ? `<span class="cx-date">${p.l}</span>` : ''}<span class="cx-val">${p.v}</span>`;
      const tw = tip.offsetWidth || 90;
      let lx = p.fx * r.width + 10;
      if (lx + tw > r.width) lx = p.fx * r.width - tw - 10;
      tip.style.left = lx + 'px';
      tip.style.top = Math.max(2, p.fy * r.height - 34) + 'px';
    };
    wrap.addEventListener('mousemove', move);
    wrap.addEventListener('mouseleave', () => { cx.hidden = true; });
  });
}

/* date label helpers for charts */
export function dateLabels(n, kind = 'day') {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const out = [];
  for (let i = 0; i < n; i++) {
    if (kind === 'intraday') { const h = 9 + Math.floor((i / n) * 7); const m = (i * 13) % 60; out.push(`${((h - 1) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`); }
    else { const mi = Math.floor((i / n) * 12); const day = 1 + (i * 5) % 27; out.push(`${months[mi]} ${day}`); }
  }
  return out;
}

/* ----- candlestick chart (OHLCV) for the trading terminal -----
   Returns a self-contained block: stretched SVG geometry (candles, volume,
   SMA, grid, last-price line) + crisp HTML price/time axis labels + last tag. */
function ccTime(ms, intraday) {
  const d = new Date(ms);
  if (intraday) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${M[d.getMonth()]} ${d.getDate()}`;
}
export function candleChart(ohlc, opts = {}) {
  const { w = 1000, h = 380, fmt = (v) => v.toFixed(2), sma = 20,
    up = '#2fbf8f', down = '#e8736e', volFrac = 0.20 } = opts;
  if (!Array.isArray(ohlc) || ohlc.length < 2) return `<div class="cchart"></div>`;
  const n = ohlc.length;
  const priceH = h * (1 - volFrac) - 6, volTop = h * (1 - volFrac) + 4, volH = h * volFrac - 6;
  let lo = Infinity, hi = -Infinity, vmax = 0;
  for (const k of ohlc) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); vmax = Math.max(vmax, k.v || 0); }
  const padp = (hi - lo) * 0.06 || (hi * 0.01) || 1; lo -= padp; hi += padp;
  const span = (hi - lo) || 1;
  const yOf = (p) => (1 - (p - lo) / span) * priceH;
  const cw = w / n, bw = Math.max(1, cw * 0.62);
  const intraday = (ohlc[1].t - ohlc[0].t) < 12 * 3600_000;
  let bodies = '', wicks = '', vols = '';
  for (let i = 0; i < n; i++) {
    const k = ohlc[i], cx = i * cw + cw / 2, col = k.c >= k.o ? up : down;
    wicks += `<line x1="${cx}" y1="${yOf(k.h)}" x2="${cx}" y2="${yOf(k.l)}" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const top = Math.min(yOf(k.o), yOf(k.c)), bh = Math.max(0.8, Math.abs(yOf(k.c) - yOf(k.o)));
    bodies += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${bh}" fill="${col}"/>`;
    if (vmax) { const vh = ((k.v || 0) / vmax) * volH; vols += `<rect x="${cx - bw / 2}" y="${volTop + volH - vh}" width="${bw}" height="${vh}" fill="${col}" opacity="0.32"/>`; }
  }
  let smaPath = '';
  if (sma && n > sma) {
    const pts = [];
    for (let i = sma - 1; i < n; i++) { let s = 0; for (let j = i - sma + 1; j <= i; j++) s += ohlc[j].c; pts.push(`${i * cw + cw / 2},${yOf(s / sma)}`); }
    smaPath = `<polyline points="${pts.join(' ')}" fill="none" stroke="#5fcf91" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.8"/>`;
  }
  let grid = '', plabels = '';
  const rows = 5;
  for (let i = 0; i <= rows; i++) {
    const p = hi - (i / rows) * span, y = yOf(p);
    grid += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,0.045)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    plabels += `<div class="cc-plabel" style="top:${(y / h) * 100}%">${fmt(p)}</div>`;
  }
  let tlabels = ''; const tn = Math.min(7, n);
  for (let i = 0; i < tn; i++) { const idx = Math.round((i / (tn - 1)) * (n - 1)); tlabels += `<span style="left:${((idx * cw + cw / 2) / w) * 100}%">${ccTime(ohlc[idx].t, intraday)}</span>`; }
  const last = ohlc[n - 1], lastY = yOf(last.c), lastUp = last.c >= last.o;
  return `<div class="cchart">
    <svg class="cchart__svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      ${grid}${vols}${wicks}${bodies}${smaPath}
      <line x1="0" y1="${lastY}" x2="${w}" y2="${lastY}" stroke="${lastUp ? up : down}" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" opacity="0.7"/>
    </svg>
    <div class="cc-axis">${plabels}</div>
    <div class="cc-last ${lastUp ? 'up' : 'down'}" style="top:${(lastY / h) * 100}%">${fmt(last.c)}</div>
    <div class="cc-time">${tlabels}</div>
  </div>`;
}

/* price target — historical line then fanned projection */
export function priceTargetChart(hist, target, opts = {}) {
  // Fey anatomy: the asset's REAL price line on the left, a dashed projection fan to the
  // High/Median/Low analyst targets, and right-axis tick labels — High / Median / Current /
  // Low — each at its own price level (values collide → nudged apart).
  const { w = 600, h = 240, pad = 10, current = null } = opts;
  const labelW = 64;                                   // right gutter for the axis labels
  const fanEnd = w - pad - labelW;
  const splitX = fanEnd * 0.55;
  const cur = current != null ? +current : hist[hist.length - 1];
  const all = [...hist, target.high, target.low, cur];
  const max = Math.max(...all), min = Math.min(...all);
  const span = max - min || 1;
  const y = v => h - pad - ((v - min) / span) * (h - pad * 2);
  const step = (splitX - pad) / (hist.length - 1);
  const hp = hist.map((v, i) => [pad + i * step, y(v)]);
  const last = hp[hp.length - 1];
  const cone = (val, color, dash) =>
    `<path d="M ${last[0]},${last[1]} C ${(last[0] + fanEnd) / 2},${last[1]} ${(last[0] + fanEnd) / 2},${y(val)} ${fanEnd},${y(val)}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="${dash}"/>`;
  const fmtT = v => (v >= 1000 ? (+v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : (+v).toFixed(2));
  // right-axis labels, de-collided top→bottom (min 13px apart)
  const ticks = [
    { name: 'High', v: target.high, cls: 'up' },
    { name: 'Median', v: target.median, cls: '' },
    { name: 'Current', v: cur, cls: 'cur' },
    { name: 'Low', v: target.low, cls: 'down' },
  ].filter(t => t.v != null && isFinite(t.v)).sort((a, b) => b.v - a.v);
  let prevY = -99;
  const labels = ticks.map(t => {
    let ly = Math.max(y(t.v), prevY + 13); prevY = ly;
    const color = t.cls === 'up' ? 'rgba(95,207,145,0.9)' : t.cls === 'down' ? 'rgba(240,141,131,0.9)' : t.cls === 'cur' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
    return `<text x="${fanEnd + 6}" y="${Math.min(Math.max(ly, pad + 4), h - pad) + 3}" font-size="10" fill="${color}">${t.name} ${fmtT(t.v)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line x1="${splitX}" y1="${pad}" x2="${splitX}" y2="${h - pad}" stroke="rgba(255,255,255,0.10)" stroke-dasharray="3 3"/>
    <path d="${smoothPath(hp)}" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.4"/>
    ${cone(target.high, 'rgba(95,207,145,0.8)', '3 3')}
    ${cone(target.median, 'rgba(255,255,255,0.5)', '3 3')}
    ${cone(target.low, 'rgba(240,141,131,0.8)', '3 3')}
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff"/>
    ${labels}
  </svg>`;
}

/* ----- crypto probability ladder: strike ($) → P(yes) as a downward step curve -----
   `points` = [{strike:number, p:number(0-1)}] (unsorted OK). `current` = current price →
   a vertical marker + label. Dots + price/pct labels on ≤5 key strikes. */
export function probLadderChart(points, current, opts = {}) {
  const { w = 520, h = 220, padL = 12, padR = 12, padT = 16, padB = 26 } = opts;
  const pts0 = (points || [])
    .filter(p => p && isFinite(p.strike) && isFinite(p.p))
    .sort((a, b) => a.strike - b.strike);
  if (pts0.length < 2) return `<svg class="chart" viewBox="0 0 ${w} ${h}"></svg>`;
  const strikes = pts0.map(p => p.strike);
  let xmin = Math.min(...strikes), xmax = Math.max(...strikes);
  if (current != null && isFinite(current)) { xmin = Math.min(xmin, current); xmax = Math.max(xmax, current); }
  const xspan = (xmax - xmin) || 1;
  const X = v => padL + ((v - xmin) / xspan) * (w - padL - padR);
  const Y = pr => padT + (1 - Math.max(0, Math.min(1, pr))) * (h - padT - padB); // p=1 top, p=0 bottom
  const P = pts0.map(p => [X(p.strike), Y(p.p)]);
  const line = smoothPath(P);
  const area = line + ` L ${P[P.length - 1][0]},${h - padB} L ${P[0][0]},${h - padB} Z`;
  const id = nid('pl');
  // gridlines at 0/25/50/75/100%
  let grid = '';
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    const gy = Y(g);
    grid += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="rgba(255,255,255,0.05)"/>`
      + `<text x="${padL}" y="${gy - 2}" font-size="8.5" fill="rgba(255,255,255,0.32)">${Math.round(g * 100)}%</text>`;
  }
  // label ≤5 evenly-spaced strikes with dots
  const fmtS = v => (v >= 1000 ? '$' + (+v).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v >= 1 ? '$' + (+v).toFixed(0) : '$' + (+v).toPrecision(2));
  const stepN = Math.max(1, Math.ceil(pts0.length / 5));
  let dots = '', lastLabelX = -1e9;
  pts0.forEach((p, i) => {
    if (i % stepN !== 0 && i !== pts0.length - 1) return;
    const x = X(p.strike), y = Y(p.p);
    dots += `<circle cx="${x}" cy="${y}" r="2.6" fill="rgba(95,207,145,0.95)"/>`;
    if (x - lastLabelX >= 46) {                        // skip labels that would collide
      dots += `<text x="${x}" y="${h - 14}" font-size="8.5" fill="rgba(255,255,255,0.42)" text-anchor="middle">${fmtS(p.strike)}</text>`;
      lastLabelX = x;
    }
  });
  let curMark = '';
  if (current != null && isFinite(current)) {
    const cx = X(current);
    curMark = `<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${h - padB}" stroke="rgba(255,255,255,0.55)" stroke-width="1.1" stroke-dasharray="3 3"/>`
      + `<text x="${cx}" y="${padT - 4}" font-size="8.5" fill="rgba(255,255,255,0.7)" text-anchor="middle">now ${fmtS(current)}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(95,207,145,0.16)"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="rgba(95,207,145,0.9)" stroke-width="1.5" stroke-linecap="round"/>
    ${dots}${curMark}
  </svg>`;
}

/* ----- expected-range projection cone: a recent real price line, then ±1σ/±2σ bands
   fanning right for a chosen horizon. `hist` = recent closes. `bands` = {s1, s2} as
   FRACTIONS of price for the horizon (e.g. 0.18 = ±18%). Right-edge labels drawn. */
export function projectionCone(hist, bands, opts = {}) {
  const { w = 520, h = 220, pad = 12, labelW = 92, horizonLabel = '30d' } = opts;
  const h0 = (hist || []).filter(v => isFinite(v));
  if (h0.length < 2) return `<svg class="chart" viewBox="0 0 ${w} ${h}"></svg>`;
  const cur = h0[h0.length - 1];
  const s1 = Math.max(0, +bands.s1 || 0), s2 = Math.max(s1, +bands.s2 || s1 * 2);
  const hi2 = cur * (1 + s2), lo2 = cur * (1 - s2);
  const fanEnd = w - pad - labelW;
  const splitX = pad + (fanEnd - pad) * 0.5;             // real line uses the left half
  const all = [...h0, hi2, lo2];
  const max = Math.max(...all), min = Math.min(...all), span = (max - min) || 1;
  const Y = v => pad + (1 - (v - min) / span) * (h - pad * 2);
  const step = (splitX - pad) / (h0.length - 1);
  const hp = h0.map((v, i) => [pad + i * step, Y(v)]);
  const last = hp[hp.length - 1];
  // a quadratic fan from `last` to the ±band value at fanEnd
  const fan = (val, x2) => `M ${last[0]},${last[1]} Q ${(last[0] + x2) / 2},${last[1]} ${x2},${Y(val)}`;
  const bandArea = (hiV, loV) =>
    `${fan(hiV, fanEnd).replace('M', 'M ')} L ${fanEnd},${Y(loV)} `
    + `Q ${(last[0] + fanEnd) / 2},${last[1]} ${last[0]},${last[1]} Z`;
  const fmtP = v => (v >= 1000 ? '$' + (+v).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v >= 1 ? '$' + (+v).toFixed(2) : '$' + (+v).toPrecision(3));
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${bandArea(cur * (1 + s2), cur * (1 - s2))}" fill="rgba(124,140,255,0.10)"/>
    <path d="${bandArea(cur * (1 + s1), cur * (1 - s1))}" fill="rgba(124,140,255,0.18)"/>
    <path d="${fan(cur, fanEnd)}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="3 3"/>
    <path d="${smoothPath(hp)}" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.4"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff"/>
    <text x="${fanEnd + 6}" y="${Y(cur * (1 + s1)) + 3}" font-size="9" fill="rgba(124,140,255,0.95)">${horizonLabel} +1σ ${fmtP(cur * (1 + s1))}</text>
    <text x="${fanEnd + 6}" y="${Y(cur * (1 - s1)) + 3}" font-size="9" fill="rgba(124,140,255,0.95)">${horizonLabel} −1σ ${fmtP(cur * (1 - s1))}</text>
  </svg>`;
}
