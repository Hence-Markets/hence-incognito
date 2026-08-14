/* Stock detail — Chart / Statistics / Analyst / Earnings / Insider / Financials / Peers */
import { track } from '../lib/analytics';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/stock-extra.css';
import { Shell } from '../components/Shell';
import { StockTopbar } from '../components/StockTopbar';
import { ResearchStrip } from '../components/ResearchStrip';
import { icon, logo, fmtPct, cls, segmented, infoPanel, openModal, toast } from '../lib/ui.js';
import { priceChart, areaChart, barChart, multiLine, spider, priceTargetChart, probLadderChart, projectionCone, dateLabels, initCharts } from '../lib/charts.js';
import { getTicker, series, CAP_BREAKDOWN, PEERS, RATINGS, PRICE_TARGET, ABOUT, STOCK_NEWS } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { CURATED_EQUITY } from '../lib/equity-profiles';
import * as ai from '../lib/ai.js';
import * as sig from '../lib/signals.js';
import { coinInfo } from '../lib/coininfo';
import { llamaInfo, dvol } from '../lib/llama';
// @ts-ignore — JS module
import * as poly from '../lib/polymarket.js';
import * as stash from '../lib/stash';
import { pushRecent } from '../lib/recents';
import { setDockOccupant, clearDockOccupant } from '../lib/dockSlot';
import { useMarketReady } from '../hooks/useMarket';
// @ts-ignore — JS module
import { escapeHtml, safeHttpUrl, safeSymbol } from '../lib/safe-html.js';

