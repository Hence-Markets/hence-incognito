/* pendingAsk — the landing → copilot handoff.

   The landing hero lets a visitor type a belief before they have an account. That prompt
   arrives as ?ask=… inside the app URL's hash (e.g. #/login?ask=…), gets captured HERE at
   module load (before any router/login redirect can strip it), and is stored with a TTL.
   PendingAskRunner (App.tsx) consumes it only AFTER the user is signed in and clear of
   login/onboarding/legal — so the thesis generation happens exactly once, post-auth,
   regardless of whether they were signed in, signing in, or brand new. */

const KEY = 'hence.pendingAsk';
const TTL_MS = 60 * 60_000;   // an hour is plenty for a sign-up flow

export function savePendingAsk(q: string) {
  const clean = String(q || '').trim().slice(0, 280);
  if (!clean) return;
  try { localStorage.setItem(KEY, JSON.stringify({ q: clean, ts: Date.now() })); } catch { /* storage off */ }
}

export function peekPendingAsk(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || typeof v.q !== 'string' || Date.now() - (v.ts || 0) > TTL_MS) { clearPendingAsk(); return null; }
    return v.q;
  } catch { return null; }
}

export function clearPendingAsk() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** Pull ?ask=… out of the current hash URL and stash it (idempotent, strips the param).
    Runs at module load from App.tsx so no login/route redirect can beat it to the URL. */
export function capturePendingAskFromUrl() {
  try {
    const hash = window.location.hash || '';
    const qi = hash.indexOf('?');
    if (qi < 0) return;
    const params = new URLSearchParams(hash.slice(qi + 1));
    const q = params.get('ask');
    if (!q) return;
    savePendingAsk(q);
    params.delete('ask');
    const rest = params.toString();
    const clean = hash.slice(0, qi) + (rest ? '?' + rest : '');
    history.replaceState(null, '', window.location.pathname + window.location.search + clean);
  } catch { /* malformed URL — ignore */ }
}
