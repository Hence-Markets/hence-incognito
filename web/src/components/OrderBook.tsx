import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import * as market from '../lib/market.js';
import { getTicker } from '../lib/data.js';
import { fmtBookPx, fmtSz, compact, type Book } from '../lib/fmt';
import type { StreamStatus, TradeMsg } from '../lib/stream';

type Trade = { px: number; sz: number; side: 'buy' | 'sell'; time: number };
const hhmmss = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Data the Terminal streams down from its single /api/stream connection (see stream.ts).
// book/trades are null until the stream delivers them (HIP-3 coins may never — the hub's
// public-venue pollers can't see them), so both panes keep their polling as a fallback.
export type LiveFeed = { book: Book | null; trades: TradeMsg[] | null; status: StreamStatus };

// Real L2 book, stream-first: rendered from the `live` prop while the Terminal's SSE stream
// is delivering it; the old 1.8s l2Book poll runs ONLY as a fallback (stream connecting/down,
// or a coin the hub can't stream). If both live paths are unavailable, show an explicit
// empty state; a fabricated depth ladder is unsafe beside an executable order ticket.
// Asks shown high→low above the spread, bids below. A Trades tab shows the live fills tape.
const BOOK_RAIL = 36;

export function OrderBook({ sym, resizer, live, enabled = true }: { sym: string; resizer?: React.ReactNode; live?: LiveFeed; enabled?: boolean }) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');

  // Collapsible column, news-rail pattern. The column width is the grid's --c-book var
  // on the .term ancestor, so collapse/expand mutates it there; the pre-collapse width is
  // remembered for restore. Mount-apply runs in a timeout so it lands AFTER the terminal's
  // own layout-restore effect (which would otherwise overwrite the rail width).
  const asideRef = useRef<HTMLElement>(null);
  const prevW = useRef('');
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem('hence.term.bookCollapsed') === '1'; } catch { return false; } });
  const applyVar = (c: boolean) => {
    const term = asideRef.current?.closest('.term') as HTMLElement | null;
    if (!term) return;
    if (c) {
      const cur = (term.style.getPropertyValue('--c-book') || '').trim();
      if (cur && cur !== BOOK_RAIL + 'px') prevW.current = cur;
      term.style.setProperty('--c-book', BOOK_RAIL + 'px');
    } else if (prevW.current) {
      term.style.setProperty('--c-book', prevW.current);
    } else {
      term.style.removeProperty('--c-book');
    }
  };
  useEffect(() => {
    if (!collapsed) return;
    const t = window.setTimeout(() => applyVar(true), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    applyVar(next);
    try { localStorage.setItem('hence.term.bookCollapsed', next ? '1' : ''); } catch { /* storage off */ }
  };
  const [book, setBook] = useState<Book | null>(null);
  const [bookSym, setBookSym] = useState('');

  const streamLive = live?.status === 'live';
  const liveBook = streamLive && live?.book && live.book.bids && live.book.bids.length ? live.book : null;
  const hasLiveBook = !!liveBook;

  // fallback poll — only while the stream isn't feeding the book. The short first-fetch
  // delay lets the stream's instant cached seed win the race on mount/pair-switch, so a
  // healthy stream produces ZERO l2Book polls.
  useEffect(() => {
    if (!enabled) { setBook(null); setBookSym(''); return; }
    if (hasLiveBook) return;
    let alive = true;
    setBook(null); // never carry the previous market's depth into a new symbol
    const load = async () => {
      const b = await market.orderBook(sym).catch(() => null);
      if (alive && b && b.bids && b.bids.length) { setBook(b); setBookSym(sym); }
    };
    const t0 = window.setTimeout(load, live ? 700 : 0);
    const id = window.setInterval(load, 1800);
    return () => { alive = false; window.clearTimeout(t0); window.clearInterval(id); };
  }, [sym, hasLiveBook, !!live, enabled]);

  const t = getTicker(sym);
  const polled = bookSym === sym && book && book.bids && book.bids.length ? book : null;
  const real = liveBook || polled;
  const mid = real ? (real.bids[0].px + real.asks[0].px) / 2 : t.price;
  // render deep enough to fill a tall column (trade.xyz-style); the body scrolls if shorter
  const asks = (real?.asks || []).slice(0, 18);
  const bids = (real?.bids || []).slice(0, 18);
  const max = Math.max(0.0001, ...asks.map((r) => r.sz), ...bids.map((r) => r.sz));
  const bestAsk = asks[0] ? asks[0].px : mid;
  const bestBid = bids[0] ? bids[0].px : mid;
  const spreadBps = mid ? ((bestAsk - bestBid) / mid) * 10000 : 0;

  const Row = ({ r, side }: { r: { px: number; sz: number }; side: 'ask' | 'bid' }) => (
    <div className={`term__book-row term__book-${side}`} style={{ ['--d' as any]: `${(r.sz / max) * 100}%` }}>
      <span className="term__book-p">{fmtBookPx(r.px)}</span>
      <span>{fmtSz(r.sz)}</span>
      <span className="term__book-u">${compact(r.px * r.sz)}</span>
    </div>
  );

  return (
    <aside ref={asideRef} className={'term__book' + (collapsed ? ' is-collapsed' : '')}>
      {!collapsed && resizer}
      {/* collapsed rail — mirrors the news rail (vertical label, click to expand) */}
      <button className="term__book-railbtn" onClick={toggleCollapsed} title="Expand order book">
        <Icon name="back" size={13} />
        <span className="term__book-rail-l">Order Book</span>
      </button>
      <div className="term__book-full">
        <div className="term__book-tabs">
          <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>Order Book</button>
          <button className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trades</button>
          <button className="term__book-cfg" title="Collapse" onClick={toggleCollapsed}><Icon name="chevR" size={13} /></button>
        </div>
        {tab === 'book' ? (
          <>
            <div className="term__book-head"><span>Price</span><span>Size</span><span>Total</span></div>
            <div className="term__book-body">
              {!real ? (
                <div className="term__book-empty">Live order book unavailable</div>
              ) : (
                <>
                  {asks.slice().reverse().map((r, i) => <Row key={`a${i}`} r={r} side="ask" />)}
                  <div className="term__book-spread"><span>{fmtBookPx(mid)}</span><span>Spread {spreadBps.toFixed(2)} bps</span></div>
                  {bids.map((r, i) => <Row key={`b${i}`} r={r} side="bid" />)}
                </>
              )}
            </div>
          </>
        ) : (
          <TradesTape sym={sym} active={enabled && tab === 'trades'} live={enabled && streamLive ? live?.trades ?? null : null} />
        )}
      </div>
    </aside>
  );
}

// Live recent-fills tape. Stream-first: when the Terminal's stream delivers trades (already
// accumulated snapshot+deltas, newest first) they render directly — genuinely live fills.
// The old 2s recentTrades poll runs ONLY while the stream isn't delivering (and only while
// the Trades tab is active, so it never double-polls alongside the book).
// Side-tinted rows whose width scales with size.
function TradesTape({ sym, active, live }: { sym: string; active: boolean; live: Trade[] | null }) {
  const [polled, setPolled] = useState<Trade[] | null>(null);
  const [polledSym, setPolledSym] = useState('');
  const hasLive = live !== null; // [] is a valid stream answer ("no fills"), null = not delivering

  useEffect(() => {
    if (!active || hasLive) return;
    let alive = true;
    setPolled(null);
    const load = async () => {
      const r = await market.recentTrades(sym).catch(() => [] as Trade[]);
      if (alive) { setPolled(r as Trade[]); setPolledSym(sym); }
    };
    const t0 = window.setTimeout(load, 500); // grace: the stream's cached seed usually lands first
    const id = window.setInterval(load, 2000);
    return () => { alive = false; window.clearTimeout(t0); window.clearInterval(id); };
  }, [sym, active, hasLive]);

  const trades = !active ? null : hasLive ? live : polledSym === sym ? polled : null;
  const maxSz = trades && trades.length ? Math.max(0.0001, ...trades.map((t) => t.sz)) : 1;

  return (
    <>
      <div className="term__book-head term__trades-head"><span>Time</span><span>Price</span><span>Size ({sym})</span></div>
      <div className="term__book-body">
        {trades === null ? (
          <div className="term__book-empty">Loading trades…</div>
        ) : trades.length === 0 ? (
          <div className="term__book-empty">No recent trades</div>
        ) : trades.map((tr, i) => (
          <div key={i} className={`term__trade-row term__trade-${tr.side}`} style={{ ['--d' as any]: `${(tr.sz / maxSz) * 100}%` }}>
            <span className="term__trade-t">{hhmmss(tr.time)}</span>
            <span className="term__trade-p">{fmtBookPx(tr.px)}</span>
            <span className="term__trade-s">{fmtSz(tr.sz)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