const safeOpaqueId = (value: unknown) => String(value ?? '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
const safeExternalHref = (value: unknown) => {
  const href = safeHttpUrl(value);
  return href ? escapeHtml(href) : '';
};

/* ---- per-symbol news digest + article cache (shared: News card, its takeover, "Other headlines") ----
   Populated once by fillNewsCard(); reused by openNewsSummary() so the expand never re-hits the LLM. */
type NewsDigest = { summary: string; sentiment: string; items: { i: number; sentiment: string }[]; generated_at: string; sources: number };
type NewsCache = { digest: NewsDigest; articles: any[] };
const _newsCache = new Map<string, NewsCache>();
function fmtTime(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
function fmtLongDate(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
const sentClass = (s: string) => (/neg/i.test(s) ? 'neg' : /pos/i.test(s) ? 'pos' : 'neu');

const RANGES = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'All'];

/* an asset is "real" when Hydromancer has loaded live data for it */
const isReal = (sym: string) => market.isReady() && !!(getTicker(sym) || {}).real;
const exchangeTag = (sym: string) => {
  const t: any = getTicker(sym);
  if (t.research) return `USD · ${t.exchange || 'research'} · EOD`;   // delayed data, labeled honestly
  return t.world === 'crypto' ? 'USD · Hyperliquid' : 'USD · trade.xyz';
};

/* big price split into integer + cents spans, sub-$1 kept whole for precision */
function splitPrice(p: number) {
  const s = market.fmtPrice(p).replace('$', '');
  if (p >= 1) { const [i, c] = s.split('.'); return `<span class="px-int">$${i}</span><span class="px-cent">.${c || '00'}</span>`; }
  return `<span class="px-int">$${s}</span>`;
}
function fmtChgAbs(v: number) {
  const a = Math.abs(v);
  return a >= 1 ? a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : a.toPrecision(2);
}
/* live hero: current mid + change across the selected range (from candles) */
function realHero(sym: string, range: string, d: any, noteOverride?: string) {
  const t = getTicker(sym);
  const price = t.price;
  const first = d && d.closes.length ? d.closes[0] : price;
  const chg = price - first, pct = first ? (chg / first) * 100 : 0;
  const cfg = RANGE_CFG[range] || RANGE_CFG['1Y'];
  const sinceTxt = noteOverride ? `<span class="stx-prevnote" style="margin-left:8px">${noteOverride}</span>`
    : range === '1D' ? '' : `<span class="stx-prevnote" style="margin-left:8px">${cfg.since}</span>`;
  return `<div class="stock__price">
    <span>${splitPrice(price)}</span>
    <span class="stock__chg ${cls(chg)}">${chg >= 0 ? '+' : '-'}${fmtChgAbs(chg)} (${fmtPct(pct)})</span>
    ${sinceTxt}
  </div>`;
}
/* ---- asset-type-aware stat rail: the RIGHT data for the RIGHT asset ----
   equity → real fundamentals (mkt cap, P/E, EPS, margins…) from FMP
   crypto → perp metrics + real market cap
   commodity/index/fx → price + perp depth + 52-week range (no fundamentals) */
const pctFmt = (v: any) => (v != null && !isNaN(v)) ? (v * 100).toFixed(2) + '%' : '—';
const num2 = (v: any) => (v != null && !isNaN(v) ? (+v).toFixed(2) : '—');
const fundFmt = (v: any) => (v != null && !isNaN(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—');
function compactNum(v: any) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return '' + v;
}
const RAILS: Record<string, [string, (d: any) => string][]> = {
  equity: [
    ['Mkt cap', d => market.fmtUsd(d.marketCap) + (d.capCurrency ? ' ' + d.capCurrency : '')],
    ['P/E', d => num2(d.pe)],
    ['EPS', d => (d.eps != null ? '$' + (+d.eps).toFixed(2) : '—')],
    ['Gross margin', d => pctFmt(d.grossMargin)],
    ['Net margin', d => pctFmt(d.netMargin)],
    ['Beta', d => num2(d.beta)],
    ['52W High', d => market.fmtPrice(d.yearHigh)],
    ['52W Low', d => market.fmtPrice(d.yearLow)],
    ['Avg vol', d => compactNum(d.avgVolume)],
    ['Div yield', d => pctFmt(d.divYield)],
  ],
  crypto: [
    ['Price', d => market.fmtPrice(d.price)],
    ['Mkt cap', d => market.fmtUsd(d.marketCap)],
    ['Mark', d => market.fmtPrice(d.mark)],
    ['24h High', d => market.fmtPrice(d.dayHigh)],
    ['24h Low', d => market.fmtPrice(d.dayLow)],
    ['24h Vol', d => market.fmtUsd(d.dayVolUsd)],
    ['Open int.', d => market.fmtUsd(d.oiNotional)],
    ['Funding', d => fundFmt(d.fundingApr)],
    ['Spread', d => (d.spreadBps != null ? d.spreadBps.toFixed(1) + ' bps' : '—')],
    ['Category', d => d.cat || '—'],
  ],
  price: [
    ['Price', d => market.fmtPrice(d.price)],
    ['Mark', d => market.fmtPrice(d.mark)],
    ['Oracle', d => market.fmtPrice(d.oracle)],
    ['24h High', d => market.fmtPrice(d.dayHigh)],
    ['24h Low', d => market.fmtPrice(d.dayLow)],
    ['24h Vol', d => market.fmtUsd(d.dayVolUsd)],
    ['Open int.', d => market.fmtUsd(d.oiNotional)],
    ['Funding', d => fundFmt(d.fundingApr)],
    ['52W High', d => market.fmtPrice(d.yearHigh)],
    ['52W Low', d => market.fmtPrice(d.yearLow)],
  ],
};
const railName = (c: string) => (c === 'equity' ? 'equity' : c === 'crypto' ? 'crypto' : 'price');
const railKeys = (sym: string) => RAILS[railName(market.assetClass(sym))];

/* fetch the right data for the rail (FMP fundamentals for equities, perp+FMP for the rest) */
/* stats FMP can't give (private / plan-gated foreign listings) computed from the
   VENUE's own year of candles: real 52W range + average daily volume. */
async function venueRail(sym: string) {
  try {
    const d: any = await market.chartData(sym, '1Y');
    if (!d || !d.closes || d.closes.length < 30) return {};
    const out: any = { yearHigh: Math.max(...d.closes), yearLow: Math.min(...d.closes) };
    if (Array.isArray(d.volumes) && d.volumes.length) {
      const vs = d.volumes.filter((v: number) => Number.isFinite(v) && v > 0);
      if (vs.length) out.avgVolume = vs.reduce((s: number, v: number) => s + v, 0) / vs.length;
    }
    return out;
  } catch { return {}; }
}

async function railData(sym: string, c: string) {
  if (c === 'equity') {
    const fs = market.fmpSymbol(sym);
    const cur = CURATED_EQUITY[String(sym).toUpperCase()];
    const [prof, q, r] = await Promise.all([
      fmp.profile(fs).catch(() => null), fmp.quote(fs).catch(() => null), fmp.ratiosTtm(fs).catch(() => null)]);
    // FMP-dark equities (MINIMAX-class): pull the verified foreign-listing profile through
    // the companybrief endpoint (7d-cached) and compute the 52W range + volume from venue
    // candles — the strip fills with what IS knowable instead of a row of dashes.
    let brief: any = null, venue: any = {};
    if (!q || !q.price) {
      [brief, venue] = await Promise.all([
        fetch('/api/companybrief?c=' + encodeURIComponent(sym)).then((x) => (x.ok ? x.json() : null)).catch(() => null),
        venueRail(sym),
      ]);
    }
    const bp = brief && brief.profile;
    // sanity clamp: some foreign feeds report native-currency EPS against a USD price
    const price = (q && q.price) || getTicker(sym).price || 0;
    const rawEps = r && r.netIncomePerShareTTM;
    const eps = rawEps != null && price > 0 && Math.abs(rawEps) > price * 5 ? null : rawEps;
    return {
      marketCap: (q && q.marketCap) || (prof && prof.marketCap) || (bp && bp.mktCap),
      capCurrency: (!q || !q.price) && bp && bp.currency && bp.currency !== 'USD' ? bp.currency : null,
      pe: r && r.priceToEarningsRatioTTM > 0 ? r.priceToEarningsRatioTTM : null, eps,
      grossMargin: r && r.grossProfitMarginTTM, netMargin: r && r.netProfitMarginTTM,
      beta: (prof && prof.beta) || (bp && bp.beta), divYield: r && r.dividendYieldTTM,
      yearHigh: (q && q.yearHigh) || venue.yearHigh, yearLow: (q && q.yearLow) || venue.yearLow,
      avgVolume: (prof && prof.averageVolume) || (q && q.averageVolume) || venue.avgVolume,
      // curated fallback (lib/equity-profiles): venue listings FMP can't see still get a
      // real About + fact rows; FMP fields always win when they exist
      sector: (prof && prof.industry) || (cur && cur.sector), name: (prof && prof.companyName) || (cur && cur.name),
      description: (prof && prof.description) || (cur && cur.description),
      ceo: (prof && prof.ceo) || (cur && cur.ceo), employees: prof && prof.fullTimeEmployees,
      hq: prof ? [prof.city, prof.state || prof.country].filter(Boolean).join(', ') : (cur && cur.hq) || '',
      website: (prof && prof.website) || (cur && cur.website), ipoDate: prof && prof.ipoDate,
    } as any;
  }
  let stats: any = await market.assetStats(sym);
  if (stats.dayHigh == null) { await new Promise(r => setTimeout(r, 700)); stats = await market.assetStats(sym); } // self-heal a rate-limited burst
  let q: any = null; try { q = await fmp.quote(market.fmpSymbol(sym)); } catch (e) { /* perp-only */ }
  return { ...stats, marketCap: q && q.marketCap, yearHigh: q && q.yearHigh, yearLow: q && q.yearLow };
}
function realStatStrip(sym: string) {
  return `<div class="kpi-strip" data-stat-strip>${railKeys(sym).map(([k]) =>
    `<div class="kpi"><div class="kpi__k">${k}</div><div class="kpi__v">—</div></div>`).join('')}</div>`;
}
/* live one-liner for the right-side News panel on real assets */
function realNewsLead(sym: string) {
  const t = getTicker(sym);
  const pct = t.chgPct || 0, venue = t.world === 'crypto' ? 'Hyperliquid' : 'trade.xyz';
  const dir = pct >= 0 ? 'up' : 'down';
  return `${String(t.name || sym)} (${sym}) is trading at ${market.fmtPrice(t.price)} on ${venue}, ${dir} ${Math.abs(pct).toFixed(2)}% over the last 24 hours. Live perpetual market — mark price, open interest and order-book depth update in real time.`;
}

/* fetch candles once → render the real chart + recompute the hero change + fill stats */
let _fillSeq = 0;
async function fillStock(wrap: HTMLElement, sym: string, range: string) {
  if (!isReal(sym)) return;
  const c = market.assetClass(sym);
  const myseq = ++_fillSeq;                 // guard against fast range switches racing
  const heroEl = wrap.querySelector('[data-hero]');
  let d: any = null, usedRange = range;
  try { d = await market.chartData(sym, range); } catch (e) { /* fall through to intraday */ }
  // a listing in its first days has one daily candle, so every daily-interval range fails
  // the >=2 check — intraday history exists from listing hour one; show that instead
  if (!d || d.closes.length < 2) {
    try {
      const dd = await market.chartData(sym, '1D');
      if (dd && dd.closes.length >= 2) { d = dd; usedRange = '1D'; }
    } catch (e) { /* honest empty state below */ }
  }
  if (myseq !== _fillSeq || !wrap.isConnected) return;   // a newer switch superseded us
  wrap.dataset.chartRange = usedRange;                    // the range the chart REALLY shows
  // day-old listing on a long range: the chart falls back to since-listing history, and the
  // hero line says so — IN the hero, not floated over the range pills (it collided there)
  wrap.dataset.chartNote = usedRange !== range ? 'since listing' : '';
  const chartEl = wrap.querySelector('[data-live-chart]');
  if (d && d.closes.length >= 2 && chartEl) {
    const up = d.closes[d.closes.length - 1] >= d.closes[0];
    chartEl.innerHTML = priceChart(d.closes, {
      w: 760, h: 230,
      stroke: up ? 'rgba(95,207,145,0.95)' : 'rgba(255,255,255,0.82)',
      fill: up ? 'rgba(74,201,134,0.07)' : 'rgba(255,255,255,0.05)',
      labels: d.labels.map((ms: number) => market.fmtLabel(ms, usedRange)), fmt: market.fmtPrice,
    });
    initCharts(chartEl);
  } else if (chartEl) {
    // no real candles at all: say so — never leave a fabricated line under a real price
    chartEl.innerHTML = '<div class="stock__chart-empty">Chart history unavailable for this range.</div>';
  }
  if (heroEl && d) heroEl.innerHTML = realHero(sym, usedRange, d, wrap.dataset.chartNote);
  // real stat strip (once)
  const strip = wrap.querySelector('[data-stat-strip]') as HTMLElement | null;
  if (strip && !strip.dataset.filled) {
    strip.dataset.filled = '1';
    try {
      const s: any = await railData(sym, c);
      if (!wrap.isConnected) return;
      const cells = strip.querySelectorAll('.kpi__v');
      railKeys(sym).forEach(([, fn], i) => { if (cells[i]) { try { cells[i].textContent = fn(s); } catch (e) { cells[i].textContent = '—'; } } });
      // sync the freshly-computed 24h change back so dependent copy is correct (perps only)
      const t: any = getTicker(sym);
      if (s.chgPct != null && !isNaN(s.chgPct)) t.chgPct = s.chgPct;
      // open-interest-cap warning badge on the exchange tag
      const tag = wrap.querySelector('.usd-tag') as HTMLElement | null;
      if (tag && s.atOiCap && !tag.dataset.cap) { tag.dataset.cap = '1'; tag.innerHTML += ` · <span style="color:var(--down)">At OI cap</span>`; }
      // REAL equity About: the FMP profile description was fetched all along — use it
      // (left long-description swap, mirroring the crypto coininfo path) + real fact rows
      // in the right About panel instead of the generic perp template.
      if (c === 'equity' && s.description) {
        const left = wrap.querySelector('[data-left-about] p');
        if (left) left.textContent = s.description;
        const rowsHost = wrap.querySelector('[data-ictx="About"] [data-about-rows]') as HTMLElement | null;
        if (rowsHost) {
          // FMP strings go into innerHTML → escape them; only allow http(s) website links
          const emp = Number(s.employees);
          const facts: [string, string][] = [];
          if (s.sector) facts.push(['compass', `Operating in ${escapeHtml(s.sector)}`]);
          if (s.ceo) facts.push(['user', `Led by ${escapeHtml(s.ceo)}`]);
          if (emp > 0) facts.push(['user', `Employing ${emp.toLocaleString()} people`]);
          if (s.hq) facts.push(['home', `Headquartered in ${escapeHtml(s.hq)}`]);
          if (s.ipoDate) facts.push(['calendar', `Public since ${escapeHtml(String(s.ipoDate).slice(0, 4))}`]);
          const safeUrl = safeExternalHref(s.website);
          if (facts.length) {
            rowsHost.innerHTML = facts.map(([ic, txt]) => `<div class="stx-about-row"><span class="ic">${icon(ic, 14)}</span>${txt}</div>`).join('')
              + (safeUrl ? `<a class="btn-ghost" style="margin-top:12px;display:inline-flex" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Company website ${icon('arrowUp', 12)}</a>` : '');
          }
        }
      }
    } catch (e) { strip.dataset.filled = ''; }
  }
  // real analyst ratings + price target from FMP (equities only)
  if (c === 'equity') {
    const host = wrap.querySelector('[data-analyst]') as HTMLElement | null;
    if (host && !host.dataset.filled) {
      host.dataset.filled = '1';
      try {
        const real = await realAnalystData(sym);
        if (!wrap.isConnected) return;
        if (real) { host.innerHTML = analystCards(sym, real); initCharts(host); }
        else host.innerHTML = unavailableTab('Analyst coverage', sym);
      } catch (e) { host.innerHTML = unavailableTab('Analyst coverage', sym); }
    }
  }
  // News summary card — real articles + rich digest (equity & crypto), cached for the takeover
  fillNewsCard(wrap, sym, c);
  // Key Indicators card — deterministic rows (equity & crypto)
  fillKpiCard(wrap, sym, c);
  // Crypto About identity card + left-About full description (coininfo)
  if (c === 'crypto') { fillCryptoAbout(wrap, sym); fillCryptoStatExtras(wrap, sym); }
}

/* News summary card: fetch the article batch, run ONE rich digest (summary + per-article
   sentiment), cache both for the takeover, and update the card blockquote + caption. */
async function fillNewsCard(wrap: HTMLElement, sym: string, c: string) {
  const news = wrap.querySelector('[data-ictx="News"]') as HTMLElement | null;
  if (!news || news.dataset.filled || (c !== 'equity' && c !== 'crypto')) return;
  news.dataset.filled = '1';
  try {
    const fs = market.fmpSymbol(sym);
    const articles: any = c === 'crypto' ? await fmp.cryptoNews(12, fs) : await fmp.stockNews(fs, 12);
    if (!wrap.isConnected || !articles || !articles.length) { news.dataset.filled = ''; return; }
    const digest = await ai.newsDigestFull(getTicker(sym).name, articles.slice(0, 10)).catch(() => null);
    if (!wrap.isConnected) return;
    if (digest) {
      _newsCache.set(sym.toUpperCase(), { digest, articles });
      const lead = news.querySelector('[data-news-lead]'); if (lead && digest.summary) lead.textContent = digest.summary;
      const cap = news.querySelector('[data-news-cap]'); if (cap) cap.textContent = `News summarized today at ${fmtTime(digest.generated_at)}`;
    }
  } catch (e) { news.dataset.filled = ''; }
}

/* Key Indicators card: compute deterministic rows and swap them into [data-kpi-rows]. */
/* real KPI lines for commodities / FX / indices (live perp stats — no fundamentals exist) */
async function priceKpis(sym: string): Promise<string[]> {
  const s: any = await market.assetStats(sym).catch(() => null);
  if (!s) return [];
  const t = getTicker(sym);
  const out: string[] = [];
  if (s.chgPct != null && isFinite(s.chgPct)) out.push(`${t.name} is ${s.chgPct >= 0 ? 'up' : 'down'} ${Math.abs(s.chgPct).toFixed(2)}% over the last 24 hours`);
  if (s.fundingApr != null && isFinite(s.fundingApr)) out.push(`Funding runs at ${s.fundingApr >= 0 ? '+' : ''}${s.fundingApr.toFixed(2)}% APR — ${s.fundingApr >= 0 ? 'longs are paying shorts' : 'shorts are paying longs'}`);
  if (s.oiNotional != null) out.push(`Open interest stands at ${market.fmtUsd(s.oiNotional)}`);
  if (s.dayVolUsd != null) out.push(`${market.fmtUsd(s.dayVolUsd)} traded over the last 24 hours`);
  return out;
}

async function fillKpiCard(wrap: HTMLElement, sym: string, c: string) {
  const card = wrap.querySelector('[data-ictx="KPIs"]') as HTMLElement | null;
  if (!card || card.dataset.filled) return;
  card.dataset.filled = '1';
  try {
    // every REAL class gets real KPI rows (commodities/fx/indices previously kept the
    // fake TSLA-screenshot placeholder copy forever)
    const lines = c === 'crypto' ? await cryptoKpis(sym) : c === 'equity' ? await equityKpis(sym) : await priceKpis(sym);
    if (!wrap.isConnected || !lines.length) { card.dataset.filled = ''; return; }
    const host = card.querySelector('[data-kpi-rows]'); if (host) host.innerHTML = kpiRows(lines);
    const cap = card.querySelector('[data-kpi-cap]'); if (cap) cap.textContent = `Metrics analyzed at ${fmtTime()}`;
  } catch (e) { card.dataset.filled = ''; }
}

/* Crypto About identity: coininfo card in the right panel + full description in the left About swap. */
async function fillCryptoAbout(wrap: HTMLElement, sym: string) {
  const host = wrap.querySelector('[data-crypto-about]') as HTMLElement | null;
  if (host && host.dataset.filled) return;
  if (host) host.dataset.filled = '1';
  try {
    const info = await coinInfo(sym);
    if (!wrap.isConnected) return;
    if (info && host) host.innerHTML = cryptoAboutCard(sym, info);
    else if (host) host.dataset.filled = '';
    // left-side About swap: show the FULL description
    if (info && info.description) {
      const left = wrap.querySelector('[data-left-about] p');
      if (left) left.textContent = info.description;
    }
  } catch (e) { if (host) host.dataset.filled = ''; }
}

/* ============ asset-type-aware detail TABS (FMP for equities) ============ */
const priceBook = (price: any, bvps: any) => (price && bvps ? num2(price / bvps) : '—');

function loadingTab(label: string) {
  return `<div class="muted" style="padding:40px 24px;text-align:center;font-size:13px">Loading live ${escapeHtml(label.toLowerCase())}…</div>`;
}

function unavailableTab(label: string, sym: string) {
  return `<div style="margin:48px auto;text-align:center;max-width:440px;color:var(--dim)">
    <div style="font-size:15px;font-weight:600;margin-bottom:8px">${escapeHtml(label)} unavailable</div>
    <div style="font-size:13px;color:var(--dimmer);line-height:1.5">No verified live ${escapeHtml(label.toLowerCase())} is available for ${escapeHtml(sym)}.</div>
  </div>`;
}

function statisticsReal({ profile, quote, ratios, keyMetrics }: any) {
  const r = ratios || {}, k = keyMetrics || {}, q = quote || {}, p = profile || {};
  const rows: [string, [string, string][]][] = [
    ['Valuation', [['Market cap', market.fmtUsd(p.marketCap || q.marketCap)], ['Enterprise value', market.fmtUsd(k.enterpriseValueTTM)], ['P/E ratio', num2(r.priceToEarningsRatioTTM)], ['EV / Sales', num2(k.evToSalesTTM)], ['Price / Book', priceBook(q.price, r.bookValuePerShareTTM)]]],
    ['Profitability', [['Gross margin', pctFmt(r.grossProfitMarginTTM)], ['Operating margin', pctFmt(r.operatingProfitMarginTTM)], ['Net margin', pctFmt(r.netProfitMarginTTM)], ['EV / EBITDA', num2(k.evToEBITDATTM)]]],
    ['Per share', [['EPS (TTM)', r.netIncomePerShareTTM != null ? '$' + num2(r.netIncomePerShareTTM) : '—'], ['Revenue / share', r.revenuePerShareTTM != null ? '$' + num2(r.revenuePerShareTTM) : '—'], ['Cash / share', r.cashPerShareTTM != null ? '$' + num2(r.cashPerShareTTM) : '—'], ['Dividend yield', pctFmt(r.dividendYieldTTM)]]],
    ['Risk', [['Beta', num2(p.beta)], ['52-wk high', market.fmtPrice(q.yearHigh)], ['52-wk low', market.fmtPrice(q.yearLow)], ['Avg volume', compactNum(p.averageVolume)]]],
  ];
  return `<div class="grid-2" style="margin-top:6px">
    ${rows.map(([title, items]) => `<div class="card"><h3>${title}</h3>
      <div style="margin-top:10px">${items.map(([kk, vv]) => `<div class="cap-row"><span>${kk}</span><b>${vv}</b></div>`).join('')}</div></div>`).join('')}
  </div>`;
}

function earningsReal(sym: string, d: any, sub: string) {
  const past = (d.earnings || []).filter((e: any) => e.epsActual != null).slice(0, 10);
  const head = `<div class="stx-earn-head">
    <span class="stx-earn-title">${logo(sym, 18)} ${sym} Earnings</span>
    ${segmented(['Earnings history', 'Earnings graph'], sub, 'data-earnsub')}
  </div>`;
  const body = sub === 'Earnings graph' ? earningsGraphReal(d) : earningsHistoryReal(past);
  return `<div style="margin-top:6px">${head}${body}</div>`;
}
function earningsHistoryReal(rows: any[]) {
  const body = rows.map((e: any) => {
    const beat = e.epsActual >= e.epsEstimated;
    const surprise = e.epsEstimated ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100 : 0;
    return `<tr><td>${escapeHtml(e.date)}</td>
      <td style="text-align:left"><span class="stx-outcome ${beat ? 'beat' : 'miss'}">${beat ? 'Beat' : 'Missed'}</span></td>
      <td>${num2(e.epsEstimated)}</td><td>${num2(e.epsActual)}</td>
      <td>${market.fmtUsd(e.revenueEstimated)}</td><td>${market.fmtUsd(e.revenueActual)}</td>
      <td class="${surprise >= 0 ? 'up' : 'down'}">${surprise >= 0 ? '+' : ''}${surprise.toFixed(1)}%</td></tr>`;
  }).join('');
  return `<table class="stx-etable">
    <thead><tr><th>Report date</th><th style="text-align:left">Outcome</th><th>Est. EPS</th><th>Actual EPS</th><th>Est. revenue</th><th>Actual revenue</th><th>EPS surprise</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7" style="text-align:center;color:var(--dimmer);padding:24px">No reported earnings yet</td></tr>'}</tbody></table>`;
}
function earningsGraphReal(d: any) {
  const inc = (d.income || []).slice().reverse();                 // chronological reported
  const est = (d.estimates || []).slice().sort((a: any, b: any) => (a.date > b.date ? 1 : -1)); // forecast yrs
  const epsRep = inc.map((x: any) => +(x.epsDiluted || x.eps || 0));
  const epsFc = est.map((x: any) => +(x.epsAvg || 0));
  const revRep = inc.map((x: any) => x.revenue / 1e9);
  const revFc = est.map((x: any) => (x.revenueAvg || 0) / 1e9);
  // real fiscal periods on the x-axis: FY24 … then 2026E for forecast years
  const labels = [
    ...inc.map((x: any) => 'FY' + String(x.calendarYear || (x.date || '').slice(0, 4)).slice(-2)),
    ...est.map((x: any) => String((x.date || '').slice(0, 4)) + 'E'),
  ];
  const card = (title: string, rep: number[], fc: number[], unit: string, fmtV: (v: number) => string) => `
    <div class="card stx-egraph-card" style="margin-bottom:16px">
      <div class="stx-egraph-head"><h4>${title}</h4>
        <div class="stx-leg"><span><i style="background:var(--peach)"></i>Reported</span><span><i style="background:rgba(255,255,255,0.32)"></i>Forecast</span></div></div>
      <div style="height:172px;margin-top:14px">${barChart([...rep, ...fc].map((v: number) => +(+v).toFixed(2)), {
        w: 880, h: 150, gap: 0.3, colors: [...rep.map(() => 'var(--peach)'), ...fc.map(() => 'rgba(255,255,255,0.32)')],
        labels, xaxis: true,
        fmt: (v: number, i: number) => `${i < rep.length ? 'Reported' : 'Forecast'} ${fmtV(v)}` })}</div>
      <div class="muted" style="font-size:10px;margin-top:6px">${unit}</div>
    </div>`;
  return card('EPS — reported &amp; forecast', epsRep, epsFc, 'Diluted EPS, $', (v) => '$' + v.toFixed(2)) +
    card('Revenue — reported &amp; forecast', revRep, revFc, 'Revenue, $B', (v) => '$' + v.toFixed(1) + 'B');
}
function insiderReal(sym: string, trades: any[]) {
  const rows = trades.slice(0, 12).map((x: any) => {
    const buy = x.acquisitionOrDisposition === 'A' || /P-|Purchase/i.test(x.transactionType || '');
    const val = (x.securitiesTransacted || 0) * (x.price || 0);
    return `<tr><td class="rowlabel">${escapeHtml(x.reportingName || '—')}</td>
      <td style="text-align:left;color:var(--dimmer)">${escapeHtml(x.typeOfOwner || '')}</td>
      <td style="text-align:left">${buy ? 'Bought' : 'Sold'}</td>
      <td class="${buy ? 'up' : 'down'}">${buy ? '+' : '−'}$${compactNum(val)}</td>
      <td>${escapeHtml(x.transactionDate || '')}</td></tr>`;
  }).join('');
  return `<table class="dtable" style="margin-top:10px">
    <thead><tr><th>Insider</th><th style="text-align:left">Role</th><th style="text-align:left">Action</th><th>Value</th><th>Date</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
/* Key Indicators copy — matched to screenshot #24 (KPIs tab) */
const KEY_INDICATORS = [
  'Underperforming the S&P 500 by 20.47% YTD',
  'Trading 4.72% below sell estimates',
  'Earnings are forecast to grow 19.98% per year',
];

/* About-tab long description — matched to screenshot #25 */
const ABOUT_DESC: Record<string, string> = {
  TSLA: 'Tesla designs and manufactures electric vehicles and energy generation and storage systems. It operates in two sectors: Automotive and Energy Generation and Storage. The Automotive segment sells electric vehicles and provides associated services and products. The Energy Generation and Storage segment sells solar energy and energy storage products.',
};

/* hand-written, factual descriptions for the macro perps (commodities / FX / indices) —
   these have no FMP profile or CoinGecko entry, so without this they showed the generic
   "designs, manufactures and sells its products" corporate boilerplate. */
const PRICE_ABOUT: Record<string, string> = {
  GOLD: 'Gold is the world’s premier store-of-value metal, held by central banks and investors as a hedge against inflation and currency debasement. Prices are driven by real interest rates, dollar strength, central-bank purchases and safe-haven demand during geopolitical stress.',
  SILVER: 'Silver is both a monetary metal and an industrial input — roughly half of demand comes from electronics, solar panels and photography. It trades with higher volatility than gold and tends to amplify gold’s moves in both directions.',
  PLATINUM: 'Platinum is a precious metal used primarily in automotive catalytic converters, jewellery and industrial catalysts. Supply is concentrated in South Africa and Russia, making prices sensitive to mining disruptions and auto-sector demand.',
  PALLADIUM: 'Palladium is a platinum-group metal used overwhelmingly in gasoline-engine catalytic converters. Russia and South Africa dominate supply; prices swing on auto production cycles and the shift toward electric vehicles.',
  COPPER: 'Copper is the bellwether industrial metal — wiring, construction, EVs and the grid all depend on it, earning it the nickname "Dr. Copper" for its read on global growth. China consumes about half of world supply.',
  ALUMINIUM: 'Aluminium is the second-most-used metal globally, essential to transport, packaging and construction. Production is highly energy-intensive, so prices track power costs and Chinese smelter output.',
  URANIUM: 'Uranium fuels nuclear reactors, and its price reflects the growing bet on nuclear power in the energy transition — driven by reactor restarts, new builds in Asia, and Western supply-chain de-risking away from Russian enrichment.',
  URNM: 'URNM is an exchange-traded fund tracking uranium miners and physical-uranium holders — a leveraged way to express the nuclear-renaissance thesis versus holding the commodity itself.',
  NATGAS: 'US natural gas (Henry Hub benchmark) heats homes, fuels power plants and feeds LNG exports. Prices are famously volatile — weather swings, storage levels and export demand can move the market double digits in a day.',
  TTF: 'TTF (Title Transfer Facility) is Europe’s benchmark natural-gas price, set in the Netherlands. It became a macro barometer after 2022, when the loss of Russian pipeline supply tied European energy security to LNG imports.',
  CL: 'WTI crude oil is the US oil benchmark, priced at Cushing, Oklahoma. It anchors global energy costs and inflation expectations, moving on OPEC+ supply decisions, US shale output and demand cycles.',
  BRENTOIL: 'Brent crude is the international oil benchmark, pricing roughly two-thirds of the world’s traded oil. It reflects seaborne supply-demand balance and carries a geopolitical risk premium in times of conflict.',
  CORN: 'Corn is the most-produced grain on earth, feeding livestock, fuelling ethanol and anchoring food prices. US Midwest weather, planting acreage and export demand drive the market.',
  WHEAT: 'Wheat is a staple food grain whose price sets the cost of bread worldwide. Black Sea supply (Russia and Ukraine are top exporters), weather and strategic stockpiling drive volatility.',
  VOL: 'A volatility market tracking expected price swings — it rises when markets get fearful and falls in calm, trending conditions, making it a hedge against turbulence.',
  SP500: 'The S&P 500 tracks the 500 largest US-listed companies and is the world’s most-watched equity benchmark — the default proxy for "the stock market" and the base asset for trillions in index funds.',
  NDX: 'The Nasdaq-100 tracks the hundred largest non-financial companies on the Nasdaq — a tech-heavy index dominated by mega-cap software, semiconductor and internet names.',
  XYZ100: 'XYZ 100 is a broad basket index of the largest equities listed on trade.xyz — a single instrument for expressing a view on the whole tokenized-equity market.',
  NIFTY: 'The Nifty 50 tracks the fifty largest companies on India’s National Stock Exchange — the benchmark for the world’s fastest-growing major economy.',
  JP225: 'The Nikkei 225 is Japan’s headline stock index, price-weighted across 225 Tokyo-listed blue chips. It moves with the yen, Bank of Japan policy and global tech demand.',
  KR200: 'The KOSPI 200 tracks South Korea’s 200 largest listed companies, dominated by semiconductors and heavy industry — a proxy for global electronics demand.',
  IBOV: 'The Bovespa (IBOV) is Brazil’s benchmark equity index, weighted toward commodities exporters and banks — it trades with iron ore, oil and the real.',
  SMH: 'SMH is the VanEck Semiconductor ETF, holding the largest chip designers, manufacturers and equipment makers — the market’s purest liquid bet on the silicon cycle and AI buildout.',
  XLE: 'XLE is the Energy Select Sector ETF, holding the major US oil and gas companies — a single-ticker expression of the traditional-energy trade.',
  EWY: 'EWY is the iShares MSCI South Korea ETF — broad exposure to Korean equities, led by Samsung and the semiconductor complex.',
  EWJ: 'EWJ is the iShares MSCI Japan ETF — broad exposure to Japanese large caps across autos, electronics and financials.',
  EWZ: 'EWZ is the iShares MSCI Brazil ETF — commodity-heavy exposure to Latin America’s largest economy.',
  EWT: 'EWT is the iShares MSCI Taiwan ETF, dominated by TSMC — effectively a bet on the world’s most important chip foundry and Taiwanese tech.',
  VIX: 'The VIX measures the 30-day implied volatility of S&P 500 options — Wall Street’s "fear gauge". It spikes in selloffs and decays in calm markets, making it a popular hedge and mean-reversion trade.',
  EUR: 'EUR/USD is the world’s most-traded currency pair, setting the exchange rate between the euro area and the United States. It moves on the ECB-Fed policy gap, growth differentials and risk appetite.',
  JPY: 'The Japanese yen is the classic funding and safe-haven currency. USD/JPY tracks the gap between US yields and the Bank of Japan’s ultra-low rates — and snaps violently when carry trades unwind.',
  GBP: 'GBP/USD ("cable") prices the British pound against the dollar, moving on Bank of England policy, UK growth and global risk sentiment.',
  KRW: 'The Korean won is a trade-sensitive currency that tracks semiconductor exports and Chinese demand — a favourite macro proxy for the global electronics cycle.',
  DXY: 'The US Dollar Index (DXY) measures the dollar against a basket of major currencies, euro-weighted. It is the single most important price in global macro — a rising DXY tightens financial conditions everywhere.',
};

function aboutDesc(sym: string) {
  const t = getTicker(sym);
  if (PRICE_ABOUT[sym]) return PRICE_ABOUT[sym];
  if (ABOUT_DESC[sym]) return ABOUT_DESC[sym];
  if (CURATED_EQUITY[sym]) return CURATED_EQUITY[sym].description;
  // real non-equity perps: describe the instrument honestly rather than pretending it's a company
  if (isReal(sym) && market.assetClass(sym) !== 'equity') {
    return `${t.name} (${sym}) trades as a perpetual future${t.world === 'crypto' ? ' on Hyperliquid' : ' on trade.xyz'}. Prices, funding and order-book depth update live; the full profile loads with the market data.`;
  }
  return `${t.name} operates in the ${t.sector} sector. The company designs, manufactures and sells its products and services across multiple markets, generating revenue from core operations and associated services.`;
}
const KPI_KEYS = [
  ['Mkt cap', 'mktCap'], ['EV/Sales', 'evSales'], ['P/E ratio', 'pe'], ['FY Revenue', 'fyRev'], ['EPS', 'eps'],
  ['Gross Margin', 'grossMargin'], ['Profit Margin', 'profitMargin'], ['Beta', 'beta'], ['Div yield', 'divYield'], ['Sector', 'sector'],
];

/* ============================================================================
   News summary card + full-screen takeover (Fey anatomy)
   ========================================================================== */
/* bold the numerals in a one-sentence indicator, e.g. "…by 20.47% YTD" → "…by <b>20.47%</b> YTD" */
function boldNums(s: string) {
  return escapeHtml(s).replace(/(-?\$?\d[\d,]*\.?\d*%?)/g, '<b>$1</b>');
}
/* News summary card body: label + expand icon, a blockquote with a 2px accent bar, caption. */
function newsCardBody(sym: string, digest?: NewsDigest) {
  const lead = digest ? digest.summary : (isReal(sym) ? realNewsLead(sym) : STOCK_NEWS[0][0]);
  const cap = digest ? `News summarized today at ${fmtTime(digest.generated_at)}` : 'News summarized today';
  return `<h5>News summary <span class="stx-panel-expand" data-news-expand>${icon('arrowUp', 13)}</span></h5>
    <blockquote class="stx-news-quote" data-news-lead>${escapeHtml(lead)}</blockquote>
    <div class="stx-panel-foot" data-news-cap>${escapeHtml(cap)}</div>`;
}
/* provenance chip: caution when <4 distinct sources, calmer cross-checked variant when ≥4.
   Mirrors the Analysis 'Sources' provenance styling patterns. */
function provenanceChip(sources: number) {
  const count = Math.max(0, Math.floor(Number(sources) || 0));
  if (count >= 4) {
    return `<div class="stx-prov ok"><span class="stx-prov-bars">${icon('chart', 12)}</span>
      <span class="stx-prov-lab">Cross-checked across ${count} sources</span></div>`;
  }
  return `<div class="stx-prov warn"><span class="stx-prov-bars">${icon('chart', 12)}</span>
    <span class="stx-prov-lab">Consider with caution ${icon('chevDown', 12)}</span>
    <span class="stx-prov-note">This information is from fewer sources and may require further verification</span></div>`;
}
const sentLabel = (s: string) => (/neg/i.test(s) ? 'Negative' : /pos/i.test(s) ? 'Positive' : 'Neutral');

/* ============================================================================
   Deterministic Key Indicators (no LLM) — equity & crypto
   ========================================================================== */
async function equityKpis(sym: string): Promise<string[]> {
  const fs = market.fmpSymbol(sym);
  const rows: string[] = [];
  const [q, spy, pt, est]: any = await Promise.all([
    fmp.quote(fs).catch(() => null),
    fmp.raw('quote?symbol=SPY', 60_000).then((a: any) => (Array.isArray(a) ? a[0] : a)).catch(() => null),
    fmp.priceTarget(fs).catch(() => null),
    fmp.analystEstimates(fs, 'annual', 4).catch(() => null),
  ]);
  // Performance — YTD vs S&P 500 (from FMP quote's YTD-ish change fields)
  const ytd = q && (q.changePercentage != null ? null : null); // FMP quote lacks YTD directly
  const px1y = q && q.price, chg1y = q && q.change;
  if (q && spy && q.changePercentage != null && spy.changePercentage != null) {
    const rel = +(q.changePercentage - spy.changePercentage).toFixed(2);
    rows.push(`${rel >= 0 ? 'Outperforming' : 'Underperforming'} the S&P 500 by ${Math.abs(rel).toFixed(2)}% today`);
  }
  // Valuation — price vs consensus target
  if (pt && pt.targetConsensus && px1y) {
    const gap = +(((pt.targetConsensus - px1y) / px1y) * 100).toFixed(2);
    rows.push(`Trading ${Math.abs(gap).toFixed(2)}% ${gap >= 0 ? 'below' : 'above'} the consensus price target`);
  }
  // Growth — forward EPS growth from analyst estimates
  if (Array.isArray(est) && est.length >= 2) {
    const sorted = est.slice().sort((a: any, b: any) => (a.date > b.date ? 1 : -1));
    const cur = sorted.find((x: any) => x.epsAvg != null);
    const nxt = sorted.reverse().find((x: any) => x.epsAvg != null && x.date > (cur && cur.date));
    if (cur && nxt && cur.epsAvg) {
      const g = +(((nxt.epsAvg - cur.epsAvg) / Math.abs(cur.epsAvg)) * 100).toFixed(2);
      rows.push(`Earnings are forecast to ${g >= 0 ? 'grow' : 'shrink'} ${Math.abs(g).toFixed(2)}% per year`);
    }
  }
  void ytd; void chg1y;
  return rows;
}
async function cryptoKpis(sym: string): Promise<string[]> {
  const rows: string[] = [];
  const [stats, btc]: any = await Promise.all([
    market.assetStats(sym).catch(() => null),
    market.assetStats('BTC').catch(() => null),
  ]);
  const t: any = getTicker(sym);
  if (stats && t) {
    const self24 = stats.chgPct != null ? stats.chgPct : (t.chgPct || 0);
    const btc24 = btc && btc.chgPct != null ? btc.chgPct : ((getTicker('BTC') as any).chgPct || 0);
    if (sym.toUpperCase() !== 'BTC') {
      const rel = +(self24 - btc24).toFixed(2);
      rows.push(`${rel >= 0 ? 'Outperforming' : 'Underperforming'} Bitcoin by ${Math.abs(rel).toFixed(2)}% over 24 hours`);
    } else {
      rows.push(`${self24 >= 0 ? 'Up' : 'Down'} ${Math.abs(self24).toFixed(2)}% over the last 24 hours`);
    }
    if (stats.fundingApr != null && !isNaN(stats.fundingApr)) {
      const f = stats.fundingApr;
      rows.push(`Funding is ${f >= 0 ? 'positive' : 'negative'} at ${Math.abs(f).toFixed(2)}% APR — ${f >= 0 ? 'longs paying shorts' : 'shorts paying longs'}`);
    }
    if (stats.oiNotional != null && !isNaN(stats.oiNotional)) {
      rows.push(`Open interest stands at ${market.fmtUsd(stats.oiNotional)} in notional positioning`);
    }
  }
  return rows;
}
function kpiRows(lines: string[]) {
  return lines.map(k => `<div class="stx-ind-row"><span class="ic">${icon('check', 13)}</span><span class="ind-txt">${boldNums(k)}</span></div>`).join('');
}

/* Key Indicators takeover — grouped, deterministic; reuses the news-overlay chrome. */
async function openKpiExpansion(sym: string) {
  const c = market.assetClass(sym);
  const { el } = openModal(`
    <div class="stx-news-overlay">
      <div class="stx-news-bar">
        <span class="stx-news-tk">${logo(sym, 18)} ${sym}</span>
        <span data-kpi-when>Analyzed just now</span>
        <span class="stx-news-tools"><button class="icon-btn" data-close>${icon('close', 15)}</button></span>
      </div>
      <div class="stx-news-body">
        <div class="stx-news-lead"><h3>Key indicators</h3></div>
        <div data-kpi-groups><div class="muted" style="padding:20px 0;font-size:13px">Computing indicators…</div></div>
      </div>
    </div>`, { size: 'bare' });
  try {
    let groups: [string, string[]][] = [];
    if (c === 'equity') {
      const fs = market.fmpSymbol(sym);
      const [q, spy, pt, est, prof, ratios]: any = await Promise.all([
        fmp.quote(fs).catch(() => null),
        fmp.raw('quote?symbol=SPY', 60_000).then((a: any) => (Array.isArray(a) ? a[0] : a)).catch(() => null),
        fmp.priceTarget(fs).catch(() => null),
        fmp.analystEstimates(fs, 'annual', 4).catch(() => null),
        fmp.profile(fs).catch(() => null),
        fmp.ratiosTtm(fs).catch(() => null),
      ]);
      const perf: string[] = [], val: string[] = [], growth: string[] = [], mom: string[] = [];
      if (q && spy && q.changePercentage != null && spy.changePercentage != null) {
        const rel = +(q.changePercentage - spy.changePercentage).toFixed(2);
        perf.push(`${rel >= 0 ? 'Outperforming' : 'Underperforming'} the S&P 500 by ${Math.abs(rel).toFixed(2)}% today`);
      }
      if (q && q.changePercentage != null) perf.push(`${q.changePercentage >= 0 ? 'Up' : 'Down'} ${Math.abs(q.changePercentage).toFixed(2)}% on the session`);
      if (pt && pt.targetConsensus && q && q.price) {
        const gap = +(((pt.targetConsensus - q.price) / q.price) * 100).toFixed(2);
        val.push(`Trading ${Math.abs(gap).toFixed(2)}% ${gap >= 0 ? 'below' : 'above'} the consensus price target`);
      }
      if (ratios && ratios.priceToEarningsRatioTTM != null) val.push(`Valued at a ${(+ratios.priceToEarningsRatioTTM).toFixed(2)}x trailing P/E`);
      if (Array.isArray(est) && est.length >= 2) {
        const sorted = est.slice().sort((a: any, b: any) => (a.date > b.date ? 1 : -1));
        const cur = sorted.find((x: any) => x.epsAvg != null);
        const nxt = sorted.slice().reverse().find((x: any) => x.epsAvg != null && cur && x.date > cur.date);
        if (cur && nxt && cur.epsAvg) {
          const g = +(((nxt.epsAvg - cur.epsAvg) / Math.abs(cur.epsAvg)) * 100).toFixed(2);
          growth.push(`Earnings are forecast to ${g >= 0 ? 'grow' : 'shrink'} ${Math.abs(g).toFixed(2)}% per year`);
        }
        const cr = sorted.find((x: any) => x.revenueAvg != null);
        const nr = sorted.slice().reverse().find((x: any) => x.revenueAvg != null && cr && x.date > cr.date);
        if (cr && nr && cr.revenueAvg) {
          const rg = +(((nr.revenueAvg - cr.revenueAvg) / Math.abs(cr.revenueAvg)) * 100).toFixed(2);
          growth.push(`Revenue is forecast to ${rg >= 0 ? 'grow' : 'shrink'} ${Math.abs(rg).toFixed(2)}% per year`);
        }
      }
      if (q && q.yearHigh && q.yearLow && q.price) {
        const pos = +(((q.price - q.yearLow) / (q.yearHigh - q.yearLow)) * 100).toFixed(0);
        mom.push(`Sitting at ${pos}% of its 52-week range`);
      }
      if (prof && prof.beta != null) mom.push(`Beta of ${(+prof.beta).toFixed(2)} versus the broad market`);
      groups = [['Performance', perf], ['Valuation', val], ['Growth', growth], ['Momentum', mom]].filter(([, r]) => r.length) as [string, string[]][];
    } else if (c === 'crypto') {
      const lines = await cryptoKpis(sym);
      const stats: any = await market.assetStats(sym).catch(() => null);
      const struct: string[] = [];
      if (stats) {
        if (stats.dayHigh && stats.dayLow && stats.price) {
          const pos = +(((stats.price - stats.dayLow) / (stats.dayHigh - stats.dayLow)) * 100).toFixed(0);
          struct.push(`Trading at ${pos}% of its 24-hour range`);
        }
        if (stats.spreadBps != null) struct.push(`Order-book spread of ${stats.spreadBps.toFixed(1)} bps`);
      }
      groups = [['Relative performance', lines.slice(0, 1)], ['Positioning', lines.slice(1)], ['Market structure', struct]].filter(([, r]) => r.length) as [string, string[]][];
    } else {
      const stats: any = await market.assetStats(sym).catch(() => null);
      const rows: string[] = [];
      if (stats) {
        if (stats.chgPct != null) rows.push(`${stats.chgPct >= 0 ? 'Up' : 'Down'} ${Math.abs(stats.chgPct).toFixed(2)}% over the last 24 hours`);
        if (stats.fundingApr != null) rows.push(`Funding at ${Math.abs(stats.fundingApr).toFixed(2)}% APR`);
        if (stats.oiNotional != null) rows.push(`Open interest of ${market.fmtUsd(stats.oiNotional)}`);
      }
      groups = [['Positioning', rows]].filter(([, r]) => r.length) as [string, string[]][];
    }
    if (!el.isConnected) return;
    const host = el.querySelector('[data-kpi-groups]');
    if (host) {
      host.innerHTML = groups.length
        ? groups.map(([g, rows]) => `<div class="stx-kpi-group"><div class="eyebrow">${g}</div>${kpiRows(rows)}</div>`).join('')
        : '<div class="muted" style="padding:20px 0;font-size:13px">No indicators available for this asset.</div>';
    }
    const when = el.querySelector('[data-kpi-when]');
    if (when) when.textContent = `Metrics analyzed at ${fmtTime()}`;
  } catch (e) { /* keep the loading state */ }
}

/* ============================================================================
   Crypto About identity card (coininfo) — description + pills + facts + links
   ========================================================================== */
const LINK_LABELS: [keyof NonNullable<Awaited<ReturnType<typeof coinInfo>>>['links'], string][] = [
  ['homepage', 'Website'], ['twitter', 'X'], ['coingecko', 'CoinGecko'], ['whitepaper', 'Whitepaper'], ['explorer', 'Explorer'],
];
function coinLinkButtons(links: Record<string, string | undefined>) {
  return LINK_LABELS.map(([k, lb]) => [safeExternalHref(links && links[k as string]), lb] as const)
    .filter(([href]) => href)
    .map(([href, lb]) => `<a class="btn-ghost stx-coin-link" href="${href}" target="_blank" rel="noopener noreferrer">${lb} ${icon('arrowUp', 11)}</a>`)
    .join('');
}
function coinFacts(info: NonNullable<Awaited<ReturnType<typeof coinInfo>>>) {
  const m = info.market || {};
  const rows: [string, string][] = [];
  if (m.rank) rows.push(['Rank', `#${m.rank}`]);
  if (m.mcap) rows.push(['Market cap', market.fmtUsd(m.mcap)]);
  if (m.fdv && m.fdv !== m.mcap) rows.push(['Fully diluted', market.fmtUsd(m.fdv)]);
  if (m.ath) rows.push(['All-time high', `${market.fmtPrice(m.ath)}${m.ath_date ? ' · ' + fmtLongDate(m.ath_date) : ''}`]);
  return rows.map(([k, v]) => `<div class="cap-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
}
function cryptoAboutCard(sym: string, info: NonNullable<Awaited<ReturnType<typeof coinInfo>>>) {
  const t = getTicker(sym);
  const desc = (info.description || '').trim();
  const short = desc.length > 200 ? desc.slice(0, 200).replace(/\s+\S*$/, '') + '…' : desc;
  const pills = (info.categories || []).slice(0, 3).map(c => `<span class="stx-cat-pill">${escapeHtml(c)}</span>`).join('');
  return `<h5>About ${escapeHtml(info.name || t.name)}</h5>
    ${short ? `<p class="stx-coin-desc">${escapeHtml(short)}</p>` : ''}
    ${pills ? `<div class="stx-cat-pills">${pills}</div>` : ''}
    ${coinFacts(info) ? `<div class="stx-coin-facts">${coinFacts(info)}</div>` : ''}
    ${coinLinkButtons(info.links || {}) ? `<div class="stx-coin-links">${coinLinkButtons(info.links || {})}</div>` : ''}`;
}

/* per-range chart config: points, drift, vol, x-axis label kind, "since" suffix */
const RANGE_CFG: Record<string, any> = {
  '1D': { n: 78, drift: 0.0, vol: 0.5, kind: 'intraday', since: 'today', mult: 1 },
  '1W': { n: 60, drift: 0.05, vol: 0.7, kind: 'intraday', since: 'past week', mult: 1.2 },
  '1M': { n: 60, drift: 0.1, vol: 0.9, kind: 'month', since: 'past month', mult: 1.5 },
  '3M': { n: 70, drift: 0.15, vol: 1.0, kind: 'month', since: 'past 3 months', mult: 1.8 },
  'YTD': { n: 80, drift: 0.2, vol: 1.1, kind: 'month', since: 'year to date', mult: 2.2 },
  '1Y': { n: 90, drift: 0.25, vol: 1.3, kind: 'month', since: 'past year', mult: 2.6 },
  '5Y': { n: 120, drift: 0.4, vol: 1.6, kind: 'month', since: 'since 2020', mult: 3.0 },
  'All': { n: 160, drift: 0.55, vol: 1.9, kind: 'month', since: 'since 2010', mult: 3.5 },
};

function heroPrice(t: any, range: string, noteOverride?: string) {
  if (isReal(t.sym)) {
    const cfg0 = RANGE_CFG[range] || RANGE_CFG['1Y'];
    const chg0 = t.chg || 0, pct0 = t.chgPct || 0;
    const since0 = noteOverride ? `<span class="stx-prevnote" style="margin-left:8px">${noteOverride}</span>`
      : range === '1D' ? '' : `<span class="stx-prevnote" style="margin-left:8px">${cfg0.since}</span>`;
    return `<div class="stock__price">
      <span>${splitPrice(t.price)}</span>
      <span class="stock__chg ${cls(chg0)}">${chg0 >= 0 ? '+' : '-'}${fmtChgAbs(chg0)} (${fmtPct(pct0)})</span>
      ${since0}
    </div>`;
  }
  const intPart = Math.floor(t.price), cents = (t.price % 1).toFixed(2).slice(1);
  const cfg = RANGE_CFG[range] || RANGE_CFG['1Y'];
  // long ranges show a large cumulative gain "since YYYY"; short ranges show the day move
  const big = range === '5Y' || range === 'All';
  const chg = big ? +(t.price * (cfg.mult * 5 + 20)).toFixed(2) : t.chg;
  const pct = big ? +(cfg.mult * 6500).toFixed(2) : t.chgPct;
  const sinceTxt = (range === '1D') ? '' : `<span class="stx-prevnote" style="margin-left:8px">${cfg.since}</span>`;
  return `<div class="stock__price">
    <span><span class="px-int">$${intPart}</span><span class="px-cent">${cents}</span></span>
    <span class="stock__chg ${cls(chg)}">${chg >= 0 ? '+' : ''}${big ? chg.toLocaleString() : chg.toFixed(2)} (${fmtPct(pct)})</span>
    ${sinceTxt}
  </div>`;
}

/* right info contexts: News / KPIs / About */
function infoContexts(sym: string) {
  const t = getTicker(sym);
  const real = isReal(sym);
  const cls0 = market.assetClass(sym);
  const cachedNews = _newsCache.get(sym.toUpperCase());
  const news = `<div data-ictx="News">${infoPanel(newsCardBody(sym, cachedNews && cachedNews.digest))}</div>`;
  const venue = t.world === 'crypto' ? 'Hyperliquid' : 'trade.xyz';
  const pct = t.chgPct || 0;
  // KPI card: deterministic rows are async-filled into [data-kpi-rows]; a class-appropriate
  // placeholder shows until then (perps/synthetic keep the live-metric / static copy).
  const placeholder = real ? [
    `${t.name} is ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(2)}% over the last 24 hours`,
    `Trading as a ${t.cat} perpetual on ${venue}`,
  ] : KEY_INDICATORS;
  const kpis = `<div data-ictx="KPIs" hidden>${infoPanel(`
    <h5>Key Indicators <span class="stx-panel-expand" data-kpi-expand>${icon('arrowUp', 13)}</span></h5>
    <div style="margin-top:8px" data-kpi-rows>${kpiRows(placeholder)}</div>
    <div class="stx-panel-foot" data-kpi-cap>${real ? 'Live market metrics' : 'Metrics analyzed today'}</div>`)}</div>`;
  // About: crypto → coininfo identity card (async-filled); equity → Fey fact rows + website.
  let aboutInner: string;
  if (cls0 === 'crypto') {
    aboutInner = `<div data-crypto-about><h5>About ${escapeHtml(t.name)}</h5>
      <div class="muted" style="padding:14px 0;font-size:12.5px">Loading ${escapeHtml(sym)} profile…</div></div>`;
  } else if (real) {
    aboutInner = `<h5>About ${escapeHtml(t.name)}</h5>
      <div style="margin-top:8px" data-about-rows>${[['coin', `${escapeHtml(t.name)} (${escapeHtml(sym)}) is a ${escapeHtml(t.cat)} asset traded as a perpetual future.`],
        ['chart', `Settled and margined on ${venue}${t.world === 'crypto' ? '' : ' (HIP-3 RWA market)'}.`],
        ['book', `Prices, charts and order-book depth are sourced live from Hydromancer.`]]
        .map(([ic, txt]: any) => `<div class="stx-about-row"><span class="ic">${icon(ic, 14)}</span>${txt}</div>`).join('')}</div>`;
  } else {
    const aboutRows = (ABOUT as Record<string, string[][]>)[sym] || ABOUT.TSLA;
    aboutInner = `<h5>About ${escapeHtml(t.name)}</h5>
      <div style="margin-top:8px" data-about-rows>${aboutRows.map(([ic, txt]: any) => `<div class="stx-about-row"><span class="ic">${icon(ic, 14)}</span>${escapeHtml(txt)}</div>`).join('')}</div>
      <button class="btn-ghost" style="margin-top:12px" data-toast="Opening company website">Company website ${icon('arrowUp', 12)}</button>`;
  }
  const about = `<div data-ictx="About" hidden>${infoPanel(aboutInner)}</div>`;
  return news + kpis + about;
}

/* build the chart markup for a given range — used on first render and on range switch */
function rangeChart(sym: string, range: string) {
  const t = getTicker(sym);
  const cfg = RANGE_CFG[range] || RANGE_CFG['1Y'];
  const px = series('px-' + sym + '-' + range, cfg.n, t.chgPct >= 0 ? cfg.drift : -cfg.drift, cfg.vol);
  const labels = dateLabels(cfg.n, cfg.kind === 'intraday' ? 'intraday' : 'month');
  const prev = (t.price - t.chg).toFixed(2);
  const up = range === '5Y' || range === 'All' ? true : t.chg >= 0;
  const real = isReal(sym);
  /* A REAL asset's chart must never be the seeded placeholder walk: when the candle fetch
     failed (or a day-old listing had <2 daily candles) the fake line simply STAYED — a
     fabricated chart under a correct live price. Real assets get a skeleton until real
     candles land; the synthetic walk remains only for the boilerplate demo tickers, where
     it is the only data that exists. */
  const chartInner = real
    ? '<div class="stock__chart-skel" aria-hidden="true"></div>'
    : priceChart(px, {
        w: 760, h: 230,
        stroke: up ? 'rgba(95,207,145,0.95)' : 'rgba(255,255,255,0.82)',
        fill: up ? 'rgba(74,201,134,0.07)' : 'rgba(255,255,255,0.05)',
        labels, fmt: (v: number) => '$' + (v * cfg.mult).toFixed(2),
      });
  return `
    <span class="usd-tag" style="position:absolute;right:0;top:-2px">${exchangeTag(sym)}</span>
    ${range === '1D' && !real ? `<div class="prevclose">Previous close ${prev}</div>` : ''}
    <div class="stock__chart" data-live-chart data-sym="${sym}" data-range="${range}">${chartInner}</div>`;
}

function abbrevSector(s: string) {
  const map: Record<string, string> = { 'Consumer Cyclical': 'Cons Cyc', 'Consumer Defensive': 'Cons Def', 'Communication': 'Comm', 'Technology': 'Tech', 'Healthcare': 'Health', 'Utilities': 'Util' };
  return map[s] || s;
}

/* Fetch everything the analyst cards need — consensus ratings, price targets, and the asset's
   REAL price history (the target chart plots this, never a synthetic line). Shared by the
   scroll-section fill and the legacy chart-tab fill. Returns null when nothing real exists. */
async function realAnalystData(sym: string): Promise<any | null> {
  const fs = market.fmpSymbol(sym);
  const [g, pt, q, chart]: any = await Promise.all([
    fmp.grades(fs).catch(() => null),
    fmp.priceTarget(fs).catch(() => null),
    fmp.quote(fs).catch(() => null),
    market.chartData(sym, '1Y').catch(() => null),
  ]);
  const price = getTicker(sym).price;
  const real: any = { price };
  if (g) real.grades = { strongSell: g.strongSell || 0, sell: g.sell || 0, neutral: g.hold || 0, buy: g.buy || 0, strongBuy: g.strongBuy || 0, label: g.consensus || '—' };
  if (pt && pt.targetConsensus) {
    // targets are denominated in the FMP LISTING's terms (its own currency/scale) — for
    // cross-listed aliases (ADRs, KRX/TSE/HK) that scale can differ wildly from the venue
    // perp's price. Compute the % potential against FMP's OWN quote (currency-consistent),
    // and rescale the fan's target lines into venue terms when the scales diverge >20%.
    const fmpPrice = q && +q.price > 0 ? +q.price : null;
    const base = fmpPrice || price;
    const k = fmpPrice && price && Math.abs(fmpPrice - price) / price > 0.2 ? price / fmpPrice : 1;
    real.pt = { value: pt.targetConsensus * k, low: pt.targetLow * k, median: pt.targetMedian * k, high: pt.targetHigh * k,
                potential: base ? +(((pt.targetConsensus - base) / base) * 100).toFixed(2) : 0 };
  }
  if (chart && chart.closes && chart.closes.length > 1) {
    // downsample to ~80 points so the line stays smooth at card size
    const closes = chart.closes; const step = Math.max(1, Math.floor(closes.length / 80));
    real.hist = closes.filter((_: number, i: number) => i % step === 0 || i === closes.length - 1);
  }
  return (real.grades || real.pt) ? real : null;
}

function analystCards(sym: string, real?: any) {
  // Live assets render ONLY what's real — no demo targets on real profiles. The price-target
  // chart plots the asset's REAL price history with a dashed projection fan to the real
  // High/Median/Low targets + Current tick on the right axis (Fey anatomy, Mobbin ref).
  const isReal = !!real;
  const r = (real && real.grades) || (isReal ? null : RATINGS);
  const p = (real && real.pt) || (isReal ? null : PRICE_TARGET);
  const hist = (real && real.hist && real.hist.length > 1) ? real.hist : series('pt-' + sym, 40, 0.4, 1.2);
  let ratingsCard = '';
  if (r) {
    const [vLabel, vCls] = ratingsVerdict(r);    // deterministic Optimistic/Mixed/Pessimistic verdict
    ratingsCard = `<div class="card ratings-card">
      <h4>Analyst ratings</h4><div class="ratings-sub ${vCls}">${vLabel}</div>
      ${spider([r.strongSell, r.sell, r.neutral, r.buy, r.strongBuy], [['Strong Sell', r.strongSell], ['Sell', r.sell], ['Neutral', r.neutral], ['Buy', r.buy], ['Strong Buy', r.strongBuy]], { size: 240, sup: true })}
    </div>`;
  }
  const ptCard = p ? `<div class="card pt-card">
      <h4>Price target</h4><div class="pt-sub">$${(+p.value).toFixed(2)} (${p.potential >= 0 ? '+' : ''}${p.potential}% potential)</div>
      <div class="pt-chart">${priceTargetChart(hist, p, { w: 440, h: 200, current: (real && real.price) || null })}</div>
    </div>` : '';
  if (!ratingsCard && !ptCard) return '';
  return `<div class="grid-2">${ratingsCard}${ptCard}</div>`;
}

/* ---------------- Earnings tab: history vs graph sub-tabs ---------------- */
const EARN_HISTORY: [string, string, string, string, string, string, number, number][] = [
  ['Q4 2024 · Jan 30, 2025', 'Missed', '0.77', '0.73 (-5.1%)', '27.13B', '25.71B (-5.23%)', -3.43, -9.44],
  ['Q3 2024 · Oct 23, 2024', 'Beat', '0.60', '0.72 (+20.0%)', '25.30B', '25.18B (-0.47%)', 2.51, 12.50],
  ['Q2 2024 · Jul 23, 2024', 'Beat', '0.62', '0.52 (-16.1%)', '24.74B', '25.50B (+3.07%)', -1.06, -4.79],
  ['Q1 2024 · Apr 23, 2024', 'Missed', '0.49', '0.45 (-8.2%)', '22.30B', '21.30B (-4.48%)', -2.40, -10.33],
  ['Q4 2023 · Jan 24, 2024', 'Missed', '0.74', '0.71 (-4.1%)', '25.62B', '25.17B (-1.76%)', -7.36, -12.13],
  ['Q3 2023 · Oct 18, 2023', 'Beat', '0.74', '0.66 (-10.8%)', '24.14B', '23.35B (-3.27%)', -4.78, -4.21],
  ['Q2 2023 · Jul 19, 2023', 'Beat', '0.82', '0.91 (+10.9%)', '24.48B', '24.93B (+1.84%)', -0.21, -0.32],
  ['Q1 2023 · Apr 19, 2023', 'Beat', '0.85', '0.85 (+0.4%)', '23.34B', '23.33B (-0.04%)', -9.75, -9.75],
  ['Q4 2022 · Jan 25, 2023', 'Beat', '1.13', '1.19 (+5.3%)', '24.16B', '24.32B (+0.66%)', 11.00, 9.86],
  ['Q3 2022 · Oct 19, 2022', 'Beat', '1.00', '1.05 (+5.0%)', '21.99B', '21.45B (-2.43%)', -6.65, -7.14],
];

function earningsTab(sym: string, sub = 'Earnings history') {
  const t = getTicker(sym);
  const head = `<div class="stx-earn-head">
    <span class="stx-earn-title">${logo(sym, 18)} ${sym} Earnings
      <span class="pill ${t.chg >= 0 ? 'up' : 'down'}">${t.chg >= 0 ? '+' : ''}${t.chg.toFixed(2)} (${t.chgPct.toFixed(2)}%)</span></span>
    ${segmented(['Earnings history', 'Earnings graph'], sub, 'data-earnsub')}
  </div>`;
  return `<div style="margin-top:6px">${head}${sub === 'Earnings graph' ? earningsGraph(sym) : earningsHistory(sym)}</div>`;
}

function earningsHistory(sym: string) {
  const rows = EARN_HISTORY.map(r => {
    const beat = r[1] === 'Beat';
    return `<tr>
      <td>${r[0]}</td>
      <td style="text-align:left"><span class="stx-outcome ${beat ? 'beat' : 'miss'}">${r[1]}</span></td>
      <td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td>
      <td class="${r[6] >= 0 ? 'up' : 'down'}">${r[6] >= 0 ? '+' : ''}${r[6].toFixed(2)} (${r[7] >= 0 ? '+' : ''}${r[7].toFixed(2)}%)</td>
    </tr>`;
  }).join('');
  return `
    <table class="stx-etable">
      <thead><tr>
        <th>Prices in USD</th><th style="text-align:left">Outcome</th><th>Estimated EPS</th>
        <th>Actual EPS</th><th>Est. revenue</th><th>Actual revenue</th><th>24h change</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function earningsGraph(sym: string) {
  const periods = ['2021 Q2','2021 Q3','2021 Q4','2022 Q1','2022 Q2','2022 Q3','2022 Q4','2023 Q1','2023 Q2','2023 Q3','2023 Q4','2024 Q1','2024 Q2','2024 Q3','2024 Q4','2025 Q1','2025 Q2'];
  const epsRep = series('eps-rep-' + sym, periods.length, 0.2, 1.1).map((v: number) => v);
  const epsFc = epsRep.map((v: number, i: number) => v * (i > 12 ? 0.92 : 1));
  const revRep = series('rev-rep-' + sym, periods.length, 0.3, 1.0).map((v: number) => v);
  const revFc = revRep.map((v: number, i: number) => v * (i > 12 ? 0.9 : 1));
  const xlabels = `<div class="stx-egraph-x">${periods.map(p => `<span>${p.replace(' ', '-')}</span>`).join('')}</div>`;
  // interleave forecast (light) + reported (peach) bars per period
  const buildBars = (rep: number[], fc: number[]) => {
    const vals: number[] = [], colors: string[] = [];
    rep.forEach((v, i) => { vals.push(fc[i]); colors.push('rgba(255,255,255,0.32)'); vals.push(v); colors.push('var(--peach)'); });
    return barChart(vals, { w: 880, h: 150, colors, gap: 0.25 });
  };
  const card = (title: string, rep: number[], fc: number[], yoy: number, qoq: number) => `
    <div class="card stx-egraph-card" style="margin-bottom:16px">
      <div class="stx-egraph-head">
        <h4>${title}</h4>
        <div class="stx-leg"><span><i style="background:rgba(255,255,255,0.32)"></i>Forecast</span><span><i style="background:var(--peach)"></i>Reported</span></div>
        <div class="stx-growth"><span>Growth YoY <b class="${yoy >= 0 ? 'up' : 'down'}">${yoy}%</b></span><span>Growth QoQ <b class="${qoq >= 0 ? 'up' : 'down'}">${qoq}%</b></span></div>
      </div>
      <div style="height:150px;margin-top:14px">${buildBars(rep, fc)}</div>
      ${xlabels}
    </div>`;
  return card('Historical EPS', epsRep, epsFc, 6.49, 2.31) + card('Historical Revenue', revRep, revFc, 8.92, 0.83);
}

function insiderTab(sym: string) {
  const rows: [string, string, string, string, string][] = [
    ['Elon Musk', 'CEO', 'Sold', '−$1.10B', 'Nov 2024'], ['Vaibhav Taneja', 'CFO', 'Sold', '−$2.4M', 'Oct 2024'],
    ['Robyn Denholm', 'Chair', 'Bought', '+$1.2M', 'Sep 2024'], ['Kimbal Musk', 'Director', 'Sold', '−$0.8M', 'Aug 2024'],
  ];
  return `<table class="dtable" style="margin-top:10px">
    <thead><tr><th>Insider</th><th style="text-align:left">Role</th><th style="text-align:left">Action</th><th>Value</th><th>Date</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="rowlabel">${r[0]}</td><td style="text-align:left;color:var(--dimmer)">${r[1]}</td><td style="text-align:left">${r[2]}</td><td class="${r[3].startsWith('+') ? 'up' : 'down'}">${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody>
  </table>`;
}

function financialsTab(sym: string) {
  const years = ['2018', '2019', '2020', '2021', '2022'];
  const income = [22, 25, 32, 54, 82];
  const fin = { revenue: series('rev-' + sym, 16, 0.6, 0.8), profit: series('pm-' + sym, 16, 0.2, 0.6), net: series('ni-' + sym, 16, 0.3, 0.7) };
  return `<div style="margin-top:6px">
    <div class="sec-title" style="margin-top:0">Financials <span class="sec-badge">F</span>
      <button class="btn-ghost" style="margin-left:auto" data-all-financials>${icon('list', 13)} All financials</button></div>
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between"><h4 style="font-size:12px">Income statement</h4><span class="muted" style="font-size:10px">Currency in USD</span></div>
        <div style="height:150px;margin-top:12px">${barChart(income, { w: 320, h: 150, colors: income.map((_, i) => i % 2 ? '#3a4bd0' : '#5b6cf0') })}</div>
        <div class="muted" style="font-size:10px;margin-top:6px">${years.map(escapeHtml).join('   ')}</div>
      </div>
      <div class="card">
        <div style="font-size:22px;font-weight:600;color:var(--up)">+18.80%</div>
        <div class="muted" style="font-size:11px">Revenue growth Y/Y</div>
        <div style="margin-top:14px">
          <div class="cap-row"><span><span class="cap-dot" style="background:#5b6cf0"></span>Revenue</span><b>96.77B</b></div>
          <div class="cap-row"><span><span class="cap-dot" style="background:#7c83f5"></span>Net income</span><b>15B</b></div>
          <div class="cap-row"><span><span class="cap-dot" style="background:#e6c84f"></span>Profit margin</span><b>15.50%</b></div>
        </div>
        <div class="muted" style="font-size:10px;margin-top:12px">Latest fiscal year: 2022</div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between"><h4 style="font-size:12px">Financials</h4>${segmented(['Quarterly', 'Annual'], 'Quarterly', 'data-fin')}</div>
      <div style="height:200px;margin-top:14px">${multiLine([
        { values: fin.revenue, color: '#a78bfa', sw: 1.4 }, { values: fin.profit, color: '#e6c84f', dash: '3 3', sw: 1.2 }, { values: fin.net, color: 'rgba(255,255,255,0.6)', dash: '2 3', sw: 1.2 },
      ], { w: 860, h: 200 })}</div>
      <div class="cover__chart" style="border:none;padding:0;margin-top:8px"><div class="leg"><span><i style="background:#a78bfa"></i>Revenue</span><span><i style="background:#e6c84f"></i>Profit margin</span><span><i style="background:rgba(255,255,255,.6)"></i>Net income</span></div></div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card"><h4 style="font-size:12px">Annual returns</h4><div class="muted" style="font-size:10px">Above average</div>
        <div style="margin-top:14px">${[['TSLA', 71.50], ['Consumer Cyclical', 6.67], ['US Market', 21.76]].map(([n, v]: any) => `
          <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span class="muted">${n}</span><span class="${cls(v)}">+${v}%</span></div>
          <div class="peer-bar"><span style="width:${Math.min(100, v)}%"></span></div></div>`).join('')}</div>
      </div>
      <div class="card"><h4 style="font-size:12px">Annual margin trends</h4><div class="muted" style="font-size:10px">Expanding margins</div>
        <div style="height:120px;margin-top:14px">${multiLine([{ values: series('mt1-' + sym, 12, 0.2, 0.5), color: '#e8736e' }, { values: series('mt2-' + sym, 12, 0.3, 0.6), color: 'rgba(255,255,255,0.6)', dash: '3 3' }], { w: 320, h: 120 })}</div>
      </div>
    </div>
  </div>`;
}

/* peers body WITHOUT the inner "Peer analysis P" sec-title — used as a stacked-section
   body where the section header is already supplied by secHead(). */
function peersSectionBody(sym: string, innerHeader: boolean) {
  return `<div style="margin-top:6px">
    <div class="grid-2">
      <div class="card"><h4 style="font-size:12px;text-align:center">Latest cap</h4><div class="muted" style="font-size:10px;text-align:center">Currency in USD</div>
        <div style="height:160px;margin-top:14px">${barChart([44, 14], { w: 200, h: 160, colors: ['#5b6cf0', '#c9c977'], gap: 0.5 })}</div>
        <div class="muted" style="font-size:10px;margin-top:6px;display:flex;justify-content:space-around"><span>Enterprise Value</span><span>Total Capital</span></div>
      </div>
      <div class="card"><h4 style="font-size:12px;text-align:center">Capitalization breakdown</h4><div class="muted" style="font-size:10px;text-align:center">Currency in USD</div>
        <div style="margin-top:14px">${CAP_BREAKDOWN.map(([k, v, c]: any) => `<div class="cap-row"><span><span class="cap-dot" style="background:${c}"></span>${k}</span><b>${v}</b></div>`).join('')}</div>
      </div>
    </div>
    ${innerHeader ? `<div class="sec-title" style="margin-top:28px">Peer analysis <span class="sec-badge">P</span>
      <button class="btn-ghost" style="margin-left:auto" data-edit-peers>${icon('sliders', 13)} View all</button></div>` : '<div style="height:20px"></div>'}
    ${PEERS.map(([tk, name, growth, num, pill]: any) => `
      <div class="peer-row">
        <span class="peer-name">${logo(tk, 24)}<span><b style="font-weight:600">${tk}</b> <span class="muted" style="font-size:11px">${name}</span></span></span>
        <span class="muted" style="font-size:11px">Est. revenue growth</span>
        <span class="peer-bar"><span style="width:${Math.min(100, growth)}%"></span></span>
        <span class="up">+${growth}%</span>
        <span style="text-align:right">${num} <span class="pill up" style="margin-left:4px">${pill}</span></span>
      </div>`).join('')}
    <div style="margin-top:18px"><button class="btn-ghost" data-edit-peers>${icon('sliders', 13)} Edit peers list</button></div>
  </div>`;
}
// Signals tab — cross-source podcast/newsletter consensus on this asset (the view paste.trade
// lacks). Placeholder HTML; fillTab() async-fills [data-sigtab] from /api/signals/asset/:sym.
function signalsTab(sym: string) {
  return `<div data-sigtab class="sig-stockwrap"><div class="muted" style="padding:24px;font-size:13px">Loading ${escapeHtml(sym)} signals…</div></div>`;
}

function signalsStock(sym: string, r: any) {
  const xp = (v: any) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  if (!r || r.available === false) return '<div class="muted" style="padding:24px;font-size:13px">Signals database unavailable.</div>';
  const s = r.sentiment, calls = Array.isArray(r.calls) ? r.calls : [];
  let head = '';
  if (s) {
    const lab = s.agreement === 'consensus long' ? 'Consensus LONG' : s.agreement === 'consensus short' ? 'Consensus SHORT' : 'Split view';
    const c2 = s.net_bias > 0.1 ? 'up' : s.net_bias < -0.1 ? 'down' : '';
    const voices = Math.max(0, Number(s.distinct_callers) || 0);
    const longs = Math.max(0, Number(s.longs) || 0);
    const shorts = Math.max(0, Number(s.shorts) || 0);
    head = `<div class="sig-stockhead"><div class="lab ${c2}">${lab}</div>
      <div class="meta">${voices} ${voices === 1 ? 'voice' : 'voices'} · ${longs} long / ${shorts} short`
      + (s.avg_excess != null ? ` · <span class="${s.avg_excess >= 0 ? 'up' : 'down'}">${xp(s.avg_excess)} vs BTC</span>` : '') + `</div></div>`;
  }
  if (!calls.length) return head + `<div class="muted" style="padding:24px;font-size:13px">No tracked podcast or newsletter calls on ${escapeHtml(sym)} yet.</div>`;
  const rows = calls.map((c: any) => {
    const lr = (c.returns && c.returns.live) || {};
    const v = lr.excess != null ? lr.excess : lr.signed;
    const direction = /^long$/i.test(String(c.direction || '')) ? 'long' : /^short$/i.test(String(c.direction || '')) ? 'short' : 'neutral';
    return `<div class="sig-stockrow"><span class="dir ${direction}">${direction}</span>`
      + `<span class="q">“${escapeHtml(String(c.headline_quote || c.quote || '').slice(0, 100))}”</span>`
      + `<span class="who">${escapeHtml(c.person || c.source || '')}</span>`
      + `<span class="ret ${v == null ? '' : v >= 0 ? 'up' : 'down'}">${xp(v)}${lr.excess != null ? ' vs BTC' : ''}</span></div>`;
  }).join('');
  return head + `<div class="sig-stocklist">${rows}</div>`
    + `<a class="sig-cta" style="margin-top:14px" href="#/signals/${sym}">All ${escapeHtml(sym)} signals →</a>`;
}

/* ---------------- centered top toast (#44) ---------------- */
let ctoastEl: HTMLDivElement | null, ctoastT: any;
function centerToast(sym: string, msg: string) {
  if (!ctoastEl) { ctoastEl = document.createElement('div'); ctoastEl.className = 'stx-ctoast'; document.body.appendChild(ctoastEl); }
  const mark = document.createElement('span'); mark.innerHTML = logo(safeSymbol(sym), 16);
  const label = document.createElement('span'); label.textContent = msg;
  const close = document.createElement('span'); close.className = 'stx-ctoast-x'; close.innerHTML = icon('close', 13);
  ctoastEl.replaceChildren(mark, label, close);
  ctoastEl.classList.add('show');
  close.onclick = () => ctoastEl && ctoastEl.classList.remove('show');
  clearTimeout(ctoastT);
  ctoastT = setTimeout(() => ctoastEl && ctoastEl.classList.remove('show'), 2600);
}

/* ---------------- share-chart modal (#42) ---------------- */
function openShareChart(sym: string) {
  const t = getTicker(sym);
  const px = series('share-' + sym, 60, t.chg >= 0 ? 0.2 : -0.2, 1.1);
  const slug = Math.random().toString(36).slice(2, 9);
  const summary = `U.S. carmaker ${String(t.name || sym)} will acquire parts of the insolvent German high-tech parts maker Manz AG, including more than 300 employees at its site in Reutlingen, the German company said on Tuesday.`;
  const { el, close } = openModal(`
    <div class="modal-head">Share chart <button class="icon-btn" data-close>${icon('close', 16)}</button></div>
    <div class="modal-body">
      <div class="stx-share-cards">
        <div class="stx-share-card">
          <div class="stx-sc-head"><span class="stx-sc-tk">${logo(sym, 16)} ${sym}</span><span class="pill ${t.chg >= 0 ? 'up' : 'down'}" style="font-size:9px">Buy</span></div>
          <div class="stx-sc-px">$${t.price.toFixed(2)}<span class="stx-sc-chg ${cls(t.chg)}">${t.chg.toFixed(2)} (${fmtPct(t.chgPct)})</span></div>
          <div class="stx-sc-chart">${areaChart(px, { w: 280, h: 90, stroke: t.chg >= 0 ? 'var(--up)' : 'var(--down)', fill: t.chg >= 0 ? 'rgba(95,207,145,0.12)' : 'rgba(240,141,131,0.12)' })}</div>
          <div class="stx-sc-ranges">${RANGES.map(r => `<span class="${r === '1D' ? 'on' : ''}">${r}</span>`).join('')}</div>
        </div>
        <div class="stx-share-card stx-sc-text">
          <div class="stx-sc-head"><span class="stx-sc-tk">${logo(sym, 16)} ${sym}</span></div>
          <p style="margin-top:8px">${escapeHtml(summary)}</p>
        </div>
      </div>
      <div class="stx-share-actions">
        <button class="stx-share-expand" data-share-expand>${icon('arrowUp', 14)} Expand</button>
        <button data-share-copy>${icon('link', 14)} Copy</button>
      </div>
      <div class="stx-share-url">
        <span class="stx-link-ic">${icon('link', 14)}</span>
        <span>hence.com/share/${sym}/${slug}</span>
      </div>
    </div>`, { size: 'wide' });
  initCharts(el);
  el.querySelector('[data-share-copy]')?.addEventListener('click', () => { toast('Link copied to clipboard', { icon: 'check' }); });
  el.querySelector('[data-share-expand]')?.addEventListener('click', () => { close(); openNewsSummary(sym); });
}

/* ---------------- news summary takeover (full-screen reader) ---------------- */
/* Render the "Other headlines" list from real articles + the digest's per-article sentiment. */
function newsHeadlinesHtml(articles: any[], digest?: NewsDigest) {
  const sentByI = new Map<number, string>();
  if (digest && Array.isArray(digest.items)) digest.items.forEach((it) => sentByI.set(Number(it.i), String(it.sentiment || '')));
  return (Array.isArray(articles) ? articles : []).slice(0, 12).map((a: any, i: number) => {
    const sent = sentLabel(sentByI.get(i) || digest?.sentiment || 'Neutral');
    const url = safeExternalHref(a.url || a.link || '');
    const when = (a.publishedDate || a.date || '').replace('T', ', ').slice(0, 21);
    const src = a.site || a.publisher || '';
    return `<a class="stx-news-item"${url ? ` href="${url}" target="_blank" rel="noopener noreferrer"` : ''}>
      <div class="stx-ni-title">${escapeHtml(a.title || '')}</div>
      <div class="stx-ni-body">${escapeHtml(String(a.text || '').slice(0, 200))}</div>
      <div class="stx-ni-meta"><span class="stx-src">${icon('calendar', 11)} ${escapeHtml(when)}</span>
        <span class="stx-sent ${sentClass(sent)}">${sent}</span>
        ${src ? `<span class="stx-src">· ${escapeHtml(src)}</span>` : ''}</div>
    </a>`;
  }).join('');
}
function openNewsSummary(sym: string) {
  const t = getTicker(sym);
  const cached = _newsCache.get(sym.toUpperCase());
  const now = new Date();
  const scannedAt = cached ? fmtTime(cached.digest.generated_at) : fmtTime();
  const leadDate = cached ? fmtLongDate(cached.digest.generated_at) : fmtLongDate();
  const leadTxt = cached
    ? `${leadDate}. ${cached.digest.summary}`
    : (isReal(sym) ? realNewsLead(sym) : `${fmtLongDate()}. ${STOCK_NEWS[0][0]}`);
  const prov = cached ? provenanceChip(cached.digest.sources) : '';
  const items = cached ? newsHeadlinesHtml(cached.articles, cached.digest) : '';
  const { el } = openModal(`
    <div class="stx-news-overlay">
      <div class="stx-news-bar">
        <span class="stx-news-tools"><button class="icon-btn" data-close>${icon('close', 15)}</button></span>
        <span class="stx-news-tk">${logo(sym, 18)} ${sym}</span>
        <span data-news-scanned>Scanned at ${scannedAt}</span>
      </div>
      <div class="stx-news-body">
        <div class="stx-news-lead">
          <div class="stx-news-logochip">${logo(sym, 20)} ${sym}</div>
          <h3>News summary</h3>
          <p data-news-lead>${escapeHtml(leadTxt)}</p>
          <div data-news-prov>${prov}</div>
        </div>
        <div class="stx-news-sub">Other headlines</div>
        <div data-news-items>${items || '<div class="muted" style="padding:16px 0;font-size:13px">Scanning recent coverage…</div>'}</div>
      </div>
    </div>`, { size: 'bare' });
  void now;
  // if we didn't have a cached digest yet (expand before the card filled), fetch+digest now
  if (!cached && market.isReady() && ['equity', 'crypto'].includes(market.assetClass(sym))) (async () => {
    try {
      const c = market.assetClass(sym);
      const fs = market.fmpSymbol(sym);
      const arts: any = c === 'crypto' ? await fmp.cryptoNews(12, fs) : await fmp.stockNews(fs, 12);
      if (!arts || !arts.length || !el.isConnected) return;
      const digest = await ai.newsDigestFull(t.name, arts.slice(0, 10)).catch(() => null);
      if (!el.isConnected) return;
      if (digest) {
        _newsCache.set(sym.toUpperCase(), { digest, articles: arts });
        const lead = el.querySelector('[data-news-lead]'); if (lead) lead.textContent = `${fmtLongDate(digest.generated_at)}. ${digest.summary}`;
        const scan = el.querySelector('[data-news-scanned]'); if (scan) scan.textContent = `Scanned at ${fmtTime(digest.generated_at)}`;
        const pv = el.querySelector('[data-news-prov]'); if (pv) pv.innerHTML = provenanceChip(digest.sources);
      }
      const host = el.querySelector('[data-news-items]');
      if (host) host.innerHTML = newsHeadlinesHtml(arts, digest || undefined);
    } catch (e) { /* keep loading state */ }
  })();
}

function hexToTint(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

/* ============================================================================
   SINGLE-SCROLL ASSET PAGE (Fey layout)
   ---------------------------------------------------------------------------
   The page is a stack of <section data-sec="…"> containers rendered ONCE per
   [sym]. Hero + stats fill immediately (fillStock). Each deep-dive section is
   filled lazily the first time it nears the viewport (one IntersectionObserver),
   via a per-section filler scoped to its own container — so no fill ever clobbers
   another section, and landing on the page doesn't fire every FMP call at once.
   ========================================================================== */

/* Fey section header: h2 title + kbd chip on the left, optional ghost pill on the right.
   Pills exist only where a RICHER destination does (analyst coverage, signals, compare) —
   sections that already show everything inline get no pill, and their letter hotkeys
   scroll to the section instead (the old per-tab takeover pages are retired). */
function secHead(title: string, key: string, allLabel = '', allHref = '', allIcon = 'sliders') {
  const pill = allLabel && allHref
    ? `<a class="btn-ghost" style="margin-left:auto" href="${allHref}">${icon(allIcon, 13)} ${allLabel}</a>`
    : '';
  return `<div class="sec-title">${title} <span class="sec-badge">${key}</span>${pill}</div>`;
}

/* HERO — the existing chart-tab content (price block, chart+ranges, News|KPIs|About card).
   Reuses chartTab() verbatim EXCEPT the embedded analyst block is dropped: Analyst becomes
   its own stacked section below, so it must not be duplicated here (querySelector fills
   would otherwise only hit the first [data-analyst]). */
function heroSection(sym: string, range: string) {
  return `
    <div class="stock-overview">
      <div>
        <div data-left-default>
          <div data-hero>${heroPrice(getTicker(sym), range)}</div>
          <div class="stock__chartwrap" data-chartwrap>${rangeChart(sym, range)}</div>
        </div>
        <div data-left-about hidden>
          <h2 class="stx-about-title" style="font-size:19px;font-weight:600;margin:2px 0 18px">About ${escapeHtml(getTicker(sym).name)}</h2>
          <p style="font-size:14px;line-height:1.65;color:var(--dim);max-width:560px">${escapeHtml(aboutDesc(sym))}</p>
        </div>
        <div class="range-row">${segmented(RANGES, range, 'data-range')}
          <span style="margin-left:auto"><button class="btn-ghost" data-compare>${icon('sliders', 13)} Compare metrics ${icon('chevDown', 12)}</button>
          <button class="btn-ghost" data-share-chart style="margin-left:6px">${icon('link', 13)} Share</button></span>
        </div>
      </div>
      <div>
        ${infoContexts(sym)}
        <div class="info-head-tabs">${segmented(['News', 'KPIs', 'About'], 'News', 'data-info')}</div>
      </div>
    </div>
    ${isReal(sym) ? realStatStrip(sym) : `<div class="kpi-strip">
      ${KPI_KEYS.map(([k, key]) => `<div class="kpi"><div class="kpi__k">${k}</div><div class="kpi__v">${escapeHtml(key === 'sector' ? abbrevSector((getTicker(sym) as any)[key]) : (getTicker(sym) as any)[key])}</div></div>`).join('')}
    </div>`}`;
}

/* ---- deterministic Fey verdict subtitles (cheap, data-driven) ---- */
function ratingsVerdict(g: any) {
  const bull = (g.buy || 0) + (g.strongBuy || 0), bear = (g.sell || 0) + (g.strongSell || 0);
  if (bull > bear * 1.25) return ['Optimistic', 'up'];
  if (bear > bull * 1.25) return ['Pessimistic', 'down'];
  return ['Mixed', ''];
}

/* Analyst section body — the two cards, with verdict subtitles baked into analystCards. */
function analystSection(sym: string) {
  return `<div data-analyst>${loadingTab('analyst coverage')}</div>`;
}

/* Category/class peers — a compact same-category row list for crypto & price assets,
   filled from market.bulkStats. Rows link to #/stock/SYM; the subject is tagged. */
function catPeersSection(sym: string) {
  return `<div data-catpeers class="sig-stocklist"><div class="muted" style="padding:20px;font-size:13px">Loading peers…</div></div>`;
}
async function fillCatPeers(host: HTMLElement, sym: string) {
  if (host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const self = getTicker(sym);
    const cls = market.assetClass(sym);
    const self24 = self.chgPct || 0;
    const row = (tk: string, name: string, price: number, chg: number, isSelf: boolean) => {
      const safeTk = safeSymbol(tk);
      if (!safeTk) return '';
      const safePrice = Number.isFinite(Number(price)) ? Number(price) : 0;
      const safeChg = Number.isFinite(Number(chg)) ? Number(chg) : 0;
      return `<a class="sig-stockrow catpeer-row"${isSelf ? '' : ` href="#/stock/${safeTk}"`}>
        <span class="who" style="display:flex;align-items:center;gap:9px;min-width:0">${logo(safeTk, 22)}<span class="catpeer-name"><b style="font-weight:650">${escapeHtml(safeTk)}</b> <span class="muted" style="font-size:11px">${escapeHtml(name)}</span></span>${isSelf ? ' <span class="catpeer-self">This asset</span>' : ''}</span>
        <span class="q" style="text-align:right;font-variant-numeric:tabular-nums">${market.fmtPrice(safePrice)}</span>
        <span class="ret ${safeChg >= 0 ? 'up' : 'down'}" style="text-align:right;min-width:64px">${safeChg >= 0 ? '+' : ''}${safeChg.toFixed(2)}%</span>
      </a>`;
    };
    // EQUITIES: REAL peers via FMP's stock-peers (same industry/size bracket — the same
    // source the AI analysis screen uses), quoted live. Peers not listed on our venues
    // still link — /stock/:sym renders them as research pages. Falls through to the
    // venue-activity list only when FMP has no peer set for this symbol.
    if (cls === 'equity') {
      const fs = market.fmpSymbol(sym);
      const raw: any = await fmp.stockPeers(fs).catch(() => null);
      const peerSyms: string[] = (Array.isArray(raw)
        ? raw.map((p: any) => (typeof p === 'string' ? p : p && p.symbol))
        : raw && raw[0] && Array.isArray(raw[0].peersList) ? raw[0].peersList : [])
        .filter(Boolean).map((s: any) => String(s).toUpperCase())
        .filter((s: string) => s !== fs && s !== sym)
        .slice(0, 6);
      if (peerSyms.length >= 2) {
        const quotes = await Promise.all(peerSyms.map((s) => fmp.quote(s).catch(() => null)));
        if (!host.isConnected) return;
        const peerRows = quotes.map((q: any, i: number) => {
          if (!q || !q.price) return '';
          // FMP's stable quote uses changePercentage; older shapes used changesPercentage
          const chg = q.changePercentage != null ? q.changePercentage : (q.changesPercentage || 0);
          return row(peerSyms[i], q.name || '', q.price, chg, false);
        }).join('');
        if (peerRows) {
          host.innerHTML = row(sym, self.name, self.price, self24, true) + peerRows;
          return;
        }
      }
      if (!host.isConnected) return;
    }

    // fallback / crypto / price classes: peers from the venue universe
    let pool: any[];
    if (cls === 'crypto') {
      const cat = self.cat || '';
      pool = market.assetsByWorld('crypto').filter((a: any) => a.cat === cat && a.sym !== sym);
    } else {
      pool = market.assetsByWorld(self.world || 'stocks')
        .filter((a: any) => market.assetClass(a.sym) === cls && a.sym !== sym);
    }
    // top by live open interest / volume; take the subject + up to 6 peers
    const coins = [market.coinFor(sym), ...pool.slice(0, 24).map((a: any) => a.coin)];
    const stats: any = await market.bulkStats(coins).catch(() => ({}));
    if (!host.isConnected) return;
    const ranked = pool
      .map((a: any) => ({ a, s: stats[a.coin] || {} }))
      .filter((x: any) => x.s.price)
      .sort((x: any, y: any) => (y.s.oiNotional || y.s.dayVol || 0) - (x.s.oiNotional || x.s.dayVol || 0))
      .slice(0, 6);
    const selfRow = row(sym, self.name, self.price, self24, true);
    const peerRows = ranked.map((x: any) => {
      // 24h change for a peer isn't in bulkStats; use the universe's daily-change field if present
      const chg = x.a.chgPct != null ? x.a.chgPct : 0;
      return row(x.a.sym, x.a.name, x.s.price, chg, false);
    }).join('');
    host.innerHTML = ranked.length ? selfRow + peerRows : unavailableTab('Peer data', sym);
  } catch (e) { host.dataset.filled = ''; host.innerHTML = '<div class="muted" style="padding:20px;font-size:13px">Peers unavailable.</div>'; }
}

/* ---- per-section scoped fillers for the equity deep-dive sections ----
   Each queries WITHIN its own [data-sec] container so it can only ever replace
   its own body — never the whole host (the old fillTab whole-host-replace trap). */
async function fillAnalystSection(sec: HTMLElement, sym: string) {
  const host = sec.querySelector('[data-analyst]') as HTMLElement | null;
  if (!host || host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const real = await realAnalystData(sym);
    if (!host.isConnected) return;
    if (real) { host.innerHTML = analystCards(sym, real); initCharts(host); }
    else host.innerHTML = unavailableTab('Analyst coverage', sym);
  } catch (e) { host.innerHTML = unavailableTab('Analyst coverage', sym); }
}
async function fillStatisticsSection(sec: HTMLElement, sym: string) {
  const host = sec.querySelector('[data-body]') as HTMLElement | null;
  if (!host || host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const fs = market.fmpSymbol(sym);
    const [profile, quote, ratios, keyMetrics] = await Promise.all([
      fmp.profile(fs).catch(() => null), fmp.quote(fs).catch(() => null),
      fmp.ratiosTtm(fs).catch(() => null), fmp.keyMetricsTtm(fs).catch(() => null)]);
    if (host.isConnected) host.innerHTML = (ratios || quote)
      ? statisticsReal({ profile, quote, ratios, keyMetrics })
      : unavailableTab('Company statistics', sym);
  } catch (e) { host.innerHTML = unavailableTab('Company statistics', sym); }
}
async function fillEarningsSection(sec: HTMLElement, sym: string, sub: string) {
  const host = sec.querySelector('[data-body]') as HTMLElement | null;
  if (!host) return;
  // re-fillable on sub-toggle: cache the fetched payload on the section node
  if (host.dataset.filled && (host.dataset.sub || '') === sub) return;
  try {
    let d: any = (sec as any)._earnData;
    if (!d) {
      const fs = market.fmpSymbol(sym);
      const [earnings, income, estimates] = await Promise.all([
        fmp.earnings(fs, 16).catch(() => []), fmp.incomeStatement(fs, 'annual', 6).catch(() => []),
        fmp.analystEstimates(fs, 'annual', 6).catch(() => [])]);
      d = { earnings, income, estimates }; (sec as any)._earnData = d;
    }
    if (host.isConnected && d.earnings && d.earnings.length) {
      host.innerHTML = earningsReal(sym, d, sub); host.dataset.filled = '1'; host.dataset.sub = sub; initCharts(host);
    } else if (host.isConnected) host.innerHTML = unavailableTab('Earnings', sym);
  } catch (e) { host.innerHTML = unavailableTab('Earnings', sym); }
}
async function fillInsiderSection(sec: HTMLElement, sym: string) {
  const host = sec.querySelector('[data-body]') as HTMLElement | null;
  if (!host || host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const tr = await fmp.insiderTrades(market.fmpSymbol(sym), 16).catch(() => []);
    if (host.isConnected && tr && tr.length) {
      host.innerHTML = insiderReal(sym, tr);
      const verdict = insiderVerdict(tr);
      const sub = sec.querySelector('[data-verdict]') as HTMLElement | null;
      if (sub && verdict) { sub.textContent = verdict[0]; sub.className = 'sec-verdict ' + verdict[1]; }
    } else if (host.isConnected) host.innerHTML = unavailableTab('Insider trades', sym);
  } catch (e) { host.innerHTML = unavailableTab('Insider trades', sym); }
}
function insiderVerdict(trades: any[]): [string, string] | null {
  let net = 0;
  for (const x of trades) {
    const buy = x.acquisitionOrDisposition === 'A' || /P-|Purchase/i.test(x.transactionType || '');
    const val = (x.securitiesTransacted || 0) * (x.price || 0);
    net += buy ? val : -val;
  }
  if (net < 0) return ['Cashing out', 'down'];
  if (net > 0) return ['Accumulating', 'up'];
  return null;
}
async function fillFinancialsSection(sec: HTMLElement, sym: string, period: string) {
  const host = sec.querySelector('[data-body]') as HTMLElement | null;
  if (!host) return;
  if (host.dataset.filled && (host.dataset.period || '') === period) return;
  try {
    const fs = market.fmpSymbol(sym);
    // wire the REAL Quarterly/Annual fetch (was synthetic-only before)
    const inc = await fmp.incomeStatement(fs, period === 'quarter' ? 'quarter' : 'annual', 8).catch(() => []);
    if (host.isConnected && inc && inc.length) {
      host.innerHTML = financialsSectionBody(sym, inc, period); host.dataset.filled = '1'; host.dataset.period = period; initCharts(host);
    } else if (host.isConnected) host.innerHTML = unavailableTab('Financials', sym);
  } catch (e) { host.innerHTML = unavailableTab('Financials', sym); }
}
async function fillSignalsSection(sec: HTMLElement, sym: string) {
  const host = sec.querySelector('[data-sigtab]') as HTMLElement | null;
  if (!host || host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const r: any = await sig.asset(sym);
    if (host.isConnected) host.innerHTML = signalsStock(sym, r);
  } catch (e) { host.dataset.filled = ''; }
}

/* Financials section body with a working Quarterly/Annual toggle (period wired to real fetch). */
function financialsSectionBody(sym: string, income: any[], period: string) {
  const inc = income.slice().reverse();
  const years = inc.map((x: any) => period === 'quarter'
    ? (x.period ? `${('' + (x.fiscalYear || x.date)).slice(0, 4)} ${x.period}` : ('' + x.date).slice(0, 7))
    : (x.fiscalYear || ('' + x.date).slice(0, 4)));
  const rev = inc.map((x: any) => x.revenue / 1e9);
  const ni = inc.map((x: any) => x.netIncome / 1e9);
  const latest = inc[inc.length - 1] || {}, prev = inc[inc.length - 2] || {};
  const revGrowth = prev.revenue ? ((latest.revenue - prev.revenue) / prev.revenue) * 100 : 0;
  const netMargin = latest.revenue ? (latest.netIncome / latest.revenue) * 100 : null;
  const toggle = `<div class="info-head-tabs" style="margin:0">${segmented(['Quarterly', 'Annual'], period === 'quarter' ? 'Quarterly' : 'Annual', 'data-finper')}</div>`;
  return `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin:-4px 0 10px">${toggle}</div>
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between"><h4 style="font-size:12px">Revenue</h4><span class="muted" style="font-size:10px">USD, billions</span></div>
        <div style="height:150px;margin-top:12px">${barChart(rev.map((v: number) => +(+v).toFixed(1)), { w: 320, h: 150, colors: rev.map((_: any, i: number) => i % 2 ? '#3a4bd0' : '#5b6cf0') })}</div>
        <div class="muted" style="font-size:10px;margin-top:6px">${years.map(escapeHtml).join('   ')}</div>
      </div>
      <div class="card">
        <div style="font-size:22px;font-weight:600" class="${revGrowth >= 0 ? 'up' : 'down'}">${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(2)}%</div>
        <div class="muted" style="font-size:11px">Revenue growth ${period === 'quarter' ? 'Q/Q' : 'Y/Y'}</div>
        <div style="margin-top:14px">
          <div class="cap-row"><span><span class="cap-dot" style="background:#5b6cf0"></span>Revenue</span><b>${market.fmtUsd(latest.revenue)}</b></div>
          <div class="cap-row"><span><span class="cap-dot" style="background:#7c83f5"></span>Net income</span><b>${market.fmtUsd(latest.netIncome)}</b></div>
          <div class="cap-row"><span><span class="cap-dot" style="background:#e6c84f"></span>Net margin</span><b>${netMargin != null ? netMargin.toFixed(2) + '%' : '—'}</b></div>
        </div>
        <div class="muted" style="font-size:10px;margin-top:12px">Latest ${period === 'quarter' ? 'quarter' : 'fiscal year'}: ${escapeHtml(latest.period ? `${('' + (latest.fiscalYear || latest.date)).slice(0, 4)} ${latest.period}` : (latest.fiscalYear || ''))}</div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h4 style="font-size:12px">Revenue &amp; net income</h4>
      <div style="height:200px;margin-top:14px">${multiLine([
        { values: rev, color: '#a78bfa', sw: 1.6 }, { values: ni, color: 'rgba(255,255,255,0.6)', sw: 1.4, dash: '2 3' }], { w: 860, h: 200 })}</div>
      <div class="cover__chart" style="border:none;padding:0;margin-top:8px"><div class="leg"><span><i style="background:#a78bfa"></i>Revenue</span><span><i style="background:rgba(255,255,255,.6)"></i>Net income</span></div></div>
    </div>`;
}

/* ---- the single-scroll section registry, per asset class ----
   Each entry renders a <section data-sec> ONCE; the observer triggers its filler.
   Sections whose data can't exist for an asset class are simply omitted. */
type SecDef = {
  key: string;
  render: (sym: string) => string;          // the section skeleton (header + body container)
  fill?: (sec: HTMLElement, sym: string) => void; // scoped filler run when the section nears view
};
function bodyWrap(head: string, body: string, verdict = false) {
  return `${head}${verdict ? '<div class="sec-verdict" data-verdict></div>' : ''}<div data-body>${body}</div>`;
}
function sectionRegistry(sym: string): SecDef[] {
  const cls = market.assetClass(sym);
  const real = isReal(sym);
  // asset class decides the section list (works even before Hydromancer loads).
  // crypto → category peers + signals; price-class → class peers + signals;
  // equity (and unknown/synthetic tickers, which are equity-shaped) → the full stack.
  if (cls === 'equity') {
    // equity (real) OR any synthetic asset → the full Fey equity stack
    return [
      { key: 'analyst', render: (s) => secHead('Analyst estimates', 'A', 'All estimates', `#/analyst/${s}`, 'sliders') + analystSection(s),
        fill: real ? fillAnalystSection : undefined },
      { key: 'earnings', render: (s) => secHead('Earnings', 'E') + `<div data-body>${real ? `<div class="muted" style="padding:24px;font-size:13px">Loading earnings…</div>` : earningsTab(s)}</div>`,
        fill: real ? (sec, s) => fillEarningsSection(sec, s, sec.dataset.sub || 'Earnings history') : undefined },
      { key: 'financials', render: (s) => secHead('Financials', 'F') + `<div data-body>${real ? `<div class="muted" style="padding:24px;font-size:13px">Loading financials…</div>` : financialsTab(s)}</div>`,
        fill: real ? (sec, s) => fillFinancialsSection(sec, s, sec.dataset.period || 'annual') : undefined },
      { key: 'insider', render: (s) => secHead('Insider trading', 'i') + bodyWrap('', real ? `<div class="muted" style="padding:24px;font-size:13px">Loading insider trades…</div>` : insiderTab(s), true),
        fill: real ? fillInsiderSection : undefined },
      { key: 'peers', render: (s) => secHead('Peer analysis', 'P', 'Compare', `#/compare/${s}`, 'sliders') + catPeersSection(s),
        fill: (sec, s) => fillCatPeers(sec.querySelector('[data-catpeers]') as HTMLElement, s) },
      beliefsEntry(),
      { key: 'signals', render: (s) => secHead('Signals', 'S', 'All signals', `#/signals/${s}`, 'doc') + signalsTab(s),
        fill: fillSignalsSection },
    ];
  }
  // crypto → Movement · Derivatives · Tokenomics · Performance · Protocol earnings ·
  //          Category peers · Market beliefs · Signals (deep-dives first, all hidden-until-data)
  if (cls === 'crypto') {
    return [
      { key: 'movement', render: () => movementSection(), fill: fillMovementSection },
      { key: 'attention', render: () => attentionSection(), fill: fillAttentionSection },
      { key: 'derivatives', render: (s) => derivativesSection(s), fill: fillDerivativesSection },
      { key: 'tokenomics', render: () => tokenomicsSection(), fill: fillTokenomicsSection },
      { key: 'performance', render: () => performanceSection(), fill: fillPerformanceSection },
      { key: 'protoearnings', render: () => protoEarningsSection(), fill: fillProtoEarningsSection },
      { key: 'peers', render: (s) => secHead('Category peers', 'P', 'All peers', `#/screener`, 'sliders') + catPeersSection(s),
        fill: (sec, s) => fillCatPeers(sec.querySelector('[data-catpeers]') as HTMLElement, s) },
      beliefsEntry(),
      { key: 'signals', render: (s) => secHead('Signals', 'S', 'All signals', `#/signals/${s}`, 'doc') + signalsTab(s),
        fill: fillSignalsSection },
    ];
  }
  // commodities / fx / indices ('price') → Class peers + Market beliefs + Signals
  return [
    { key: 'peers', render: (s) => secHead('Class peers', 'P', 'All peers', `#/screener`, 'sliders') + catPeersSection(s),
      fill: (sec, s) => fillCatPeers(sec.querySelector('[data-catpeers]') as HTMLElement, s) },
    beliefsEntry(),
    { key: 'signals', render: (s) => secHead('Signals', 'S', 'All signals', `#/signals/${s}`, 'doc') + signalsTab(s),
      fill: fillSignalsSection },
  ];
}

/* ── Market beliefs [B] — live Polymarket markets matched to this asset ──
   The belief-spine tie-in on asset pages: real prediction-market odds about the asset,
   with Agree/Disagree capture (same idea-object plumbing as the home feed's belief
   checks). Zero-jank: the whole section stays hidden unless matches exist. */
function beliefsEntry(): SecDef {
  return {
    key: 'beliefs',
    render: () => `<div data-beliefs-wrap hidden>
      <div class="sec-title">Market beliefs <span class="sec-badge">B</span><span class="blf-src">via Polymarket</span></div>
      <div data-beliefs></div></div>`,
    fill: fillBeliefsSection,
  };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function fillBeliefsSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-beliefs-wrap]') as HTMLElement | null;
  const host = sec.querySelector('[data-beliefs]') as HTMLElement | null;
  if (!wrap || !host || host.dataset.filled) return; host.dataset.filled = '1';
  try {
    const t = getTicker(sym);
    const words = [sym.length >= 2 ? sym : '', t.name && t.name !== sym ? String(t.name).slice(0, 80) : ''].filter(Boolean);
    if (!words.length) return;
    const re = new RegExp('\\b(' + words.map(escRe).join('|') + ')\\b', 'i');
    const all: any[] = await poly.markets(100).catch(() => []);
    const matches = (all || [])
      .filter((m: any) => m && m.id != null && m.yes != null && re.test(m.question || ''))
      .filter((m: any) => m.yes >= 0.05 && m.yes <= 0.95)      // a live question, not a foregone conclusion
      .sort((a: any, b: any) => (b.liquidity || 0) - (a.liquidity || 0))
      .slice(0, 4);
    if (!matches.length || !host.isConnected) return;           // no matches → section stays hidden
    const cents = (v: number) => Math.round(v * 100) + '¢';
    host.innerHTML = matches.map((m: any) => {
      const marketId = safeOpaqueId(m.id);
      const yes = Number(m.yes);
      if (!marketId || !Number.isFinite(yes)) return '';
      const reacted = stash.reactedMarket(marketId);
      const rail = reacted
        ? `<a class="rail-btn blf-back" href="#/terminal/m/${marketId}">Back it →</a>`
        : `<button class="rail-btn" data-b-act="agree" data-mkt="${marketId}" data-yes="${yes}">Agree</button>
           <button class="rail-btn" data-b-act="disagree" data-mkt="${marketId}" data-yes="${yes}">Disagree</button>`;
      return `<div class="blf-row" data-b-open="${marketId}">
        <div class="blf-main">
          <div class="blf-q">${escapeHtml(m.question)}</div>
          <div class="blf-rail">${rail}</div>
        </div>
        <div class="blf-odds"><span class="pill up">Yes ${cents(yes)}</span><span class="pill down">No ${cents(Number.isFinite(Number(m.no)) ? Number(m.no) : (1 - yes))}</span></div>
      </div>`;
    }).join('');
    wrap.hidden = false;
  } catch (e) { host.dataset.filled = ''; }
}

/* ============================================================================
   CRYPTO-DEPTH SECTIONS — Movement · Derivatives · Tokenomics · Performance ·
   Protocol earnings. Each renders a [data-*-wrap hidden] skeleton and its filler
   flips wrap.hidden=false only once real data lands (zero-jank hidden-until-data,
   same pattern as beliefsEntry). Every fetch degrades to hidden on error/404.
   ========================================================================== */

const MAJORS = new Set(['BTC', 'ETH']);       // ladder + DVOL only exist for the majors
const compactBig = (v: any) => (v == null || isNaN(v) ? '—' : market.fmtUsd(v));
/* compact community counts: 12.4K, 1.2M */
function compactCount(v: any) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return '' + Math.round(v);
}
/* annualized realized vol from daily closes (log-returns), as a fraction (0.65 = 65%) */
function realizedVol(closes: number[]): number | null {
  if (!Array.isArray(closes) || closes.length < 8) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varr = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  const daily = Math.sqrt(varr);
  return daily * Math.sqrt(365);             // annualize
}
/* max drawdown over a close series, as a positive fraction */
function maxDrawdown(closes: number[]): number | null {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  let peak = closes[0], mdd = 0;
  for (const c of closes) { if (c > peak) peak = c; if (peak > 0) mdd = Math.max(mdd, (peak - c) / peak); }
  return mdd;
}
/* a small stat tile */
function statTile(k: string, v: string, cls2 = '') {
  return `<div class="cd-tile"><div class="cd-tile-k">${k}</div><div class="cd-tile-v ${cls2}">${v}</div></div>`;
}
/* verdict subtitle line (matches .ratings-sub styling family) */
function verdictSub(label: string, cls2 = '') { return `<div class="cd-verdict ${cls2}">${label}</div>`; }
/* section header WITHOUT an "All X" button (crypto-depth sections keep it clean) */
function secHeadPlain(title: string, key: string) {
  return `<div class="sec-title">${title} <span class="sec-badge">${key}</span></div>`;
}

/* ── 1. Potential price movement [M] ── two independent cards ── */
function movementSection(): string {
  return `<div data-move-wrap hidden>
    ${secHeadPlain('Potential price movement', 'M')}
    <div class="grid-2 cd-grid" data-move-grid></div>
  </div>`;
}
/* ── Social attention (Elfa A/B cohort only) — hidden unless the team flag is on AND the
      server has data. Measurement only: views, smart-money reposts, trending rank. ── */
function attentionSection() {
  return secHead('Social attention', 'Σ') + `<div data-body><div data-attn class="muted" style="padding:18px;font-size:12.5px">Reading the crowd…</div></div>`;
}
async function fillAttentionSection(sec: HTMLElement, sym: string) {
  const host = sec.querySelector('[data-attn]') as HTMLElement | null;
  if (!host || host.dataset.filled) return; host.dataset.filled = '1';
  let flag = false;
  try { flag = localStorage.getItem('hence.elfaSocial') === '1'; } catch { /* off */ }
  if (!flag || market.assetClass(sym) !== 'crypto') { sec.hidden = true; return; }
  try {
    const r = await fetch('/api/social/token?sym=' + encodeURIComponent(sym)).then((x) => x.json());
    if (!r || !r.available || (!r.views_24h && r.trending_rank == null)) { sec.hidden = true; return; }
    const cells: string[] = [];
    if (r.views_24h) cells.push(`<div class="attn-c"><b>${(r.views_24h / 1e6 >= 1 ? (r.views_24h / 1e6).toFixed(1) + 'M' : Math.round(r.views_24h / 1e3) + 'K')}</b><span>views · 24h top posts</span></div>`);
    if (r.smart_reposts != null) cells.push(`<div class="attn-c"><b>${r.smart_reposts}</b><span>smart-money reposts</span></div>`);
    if (r.trending_rank != null) cells.push(`<div class="attn-c"><b>#${r.trending_rank}</b><span>trending · mentions ${r.mention_change_pct > 0 ? '+' : ''}${Math.round(r.mention_change_pct || 0)}%</span></div>`);
    const links = (r.top_links || []).map((u: string, i: number) => {
      const safe = safeHttpUrl(u); return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">source ${i + 1}</a>` : '';
    }).filter(Boolean).join(' · ');
    host.outerHTML = `<div class="attn-grid">${cells.join('')}</div>`
      + (links ? `<div class="attn-links">${links}</div>` : '')
      + `<div class="attn-note">X + Telegram, bot-filtered · A/B preview (team)</div>`;
  } catch { sec.hidden = true; }
}

async function fillMovementSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-move-wrap]') as HTMLElement | null;
  const grid = sec.querySelector('[data-move-grid]') as HTMLElement | null;
  if (!wrap || !grid || grid.dataset.filled) return; grid.dataset.filled = '1';
  const cls = market.assetClass(sym);
  if (cls !== 'crypto') return;                 // crypto-only section
  try {
    const t = getTicker(sym);
    const cur = t.price;
    let cards = '';
    // (a) Market-implied outlook — majors only, from a Polymarket ladder
    if (MAJORS.has(sym.toUpperCase())) {
      try {
        const words = [sym, t.name && t.name !== sym ? t.name : ''].filter(Boolean);
        const ladders: any[] = await poly.coinLadders(words).catch(() => []);
        const lad = (ladders || [])[0];
        if (lad && lad.points && lad.points.length >= 5 && cur) {
          // nearest strike above current → the headline odds
          const above = lad.points.filter((p: any) => p.strike >= cur).sort((a: any, b: any) => a.strike - b.strike)[0];
          const pAbove = above ? Math.round(above.p * 100) : null;
          const strikeTxt = above ? (above.strike >= 1000 ? '$' + Math.round(above.strike).toLocaleString() : '$' + above.strike) : '';
          const marketId = safeOpaqueId(lad.marketId);
          const href = marketId ? `#/terminal/m/${marketId}` : '';
          cards += `<div class="card cd-card">
            <h4>Market-implied outlook</h4>
            ${pAbove != null ? verdictSub(`Market gives ${pAbove}% odds above ${strikeTxt}`) : ''}
            <div class="cd-chart">${probLadderChart(lad.points, cur, { w: 520, h: 220 })}</div>
            <div class="cd-cap">via Polymarket · ${escapeHtml(lad.title || '')}${href ? ` · <a href="${href}">open →</a>` : ''}</div>
          </div>`;
        }
      } catch (e) { /* ladder unavailable → card omitted */ }
    }
    // (b) Expected range — ALL coins — cone from implied (DVOL) or realized vol
    try {
      let annVol: number | null = null, source = 'recent';
      if (MAJORS.has(sym.toUpperCase())) {
        const dv: any = await dvol(sym).catch(() => null);
        if (dv && dv.available && dv.dvol != null) { annVol = +dv.dvol / 100; source = 'implied'; }
      }
      let closes: number[] | null = null;
      if (annVol == null) {
        const d: any = await market.chartData(sym, '3M').catch(() => null);
        closes = d && d.closes && d.closes.length ? d.closes : null;
        annVol = realizedVol(closes || []);
      } else {
        const d: any = await market.chartData(sym, '1M').catch(() => null);
        closes = d && d.closes && d.closes.length ? d.closes : null;
      }
      if (annVol != null && annVol > 0 && cur) {
        // 30d horizon σ = annualized × sqrt(30/365)
        const s30 = annVol * Math.sqrt(30 / 365);
        const recent = (closes && closes.length >= 8) ? closes.slice(-40) : [cur * 0.98, cur * 1.01, cur];
        const pct = Math.round(s30 * 100);
        cards += `<div class="card cd-card">
          <h4>Expected range</h4>
          ${verdictSub(`±${pct}% expected over 30d`)}
          <div class="cd-chart">${projectionCone(recent, { s1: s30, s2: s30 * 2 }, { w: 520, h: 220, horizonLabel: '30d' })}</div>
          <div class="cd-cap">Expected range from ${source === 'implied' ? 'implied' : 'recent'} volatility — a statistical band (~68%/95%), not a forecast.</div>
        </div>`;
      }
    } catch (e) { /* cone unavailable → card omitted */ }
    if (!cards || !wrap.isConnected) { grid.dataset.filled = ''; return; }
    grid.innerHTML = cards;
    initCharts(grid);
    wrap.hidden = false;
  } catch (e) { grid.dataset.filled = ''; }
}

/* ── 2. Derivatives [D] — perp microstructure (all HL coins) ── */
function derivativesSection(sym: string): string {
  return `<div data-deriv-wrap hidden>
    <div class="sec-title">Derivatives <span class="sec-badge">D</span>
      <a class="btn-ghost" style="margin-left:auto" href="#/terminal/${sym}">${icon('chart', 13)} Trade</a></div>
    <div class="cd-verdict" data-deriv-verdict></div>
    <div data-deriv-body></div></div>`;
}
async function fillDerivativesSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-deriv-wrap]') as HTMLElement | null;
  const body = sec.querySelector('[data-deriv-body]') as HTMLElement | null;
  if (!wrap || !body || body.dataset.filled) return; body.dataset.filled = '1';
  try {
    const [stats, book, trades]: any = await Promise.all([
      market.assetStats(sym).catch(() => null),
      market.orderBook(sym).catch(() => null),
      market.recentTrades(sym).catch(() => []),
    ]);
    if (!stats || !stats.price || !wrap.isConnected) { body.dataset.filled = ''; return; }
    const fApr = stats.fundingApr;
    // taker flow: buy% of last 100 trades
    let buyN = 0, tot = 0;
    for (const tr of (trades || [])) { tot++; if (tr.side === 'buy') buyN++; }
    const buyPct = tot ? Math.round((buyN / tot) * 100) : null;
    // depth within ±1% of mid
    let depth1 = null as number | null;
    if (book && book.bids && book.asks) {
      const mid = stats.price;
      const within = (arr: any[], lo: number, hi: number) => (arr || [])
        .filter((l: any) => l.px >= lo && l.px <= hi)
        .reduce((s: number, l: any) => s + l.px * l.sz, 0);
      depth1 = within(book.bids, mid * 0.99, mid) + within(book.asks, mid, mid * 1.01);
    }
    // max leverage from the universe entry
    const uni: any = (market.getUniverse() || []).find((a: any) => a.sym === sym.toUpperCase());
    const maxLev = uni && uni.maxLev ? uni.maxLev : null;
    const fundingCls = fApr == null ? '' : fApr >= 0 ? 'up' : 'down';
    const fundingDir = fApr == null ? '' : fApr >= 0 ? 'longs paying shorts' : 'shorts paying longs';
    const tiles = [
      statTile('Funding (APR)', fApr != null ? (fApr >= 0 ? '+' : '') + fApr.toFixed(2) + '%' : '—', fundingCls)
        + (fundingDir ? `<div class="cd-tile-sub">${fundingDir}</div>` : ''),
      statTile('Open interest', compactBig(stats.oiNotional)),
      statTile('24h volume', compactBig(stats.dayVolUsd)),
      statTile('24h trades', stats.tradeCount != null ? Math.round(stats.tradeCount).toLocaleString() : '—'),
      statTile('Depth ±1%', depth1 != null ? compactBig(depth1) : '—'),
      statTile('Spread', stats.spreadBps != null ? stats.spreadBps.toFixed(1) + ' bps' : '—'),
    ];
    if (maxLev) tiles.push(statTile('Max leverage', maxLev + '×'));
    // taker-flow split bar
    const flowBar = buyPct != null
      ? `<div class="cd-flow"><div class="cd-flow-head"><span>Taker flow (last ${tot})</span><span class="up">${buyPct}% buy</span><span class="down">${100 - buyPct}% sell</span></div>
         <div class="cd-flow-bar"><span class="buy" style="width:${buyPct}%"></span><span class="sell" style="width:${100 - buyPct}%"></span></div></div>`
      : '';
    body.innerHTML = `<div class="card cd-card">
      <div class="cd-tiles">${tiles.join('')}</div>
      ${flowBar}
      <div class="cd-cap">Live perpetual microstructure · Hyperliquid</div>
    </div>`;
    // verdict
    const v = sec.querySelector('[data-deriv-verdict]') as HTMLElement | null;
    if (v) {
      let label = 'Balanced positioning', vc = '';
      if (fApr != null && fApr > 15) { label = 'Crowded longs'; vc = 'up'; }
      else if (fApr != null && fApr < -15) { label = 'Crowded shorts'; vc = 'down'; }
      v.textContent = label; v.className = 'cd-verdict ' + vc;
    }
    wrap.hidden = false;
  } catch (e) { body.dataset.filled = ''; }
}

