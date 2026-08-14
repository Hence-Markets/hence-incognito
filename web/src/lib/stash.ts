/* =========================================================
   stash.ts — local "captured ideas" store (localStorage) + server sync.
   Every reaction the user makes on home — save / agree / disagree / dismiss —
   flows through record(). It always appends to localStorage (offline-first),
   then, when signed in, fires me.logIdea() and marks the row synced. On login
   the queued (unsynced) rows are migrated to the server in one shot.

   Shapes mirror the server idea-object so a row maps 1:1 onto the migrate/POST
   body: { kind, subject_type, subject{url,title,snippet,symbols,market_id,key},
   stance?, evidence?, created_at }.
   ========================================================= */
import { track } from './analytics';
import * as me from './me.js';

export type IdeaKind = 'save' | 'agree' | 'disagree' | 'dismiss' | 'paper_call';
// mirrors users_store._SUBJECT_TYPES (and the idea_objects check constraint) — the server
// has always accepted 'thesis'; the client type just hadn't caught up.
export type SubjectType = 'news' | 'asset' | 'prediction_market' | 'setup' | 'thesis';
// paper_call stances are directional (long/short); market reactions stay yes/no
export type Stance = 'yes' | 'no' | 'long' | 'short';

export interface StashItem {
  id: string;
  kind: IdeaKind;
  subject_type: SubjectType;
  // subject fields kept flat on the row for the v0 save shape; also mirrored below
  symbol: string;
  symbols: string[];
  title: string;
  url: string;
  source: string;
  // richer subject fields (only some reactions use these)
  snippet?: string;
  market_id?: string;
  key?: string;           // stable id for setups / non-URL subjects (dismiss dedupe)
  stance?: Stance;
  evidence?: any;
  ts: number;
  synced?: boolean;
}

const KEY = 'hence.stash.v1';

function read(): StashItem[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function write(items: StashItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota / disabled — ignore */ }
}

const rid = () => 'stk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- server-shape mapping ---------- */
// build the { kind, subject_type, subject{...}, stance?, evidence?, created_at } body the
// server expects, from a local row. Used by both record() (single POST) and migrate (bulk).
function toServerItem(row: StashItem) {
  const subject: any = {};
  if (row.url) subject.url = row.url;
  if (row.title) subject.title = row.title;
  if (row.snippet) subject.snippet = row.snippet;
  if (row.symbols && row.symbols.length) subject.symbols = row.symbols;
  if (row.market_id) subject.market_id = row.market_id;
  if (row.key) subject.key = row.key;
  const body: any = { kind: row.kind, subject_type: row.subject_type, subject };
  if (row.stance) body.stance = row.stance;
  if (row.evidence != null) body.evidence = row.evidence;
  body.created_at = new Date(row.ts).toISOString();
  return body;
}

function signedIn(): boolean {
  try { return !!(window as any).henceMe; } catch { return false; }
}

function markSynced(id: string) {
  const items = read();
  const row = items.find((x) => x.id === id);
  if (row && !row.synced) { row.synced = true; write(items); }
}

/* ---------- public: the single reaction entry point ---------- */
export interface RecordInput {
  kind: IdeaKind;
  subject_type: SubjectType;
  symbol?: string;
  symbols?: string[];
  title?: string;
  url?: string;
  source?: string;
  snippet?: string;
  market_id?: string;
  key?: string;
  stance?: Stance;
  evidence?: any;
}

// append a reaction locally (always), then sync to the server if signed in (fire-and-forget).
// dedupe for `save` kind by url|symbol (parity with the old add()); other kinds always append.
export function record(input: RecordInput): { deduped: boolean; item: StashItem } {
  track('belief_saved', { kind: input.kind, stance: (input as any).stance || undefined });
  const items = read();
  const url = input.url || '';
  const symbol = String(input.symbol || '').toUpperCase();
  const symbols = (input.symbols && input.symbols.length ? input.symbols : symbol ? [symbol] : [])
    .map((s) => String(s).toUpperCase());

  if (input.kind === 'save') {
    // dedupe within the SAME subject_type only (an asset save must not swallow a setup
    // save of the same symbol), and prefer the stable `key` when the subject carries one
    const key = input.key || '';
    const existing = (key || url || symbol)
      ? items.find((x) => x.kind === 'save' && x.subject_type === input.subject_type
          && (key
            ? String(x.key || '') === key
            : (x.url || '') === url && (url ? true : String(x.symbol || '').toUpperCase() === symbol)))
      : null;
    if (existing) return { deduped: true, item: existing };
  }

  const row: StashItem = {
    id: rid(),
    kind: input.kind,
    subject_type: input.subject_type,
    symbol,
    symbols,
    title: input.title || '',
    url,
    source: input.source || '',
    snippet: input.snippet,
    market_id: input.market_id,
    key: input.key,
    stance: input.stance,
    evidence: input.evidence,
    ts: Date.now(),
    synced: false,
  };
  items.unshift(row);
  write(items);

  // fire-and-forget server sync when signed in; mark synced on ok
  if (signedIn()) {
    Promise.resolve(me.logIdea(toServerItem(row)))
      .then((r: any) => { if (r && !r.error && !r.unauth) markSynced(row.id); })
      .catch(() => { /* stays queued for the next migrate */ });
  }

  return { deduped: false, item: row };
}

