/* =========================================================
   Hence webapp — mock data layer
   Deterministic, seeded so charts are stable across renders.
   ========================================================= */

/* small seeded PRNG (mulberry32) */
function seeded(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* generate a wandering series with an overall drift */
export function series(key, n = 60, drift = 0.4, vol = 1) {
  const r = seeded(hash(key));
  const out = [];
  let v = 50;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * 6 * vol + drift;
    out.push(Math.max(4, v));
  }
  return out;
}

/* ---- tickers ---- */
export const TICKERS = {
  TSLA: { sym: 'TSLA', name: 'Tesla Inc.', price: 190.40, chg: -1.08, chgPct: -0.33, color: '#e8483b', sector: 'Consumer Cyclical',
          mktCap: '1.06T', evSales: '10.83', pe: '149.14', fyRev: '$97.69B', eps: '$2.21', grossMargin: '16.26%', profitMargin: '9.01%', beta: '2.33', divYield: 'N/A' },
  AAPL: { sym: 'AAPL', name: 'Apple Inc.', price: 173.45, chg: -2.10, chgPct: -1.20, color: '#6b7280', sector: 'Technology',
          mktCap: '2.71T', evSales: '7.42', pe: '28.6', fyRev: '$383.3B', eps: '$6.13', grossMargin: '44.1%', profitMargin: '25.3%', beta: '1.29', divYield: '0.55%' },
  MSFT: { sym: 'MSFT', name: 'Microsoft Corp.', price: 405.13, chg: -0.24, chgPct: -0.06, color: '#3b82f6', sector: 'Technology',
          mktCap: '3.01T', evSales: '12.9', pe: '36.4', fyRev: '$211.9B', eps: '$11.05', grossMargin: '69.0%', profitMargin: '36.7%', beta: '0.90', divYield: '0.72%' },
  NVDA: { sym: 'NVDA', name: 'NVIDIA Corp.', price: 903.00, chg: 18.6, chgPct: 2.10, color: '#22c55e', sector: 'Technology',
          mktCap: '2.25T', evSales: '36.2', pe: '74.5', fyRev: '$60.9B', eps: '$11.93', grossMargin: '72.7%', profitMargin: '48.9%', beta: '1.68', divYield: '0.02%' },
  ADBE: { sym: 'ADBE', name: 'Adobe Inc.', price: 444.24, chg: -0.27, chgPct: -0.06, color: '#e8483b', sector: 'Technology',
          mktCap: '198B', evSales: '10.7', pe: '44.2', fyRev: '$19.4B', eps: '$11.82', grossMargin: '88.0%', profitMargin: '27.8%', beta: '1.31', divYield: 'N/A' },
  NKE:  { sym: 'NKE', name: 'Nike Inc.', price: 81.77, chg: 1.49, chgPct: 1.86, color: '#111827', sector: 'Consumer Cyclical',
          mktCap: '124B', evSales: '2.4', pe: '27.6', fyRev: '$51.2B', eps: '$3.23', grossMargin: '43.5%', profitMargin: '11.1%', beta: '1.07', divYield: '1.80%' },
  TCEHY:{ sym: 'TCEHY', name: 'Tencent Holdings', price: 38.81, chg: 0.19, chgPct: 0.49, color: '#0ea5e9', sector: 'Communication',
          mktCap: '363B', evSales: '4.1', pe: '17.9', fyRev: '$86.1B', eps: '$2.17', grossMargin: '48.1%', profitMargin: '24.5%', beta: '0.54', divYield: '0.75%' },
  SHOP: { sym: 'SHOP', name: 'Shopify Inc.', price: 77.77, chg: -1.62, chgPct: -2.04, color: '#16a34a', sector: 'Technology',
          mktCap: '99B', evSales: '13.6', pe: 'N/A', fyRev: '$7.1B', eps: '-$0.53', grossMargin: '51.4%', profitMargin: '-9.0%', beta: '2.01', divYield: 'N/A' },
  META: { sym: 'META', name: 'Meta Platforms', price: 512.20, chg: 7.40, chgPct: 1.47, color: '#2563eb', sector: 'Communication',
          mktCap: '1.30T', evSales: '9.3', pe: '32.1', fyRev: '$134.9B', eps: '$15.95', grossMargin: '80.7%', profitMargin: '29.0%', beta: '1.21', divYield: '0.40%' },
  UL:   { sym: 'UL', name: 'Unilever PLC', price: 56.19, chg: -0.13, chgPct: -0.23, color: '#1e3a8a', sector: 'Consumer Defensive',
          mktCap: '140B', evSales: '2.6', pe: '18.6', fyRev: '$64.5B', eps: '$3.02', grossMargin: '42.2%', profitMargin: '9.5%', beta: '0.40', divYield: '3.60%' },
  VLCN: { sym: 'VLCN', name: 'Volcon Inc.', price: 0.75, chg: -0.01, chgPct: -0.50, color: '#a78bfa', sector: 'Consumer Cyclical',
          mktCap: '12M', evSales: '1.2', pe: 'N/A', fyRev: '$25M', eps: '-$1.20', grossMargin: '8.0%', profitMargin: '-110%', beta: '2.80', divYield: 'N/A' },
  ANTX: { sym: 'ANTX', name: 'AN2 Therapeutics', price: 180.30, chg: 0.56, chgPct: 0.31, color: '#64748b', sector: 'Healthcare',
          mktCap: '180M', evSales: 'N/A', pe: 'N/A', fyRev: 'N/A', eps: '-$3.10', grossMargin: 'N/A', profitMargin: 'N/A', beta: '0.95', divYield: 'N/A' },
  GM:   { sym: 'GM', name: 'General Motors', price: 48.20, chg: 0.31, chgPct: 0.65, color: '#1d4ed8', sector: 'Consumer Cyclical',
          mktCap: '54B', evSales: '0.78', pe: '5.6', fyRev: '$171.8B', eps: '$8.62', grossMargin: '11.5%', profitMargin: '5.9%', beta: '1.34', divYield: '1.10%' },
  RIVN: { sym: 'RIVN', name: 'Rivian Automotive', price: 15.55, chg: -0.20, chgPct: -1.27, color: '#0f172a', sector: 'Consumer Cyclical',
          mktCap: '15B', evSales: '3.2', pe: 'N/A', fyRev: '$4.4B', eps: '-$5.43', grossMargin: '-46%', profitMargin: '-120%', beta: '1.90', divYield: 'N/A' },
  KEYS: { sym: 'KEYS', name: 'Keysight Technologies', price: 152.40, chg: 7.36, chgPct: 5.07, color: '#dc2626', sector: 'Technology',
          mktCap: '27B', evSales: '5.0', pe: '28.0', fyRev: '$5.4B', eps: '$5.44', grossMargin: '64.5%', profitMargin: '21.0%', beta: '1.05', divYield: 'N/A' },
  WBA:  { sym: 'WBA', name: 'Walgreens Boots', price: 21.30, chg: 0.89, chgPct: 4.36, color: '#2563eb', sector: 'Healthcare',
          mktCap: '18B', evSales: '0.32', pe: 'N/A', fyRev: '$139B', eps: '-$3.55', grossMargin: '18.0%', profitMargin: '-2.0%', beta: '0.85', divYield: '4.50%' },
  SRE:  { sym: 'SRE', name: 'Sempra', price: 72.10, chg: -6.87, chgPct: -8.70, color: '#0d9488', sector: 'Utilities',
          mktCap: '46B', evSales: '6.4', pe: '16.2', fyRev: '$16.7B', eps: '$4.45', grossMargin: '38.0%', profitMargin: '17.0%', beta: '0.78', divYield: '3.20%' },
};

