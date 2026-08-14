import { track } from './analytics';
import { marketSymbols, isIncognitoMarket } from './markets';
/* =========================================================
   watch.ts — the ONE source of truth for the per-user watchlist.

   Storage: localStorage `hence.watch.v1` = an ORDERED array of tickers
   (insertion order preserved; new adds PREPEND to the top, matching Fey's
   "newly added symbols appear at the top of Stocks"). When signed in, every
   change mirrors to the user's account (me.setWatchlist) so the list follows
   them across devices.

   Reactivity: every mutation dispatches a `hence:watch` CustomEvent so React
   (useWatchlist) and any vanilla module re-read in lock-step, in addition to
   the native `storage` event fired for OTHER tabs.

   The login union (merge the server list into local, add-only) lives in me.js
   — always loaded — so deep-links get the union even if this chunk is idle.
   ========================================================= */

const WATCH_KEY = 'hence.watch.v1';

// A curated starter watchlist so the portfolio + home show a real list of assets on day one
// (Fey behaviour) instead of an empty "connect your wallet" state. A cross-asset mix of names
// people recognise. Seeded LOCALLY on first read (not pushed to the account until the first
// edit); a user who deliberately empties their list stores '[]', so defaults never come back.
// INCOGNITO: Avantis DOES list equities (NVDA/AAPL/TSLA/MSFT/AMD/AMZN/COIN…), so seven of
// Hence's ten defaults survive. Only GOOGL, GOLD and SP500 are absent and were swapped out.
export /* INCOGNITO: the watchlist is the tradable set — the three netted markets. Hence's ten
   defaults included GOOGL, GOLD and SP500, which Avantis does not list under those names, and
   seven more that it does list but we deliberately do not offer (see lib/markets.ts: netting
   needs flow to concentrate). A strip of chips you cannot trade is an invitation to click one. */
const DEFAULT_WATCH = marketSymbols();

/** ordered list of watched tickers (newest first). */
export function watchList(): string[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (raw == null) {
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(DEFAULT_WATCH)); } catch { /* quota */ }
      return DEFAULT_WATCH.slice();
    }
    const v = JSON.parse(raw || '[]');
    if (!Array.isArray(v)) return [];
    /* Prune anything outside the netted markets. DEFAULT_WATCH only applies on a FIRST run, so
       without this every browser that ever loaded the app keeps a strip of chips it can no
       longer trade — and the demo laptop is exactly such a browser. */
    return v.map((s) => String(s).toUpperCase()).filter(isIncognitoMarket);
  } catch { return []; }
}

/** back-compat Set view (unordered) for existing callers (Dashboard/Terminal/MarketSelect). */
export function getWatch(): Set<string> {
  return new Set(watchList());
}

export function hasWatch(sym: string): boolean {
  return watchList().includes(String(sym).toUpperCase());
}

/** persist an ordered list + mirror to the server + notify listeners. */
function writeList(list: string[]) {
  // de-dupe defensively while preserving order
  const seen = new Set<string>();
  const clean = list.map((s) => String(s).toUpperCase()).filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(clean)); } catch { /* quota / disabled */ }
  // when signed in, mirror the full list so it follows the user across devices
  if ((window as any).henceMe) import('./me.js').then((m) => m.setWatchlist(clean)).catch(() => {});
  try { window.dispatchEvent(new CustomEvent('hence:watch')); } catch { /* noop */ }
}

/** replace the whole list (used by drag-reorder / sort). */
export function setWatchList(list: string[]) { writeList(list); }

/** accepts either a Set (order lost → appended) or leaves callers on the ordered path. */
export function saveWatch(s: Set<string> | string[]) {
  if (Array.isArray(s)) { writeList(s); return; }
  // Set input: keep any existing order, append the rest (back-compat for MarketSelect's local toggle)
  const cur = watchList();
  const incoming = [...s].map((x) => String(x).toUpperCase());
  const kept = cur.filter((x) => incoming.includes(x));
  const added = incoming.filter((x) => !kept.includes(x));
  writeList([...added, ...kept]);
}

/** add a symbol to the TOP of the list (Fey prepend). No-op if already present-at-top. */
export function addWatch(sym: string) {
  track('watchlist_added', { sym });
  const s = String(sym).toUpperCase();
  const cur = watchList().filter((x) => x !== s);
  writeList([s, ...cur]);
}

export function removeWatch(sym: string) {
  const s = String(sym).toUpperCase();
  writeList(watchList().filter((x) => x !== s));
}

/** toggle membership. New symbols PREPEND. Returns true if now watched. */
export function toggleWatch(sym: string): boolean {
  const s = String(sym).toUpperCase();
  if (hasWatch(s)) { removeWatch(s); return false; }
  addWatch(s);
  return true;
}

/* =========================================================
   Custom lists — named user sections that sit ABOVE the default "Stocks" section.
   Storage: localStorage `hence.watchlists.v1` = [{ name, symbols[] }] (client-only;
   the flat watchlist above is what mirrors to the server — list grouping is local).
   Deleting a list keeps its symbols in the flat watchlist (they just fall back to Stocks).
   Every mutation fires `hence:watch` so the drawer + screen refresh in lock-step.
   ========================================================= */
export type WatchList = { name: string; symbols: string[] };
const LISTS_KEY = 'hence.watchlists.v1';

export function customLists(): WatchList[] {
  try {
    const v = JSON.parse(localStorage.getItem(LISTS_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((l) => l && typeof l.name === 'string')
      .map((l) => ({ name: l.name, symbols: Array.isArray(l.symbols) ? l.symbols.map((s: any) => String(s).toUpperCase()) : [] }));
  } catch { return []; }
}

function writeLists(lists: WatchList[]) {
  try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('hence:watch')); } catch { /* noop */ }
}

/** create a named list (idempotent on name). Also ensures the flat watchlist tracks its symbols. */
export function createList(name: string, symbols: string[] = []) {
  const nm = name.trim();
  if (!nm) return;
  const lists = customLists();
  if (lists.some((l) => l.name.toLowerCase() === nm.toLowerCase())) return;
  const syms = symbols.map((s) => String(s).toUpperCase());
  writeLists([{ name: nm, symbols: syms }, ...lists]);
  // any symbols placed in a list must also live in the flat (server-mirrored) watchlist
  syms.forEach((s) => addWatch(s));
}

/** delete a list. Its symbols stay in the flat watchlist (they reappear under Stocks). */
export function deleteList(name: string) {
  writeLists(customLists().filter((l) => l.name.toLowerCase() !== name.toLowerCase()));
}

/** add a symbol to a named list (and to the flat watchlist). */
export function addToList(name: string, sym: string) {
  const s = String(sym).toUpperCase();
  const lists = customLists().map((l) =>
    l.name.toLowerCase() === name.toLowerCase() && !l.symbols.includes(s)
      ? { ...l, symbols: [s, ...l.symbols] } : l);
  writeLists(lists);
  addWatch(s);
}

/** remove a symbol from a named list only (leaves it in the flat watchlist / Stocks). */
export function removeFromList(name: string, sym: string) {
  const s = String(sym).toUpperCase();
  writeLists(customLists().map((l) =>
    l.name.toLowerCase() === name.toLowerCase() ? { ...l, symbols: l.symbols.filter((x) => x !== s) } : l));
}

/** the symbols that belong to NO custom list — i.e. the default "Stocks" section. */
export function stocksSection(): string[] {
  const claimed = new Set(customLists().flatMap((l) => l.symbols));
  return watchList().filter((s) => !claimed.has(s));
}