/* ---------- back-compat: add() is now a thin save wrapper over record() ---------- */
export function add(item: Partial<StashItem> & { subject_type: StashItem['subject_type'] }): { deduped: boolean; item: StashItem } {
  return record({
    kind: 'save',
    subject_type: item.subject_type,
    symbol: item.symbol,
    symbols: item.symbols,
    title: item.title,
    url: item.url,
    source: item.source,
    snippet: item.snippet,
  });
}

export function list(): StashItem[] {
  return read();
}

// only the visible "saves" (excludes agree/disagree/dismiss reactions) — for the Saved tab / stash UI.
export function saves(): StashItem[] {
  return read().filter((x) => x.kind === 'save');
}

// has the user already reacted (agree/disagree) to a prediction market this session? (dedupe)
export function reactedMarket(marketId: string): boolean {
  const id = String(marketId);
  return read().some((x) => (x.kind === 'agree' || x.kind === 'disagree') && String(x.market_id || '') === id);
}

// the user's latest thumbs reaction on a news url (drives the 👍/👎 selected state across re-renders)
export function reactionFor(url: string): 'agree' | 'disagree' | null {
  if (!url) return null;
  const items = read();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.subject_type === 'news' && it.url === url && (it.kind === 'agree' || it.kind === 'disagree')) return it.kind;
  }
  return null;
}

// latest thumbs reaction on an ASSET (story/spotlight cards have no url — the belief is
// about the asset's move itself, keyed by symbol; matches the server's asset subject_key)
export function reactionForAsset(sym: string): 'agree' | 'disagree' | null {
  const s = String(sym || '').toUpperCase();
  if (!s) return null;
  const items = read();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.subject_type === 'asset' && String(it.symbol || '').toUpperCase() === s
      && (it.kind === 'agree' || it.kind === 'disagree')) return it.kind;
  }
  return null;
}

export function remove(id: string) {
  write(read().filter((x) => x.id !== id));
}

/* ---------- asset bookmark state (drives the asset topbar's filled/outline glyph) ---------- */
export function isAssetSaved(sym: string): boolean {
  const s = String(sym || '').toUpperCase();
  return read().some((x) => x.kind === 'save' && x.subject_type === 'asset' && String(x.symbol || '').toUpperCase() === s);
}
/** toggle the asset in the user's saved list; returns the NEW saved state + fires hence:stash.
   NOTE: unsave removes the LOCAL row only. The save was synced server-side via record()→logIdea,
   but the client stores a local id (not the server idea_id), so it can't call the delete endpoint
   (op:'delete' needs the server id). The server keeps an orphaned 'save' idea + its interest bump —
   a known backend-hygiene follow-up (capture the server id on save to enable server-side unsave). */
export function toggleAssetSave(sym: string, title = ''): boolean {
  const s = String(sym || '').toUpperCase();
  const items = read();
  const existing = items.find((x) => x.kind === 'save' && x.subject_type === 'asset' && String(x.symbol || '').toUpperCase() === s);
  let saved: boolean;
  if (existing) { write(items.filter((x) => x.id !== existing.id)); saved = false; }
  else { record({ kind: 'save', subject_type: 'asset', symbol: s, title }); saved = true; }
  try { window.dispatchEvent(new CustomEvent('hence:stash')); } catch { /* noop */ }
  return saved;
}

/* ---------- taste-loop v0 ----------
   Symbols the user has thumbed-UP (kind === 'agree') recently, newest-first & deduped.
   The home news query seeds these alongside the watchlist so the feed drifts toward what
   the user actually agrees with — a first, cheap "learn my taste" signal (per the product
   note). Bounded to the last `days` and `max` symbols so it stays relevant, not over-fit. */
