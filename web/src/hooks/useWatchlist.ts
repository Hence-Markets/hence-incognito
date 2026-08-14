import { useCallback, useEffect, useState } from 'react';
import { watchList, addWatch, removeWatch, toggleWatch as toggleStore, setWatchList, hasWatch } from '../lib/watch';

// Reactive per-user watchlist. Single source of truth = lib/watch.ts (localStorage
// `hence.watch.v1`, an ORDERED array). Re-renders on:
//   • `hence:watch` — our own custom event, fired on every local mutation
//   • `storage`      — cross-tab edits
//   • `hence:me`     — login union (me.js merges the server list, then fires hence:watch)
// Exposes an ordered `symbols` array (newest first) plus imperative helpers. New symbols
// PREPEND (Fey behavior). Signed-out mutations persist locally and the server mirror no-ops.
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(() => watchList());

  useEffect(() => {
    const sync = () => setSymbols(watchList());
    window.addEventListener('hence:watch', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('hence:me', sync);
    return () => {
      window.removeEventListener('hence:watch', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('hence:me', sync);
    };
  }, []);

  const add = useCallback((s: string) => addWatch(s), []);
  const remove = useCallback((s: string) => removeWatch(s), []);
  const toggle = useCallback((s: string) => toggleStore(s), []);
  const reorder = useCallback((list: string[]) => setWatchList(list), []);
  const has = useCallback((s: string) => symbols.includes(String(s).toUpperCase()), [symbols]);

  return { symbols, add, remove, toggle, reorder, has, hasSym: hasWatch };
}