/* extra tickers referenced across screens */
Object.assign(TICKERS, {
  AMZN: { sym: 'AMZN', name: 'Amazon.com Inc.', price: 178.22, chg: 1.34, chgPct: 0.76, color: '#ff9900', sector: 'Consumer Cyclical', mktCap: '1.85T', evSales: '3.1', pe: '42.6', fyRev: '$574.8B', eps: '$2.90', grossMargin: '46.2%', profitMargin: '5.3%', beta: '1.16', divYield: 'N/A' },
  GOOGL: { sym: 'GOOGL', name: 'Alphabet Inc.', price: 176.74, chg: -1.96, chgPct: -1.10, color: '#4285f4', sector: 'Communication', mktCap: '2.18T', evSales: '6.2', pe: '24.9', fyRev: '$307.4B', eps: '$5.80', grossMargin: '56.9%', profitMargin: '24.0%', beta: '1.04', divYield: '0.48%' },
  GOOG: { sym: 'GOOG', name: 'Alphabet Inc.', price: 177.20, chg: -1.90, chgPct: -1.06, color: '#4285f4', sector: 'Communication', mktCap: '2.18T', evSales: '6.2', pe: '24.9', fyRev: '$307.4B', eps: '$5.80', grossMargin: '56.9%', profitMargin: '24.0%', beta: '1.04', divYield: '0.48%' },
  AMD: { sym: 'AMD', name: 'Advanced Micro Devices', price: 176.52, chg: -1.05, chgPct: -0.59, color: '#ed1c24', sector: 'Technology', mktCap: '285B', evSales: '11.4', pe: '198', fyRev: '$22.7B', eps: '$0.89', grossMargin: '47%', profitMargin: '4%', beta: '1.69', divYield: 'N/A' },
  UBER: { sym: 'UBER', name: 'Uber Technologies', price: 78.39, chg: -3.00, chgPct: -3.69, color: '#000000', sector: 'Technology', mktCap: '162B', evSales: '4.4', pe: '83', fyRev: '$37.3B', eps: '$0.94', grossMargin: '39%', profitMargin: '9%', beta: '1.30', divYield: 'N/A' },
  F: { sym: 'F', name: 'Ford Motor Company', price: 11.20, chg: 0.12, chgPct: 1.08, color: '#1c3f94', sector: 'Consumer Cyclical', mktCap: '44B', evSales: '0.95', pe: '11.6', fyRev: '$176B', eps: '$0.96', grossMargin: '8%', profitMargin: '2.5%', beta: '1.46', divYield: '5.10%' },
  LCID: { sym: 'LCID', name: 'Lucid Group Inc.', price: 2.70, chg: -0.05, chgPct: -1.82, color: '#3aa0ff', sector: 'Consumer Cyclical', mktCap: '6B', evSales: '10', pe: 'N/A', fyRev: '$0.6B', eps: '-$1.30', grossMargin: '-130%', profitMargin: '-400%', beta: '1.10', divYield: 'N/A' },
  CARG: { sym: 'CARG', name: 'CarGurus Inc.', price: 27.10, chg: 0.40, chgPct: 1.50, color: '#0d8f5b', sector: 'Communication', mktCap: '3B', evSales: '3.2', pe: '34', fyRev: '$0.9B', eps: '$0.80', grossMargin: '85%', profitMargin: '10%', beta: '1.25', divYield: 'N/A' },
  RACE: { sym: 'RACE', name: 'Ferrari N.V.', price: 412.30, chg: 3.10, chgPct: 0.76, color: '#d40000', sector: 'Consumer Cyclical', mktCap: '74B', evSales: '11', pe: '52', fyRev: '$6.5B', eps: '$7.90', grossMargin: '50%', profitMargin: '23%', beta: '0.75', divYield: '0.60%' },
});

