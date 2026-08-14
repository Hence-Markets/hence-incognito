/* =========================================================
   Signals client — reads the podcast/newsletter trade-call
   tracker from serve.py (/api/signals/*), which owns the
   local `hence_signals` Postgres + the extraction/pricing
   pipeline. Returns finished, priced rows; never any keys.
   ========================================================= */
const _cache = new Map();
const M2 = 120_000;

async function get(path, ttl = M2) {
  const e = _cache.get(path);
  if (e && Date.now() - e.t < ttl) return e.v;
  const r = await fetch(path);
  const v = await r.json();
  _cache.set(path, { t: Date.now(), v });
  return v;
}

/* recent priced calls (optionally filtered to one asset symbol) */
export async function recentCalls(limit = 24, instrument) {
  const q = `/api/signals/recent?limit=${limit}` + (instrument ? `&instrument=${encodeURIComponent(instrument)}` : '');
  const v = await get(q);
  return { available: !!v.available, calls: v.calls || [] };
}

/* caller / source leaderboard */
export async function leaderboard(entity = 'person', horizon = '30d', minN = 1) {
  const v = await get(`/api/signals/leaderboard?entity=${entity}&horizon=${horizon}&min_n=${minN}`);
  return { available: !!v.available, leaders: v.leaders || [] };
}

export async function stats() {
  const v = await get('/api/signals/stats', 30_000);
  return v.stats || null;
}

/* full source breakdown — source + episodes + calls (the hero page) */
export async function source(id) {
  const v = await get(`/api/signals/source/${id}`);
  return { available: !!v.available, source: v.source || null };
}

/* per-show list with sort (newest|pnl) + speaker filter */
export async function show(id, sort = 'newest', speaker) {
  const q = `/api/signals/show/${id}?sort=${sort}` + (speaker ? `&speaker=${speaker}` : '');
  const v = await get(q);
  return { available: !!v.available, show: v.show || null };
}

/* cross-source consensus for one asset (what the voices are saying about SYM) */
export async function asset(sym) {
  const v = await get(`/api/signals/asset/${encodeURIComponent(sym)}`);
  return { available: !!v.available, ...(v.asset || {}) };
}

/* home/agent digest cards (top caller, consensus, hot call) */
export async function digest(window = '7d', world) {
  const v = await get(`/api/signals/digest?window=${window}` + (world ? `&world=${world}` : ''), 5 * 60_000);
  return { available: !!v.available, cards: v.cards || [] };
}
