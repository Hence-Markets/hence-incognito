/* =========================================================
   market.js — real data adapter over Hydromancer.
   Builds a unified asset universe (native Hyperliquid = crypto,
   trade.xyz `xyz` HIP-3 = stocks/RWA, other HIP-3 = crypto),
   writes live prices/changes into TICKERS so getTicker() is real,
   and exposes candles for charts.
   ========================================================= */
import { venueRank, claims } from './venue-priority.ts';
import { perpDexs, meta, allMids, candleSnapshot, assetContext, bulkChanges,
  perpCategories, perpAnnotation, fundingHistory, exchangeStatus, perpDexStatus, perpsAtOiCap, l2Book, recentTrades as hydroRecentTrades } from './hydromancer.js';
import { TICKERS, getTicker } from './data.js';
import { priceChart, initCharts } from './charts.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1000) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + v.toPrecision(3);
}
/* compact USD for big notionals: $2.1B, $940.3M, $12.4K */
export function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
}
export function fmtLabel(ms, range) {
  const d = new Date(ms);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return (range === '1D' || range === '1W') ? `${base}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : base;
}

const XYZ = 'xyz';                       // trade.xyz HIP-3 dex → stocks/RWA world
const worldOf = (dex) => (dex === XYZ ? 'stocks' : 'crypto');
const symOf = (coin) => (coin.includes(':') ? coin.split(':').pop() : coin);

/* 24h reference close from a daily-candle array — guards against malformed/sparse
   windows (e.g. an API hiccup returning a year-old candle as the prev), which would
   otherwise turn a "24h change" into a 1-year change. Returns null if it can't trust it. */
function ref24(c) {
  if (!Array.isArray(c) || c.length < 2) return null;
  const last = c[c.length - 1], prev = c[c.length - 2];
  const gap = (+last.t) - (+prev.t);
  if (!(gap >= 8 * 3600_000 && gap <= 3 * 24 * 3600_000)) return null;  // must be ~1 day apart
  const ref = +prev.c;
  return ref > 0 ? ref : null;
}

/* ---- category heuristics (narrative taxonomy; refreshed 2026, priority-cascade) ----
   More buckets = more narratives surfaced on the home; specific themes win over generic L1/L2.
   Some coins fit two narratives (GRASS=AI+DePIN, ENA=DeFi+RWA) — cascade order picks the primary. */
const MEME = new Set('DOGE SHIB PEPE WIF BONK FLOKI POPCAT BRETT MOG TRUMP PNUT FARTCOIN MEW SPX GIGA PENGU TURBO NEIRO MOODENG PEOPLE WEN BOME MELANIA MOTHER'.split(' '));
const AI = new Set('RENDER RNDR FET TAO AKT VIRTUAL ARC GRASS IO WLD AIXBT KAITO GRIFFAIN ZEREBRO AI16Z VVV TAI'.split(' '));
const GAMING = new Set('IMX GALA AXS SAND MANA RON BEAM PIXEL APE GMT PRIME BIGTIME'.split(' '));
const LST = new Set('LDO RPL ETHFI EIGEN PUFFER SWELL JTO REZ'.split(' '));            // liquid staking + restaking
const RWA = new Set('ONDO OM USUAL RIO POLYX PLUME'.split(' '));                        // tokenized real-world assets
const DEPIN = new Set('HNT IOTX FIL AR STORJ THETA AKT'.split(' '));                    // decentralized physical infra
const DEFI = new Set('UNI AAVE MKR SKY CRV COMP SNX PENDLE ENA MORPHO FLUID DYDX GMX JUP RAY AERO CAKE SUSHI 1INCH HYPE DRIFT'.split(' '));
const L2 = new Set('ARB OP STRK ZK MANTA METIS BLAST SCROLL TAIKO POL MATIC MODE'.split(' '));
const L1 = new Set('BTC ETH SOL BNB AVAX SUI APT SEI TIA NEAR ADA DOT ATOM TON TRX XRP LTC BCH ALGO XLM HBAR KAS BERA MOVE S INJ KAVA MON'.split(' '));
function cryptoCat(s) {
  return MEME.has(s) ? 'Memecoins'
    : AI.has(s) ? 'AI'
    : GAMING.has(s) ? 'Gaming'
    : LST.has(s) ? 'Liquid Staking'
    : RWA.has(s) ? 'RWA'
    : DEPIN.has(s) ? 'DePIN'
    : DEFI.has(s) ? 'DeFi'
    : L2.has(s) ? 'Layer 2'
    : L1.has(s) ? 'Layer 1'
    : 'Altcoins';
}

const FX = new Set('EUR JPY GBP KRW DXY'.split(' '));
const COMMOD = new Set('GOLD SILVER PLATINUM PALLADIUM COPPER ALUMINIUM URANIUM URNM NATGAS CL BRENTOIL CORN WHEAT TTF VOL'.split(' '));
const INDEX = new Set('SP500 XYZ100 NIFTY JP225 KR200 IBOV SMH XLE EWY EWJ EWZ EWT VIX NDX'.split(' '));
function xyzCat(s) { return FX.has(s) ? 'FX' : COMMOD.has(s) ? 'Commodities' : INDEX.has(s) ? 'Indices' : 'Equities'; }

const NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin', AVAX: 'Avalanche',
  SUI: 'Sui', APT: 'Aptos', LINK: 'Chainlink', LTC: 'Litecoin', ADA: 'Cardano', HYPE: 'Hyperliquid', WIF: 'dogwifhat',
  PEPE: 'Pepe', BONK: 'Bonk', SHIB: 'Shiba Inu', UNI: 'Uniswap', AAVE: 'Aave', TAO: 'Bittensor', RNDR: 'Render', FET: 'Artificial SI',
  NVDA: 'NVIDIA', AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta Platforms', TSLA: 'Tesla',
  AMD: 'AMD', NFLX: 'Netflix', COIN: 'Coinbase', HOOD: 'Robinhood', PLTR: 'Palantir', MSTR: 'MicroStrategy', GOLD: 'Gold',
  SILVER: 'Silver', SP500: 'S&P 500', VIX: 'Volatility Index', DXY: 'US Dollar Index', EUR: 'Euro', JPY: 'Japanese Yen',
  BRENTOIL: 'Brent Crude', NATGAS: 'Natural Gas', URANIUM: 'Uranium', COPPER: 'Copper', AVGO: 'Broadcom', QCOM: 'Qualcomm',
  // stocks / ETFs on the HIP-3 venues (real company names; collision-free)
  INTC: 'Intel', ORCL: 'Oracle', MU: 'Micron', SNDK: 'SanDisk', CRCL: 'Circle', COST: 'Costco', LLY: 'Eli Lilly',
  SKHX: 'SK Hynix', TSM: 'TSMC', RIVN: 'Rivian', BABA: 'Alibaba', SMSN: 'Samsung', USAR: 'USA Rare Earth',
  CRWV: 'CoreWeave', URNM: 'Uranium Miners', GME: 'GameStop', SOFTBANK: 'SoftBank', HYUNDAI: 'Hyundai',
  KIOXIA: 'Kioxia', HIMS: 'Hims & Hers', DKNG: 'DraftKings', LITE: 'Lumentum', XLE: 'Energy Sector',
  BX: 'Blackstone', MRVL: 'Marvell', RKLB: 'Rocket Lab', BIRD: 'Allbirds', EBAY: 'eBay', ARM: 'Arm',
  SPCX: 'SpaceX', ASML: 'ASML', BB: 'BlackBerry', DELL: 'Dell', IBM: 'IBM', NOW: 'ServiceNow', NBIS: 'Nebius',
  WDC: 'Western Digital', NOK: 'Nokia', SMH: 'Semiconductor ETF', BE: 'Bloom Energy', ZM: 'Zoom', NFLX2: 'Netflix',
  EWY: 'Korea ETF', EWJ: 'Japan ETF', EWZ: 'Brazil ETF', EWT: 'Taiwan ETF', BMNR: 'BitMine', STRC: 'Stronghold',
  MINIMAX: 'MiniMax', UNITREE: 'Unitree Robotics', CXMT: 'ChangXin Memory', GIGADEV: 'GigaDevice', ZHIPU: 'Zhipu AI', BOT: 'Robotics', DRAM: 'Memory & DRAM', PURRDAT: 'Purr Data',
  // commodities / indices / fx (real asset names)
  CL: 'Crude Oil', WTI: 'WTI Crude', USOIL: 'US Crude Oil', OIL: 'Crude Oil', PLATINUM: 'Platinum',
  // NB: 'GAS' on Hyperliquid is the Neo-ecosystem GAS TOKEN (crypto), NOT the commodity —
  // natural gas is NATGAS (US Henry Hub) / TTF (Dutch hub). Naming GAS 'Natural Gas'
  // produced two "Natural Gas" rows with different prices and icons.
  PALLADIUM: 'Palladium', ALUMINIUM: 'Aluminium', WHEAT: 'Wheat', CORN: 'Corn', SOY: 'Soybeans', GAS: 'Gas (Neo)',
  TTF: 'TTF Gas (EU)',
  USA500: 'S&P 500', US500: 'S&P 500', SMALL2000: 'Russell 2000', JP225: 'Nikkei 225', KR200: 'KOSPI 200',
  XYZ100: 'XYZ 100', SEMI: 'Semiconductors', SEMIS: 'Semiconductors', BIOTECH: 'Biotech', DEFENSE: 'Defense',
  NUCLEAR: 'Nuclear', ENERGY: 'Energy', USENERGY: 'US Energy', USTECH: 'US Tech', INFOTECH: 'Info Tech',
  ROBOT: 'Robotics', MAG7: 'Magnificent 7', GLDMINE: 'Gold Miners', GOLDJM: 'Gold', SILVERJM: 'Silver',
  VOL: 'Volatility', GBP: 'British Pound', KRW: 'Korean Won', QNT: 'Quant',
};
const PALETTE = { Memecoins: '#e6b04a', AI: '#7c5cff', DeFi: '#ff007a', 'Layer 1': '#f7931a', 'Layer 2': '#22c3e6', Gaming: '#a855f7', RWA: '#34d399', DePIN: '#fb7185', 'Liquid Staking': '#60a5fa', Altcoins: '#3b82f6', Equities: '#5b6cf0', FX: '#2dd4bf', Commodities: '#e6c84f', Indices: '#9aa0a6' };

let universe = [];                 // [{coin, sym, name, dex, world, cat}]
const coinBySym = new Map();       // sym -> coin (owned by the highest-priority venue, lib/venue-priority)
const symRank = new Map();         // sym -> venueRank of the current owner
let ready = false;

export const isReady = () => ready;
export const coinFor = (sym) => coinBySym.get(String(sym).toUpperCase()) || String(sym).toUpperCase();
export const assetsByWorld = (world) => universe.filter(a => a.world === world);
export const getUniverse = () => universe;

// Can we place LIVE orders for this symbol? Native HL perps + the trade.xyz HIP-3 dex — both
// USDC-collateralized and covered by a unified account, so no per-dex collateral transfer is
// needed. Other HIP-3 dexes may use a different collateral token → read-only until verified.
// Returns false before the universe is ingested (safe default) and for non-HL assets.
export const isTradeable = (sym) => {
  // INCOGNITO: every order routes to Avantis, so "tradeable" means "Avantis lists it" —
  // NOT the HL/xyz test this returned upstream. A symbol Hyperliquid carries but Avantis
  // does not is read-only here, and vice versa.
  const a = universe.find((x) => x.sym === String(sym).toUpperCase());
  return !!a && !!a.avantis;
};

/* ---- RESEARCH MODE: symbols outside the venue universe, resolved live via FMP ----
   Search + the copilot roam FMP's ~every-US-equity universe; the venues carry ~350.
   For the gap we assemble a research-only page: the FMP profile+quote seed a ticker
   entry (real:true so every section runs its REAL FMP fill — the same data the page
   already renders for venue equities) tagged research:true so the hero labels the
   price as delayed/EOD and the chart pulls FMP EOD history instead of HL candles.
   Major exchanges only — no research pages for OTC/penny listings. */
const RESEARCH_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE AMERICAN', 'NASDAQ GLOBAL SELECT', 'NASDAQ GLOBAL MARKET', 'NASDAQ CAPITAL MARKET', 'NEW YORK STOCK EXCHANGE']);
const researchSyms = new Set();
export const isResearch = (sym) => researchSyms.has(String(sym).toUpperCase());

export async function loadResearchTicker(sym) {
  sym = String(sym || '').toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return false;
  if (researchSyms.has(sym)) return true;
  if (coinBySym.has(sym)) return false;          // a venue asset — not research territory
  // "<SYM>.US" is the collision alias (Altimmune = ALT.US); FMP wants the bare ticker.
  const fs = sym.endsWith('.US') ? sym.slice(0, -3) : sym;
  try {
    const fmp = await import('./fmp.js');
    const [prof, q] = await Promise.all([fmp.profile(fs), fmp.quote(fs)]);
    if (!prof || !q || q.price == null) return false;
    const exch = String(prof.exchangeShortName || prof.exchange || '').toUpperCase();
    if (!RESEARCH_EXCHANGES.has(exch)) return false;
    const ex = TICKERS[sym] || {};
    TICKERS[sym] = {
      ...ex, sym, name: prof.companyName || sym,
      color: ex.color || '#8b8fa3',
      world: 'stocks', cat: prof.sector || 'Equities', sector: prof.sector || 'Equities',
      price: +q.price, chg: +q.change || 0, chgPct: +q.changesPercentage || 0,
      exchange: prof.exchangeShortName || prof.exchange || '',
      real: true, research: true, changeReal: true, synthetic: false, unavailable: false,
    };
    researchSyms.add(sym);
    return true;
  } catch { return false; }
}

/* EOD daily history mapped to the chartData shape (research symbols have no HL candles) */
async function researchChartData(sym, range = '1Y') {
  const cfg = RANGE[range] || RANGE['1Y'];
  const fmp = await import('./fmp.js');
  const from = new Date(Date.now() - Math.max(cfg.ms, 7 * 86400_000)).toISOString().slice(0, 10);
  const fs = String(sym).endsWith('.US') ? String(sym).slice(0, -3) : sym;   // collision alias → bare FMP ticker
  const rows = await fmp.eodHistory(fs, from).catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return null;
  const asc = [...rows].reverse();               // FMP returns newest-first
  return {
    closes: asc.map(r => +r.close),
    labels: asc.map(r => new Date(r.date).getTime()),
    ohlc: asc.map(r => ({ t: new Date(r.date).getTime(), o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume || 0 })),
  };
}

/* ---- asset class: drives which data source/section applies to an asset ----
   'equity' (FMP fundamentals), 'crypto' (CoinGecko/perp), 'commodity'/'index'/'fx' (price + macro) */
const CLASS_BY_CAT = { Equities: 'equity', Commodities: 'commodity', Indices: 'index', FX: 'fx' };
export function assetClass(sym) {
  const s = String(sym).toUpperCase();
  // Cross-class ticker collisions (ALT = AltLayer crypto AND Altimmune stock; the crypto
  // owns the bare ticker on the venue). The US-listed equity is addressed as "<SYM>.US"
  // so it survives every crypto-first resolver — a private namespace no real symbol uses.
  if (s.endsWith('.US')) return 'equity';
  // the Neo-ecosystem GAS token gets mistagged 'commodities' by upstream category data —
  // it is a crypto perp (see NAMES: 'Gas (Neo)'), so pin it before any lookup
  if (s === 'GAS') return 'crypto';
  // authoritative symbol sets first — these RWA perps (GOLD, SP500, EUR…) may not be in
  // the loaded universe, and a bare ticker like GOLD would otherwise resolve to a stock.
  if (COMMOD.has(s)) return 'commodity';
  if (INDEX.has(s)) return 'index';
  if (FX.has(s)) return 'fx';
  const a = universe.find(x => x.sym === s) || (TICKERS[s] ? { world: TICKERS[s].world, cat: TICKERS[s].cat } : null);
  if (!a) return 'crypto';
  // Ventuals pre-IPO perps (MINIMAX, ZHIPU, OPENAI…): private companies FMP can't track —
  // their own class keeps the asset page on venue data instead of dead FMP sections
  if (a.coin && String(a.coin).startsWith('vntl:')) return 'preipo';
  if (a.world === 'crypto') return 'crypto';
  return CLASS_BY_CAT[a.cat] || 'equity';
}
/* map our ticker → FMP symbol convention (equities are direct; others mapped/probed) */
const FMP_SYM = {
  GOLD: 'GCUSD', SILVER: 'SIUSD', COPPER: 'HGUSD', PLATINUM: 'PLUSD', PALLADIUM: 'PAUSD',
  BRENTOIL: 'BZUSD', WTI: 'CLUSD', NATGAS: 'NGUSD',
  SP500: '^GSPC', NDX: '^NDX', VIX: '^VIX', DXY: 'DX-Y.NYB',
  // Nikkei: without this, fmpSymbol('JP225')='JP225' → FMP quote & news came back EMPTY, so the
  // macro brief had no 52-week range / level context. ^N225 is verified on our FMP plan; the other
  // world indices (^KS200/^NSEI/^BVSP) are 402 (not on plan) so they stay on the live HL price only.
  JP225: '^N225',
  EUR: 'EURUSD', JPY: 'JPYUSD', GBP: 'GBPUSD',
};
/* venue tickers whose FMP data lives under an ADR / foreign listing (the icon system
   had these aliases for logos — the DATA path never did, leaving their sections dark) */
const EQUITY_FMP_ALIAS = {
  // SKHX → SKHY: SK hynix's US Nasdaq listing — full USD quote/financials on our plan
  // (000660.KS serves only the profile, and in KRW)
  HYUNDAI: 'HYMTF', SMSN: 'SSNLF', SOFTBANK: 'SFTBY', SKHX: 'SKHY', KIOXIA: '285A.T',
};
export function fmpSymbol(sym) {
  const s = String(sym).toUpperCase();
  const cls = assetClass(s);
  if (cls === 'equity') { const base = s.endsWith('.US') ? s.slice(0, -3) : s; return EQUITY_FMP_ALIAS[base] || base; }
  if (cls === 'crypto') return s + 'USD';   // FMP crypto convention, e.g. BTCUSD
  return FMP_SYM[s] || s;
}

// UI display form of a symbol: the "<SYM>.US" collision alias (Altimmune) is addressed
// internally with the suffix, but shows the bare ticker in the hero (exchange disambiguates).
export const displaySym = (sym) => { const s = String(sym || '').toUpperCase(); return s.endsWith('.US') ? s.slice(0, -3) : s; };
export const isCollisionAlias = (sym) => String(sym || '').toUpperCase().endsWith('.US');

// True when a venue perp (crypto or an RWA commodity/index/fx) owns this bare ticker, so an
// FMP equity of the same ticker (Altimmune vs AltLayer) must be addressed as "<SYM>.US".
export const collidesWithVenue = (sym) => {
  const s = String(sym).toUpperCase();
  if (s === 'GAS' || COMMOD.has(s) || INDEX.has(s) || FX.has(s)) return true;
  const a = universe.find((x) => x.sym === s);
  return !!a && a.world !== 'stocks';
};

/* well-known names per world: their 24h change is loaded up front so the
   home (movers, breadth, sentiment) is real immediately */
const FEATURED = {
  crypto: 'BTC ETH SOL BNB XRP DOGE AVAX SUI LINK LTC ADA HYPE WIF PEPE BONK SHIB UNI AAVE TAO RNDR FET APT NEAR SEI TIA INJ ARB OP DYDX JUP TRX TON DOT ATOM HBAR KAS POPCAT ENA PENDLE'.split(' '),
  stocks: 'NVDA AAPL MSFT GOOGL AMZN META TSLA AMD NFLX COIN HOOD PLTR MSTR GOLD SILVER SP500 VIX DXY EUR JPY BRENTOIL NATGAS COPPER URANIUM AVGO QCOM ORCL MU CRWV ARM RKLB IBM DELL NOW ASML BABA LLY COST GME'.split(' '),
};

function writeTicker(a, price) {
  const ex = TICKERS[a.sym] || {};
  TICKERS[a.sym] = {
    ...ex, sym: a.sym, coin: a.coin, name: a.name || ex.name || a.sym,
    color: ex.color || PALETTE[a.cat] || '#3f3f46',
    world: a.world, cat: a.cat, sector: a.cat,
    price: price != null ? price : ((ex.real && ex.price) || 0),  // never inherit synthetic seed price
    chg: 0, chgPct: 0,           // cleared — real 24h change comes only from candles
    real: true, changeReal: false, synthetic: false, unavailable: false,
  };
}

/* test seam: the venue-claim race (native meta late → reclaim) is a tradability bug we
   shipped once; the node test drives the REAL ingest so the splice/rewrite path stays honest */
export const _ingestMetaForTest = (m, dex) => ingestMeta(m, dex);

/* INCOGNITO: the universe is AVANTIS', not Hyperliquid's.
 *
 * Every order here routes to Avantis, so the venue defines what exists. Intersecting with
 * Hence's universe (the first attempt) inherited its perpDexs flake for no benefit: when the
 * xyz dex failed to load, every Avantis-listed equity silently vanished from a terminal that
 * can trade them perfectly well.
 *
 * Symbols Hence ALSO carries keep their existing row, because that row is what supplies the
 * live price, the chart and the order book. Avantis-only symbols are added with no coin
 * mapping — they are selectable and show no price until the Pyth feed is wired, which is
 * honest and visible rather than a silent omission.
 */
const AV_WORLD = { 0: 'crypto', 1: 'crypto', 4: 'crypto', 5: 'crypto', 2: 'stocks', 3: 'stocks', 6: 'stocks' };
const AV_CAT = { 0: 'Majors', 1: 'Alts', 2: 'FX', 3: 'Commodities', 4: 'Memes', 5: 'DeFi', 6: 'Equities' };

export function ingestAvantis(pairs) {
  let added = 0, tagged = 0;
  for (const p of pairs || []) {
    const sym = String(p.from || '').toUpperCase();
    if (!sym || sym === 'USD') continue;              // the quote leg is not an asset
    if (sym.includes('UPSIDE')) continue;             // Avantis' own product, not the underlying
    const existing = universe.find((x) => x.sym === sym);
    if (existing) { existing.avantis = true; tagged++; continue; }
    universe.push({
      coin: sym, sym, name: NAMES[sym] || sym, dex: 'avantis',
      world: AV_WORLD[p.groupIndex] || 'crypto', cat: AV_CAT[p.groupIndex] || 'Alts',
      maxLev: 0, avantis: true,
    });
    added++;
  }
  try { window.dispatchEvent(new CustomEvent('market:ready')); } catch { /* non-browser */ }
  return { added, tagged, total: universe.length };
}

function ingestMeta(m, dex) {
  if (!m || !Array.isArray(m.universe)) return;
  const rank = venueRank(dex || '');
  for (const u of m.universe) {
    if (u.isDelisted) continue;
    const coin = u.name;                 // bare for native, "xyz:NVDA" for HIP-3
    const sym = symOf(coin).toUpperCase();
    /* rank-based, not first-write-wins: when the native meta arrives LATE (timeout on a slow
       load, then the background retry below), it must still evict the HIP-3 copy of BTC that
       claimed the symbol first — otherwise the majors stay read-only all session */
    if (!claims(symRank.get(sym), rank)) continue;
    if (symRank.has(sym)) {              // reclaim: purge the lower-priority venue's entry
      const i = universe.findIndex((x) => x.sym === sym);
      if (i >= 0) universe.splice(i, 1);
    }
    symRank.set(sym, rank);
    coinBySym.set(sym, coin);
    const world = worldOf(dex || '');
    const cat = dex === XYZ ? xyzCat(sym) : cryptoCat(sym);
    const a = { coin, sym, name: NAMES[sym] || sym, dex: dex || '', world, cat, maxLev: +u.maxLeverage || 0 };
    universe.push(a);                    // one canonical entry per symbol
    writeTicker(a, null);
  }
}

let _initPromise = null;
export function init() {
  if (_initPromise) return _initPromise;      // idempotent: main + useMarketReady can both call it
  _initPromise = (async () => {
  try {
    // bound every upstream call so a single slow HIP-3 dex can't stall readiness
    // (errors AND slowness both fall through to null; that dex just loads later)
    const cap = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
    const dexs = ((await cap(perpDexs(), 4000)) || []).filter(d => d && d.name).map(d => d.name);
    const metas = await Promise.all([cap(meta(null), 4000), ...dexs.map(d => cap(meta(d), 3000))]);
    universe = []; coinBySym.clear(); symRank.clear();
    ingestMeta(metas[0], null);                          // 1) native crypto majors win
    const ix = dexs.indexOf(XYZ);
    if (ix >= 0) ingestMeta(metas[ix + 1], XYZ);         // 2) trade.xyz RWA/stocks next
    dexs.forEach((d, i) => { if (d !== XYZ) ingestMeta(metas[i + 1], d); }); // 3) other HIP-3
    /* A missed NATIVE meta is not "loads later" — nothing reloaded it, and first-write-wins
       let a random dex keep the majors. Retry the two live-tradable venues in the background;
       rank-based claiming above makes their late arrival self-heal the session. */
    const retryMeta = (dex, tries) => {
      let n = 0;
      const go = async () => {
        try { const m = await meta(dex); if (m && Array.isArray(m.universe)) { ingestMeta(m, dex); refreshPrices().catch(() => {}); return; } } catch { /* fall through */ }
        if (++n < tries) setTimeout(go, 4000 * (n + 1));
      };
      setTimeout(go, 4000);
    };
    if (!metas[0]) retryMeta(null, 3);
    if (ix >= 0 && !metas[ix + 1]) retryMeta(XYZ, 3);
    await cap(refreshPrices(), 4500);                    // real prices — BOUNDED so a stalled allMids can't hang readiness
    // refine categories, but never let a slow/hung perpCategories block readiness
    await Promise.race([applyRealCategories(), new Promise(r => setTimeout(r, 2500))]);
    // real 24h change for the ENTIRE universe in ONE bulk call (drives home movers/breadth) —
    // no per-coin candle sweep, so no request burst / 429s on page load.
    loadChanges();
  } catch (e) {
    console.warn('[market] init failed, using stub data:', e && e.message);
  } finally {
    // ALWAYS flip ready + notify, even on failure/timeout — otherwise ready-gated loading
    // skeletons (screener/calendar/economy/watchlist) would shimmer forever on a slow/down API.
    ready = true;
    window.dispatchEvent(new CustomEvent('market:ready'));
  }
  })();
  return _initPromise;
}

/* real category tagging: Hydromancer labels each coin crypto|stocks|commodities|indices|fx.
   We trust it to pull RWA perps (incl. on non-xyz dexes) into the stocks world with an
   accurate sub-category, and keep our finer keyword sub-cats for crypto. */
const STOCK_CAT = { stocks: 'Equities', commodities: 'Commodities', indices: 'Indices', fx: 'FX' };
async function applyRealCategories() {
  let pairs;
  try { pairs = await perpCategories(); } catch (e) { return; }
  if (!Array.isArray(pairs)) return;
  const byCoin = new Map(), bySym = new Map();
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const rc = String(p[1]).toLowerCase();
    byCoin.set(p[0], rc);
    const s = symOf(p[0]).toUpperCase();
    if (!bySym.has(s)) bySym.set(s, rc);
  }
  for (const a of universe) {
    const rc = byCoin.get(a.coin) || bySym.get(a.sym);
    if (!rc || rc === 'crypto') continue;          // keep keyword sub-cat for crypto
    a.world = 'stocks';
    a.cat = STOCK_CAT[rc] || 'Equities';
    const t = TICKERS[a.sym];
    if (t) { t.world = 'stocks'; t.cat = a.cat; t.sector = a.cat; }
  }
}

export async function refreshPrices() {
  let mids;
  try { mids = await allMids(); } catch (e) { return; }
  for (const a of universe) {
    const p = mids[a.coin];
    if (p == null) continue;
    const px = +p;
    const t = TICKERS[a.sym];
    if (t) { t.price = px; }
  }
  window.dispatchEvent(new CustomEvent('market:prices'));
}

/* ---- 24h change: ONE bulk snapshot for the whole universe ----
   Was a per-coin daily-candle sweep across FEATURED + universe (hundreds of /api/info calls on
   page load → Hydromancer 429s). Now a single GET /api/changes (public metaAndAssetCtxs, cached
   60s server-side) returns { fullCoin:{px,chg} } for every asset. We apply chg to TICKERS by the
   coin's bare symbol (same mapping as everywhere else) and a fresher px if provided.
   `coins` is kept only for API compatibility with the screen callers — the bulk call already
   covers the entire universe, so we ignore it and apply everything in one shot.
   The 2s/4s allMids price tick is untouched; detail views still use assetStats() on demand. */
const CHANGES_TTL = 30_000;              // in-tab throttle so repeated screen calls don't refetch
let _changesAt = 0, _changesInflight = null, _changesWarned = false;

/* ---- screener stats: the WHOLE universe's funding/OI/24h-volume in ONE call ----
   GET /api/screener/hl (server-cached 60s from the same metaAndAssetCtxs sweep as /api/changes)
   → { fullCoin: { px, chg, fundingApr, oi, vol } }. Replaces the old assetStats() fan-out
   (5 POSTs per symbol per render) on the screener. 60s in-tab cache + inflight dedupe. */
let _scrHl = { t: 0, v: null, p: null };
export async function bulkScreenerStats() {
  const now = Date.now();
  if (_scrHl.v && now - _scrHl.t < 60_000) return _scrHl.v;
  if (_scrHl.p) return _scrHl.p;
  _scrHl.p = fetch('/api/screener/hl')
    .then((r) => r.json())
    .then((d) => {
      const rows = d && d.rows;
      // only cache a REAL snapshot — a 502/empty ({error:…}) must not lock in {} for 60s
      if (rows && Object.keys(rows).length) { _scrHl.v = rows; _scrHl.t = Date.now(); }
      return _scrHl.v || {};
    })
    .catch(() => _scrHl.v || {})
    .finally(() => { _scrHl.p = null; });
  return _scrHl.p;
}
export async function loadChanges(_coins, { force = false } = {}) {
  const now = Date.now();
  if (!force && _changesInflight) return _changesInflight;
  if (!force && now - _changesAt < CHANGES_TTL) return;   // fresh enough; skip
  _changesInflight = (async () => {
    const map = await bulkChanges();
    if (!map) {
      // endpoint unavailable (e.g. backend not yet restarted with /api/changes): log ONCE and
      // skip — TICKERS chg stays at its current value, no per-coin sweep, no request burst.
      if (!_changesWarned) { console.warn('[market] /api/changes unavailable — skipping 24h change until it exists'); _changesWarned = true; }
      return;
    }
    for (const coin in map) {
      const sym = symOf(coin).toUpperCase();
      const t = TICKERS[sym];
      if (!t) continue;                  // symbol not in our universe
      const row = map[coin];
      const px = t.price || (row.px > 0 ? row.px : 0);
      if (row.chg != null && Number.isFinite(+row.chg)) {
        t.chgPct = +row.chg;
        t.changeReal = true;
        if (px) t.chg = +(px - px / (1 + row.chg / 100)).toFixed(px < 1 ? 6 : 2);
      }
    }
    _changesAt = Date.now();
    window.dispatchEvent(new CustomEvent('market:changes'));
  })().finally(() => { _changesInflight = null; });
  return _changesInflight;
}

/* ---- candles for charts: returns { closes:[], labels:[], ohlc:[] } ---- */
const RANGE = {
  '1D': { interval: '5m', ms: 24 * 3600_000 }, '1W': { interval: '1h', ms: 7 * 24 * 3600_000 },
  '1M': { interval: '4h', ms: 30 * 24 * 3600_000 }, '3M': { interval: '12h', ms: 90 * 24 * 3600_000 },
  'YTD': { interval: '1d', ms: 180 * 24 * 3600_000 }, '1Y': { interval: '1d', ms: 365 * 24 * 3600_000 },
  '5Y': { interval: '1w', ms: 5 * 365 * 24 * 3600_000 }, 'All': { interval: '1w', ms: 6 * 365 * 24 * 3600_000 },
  '2Y': { interval: '1d', ms: 2 * 365 * 24 * 3600_000 }, '10Y': { interval: '1w', ms: 6 * 365 * 24 * 3600_000 },
};
/* render a real candle chart into `el` (async; falls back gracefully).
   opts.priceLabel — draw a small floating "SYM $price" tag at the last point
   (gated so small reader/analysis charts stay uncluttered). */
/* FMP end-of-day fallback series for non-crypto symbols with no live HL candles
   (e.g. VIX after its dex delisting — the FMP ^VIX alias still tracks it daily). */
async function fmpEodSeries(symOrCoin, range) {
  try {
    const sym = symOf(String(symOrCoin)).toUpperCase();
    if (assetClass(sym) === 'crypto') return null;          // HL is authoritative for crypto
    const days = { '1D': 5, '1W': 8, '1M': 32, '3M': 95, '6M': 190, 'YTD': 240, '1Y': 370, '2Y': 740, '5Y': 1830, 'All': 3700 }[range] || 370;
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const fmp = await import('./fmp.js');
    const rows = await fmp.eodHistory(fmpSymbol(sym), from);
    const hist = (Array.isArray(rows) ? rows : (rows && rows.historical) || [])
      .filter((r) => r && Number.isFinite(+r.close) && r.date);
    if (hist.length < 2) return null;
    const chron = hist.slice().reverse();                    // rows arrive newest-first
    return { closes: chron.map((r) => +r.close), labels: chron.map((r) => new Date(r.date).getTime()), eod: true };
  } catch (e) { return null; }
}

export async function fillChart(el, symOrCoin, range = '1Y', opts = {}) {
  if (!el) return false;
  try {
    let d = await chartData(symOrCoin, range).catch(() => null);
    if (!d || d.closes.length < 2) d = await fmpEodSeries(symOrCoin, range);
    if (!d || d.closes.length < 2) return false;
    const up = d.closes[d.closes.length - 1] >= d.closes[0];
    el.innerHTML = priceChart(d.closes, {
      w: opts.w || 760, h: opts.h || 230,
      stroke: opts.stroke || (up ? 'rgba(95,207,145,0.95)' : 'rgba(255,255,255,0.82)'),
      fill: opts.fill != null ? opts.fill : (up ? 'rgba(74,201,134,0.07)' : 'rgba(255,255,255,0.05)'),
      sw: opts.sw, dot: opts.dot !== false, nodes: opts.nodes || false,
      labels: d.labels.map(t => fmtLabel(t, range)), fmt: fmtPrice,
    });
    // floating last-price tag, prefixed with the asset symbol → e.g. "ETH $1,577.85"
    if (opts.priceLabel) {
      const wrap = el.querySelector('.chart-wrap');
      const closes = d.closes;
      const max = Math.max(...closes), min = Math.min(...closes), span = (max - min) || 1;
      const last = closes[closes.length - 1];
      const fy = 1 - (last - min) / span; // 0 (top) .. 1 (bottom), matching priceChart geometry
      const sym = symOf(String(symOrCoin)).toUpperCase();
      if (wrap) {
        const tag = document.createElement('div');
        tag.className = 'chart-lastpx ' + (up ? 'up' : 'down');
        tag.textContent = `${sym} ${fmtPrice(last)}`;
        tag.style.top = Math.min(88, Math.max(2, fy * 100)) + '%';
        wrap.appendChild(tag);
      }
    }
    initCharts(el);
    return true;
  } catch (e) { return false; }
}

/* real category breadth for a world: [{cat, avg, upFrac, n}] sorted by avg desc */
export function categoryBreadth(world) {
  const byCat = new Map();
  for (const a of assetsByWorld(world)) {
    const t = TICKERS[a.sym]; if (!t || !t.changeReal || t.chgPct == null) continue;
    if (!byCat.has(a.cat)) byCat.set(a.cat, []);
    byCat.get(a.cat).push(t.chgPct);
  }
  const out = [];
  for (const [cat, arr] of byCat) {
    const withChg = arr.filter(x => x !== 0);
    if (!withChg.length) continue;
    const avg = withChg.reduce((s, x) => s + x, 0) / withChg.length;
    const upFrac = withChg.filter(x => x > 0).length / withChg.length;
    out.push({ cat, avg: +avg.toFixed(2), upFrac, n: withChg.length });
  }
  return out.sort((a, b) => b.avg - a.avg);
}

/* top movers for a world (real % change) */
export function topMovers(world, n = 6) {
  const list = assetsByWorld(world)
    .map(a => ({ a, t: TICKERS[a.sym] }))
    .filter(x => x.t && x.t.changeReal && x.t.chgPct != null && x.t.chgPct !== 0 && x.t.price);
  const gainers = [...list].sort((x, y) => y.t.chgPct - x.t.chgPct).slice(0, n).map(x => x.a.sym);
  const losers = [...list].sort((x, y) => x.t.chgPct - y.t.chgPct).slice(0, n).map(x => x.a.sym);
  return { gainers, losers };
}

export async function chartData(symOrCoin, range = '1Y') {
  if (isResearch(symOrCoin)) return researchChartData(String(symOrCoin).toUpperCase(), range);
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  const cfg = RANGE[range] || RANGE['1Y'];
  const now = Date.now();
  const c = await candleSnapshot(coin, cfg.interval, now - cfg.ms, now);
  if (!Array.isArray(c) || !c.length) return null;
  return {
    closes: c.map(k => +k.c),
    labels: c.map(k => k.t),
    volumes: c.map(k => +k.v),
    ohlc: c.map(k => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v })),
  };
}

/* top movers within one category of a world (real % change) */
export function categoryMovers(world, cat, n = 4, opts = {}) {
  const list = assetsByWorld(world)
    .filter(a => a.cat === cat)
    .map(a => ({ sym: a.sym, t: TICKERS[a.sym] }))
    .filter(x => x.t && x.t.changeReal && x.t.chgPct != null && x.t.chgPct !== 0 && x.t.price);
  const cmp = opts.byAbs ? (a, b) => Math.abs(b.t.chgPct) - Math.abs(a.t.chgPct)
    : opts.losers ? (a, b) => a.t.chgPct - b.t.chgPct
      : (a, b) => b.t.chgPct - a.t.chgPct;
  return list.sort(cmp).slice(0, n).map(x => x.sym);
}

async function oiCapSet() {
  try { const arr = await perpsAtOiCap(); return new Set((arr || []).map(s => String(s).toUpperCase())); }
  catch (e) { return new Set(); }
}

/* exchange health + server time (perps trade 24/7) */
export async function marketState() {
  try { const s = await exchangeStatus(); return { operational: !s || !s.specialStatuses, time: s && s.time }; }
  catch (e) { return { operational: true, time: null }; }
}
/* venue TVL (total net deposits) for a HIP-3 dex */
export async function dexTvl(dex = XYZ) {
  try { const s = await perpDexStatus(dex); return s && s.totalNetDeposit != null ? +s.totalNetDeposit : null; }
  catch (e) { return null; }
}
/* real annotation: { category, description, displayName, keywords[] } */
export async function assetMeta(symOrCoin) {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  try { return await perpAnnotation(coin); } catch (e) { return null; }
}

/* OHLCV candles for the trading terminal, by timeframe */
const TF = {
  '1m': { interval: '1m', ms: 3 * 3600_000 }, '5m': { interval: '5m', ms: 18 * 3600_000 },
  '15m': { interval: '15m', ms: 2.5 * 24 * 3600_000 }, '1h': { interval: '1h', ms: 9 * 24 * 3600_000 },
  '4h': { interval: '4h', ms: 32 * 24 * 3600_000 }, '1d': { interval: '1d', ms: 220 * 24 * 3600_000 },
};
export const TIMEFRAMES = Object.keys(TF);
/* real L2 order book for a tradeable asset → { bids:[{px,sz,n}], asks:[{px,sz,n}] } */
export async function orderBook(symOrCoin) {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  try { return await l2Book(coin); } catch (e) { return null; }
}

/* recent taker fills → [{ px, sz, side:'buy'|'sell', time }] newest first (≤50).
   HL `side` is the aggressor: 'B' = taker bought → 'buy', 'A' = taker sold → 'sell'.
   Synthetic/HIP-3 coins aren't on the public venue → returns [] (never throws). */
export async function recentTrades(symOrCoin) {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  if (coin.includes(':')) return [];              // HIP-3 (e.g. xyz:NVDA) not on the public venue
  try {
    const raw = await hydroRecentTrades(coin);
    return (Array.isArray(raw) ? raw : [])
      .map(t => ({ px: +t.px, sz: +t.sz, side: t.side === 'B' ? 'buy' : 'sell', time: +t.time }))
      .filter(t => t.px > 0 && t.sz > 0)
      .sort((a, b) => b.time - a.time)
      .slice(0, 100);
  } catch (e) { return []; }
}

export async function candles(symOrCoin, tf = '15m') {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  const cfg = TF[tf] || TF['15m'];
  const now = Date.now();
  const c = await candleSnapshot(coin, cfg.interval, now - cfg.ms, now);
  if (!Array.isArray(c) || !c.length) return null;
  return c.map(k => ({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
}

/* Older history for the terminal chart: one window BEFORE `endMs`, i.e. [endMs - cfg.ms, endMs).
   Same normalized shape as candles(); returns null on empty/malformed. Used to page backwards
   when the user zooms/pans past the initial window. `endMs` is the oldest bar's time so pages
   stitch contiguously (dedupe on the caller side by t). */
export async function candlesBefore(symOrCoin, tf = '15m', endMs) {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  const cfg = TF[tf] || TF['15m'];
  const end = +endMs || Date.now();
  const c = await candleSnapshot(coin, cfg.interval, end - cfg.ms, end);
  if (!Array.isArray(c) || !c.length) return null;
  return c.map(k => ({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
}

/* bulk perp stats for a set of coins in ONE assetContext call — used by the
   market-select palette to show real Liquidity (OI notional) + Funding columns
   without firing one request per row. Returns { coin: {price, oiNotional, dayVol, funding} } */
export async function bulkStats(coins) {
  const list = (coins || []).filter(Boolean);
  if (!list.length) return {};
  const chunks = [];                                   // assetContext caps at 20 coins/call → chunk
  for (let i = 0; i < list.length; i += 20) chunks.push(list.slice(i, i + 20));
  const results = await Promise.all(chunks.map(ch => assetContext(ch).catch(() => null)));
  const out = {};
  results.forEach((ctxAll, ci) => {
    if (!ctxAll) return;
    for (const coin of chunks[ci]) {
      const ctx = ctxAll[coin];
      if (!ctx) continue;
      const price = +ctx.midPx || +ctx.markPx || 0;
      out[coin] = {
        price,
        oiNotional: (+ctx.openInterest || 0) * price,
        dayVol: ctx.dayNtlVlm != null ? +ctx.dayNtlVlm : null,
        funding: ctx.funding != null ? +ctx.funding : null,
      };
    }
  });
  return out;
}

/* live per-asset perp stats: mark/oracle/mid, OI, spread, 24h hi/lo/vol/chg,
   funding APR, OI-cap flag, and the real annotation — all in one parallel fetch */
export async function assetStats(symOrCoin) {
  const coin = String(symOrCoin).includes(':') ? symOrCoin : coinFor(symOrCoin);
  const sym = symOf(coin).toUpperCase();
  const entry = universe.find(a => a.coin === coin);
  const out = { sym, coin, world: entry ? entry.world : 'crypto', cat: entry ? entry.cat : '' };
  const now = Date.now();
  const [ctxAll, c, fund, annot, capSet] = await Promise.all([
    assetContext([coin]).catch(() => null),
    candleSnapshot(coin, '1d', now - 3 * 24 * 3600_000, now).catch(() => null),
    fundingHistory(coin, now - 36 * 3600_000, now).catch(() => null),
    perpAnnotation(coin).catch(() => null),
    oiCapSet().catch(() => null),
  ]);
  const ctx = (ctxAll && ctxAll[coin]) || {};
  out.mark = +ctx.markPx; out.oracle = +ctx.oraclePx; out.mid = +ctx.midPx;
  out.oiBase = +ctx.openInterest;
  out.price = out.mid || out.mark || (TICKERS[sym] && TICKERS[sym].price) || 0;
  out.oiNotional = out.oiBase * out.price;
  if (Array.isArray(ctx.impactPxs) && ctx.impactPxs.length === 2 && out.mid) {
    out.spreadBps = ((+ctx.impactPxs[1] - +ctx.impactPxs[0]) / out.mid) * 10000;
  }
  if (Array.isArray(c) && c.length) {
    const last = c[c.length - 1];
    // today's candle is often still open (x:false) → use the last FULL day for volume/trades
    const full = (last.x === false && c.length >= 2) ? c[c.length - 2] : last;
    out.dayHigh = +last.h; out.dayLow = +last.l;
    out.dayVolUsd = full.q != null ? +full.q : (+full.v) * (out.price || +full.c); // `q` = real USD volume
    out.tradeCount = full.n != null ? +full.n : null;
    const ref = ref24(c);
    if (ref) out.chgPct = +(((out.price - ref) / ref) * 100).toFixed(2);
  }
  if (Array.isArray(fund) && fund.length) {
    const r = +fund[fund.length - 1].fundingRate;
    out.fundingHourly = r;
    out.fundingApr = +(r * 24 * 365 * 100).toFixed(2);   // annualized %
  }
  if (annot && annot.description) {
    out.description = annot.description; out.displayName = annot.displayName; out.keywords = annot.keywords;
  }
  out.atOiCap = !!(capSet && capSet.has(sym));
  return out;
}