/* ---- crypto assets (unified asset model: tagged world:'crypto' + cat) ---- */
const _c = (sym, name, price, chgPct, color, cat) => ({ sym, name, price, chg: +(price * chgPct / 100).toFixed(price < 1 ? 6 : 2), chgPct, color, world: 'crypto', cat, sector: cat });
Object.assign(TICKERS, {
  BTC: _c('BTC', 'Bitcoin', 72387, 1.62, '#f7931a', 'Layer 1'),
  ETH: _c('ETH', 'Ethereum', 3840, 2.31, '#627eea', 'Layer 1'),
  SOL: _c('SOL', 'Solana', 178.4, 4.12, '#9945ff', 'Layer 1'),
  BNB: _c('BNB', 'BNB', 612.0, 0.88, '#f3ba2f', 'Layer 1'),
  XRP: _c('XRP', 'XRP', 0.62, -1.40, '#23a7e0', 'Payments'),
  DOGE: _c('DOGE', 'Dogecoin', 0.164, 8.40, '#c2a633', 'Memecoins'),
  SHIB: _c('SHIB', 'Shiba Inu', 0.0000246, -3.10, '#f00500', 'Memecoins'),
  WIF: _c('WIF', 'dogwifhat', 2.84, 22.1, '#d9a679', 'Memecoins'),
  PEPE: _c('PEPE', 'Pepe', 0.0000112, -6.20, '#4aa14a', 'Memecoins'),
  BONK: _c('BONK', 'Bonk', 0.0000312, 14.7, '#f5a623', 'Memecoins'),
  UNI: _c('UNI', 'Uniswap', 11.2, -0.90, '#ff007a', 'DeFi'),
  AAVE: _c('AAVE', 'Aave', 98.6, 3.40, '#b6509e', 'DeFi'),
  LINK: _c('LINK', 'Chainlink', 18.7, 1.20, '#2a5ada', 'Infrastructure'),
  ONDO: _c('ONDO', 'Ondo', 1.34, 5.60, '#3a6df0', 'RWA'),
  MKR: _c('MKR', 'Maker', 2410, 0.40, '#1aab9b', 'RWA'),
  RNDR: _c('RNDR', 'Render', 7.92, 6.10, '#ff5c2b', 'AI Agents'),
  FET: _c('FET', 'Artificial SI', 1.42, 7.80, '#1a1a2e', 'AI Agents'),
  TAO: _c('TAO', 'Bittensor', 412.0, 5.30, '#3b3b98', 'AI Agents'),
});

