/* =========================================================
   entities.ts — link ticker entities inside recap HTML.
   Wraps the FIRST occurrence of each distinct asset (by NAME or
   SYMBOL) in a quiet, editorial `.tk-chip` button. Never touches
   text inside existing HTML tags (splits on tags, processes only
   text nodes). Longest-match-first, capped at 6 chips total.
   ========================================================= */
// @ts-ignore — JS module without types
import { assetsByWorld } from './market.js';
// @ts-ignore — JS module without types
import { TICKERS } from './data.js';
// @ts-ignore — JS module without types
import { logo } from './ui.js';

const MAX_CHIPS = 6;

// prose says "Google", tickers say "Alphabet Inc." — map the names people actually write
const ALIASES: Record<string, string[]> = {
  GOOGL: ['Google', 'Alphabet'], GOOG: ['Google', 'Alphabet'], META: ['Meta', 'Facebook', 'Instagram'],
  BRK: ['Berkshire', 'Berkshire Hathaway'], JPM: ['JPMorgan', 'JP Morgan'], GS: ['Goldman Sachs', 'Goldman'],
  ETH: ['Ether'], BTC: ['BTC'], HOOD: ['Robinhood'], COIN: ['Coinbase'], XOM: ['Exxon', 'ExxonMobil'],
};
// "NVIDIA Corporation" → "NVIDIA"; "Alphabet Inc." → "Alphabet" — so names match how prose writes them
const NAME_SUFFIX_RE = /[,\s]+(incorporated|corporation|company|holdings?|group|platforms?|technologies|labs|markets|inc\.?|corp\.?|co\.?|ltd\.?|plc|sa|ag|nv|class [a-c])\.?\s*$/i;
const cleanName = (n: string) => {
  let out = String(n || '').trim();
  for (let i = 0; i < 3; i++) { const next = out.replace(NAME_SUFFIX_RE, '').trim(); if (next === out) break; out = next; }
  return out;
};

interface Entry { sym: string; text: string; ci: boolean; } // ci = case-insensitive (names)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Build the match dictionary for a world: asset NAMES (case-insensitive) and
   SYMBOLS (case-sensitive, word-boundary). Longest text first so "Bitcoin"
   wins over a stray substring and multi-word names beat single tokens. */
function buildDict(world: string): Entry[] {
  const out: Entry[] = [];
  const tickers = TICKERS as Record<string, any>;
  const seenText = new Set<string>();
  const push = (sym: string, text: string, ci: boolean) => {
    const cleanSym = String(sym || '').toUpperCase().replace(/[^A-Z0-9._:-]/g, '').slice(0, 32);
    const t = String(text || '').trim();
    if (!cleanSym || !t || t.length < 2) return;
    const key = ci ? t.toLowerCase() : t;
    if (seenText.has(key)) return;
    seenText.add(key);
    out.push({ sym: cleanSym, text: t, ci });
  };
  const assets: any[] = (() => { try { return assetsByWorld(world) || []; } catch { return []; } })();
  const pushName = (sym: string, name: string) => {
    if (!name || name === sym) return;
    push(sym, name, true);
    const c = cleanName(name);                       // "Alphabet Inc." also matches as "Alphabet"
    if (c && c !== name && c.length > 2) push(sym, c, true);
  };
  for (const a of assets) {
    if (!a || !a.sym) continue;
    const t = tickers[a.sym];
    pushName(a.sym, (t && t.name) || a.name || '');
    push(a.sym, a.sym, false);
  }
  // names present in TICKERS but not in this world's universe (still worth linking) —
  // WORLD-GUARDED: the registry is shared across worlds, and the equity screener writes
  // stock names onto symbols the crypto universe also claims ("Seagate Technology" onto
  // STX, which is Stacks on Hyperliquid). Without the guard, a stocks recap chipped
  // "Seagate" and the menu showed the $0.13 crypto — wrong entity, worse than no chip.
  for (const sym of Object.keys(tickers)) {
    const t = tickers[sym];
    if (!t || !t.name) continue;
    if (t.world && t.world !== world) continue;
    pushName(sym, t.name);
  }
  // common-usage aliases ("Google" → GOOGL) — only for symbols the app actually knows
  for (const [sym, names] of Object.entries(ALIASES)) {
    if (!tickers[sym]) continue;
    for (const n of names) push(sym, n, true);
  }
  // longest text first
  return out.sort((x, y) => y.text.length - x.text.length);
}

/* Wrap matches within a single text-node string. Mutates `usedSyms` (one chip per
   asset) and `count` (via return). Only the FIRST occurrence of each asset is wrapped. */
function linkTextNode(text: string, dict: Entry[], usedSyms: Set<string>, remaining: () => number): string {
  if (remaining() <= 0) return escapeHtml(text);
  // find, for each still-unused entry, its earliest match position in `text`
  let result = '';
  let cursor = 0;
  // greedy left-to-right: repeatedly find the earliest match among available entries
  while (cursor < text.length && remaining() > 0) {
    let best: { idx: number; len: number; sym: string; matched: string } | null = null;
    for (const e of dict) {
      if (usedSyms.has(e.sym)) continue;
      const re = e.ci
        ? new RegExp('\\b' + escapeRe(e.text) + '\\b', 'i')
        : new RegExp('\\b' + escapeRe(e.text) + '\\b');
      re.lastIndex = 0;
      const m = re.exec(text.slice(cursor));
      if (!m) continue;
      const idx = cursor + m.index;
      const matched = m[0];
      // earliest position wins; on a tie, longer match wins (dict already longest-first)
      if (!best || idx < best.idx) best = { idx, len: matched.length, sym: e.sym, matched };
    }
    if (!best) break;
    result += escapeHtml(text.slice(cursor, best.idx));
    result += `<button class="tk-chip" data-tk="${best.sym}">${logo(best.sym, 13)}<span>${escapeHtml(best.matched)}</span></button>`;
    usedSyms.add(best.sym);
    cursor = best.idx + best.len;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}

/* Public: link ticker entities in recap text for `world`.
   The input can be generated by an external model, so existing tags are never
   preserved. Only the ticker-chip markup created in this module is returned. */
export function linkEntities(html: string, world: string): string {
  if (!html) return html;
  const text = String(html).replace(/<[^>]*>/g, ' ');
  const dict = buildDict(world);
  if (!dict.length) return escapeHtml(text);
  const usedSyms = new Set<string>();
  const remaining = () => MAX_CHIPS - usedSyms.size;
  return linkTextNode(text, dict, usedSyms, remaining);
}
