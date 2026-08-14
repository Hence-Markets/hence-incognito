/* =========================================================
   WatchlistPanel — the REAL per-user watchlist drawer (Fey-complete).

   Tabs: Holdings | Watchlist.
   Four top-right icon buttons (Fey anatomy):
     [+]        add — opens the in-panel "Search symbols" overlay (HIDDEN on Holdings)
     [list]     create a new named list → inline "New list" input
     [sort]     re-rank rows by 1-day % descending (toggles manual ↔ by-returns)
     [expand]   open the full Portfolio page (#/watchlist)

   Watchlist body: custom lists first (X-to-delete on hover, "Add stocks" placeholder
   when empty), then the default "Stocks" section. Rows = logo · bold TICKER · price ·
   signed 1-day $chg · %pill. Symbols with no real ticker show a dim "—" price.

   Holdings body: the shared <HoldingsView compact/> (real Hyperliquid positions or a
   connect empty state).
   ========================================================= */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { HoldingsView } from './HoldingsView';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import { fmtPct, cls, fmtChg } from '../lib/ui.js';
import { useWatchlist } from '../hooks/useWatchlist';
import {
  customLists, createList, deleteList, stocksSection,
  toggleWatch, type WatchList,
} from '../lib/watch';
import { searchMarkets, popularMarkets } from '../lib/marketSearch';

/* an asset is "real" only when Hydromancer has loaded live data for it */
function isReal(sym: string) {
  try { return market.isReady() && !!(getTicker(sym) as any).real; } catch { return false; }
}

function WlRow({ sym, onClose }: { sym: string; onClose?: () => void }) {
  const t = getTicker(sym);
  const real = isReal(sym);
  const call = sym === 'NVDA'; // earnings-call glyph parity (Fey shows a phone/bell on reporting names)
  return (
    <a className="wl-row" href={`#/stock/${sym}`} onClick={() => onClose?.()}>
      <Logo sym={sym} size={22} />
      <span className="wl-tk">{sym}{call ? <span className="wl-call"><Icon name="bell" size={11} /></span> : null}</span>
      {real ? (
        <>
          <span className="wl-px">{market.fmtPrice(t.price)}</span>
          <span className={`wl-d ${cls(t.chg)}`}>{fmtChg(t.chg)}</span>
          <span className={`pill ${cls(t.chgPct)}`}>{fmtPct(t.chgPct)}</span>
        </>
      ) : (
        <>
          <span className="wl-px wl-px--dim">—</span>
          <span className="wl-d" />
          <span className="pill wl-pill--dim">—</span>
        </>
      )}
    </a>
  );
}

