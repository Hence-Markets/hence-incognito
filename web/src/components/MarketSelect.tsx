import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as poly from '../lib/polymarket.js';
import { fmtPct } from '../lib/fmt';
import { getWatch, toggleWatch as toggleWatchStore } from '../lib/watch';
import { searchMarkets } from '../lib/marketSearch';

// re-export the canonical watch helpers so existing importers (Dashboard, Terminal,
// ChipMenu) keep working while the storage/order/sync logic lives in lib/watch.ts.
export { getWatch } from '../lib/watch';
export { toggleWatch } from '../lib/watch';

function fmtVol(v: number) { if (!v) return '$0'; const a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'; return '$' + v.toFixed(0); }

// Session memory: the palette remounts on every open (it's conditionally rendered), so
// without this the tab/query/live-only reset every time — annoying when you're hopping
// between markets. Kept module-level so it survives remounts across the whole SPA session.
// liveOnly defaults ON: the explorer opens showing only markets a user can actually trade,
// so nobody lands on a read-only HIP-3 copy of a major by accident. Toggling off is remembered
// for the session — exploring the wider universe stays one click away.
const mselMemory: { tab: string; q: string; liveOnly: boolean } = { tab: 'all', q: '', liveOnly: true };

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto Perps' },
  { id: 'tradfi', label: 'TradFi Perps' },
  { id: 'pred', label: 'Predictions' },
  { id: 'watch', label: 'Watch' },
];

/* INCOGNITO: the venue badge names where the order EXECUTES, which here is always Avantis.
   It previously showed HL or XYZ, inherited from the fork — accurate about where the PRICE
   comes from and wrong about the thing a venue column is read for. Someone glancing at this
   list concluded their order went to Hyperliquid, from their own address. The price source is
   still worth saying, so it moves into the row's title where it cannot be misread as routing. */
