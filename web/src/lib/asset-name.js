/* =========================================================
   Asset display names — turns a bare ticker into a real name
   (DYDX → "dYdX", MORPHO → "Morpho") for tooltips + labels.

   Source order: a known universe/static name → CoinGecko (lazy,
   batched, cached in localStorage). Unknown tickers fall back to
   the ticker itself; each is fetched at most once. When new names
   arrive a `hence:names` event fires so views can re-render.
   ========================================================= */
import { getTicker } from './data.js';

const KEY = 'hence.names.v1';
let _names = new Map();
try { _names = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))); } catch { /* noop */ }

const _tried = new Set();     // tickers we've already tried to resolve (avoid refetch loops)
const _queue = new Set();
let _timer = null;

// best-known name, or null if we don't have a real one (just the ticker)
export function nameOf(sym) {
  const S = String(sym || '').toUpperCase();
  if (!S) return null;
  if (_names.has(S)) return _names.get(S) || null;
  const t = getTicker(sym);
  if (t && t.name && t.name.toUpperCase() !== S) return t.name; // real universe/static name
  return null;
}

// synchronous label for rendering — the name if known, else the ticker
export function displayName(sym) {
  return nameOf(sym) || String(sym || '').toUpperCase();
}

function flush() {
  _timer = null;
  const syms = [..._queue];
  _queue.clear();
  if (!syms.length) return;
  syms.forEach((s) => _tried.add(s));
  fetch('/api/coinmeta?c=' + encodeURIComponent(syms.join(',').toLowerCase()))
    .then((r) => r.json())
    .then((m) => {
      let changed = false;
      for (const [k, v] of Object.entries(m || {})) {
        const K = k.toUpperCase();
        if (v && _names.get(K) !== v) { _names.set(K, v); changed = true; }
      }
      if (changed) {
        try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(_names))); } catch { /* noop */ }
        window.dispatchEvent(new CustomEvent('hence:names'));
      }
    })
    .catch(() => { /* leave as ticker */ });
}

// queue tickers lacking a real name for a debounced batched CoinGecko lookup
export function ensureNames(syms) {
  let added = false;
  for (const s of syms || []) {
    const S = String(s || '').toUpperCase();
    if (!S || nameOf(S) || _tried.has(S) || _queue.has(S)) continue;
    _queue.add(S);
    added = true;
  }
  if (added && !_timer) _timer = setTimeout(flush, 200);
}
