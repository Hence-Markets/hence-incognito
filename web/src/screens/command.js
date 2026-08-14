/* Universal command menu — bottom-anchored, grows upward. Now SCOPED (Fey pattern):
   a scope chip sits top-left, and the menu content changes with the scope —
     • search  — securities + nav + "Ask Hence"; each security drills into…
     • entity  — a company's sub-actions (Analyst estimates · Analyze · Balance
                 sheet · Cash flow · Company news · Earnings · Financials)
     • page    — a screen's contextual commands (Screener → Sort …), registered
                 via cmdScope, chip = the page name
     • metric  — a searchable radio list (Estimates → pick a metric)
   Drill in with → / click; pop back with ← / Backspace-at-empty. */
import { track } from '../lib/analytics';
import { icon, logo } from '../lib/ui.js';
import { TICKERS, getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { openAssistant } from '../lib/assistant';
import { openTrade } from '../lib/tradeTicket';
import { openFeedback } from '../lib/feedback';
import { getCmdScope } from '../lib/cmdScope';
import { recents } from '../lib/recents';

// an asset is tradeable when it maps to a Hyperliquid perp coin (or is crypto) — mirrors StockTopbar
const isTradeable = (sym) => { try { const c = market.coinFor(sym); return (c && c !== sym) || getTicker(sym).world === 'crypto'; } catch { return false; } };
const tradeItem = (sym) => ({ type: 'item', icon: 'candles', label: `Trade ${sym}`, sub: 'Perp · Hyperliquid', tag: sym, key: 'T', run: () => openTrade(sym) });

/* every destination, grouped — the nav hub. [label, icon, href, group] */
const ACTIONS = [
  ['Home', 'home', '#/', 'Navigate'],
  ['Portfolio', 'bookmark', '#/portfolio', 'Navigate'],
  ['Watchlist', 'bookmark', '#/watchlist', 'Navigate'],
  ['Your theses', 'sparkle', '#/theses', 'Navigate'],
  ['Earnings calendar', 'calendar', '#/calendar', 'Navigate'],
  ['Economy & markets', 'compass', '#/economy', 'Discover'],
  ['Stock screener', 'sliders', '#/screener', 'Discover'],
  ['Trading terminal', 'candles', '#/terminal/BTC', 'Discover'],
  ['Prediction markets', 'coin', '#/predict', 'Discover'],
  ['Graph comparison', 'chart', '#/compare/TSLA', 'Discover'],
  ['Backtest a strategy', 'clock', '#/backtest', 'Discover'],
  ['AI Analysis', 'analyze', '#/analysis/TSLA', 'Research'],
  ['Analyst coverage', 'list', '#/analyst/TSLA', 'Research'],
  ['Settings', 'settings', '#/settings', 'Account'],
  ['Refer a friend', 'gift', '#/referral', 'Account'],
];
// session commands that RUN an action rather than navigate
const SESSION = [
  { label: 'Send feedback', icon: 'mail', run: () => openFeedback() },   // global — the current screen auto-attaches
  { label: 'Sign out', icon: 'signout', run: () => { try { window.henceAuth?.logout?.(); } catch { /* noop */ } location.hash = '#/login'; } },
];
const POPULAR = ['BTC', 'ETH', 'SOL', 'NVDA', 'HYPE', 'AAPL'];
const RECENT_FALLBACK = ['BTC', 'NVDA', 'ETH'];      // until the user has real recents
// the last FMP equity-search result set (async; searchRows reads it when the query matches)
let extEquities = { q: '', rows: [] };
let extUsers = { q: '', rows: [] };   // async /api/users/search results

const sec = (label, ic, href, key) => ({ type: 'sec', href, icon: ic, label, key });
// a company/asset's sub-actions, TAILORED TO ITS ASSET CLASS — equity fundamentals
// (Analyst/Financials/Earnings/Insider/Peers) are nonsense for crypto/macro, so they're
// only shown for equities. Trade (perp) leads whenever the asset is tradeable.
function entityItems(sym, nm) {
  const cls = market.assetClass(sym);
  const rows = [];
  if (isTradeable(sym)) {
    rows.push(tradeItem(sym));                                              // quick dock ticket (T)
    rows.push(sec('Open in terminal', 'chart', `#/terminal/${sym}`, 'O'));  // full chart + book + positions
  }
  rows.push(sec(`Analyze ${sym}`, 'analyze', `#/analysis/${sym}`, 'D'));
  rows.push(sec('Company news', 'book', `#/stock/${sym}`, 'N'));
  if (cls === 'equity') {
    rows.push(
      sec('Analyst estimates', 'sliders', `#/analyst/${sym}`, 'A'),
      sec('Financials', 'chart', `#/stock/${sym}/financials`, 'F'),
      sec('Earnings', 'doc', `#/stock/${sym}/earnings`, 'E'),
      sec('Insider trades', 'user', `#/stock/${sym}/insider`, 'I'),
      sec('Peers', 'grid', `#/stock/${sym}/peers`, 'P'),
    );
  } else if (cls === 'crypto') {
    rows.push(sec('Signals', 'bolt', `#/signals/${sym}`, 'S'));
  }
  return rows.map((r) => ({ ...r, sub: nm, tag: r.tag || sym }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const actionRow = (a) => ({ type: 'cmd', href: a[2], icon: a[1], label: a[0] });
const venueOf = (t) => (t.world === 'crypto' ? 'Crypto' : 'Stocks');
function stockRow(sym, tag) {
  const t = getTicker(sym);
  // in analyze-picker mode every asset row routes to its AI report instead of the asset page
  return { type: 'stock', href: `#/${analyzeIntent ? 'analysis' : 'stock'}/${sym}`, sym, label: sym, sub: t.name, tag: tag || venueOf(t), drill: sym };
}

let open = false;
// dock "Analysis" clicked OFF an asset page opens the palette as an ASSET PICKER: the empty state
// lists assets to choose and every asset row routes to /analysis/<sym> instead of /stock/<sym>.
let analyzeIntent = false;
let sessionSeq = 0;      // bumps per palette open — async callbacks check they belong to the live session
// A registry of ID counters — a fresh id per action so run-closures are looked up, not serialized.
let runSeq = 0;

/* ---------------- rows per scope ---------------- */
function searchRows(q) {
  const raw = q.trim();
  q = raw.toLowerCase();
  if (!q) {
    const recent = recents().filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s)).slice(0, 4);
    if (analyzeIntent) {
      // asset-picker mode: just choose what to analyze — no assistant/command/session clutter
      return [
        { group: 'Recent' }, ...(recent.length ? recent : RECENT_FALLBACK).map((s) => stockRow(s)),
        { group: 'Popular' }, ...POPULAR.map((s) => stockRow(s)),
      ];
    }
    const rows = [
      { group: 'Assistant' },
      { type: 'ask', ask: '', icon: 'sparkle', label: 'Ask Hence anything…', tag: 'AI' },
      { group: 'Recent' }, ...(recent.length ? recent : RECENT_FALLBACK).map((s) => stockRow(s)),
    ];
    let lastGrp = '';
    for (const a of ACTIONS) {
      if (a[3] !== lastGrp) { rows.push({ group: a[3] }); lastGrp = a[3]; }
      rows.push(actionRow(a));
    }
    rows.push({ group: 'Session' }, ...SESSION.map((s) => ({ type: 'item', icon: s.icon, label: s.label, run: s.run })));
    rows.push({ group: 'Popular' }, ...POPULAR.map((s) => stockRow(s)));
    return rows;
  }
  const score = (s) => {
    const sl = s.toLowerCase(), nm = (TICKERS[s].name || '').toLowerCase();
    if (sl === q) return 0; if (sl.startsWith(q)) return 1; if (sl.includes(q)) return 2;
    if (nm.startsWith(q)) return 3; if (nm.includes(q)) return 4; return 99;
  };
  const matches = Object.keys(TICKERS).filter((s) => score(s) < 99).sort((a, b) => score(a) - score(b)).slice(0, 7);
  const stocks = matches.map((s) => stockRow(s));
  // an FMP result for the same sym carries the REAL company name — prefer it over a
  // fabricated "SYM Inc." stub name that a prior visit may have cached into TICKERS
  if (extEquities.q === raw) {
    const extName = new Map(extEquities.rows.map((r) => [r.sym, r.sub]));
    stocks.forEach((r) => { const n = extName.get(r.sym); if (n) r.sub = n; });
  }
  const rows = [];
  if (stocks.length) rows.push({ group: 'Securities' }, ...stocks);
  // the top match's sub-actions inline (each 1-key accelerator fires on an exact ticker), so the
  // user sees a company's capabilities right in the search results — and can drill in for the rest.
  if (stocks.length && !analyzeIntent) {
    const sym = stocks[0].sym, nm = getTicker(sym).name;
    rows.push({ group: nm }, ...entityItems(sym, nm).slice(0, 5));
  }
  // async FMP equity results for this exact query (fetched by the palette, painted on arrival)
  if (extEquities.q === raw && extEquities.rows.length) {
    const seen = new Set(matches);
    const ext = extEquities.rows.filter((r) => !seen.has(r.sym)).slice(0, 4);
    if (ext.length) rows.push({ group: 'More equities' }, ...ext);
  }
  // A pasted wallet address is unambiguous — send it straight to that portfolio. Without this
  // it matches no ticker and falls through to the "Ask Hence" row, which is useless for an address.
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    rows.push({ group: 'Wallet' }, {
      type: 'cmd', href: '#/u/' + raw, icon: 'wallet',
      label: raw.slice(0, 10) + '…' + raw.slice(-6), sub: 'Open this portfolio', tag: 'Wallet',
    });
  }
  // traders matching the query (async, painted on arrival — same shape as More equities)
  if (extUsers.q === raw && extUsers.rows.length) {
    rows.push({ group: 'Traders' }, ...extUsers.rows);
  }
  const cmds = ACTIONS.filter((a) => a[0].toLowerCase().includes(q));
  const sess = SESSION.filter((s) => s.label.toLowerCase().includes(q));
  if (cmds.length || sess.length) rows.push({ group: 'Commands' },
    ...cmds.map((a) => ({ type: 'cmd', href: a[2], icon: a[1], label: a[0], tag: 'Command' })),
    ...sess.map((s) => ({ type: 'item', icon: s.icon, label: s.label, tag: 'Command', run: s.run })));
  rows.push({ group: 'Assistant' }, { type: 'ask', ask: raw, icon: 'sparkle', label: `Ask Hence: “${esc(raw)}”`, tag: 'AI' });
  return rows;
}

// the GLOBAL run-actions (Send feedback / Sign out) — typeable from ANY scope so they're
// reachable even when ⌘K opened a page/entity scope (they only show once the user types).
// `have` = labels the scope ALREADY shows, so we never render a command twice.
function globalCmdRows(query, have) {
  if (!query) return [];
  const seen = have || new Set();
  const sess = SESSION.filter((s) => s.label.toLowerCase().includes(query) && !seen.has(s.label.toLowerCase()));
  return sess.length ? [{ group: 'Commands' }, ...sess.map((s) => ({ type: 'item', icon: s.icon, label: s.label, tag: 'Command', run: s.run }))] : [];
}

function entityRows(scope, q) {
  const query = q.trim().toLowerCase();
  const sym = scope.sym, nm = scope.name;
  const items = entityItems(sym, nm).filter((it) => !query || (it.label || '').toLowerCase().includes(query));
  const globals = globalCmdRows(query);
  if (!items.length && !globals.length) return [{ group: 'No matches' }];
  return [...(items.length ? [{ group: nm }, ...items] : []), ...globals];
}

// a registered CmdScope (Screener sort / metric picker) → rows, filtered by query.
function customRows(scope, q) {
  const query = q.trim().toLowerCase();
  const rows = [];
  const labels = new Set();
  for (const g of (scope.groups || [])) {
    const items = (g.items || []).filter((it) => !query || (it.label || '').toLowerCase().includes(query));
    if (!items.length) continue;
    if (g.title) rows.push({ group: g.title });
    for (const it of items) { rows.push({ type: 'item', ...it, radio: scope.radio || g.radio }); labels.add((it.label || '').toLowerCase()); }
  }
  // radio scopes (sort / metric pickers) are pure single-select lists — don't pollute them with
  // global run-commands; other page scopes get them, de-duped against what the scope already shows.
  if (!scope.radio) rows.push(...globalCmdRows(query, labels));
  if (!rows.length) rows.push({ group: 'No matches' });
  return rows;
}

function buildRows(scope, q) {
  if (scope.kind === 'entity') return entityRows(scope, q);
  if (scope.kind === 'custom') return customRows(scope.scope, q);
  return searchRows(q);
}

/* ---------------- chip + row html ---------------- */
function chipHtml(scope) {
  if (scope.kind === 'entity') return `<span class="cmdk-scope">${logo(scope.sym, 16)}<span>${esc(scope.name)}</span></span>`;
  if (scope.kind === 'custom') {
    const s = scope.scope;
    const lead = s.sym ? logo(s.sym, 16) : icon(s.icon || 'search', 13);
    return `<span class="cmdk-scope">${lead}<span>${esc(s.label)}</span>${s.meta ? `<span class="cmdk-scope__meta">${esc(s.meta)}</span>` : ''}</span>`;
  }
  if (scope.kind === 'search' && analyzeIntent) return `<span class="cmdk-scope">${icon('analyze', 13)}<span>Analyze</span></span>`;
  return `<span class="cmdk-scope">${icon('search', 13)}<span>Search</span></span>`;
}
function placeholderFor(scope) {
  if (scope.kind === 'entity') return `Search ${scope.name}`;
  if (scope.kind === 'custom') return scope.scope.placeholder || 'Search commands';
  return analyzeIntent ? 'Analyze an asset — search by name or ticker…' : 'Search securities and pages, or ask Hence…';
}
function rowHtml(r, i, sel) {
  if (r.group) return `<div class="cmdk-grp">${esc(r.group)}</div>`;
  const lead = r.type === 'stock' ? logo(r.sym, 22)
    : (r.radio ? `<span class="cmdk-radio${r.checked ? ' on' : ''}">${r.checked ? icon('check', 12) : ''}</span>`
      : `<span class="cmdk-ic">${icon(r.icon || 'chevR', 16)}</span>`);
  const attrs = r.type === 'ask' ? `data-ask="${encodeURIComponent(r.ask)}"`
    : r.type === 'item' && r.run ? `data-run="${r._rid}"`
      : `data-href="${esc(r.href || '')}"`;
  const drill = r.drill ? `<span class="cmdk-drill" data-drill="${esc(r.drill)}" title="Actions">${icon('chevR', 15)}</span>` : '';
  const trail = drill || (r.key ? `<kbd class="cmdk-key">${r.key}</kbd>` : (r.tag ? `<span class="cmdk-tag">${esc(r.tag)}</span>` : ''));
  return `<button class="cmdk-row ${i === sel ? 'on' : ''}" data-i="${i}" ${attrs}>
    ${lead}
    <span class="cmdk-tx"><span class="cmdk-lb">${esc(r.label)}</span>${r.sub ? `<span class="cmdk-sub">${esc(r.sub)}</span>` : ''}</span>
    ${trail}
  </button>`;
}

/* "Analyze" intent — shared by the dock "Analysis" button and the 'a' hotkey. Analyze the asset
   currently in view; off an asset, open the palette as an asset picker instead of guessing a
   random recent (the Fey model: analysis is always scoped to a chosen asset). */
export function goAnalyze() {
  const m = (location.hash || '').match(/#\/(?:stock|analysis|analyst|terminal|compare)\/([^/?]+)/);
  if (m) { location.hash = `#/analysis/${decodeURIComponent(m[1]).toUpperCase()}`; return; }
  openCommandPalette({ analyze: true });
}

/* ---------------- the palette ---------------- */
export function openCommandPalette(opts = {}) {
  track('search_opened', {});
  if (open) return; open = true;
  analyzeIntent = !!opts.analyze;    // asset-picker mode (dock "Analysis" off an asset page)
  const mySession = ++sessionSeq;
  document.body.classList.add('cmdk-open');
  const root = document.getElementById('modal-root') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'cmdk-overlay';
  overlay.innerHTML = `
    <div class="cmdk-backdrop" data-close></div>
    <div class="cmdk-panel" role="dialog" aria-label="Command menu">
      <div class="cmdk-bc" data-chip></div>
      <div class="cmdk-list" data-list></div>
      <div class="cmdk-input">
        ${icon('search', 17)}
        <input type="text" autocomplete="off" spellcheck="false" />
        <kbd class="keycap cmdk-esc">esc</kbd>
      </div>
    </div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));

  const listEl = overlay.querySelector('[data-list]');
  const chipEl = overlay.querySelector('[data-chip]');
  const input = overlay.querySelector('input');
  const runMap = new Map();          // rid → run() closure (for custom item actions)

  // the current asset when ⌘K is opened on an asset page → default to that asset's scope
  const routeAsset = () => {
    const m = (location.hash || '').match(/#\/(?:stock|analysis|analyst|compare)\/([^/?]+)/);
    if (!m) return null;
    const sym = decodeURIComponent(m[1]).toUpperCase();
    return { kind: 'entity', sym, name: getTicker(sym).name || sym };
  };
  // base scope: forced search (the / key + dock search pod), else an explicit scope (metric
  // picker), else the page's registered command scope (⌘K on the Screener), else — on an asset
  // page — that asset's actions, else search.
  const base = (opts.search || opts.analyze) ? { kind: 'search' }
    : opts.scope ? { kind: 'custom', scope: opts.scope }
      : getCmdScope() ? { kind: 'custom', scope: getCmdScope() }
        : (routeAsset() || { kind: 'search' });
  const stack = [base];
  const scope = () => stack[stack.length - 1];
  let rows = [], sel = -1;

  const selectableIdx = () => rows.map((r, i) => (r.group ? -1 : i)).filter((i) => i >= 0);

  function paint() {
    // preserve the selection by ROW IDENTITY, not index — an async repaint (the FMP
    // "More equities" arrival) inserts rows and must not silently move the highlight.
    const prev = sel >= 0 ? rows[sel] : null;
    runMap.clear(); runSeq = 0;
    rows = buildRows(scope(), input.value);
    for (const r of rows) { if (r.type === 'item' && r.run) { r._rid = 'r' + (++runSeq); runMap.set(r._rid, r.run); } }
    if (prev) {
      const same = rows.findIndex((r) => !r.group && r.type === prev.type && r.label === prev.label && (r.href || '') === (prev.href || ''));
      sel = same >= 0 ? same : -1;
    }
    const idxs = selectableIdx();
    if (sel < 0 || !idxs.includes(sel)) sel = idxs[0] ?? -1;
    chipEl.innerHTML = chipHtml(scope());
    input.placeholder = placeholderFor(scope());
    listEl.innerHTML = rows.map((r, i) => rowHtml(r, i, sel)).join('');
    const on = listEl.querySelector('.cmdk-row.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function move(d) {
    const idxs = selectableIdx(); if (!idxs.length) return;
    let p = idxs.indexOf(sel); p = Math.max(0, Math.min(idxs.length - 1, p + d)); sel = idxs[p];
    listEl.querySelectorAll('.cmdk-row').forEach((el) => el.classList.toggle('on', +el.dataset.i === sel));
    const on = listEl.querySelector('.cmdk-row.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function pushScope(s) { stack.push(s); input.value = ''; sel = -1; paint(); setTimeout(() => input.focus(), 0); }
  function popScope() {
    if (stack.length > 1) stack.pop();
    else if (scope().kind !== 'search') stack[0] = { kind: 'search' };
    else return false;
    input.value = ''; sel = -1; paint(); return true;
  }
  function drill(sym) { const t = getTicker(sym); pushScope({ kind: 'entity', sym, name: t.name || sym }); }
  function go(href) { close(); if (href) location.hash = href; }
  function activate(r) {
    if (!r) return;
    if (r.type === 'ask') { close(); openAssistant(r.ask); return; }
    if (r.type === 'item' && r._rid && runMap.has(r._rid)) { const fn = runMap.get(r._rid); close(); fn(); return; }
    if (r.href) go(r.href);
  }

  function close() {
    open = false;
    analyzeIntent = false;
    window.clearTimeout(extT);
    document.body.classList.remove('cmdk-open');
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    // 1-key accelerators for the current asset's inline sub-actions — only when the input is an
    // exact ticker AND the key can't lead toward a longer ticker, so typing is never hijacked.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const val = input.value.trim().toUpperCase(), k = e.key.toUpperCase(), ext = val + k;
      if (TICKERS[val] && !Object.keys(TICKERS).some((s) => s.startsWith(ext))) {
        const sec = rows.find((r) => (r.type === 'sec' || r.type === 'item') && r.key === k);
        if (sec) { e.preventDefault(); activate(sec); return; }
      }
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    // → drills into the selected security ONLY when the caret is at the end (else move the caret)
    else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && rows[sel] && rows[sel].drill) { e.preventDefault(); drill(rows[sel].drill); }
    // ← pops the scope ONLY when the caret is at the start (else move the caret); mirrors Backspace-at-empty
    else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) { if (popScope()) e.preventDefault(); }
    else if (e.key === 'Backspace' && input.value === '') { if (popScope()) e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(rows[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelector('.cmdk-esc').addEventListener('click', close);
  listEl.addEventListener('click', (e) => {
    const d = e.target.closest('.cmdk-drill');
    if (d) { e.stopPropagation(); drill(d.dataset.drill); return; }
    const b = e.target.closest('.cmdk-row'); if (!b) return;
    const r = rows[+b.dataset.i];
    activate(r);
  });
  // debounced FMP equity search (search scope only) — widens the universe beyond TICKERS
  let extT;
  const fetchExt = () => {
    window.clearTimeout(extT);
    const raw = input.value.trim();
    if (scope().kind !== 'search' || raw.length < 2) return;
    if (!/\s/.test(raw) && TICKERS[raw.toUpperCase()]) return;   // exact local ticker — no need

    extT = window.setTimeout(() => {
      fmp.searchName(raw, 6).then((res) => {
        // only the LIVE session may paint — a fetch surviving a close→reopen must die here
        if (sessionSeq !== mySession || !open || input.value.trim() !== raw) return;
        extEquities = {
          q: raw,
          rows: (Array.isArray(res) ? res : []).map((r) => {
            const sym = String(r.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
            if (!sym) return null;
            // Ticker collision: when a venue perp owns this ticker (ALT = AltLayer crypto),
            // address the EQUITY as "<SYM>.US" (Altimmune) so it routes to the stock, not the
            // crypto page. Non-colliding stocks keep their bare symbol.
            const collides = market.collidesWithVenue(sym);
            const addr = collides ? sym + '.US' : sym;
            // respect analyze-picker mode too (the local stockRow does) so FMP-only equities also route to the report
            return { type: 'stock', href: `#/${analyzeIntent ? 'analysis' : 'stock'}/${addr}`, sym, label: sym, sub: r.name || '', tag: (r.exchange || 'Equity') + (collides ? ' · stock' : '') };
          }).filter(Boolean),
        };
        paint();
      }).catch(() => { /* offline / no key — local results stand alone */ });
    }, 260);
  };
  // debounced trader search — same staleness discipline as fetchExt: a response that outlives
  // its query, or the palette session, must never paint.
  let usrT;
  const fetchUsers = () => {
    window.clearTimeout(usrT);
    const raw = input.value.trim();
    if (raw.length < 2 || /^0x/i.test(raw)) return;      // an address is handled directly above
    usrT = window.setTimeout(() => {
      fetch('/api/users/search?q=' + encodeURIComponent(raw))
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (sessionSeq !== mySession || !open || input.value.trim() !== raw) return;
          extUsers = {
            q: raw,
            rows: ((res && res.users) || []).map((u) => ({
              type: 'user', href: '#/u/' + u.handle, icon: 'user',
              label: '@' + u.handle, sub: u.name || '', tag: 'Trader',
            })),
          };
          paint();
        })
        .catch(() => { /* offline — local results stand alone */ });
    }, 260);
  };

  input.addEventListener('input', () => { sel = -1; paint(); fetchExt(); fetchUsers(); });
  document.addEventListener('keydown', onKey, true);
  paint();
  setTimeout(() => input.focus(), 60);
}
