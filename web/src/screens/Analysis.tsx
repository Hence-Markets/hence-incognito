/* AI Analysis report — Fundamentals / SEC filings (React port of analysis.js) */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { SvgChart } from '../components/SvgChart';
import { Segmented, SectionTabs } from '../components/Segmented';
import { barChart } from '../lib/charts.js';
import { getTicker } from '../lib/data.js';
import { fmtPct, cls } from '../lib/ui.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import * as ai from '../lib/ai.js';
import { coinInfo } from '../lib/coininfo';
import { pushRecent } from '../lib/recents';
import { useMarketReady } from '../hooks/useMarket';
import { Skeleton, SkeletonValue } from '../components/Loading';

const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const anCompact = (v: any) => {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return '' + v;
};

function tintOf(hex: string) {
  const h = (hex || '#3f3f46').replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}

// FMP stock-peers → list of peer tickers, tolerating both the flat array shape
// [{symbol,…}] and the older {peersList:[…]} envelope.
function peerSymbols(peers: any): string[] {
  if (Array.isArray(peers)) return peers.map((p: any) => (typeof p === 'string' ? p : p && p.symbol)).filter(Boolean);
  if (peers && peers[0] && Array.isArray(peers[0].peersList)) return peers[0].peersList.filter(Boolean);
  return [];
}

