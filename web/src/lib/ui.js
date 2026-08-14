/* =========================================================
   Hence webapp — shared UI components + helpers
   ========================================================= */
import { getTicker } from './data.js';
import { assetIcon, iconImgHtml } from './asset-icon.js';
import { escapeHtml, safeSymbol } from './safe-html.js';

/* ---------- icons (stroke, 24x24) ---------- */
export const ICON = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6 6-2z"/>',
  book: '<path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2z"/><path d="M8 3v18"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  bell: '<path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 004 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1l-.4-2.6H10l-.4 2.6a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 2.6h3.8l.4-2.6a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z"/>',
  chart: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sliders: '<path d="M4 6h11M19 6h1M9 12h11M4 12h1M15 18h5M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  analyze: '<path d="M11 4a7 7 0 100 14 7 7 0 000-14z"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>',
  signout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  wallet: '<path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M16 12h4v-2a1 1 0 00-1-1h-3a1.5 1.5 0 000 3z"/>',
  candles: '<path d="M7 4v3M7 15v5M7 7h0a1 1 0 011 1v6a1 1 0 01-1 1H7a1 1 0 01-1-1V8a1 1 0 011-1zM17 8v2M17 18v2M17 10a1 1 0 011 1v6a1 1 0 01-1 1h0a1 1 0 01-1-1v-6a1 1 0 011-1z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  heart: '<path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 5a5 5 0 019.5 7c-2.5 4.5-9.5 9-9.5 9z"/>',
  gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8S9 3 7 5s5 3 5 3zM12 8s3-5 5-3-5 3-5 3z"/>',
  doc: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  link: '<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.7 9.4h4.3a1.6 1.6 0 010 3.2H9.7m0 0h4.8a1.6 1.6 0 010 3.2H9.7"/>',
  refresh: '<path d="M21 12a9 9 0 11-2.64-6.36M21 3v5h-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  bookmarkFill: '<path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  expand: '<path d="M4 14v6h6M20 10V4h-6M14 4h6v6M10 20H4v-6"/>',
  shrink: '<path d="M10 20v-6H4M14 4v6h6M20 14h-6v6M4 10h6V4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

export function icon(name, size = 18, sw = 1.7) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
}

/* ---------- format ---------- */
export const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
export const cls = (n) => (n >= 0 ? 'up' : 'down');
export const fmtChg = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
export const keycap = (k) => `<kbd class="keycap">${k}</kbd>`;

/* ---------- ticker logo chip ---------- */
export function logo(sym, size = 22) {
  const s = safeSymbol(sym) || '?';
  const t = getTicker(s);
  const color = t && /^#[0-9a-f]{3,8}$/i.test(String(t.color || '')) ? t.color : '#3f3f46';
  const px = Number.isFinite(Number(size)) ? Math.max(8, Math.min(128, Number(size))) : 22;
  const { emoji } = assetIcon(s);
  const base = emoji || s[0];
  const fs = emoji ? px * 0.6 : px * 0.42;
  return `<span class="logo" style="--lc:${color};width:${px}px;height:${px}px;font-size:${fs}px">${escapeHtml(base)}${iconImgHtml(s)}</span>`;
}

/* ---------- watchlist row (logo · ticker · price · $chg · %pill) ---------- */
export function wlRow(sym, { tracking = false } = {}) {
  const s = safeSymbol(sym);
  if (!s) return '';
  const t = getTicker(s);
  return `<a class="wl-row" href="#/stock/${encodeURIComponent(s)}">
    ${logo(s, 22)}
    <span class="wl-tk">${escapeHtml(s)}</span>
    <span class="wl-px">${t.real && t.price > 0 ? '$' + t.price.toFixed(2) : '—'}</span>
    ${tracking ? '' : (t.changeReal ? `<span class="wl-d ${cls(t.chg)}">${fmtChg(t.chg)}</span><span class="pill ${cls(t.chgPct)}">${fmtPct(t.chgPct)}</span>` : '<span class="wl-d">—</span><span class="pill">—</span>')}
    <span class="wl-add">${icon('plus', 12)}</span>
  </a>`;
}

/* ---------- watchlist sidebar panel ---------- */
export function watchlistPanel(wl, { tab = 'Watchlist' } = {}) {
  return `<aside class="wl-panel">
    <div class="wl-head">
      <div class="wl-tabs"><span class="${tab === 'Holdings' ? 'on' : ''}" data-wltab="Holdings">Holdings</span><span class="${tab === 'Watchlist' ? 'on' : ''}" data-wltab="Watchlist">Watchlist</span></div>
      <div class="wl-tools">${iconBtn('plus', 14)}${iconBtn('sliders', 14)}${iconBtn('list', 14)}</div>
    </div>
    <div class="wl-search">${icon('search', 13)}<span>Add symbols</span><kbd class="keycap" style="margin-left:auto">return</kbd></div>
    <div class="wl-section">
      <div class="wl-cap"><span>Stocks</span><span>1‑day returns</span></div>
      ${wl.holdings.map(s => wlRow(s)).join('')}
    </div>
    <div class="wl-section">
      <div class="wl-cap"><span>Tracking items</span></div>
      ${wl.tracking.map(s => wlRow(s, { tracking: true })).join('')}
    </div>
  </aside>`;
}

