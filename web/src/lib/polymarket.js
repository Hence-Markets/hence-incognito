/* =========================================================
   Polymarket client — free public Gamma + CLOB APIs, proxied
   via /api/poly (server-side, for CORS + caching). Powers the
   prediction-market side of the terminal.
   ========================================================= */
const BASE = '/api/poly/';
const _cache = new Map(), _inflight = new Map();

async function get(path, ttl = 0) {
  if (ttl) { const e = _cache.get(path); if (e && Date.now() - e.t < ttl) return e.v; }
  if (_inflight.has(path)) return _inflight.get(path);
  const p = fetch(BASE + path).then(r => r.json()).then(v => {
    if (v && v.error) throw new Error(v.error);
    if (ttl) _cache.set(path, { t: Date.now(), v });
    return v;
  }).finally(() => _inflight.delete(path));
  _inflight.set(path, p);
  return p;
}
const j = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

/* one raw Gamma market → the clean shape the app trades on (single source of truth) */
export function mapMarket(m) {
  if (!m) return null;
  const outs = j(m.outcomes, []), prices = j(m.outcomePrices, []).map(Number), toks = j(m.clobTokenIds, []);
  const yesIdx = outs.findIndex(o => /yes/i.test(o));
  const yi = yesIdx >= 0 ? yesIdx : 0, ni = yi === 0 ? 1 : 0;
  return {
    id: m.id, question: m.question, slug: m.slug, icon: m.image || m.icon,
    conditionId: m.conditionId || '',
    yes: prices[yi], no: prices[ni],
    tokenYes: toks[yi], tokenNo: toks[ni],
    volume24hr: +m.volume24hr || 0, liquidity: +m.liquidity || 0, endDate: m.endDate,
    category: m.category || '', outcomes: outs, description: m.description || '',
    // gamma occasionally returns resolved-but-not-yet-closed markets even with
    // closed=false — the UMA status is the honest signal
    resolved: /resolved/i.test(String(m.umaResolutionStatus || '')),
  };
}

/* top active markets → clean shape (resolved-but-not-closed ones filtered out) */
export async function markets(limit = 24) {
  const raw = await get(`gamma/markets?limit=${limit}&closed=false&active=true&order=volume24hr&ascending=false`, 30_000).catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw.map(mapMarket).filter(m => m && m.question && m.yes != null && !m.resolved);
}

/* CLOB order book for one outcome token → { bids:[{px,sz}], asks:[{px,sz}] } (px = probability 0–1).
   Short TTL so the 3–4s poll in the terminal actually pulls fresh depth (feels live). */
export async function book(tokenId) {
  const b = await get(`clob/book?token_id=${tokenId}`, 2_000).catch(() => null);
  if (!b) return null;
  const lvl = (a) => (a || []).map(l => ({ px: +l.price, sz: +l.size })).filter(x => x.px > 0);
  return { bids: lvl(b.bids), asks: lvl(b.asks) };
}

/* recent PUBLIC trades for a market (data-api, no signing) → newest-first, clean shape.
   Keyed by the market's conditionId (0x…). Each: { side:'BUY'|'SELL', price, size, outcome,
   outcomeIndex, time (s), trader, txHash }. Powers the live "Trades" tape. */
