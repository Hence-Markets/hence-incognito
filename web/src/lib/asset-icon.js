/* =========================================================
   Asset icon resolver — real logos/icons for every asset type.

   PRIMARY source is Hyperliquid's own icon CDN keyed by the FULL coin
   name (e.g. `xyz:NVDA`, `xyz:CL`, `flx:GOLD`, `vntl:OPENAI`, bare `BTC`)
   — that covers native crypto AND the tokenized stocks/commodities/
   indices/fx/pre-IPO on the HIP-3 dexes with their real branded icons.
   Everything is fetched SAME-ORIGIN through serve.py `/api/icon`, which
   (a) lets logos load inside any sandboxed/CSP-restricted webview and
   (b) rejects Hyperliquid's HTML "miss" page server-side (returns 404)
   so the <img> fallback chain stays clean.

   Per-category fallbacks fill the gaps the HL CDN doesn't have (the `km`
   dex, some indices): stocks→FMP, fx/national-index→flag, crypto→CoinGecko.
   Final fallbacks: curated emoji, then the colored-letter badge.
   ========================================================= */
import { getTicker } from './data.js';
import { perpCategories } from './hydromancer.js';

// bump IV when the proxy's icon processing changes — busts the immutable browser cache
const IV = '3';
const ICON = '/api/icon?v=' + IV + '&src=';
const hlUrl = (coin) => ICON + 'hl&c=' + encodeURIComponent(coin);
const fmpUrl = (tk) => ICON + 'fmp&c=' + encodeURIComponent(tk);
const flagUrl = (cc) => ICON + 'flag&c=' + encodeURIComponent(cc);
const cgUrl = (sym) => ICON + 'cg&c=' + encodeURIComponent(String(sym).toLowerCase());

// curated emoji — last-resort fallback for the few assets the HL CDN lacks
const EMOJI = {
  GOLD: '🥇', SILVER: '🥈', COPPER: '🟤', PLATINUM: '⚙️', PALLADIUM: '⚙️', ALUMINIUM: '⚙️',
  // NB: no 'GAS' here — that's the Neo-ecosystem crypto TOKEN (HL CDN logo), not the commodity
  OIL: '🛢️', USOIL: '🛢️', BRENTOIL: '🛢️', CL: '🛢️', WTI: '🛢️', NATGAS: '🔥', TTF: '🔥',
  WHEAT: '🌾', CORN: '🌽', SOY: '🫘',
  USA500: '🇺🇸', US500: '🇺🇸', SP500: '🇺🇸', JP225: '🇯🇵', KR200: '🇰🇷', SMALL2000: '🇺🇸',
  SEMI: '🔲', SEMIS: '🔲', BIOTECH: '🧬', DEFENSE: '🛡️', NUCLEAR: '☢️',
  ENERGY: '⚡', USENERGY: '⚡', USTECH: '💻', INFOTECH: '💻', ROBOT: '🤖', MAG7: '📈',
  GLDMINE: '⛏️', GOLDJM: '🥇', SILVERJM: '🥈', VIX: '📉', VOL: '📉', XYZ100: '💯',
  EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', KRW: '🇰🇷', DXY: '💵',
  BOT: '🤖', DRAM: '🔲', MINIMAX: '🤖', ZHIPU: '🤖',
  ANTHROPIC: '🤖', OPENAI: '🤖', SPACEX: '🚀', QNT: '🪙', KIOXIA: '🔲', PURRDAT: '🐱',
};

// fx + national-index symbol → flagcdn country code
const FLAG_CC = {
  EUR: 'eu', GBP: 'gb', JPY: 'jp', KRW: 'kr', DXY: 'us',
  USA500: 'us', US500: 'us', SP500: 'us', SMALL2000: 'us', JP225: 'jp', KR200: 'kr',
};

// foreign / thematic tickers whose bare symbol isn't a real FMP ticker
const STOCK_ALIAS = {
  TENCENT: 'TCEHY', XIAOMI: 'XIACY', HYUNDAI: 'HYMTF', SMSN: 'SSNLF',
  SAMSUNG: 'SSNLF', SOFTBANK: 'SFTBY', SKHX: '000660.KS',
};

/* ---------- category map (authoritative, lazy + cached) — for fallback routing ---------- */
let _catMap = null;
let _catPromise = null;

export function initAssetIcons() {
  if (_catPromise) return _catPromise;
  _catPromise = perpCategories()
    .then((list) => {
      const m = {};
      for (const item of list || []) {
        if (Array.isArray(item) && item.length >= 2) {
          const bare = String(item[0]).split(':').pop().toUpperCase();
          if (!m[bare]) m[bare] = String(item[1]).toLowerCase();
        }
      }
      _catMap = m;
      try { window.dispatchEvent(new CustomEvent('hence:icons')); } catch { /* noop */ }
      return m;
    })
    .catch(() => { _catMap = {}; return {}; });
  return _catPromise;
}

function categoryOf(SYM) {
  if (_catMap && _catMap[SYM]) return _catMap[SYM];
  const t = getTicker(SYM);
  if (t && t.world === 'stocks') return 'stocks';
  return 'crypto';
}

