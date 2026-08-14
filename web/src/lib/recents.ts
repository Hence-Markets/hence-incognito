/* =========================================================================
   recents — a tiny localStorage ring of the assets the user actually opened
   (asset page + trade terminal push here; the command menu's "Recent" group
   reads it). Newest first, deduped, capped.
   ========================================================================= */
const KEY = 'hence.recent';
const MAX = 8;

export function pushRecent(sym: string) {
  // whitelist-sanitize: the sym comes from the URL and lands in data-href attributes, so it
  // must never carry markup-breaking characters (mirrors the palette's FMP-sym sanitizer)
  const s = String(sym || '').toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, '');
  if (!s || s.length > 12) return;
  try {
    let cur: string[] = [];
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(v)) cur = v.filter((x) => typeof x === 'string' && x !== s);
      // non-array → corrupted store: fall through with [] so the write below SELF-HEALS it
    } catch { /* corrupted JSON — self-heal below */ }
    cur.unshift(s);
    localStorage.setItem(KEY, JSON.stringify(cur.slice(0, MAX)));
  } catch { /* storage disabled */ }
}

export function recents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}
