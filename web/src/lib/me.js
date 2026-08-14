// Per-user account client — talks to /api/me/* through the same-origin authenticated
// transport. The Privy access token never leaves that module closure. Mirrors the profile onto
// window.henceMe and fires 'hence:me' so React screens AND vanilla modules can react live.
//
// The server keys everything off the verified Privy DID, so this is the single source of
// truth for per-user state (profile, interests, connections, watchlist) — replacing the
// per-browser localStorage that used to clobber across users.

import { peekPendingRef, clearPendingRef } from './pendingRef';
import { track } from './analytics';
import { authenticatedApiFetch, optionalAuthApiFetch } from './auth-transport.ts';

let _me = null;          // last loaded profile, or null when logged out / unavailable

export function currentMe() { return _me; }

async function api(path, { method = 'GET', body } = {}) {
  try {
    const r = await authenticatedApiFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      // surface the error body too (e.g. {error:'taken'} on a 409 handle claim)
      let detail = null;
      try { detail = await r.json(); } catch { /* not json */ }
      return { error: true, status: r.status, ...(detail || {}) };
    }
    return await r.json();
  } catch (error) {
    if (error && error.message === 'AUTH_REQUIRED') return { available: false, me: null, unauth: true };
    return { error: true };
  }
}

// product feedback → /api/feedback. Attributed to the user when signed in (bearer attached),
// but works ANONYMOUSLY too (the endpoint isn't under /api/me). Never throws.
export async function sendFeedback(body) {
  try {
    const r = await optionalAuthApiFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch { return { ok: false }; }
}

function _store(resp) {
  if (resp && resp.me) {
    const inc = resp.me;
    // Guard against OUT-OF-ORDER responses. On a fresh login the AuthBridge re-fires syncMe as
    // Privy's auth fields settle async; one of those can carry a pre-write profile snapshot and
    // resolve AFTER an explicit setHandle/setInterests, clobbering the fresher values back to
    // null/false → the OnboardingGate then re-traps the user at the username step. Sticky fields
    // never regress for the same user: onboarded is monotonic, and a claimed handle can't null out.
    if (_me && _me.privy_id && _me.privy_id === inc.privy_id) {
      if (_me.onboarded && !inc.onboarded) inc.onboarded = true;
      if (_me.handle && !inc.handle) inc.handle = _me.handle;
    }
    _me = inc;
    window.henceMe = _me;
    // persist a local completion marker keyed by user, so the gate never loops even if a later
    // sync momentarily shows onboarded:false (see OnboardingGate).
    try { if (inc.onboarded && inc.privy_id) localStorage.setItem('hence.onboarded', inc.privy_id); } catch { /* storage off */ }
    window.dispatchEvent(new CustomEvent('hence:me'));
  }
  return resp;
}

// upsert identity on login and return the freshly-loaded profile. A captured referral
// code rides along; the server records the referred_by edge once (new accounts only)
// and we clear the pending code on ANY definitive verdict.
export async function syncMe(identity) {
  const body = { ...(identity || {}) };
  const ref = peekPendingRef();
  if (ref) body.ref = ref;
  const resp = await _store(await api('/api/me', { method: 'POST', body }));
  if (ref && resp && !resp.error && resp.referral) {
    if (resp.referral === 'ok') track('referral_attributed', {});
    clearPendingRef();
  }
  return resp;
}

export async function loadMe() {
  return _store(await api('/api/me'));
}

export async function setInterests(interests) {
  return _store(await api('/api/me/interests', { method: 'POST', body: { interests } }));
}

// Optimistically record local onboarding completion. The OnboardingGate honours this so a user
// who finished the flow on this device is NEVER re-trapped at the username step — even if the
// server write raced or failed. Keyed by privy_id, so a different user still onboards.
export function markOnboarded() {
  try { const id = _me && _me.privy_id; if (id) localStorage.setItem('hence.onboarded', id); } catch { /* storage off */ }
}

/* ---------- username claim (onboarding) ---------- */
// availability probe → {status:'available'|'taken'|'yours'|'invalid'} (or {unauth:true}/{error})
export function checkHandle(h) {
  return api('/api/me/handle?h=' + encodeURIComponent(h || ''));
}

// claim it — 409 comes back as {error:true, status:409, error:'taken'}-ish; 200 refreshes the profile
export async function setHandle(h) {
  return _store(await api('/api/me/handle', { method: 'POST', body: { handle: h } }));
}

export async function saveConnection(c) {
  const r = await api('/api/me/connections', { method: 'POST', body: { op: 'add', ...c } });
  if (r && r.connections && _me) { _me = { ..._me, connections: r.connections }; window.henceMe = _me; window.dispatchEvent(new CustomEvent('hence:me')); }
  return r;
}

export async function removeConnection(id) {
  const r = await api('/api/me/connections', { method: 'POST', body: { op: 'remove', id } });
  if (r && r.connections && _me) { _me = { ..._me, connections: r.connections }; window.henceMe = _me; window.dispatchEvent(new CustomEvent('hence:me')); }
  return r;
}

export async function setWatchlist(symbols) {
  const r = await api('/api/me/watchlist', { method: 'POST', body: { symbols } });
  if (r && r.watchlist && _me) { _me = { ..._me, watchlist: r.watchlist }; window.henceMe = _me; }
  return r;
}

export async function toggleWatch(symbol, on) {
  return api('/api/me/watchlist', { method: 'POST', body: { symbol, on } });
}

export function clearMe() {
  _me = null;
  window.henceMe = null;
  window.dispatchEvent(new CustomEvent('hence:me'));
}

/* ---------- captured ideas (saves / agree / disagree / dismiss) ---------- */
// log a single reaction. Returns the server response ({ok:...} on success, {unauth:true}/{error}
// otherwise) so stash.record() can decide whether to mark the local row synced.
export function listIdeas(limit = 200) {
  return api('/api/me/ideas?limit=' + limit);
}
export function logIdea(payload) {
  return api('/api/me/ideas', { method: 'POST', body: payload });
}

// bulk-migrate the local (signed-out) stash queue on login. `items` are already in server shape.
export function migrateIdeas(items) {
  return api('/api/me/ideas/migrate', { method: 'POST', body: { items } });
}

// the user's derived theses (grouped saves) for the "From your stash" home block.
export function loadTheses() {
  return api('/api/me/theses');
}

// assert a thesis directly (belief spine created_by='user') — the onboarding belief card.
export function addThesis(t) {
  return api('/api/me/theses', { method: 'POST', body: t || {} });
}

// record the orders actually placed behind a thesis (one entry per FILLED leg), so the
// thesis reads as run and its executed total rolls up. Fire-and-forget: the trade already
// happened on-chain and its telemetry already went out, so a failed write is never fatal.
// corpus: the human's decision about a proposed plan — the config actually run, or the
// sheet walked away from. Fire-and-forget by contract: capture never blocks trading.
export function rebates() {
  return api('/api/me/rebates');
}

export function planFeedback(body) {
  return api('/api/me/plan-feedback', { method: 'POST', body: body || {} });
}

export function recordThesisExecutions(thesisId, executions, originThesisId) {
  return api('/api/me/theses/executions', {
    method: 'POST',
    body: { thesis_id: thesisId, executions, origin_thesis_id: originThesisId || null },
  });
}

// credit another user's thesis when you take it (save or run). The unique (adopter, origin,
// action) edge means repeating the action never inflates their reach.
export function adoptThesis(originThesisId, action, opts) {
  return api('/api/me/theses/adopt', {
    method: 'POST',
    body: { origin_thesis_id: originThesisId, action, ...(opts || {}) },
  });
}

// opt out of (or back into) auto-publishing the theses you run. Turning it off also
// retracts anything already published.
export function setShareTheses(on) {
  return api('/api/me/share-theses', { method: 'POST', body: { on: !!on } });
}

// follow / unfollow another trader by handle. Idempotent both ways, so an optimistic UI that
// double-fires (or a retry) can never leave the edge in the wrong state.
export function followUser(handle, on) {
  return api('/api/me/follow', { method: 'POST', body: { handle, on: !!on } });
}

// the algorithm trail (Settings → Your algorithm): per-topic drift + recent nudges.
export function loadAlgo(days = 7) {
  return api('/api/me/algo?days=' + encodeURIComponent(days));
}

/* ---------- login union: merge the server watchlist into local (add-only) ----------
   Lives here (me.js is eagerly loaded) — not in the lazily-loaded MarketSelect chunk —
   so a deep-link into any screen still gets the union. Server entries are APPENDED after
   the local order (local edits keep priority / recency at the top), never removed; a push
   back to the server only happens on an explicit user edit via watch.saveWatch(). */
const _WATCH_KEY = 'hence.watch.v1';
if (typeof window !== 'undefined' && !window.__henceWatchUnion) {
  window.__henceWatchUnion = true;
  window.addEventListener('hence:me', () => {
    const srv = window.henceMe && window.henceMe.watchlist;
    if (!Array.isArray(srv) || !srv.length) return;
    let local;
    try { local = JSON.parse(localStorage.getItem(_WATCH_KEY) || '[]'); } catch { local = []; }
    if (!Array.isArray(local)) local = [];
    const have = new Set(local.map((s) => String(s).toUpperCase()));
    const merged = local.slice();
    let changed = false;
    srv.forEach((x) => { const u = String(x).toUpperCase(); if (!have.has(u)) { merged.push(u); have.add(u); changed = true; } });
    if (changed) {
      try { localStorage.setItem(_WATCH_KEY, JSON.stringify(merged)); } catch { /* noop */ }
      try { window.dispatchEvent(new CustomEvent('hence:watch')); } catch { /* noop */ }
    }
  });
}