/* The bundled values above are visual-development fixtures, not market facts.
   Live ingestion replaces them and flips these flags in market.js. */
for (const ticker of Object.values(TICKERS)) {
  if (!ticker.real) ticker.synthetic = true;
}

/* Unknown symbols must fail closed. A neutral placeholder keeps legacy renderers
   from crashing without inventing a plausible quote or company fundamentals. */
export function getTicker(sym) {
  if (!sym) return TICKERS.TSLA;
  sym = String(sym).toUpperCase();
  if (TICKERS[sym]) return TICKERS[sym];
  const stub = {
    sym, name: sym, price: 0, chg: 0, chgPct: 0,
    color: '#64748b', sector: 'Unavailable',
    mktCap: 'N/A', evSales: 'N/A', pe: 'N/A', fyRev: 'N/A', eps: 'N/A',
    grossMargin: 'N/A', profitMargin: 'N/A', beta: 'N/A', divYield: 'N/A',
    real: false, synthetic: true, unavailable: true,
  };
  TICKERS[sym] = stub;
  return stub;
}

/* ---- dashboard ---- */
export const SECTORS = [
  ['Real Estate', 1.45], ['Consumer Defensive', 1.44], ['Healthcare', 0.91],
  ['Basic Materials', 0.82], ['Industrials', 0.73], ['Financial', 0.20],
  ['Consumer Cyclical', -0.26], ['Utilities', -0.39], ['Technology', -0.48],
  ['Energy', -1.29], ['Communication Services', -1.51],
];