export function iconBtn(name, size = 16, attrs = '') {
  return `<button class="icon-btn" ${attrs}>${icon(name, size)}</button>`;
}

/* ---------- top bar (stock) ---------- */
export function stockTopbar(sym, tab) {
  const s = safeSymbol(sym) || 'UNKNOWN';
  const t = getTicker(s);
  const tabs = ['Chart', 'Statistics', 'Analyst', 'Earnings', 'Insider', 'Financials', 'Peers'];
  return `<header class="topbar">
    <div class="topbar__l">
      <a class="icon-btn" href="#/">${icon('back', 18)}</a>
      ${logo(s, 26)}
      <div class="topbar__id"><span class="topbar__tk">${escapeHtml(s)}</span><span class="topbar__nm">${escapeHtml(t.name)}</span></div>
    </div>
    <nav class="topbar__tabs">
      ${tabs.map(x => `<a class="${x === tab ? 'on' : ''}" href="#/stock/${encodeURIComponent(s)}/${x.toLowerCase()}">${x}</a>`).join('')}
    </nav>
    <div class="topbar__r">
      <a class="btn-ghost" href="#/analysis/${encodeURIComponent(s)}">${icon('analyze', 15)} Analyze</a>
      <button class="icon-btn" data-toast="${escapeHtml(s)} was added to your list." data-tk="${escapeHtml(s)}" data-tip="Add to watchlist">${icon('bookmark', 16)}</button>
    </div>
  </header>`;
}

/* ---------- bottom command dock ---------- */
export function dock(active = 'home') {
  const items = [
    ['home', 'home', '#/', 'Home', 'G H'],
    ['candles', 'trade', '#/terminal/BTC', 'Trade', 'G T'],
    ['compass', 'discover', '#/economy', 'Discover', 'G A'],
    ['chart', 'markets', '#/stock/TSLA', 'Markets', 'G M'],
    ['bookmark', 'watchlist', '#/watchlist', 'Watchlist', 'W'],
    ['doc', 'analysis', '#/analysis/TSLA', 'Analysis', 'A'],
    ['bolt', 'signals', '#/signals', 'Signals', 'G S'],
    ['mail', 'inbox', '#/settings', 'Inbox', 'I'],
    ['settings', 'settings', '#/settings', 'Settings', 'S'],
  ];
  return `<div class="dock">
    ${items.map(([ic, key, href, tip, kb]) => `<a class="dock__i ${key === active ? 'on' : ''}" href="${href}" aria-label="${tip}" data-dtip="${tip}" data-dkb="${kb}">${icon(ic, 17)}</a>`).join('')}
    <span class="dock__sep"></span>
    <button class="dock__i" data-accounts aria-label="Accounts & wallet" data-dtip="Accounts &amp; wallet" data-dkb="G W">${icon('wallet', 17)}</button>
    <button class="dock__i dock__search" data-cmdk aria-label="Search securities" data-dtip="Search securities" data-dkb="/">${icon('search', 17)}</button>
  </div>`;
}

/* ---------- tabs (segmented) ---------- */
export function segmented(options, active, attr = 'data-seg') {
  return `<div class="segmented">${options.map(o => `<button class="${o === active ? 'on' : ''}" ${attr}="${o}">${o}</button>`).join('')}</div>`;
}

/* ---------- toast ---------- */
let toastEl, toastT;
export function toast(msg, opts = {}) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  const dot = opts.ticker ? logo(opts.ticker, 16) : (opts.icon ? `<span class="toast-dot">${icon(opts.icon, 13)}</span>` : (opts.spinner ? '<span class="spinner"></span>' : ''));
  // `msg` is frequently derived from API/user data. Keep the trusted icon markup,
  // but never concatenate the message into HTML.
  toastEl.replaceChildren();
  if (dot) {
    const mark = document.createElement('span');
    mark.className = 'toast-mark';
    mark.innerHTML = dot;
    toastEl.appendChild(mark);
  }
  const label = document.createElement('span');
  label.textContent = String(msg ?? '');
  toastEl.appendChild(label);
  toastEl.classList.add('show');
  clearTimeout(toastT);
  if (!opts.sticky) toastT = setTimeout(() => toastEl.classList.remove('show'), opts.duration || 2200);
}
export function hideToast() { if (toastEl) toastEl.classList.remove('show'); }