// median of a metric across the PEER rows (the subject is excluded) — shared by the
// "vs peer median" strip and the AI take so the prose cites the same numbers the UI shows.
function peerMedian(rows: any[], key: string): number | null {
  const xs = rows.filter((r) => r && !r.isSubject).map((r) => r[key]).filter((v: any) => v != null && !isNaN(v)).sort((a: number, b: number) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// Build the peer-comparison table: the subject + its peers, each with the valuation /
// cash-flow / scale metrics Fey shows (FCF/share, LTM revenue, EV/sales, P/E, mkt cap, 1D).
// Everything comes from quote + ratios-ttm + key-metrics-ttm (per symbol; batch isn't on plan).
async function buildPeers(sym: string): Promise<any[] | null> {
  const fs = market.fmpSymbol(sym);
  const peersRaw: any = await fmp.stockPeers(fs).catch(() => null);
  const syms = Array.from(new Set([fs, ...peerSymbols(peersRaw)])).filter(Boolean).slice(0, 8);
  if (syms.length < 2) return null;
  const rows = await Promise.all(syms.map(async (s) => {
    const [q, r, k]: any[] = await Promise.all([
      fmp.quote(s).catch(() => null),
      fmp.ratiosTtm(s).catch(() => null),
      fmp.keyMetricsTtm(s).catch(() => null),
    ]);
    if (!q && !r && !k) return null;
    const mktCap = (q && q.marketCap != null ? q.marketCap : (k && k.marketCap));
    const evSales = k && k.evToSalesTTM;
    const ev = (k && k.enterpriseValueTTM != null) ? k.enterpriseValueTTM : (r && r.enterpriseValueTTM);
    // LTM revenue: EV ÷ EV/sales (both TTM); fall back to rev/share × shares.
    let ltmRevenue: number | null = (ev != null && evSales) ? ev / evSales : null;
    if (ltmRevenue == null && r && r.revenuePerShareTTM != null && mktCap && q && q.price) ltmRevenue = r.revenuePerShareTTM * (mktCap / q.price);
    return {
      sym: s, name: (q && q.name) || s,
      fcfPerShare: r && r.freeCashFlowPerShareTTM,
      ltmRevenue, evSales,
      pe: r && r.priceToEarningsRatioTTM,
      mktCap, change: q && q.change, changePct: q && q.changePercentage,
      isSubject: s === fs,
    };
  }));
  let out = rows.filter(Boolean) as any[];
  // foreign reporters (a JPY/CNY-reporting ADR) return per-share/revenue/EV figures in
  // local currency while market cap + price are in USD — yielding absurd revenue and
  // meaningless multiples. Detect via an implausibly low implied P/S (USD cap ÷ local-
  // currency revenue) and null those currency-denominated cells (shown as "—", the way Fey
  // shows N/A for cross-currency peers); keep market cap + the 1D return, which stay in USD.
  // 0.13 cleanly separates CNY/JPY ADRs (~0.07-0.11) from real US/EU autos (GM 0.38, F 0.29).
  for (const r of out) {
    if (r.ltmRevenue && r.mktCap && r.mktCap / r.ltmRevenue < 0.13) { r.ltmRevenue = null; r.evSales = null; r.fcfPerShare = null; r.pe = null; }
  }
  const subj = out.find((r) => r.isSubject);
  const subjCap = (subj && subj.mktCap) || 0;
  // drop micro-cap noise FMP sometimes returns as "peers" (a $1M shell isn't an AAPL peer)
  out = out.filter((r) => r.isSubject || (r.mktCap != null && r.mktCap >= Math.max(1e9, subjCap * 0.004)));
  if (out.length < 2) return null;
  // subject pinned first, peers ranked by market cap, capped to the 6 closest in scale
  out.sort((a, b) => (a.isSubject ? -1 : b.isSubject ? 1 : (b.mktCap || 0) - (a.mktCap || 0)));
  return out.slice(0, 7);
}

// Drop low-signal TA / price-prediction clickbait so the narrative/drivers sections anchor to real
// events (deals, launches, regulation) instead of "$0.11 battleground / RSI" noise. Falls back to the
// raw titles if filtering would empty the list, so a report never loses its news entirely.
const NEWS_NOISE = /\b(price prediction|prediction|could (hit|reach|surge|soar|rally|dip)|will (hit|reach)|target of \$|\$[\d.,]+ (by|target|incoming|next|soon)|rsi|elliott|fibonacci|moving average|golden cross|death cross|technical analysis|\bta\b|chart (shows|signals|pattern)|bull(ish)? (flag|pattern)|bear(ish)? (flag|pattern)|breakout|to the moon|\d+x potential|100x|1000x)\b/i;
function cleanNews(news: any): string[] {
  if (!Array.isArray(news)) return [];
  const titles = news.map((n: any) => n && n.title).filter((s: any) => typeof s === 'string' && s.trim());
  const good = titles.filter((tl: string) => !NEWS_NOISE.test(tl));
  return (good.length ? good : titles).slice(0, 6);
}

// Gather real data for an equity and ask the AI to analyze it → [[title, body], …] + verdict.
async function buildReport(sym: string): Promise<{ sections: [string, string][]; verdict?: any; data: any }> {
  const fs = market.fmpSymbol(sym);
  const t: any = getTicker(sym) || {};
  const cl = market.assetClass(sym);
  // The bundled ticker catalogue contains identity metadata, but its quote fields are
  // placeholders until a live source marks the ticker `real`. Never ground an AI report
  // with those placeholder prices or returns.
  const data: any = { sym, name: t.name || sym, assetClass: cl };
  if (t.real) {
    data.price = t.price;
    data.chgPct = t.chgPct;
  }

  if (cl === 'equity') {
    const [profile, ratios, keyMetrics, grades, target, income, earnings, estimates, balance, cash, peers] = await Promise.all([
      fmp.profile(fs).catch(() => null),
      fmp.ratiosTtm(fs).catch(() => null),
      fmp.keyMetricsTtm(fs).catch(() => null),
      fmp.grades(fs).catch(() => null),
      fmp.priceTarget(fs).catch(() => null),
      fmp.incomeStatement(fs).catch(() => null),
      fmp.earnings(fs).catch(() => null),
      fmp.analystEstimates(fs).catch(() => null),
      fmp.balanceSheet(fs).catch(() => null),
      fmp.cashFlow(fs).catch(() => null),
      fmp.stockPeers(fs).catch(() => null),
    ]);
    if (profile) {
      data.name = profile.companyName || data.name;
      data.sector = profile.sector; data.industry = profile.industry;
      data.marketCap = profile.marketCap; data.beta = profile.beta;
      data.description = profile.description;
    }
    if (ratios) {
      data.peRatio = ratios.priceToEarningsRatioTTM;
      data.eps = ratios.netIncomePerShareTTM;
      data.netMarginPct = ratios.netProfitMarginTTM != null ? ratios.netProfitMarginTTM * 100 : undefined;
      data.grossMarginPct = ratios.grossProfitMarginTTM != null ? ratios.grossProfitMarginTTM * 100 : undefined;
      data.operatingMarginPct = ratios.operatingProfitMarginTTM != null ? ratios.operatingProfitMarginTTM * 100 : undefined;
      data.dividendYieldPct = ratios.dividendYieldTTM != null ? ratios.dividendYieldTTM * 100 : undefined;
    }
    if (keyMetrics) {
      data.enterpriseValue = keyMetrics.enterpriseValueTTM;
      data.evToSales = keyMetrics.evToSalesTTM;
      data.evToEbitda = keyMetrics.evToEBITDATTM;
      data.earningsYield = keyMetrics.earningsYieldTTM;
    }
    if (grades) data.analystGrades = grades;
    if (target) data.priceTarget = target;
    if (Array.isArray(income) && income.length) {
      const i = income[0];
      data.latestIncome = {
        fiscalYear: i.fiscalYear, period: i.period, revenue: i.revenue,
        grossProfit: i.grossProfit, operatingIncome: i.operatingIncome,
        netIncome: i.netIncome, ebitda: i.ebitda, eps: i.eps,
      };
      data.financialYears = income.length;
      // multi-year trend so the AI can discuss growth/trajectory with real figures
      data.incomeTrend = income.slice(0, 4).map((r: any) => ({
        year: r.fiscalYear || r.calendarYear, revenue: r.revenue, grossProfit: r.grossProfit,
        operatingIncome: r.operatingIncome, netIncome: r.netIncome, eps: r.eps,
      }));
    }
    if (Array.isArray(earnings)) {
      const past = earnings.filter((e: any) => e && e.epsActual != null);
      if (past[0]) data.latestEarnings = { date: past[0].date, epsActual: past[0].epsActual, epsEstimated: past[0].epsEstimated, revenueActual: past[0].revenueActual };
      // beat/miss history (Fey shows "EPS missed by -4.10%" style reference data)
      data.earningsHistory = past.slice(0, 5).map((e: any) => ({
        date: e.date, epsActual: e.epsActual, epsEstimated: e.epsEstimated,
        epsSurprisePct: (e.epsActual != null && e.epsEstimated) ? +(((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100).toFixed(1) : null,
        revenueActual: e.revenueActual, revenueEstimated: e.revenueEstimated,
      }));
    }
    if (Array.isArray(estimates) && estimates[0]) {
      data.numAnalystsEps = estimates[0].numAnalystsEps;
      data.forwardEstimates = estimates.slice(0, 2).map((e: any) => ({ year: e.date, revenueAvg: e.revenueAvg, epsAvg: e.epsAvg, numAnalysts: e.numAnalystsEps }));
    }
    if (balance && balance[0]) {
      const b = balance[0];
      data.balanceSheet = {
        cashAndEquivalents: b.cashAndCashEquivalents, totalDebt: b.totalDebt, netDebt: b.netDebt,
        totalEquity: b.totalStockholdersEquity, totalAssets: b.totalAssets,
      };
    }
    if (cash && cash[0]) {
      const c = cash[0];
      data.cashFlow = {
        operatingCashFlow: c.operatingCashFlow, freeCashFlow: c.freeCashFlow, capex: c.capitalExpenditure,
        buybacks: c.commonStockRepurchased, dividendsPaid: c.netDividendsPaid,
      };
    }
    // FMP "stable" stock-peers returns a flat array [{symbol, companyName, price, mktCap}]
    const peerSyms = peerSymbols(peers);
    if (peerSyms.length) data.peers = peerSyms.slice(0, 6);
    // recent headlines as catalysts the analysis can reference
    const news: any = await fmp.stockNews(fs, 6).catch(() => null);
    if (Array.isArray(news) && news.length) data.recentNews = news.slice(0, 6).map((n: any) => n.title).filter(Boolean);
  } else {
    // crypto / commodity / index / fx — live perp market structure + the asset profile + macro.
    // Crypto ALSO pulls the CoinGecko fundamentals card (supply/FDV/rank/ATH — the same one /stock
    // uses) so the report discusses real tokenomics, not just price action.
    const [stats, profile, quote, ci]: any[] = await Promise.all([
      market.assetStats(sym).catch(() => null),
      market.assetMeta(sym).catch(() => null),
      fmp.quote(fs).catch(() => null),
      cl === 'crypto' ? coinInfo(sym).catch(() => null) : Promise.resolve(null),
    ]);
    // profile: prefer the HL perp annotation; fall back to CoinGecko identity (perpAnnotation is
    // null for native majors like ARB/BTC → otherwise the Overview would be ungrounded).
    if (profile) data.profile = { category: profile.category, displayName: profile.displayName, description: profile.description, keywords: profile.keywords };
    else if (ci) data.profile = { category: ci.categories && ci.categories[0], displayName: ci.name, description: ci.description, keywords: ci.categories };
    data.market = {
      price: t.real ? t.price : undefined, change24hPct: t.real ? t.chgPct : undefined,
      high24h: stats && stats.dayHigh, low24h: stats && stats.dayLow,
      volume24hUsd: stats && stats.dayVolUsd, openInterestUsd: stats && stats.oiNotional,
      fundingApr: stats && stats.fundingApr, venue: 'Hyperliquid',
    };
    if (ci && ci.market) {
      const m = ci.market;
      data.fundamentals = {
        rank: m.rank, marketCap: m.mcap, fdv: m.fdv,
        circulatingSupply: m.supply_circ, totalSupply: m.supply_total,
        pctCirculating: (m.supply_circ && m.supply_total) ? +((m.supply_circ / m.supply_total) * 100).toFixed(1) : undefined,
        ath: m.ath, athDate: m.ath_date,
        athDrawdownPct: (m.ath && t.real && t.price) ? +(((t.price - m.ath) / m.ath) * 100).toFixed(1) : undefined,
        categories: ci.categories,
      };
      // REAL 7d/30d/1y % changes (NOT the daily move) so the model never mislabels today's tick as 1Y
      if (ci.price_change) data.change = { d7: ci.price_change.d7, d30: ci.price_change.d30, y1: ci.price_change.y1 };
    }
    // macro/index: real 52-week range + moving averages from the FMP quote (e.g. ^N225 for JP225)
    if (quote) data.quote = {
      marketCap: quote.marketCap, yearHigh: quote.yearHigh, yearLow: quote.yearLow,
      priceAvg50: quote.priceAvg50, priceAvg200: quote.priceAvg200,
    };
    const news: any = cl === 'crypto' ? await fmp.cryptoNews(8, fs).catch(() => null) : await fmp.stockNews(fs, 8).catch(() => null);
    const titles = cleanNews(news);
    if (titles.length) data.recentNews = titles;
  }

  const res: any = await ai.analyze(data);
  const sections: [string, string][] = (res && Array.isArray(res.sections) ? res.sections : [])
    .filter((s: any) => s && (s.title || s.body))
    .map((s: any) => [s.title || 'Analysis', s.body || ''] as [string, string]);
  return { sections, verdict: res && res.verdict, data };
}

// What the AI actually analyzed, with magnitudes (à la Fey) — adapts to the asset type:
// equity → financials/estimates/ratings/peers; crypto & macro → live market data + profile + news.
async function buildSources(sym: string): Promise<[string, string][] | null> {
  if (!market.isReady()) return null;
  const cl = market.assetClass(sym);
  const fs = market.fmpSymbol(sym);
  const out: [string, string][] = [];
  const newsSrc = (news: any) => {
    if (Array.isArray(news) && news.length) {
      const srcs = new Set(news.map((n: any) => n.site || n.publisher).filter(Boolean));
      out.push(['News digest', `${news.length} articles · ${srcs.size} source${srcs.size === 1 ? '' : 's'}`]);
    }
  };
  try {
    if (cl === 'equity') {
      const [income, estimates, earnings, grades, target, peers, news]: any[] = await Promise.all([
        fmp.incomeStatement(fs).catch(() => null),
        fmp.analystEstimates(fs).catch(() => null),
        fmp.earnings(fs).catch(() => null),
        fmp.grades(fs).catch(() => null),
        fmp.priceTarget(fs).catch(() => null),
        fmp.stockPeers(fs).catch(() => null),
        fmp.stockNews(fs, 12).catch(() => null),
      ]);
      if (Array.isArray(income) && income.length) out.push(['Financial statements', `${income.length} yrs · income, balance, cash flow`]);
      if (estimates && estimates[0] && estimates[0].numAnalystsEps) out.push(['Analyst estimates', `${estimates[0].numAnalystsEps} analysts`]);
      if (grades) {
        const firms = (grades.totalStrongBuy || 0) + (grades.totalBuy || 0) + (grades.totalHold || 0) + (grades.totalSell || 0) + (grades.totalStrongSell || 0);
        if (firms) out.push(['Analyst ratings', `${firms} firms`]);
      }
      if (target && target.targetConsensus) out.push(['Price targets', `${market.fmtPrice(target.targetConsensus)} consensus`]);
      if (Array.isArray(earnings)) {
        const past = earnings.filter((e: any) => e && e.epsActual != null);
        if (past.length) out.push(['Earnings history', `${past.length} reports`]);
      }
      { const ps = peerSymbols(peers); if (ps.length) out.push(['Peer comparison', `${ps.length} companies`]); }
      newsSrc(news);
    } else {
      const [stats, profile, ci, news]: any[] = await Promise.all([
        market.assetStats(sym).catch(() => null),
        market.assetMeta(sym).catch(() => null),
        cl === 'crypto' ? coinInfo(sym).catch(() => null) : Promise.resolve(null),
        cl === 'crypto' ? fmp.cryptoNews(10, fs).catch(() => null) : fmp.stockNews(fs, 10).catch(() => null),
      ]);
      if (stats) out.push(['Live market data', 'Hyperliquid · price, OI, funding']);
      if (ci && ci.market && ci.market.rank) out.push(['Tokenomics', `CoinGecko · rank #${ci.market.rank}`]);
      const prof = profile || (ci ? { category: ci.categories && ci.categories[0], description: ci.description } : null);
      if (prof && (prof.category || prof.description)) out.push(['Asset profile', String(prof.category || 'overview')]);
      newsSrc(news);
    }
  } catch (e) { return null; }
  return out.length ? out : null;
}

// real price-stats sidebar (FMP fundamentals for equities, perp+FMP for the rest)
async function fillLeftStats(sym: string): Promise<[string, string, number?][] | null> {
  if (!market.isReady()) return null;
  const t: any = getTicker(sym), cl = market.assetClass(sym);
  try {
    let rows: [string, string, number?][];
    if (cl === 'equity') {
      const fs = market.fmpSymbol(sym);
      const [q, p, r]: any[] = await Promise.all([fmp.quote(fs).catch(() => null), fmp.profile(fs).catch(() => null), fmp.ratiosTtm(fs).catch(() => null)]);
      rows = [
        ['Last price', market.fmtPrice(q && q.price), (q && q.changePercentage != null) ? q.changePercentage : undefined],
        ['52‑wk high', market.fmtPrice(q && q.yearHigh)],
        ['52‑wk low', market.fmtPrice(q && q.yearLow)],
        ['Avg volume', anCompact(p && p.averageVolume)],
        ['Market cap', market.fmtUsd((p && p.marketCap) || (q && q.marketCap))],
        ['EPS (TTM)', r && r.netIncomePerShareTTM != null ? '$' + (+r.netIncomePerShareTTM).toFixed(2) : '—'],
        ['P/E ratio', r && r.priceToEarningsRatioTTM != null ? (+r.priceToEarningsRatioTTM).toFixed(2) : '—'],
      ];
    } else {
      const [s, q]: any[] = await Promise.all([market.assetStats(sym).catch(() => null), fmp.quote(market.fmpSymbol(sym)).catch(() => null)]);
      rows = [
        ['Last price', market.fmtPrice(t.real ? t.price : null), t.real ? t.chgPct : undefined],
        ['24h high', market.fmtPrice(t.real && s ? s.dayHigh : null)],
        ['24h low', market.fmtPrice(t.real && s ? s.dayLow : null)],
        ['24h volume', market.fmtUsd(t.real && s ? s.dayVolUsd : null)],
        ['Market cap', market.fmtUsd(q && q.marketCap)],
        ['Open interest', market.fmtUsd(t.real && s ? s.oiNotional : null)],
        ['Funding APR', s && s.fundingApr != null ? (s.fundingApr >= 0 ? '+' : '') + s.fundingApr.toFixed(2) + '%' : '—'],
      ];
    }
    return rows;
  } catch (e) { return null; }
}

function AnStat({ k, v, chg, up }: { k: string; v: string; chg?: number; up?: boolean }) {
  const hasChg = chg != null && !isNaN(chg);
  const isUp = up != null ? up : (chg != null ? chg >= 0 : false);
  return (
    <div className="an-stat">
      <span className="k">{k}</span>
      <span className="v"><b>{v}</b>{hasChg ? <span className={'pill ' + (isUp ? 'up' : 'down')}>{isUp ? '+' : ''}{(+(chg as number)).toFixed(2)}%</span> : null}</span>
    </div>
  );
}

// Left panel: REAL 1Y candle chart (+ real x-axis & volume) with a shimmer until it resolves,
// plus real price stats. The old synthetic seed (series×3.3 fake $, dateLabels Jan→Jan) is gone —
// it used to render into a display:none div while the visible chart stayed fake.
function LeftPanel({ sym }: { sym: string }) {
  const ready = useMarketReady();
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartReady, setChartReady] = useState(false);   // real candles painted
  const [chartSettled, setChartSettled] = useState(false); // the fill attempt resolved (ok or not)
  const [axis, setAxis] = useState<string[]>([]);
  const [volBars, setVolBars] = useState<number[] | null>(null);
  const [realStats, setRealStats] = useState<[string, string, number?][] | null>(null);

  // real price-stats sidebar. Reset to null on sym change so a new symbol re-loads, then
  // ALWAYS settle to a non-null value once the fetch resolves — an empty/errored fetch
  // returns [] (a settled sentinel), so the `=== null` gate below can never shimmer forever.
  useEffect(() => {
    setRealStats(null);
    if (!market.isReady()) return;
    let alive = true;
    fillLeftStats(sym)
      .then((rows) => { if (alive) setRealStats(rows || []); })
      .catch(() => { if (alive) setRealStats([]); });
    return () => { alive = false; };
  }, [sym, ready]);

  // real 1Y candles painted into the VISIBLE element (mirrors /stock's chart), + a real x-axis and
  // volume bars derived from the actual candle window — never the synthetic ×3.3 / Jan→Jan seed.
  useEffect(() => {
    setChartReady(false); setChartSettled(false); setAxis([]); setVolBars(null);
    const el = chartRef.current;
    if (!el || !market.isReady()) return;
    let alive = true;
    (async () => {
      const ok = await market.fillChart(el, sym, '1Y', {
        w: 230, h: 110, stroke: 'rgba(255,255,255,0.75)', fill: 'transparent', dot: false,
      }).catch(() => false);
      if (!alive) return;
      setChartSettled(true);
      setChartReady(!!ok);
      if (!ok) { el.innerHTML = ''; return; }   // clear any stale chart → the "unavailable" note shows
      // pull the real candle window once (30s-cached, so this is the same fetch fillChart just used)
      // → a real x-axis (7 month labels spanning the ACTUAL window, accurate for young listings) + real volume.
      try {
        const d = await market.chartData(sym, '1Y');
        if (!alive || !d) return;
        const L = d.labels;
        if (Array.isArray(L) && L.length > 1) {
          const n = 7;
          setAxis(Array.from({ length: n }, (_, i) =>
            market.fmtLabel(L[Math.round((i * (L.length - 1)) / (n - 1))], '1Y').split(' ')[0]));
        }
        if (Array.isArray(d.ohlc) && d.ohlc.length) {
          const vs = d.ohlc.map((k: any) => +k.v).filter((n: number) => Number.isFinite(n));
          if (vs.length > 1) setVolBars(vs);
        }
      } catch { /* no axis/volume strip if the window can't be read */ }
    })();
    return () => { alive = false; };
  }, [sym, ready]);

  // shimmer rows while the real stats resolve — sized to the real 7-row list, never the
  // Tesla-shaped synthetic fallback (ANALYSIS.priceStats) which would flash wrong prices.
  const statSkeletons = Array.from({ length: 7 }, (_, i) => (
    <div className="an-stat" key={i}>
      <span className="k"><SkeletonValue w={i % 2 ? 74 : 58} /></span>
      <span className="v"><SkeletonValue w={i % 3 ? 52 : 68} /></span>
    </div>
  ));

  return (
    <aside className="an-left" data-sec="price">
      <div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon name="chart" size={12} /> 1‑year chart analysis
      </div>
      {/* real-candle target; a shimmer overlays it until the candles resolve so the user never
          reads a fake trace as real. fillChart writes real closes + real hover-date labels here. */}
      <div style={{ position: 'relative', height: 120 }}>
        <div className="an-chart" ref={chartRef} />
        {!chartSettled && <Skeleton w={230} h={120} r={8} style={{ position: 'absolute', inset: 0, display: 'block' }} />}
        {chartSettled && !chartReady && (
          <div className="muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>Chart unavailable</div>
        )}
      </div>
      {chartReady && volBars && volBars.length > 1 && (
        <>
          <div style={{ height: 38, margin: '2px 0 12px', opacity: 0.65 }}>
            <SvgChart className="" html={barChart(volBars, { w: 230, h: 38, baseColor: 'rgba(255,255,255,0.16)', gap: 0.5 })} />
          </div>
          {axis.length > 0 && (
            <div className="muted" style={{ fontSize: 9, display: 'flex', justifyContent: 'space-between', margin: '-8px 0 12px' }}>
              {axis.map((m, i) => <span key={i}>{m}</span>)}
            </div>
          )}
        </>
      )}
      <div data-anstats>
        {realStats == null
          /* still loading → shimmer, never the Tesla-shaped synthetic fallback */
          ? statSkeletons
          : realStats.length
            /* real stats resolved */
            ? realStats.map(([k, v, chg], i) => <AnStat key={i} k={k} v={v} chg={chg} />)
            /* fetch SETTLED with nothing usable → neutral notice (bounded), never an
               infinite shimmer and never fake Tesla-shaped prices */
            : <div className="muted" style={{ fontSize: 12, padding: '10px 2px' }}>Price stats unavailable for {sym}.</div>}
      </div>
    </aside>
  );
}

function Sections({ sections }: { sections: [string, string][] }) {
  return (
    <div data-ansections>
      {sections.map(([h, body], i) => (
        <div className="an-sec" key={i}><h3>{h}</h3><p>{body}</p></div>
      ))}
    </div>
  );
}

// Peer-row logo: FMP company image (peers are always equities) with a colored-initial
// fallback — avoids the generic resolver mis-routing obscure tickers through CoinGecko.
function PeerLogo({ sym, size = 18 }: { sym: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const c = (getTicker(sym) || {}).color || '#3f3f46';
  return (
    <span className="logo" style={{ ['--lc' as any]: c, width: size, height: size, fontSize: size * 0.44 }}>
      {(sym || '?')[0]}
      {!bad && <img className="logo__img" src={`/api/icon?v=3&src=fmp&c=${encodeURIComponent(sym)}`} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />}
    </span>
  );
}

// Peer analysis tab — Fey-style comparison table (FCF/share · LTM revenue · EV/sales ·
// P/E · Mkt cap · 1D) with the subject highlighted, an AI relative-positioning take, and
// a "vs peer median" valuation strip. Equity-only; all data is real (FMP).
function PeerAnalysis({ sym }: { sym: string }) {
  const ready = useMarketReady();
  const t: any = getTicker(sym) || {};
  const [rows, setRows] = useState<any[] | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'empty'>('loading');
  const [take, setTake] = useState('');

  useEffect(() => {
    if (!market.isReady()) return;
    let alive = true;
    setState('loading'); setRows(null); setTake('');
    buildPeers(sym).then((rs) => {
      if (!alive) return;
      if (rs && rs.length > 1) {
        setRows(rs); setState('done');
        const medians = { pe: peerMedian(rs, 'pe'), evSales: peerMedian(rs, 'evSales'), fcfPerShare: peerMedian(rs, 'fcfPerShare'), ltmRevenue: peerMedian(rs, 'ltmRevenue'), mktCap: peerMedian(rs, 'mktCap') };
        ai.peerAnalysis({ sym, name: t.name || sym, sector: t.sector, rows: rs, medians })
          .then((r: any) => { if (alive && r && r.take) setTake(r.take); }).catch(() => {});
      } else setState('empty');
    }).catch(() => { if (alive) setState('empty'); });
    return () => { alive = false; };
  }, [sym, ready]);

  if (state === 'loading') return <div className="pa-wrap"><div className="generating" style={{ marginTop: 30 }}>Comparing {sym} to its peers…</div></div>;
  if (state === 'empty' || !rows) return <div className="pa-wrap"><div className="muted" style={{ padding: '34px 4px', fontSize: 13 }}>Peer comparison isn't available for {sym}.</div></div>;

  const subject = rows.find((r) => r.isSubject) || rows[0];
  const num = (v: any, d = 2) => (v == null || isNaN(v)) ? '—' : (+v).toFixed(d);
  const median = (key: string) => peerMedian(rows, key);
  const prem = (key: string): number | null => {
    const med = median(key), s = subject[key];
    if (med == null || !med || s == null || isNaN(s)) return null;
    return (s / med - 1) * 100;
  };
  const premMetrics: [string, string][] = [['P/E Ratio', 'pe'], ['EV/sales', 'evSales'], ['FCF/share', 'fcfPerShare']];

  return (
    <div className="pa-wrap">
      <div className="pa-card">
        <table className="pa-table">
          <thead>
            <tr>
              <th className="lbl">Prices in USD</th>
              <th>FCF/share</th><th>LTM revenue</th><th>EV/sales</th><th>P/E Ratio</th><th>Mkt Cap</th><th>1D returns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const up = (r.changePct ?? 0) >= 0;
              return (
                <tr className={'pa-row ' + (r.isSubject ? 'sub' : '')} key={i}>
                  <td className="co">
                    <div className="co-in">
                      <PeerLogo sym={r.sym} />
                      <span className="tk">{r.sym}</span>
                      <span className="nm">{r.name}</span>
                      {r.isSubject && <span className="this">This stock</span>}
                    </div>
                  </td>
                  <td>{num(r.fcfPerShare)}</td>
                  <td>{anCompact(r.ltmRevenue)}</td>
                  <td>{num(r.evSales)}</td>
                  <td>{num(r.pe)}</td>
                  <td>{anCompact(r.mktCap)}</td>
                  <td className={r.changePct == null ? '' : (up ? 'up' : 'down')}>
                    {r.change == null ? '—' : (r.change >= 0 ? '+' : '') + (+r.change).toFixed(2)}
                    {r.changePct == null ? '' : ' (' + (up ? '+' : '') + (+r.changePct).toFixed(2) + '%)'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pa-grid">
        <div className="pa-take">
          <div className="ttl"><Icon name="analyze" size={13} /> Relative positioning</div>
          {take ? <p>{take}</p> : <p className="muted" style={{ fontSize: 13 }}>Reading {sym} against its peer group…</p>}
        </div>
        <div className="pa-prem">
          <div className="ttl">Vs peer median</div>
          {premMetrics.map(([label, key], i) => {
            const p = prem(key); const med = median(key); const up = (p ?? 0) >= 0;
            const w = Math.max(5, Math.min(100, Math.abs(p ?? 0)));
            return (
              <div className="pa-pm" key={i}>
                <div className="pa-pm-head"><span>{label}</span><span className={'pa-pm-pill ' + (p == null ? '' : up ? 'up' : 'down')}>{p == null ? '—' : (up ? '+' : '') + p.toFixed(0) + '%'}</span></div>
                <div className="pa-pm-bar"><span className={up ? 'up' : 'down'} style={{ width: w + '%' }} /></div>
                <div className="pa-pm-sub"><span>{sym} {num(subject[key])}</span><span>median {num(med)}</span></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Analysis() {
  const { sym: symParam } = useParams();
  const sym = (symParam || 'TSLA').toUpperCase();
  const t: any = getTicker(sym);
  const ready = useMarketReady();
  // record the analyzed asset in the recents ring (Stock/Terminal already do; Analysis didn't) so
  // "recent" reflects what you actually looked at across surfaces.
  useEffect(() => { pushRecent(sym); }, [sym]);

  const isEquity = market.assetClass(sym) === 'equity';
  const tabOptions = isEquity ? ['Fundamentals', 'Peer analysis'] : ['Fundamentals'];
  const [tab, setTab] = useState<'Fundamentals' | 'Peer analysis'>('Fundamentals');
  const activeTab = (!isEquity && tab === 'Peer analysis') ? 'Fundamentals' : tab;
  const [genTime] = useState(() => nowTime());
  const [report, setReport] = useState<[string, string][] | null>(null);
  const [sources, setSources] = useState<[string, string][] | null>(null);
  // fetch-settled flags: the "Generating…" shimmer is gated on the REAL buildReport()/
  // buildSources() resolving — NOT on a fixed timer that could reveal Tesla-shaped
  // fallback prose before the AI report actually lands. A minReveal floor keeps the
  // shimmer from flickering on an instant cache hit.
  const [reportDone, setReportDone] = useState(false);
  const [sourcesDone, setSourcesDone] = useState(false);
  const [minReveal, setMinReveal] = useState(false);

  // reset on symbol change so a new symbol never shows the previous one's report/sources
  useEffect(() => {
    setReport(null); setSources(null);
    setReportDone(false); setSourcesDone(false); setMinReveal(false);
    const id = window.setTimeout(() => setMinReveal(true), 850);
    return () => window.clearTimeout(id);
  }, [sym]);

  // prefetch real AI report + sources once market is ready (guarded). Mark each fetch as
  // settled (resolved-with-data, resolved-empty, or errored) so the shimmer can end even
  // when a source genuinely returns nothing — without ever flashing fake data mid-fetch.
  useEffect(() => {
    if (!market.isReady()) return;
    let alive = true;
    buildReport(sym).then((res) => {
      if (!alive) return;
      if (res && res.sections && res.sections.length) {
        const secs: [string, string][] = [...res.sections];
        if (res.verdict) secs.push(['Bottom line', String(res.verdict)]); // Fey shows a closing Summary
        setReport(secs);
      }
    }).catch(() => {}).finally(() => { if (alive) setReportDone(true); });
    buildSources(sym).then((srcs) => {
      if (alive && srcs && srcs.length) setSources(srcs);
    }).catch(() => {}).finally(() => { if (alive) setSourcesDone(true); });
    return () => { alive = false; };
  }, [sym, ready]);

  // Report is "generating" until the real fetch settles (report set, or the fetch settled
  // empty and the min-reveal floor passed). A failed/empty fetch is an explicit unavailable
  // state; it must never reveal the old static Tesla report for an arbitrary symbol.
  // When the market never becomes ready the prefetch is skipped, so after the floor we fall
  // back too rather than shimmering forever (matches the pre-fix reveal-on-timer behaviour).
  const reportReady = report != null || ((reportDone || !ready) && minReveal);
  const generating = !reportReady;
  // sources reveal on their own settle so a slow news call can't hold the whole panel
  const sourcesReady = sources != null || ((sourcesDone || !ready) && minReveal);

  const fundamentals = (
    <div className="analysis has-sectabs">
      <SectionTabs tabs={[{ key: 'report', label: 'Report' }, { key: 'price', label: 'Price' }, { key: 'sources', label: 'Sources' }]} />
      <LeftPanel sym={sym} />
      <main className="an-report is-active" data-sec="report">
        <div className="an-report-head">
          <span>{t.name}'s summary</span>
          {report ? <span className="gen"><Icon name="analyze" size={12} /> Generated at {genTime}</span> : null}
        </div>
        {generating
          ? <div className="generating" style={{ marginTop: 30 }}>Generating fundamentals…</div>
          : report
            ? <Sections sections={report} />
            : <div className="muted" style={{ marginTop: 30, fontSize: 13 }}>Fundamentals report unavailable for {sym}.</div>}
      </main>
      <aside className="an-right" data-sec="sources">
        <h4>Sources</h4>
        {sourcesReady && sources && <div className="an-src-count"><Icon name="check" size={11} /> Analyzed {sources.length} data sources</div>}
        <div data-ansources>
          {sources
            /* real, provenance-carrying sources once the scan resolves */
            ? sources.map(([s, meta], i) => (
                <div className="src" key={i}><span>{s} <Icon name="link" size={11} /></span><span className="meta">{meta}</span></div>
              ))
            : !sourcesReady
              /* still scanning → neutral shimmer rows */
              ? Array.from({ length: 3 }, (_, i) => (
                  <div className="src" key={i}>
                    <span><SkeletonValue w={i === 0 ? 88 : i === 1 ? 72 : 108} /></span>
                    <span className="meta"><SkeletonValue w={64} /></span>
                  </div>
                ))
              /* scan settled with nothing usable → a truthful unavailable state */
              : <div className="muted" style={{ fontSize: 12, padding: '10px 0' }}>Source details unavailable.</div>}
        </div>
      </aside>
    </div>
  );

  return (
    <Shell dockActive="analysis">
      <div className="brand-vignette" style={{ ['--tint' as any]: `rgba(${tintOf(t.color)},0.14)` }}>
        <div className="an-toolbar">
          <a className="icon-btn" href={`#/stock/${sym}`}><Icon name="close" size={18} /></a>
          <Logo sym={sym} size={22} /> <b style={{ fontSize: 13 }}>{sym} Analysis</b>
          {/* Change pill. While the universe is still initialising we shimmer so we never
              flash the synthetic-stub change (a Tesla-shaped fake for unknown symbols).
              market.isReady() is bounded (init's finally always flips it), so this always
              resolves: once ready, show the REAL change if this ticker carries one, else —
              for a non-universe equity there is no real change source — render just the price
              with a neutral "—" change (never the fabricated synthetic getTicker change). */}
          {!ready
            ? <SkeletonValue w={96} />
            : (t.real && t.price > 0)
              ? <span className={'pill ' + cls(t.chg)}>{t.chg.toFixed(2)} ({fmtPct(t.chgPct)})</span>
              : <span className="pill muted">Market data unavailable</span>}
          <span style={{ marginLeft: 'auto' }}>
            <Segmented options={tabOptions} value={activeTab} onChange={(o) => setTab(o as any)} />
          </span>
        </div>
        <div data-anbody>
          {activeTab === 'Peer analysis' ? <PeerAnalysis sym={sym} /> : fundamentals}
        </div>
      </div>
    </Shell>
  );
}