/* ---------- in-panel "Search symbols" overlay (Fey #112–114) ---------- */
function SearchOverlay({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('');
  const { symbols, has } = useWatchlist();
  void symbols; // re-render on watch changes so bookmark toggles reflect immediately

  const results = useMemo(() => {
    if (!q.trim()) return null;
    return searchMarkets(q, { limit: 40 });
  }, [q, symbols]);

  const popular = useMemo(() => popularMarkets(14), [market.isReady()]);
  // "Recent" = the most-recently-added watch symbols (top of the ordered list), max 4
  const recent = symbols.slice(0, 4);

  const Row = ({ a }: { a: any }) => {
    const on = has(a.sym);
    return (
      <button className="wl-sr-row" onClick={() => toggleWatch(a.sym)}>
        <Logo sym={a.sym} size={24} />
        <span className="wl-sr-id"><b>{a.sym}</b><small>{a.name || a.sym}</small></span>
        <span className={'wl-sr-bm' + (on ? ' on' : '')}><Icon name="bookmark" size={14} /></span>
      </button>
    );
  };
  const SymRow = ({ sym }: { sym: string }) => {
    const on = has(sym);
    return (
      <button className="wl-sr-row" onClick={() => toggleWatch(sym)}>
        <Logo sym={sym} size={24} />
        <span className="wl-sr-id"><b>{sym}</b><small>{getTicker(sym).name}</small></span>
        <span className={'wl-sr-bm' + (on ? ' on' : '')}><Icon name="bookmark" size={14} /></span>
      </button>
    );
  };

  return (
    <div className="wl-search-ov">
      <div className="wl-search-top">
        <span className="wl-search-in"><Icon name="search" size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbols" spellCheck={false} autoComplete="off" /></span>
        <button className="wl-search-done" onClick={onDone}>Done</button>
      </div>
      <div className="wl-search-body">
        {results ? (
          <div className="wl-sr-sec">
            <div className="wl-sr-cap">Results</div>
            {results.length ? results.map((a) => <Row key={a.coin || a.sym} a={a} />) : <div className="wl-sr-empty">No markets match “{q}”.</div>}
          </div>
        ) : (
          <>
            {recent.length ? (
              <div className="wl-sr-sec">
                <div className="wl-sr-cap">Recent</div>
                {recent.map((s) => <SymRow key={s} sym={s} />)}
              </div>
            ) : null}
            <div className="wl-sr-sec">
              <div className="wl-sr-cap">Popular</div>
              {popular.map((a) => <Row key={a.coin || a.sym} a={a} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- a watchlist section (custom list or default Stocks) ---------- */
function Section({ list, syms, onClose, sortByRet }: { list?: WatchList; syms: string[]; onClose?: () => void; sortByRet: boolean }) {
  const ordered = useMemo(() => {
    if (!sortByRet) return syms;
    return syms.slice().sort((a, b) => (getTicker(b).chgPct || 0) - (getTicker(a).chgPct || 0));
  }, [syms, sortByRet]);

  return (
    <div className="wl-section">
      <div className={'wl-cap' + (list ? ' wl-cap--list' : '')}>
        <span>{list ? list.name : 'Stocks'}</span>
        <span className="wl-cap-r">1-day returns</span>
        {list ? <button className="wl-cap-x" aria-label={`Delete ${list.name}`} onClick={() => deleteList(list.name)}><Icon name="close" size={12} /></button> : null}
      </div>
      {ordered.length
        ? ordered.map((s) => <WlRow key={s} sym={s} onClose={onClose} />)
        : <div className="wl-add-ph"><Icon name="bookmark" size={13} /><span>Add stocks</span></div>}
    </div>
  );
}

export function WatchlistPanel({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<'Holdings' | 'Watchlist'>('Watchlist');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [sortByRet, setSortByRet] = useState(false);
  const { symbols } = useWatchlist();

  // re-derive sections whenever the watchlist or custom lists change
  const [lists, setLists] = useState<WatchList[]>(() => customLists());
  useEffect(() => { setLists(customLists()); }, [symbols]);
  useEffect(() => {
    const on = () => setLists(customLists());
    window.addEventListener('hence:watch', on);
    return () => window.removeEventListener('hence:watch', on);
  }, []);

  const stocks = useMemo(() => stocksSection(), [symbols, lists]);

  const commitNew = () => {
    const nm = newName.trim();
    if (nm) createList(nm);
    setNewName(''); setCreating(false);
  };

  return (
    <aside className="wl-panel">
      <div className="wl-head">
        <div className="wl-tabs">
          <span className={tab === 'Holdings' ? 'on' : ''} onClick={() => { setTab('Holdings'); setSearching(false); }}>Holdings</span>
          <span className={tab === 'Watchlist' ? 'on' : ''} onClick={() => setTab('Watchlist')}>Watchlist</span>
        </div>
        <div className="wl-tools">
          {tab === 'Watchlist' && <button className="icon-btn" title="Add symbols" onClick={() => setSearching(true)}><Icon name="plus" size={14} /></button>}
          {tab === 'Watchlist' && <button className="icon-btn" title="New list" onClick={() => setCreating((v) => !v)}><Icon name="list" size={14} /></button>}
          {tab === 'Watchlist' && <button className={'icon-btn' + (sortByRet ? ' on' : '')} title="Sort by returns" onClick={() => setSortByRet((v) => !v)}><Icon name="sliders" size={14} /></button>}
          <a className="icon-btn" title="Expand" href="#/watchlist" onClick={() => onClose?.()}><Icon name="grid" size={14} /></a>
        </div>
      </div>

      {tab === 'Holdings' ? (
        <HoldingsView compact />
      ) : searching ? (
        <SearchOverlay onDone={() => setSearching(false)} />
      ) : (
        <>
          {creating && (
            <div className="wl-newlist">
              <input autoFocus value={newName} placeholder="New list" spellCheck={false}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitNew(); if (e.key === 'Escape') { setNewName(''); setCreating(false); } }} />
              <button className="wl-newlist-cancel" onClick={() => { setNewName(''); setCreating(false); }}>Cancel</button>
            </div>
          )}
          <div className="wl-body">
            {lists.map((l) => <Section key={l.name} list={l} syms={l.symbols} onClose={onClose} sortByRet={sortByRet} />)}
            <Section syms={stocks} onClose={onClose} sortByRet={sortByRet} />
            {!symbols.length && !lists.length ? (
              <div className="wl-none">Your watchlist is empty. Tap <Icon name="plus" size={12} /> to search and add symbols.</div>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}