/* ── 3. Tokenomics [T] — from coininfo v2 ── */
function tokenomicsSection(): string {
  return `<div data-tok-wrap hidden>
    ${secHeadPlain('Tokenomics', 'T')}
    <div class="cd-grid grid-2" data-tok-grid></div></div>`;
}
async function fillTokenomicsSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-tok-wrap]') as HTMLElement | null;
  const grid = sec.querySelector('[data-tok-grid]') as HTMLElement | null;
  if (!wrap || !grid || grid.dataset.filled) return; grid.dataset.filled = '1';
  if (market.assetClass(sym) !== 'crypto') return;
  try {
    const info: any = await coinInfo(sym);
    if (!info || !wrap.isConnected) { grid.dataset.filled = ''; return; }
    const m = info.market || {};
    const cards: string[] = [];
    // (a) supply / dilution card
    const mcap = m.mcap, fdv = m.fdv;
    const dilution = (mcap && fdv && fdv > mcap) ? (1 - mcap / fdv) : null;
    const circ = m.supply_circ, tot = m.supply_total;
    const circPct = (circ && tot && tot > 0) ? (circ / tot) * 100 : null;
    let supplyRows = '';
    if (mcap) supplyRows += `<div class="cap-row"><span>Market cap</span><b>${market.fmtUsd(mcap)}</b></div>`;
    if (fdv && fdv !== mcap) supplyRows += `<div class="cap-row"><span>Fully diluted (FDV)</span><b>${market.fmtUsd(fdv)}</b></div>`;
    if (dilution != null) supplyRows += `<div class="cap-row"><span>Dilution to FDV</span><b class="down">${(dilution * 100).toFixed(0)}%</b></div>`;
    if (circPct != null) {
      supplyRows += `<div class="cap-row"><span>Circulating</span><b>${circPct.toFixed(0)}% of total</b></div>`;
      supplyRows += `<div class="cd-meter"><span style="width:${Math.min(100, circPct).toFixed(0)}%"></span></div>`;
    }
    if (supplyRows) cards.push(`<div class="card cd-card"><h4>Supply &amp; dilution</h4><div style="margin-top:10px">${supplyRows}</div></div>`);
    // (b) price history + drawdown card
    const ath = m.ath, athDate = m.ath_date, atl = m.atl, atlDate = m.atl_date;
    const cur = getTicker(sym).price;
    const athDd = (ath && cur) ? ((cur - ath) / ath) * 100 : null;
    const pc = info.price_change || {};
    const chip = (lab: string, v: any) => (v == null || isNaN(v)) ? '' :
      `<span class="cd-chip ${v >= 0 ? 'up' : 'down'}">${lab} ${v >= 0 ? '+' : ''}${(+v).toFixed(1)}%</span>`;
    const chips = [chip('7d', pc.d7), chip('30d', pc.d30), chip('1y', pc.y1)].filter(Boolean).join('');
    let histRows = '';
    if (athDd != null) histRows += `<div class="cap-row"><span>From ATH</span><b class="down">${athDd.toFixed(0)}% · ${market.fmtPrice(ath)}${athDate ? ' (' + fmtLongDate(athDate) + ')' : ''}</b></div>`;
    if (atl != null) histRows += `<div class="cap-row"><span>All-time low</span><b>${market.fmtPrice(atl)}${atlDate ? ' (' + fmtLongDate(atlDate) + ')' : ''}</b></div>`;
    if (chips || histRows) cards.push(`<div class="card cd-card"><h4>Price history</h4>${chips ? `<div class="cd-chips">${chips}</div>` : ''}<div style="margin-top:6px">${histRows}</div></div>`);
    // (c) sentiment + community card
    const sent = info.sentiment_up_pct, comm = info.community || {};
    let sentRows = '';
    if (sent != null && !isNaN(sent)) {
      sentRows += `<div class="cap-row"><span>Community sentiment</span><b class="${sent >= 50 ? 'up' : 'down'}">${Math.round(sent)}% bullish</b></div>`;
      sentRows += `<div class="cd-meter"><span style="width:${Math.min(100, sent).toFixed(0)}%"></span></div>`;
    }
    if (comm.telegram) sentRows += `<div class="cap-row"><span>Telegram</span><b>${compactCount(comm.telegram)}</b></div>`;
    if (comm.reddit) sentRows += `<div class="cap-row"><span>Reddit</span><b>${compactCount(comm.reddit)}</b></div>`;
    if (sentRows) cards.push(`<div class="card cd-card"><h4>Sentiment &amp; community</h4><div style="margin-top:10px">${sentRows}</div></div>`);
    // (d) developer activity — ONLY when commits_4w > 0 (stale-repo guard)
    const dev = info.dev || {};
    if (dev.commits_4w != null && dev.commits_4w > 0) {
      const devRows = [
        dev.stars != null ? `<div class="cap-row"><span>GitHub stars</span><b>${compactCount(dev.stars)}</b></div>` : '',
        `<div class="cap-row"><span>Commits (4w)</span><b>${Math.round(dev.commits_4w)}</b></div>`,
        dev.prs_merged != null ? `<div class="cap-row"><span>PRs merged</span><b>${Math.round(dev.prs_merged)}</b></div>` : '',
      ].filter(Boolean).join('');
      const repoHref = safeExternalHref(dev.repo);
      const repoLink = repoHref ? `<a class="btn-ghost stx-coin-link" href="${repoHref}" target="_blank" rel="noopener noreferrer">Repository ${icon('arrowUp', 11)}</a>` : '';
      cards.push(`<div class="card cd-card"><h4>Developer activity</h4><div style="margin-top:10px">${devRows}</div>${repoLink ? `<div class="stx-coin-links" style="margin-top:12px">${repoLink}</div>` : ''}</div>`);
    }
    if (!cards.length || !wrap.isConnected) { grid.dataset.filled = ''; return; }
    grid.innerHTML = cards.join('');
    wrap.hidden = false;
  } catch (e) { grid.dataset.filled = ''; }
}