export const DAILY_RECAP = [
  { ticker: null, title: 'The markets are neutral', body: 'Consumer confidence in the U.S. takes a significant hit in four years, amid inflation concerns. Workday’s revenue beat expectations, giving its stock a boost in the market. New data on consumer confidence, manufacturing, and home sales paints a mixed picture of the U.S.', more: true },
  { ticker: 'META', body: 'Meta plans a <b>$200 billion</b> AI center, per reports.' },
  { ticker: 'KEYS', body: 'Keysight’s <b>+5.07%</b> strong Q2 outlook follows a robust Q1, lifting market confidence.' },
  { ticker: 'WBA', body: 'Walgreens <b>+4.36%</b> is settling a $595M dispute over Everly testing contracts.' },
  { ticker: 'SRE', body: 'S&P 500 dips for a fourth day, driven by weak Sempra’s <b>-8.70%</b> consumer-confidence report.' },
];

/* ---- watchlist ---- */
export const WATCHLIST = {
  holdings: ['AAPL', 'TCEHY', 'MSFT', 'NVDA', 'SHOP', 'VLCN', 'ANTX'],
  tracking: ['TSLA', 'RIVN', 'GM'],
  favorites: ['MSFT', 'ADBE', 'NKE', 'UL', 'TSLA', 'NVDA'],
};

/* ---- TSLA financials (Peers / Financials tabs) ---- */
export const CAP_BREAKDOWN = [
  ['Net Liability', '-18.5B', '#5b6cf0'],
  ['Market Cap', '601B', '#7c83f5'],
  ['Total Enterprise Value (TEV)', '582.5B', '#e6e6e6'],
  ['Common Equity', '62.6B', '#e6c84f'],
  ['Total Liability', '10.5B', '#e8736e'],
  ['Total Capital', '73.1B', '#9aa0a6'],
];
export const PEERS = [
  ['GM', 'General Motors Company', 2.00, '38.37', '0.16%'],
  ['RIVN', 'Rivian Automotive Inc', 164.43, '15.55', '1.34%'],
  ['TSLA', 'Tesla Inc', 14.67, '190.40', '3.47%'],
];

/* ---- analyst ratings + price target ---- */
export const RATINGS = { strongSell: 8, sell: 4, neutral: 15, buy: 7, strongBuy: 12, label: 'Optimistic' };
export const PRICE_TARGET = { value: 345.55, potential: 4.96, low: 120, median: 295, high: 500 };

