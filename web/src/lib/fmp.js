/* =========================================================
   FMP client — talks to the local /api/fmp/<endpoint> proxy,
   which injects the secret key server-side and caches responses.
   Covers the data Hydromancer can't: fundamentals, analyst,
   earnings, insider, news, macro. (FMP "stable" API.)
   ========================================================= */
const BASE = '/api/fmp/';
const _cache = new Map();      // path -> { t, v }
const _inflight = new Map();

async function get(path, { ttl = 0 } = {}) {
  if (ttl) { const e = _cache.get(path); if (e && Date.now() - e.t < ttl) return e.v; }
  if (_inflight.has(path)) return _inflight.get(path);
  const p = fetch(BASE + path)
    .then(r => r.json())
    .then(v => {
      if (v && (v['Error Message'] || v.error)) throw new Error(v['Error Message'] || v.error);
      if (ttl) _cache.set(path, { t: Date.now(), v });
      return v;
    })
    .finally(() => _inflight.delete(path));
  _inflight.set(path, p);
  return p;
}
const first = (a) => (Array.isArray(a) ? a[0] : a) || null;
const H6 = 6 * 3600_000, H1 = 3600_000, M30 = 30 * 60_000, M1 = 60_000;

/* ---- typed helpers (symbol = FMP ticker) ---- */
export const profile = (s) => get(`profile?symbol=${s}`, { ttl: H6 }).then(first);
export const quote = (s) => get(`quote?symbol=${s}`, { ttl: M1 }).then(first);
export const keyMetricsTtm = (s) => get(`key-metrics-ttm?symbol=${s}`, { ttl: H6 }).then(first);
export const ratiosTtm = (s) => get(`ratios-ttm?symbol=${s}`, { ttl: H6 }).then(first);
export const incomeStatement = (s, period = 'annual', limit = 5) => get(`income-statement?symbol=${s}&period=${period}&limit=${limit}`, { ttl: H6 });
export const balanceSheet = (s, period = 'annual', limit = 2) => get(`balance-sheet-statement?symbol=${s}&period=${period}&limit=${limit}`, { ttl: H6 });
export const cashFlow = (s, period = 'annual', limit = 2) => get(`cash-flow-statement?symbol=${s}&period=${period}&limit=${limit}`, { ttl: H6 });
export const stockPeers = (s) => get(`stock-peers?symbol=${s}`, { ttl: H6 });
export const analystEstimates = (s, period = 'annual', limit = 10) => get(`analyst-estimates?symbol=${s}&period=${period}&limit=${limit}`, { ttl: H6 });
export const priceTarget = (s) => get(`price-target-consensus?symbol=${s}`, { ttl: H1 }).then(first);
export const grades = (s) => get(`grades-consensus?symbol=${s}`, { ttl: H1 }).then(first);
export const earnings = (s, limit = 16) => get(`earnings?symbol=${s}&limit=${limit}`, { ttl: H1 });
export const insiderTrades = (s, limit = 20) => get(`insider-trading/search?symbol=${s}&page=0&limit=${limit}`, { ttl: H1 });
// news polls in near-real-time — short TTL so the terminal feed picks up fresh articles.
// passing symbols broadens coverage (the default crypto feed is Bitcoin-dominated).
export const stockNews = (s, limit = 12) => get(`news/stock?symbols=${s}&limit=${limit}`, { ttl: M1 });
export const cryptoNews = (limit = 30, symbols) => get(`news/crypto?${symbols ? `symbols=${symbols}&` : ''}limit=${limit}`, { ttl: M1 });
export const earningsCalendar = (from, to) => get(`earnings-calendar?from=${from}&to=${to}`, { ttl: H1 });
// EOD daily price history (research-mode charts for non-venue symbols) — rows newest-first
export const eodHistory = (s, from, to) => get(`historical-price-eod/full?symbol=${s}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`, { ttl: H6 });
export const economicCalendar = (from, to) => get(`economic-calendar?from=${from}&to=${to}`, { ttl: H1 });
export const searchName = (q, limit = 6) => get(`search-name?query=${encodeURIComponent(q)}&limit=${limit}`, { ttl: H1 });
// US Treasury yields per date across tenors (month1..year30) — real yield curve + 2s10s spread
export const treasuryRates = (from, to) => get(`treasury-rates?from=${from}&to=${to}`, { ttl: H6 });
// recent per-firm rating actions: [{date, gradingCompany, previousGrade, newGrade, action}]
export const gradesHistory = (s, limit = 20) => get(`grades?symbol=${s}&limit=${limit}`, { ttl: H6 });

/* low-level escape hatch for endpoints not wrapped above */
export const raw = (path, ttl = H1) => get(path, { ttl });