/* ── 4. Performance [R] — vs BTC / ETH / S&P over 90d + risk stats ── */
function performanceSection(): string {
  return `<div data-perf-wrap hidden>
    ${secHeadPlain('Performance', 'R')}
    <div class="cd-verdict" data-perf-verdict></div>
    <div data-perf-body></div></div>`;
}
async function fillPerformanceSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-perf-wrap]') as HTMLElement | null;
  const body = sec.querySelector('[data-perf-body]') as HTMLElement | null;
  if (!wrap || !body || body.dataset.filled) return; body.dataset.filled = '1';
  if (market.assetClass(sym) !== 'crypto') return;
  try {
    const RANGE = '3M';
    // fetch the subject + benchmarks in parallel (benchmarks degrade individually)
    const [selfD, btcD, ethD, spD, yr]: any = await Promise.all([
      market.chartData(sym, RANGE).catch(() => null),
      market.chartData('BTC', RANGE).catch(() => null),
      market.chartData('ETH', RANGE).catch(() => null),
      market.chartData('SP500', RANGE).catch(() => null),
      market.chartData(sym, '1Y').catch(() => null),
    ]);
    if (!selfD || !selfD.closes || selfD.closes.length < 8 || !wrap.isConnected) { body.dataset.filled = ''; return; }
    // normalize each series to % from its first point
    const norm = (c: number[]) => { const b = c[0]; return b ? c.map(v => ((v - b) / b) * 100) : c.map(() => 0); };
    const lines: any[] = [{ values: norm(selfD.closes), color: '#a78bfa', sw: 1.8, name: sym }];
    const legend: string[] = [`<span><i style="background:#a78bfa"></i>${sym}</span>`];
    const upperSym = sym.toUpperCase();
    if (btcD && btcD.closes && btcD.closes.length >= 8 && upperSym !== 'BTC') {
      lines.push({ values: norm(btcD.closes), color: 'rgba(247,147,26,0.9)', sw: 1.3, name: 'BTC' });
      legend.push('<span><i style="background:rgba(247,147,26,0.9)"></i>BTC</span>');
    }
    if (ethD && ethD.closes && ethD.closes.length >= 8 && upperSym !== 'ETH') {
      lines.push({ values: norm(ethD.closes), color: 'rgba(124,140,255,0.75)', sw: 1.3, dash: '3 3', name: 'ETH' });
      legend.push('<span><i style="background:rgba(124,140,255,0.75)"></i>ETH</span>');
    }
    if (spD && spD.closes && spD.closes.length >= 8) {
      lines.push({ values: norm(spD.closes), color: 'rgba(255,255,255,0.55)', sw: 1.2, dash: '2 3', name: 'S&P' });
      legend.push('<span><i style="background:rgba(255,255,255,0.55)"></i>S&amp;P 500</span>');
    }
    // real dates for the hover + axis (the subject's own candle timestamps)
    const perfLabels = (selfD.labels || []).map((ms: number) => market.fmtLabel(ms, RANGE));
    // risk stats
    const dret = (c: number[]) => { const r: number[] = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) r.push(Math.log(c[i] / c[i - 1])); return r; };
    let beta: number | null = null;
    if (btcD && btcD.closes && btcD.closes.length >= 8 && upperSym !== 'BTC') {
      const a = dret(selfD.closes), b = dret(btcD.closes), n = Math.min(a.length, b.length);
      if (n >= 5) {
        const am = a.slice(-n), bm = b.slice(-n);
        const ma = am.reduce((s, x) => s + x, 0) / n, mb = bm.reduce((s, x) => s + x, 0) / n;
        let cov = 0, vb = 0;
        for (let i = 0; i < n; i++) { cov += (am[i] - ma) * (bm[i] - mb); vb += (bm[i] - mb) ** 2; }
        if (vb > 0) beta = +(cov / vb).toFixed(2);
      }
    }
    const rvol = realizedVol(selfD.closes);
    const mdd = maxDrawdown((yr && yr.closes && yr.closes.length) ? yr.closes : selfD.closes);
    const statRow = [
      beta != null ? statTile('Beta vs BTC', beta.toFixed(2) + '×') : '',
      rvol != null ? statTile('30d realized vol', Math.round(rvol * 100) + '%') : '',
      mdd != null ? statTile('Max drawdown 1Y', '−' + Math.round(mdd * 100) + '%', 'down') : '',
    ].filter(Boolean).join('');
    body.innerHTML = `<div class="card cd-card">
      <div class="cd-perf-head"><h4>Relative performance · 90d</h4><div class="cd-leg">${legend.join('')}</div></div>
      <div class="cd-chart" style="height:200px">${multiLine(lines, { w: 860, h: 200,
        labels: perfLabels.length === selfD.closes.length ? perfLabels : null, xaxis: true,
        fmt: (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' })}</div>
      ${statRow ? `<div class="cd-tiles" style="margin-top:14px">${statRow}</div>` : ''}
      <div class="cd-cap">Normalized to % change over the window · vs BTC / ETH / S&amp;P 500</div>
    </div>`;
    initCharts(body);
    // verdict from vol ratio to BTC
    const v = sec.querySelector('[data-perf-verdict]') as HTMLElement | null;
    if (v && rvol != null) {
      const btcVol = realizedVol((btcD && btcD.closes) || []);
      const ratio = btcVol && btcVol > 0 ? rvol / btcVol : null;
      let label = '', vc = '';
      if (ratio != null) {
        const rtxt = ratio.toFixed(1) + '× BTC volatility';
        if (ratio < 0.9) { label = `Calm — ${rtxt}`; vc = 'up'; }
        else if (ratio < 1.6) { label = `Choppy — ${rtxt}`; vc = ''; }
        else { label = `Wild — ${rtxt}`; vc = 'down'; }
      } else { label = `${Math.round(rvol * 100)}% annualized volatility`; }
      v.textContent = label; v.className = 'cd-verdict ' + vc;
    }
    wrap.hidden = false;
  } catch (e) { body.dataset.filled = ''; }
}

