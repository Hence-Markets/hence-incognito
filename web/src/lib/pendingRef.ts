/* pendingRef — the referral-link capture rail (mirrors pendingAsk).

   A visitor lands with ?ref=<code> (from hence.markets/?ref=… forwarded by the
   landing, or a direct app link). The code is captured HERE at module load —
   before any router/login redirect can strip it — and stored with a long TTL
   (signup can take days). me.js syncMe() sends it with the login sync, where
   the server records the referred_by edge exactly once (new accounts only,
   never self, never overwritten), then we clear it. */

const KEY = 'hence.pendingRef';
const TTL_MS = 30 * 24 * 60 * 60_000;   // 30 days — a referral link should survive a slow signup

export function savePendingRef(code: string) {
  const clean = String(code || '').trim().replace(/^@/, '').slice(0, 40);
  if (!clean) return;
  try { localStorage.setItem(KEY, JSON.stringify({ code: clean, ts: Date.now() })); } catch { /* storage off */ }
}

export function peekPendingRef(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || typeof v.code !== 'string' || Date.now() - (v.ts || 0) > TTL_MS) { clearPendingRef(); return null; }
    return v.code;
  } catch { return null; }
}

export function clearPendingRef() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** Pull ?ref=… out of the URL (hash query AND plain search) and stash it. Runs at
    module load from App.tsx. Strips the param from the hash so it never re-captures. */
export function capturePendingRefFromUrl() {
  try {
    const search = new URLSearchParams(window.location.search || '');
    if (search.get('ref')) savePendingRef(search.get('ref')!);
    const hash = window.location.hash || '';
    const qi = hash.indexOf('?');
    if (qi < 0) return;
    const params = new URLSearchParams(hash.slice(qi + 1));
    const code = params.get('ref');
    if (!code) return;
    savePendingRef(code);
    params.delete('ref');
    const rest = params.toString();
    const clean = hash.slice(0, qi) + (rest ? '?' + rest : '');
    history.replaceState(null, '', window.location.pathname + window.location.search + clean);
  } catch { /* malformed URL — ignore */ }
}