export function agreedSymbols(days = 14, max = 6): string[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const out: string[] = [];
  const seen = new Set<string>();
  const items = read();                       // already newest-first (unshift on insert)
  for (const it of items) {
    if (it.kind !== 'agree' || it.ts < since) continue;
    for (const s of (it.symbols && it.symbols.length ? it.symbols : it.symbol ? [it.symbol] : [])) {
      const u = String(s).toUpperCase();
      if (u && !seen.has(u)) { seen.add(u); out.push(u); if (out.length >= max) return out; }
    }
  }
  return out;
}

/* ---------- login migration: flush the queued (unsynced) rows once signed in ---------- */
let _migrating = false;
async function migrateQueue() {
  if (_migrating || !signedIn()) return;
  const pending = read().filter((x) => !x.synced);
  if (!pending.length) return;
  _migrating = true;
  try {
    const r: any = await me.migrateIdeas(pending.map(toServerItem));
    if (r && !r.error && !r.unauth) {
      const ids = new Set(pending.map((x) => x.id));
      const items = read();
      items.forEach((x) => { if (ids.has(x.id)) x.synced = true; });
      write(items);
    }
  } catch { /* leave queued */ }
  finally { _migrating = false; }
}

/* the stash is per-browser; stamp it with its owner so on a shared machine another
   account's leftover rows are dropped instead of (a) blocking the onboarding belief card
   via reactedMarket() and (b) migrating into the wrong user's idea_objects. Rows created
   anon (no stamp yet) are adopted by the first login — the intended migrate path. */
const OWNER_KEY = 'hence.stash.owner.v1';
function adoptOwner() {
  try {
    const uid = (window as any).henceMe?.id;
    if (uid == null) return;
    const prev = localStorage.getItem(OWNER_KEY);
    if (prev && prev !== String(uid)) write([]);
    localStorage.setItem(OWNER_KEY, String(uid));
  } catch { /* storage disabled */ }
}

/* ---------- login hydration: server → local, add-only ----------
   The push half always existed (record/migrate), so the SERVER has every device's rows —
   but a second device never saw them: "saved GRAB on my phone, laptop shows nothing"
   (real user report). Pull the account's ideas once per login and append the ones this
   device doesn't have, marked synced so they never re-migrate. Local rows are never
   removed here — dismissals/dedupe stay the owner-stamp and record() paths' job. */
let _pulling = false;
async function pullFromServer() {
  if (_pulling || !signedIn()) return;
  _pulling = true;
  try {
    const r: any = await me.listIdeas(200);
    const ideas: any[] = (r && r.available && Array.isArray(r.ideas)) ? r.ideas : [];
    if (!ideas.length) return;
    const items = read();
    const seen = new Set(items.map((x) => x.id));
    // secondary identity: same kind + same subject (url or key) = the same idea
    const sig = (k: string, url: string, key: string) => k + '|' + (url || '') + '|' + (key || '');
    const have = new Set(items.map((x) => sig(x.kind, x.url, x.key || '')));
    let changed = false;
    for (const it of ideas) {
      const id = String(it.client_id || it.id || '');
      const s2 = sig(it.kind, it.url || '', it.key || it.subject_key || '');
      if ((id && seen.has(id)) || have.has(s2)) continue;
      items.push({
        id: id || ('srv' + Math.random().toString(36).slice(2, 10)),
        kind: it.kind, subject_type: it.subject_type || 'asset',
        symbol: String((it.symbols || [])[0] || ''), symbols: it.symbols || [],
        title: it.title || '', url: it.url || '', source: it.source || '',
        snippet: it.snippet || undefined, market_id: it.market_id || undefined,
        key: it.key || it.subject_key || undefined, stance: it.stance || undefined,
        ts: it.created_at ? new Date(it.created_at).getTime() : Date.now(),
        synced: true,
      } as StashItem);
      seen.add(id); have.add(s2); changed = true;
    }
    if (changed) {
      items.sort((a, b) => b.ts - a.ts);
      write(items);
      try { window.dispatchEvent(new CustomEvent('hence:stash')); } catch { /* noop */ }
    }
  } catch { /* next login retries */ }
  finally { _pulling = false; }
}

// bind the login listener exactly once (module-level guard survives HMR via window flag)
if (typeof window !== 'undefined' && !(window as any).__henceStashSync) {
  (window as any).__henceStashSync = true;
  window.addEventListener('hence:me', () => { adoptOwner(); migrateQueue(); pullFromServer(); });
  // in case we loaded after login already fired
  if (signedIn()) { adoptOwner(); migrateQueue(); pullFromServer(); }
}