/* serve.py normalizes DefiLlama chart timestamps to unix MILLISECONDS — but guard
   both scales (a raw-seconds point would otherwise land in year 56,000). The arrays
   can arrive unsorted; sortPairs() makes them chronological, and llamaLabels() adds
   the year when the window spans more than ~10 months so a multi-year axis reads. */
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const llamaMs = (ts: any) => { const n = +ts; return n < 1e11 ? n * 1000 : n; };
const sortPairs = (pairs: any[]) => pairs.slice().sort((a, b) => llamaMs(a[0]) - llamaMs(b[0]));
function llamaLabels(pairs: any[]): string[] {
  if (!pairs.length) return [];
  const spanDays = (llamaMs(pairs[pairs.length - 1][0]) - llamaMs(pairs[0][0])) / 86400000;
  return pairs.map((x) => {
    const d = new Date(llamaMs(x[0]));
    if (isNaN(d.getTime())) return '';
    return spanDays > 300
      ? `${MONS[d.getMonth()]} ’${String(d.getFullYear()).slice(-2)}`
      : `${MONS[d.getMonth()]} ${d.getDate()}`;
  });
}

/* ── 5. Protocol earnings [F] — DeFi tokens only, via /api/llama ── */
function protoEarningsSection(): string {
  return `<div data-earn-wrap hidden>
    ${secHeadPlain('Protocol earnings', 'F')}
    <div class="cd-verdict" data-earn-verdict></div>
    <div class="cd-grid grid-2" data-earn-grid></div>
    <div class="cd-cap" data-earn-cap>Data: DefiLlama</div></div>`;
}
async function fillProtoEarningsSection(sec: HTMLElement, sym: string) {
  const wrap = sec.querySelector('[data-earn-wrap]') as HTMLElement | null;
  const grid = sec.querySelector('[data-earn-grid]') as HTMLElement | null;
  if (!wrap || !grid || grid.dataset.filled) return; grid.dataset.filled = '1';
  if (market.assetClass(sym) !== 'crypto') return;
  try {
    const l: any = await llamaInfo(sym);
    if (!l || l.available === false || !wrap.isConnected) { grid.dataset.filled = ''; return; }
    const cards: string[] = [];
    const usd = (v: any) => (v == null || isNaN(v) ? '—' : market.fmtUsd(v));
    // (a) Fees & revenue card
    const fees = l.fees, rev = l.revenue;
    if (fees || rev) {
      let rows = '';
      if (fees) rows += `<div class="cap-row"><span>Fees · 30d</span><b>${usd(fees.d30)}</b></div>`;
      if (rev) rows += `<div class="cap-row"><span>Revenue · 30d</span><b>${usd(rev.d30)}</b></div>`;
      if (fees && fees.y1 != null) rows += `<div class="cap-row"><span>Fees · 1y</span><b>${usd(fees.y1)}</b></div>`;
      if (rev && rev.y1 != null) rows += `<div class="cap-row"><span>Revenue · 1y</span><b>${usd(rev.y1)}</b></div>`;
      if (l.pf != null) rows += `<div class="cap-row"><span>P/F ratio</span><b>${(+l.pf).toFixed(1)}×</b></div>`;
      if (l.ps != null) rows += `<div class="cap-row"><span>P/S ratio</span><b>${(+l.ps).toFixed(1)}× — mcap over annualized revenue</b></div>`;
      const chartData = (fees && fees.chart) || (rev && rev.chart);
      // filter + SORT as [ts, value] pairs so hover labels stay aligned AND chronological
      const feePairs = sortPairs((Array.isArray(chartData) ? chartData : []).filter((x: any) => isFinite(+x[1])));
      const spark = feePairs.length >= 2
        ? `<div class="cd-chart" style="height:90px;margin-top:10px">${areaChart(feePairs.map((x: any) => +x[1]), {
            w: 400, h: 90, stroke: 'rgba(95,207,145,0.9)', fill: 'rgba(95,207,145,0.10)',
            labels: llamaLabels(feePairs), xaxis: true, fmt: (v: number) => market.fmtUsd(v) + ' / day' })}</div>`
        : '';
      cards.push(`<div class="card cd-card"><h4>Fees &amp; revenue</h4><div style="margin-top:10px">${rows}</div>${spark}</div>`);
      // verdict — revenue d30 vs prior 30d if computable from the chart
      const v = sec.querySelector('[data-earn-verdict]') as HTMLElement | null;
      if (v) {
        let label = l.category || 'Live protocol', vc = '';
        const rc = rev && rev.chart;
        if (Array.isArray(rc) && rc.length >= 60) {
          const vals = rc.map((x: any) => +x[1]).filter((n: number) => isFinite(n));
          const last30 = vals.slice(-30).reduce((s, x) => s + x, 0);
          const prev30 = vals.slice(-60, -30).reduce((s, x) => s + x, 0);
          if (prev30 > 0) {
            const g = ((last30 - prev30) / prev30) * 100;
            label = `Revenue ${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(0)}% vs prior 30d`;
            vc = g >= 0 ? 'up' : 'down';
          }
        }
        v.textContent = label; v.className = 'cd-verdict ' + vc;
      }
    }
    // (b) TVL card
    if (l.tvl != null || (Array.isArray(l.tvlHistory) && l.tvlHistory.length >= 2)) {
      const tvlPairs = sortPairs((Array.isArray(l.tvlHistory) ? l.tvlHistory : []).filter((x: any) => isFinite(+x[1])));
      const tvlChart = tvlPairs.length >= 2
        ? `<div class="cd-chart" style="height:110px;margin-top:12px">${areaChart(tvlPairs.map((x: any) => +x[1]), {
            w: 400, h: 110, labels: llamaLabels(tvlPairs), xaxis: true, fmt: (v: number) => market.fmtUsd(v) })}</div>`
        : '';
      const tvlMcap = (l.tvl && l.mcap && l.mcap > 0) ? (l.mcap / l.tvl) : null;
      cards.push(`<div class="card cd-card"><h4>Total value locked</h4>
        <div style="margin-top:10px"><div class="cap-row"><span>TVL</span><b>${usd(l.tvl)}</b></div>
        ${tvlMcap != null ? `<div class="cap-row"><span>Mcap / TVL</span><b>${tvlMcap.toFixed(2)}×</b></div>` : ''}</div>
        ${tvlChart}</div>`);
    }
    if (!cards.length || !wrap.isConnected) { grid.dataset.filled = ''; return; }
    grid.innerHTML = cards.join('');
    initCharts(grid);
    wrap.hidden = false;
  } catch (e) { grid.dataset.filled = ''; }
}