function venueOf(_a: any) {
  return { tag: 'AVANTIS', cls: 'avantis' };
}
function fmtBig(v: number) {
  if (v == null || isNaN(v) || v <= 0) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

export function MarketSelect({ onPick, onClose }: { onPick: (s: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(mselMemory.tab);
  const [q, setQ] = useState(mselMemory.q);
  const [liveOnly, setLiveOnly] = useState(mselMemory.liveOnly);
  const [sel, setSel] = useState(0);
  const bulkRef = useRef<Record<string, any>>({});   // coin -> {oiNotional,…} | null (gave up)
  const [, bumpBulk] = useState(0);
  const [watch, setWatch] = useState<Set<string>>(() => getWatch());
  const [preds, setPreds] = useState<any[] | null>(null);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // load Polymarket prediction markets when the Predictions tab opens
  useEffect(() => {
    if (tab !== 'pred' || preds) return;
    let alive = true;
    poly.markets(40).then((ms: any[]) => { if (alive) setPreds(ms || []); }).catch(() => { if (alive) setPreds([]); });
    return () => { alive = false; };
  }, [tab, preds]);

  const predList = useMemo(() => {
    if (!preds) return null;
    const qq = q.trim().toLowerCase();
    return qq ? preds.filter((p) => (p.question || '').toLowerCase().includes(qq)) : preds;
  }, [preds, q]);

  const rows = useMemo(() => {
    if (tab === 'pred') return [];
    return searchMarkets(q, {
      world: tab === 'crypto' ? 'crypto' : tab === 'tradfi' ? 'stocks' : undefined,
      liveOnly,
      watch: tab === 'watch' ? watch : undefined,
    });
  }, [tab, q, liveOnly, watch]);

  useEffect(() => { const i = inputRef.current; if (i) { setTimeout(() => { i.focus(); i.select(); }, 20); } }, []);
  useEffect(() => { setSel(0); mselMemory.tab = tab; mselMemory.q = q; mselMemory.liveOnly = liveOnly; }, [tab, q, liveOnly]);
  // keep stars/Watch tab in sync if the list changes elsewhere (drawer, ChipMenu, login union)
  useEffect(() => { const on = () => setWatch(getWatch()); window.addEventListener('hence:watch', on); return () => window.removeEventListener('hence:watch', on); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (rows.length ? (s + 1) % rows.length : 0)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (rows.length ? (s - 1 + rows.length) % rows.length : 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const a = rows[sel]; if (a) onPick(a.sym); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [rows, sel, onPick, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.msel-row.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // Fills the Open Interest column via market.bulkStats (assetContext, chunked at 20).
  // At palette-open the proxy is briefly saturated (init candle sweep + book polling),
  // so a chunk can fail transiently — retry the still-missing coins a few times before
  // giving up, instead of nulling everything on the first burst.
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    const run = () => {
      if (!alive) return;
      const need = rows.slice(0, 120).map((a: any) => a.coin).filter((c: string) => bulkRef.current[c] === undefined);
      if (!need.length) return;
      attempts++;
      market.bulkStats(need).then((res: Record<string, any>) => {
        if (!alive) return;
        for (const c of need) if (res[c]) bulkRef.current[c] = res[c];
        const missing = need.filter((c) => bulkRef.current[c] === undefined);
        if (missing.length && attempts >= 5) for (const c of missing) bulkRef.current[c] = null; // give up
        bumpBulk((v) => v + 1);
        if (missing.length && attempts < 5) setTimeout(run, 600);
      }).catch(() => { if (alive && attempts < 5) setTimeout(run, 600); });
    };
    const id = setTimeout(run, 200); // let the open-burst settle first
    return () => { alive = false; clearTimeout(id); };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWatch = (s: string) => { toggleWatchStore(s); setWatch(getWatch()); };

  return (
    <div className="msel-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="msel" role="dialog" aria-label="Search markets">
        <div className="msel-search">
          <Icon name="search" size={16} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets, markets, venues" autoComplete="off" spellCheck={false} />
          <kbd className="msel-esc">esc</kbd>
        </div>
        <div className="msel-bar">
          <div className="msel-tabs">{TABS.map((t) => <button key={t.id} className={'msel-tab' + (t.id === tab ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
          <div className="msel-bar-r">
            <span className="msel-count">{tab === 'pred' ? (predList?.length ?? 0) : rows.length} Market{(tab === 'pred' ? predList?.length : rows.length) === 1 ? '' : 's'}</span>
            <button className={'msel-live' + (liveOnly ? ' on' : '')} onClick={() => setLiveOnly((v) => !v)}><span className="msel-live-dot" />LIVE TRADABLE ONLY</button>
          </div>
        </div>
        {tab !== 'pred' && <div className="msel-head"><span /><span>Market</span><span>Venue</span><span>Price / 24h</span><span>Open Interest</span></div>}
        <div className="msel-list" ref={listRef}>
          {!market.isReady() ? (
            <div className="msel-empty">Loading markets…</div>
          ) : tab === 'pred' ? (
            !predList ? <div className="msel-empty">Loading prediction markets…</div>
              : predList.length === 0 ? <div className="msel-empty">{q ? `No predictions match “${q}”.` : 'No prediction markets.'}</div>
                : predList.map((p: any) => (
                  <button key={p.id} className="msel-predrow" onClick={() => { onClose(); nav('/terminal/m/' + p.id); }}>
                    {p.icon ? <img className="msel-pred-ic" src={p.icon} alt="" loading="lazy" /> : <span className="msel-pred-ic msel-pred-ic--ph">◆</span>}
                    <span className="msel-pred-q">{p.question}</span>
                    <span className="msel-pred-vol">{fmtVol(p.volume24hr)}</span>
                    <span className={`msel-pred-prob ${(p.yes || 0) >= 0.5 ? 'up' : 'down'}`}>{Math.round((p.yes || 0) * 100)}%<small>Yes</small></span>
                  </button>
                ))
          ) : rows.length === 0 ? (
            <div className="msel-empty">{tab === 'watch' ? 'No watched markets yet — tap the bookmark on any market to add it.' : `No markets match “${q}”.`}</div>
          ) : (
            rows.map((a: any, i: number) => {
              const t = getTicker(a.sym); const up = (t.chgPct || 0) >= 0; const v = venueOf(a); const bd = bulkRef.current[a.coin];
              return (
                <button key={a.coin} className={'msel-row' + (i === sel ? ' on' : '')} onMouseMove={() => i !== sel && setSel(i)} onClick={() => onPick(a.sym)}>
                  <span className={'msel-star' + (watch.has(a.sym) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggleWatch(a.sym); }}><Icon name="bookmark" size={13} /></span>
                  <span className="msel-asset"><Logo sym={a.sym} size={26} /><span className="msel-asset-t"><span className="msel-sym">{a.sym}<span className="msel-perp">PERP</span></span><span className="msel-name">{a.name || a.sym}</span></span></span>
                  <span className="msel-tags"><span className={'msel-venue msel-venue--' + v.cls}
                      title="Executes on Avantis (Base). Price shown is a reference feed — Avantis is oracle-priced.">{v.tag}</span>{a.maxLev ? <span className="msel-lev">{a.maxLev}x</span> : null}</span>
                  <span className="msel-price"><b>{market.fmtPrice(t.price)}</b><span className={up ? 'up' : 'down'}>{fmtPct(t.chgPct)}</span></span>
                  <span className="msel-oi">{bd ? fmtBig(bd.oiNotional) : bd === null ? '—' : <span className="msel-skel" />}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="msel-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span><span className="msel-foot-r">Powered by Hydromancer · live perp data</span></div>
      </div>
    </div>
  );
}