/* ---------- failed-source memory ----------
   Some symbols (e.g. kSHIB) have NO icon in any source — every URL in the chain 404s. Without
   memory, each re-render / remount re-runs the whole chain and re-fetches the same 404s (the
   observed "GET /api/icon?...&c=kSHIB → 404 dozens of times/sec" loop). We remember every
   individual URL that has failed so it's pruned from the chain on the next resolve, and once the
   whole chain is exhausted the symbol is marked dead → no <img> is even created. */
const _failedSrc = new Set();     // exact icon URLs that 404'd
const _deadSym = new Set();       // symbols whose entire chain failed → skip img entirely
export function markIconFailed(sym, src) {
  if (src) _failedSrc.add(src);
  if (sym) {
    // if every source for this symbol has now failed, mark the symbol dead so future renders
    // don't even mount an <img> (letter/emoji badge stands alone)
    const { srcs } = resolveSrcs(sym);
    if (srcs.length && srcs.every(s => _failedSrc.has(s))) _deadSym.add(String(sym).toUpperCase());
  }
}
export const iconSymDead = (sym) => _deadSym.has(String(sym).toUpperCase());

/* ---------- public resolver — { srcs: string[], emoji: string|null, cat } ---------- */
export function assetIcon(sym, opts = {}) {
  const SYM = String(sym || '').trim().toUpperCase();
  if (_deadSym.has(SYM)) { const r = resolveSrcs(sym, opts); return { srcs: [], emoji: r.emoji, cat: r.cat }; }
  const r = resolveSrcs(sym, opts);
  const live = r.srcs.filter(s => !_failedSrc.has(s));   // prune already-404'd sources
  if (r.srcs.length && !live.length) _deadSym.add(SYM);
  return { srcs: live, emoji: r.emoji, cat: r.cat };
}

function resolveSrcs(sym, opts = {}) {
  const raw = String(sym || '').trim();
  const SYM = raw.toUpperCase();
  const t = getTicker(raw);
  const coin = (t && t.coin) || raw; // FULL HL coin name: "xyz:NVDA" / "kPEPE" / "BTC"
  // FORCED equity identity: research-only mentions + research tickers must never render a
  // same-ticker crypto's icon (ALT the biotech vs ALT the crypto) — company logo only.
  if (opts.kind === 'equity' || (t && t.research)) {
    return { srcs: [fmpUrl(STOCK_ALIAS[SYM] || SYM)], emoji: null, cat: 'stocks' };
  }
  const cat = categoryOf(SYM);
  const emoji = EMOJI[SYM] || null;

  const srcs = [hlUrl(coin)]; // PRIMARY: real branded icon, by full coin name
  // 1000×/k multiplier coins (kPEPE, 1000PEPE on any dex): HL stores the icon under the BASE symbol
  const base = SYM.replace(/^(?:K|1000)(?=[A-Z])/, '');
  if (base !== SYM) srcs.push(hlUrl(base));
  // category fallbacks for the assets HL's CDN doesn't carry
  if (cat === 'stocks') srcs.push(fmpUrl(STOCK_ALIAS[SYM] || SYM));
  else if (cat === 'fx' || cat === 'indices') { if (FLAG_CC[SYM]) srcs.push(flagUrl(FLAG_CC[SYM])); }
  else if (cat === 'crypto') srcs.push(cgUrl(SYM));
  // last image resort: FMP resolves TradFi tickers (KWEB, CAR) that live on mixed/"dreamcash"
  // dexes and got tagged crypto. Skip emoji-curated symbols — those collide with wrong-asset
  // logos (GOLD→Barrick, CL→Colgate, WTI→W&T Offshore).
  if (cat !== 'stocks' && !emoji) srcs.push(fmpUrl(SYM));

  return { srcs, emoji, cat };
}

/* ---------- shared <img> fallback cascade (vanilla logo() chips) ---------- */
function installFallback() {
  if (typeof document === 'undefined' || window.__henceIconFallback) return;
  window.__henceIconFallback = true;
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo__img') || !img.dataset.chain) return;
      let chain = [];
      try { chain = JSON.parse(img.dataset.chain); } catch { /* noop */ }
      const cur = +img.dataset.i || 0;
      _failedSrc.add(chain[cur]);                       // remember this URL 404'd — don't refetch on re-render
      const i = cur + 1;
      if (i < chain.length) { img.dataset.i = String(i); img.src = chain[i]; return; }
      if (img.dataset.sym) _deadSym.add(img.dataset.sym.toUpperCase());  // whole chain dead → skip img next time
      img.remove(); // reveal the emoji / letter badge underneath
    },
    true, // capture — error events don't bubble
  );
}
installFallback();

// HTML for the overlay <img> used by the vanilla logo() chip
export function iconImgHtml(sym) {
  const { srcs } = assetIcon(sym);                    // already pruned of known-failed sources
  if (!srcs.length) return '';                        // dead symbol / no icon → letter-badge only
  const SYM = String(sym || '').trim().toUpperCase();
  return `<img class="logo__img" src="${srcs[0]}" data-sym="${SYM}" data-chain='${JSON.stringify(srcs)}' data-i="0" alt="" loading="lazy" decoding="async">`;
}