/* upgrade the crypto stats strip with extra cells where data exists (rank/FDV/circ%/ATHΔ/maxLev).
   Runs after the base strip fills; appends cells to [data-stat-strip]. Degrades to no-op. */
async function fillCryptoStatExtras(wrap: HTMLElement, sym: string) {
  const strip = wrap.querySelector('[data-stat-strip]') as HTMLElement | null;
  if (!strip || strip.dataset.extras) return; strip.dataset.extras = '1';
  try {
    const info: any = await coinInfo(sym);
    if (!info || !strip.isConnected) { strip.dataset.extras = ''; return; }
    const m = info.market || {};
    const cur = getTicker(sym).price;
    const uni: any = (market.getUniverse() || []).find((a: any) => a.sym === sym.toUpperCase());
    const cells: [string, string][] = [];
    if (m.rank) cells.push(['Rank', `#${m.rank}`]);
    if (m.fdv && m.fdv !== m.mcap) cells.push(['FDV', market.fmtUsd(m.fdv)]);
    if (m.supply_circ && m.supply_total && m.supply_total > 0) cells.push(['Circ %', ((m.supply_circ / m.supply_total) * 100).toFixed(0) + '%']);
    if (m.ath && cur) cells.push(['ATH Δ', (((cur - m.ath) / m.ath) * 100).toFixed(0) + '%']);
    if (uni && uni.maxLev) cells.push(['Max lev', uni.maxLev + '×']);
    if (!cells.length) { strip.dataset.extras = ''; return; }
    strip.insertAdjacentHTML('beforeend', cells.map(([k, v]) =>
      `<div class="kpi"><div class="kpi__k">${escapeHtml(k)}</div><div class="kpi__v">${escapeHtml(v)}</div></div>`).join(''));
  } catch (e) { strip.dataset.extras = ''; }
}