/* ---------- clipboard (shared; falls back to a hidden textarea on old/insecure contexts) ---------- */
export async function copyText(text, { toast: withToast = true, label = 'Copied' } = {}) {
  const s = String(text || '');
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(s); ok = true; }
  } catch { /* fall through */ }
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s; ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    } catch { ok = false; }
  }
  if (withToast) toast(ok ? label : 'Copy failed — select and copy manually', { icon: ok ? 'check' : 'close' });
  return ok;
}

/* ---------- stock right info panel (News summary / Key Indicators / About) ---------- */
export function infoPanel(html) { return `<div class="info-panel">${html}</div>`; }

/* ---------- modal ---------- */
export function openModal(html, { size = '', onClose } = {}) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modal__backdrop" data-close></div><div class="modal__dialog ${size}">${html}</div>`;
  root.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => { wrap.remove(); if (!root.children.length) document.body.style.overflow = ''; onClose && onClose(); };
  wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  wrap._close = close;
  requestAnimationFrame(() => wrap.classList.add('in'));
  return { el: wrap, close };
}
export function closeAllModals() {
  document.querySelectorAll('#modal-root .modal').forEach(m => m._close ? m._close() : m.remove());
}

/* ---------- bind delegated helpers ---------- */
let dockTip;
export function bindCommon(root) {
  root.querySelectorAll('[data-toast]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); toast(b.dataset.toast, { ticker: b.dataset.tk, icon: b.dataset.ti }); }));
  root.querySelectorAll('[data-cmdk]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('hence:cmdk')); }));
  root.querySelectorAll('[data-accounts]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('hence:accounts')); }));
  // watchlist Holdings/Watchlist tab toggle (visual)
  root.querySelectorAll('[data-wltab]').forEach(b => b.addEventListener('click', (e) => {
    e.preventDefault(); const p = b.parentElement; p.querySelectorAll('[data-wltab]').forEach(x => x.classList.remove('on')); b.classList.add('on');
  }));
  // (section tabs handled by a global delegated listener in app.js)
  // dock hover tooltips
  root.querySelectorAll('.dock__i[data-dtip]').forEach(it => {
    it.addEventListener('mouseenter', () => {
      if (!dockTip) { dockTip = document.createElement('div'); dockTip.className = 'dock-tip'; document.body.appendChild(dockTip); }
      const kb = (it.dataset.dkb || '').split(' ').filter(Boolean).map(k => `<kbd class="keycap">${k}</kbd>`).join(' ');
      dockTip.innerHTML = `<span>${it.dataset.dtip}</span>${kb ? `<span class="dock-tip__kb">${kb}</span>` : ''}`;
      const r = it.getBoundingClientRect();
      dockTip.style.opacity = '1';
      dockTip.style.left = (r.left + r.width / 2) + 'px';
      dockTip.style.top = (r.top - 12) + 'px';
    });
    it.addEventListener('mouseleave', () => { if (dockTip) dockTip.style.opacity = '0'; });
  });
}

/* ---------- in-page SECTION tabs (mobile splits a multi-column page
   into tab-switched sections; on desktop the tabs hide and all show) ---------- */
export function sectionTabs(tabs) {
  // tabs: [{ key, label }] — pair with sibling [data-sec="key"] blocks inside a .has-sectabs scope
  return `<div class="sectiontabs" role="tablist">
    ${tabs.map((t, i) => `<button class="sectiontabs__t ${i === 0 ? 'on' : ''}" role="tab" data-sectab="${t.key}">${t.label}</button>`).join('')}
  </div>`;
}

/* ---------- mobile bottom tab bar ---------- */
export function tabbar() {
  const h = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const active =
    h === '/' ? 'home'
      : h.startsWith('/calendar') ? 'calendar'
        : h.startsWith('/watchlist') ? 'watchlist'
          : (h.startsWith('/screener') || h.startsWith('/stock') || h.startsWith('/compare') || h.startsWith('/economy') || h.startsWith('/analysis') || h.startsWith('/analyst')) ? 'markets'
            : '';
  const tabs = [
    ['home', 'Home', '#/'],
    ['chart', 'Markets', '#/screener'],
    ['calendar', 'Calendar', '#/calendar'],
    ['bookmark', 'Watchlist', '#/watchlist'],
  ];
  return `<nav class="tabbar" aria-label="Primary">
    ${tabs.map(([ic, label, href]) => `<a class="tabbar__t ${active === label.toLowerCase() ? 'on' : ''}" href="${href}">${icon(ic, 21)}<span>${label}</span></a>`).join('')}
    <button class="tabbar__t" data-cmdk aria-label="Search">${icon('search', 21)}<span>Search</span></button>
  </nav>`;
}

/* ---------- App chrome wrapper ---------- */
export function appShell(inner, { dockActive = 'home' } = {}) {
  return `<div class="app-chrome">${inner}${dock(dockActive)}${tabbar()}</div>`;
}