/* ---- analyst coverage tables ---- */
export const EST_YEARS = ['2021', '2022', '2023', '2024', '2025', '2026'];
export const EST_ROWS = {
  Revenue: [
    ['Q1 January', '10.39B', '18.76B', '23.33B', '21.30B', '23.97B', '30.06B'],
    ['Q2 October', '11.96B', '16.93B', '24.93B', '25.50B', '27.25B', '32.31B'],
    ['Q3 July', '13.76B', '21.45B', '23.35B', '25.18B', '28.15B', '34.15B'],
    ['Q4 April', '17.72B', '24.32B', '25.17B', '25.71B', '30.10B', '36.42B'],
    ['Full year', '53.82B', '81.46B', '96.77B', '97.69B', '112.60B', '134.65B'],
    ['Calendar year', '53.82B', '81.46B', '96.77B', '97.69B', '112.60B', '134.65B'],
  ],
  EBITDA: [
    ['Q1 January', '1.83B', '5.02B', '4.27B', '4.13B', '4.76B', '6.10B'],
    ['Q2 October', '2.47B', '3.79B', '4.65B', '4.42B', '5.14B', '6.60B'],
    ['Q3 July', '3.24B', '4.97B', '3.76B', '4.78B', '5.68B', '7.10B'],
    ['Q4 April', '4.02B', '5.40B', '3.95B', '5.02B', '5.89B', '7.40B'],
    ['Full year', '11.56B', '19.19B', '16.63B', '17.44B', '23.26B', '27.20B'],
    ['Calendar year', '11.56B', '19.19B', '16.63B', '17.44B', '23.26B', '27.20B'],
  ],
  'Net Income': [
    ['Q1 January', '1.06B', '3.74B', '2.93B', '1.54B', '1.76B', '2.87B'],
    ['Q2 October', '1.62B', '2.62B', '3.15B', '1.81B', '2.37B', '3.35B'],
    ['Q3 July', '2.09B', '3.65B', '2.32B', '2.51B', '2.47B', '3.53B'],
    ['Q4 April', '2.88B', '4.11B', '2.49B', '2.57B', '2.63B', '3.64B'],
    ['Full year', '7.64B', '14.12B', '10.88B', '8.42B', '10.67B', '14.02B'],
    ['Calendar year', '7.64B', '14.12B', '10.88B', '8.42B', '10.67B', '14.02B'],
  ],
};
export const MULTIPLES = {
  cols: ['Q3 2024', 'Q4 2024', 'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025'],
  est: [false, false, true, true, true, true],
  rows: [
    ['Price-to-earnings (P/E)', '71.41', '197.46', '188.64', '147.15', '137.70', '125.20'],
    ['Price-to-sales (P/S)', '8.61', '13.18', '13.43', '11.81', '11.43', '10.70'],
    ['Price-to-book Value (P/B)', '11.95', '17.64', '17.04', '16.43', '15.79', '15.77'],
    ['Price-to-cash flow', '145.63', '292.43', '365.85', '292.93', '291.60', '296.78'],
    ['EV/Revenue', '8.40', '12.95', '13.20', '11.81', '11.24', '10.51'],
    ['EV/EBITDA', '55.65', '103.39', '78.33', '64.83', '62', '59.05'],
    ['EV/EBIT', '100.25', '178.82', '210', '137.51', '133.91', '119.13'],
    ['Dividend Yield', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A'],
  ],
};

/* ---- AI analysis ---- */
export const ANALYSIS = {
  priceStats: [
    ['Last price', '$329.71', 2.71, true], ['High on Dec 23 ’24', '$454.13', 124.11, true],
    ['Low on Apr 19 ’24', '$142.05', -29.90, false], ['Average', '$387.79', 115.30, true],
    ['Volume', '143M', -60.69, false], ['SMA (15)', '189M', -29.42, false],
    ['Market cap', '1.06T', 62.71, true], ['EPS (TTM)', '2.20', -52.72, false],
    ['P/E ratio (TTM)', '149.25', 111.49, true],
  ],
  sections: [
    ['Fundamentals', 'Tesla, Inc. operates as a manufacturer and retailer, primarily focusing on electric vehicles and energy solutions. They generate revenue through direct sales of vehicles and energy products, leasing, and associated services.'],
    ['Financial health', 'Tesla’s financial health is robust, marked by a consistent increase in revenue and net income. Margins have shown improvement, reflecting efficient operations. The company maintains a strong cash position, with more cash than debt, enhancing its investment capacity and financial stability. These factors, combined with a rising market cap, make it an attractive option for investors.'],
    ['Risks and challenges', 'Tesla faces significant risks including production ramp delays, supplier issues, and high operating costs. Dependence on key personnel like Elon Musk and challenges in scaling operations globally add to operational risks. Regulatory changes, especially in electric vehicle incentives and data privacy, could impact profitability. Financially, Tesla’s high indebtedness and reliance on equity markets for funding expose it to market volatility and liquidity risks.'],
    ['Summary', 'Tesla demonstrated strong financial performance with significant revenue growth across multiple segments. The company’s ability to increase automotive sales, energy generation and storage, and services and other revenues indicates a strong market presence and successful business strategies.'],
  ],
  sources: [['10-K filing', '20K words'], ['Financials', '16 quarters'], ['Analyst estimates', '32 analysts']],
};

/* ---- economy ---- */
export const ECON_CAL = [
  ['JN Consumer Confidence', '99.1', '98.4', '98.0'],
  ['US Nonfarm Payrolls Preliminary', '160K', '151K', '175K'],
  ['US Initial Jobless Claims', '220K', '221K', '219K'],
  ['EU CPI Flash Estimate Y/Y', '2.2%', '2.4%', '2.3%'],
  ['US ADP Employment Change', '139K', '140K', '122K'],
  ['DE Factory Orders M/M', '0.5%', '-1.2%', '-5.4%'],
];

/* ---- plans ---- */
export const PLANS = [
  { id: 'monthly', price: 30, was: 50, unit: 'month', label: '$30/month', desc: 'Stay monthly without missing out on any feature.' },
  { id: 'yearly', price: 300, was: 600, unit: 'year', label: '$300/year', desc: 'Pay for a full year upfront and get 2 months for free.', save: 60 },
];

/* ---- dashboard news feed (with timestamps) ---- */
export const DASH_NEWS = [
  { ticker: null, title: 'The markets are neutral', body: 'Consumer confidence in the U.S. takes a significant hit in four years, amid inflation concerns. Workday’s revenue beat expectations, giving its stock a boost. New data on consumer confidence, manufacturing, and home sales paints a mixed picture of the U.S.', more: true, time: 'Summarized at 6:00 AM' },
  { ticker: 'META', pill: '+1.47%', up: true, body: 'Meta plans a <b>$200 billion</b> AI center, per reports.', time: 'Today · 10m ago' },
  { ticker: 'KEYS', pill: '+5.07%', up: true, body: 'Keysight’s strong Q2 outlook follows a robust Q1, lifting market confidence.', time: 'Today · 1h ago' },
  { ticker: 'WBA', pill: '+4.36%', up: true, body: 'Walgreens is settling a $595M dispute over Everly testing contracts.', time: 'Today · 3h ago' },
  { ticker: 'SRE', pill: '-8.70%', up: false, body: 'S&P 500 dips for a fourth day, driven by weak Sempra’s consumer-confidence report.', time: 'Today · 4h ago' },
];

/* ---- stock right panel: key indicators + about + news ---- */
export const KEY_INDICATORS = [
  'Underperforming the S&P 500 by 20.47% YTD',
  'Trading 31.7% below its 52-week high',
  'Profit margin contracted to 9.01% last quarter',
  'Beta of 2.33 — more volatile than the market',
];
export const ABOUT = {
  TSLA: [['calendar', 'Founded in 2003'], ['home', 'Headquartered in United States'], ['user', 'Employing 140,473 people'], ['analyze', 'Led by Elon Musk'], ['compass', 'Operating in the Consumer Cyclical sector']],
};
export const STOCK_NEWS = [
  ['Tesla to acquire German parts maker Manz, including 300+ employees, in Reutlingen.', 'Negative', 'Reuters', 'Feb 25, 2025, 7:36 PM'],
  ['Analysts trim delivery estimates ahead of Q1 production update.', 'Negative', 'Barron’s', 'Feb 25, 2025, 4:12 PM'],
  ['Energy storage deployments hit a record in the latest quarter.', 'Positive', 'Bloomberg', 'Feb 24, 2025, 9:02 PM'],
  ['Regulators open review of advanced driver-assist software.', 'Negative', 'The Guardian', 'Feb 24, 2025, 1:20 PM'],
];

/* ---- analyst rating actions (coverage modal · Ratings tab) ---- */
export const RATING_ACTIONS = [
  ['reiterated', 'Buy', 'The Benchmark Company', '475', null, 'Feb 12, 2025'],
  ['upgrade', 'Outperform', 'Wedbush', '515 → 550', 6.80, 'Jan 22, 2025'],
  ['upgrade', 'Overweight', 'Barclays', '270 → 325', 20.37, 'Jan 15, 2025'],
  ['downgrade', 'Buy → Neutral', 'BofA Securities', '400 → 490', 22.50, 'Jan 7, 2025'],
  ['upgrade', 'Neutral → Buy', 'New Street', '460', null, 'Jan 6, 2025'],
  ['upgrade', 'Buy', 'Mizuho', '230 → 515', 123.91, 'Dec 17, 2024'],
  ['upgrade', 'Buy', 'ROTH MKM', '85 → 380', 347.06, 'Dec 2, 2024'],
  ['reiterated', 'Equal Weight', 'Wells Fargo', '120 → 125', 4.17, 'Oct 24, 2024'],
  ['initiation', 'Peer Perform', 'Wolfe Research', 'Not reported', null, 'Oct 10, 2024'],
];

/* ---- SEC filings (analysis · SEC tab) ---- */
export const SEC_FILINGS = [
  ['2025', [['Form 10-K', 'Jan 29, 2025', '10-K'], ['Form 8-K', 'Jan 24, 2025', '8-K']]],
  ['2024', [['Form 10-Q', 'Oct 23, 2024', '10-Q'], ['Form 10-Q', 'Jul 24, 2024', '10-Q'], ['Form 10-Q', 'Apr 24, 2024', '10-Q'], ['Form 8-K', 'Jan 26, 2024', '8-K']]],
  ['2023', [['Form 10-K', 'Jan 27, 2023', '10-K'], ['Form 10-Q', 'Oct 23, 2023', '10-Q']]],
];
export const FILING_SUMMARY = [
  ['Financials', 'Total revenue grew to $97.69B, up 18.8% year over year, led by automotive and energy generation & storage. Operating margin compressed amid pricing actions, while free cash flow remained positive.'],
  ['Strengths', 'A net cash position, vertical integration, and an expanding energy business diversify the revenue base beyond vehicles. Brand strength supports pricing power in key markets.'],
  ['Challenges', 'Intensifying EV competition, pricing pressure, and key-person dependence on Elon Musk. Regulatory shifts to incentives and autonomy add execution risk.'],
];

/* ---- economy · markets tab ---- */
export const TOP_INDICES = [
  ['OMXS30', 'Sweden', 15.19, 43], ['IBEX 35', 'Spain', 13.04, 35], ['FTSE MIB', 'Italy', 12.77, 40],
  ['DAX', 'Germany', 12.51, 36], ['Grupo BMV', 'Mexico', 11.45, 51],
];
export const MARKETS_TABLE = [
  ['Americas', [['Dow Jones', 'USA', 1.94, '3.61', '1.42%', '3.79T', '$435.19'], ['S&P 500', 'USA', 1.27, '4.10', '1.30%', '44.1T', '$597.99'], ['Nasdaq', 'USA', 0.63, '3.92', '0.78%', '28.8T', '$520.14'], ['TSX', 'Canada', 3.13, '2.88', '2.91%', '3.30T', '$41.35'], ['Ibovespa', 'Brazil', 10.82, '2.04', '4.60%', '0.84T', '$25.04']]],
  ['EMEA', [['DAX', 'Germany', 12.51, '4.31', '2.40%', '2.10T', '$185.30'], ['FTSE 100', 'UK', 6.42, '3.88', '3.60%', '2.40T', '$87.61'], ['CAC 40', 'France', 8.90, '4.02', '2.90%', '2.80T', '$78.20']]],
];
export const INSIDER_TRADES = [
  ['Elon Musk', 'TSLA', 'Sale', -1102.0, 'Nov 2024'],
  ['Jensen Huang', 'NVDA', 'Sale', -42.6, 'Oct 2024'],
  ['Mark Zuckerberg', 'META', 'Sale', -28.4, 'Oct 2024'],
  ['Warren Buffett', 'OXY', 'Purchase', 245.0, 'Sep 2024'],
  ['Satya Nadella', 'MSFT', 'Sale', -15.2, 'Sep 2024'],
];