/* Build the whole single-scroll page skeleton (rendered ONCE per [sym, range]).
   Range only affects the hero; sections don't depend on it. */
function singlePageSkeleton(sym: string, range: string, secs: SecDef[]) {
  const sections = secs.map(d =>
    `<section class="deep-sec" data-sec="${d.key}">${d.render(sym)}</section>`).join('');
  return `<div data-hero-section>${heroSection(sym, range)}</div>
    <div class="deep-dive">${sections}</div>`;
}

/* Patch ONLY the hero price/change text on a live tick — never re-render the tree
   (which would reset scroll, re-observe, and refetch). */
function patchHeroPrice(wrap: HTMLElement, sym: string, range: string) {
  const heroEl = wrap.querySelector('[data-hero]');
  // fillStock may have fallen back to since-listing history (day-old listings); the tick
  // repaint must label the range the chart ACTUALLY shows, not the selected pill
  if (heroEl) heroEl.innerHTML = heroPrice(getTicker(sym), (wrap.dataset.chartRange as string) || range, wrap.dataset.chartNote);
}

/* ============================================================================
   SINGLE-SCROLL asset page (/stock/:sym) — the new default.
   The skeleton is rendered ONCE per [sym] imperatively (NOT via a tick-driven
   dangerouslySetInnerHTML), so a 5s live-price bump can't tear it down. Range
   changes re-render the hero section only. Below-fold sections fill lazily via
   one IntersectionObserver.
   ========================================================================== */