export async function trades(conditionId, limit = 40) {
  if (!conditionId) return [];
  const raw = await get(`data/trades?market=${conditionId}&limit=${limit}&takerOnly=false`, 3_000).catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw.map(t => ({
    side: (t.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    price: +t.price || 0,
    size: +t.size || 0,
    outcome: t.outcome || '',
    outcomeIndex: t.outcomeIndex != null ? +t.outcomeIndex : (/yes/i.test(t.outcome || '') ? 0 : 1),
    time: +t.timestamp || 0,
    trader: t.name || t.pseudonym || (t.proxyWallet ? t.proxyWallet.slice(0, 6) + '…' + t.proxyWallet.slice(-4) : ''),
    txHash: t.transactionHash || '',
  })).filter(t => t.size > 0 && t.price > 0);
}

export const priceHistory = (tokenId, interval = '1w') =>
  get(`clob/prices-history?market=${tokenId}&interval=${interval}&fidelity=60`, 60_000).catch(() => null);

/* ---- price-ladder events (crypto): GET gamma/events?tag_id=21 (crypto tag) ----
   Returns a de-noised list of "ladder" events — an event whose markets carry ≥5
   parseable numeric strike labels with a monotonic-ish P(yes). Each ladder:
   { id, title, endDate, points:[{strike, p, marketId}], marketId } where marketId
   is the first (lowest-strike) market for a #/predict deep-link.
   Filters to the given coin by matching its ticker/name on a word boundary in the title. */
const _numFromLabel = (s) => {
  if (!s) return null;
  // strip $ and commas; support "100k"/"1.2M" style; grab the first numeric token
  const m = String(s).replace(/,/g, '').match(/\$?\s*([0-9]*\.?[0-9]+)\s*([kKmMbB])?/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
  return isFinite(v) ? v : null;
};

export async function events(tagId = 21, limit = 120) {
  return get(`gamma/events?tag_id=${tagId}&closed=false&limit=${limit}&order=volume24hr&ascending=false`, 60_000)
    .catch(() => []);
}

/* Best ladder for a coin, or null. `words` = [ticker, name?] matched on the title. */
export async function coinLadders(words, tagId = 21) {
  const list = await events(tagId).catch(() => []);
  if (!Array.isArray(list)) return [];
  const clean = (words || []).filter(Boolean).map(w => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!clean.length) return [];
  const re = new RegExp('\\b(' + clean.join('|') + ')\\b', 'i');
  const out = [];
  for (const ev of list) {
    if (!ev || !re.test(ev.title || '')) continue;
    const mkts = Array.isArray(ev.markets) ? ev.markets : [];
    const points = [];
    for (const mk of mkts) {
      const strike = _numFromLabel(mk.groupItemTitle);
      const prices = j(mk.outcomePrices, null);
      if (strike == null || !Array.isArray(prices) || !prices.length) continue;
      const p = Number(prices[0]);                    // outcome[0] = "Yes" for these markets
      if (!isFinite(p)) continue;
      points.push({ strike, p, marketId: mk.id });
    }
    if (points.length < 5) continue;                  // a real ladder has ≥5 strikes
    points.sort((a, b) => a.strike - b.strike);
    // a LIVE ladder has probabilities that actually span a range — a fully-resolved one
    // is all ~0 / ~1 and reads as a spike. Count strikes that are genuinely uncertain.
    const live = points.filter(p => p.p > 0.03 && p.p < 0.97).length;
    const end = ev.endDate ? Date.parse(ev.endDate) : Infinity;
    // "P(above strike)" ladders decay monotonically as strike rises — that's the clean
    // downward curve the movement card wants (vs "will it ever hit X" cumulative markets,
    // which are non-monotonic). Score the monotonic-decreasing fraction + an above/on title cue.
    let mono = 0; for (let i = 1; i < points.length; i++) if (points[i].p <= points[i - 1].p + 0.02) mono++;
    const monoFrac = mono / (points.length - 1);
    const aboveTitle = /\babove\b/i.test(ev.title || '') ? 1 : 0;
    out.push({ id: ev.id, title: ev.title, endDate: ev.endDate, points, marketId: points[0].marketId, live, end, monoFrac, aboveTitle });
  }
  // prefer a clean monotonic "P(above strike)" curve (≥85% monotone), then an above-title cue,
  // then the most LIVE (uncertain) strikes, then nearest expiry.
  const isClean = (l) => l.monoFrac >= 0.85 ? 1 : 0;
  return out.sort((a, b) =>
    (isClean(b) - isClean(a)) || (b.aboveTitle - a.aboveTitle) || (b.live - a.live) || (a.end - b.end));
}

/* one market by id — direct Gamma by-id fetch first (resolves deep-linked long-tail
   markets outside the top-volume window), falling back to the cached top lists. */
export async function market(id) {
  if (id == null) return null;
  const direct = await get(`gamma/markets/${encodeURIComponent(id)}`, 30_000).catch(() => null);
  if (direct && direct.id) { const m = mapMarket(direct); if (m && m.question) return m; }
  for (const n of [60, 200]) {
    const all = await markets(n).catch(() => []);
    const m = all.find(x => String(x.id) === String(id));
    if (m) return m;
  }
  return null;
}

/* the user's Polymarket positions (public data-api, no signing) → clean holdings.
   Each: { token, marketId, title, outcome, shares, avgPrice, curPrice, value, cost, pnl, pnlPct }. */
export async function positions(address) {
  if (!address) return [];
  const raw = await get(`data/positions?user=${address}&sizeThreshold=0.1&limit=100`, 20_000).catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    const shares = +p.size || 0;
    const avgPrice = +p.avgPrice || 0;
    const curPrice = p.curPrice != null ? +p.curPrice : (+p.price || 0);
    const value = p.currentValue != null ? +p.currentValue : shares * curPrice;
    const cost = p.initialValue != null ? +p.initialValue : shares * avgPrice;
    const pnl = p.cashPnl != null ? +p.cashPnl : (value - cost);
    return {
      token: p.asset || p.tokenId, marketId: p.conditionId || p.marketId || p.market,
      title: p.title || p.question || '', outcome: p.outcome || '',
      shares, avgPrice, curPrice, value, cost, pnl,
      pnlPct: p.percentPnl != null ? +p.percentPnl : (cost > 0 ? (pnl / cost) * 100 : 0),
      redeemable: !!p.redeemable, endDate: p.endDate || '',
    };
  }).filter(p => p.shares > 0);
}