function StockSingle({ sym }: { sym: string }) {
  const ready = useMarketReady();
  const t = getTicker(sym);
  const tintRGB = hexToTint(t.color);
  const hostRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef('1Y');
  const builtRef = useRef('');   // "sym|ready" key of the skeleton currently in the DOM

  useEffect(() => { pushRecent(sym); }, [sym]);   // feed the command menu's real "Recent" group

  // Some venue "equities" are companies FMP can't resolve under our ticker (private /
  // foreign listings like MINIMAX → 0100.HK, ZHIPU → 2513.HK on trade.xyz). These are
  // HOT assets — instead of four "unavailable" husks, swap the FMP sections for a
  // Company research brief (/api/companybrief: verified profile facts where FMP's plan
  // serves them + a hedged AI brief) with competitor chips linking to their pages.
  useEffect(() => {
    if (!ready || market.assetClass(sym) !== 'equity' || !isReal(sym)) return;
    let alive = true;
    (async () => {
      const fs = market.fmpSymbol(sym);
      // the QUOTE is the workhorse: when it resolves, the FMP sections can fill; a
      // profile-only symbol (plan-gated foreign listing) still reads better as a brief
      const q = await fmp.quote(fs).catch(() => null);
      if (!alive || (q && (q as any).price)) return;
      const wrap = hostRef.current;
      if (!wrap) return;
      let firstSec: HTMLElement | null = null;
      ['analyst', 'earnings', 'financials', 'insider'].forEach((k) => {
        const sec = wrap.querySelector(`[data-sec="${k}"]`) as HTMLElement | null;
        if (sec) { if (!firstSec) firstSec = sec; sec.hidden = true; }
      });
      // the research section takes the hidden sections' place
      let host = wrap.querySelector('[data-sec="companybrief"]') as HTMLElement | null;
      if (!host && firstSec) {
        host = document.createElement('section');
        host.className = 'deep-sec';
        host.setAttribute('data-sec', 'companybrief');
        host.innerHTML = secHead('Company research', 'C') +
          `<div class="muted" style="padding:20px;font-size:13px">Researching ${escapeHtml(sym)}…</div>`;
        (firstSec as HTMLElement).before(host);
      }
      if (!host) return;
      try {
        const r = await fetch('/api/companybrief?c=' + encodeURIComponent(sym));
        const b: any = r.ok ? await r.json() : null;
        if (!alive || !host.isConnected) return;
        if (!b || !b.about) {
          host.innerHTML = secHead('Company research', 'C') +
            `<div class="muted" style="padding:20px;font-size:13px">Research brief unavailable right now.</div>`;
          return;
        }
        const facts: string[] = [];
        if (b.profile?.exchange) facts.push(`<div class="cap-row"><span>Listed</span><b>${escapeHtml(b.profile.exchange)} · ${escapeHtml(b.profile.listedSym || '')}</b></div>`);
        if (b.profile?.mktCap) facts.push(`<div class="cap-row"><span>Market cap</span><b>${market.fmtUsd(b.profile.mktCap)} ${escapeHtml(b.profile.currency || '')}</b></div>`);
        if (!b.profile && b.listing) facts.push(`<div class="cap-row"><span>Status</span><b>${escapeHtml(b.listing)}</b></div>`);
        const comps = (b.competitors || []).map((x: any) =>
          x.sym
            ? `<a class="btn-ghost" style="font-size:11.5px" href="#/stock/${escapeHtml(x.sym)}">${escapeHtml(x.name)}</a>`
            : `<span class="btn-ghost" style="font-size:11.5px;opacity:.65;cursor:default">${escapeHtml(x.name)}</span>`
        ).join('');
        host.innerHTML = secHead('Company research', 'C') + `
          <div class="card" style="padding:18px 20px">
            <p style="font-size:13.5px;line-height:1.6;color:var(--dim);margin:0">${escapeHtml(b.about)}</p>
            ${facts.length ? `<div style="margin-top:12px">${facts.join('')}</div>` : ''}
            ${comps ? `<div style="margin-top:14px"><div class="sec-title" style="font-size:11px;margin:0 0 8px">Competitors &amp; comparables</div><div style="display:flex;flex-wrap:wrap;gap:8px">${comps}</div></div>` : ''}
            ${b.bull || b.bear ? `<div style="margin-top:14px;display:grid;gap:6px">
              ${b.bull ? `<div class="cap-row"><span class="up">Bull</span><b style="font-weight:450;text-align:right;max-width:78%">${escapeHtml(b.bull)}</b></div>` : ''}
              ${b.bear ? `<div class="cap-row"><span class="down">Bear</span><b style="font-weight:450;text-align:right;max-width:78%">${escapeHtml(b.bear)}</b></div>` : ''}
            </div>` : ''}
            <div class="muted" style="font-size:10px;margin-top:12px">AI research brief · verify independently · not investment advice</div>
          </div>`;
      } catch (e) { /* section keeps its loading note; a reload retries */ }
    })();
    return () => { alive = false; };
  }, [sym, ready]);

  // Build the skeleton once per [sym, ready] AND wire the lazy per-section fills.
  // The skeleton write is idempotent-guarded (so a price tick / StrictMode re-run can't
  // tear it down), but the fill-wiring runs EVERY time this effect runs so a StrictMode
  // cleanup+rerun (which disconnects the observer) always re-registers it.
  useEffect(() => {
    const wrap = hostRef.current;
    if (!wrap) return;
    const buildKey = `${sym}|${ready}`;
    const secs = sectionRegistry(sym);
    if (builtRef.current !== buildKey || !wrap.firstChild) {
      builtRef.current = buildKey;
      rangeRef.current = '1Y';
      wrap.innerHTML = singlePageSkeleton(sym, rangeRef.current, secs);
      initCharts(wrap);
      fillStock(wrap, sym, rangeRef.current);   // hero + stats fill immediately
    }

    // Lazy per-section fills: each section fills the first time it nears the viewport,
    // so landing on the page doesn't fire every FMP call at once.
    // Primary trigger = one IntersectionObserver (rootMargin ~600px). A rect-based scroll
    // fallback covers embedded/headless contexts where IntersectionObserver never fires.
    const byKey = new Map(secs.map(d => [d.key, d]));
    const MARGIN = 600;
    const runFill = (sec: HTMLElement) => {
      if (sec.dataset.filledSec) return;
      const d = byKey.get(sec.dataset.sec || '');
      if (d && d.fill) { sec.dataset.filledSec = '1'; d.fill(sec, sym); }
    };
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) { if (en.isIntersecting) { runFill(en.target as HTMLElement); io.unobserve(en.target); } }
    }, { rootMargin: `${MARGIN}px 0px` });
    const fillable = [...wrap.querySelectorAll('.deep-sec')].filter(s => byKey.get((s as HTMLElement).dataset.sec || '')?.fill && !(s as HTMLElement).dataset.filledSec) as HTMLElement[];
    fillable.forEach(s => io.observe(s));
    // rect-based fallback: fill any section within MARGIN of the viewport. The initial
    // pass uses setTimeout (a macrotask that fires even when the paint/rAF loop is dormant,
    // e.g. background tabs / headless previews where IntersectionObserver also never fires).
    const sweep = () => { for (const s of fillable) { if (s.dataset.filledSec) continue; const r = s.getBoundingClientRect(); if (r.top < window.innerHeight + MARGIN && r.bottom > -MARGIN) runFill(s); } };
    const t0 = window.setTimeout(sweep, 0);
    window.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep, { passive: true });
    return () => { io.disconnect(); clearTimeout(t0); window.removeEventListener('scroll', sweep); window.removeEventListener('resize', sweep); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, ready]);

  // live-tick patch: rewrite ONLY the hero price/change text on every re-render
  // (App bumps a counter every 5s). No tree rebuild, no scroll reset, no refetch.
  useEffect(() => {
    const wrap = hostRef.current;
    if (wrap && builtRef.current) patchHeroPrice(wrap, sym, rangeRef.current);
  });

  // single-letter hotkeys. 'a' matches the topbar Analyze button (the AI report — and the
  // app-wide 'a' convention); section letters scroll to their section on THIS page (the old
  // per-tab takeover pages are retired); 's' keeps its dedicated signals screen.
  useEffect(() => {
    const dest: Record<string, string> = {
      a: `#/analysis/${sym}`, s: `#/signals/${sym}`,
    };
    // each letter tries its candidate sections in order and scrolls to the first one that is
    // present + visible (equity and crypto pages share letters, e.g. F = financials OR
    // proto-earnings; a hidden-until-data section never swallows the key)
    const scrollKeys: Record<string, string[]> = {
      m: ['movement'], d: ['derivatives'], t: ['tokenomics'], r: ['performance'],
      e: ['earnings'], f: ['financials', 'protoearnings'], i: ['insider'],
      p: ['peers'], b: ['beliefs'],
    };
    const GATES = '[data-move-wrap],[data-deriv-wrap],[data-tok-wrap],[data-perf-wrap],[data-earn-wrap],[data-beliefs-wrap]';
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const key = (e.key || '').toLowerCase();
      const wrap = hostRef.current;
      for (const secKey of (scrollKeys[key] || [])) {
        if (!wrap) break;
        const sec = wrap.querySelector(`[data-sec="${secKey}"]`) as HTMLElement | null;
        if (!sec || sec.offsetParent === null) continue;
        const inner = sec.querySelector(GATES) as HTMLElement | null;
        if (inner && inner.hidden) continue;
        e.preventDefault(); e.stopPropagation();
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // J/K cycle the page's sections (Fey keyboard parity: next/prev)
      if ((key === 'j' || key === 'k') && wrap) {
        const secs = Array.from(wrap.querySelectorAll('[data-hero-section], [data-sec]'))
          .filter((el) => (el as HTMLElement).offsetParent !== null);
        if (secs.length) {
          e.preventDefault(); e.stopPropagation();
          let cur = 0;
          secs.forEach((el, i2) => { if (el.getBoundingClientRect().top <= 90) cur = i2; });
          const next = key === 'j' ? Math.min(secs.length - 1, cur + 1) : Math.max(0, cur - 1);
          secs[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
      const d = dest[key];
      // capture phase + stopPropagation so App.tsx's global 'a'→#/analysis (bubble phase, no
      // symbol context) never double-fires — this page routes 'a' WITH its symbol.
      if (d) { e.preventDefault(); e.stopPropagation(); location.hash = d; }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [sym]);

  // legacy #/stock/:sym/:tab deep links arrive with a scroll intent (StockTabRedirect):
  // wait for the section to exist, scroll once, done.
  useEffect(() => {
    let want = '';
    try {
      want = sessionStorage.getItem('hence.stockSec') || '';
      if (want) sessionStorage.removeItem('hence.stockSec');
    } catch { /* storage off */ }
    if (!want) return;
    // sections above the target keep expanding as their async fills land, pushing the
    // target back out of view — re-assert the scroll until its position is stable
    let tries = 0, stable = 0;
    const iv = window.setInterval(() => {
      if (++tries > 40) { window.clearInterval(iv); return; }
      const sec = hostRef.current?.querySelector(`[data-sec="${want}"]`) as HTMLElement | null;
      if (!sec) return;
      const top = sec.getBoundingClientRect().top;
      if (Math.abs(top - 70) > 130) {
        stable = 0;
        sec.scrollIntoView({ block: 'start' });
      } else if (++stable >= 3) window.clearInterval(iv);
    }, 150);
    return () => window.clearInterval(iv);
  }, [sym]);

  // [ ] cycle the hero timeframe (App's global hence:cyclerange) — the asset chart is the
  // primary place timeframes live, so the keyboard cyclers must work here, not just on lists.
  useEffect(() => {
    const on = (e: Event) => {
      const wrap = hostRef.current; if (!wrap) return;
      const dir = (e as CustomEvent).detail === -1 ? -1 : 1;
      const i = RANGES.indexOf(rangeRef.current);
      const next = RANGES[(i < 0 ? 0 : i + dir + RANGES.length) % RANGES.length];
      rangeRef.current = next;
      const heroHost = wrap.querySelector('[data-hero-section]') as HTMLElement | null;
      if (heroHost) { heroHost.innerHTML = heroSection(sym, next); initCharts(heroHost); fillStock(wrap, sym, next); }
    };
    window.addEventListener('hence:cyclerange', on);
    return () => window.removeEventListener('hence:cyclerange', on);
  }, [sym]);

  const onHostClick = (e: any) => {
    const wrap = hostRef.current;
    if (!wrap) return;
    const seg = e.target.closest?.('.segmented button');
    if (seg) {
      // range switch — re-render the HERO section only (never the deep-dive sections)
      if (seg.dataset.range) {
        seg.parentElement.querySelectorAll('button').forEach((x: HTMLElement) => x.classList.remove('on'));
        seg.classList.add('on');
        rangeRef.current = seg.dataset.range;
        const heroHost = wrap.querySelector('[data-hero-section]') as HTMLElement | null;
        if (heroHost) { heroHost.innerHTML = heroSection(sym, rangeRef.current); initCharts(heroHost); fillStock(wrap, sym, rangeRef.current); }
        return;
      }
      // financials Quarterly/Annual — wire the REAL period fetch (was synthetic-only)
      if (seg.dataset.finper) {
        seg.parentElement.querySelectorAll('button').forEach((x: HTMLElement) => x.classList.remove('on'));
        seg.classList.add('on');
        const sec = seg.closest('[data-sec="financials"]') as HTMLElement | null;
        if (sec) fillFinancialsSection(sec, sym, seg.dataset.finper === 'Quarterly' ? 'quarter' : 'annual');
        return;
      }
      // earnings history/graph sub-toggle — re-fill the earnings section body
      if (seg.dataset.earnsub) {
        seg.parentElement.querySelectorAll('button').forEach((x: HTMLElement) => x.classList.remove('on'));
        seg.classList.add('on');
        const sec = seg.closest('[data-sec="earnings"]') as HTMLElement | null;
        // fill compares the requested sub against the currently-rendered one and re-renders
        // when different (payload is cached on the section node, so no refetch)
        if (sec) fillEarningsSection(sec, sym, seg.dataset.earnsub);
        return;
      }
      // info context switch (News / KPIs / About) — scoped to the hero
      seg.parentElement.querySelectorAll('button').forEach((x: HTMLElement) => x.classList.remove('on'));
      seg.classList.add('on');
      if (seg.dataset.info) {
        const which = seg.dataset.info;
        const heroHost = seg.closest('.stock-overview') as HTMLElement | null;
        const scope = heroHost || wrap;
        scope.querySelectorAll('[data-ictx]').forEach((c: any) => { c.hidden = c.dataset.ictx !== which; });
        const def = scope.querySelector('[data-left-default]') as HTMLElement | null;
        const ab = scope.querySelector('[data-left-about]') as HTMLElement | null;
        if (def && ab) { const isAbout = which === 'About'; def.hidden = isAbout; ab.hidden = !isAbout; }
      }
      return;
    }
    const cmp = e.target.closest?.('[data-compare]');
    if (cmp) { import('./metric-picker.js').then((m: any) => m.openMetricPicker(sym, cmp)); return; }
    if (e.target.closest?.('[data-share-chart]')) { openShareChart(sym); return; }
    if (e.target.closest?.('[data-news-expand]')) { openNewsSummary(sym); return; }
    if (e.target.closest?.('[data-kpi-expand]')) { openKpiExpansion(sym); return; }
    if (e.target.closest?.('[data-all-financials]')) { import('./stock-modals.js').then((m: any) => m.openAllFinancials(sym)); return; }
    if (e.target.closest?.('[data-edit-peers]')) { import('./stock-modals.js').then((m: any) => m.openEditPeers(sym)); return; }
    // Market beliefs — Agree/Disagree captures a stance idea; row tap opens the market
    const bact = e.target.closest?.('[data-b-act]');
    if (bact) {
      const mkt = safeOpaqueId(bact.dataset.mkt);
      if (!mkt) return;
      const yesPx = bact.dataset.yes ? parseFloat(bact.dataset.yes) : null;
      const row = bact.closest('.blf-row');
      const question = (row?.querySelector('.blf-q')?.textContent || '').trim();
      stash.record({
        kind: bact.dataset.bAct === 'agree' ? 'agree' : 'disagree', subject_type: 'prediction_market',
        market_id: mkt, title: question, symbol: sym, symbols: [sym],
        stance: bact.dataset.bAct === 'agree' ? 'yes' : 'no',
        evidence: yesPx != null && !isNaN(yesPx) ? { yes_price_at_reaction: yesPx } : undefined,
      });
      const rail = row?.querySelector('.blf-rail');
      if (rail) rail.innerHTML = `<a class="rail-btn blf-back" href="#/terminal/m/${mkt}">Back it →</a>`;
      toast('Noted — back it? →', { icon: 'check' });
      return;
    }
    const bopen = e.target.closest?.('[data-b-open]');
    if (bopen && !e.target.closest?.('a,button')) {
      const mkt = safeOpaqueId(bopen.dataset.bOpen);
      if (mkt) location.hash = '#/terminal/m/' + mkt;
      return;
    }
  };

  const onBookmark = () => centerToast(sym, `${sym} was added to your list.`);

  return (
    <Shell dockActive="markets">
      <StockTopbar sym={sym} tabs={false} />
      {(getTicker(sym) as any).research ? <ResearchStrip sym={sym} /> : null}
      <div
        className="stock brand-vignette"
        style={{ ['--tint' as any]: tintRGB }}
        data-tabhost
        ref={hostRef}
        onClick={onHostClick}
        onClickCapture={(e: any) => {
          const bm = e.target.closest?.('[data-tk]');
          if (bm && (bm.dataset.toast || '').includes('added to your list')) { e.preventDefault(); e.stopPropagation(); onBookmark(); }
        }}
      />
    </Shell>
  );
}

export default function Stock() {
  const params = useParams();
  const sym = safeSymbol(params.sym || 'TSLA') || 'TSLA';
  useEffect(() => {
    try { track('asset_viewed', { sym, cls: market.assetClass(sym), research: market.isResearch(sym) || undefined }); } catch { /* market not ready */ }
  }, [sym]);
  const ready = useMarketReady();
  const ticker = getTicker(sym);

  // RESEARCH MODE: a symbol outside the venue universe may still be a real listed company
  // (search + the copilot roam all of FMP). Resolve it via FMP profile+quote on demand —
  // success seeds a research ticker (real data, EOD-labeled) and the full page renders.
  const [research, setResearch] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');
  useEffect(() => { setResearch('idle'); }, [sym]);
  useEffect(() => {
    if (!ready || ticker.real || research !== 'idle') return;
    setResearch('loading');
    market.loadResearchTicker(sym).then((ok: boolean) => setResearch(ok ? 'ok' : 'none'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sym, ticker.real, research]);

  // Never show the bundled design fixtures as live financial data. Wait for the
  // market universe, then give unsupported symbols an explicit empty state — but
  // first try to build the page as a RESEARCH page from real FMP data.
  if (!ready || !ticker.real) {
    if (ready && (research === 'idle' || research === 'loading')) {
      return (
        <Shell dockActive="markets">
          <StockTopbar sym={sym} tabs={false} />
          <main style={{ minHeight: '72vh', display: 'grid', placeItems: 'center', padding: 32 }}>
            <section style={{ maxWidth: 520, textAlign: 'center' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Building this page…</div>
              <h2 style={{ margin: '0 0 10px' }}>{sym}</h2>
              <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>Assembling live research data for this asset.</p>
            </section>
          </main>
        </Shell>
      );
    }
    return (
      <Shell dockActive="markets">
        <StockTopbar sym={sym} tabs={false} />
        <main style={{ minHeight: '72vh', display: 'grid', placeItems: 'center', padding: 32 }}>
          <section style={{ maxWidth: 520, textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{!ready ? 'Loading live market data' : 'Live data unavailable'}</div>
            <h2 style={{ margin: '0 0 10px' }}>{sym}</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              {!ready
                ? 'Checking the connected market venues…'
                : 'Hence does not currently have a verified live quote for this symbol, so no price or fundamentals are shown.'}
            </p>
          </section>
        </main>
      </Shell>
    );
  }

  return <StockSingle sym={sym} />;
}
