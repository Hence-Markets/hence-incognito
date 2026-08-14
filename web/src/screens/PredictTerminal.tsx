/* =========================================================================
   PredictBody — prediction markets as a first-class MODE of the unified terminal.
   Rendered by Terminal.tsx inside the shared <Shell> (so the dock + chrome stay
   mounted while you morph between perp and prediction markets). Instrument-aware:
   a YES/NO ticket, a probability chart, YES/NO order book, related-markets panel,
   a scrolling market tape, and a real "your bets" positions table. Addressed by
   market id (#/terminal/m/:id). Real execution reuses the CLOB-v2 path
   (PmTradePanel, hence.pmtrade flag).
   ========================================================================= */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/terminal.css';
import '../styles/predict-terminal.css';
import { Icon } from '../components/Icon';
import { ScreenHead } from '../components/ScreenHead';
import { ProbabilityChart } from '../components/ProbabilityChart';
import { PanelLoader, Skeleton } from '../components/Loading';
import { MarketSelect } from '../components/MarketSelect';
import { PmTradePanel, pmTradeEnabled } from '../components/PmTradePanel';
import { AccountPanel } from '../components/TerminalAccount';
import { geoblock as pmGeoblock } from '../lib/polymarket-trade';
import { toast } from '../lib/ui.js';
import { useAuth } from '../hooks/useAuth';
import { useTerminalLayout, type PanelCfg } from '../hooks/useTerminalLayout';
import * as poly from '../lib/polymarket.js';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const cents = (p: number) => `${(p * 100).toFixed(1)}¢`;
const fmtBig = (v: number) => { if (!v) return '$0'; const a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'; return '$' + v.toFixed(0); };
const fmtShares = (v: number) => { if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return v.toFixed(0); };
const fmtUsd = (v: number) => '$' + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function resolvesIn(s?: string) {
  if (!s) return '—';
  const ms = new Date(s).getTime() - Date.now();
  if (!isFinite(ms)) return '—';
  // a past endDate does NOT mean resolved — PM keeps plenty of markets trading past
  // their nominal date (acceptingOrders stays true); "resolved" here was a mislabel
  if (ms <= 0) return 'past end date';
  const d = Math.floor(ms / 86400000); if (d >= 1) return `${d}d`;
  const h = Math.floor(ms / 3600000); if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}
function timeAgo(sec?: number) {
  if (!sec) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function fmtDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
// split a market description into paragraphs and linkify bare URLs (resolution sources)
function descParts(text: string): { type: 'text' | 'link'; v: string }[][] {
  return String(text || '').split(/\n\s*\n/).filter((p) => p.trim()).map((para) =>
    para.split(/(https?:\/\/[^\s)]+)/g).filter(Boolean).map((seg) =>
      /^https?:\/\//.test(seg) ? { type: 'link' as const, v: seg } : { type: 'text' as const, v: seg }));
}

const PANELS: Record<string, PanelCfg> = {
  rel:    { v: '--c-news',   def: 240, min: 170, max: 420, sign: 1,  axis: 'x' },
  book:   { v: '--c-book',   def: 234, min: 180, max: 380, sign: -1, axis: 'x' },
  entry:  { v: '--c-entry',  def: 300, min: 250, max: 460, sign: -1, axis: 'x' },
  bottom: { v: '--r-bottom', def: 200, min: 110, max: 520, sign: -1, axis: 'y' },
};
const M_TABS = ['Markets', 'Trade', 'Account'];
const TFS: { k: string; i: string }[] = [
  { k: '1H', i: '1h' }, { k: '6H', i: '6h' }, { k: '1D', i: '1d' }, { k: '1W', i: '1w' }, { k: 'ALL', i: 'max' },
];

export function PredictBody({ id }: { id: string }) {
  const nav = useNavigate();
  const auth = useAuth();
  const L = useTerminalLayout('hence.predictlayout.v1', PANELS);

  // collapsible side panels (news-rail pattern, persisted in the layout store)
  const REL_RAIL = 36;
  const readFlag = (k: string) => { try { return !!JSON.parse(localStorage.getItem('hence.predictlayout.v1') || '{}')[k]; } catch { return false; } };
  const [relCollapsed, setRelCollapsed] = useState<boolean>(() => readFlag('relCollapsed'));
  const [bookCollapsed, setBookCollapsed] = useState<boolean>(() => readFlag('bookCollapsed'));
  useEffect(() => {
    // apply AFTER the hook's own size-restore effect so the rail width wins
    const t = window.setTimeout(() => {
      if (relCollapsed) L.setVar('--c-news', REL_RAIL);
      if (bookCollapsed) L.setVar('--c-book', REL_RAIL);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleRel = () => {
    const next = !relCollapsed;
    setRelCollapsed(next);
    L.setVar('--c-news', next ? REL_RAIL : (L.sizesRef.current.rel ?? PANELS.rel.def));
    L.persist({ relCollapsed: next });
  };
  const toggleBook = () => {
    const next = !bookCollapsed;
    setBookCollapsed(next);
    L.setVar('--c-book', next ? REL_RAIL : (L.sizesRef.current.book ?? PANELS.book.def));
    L.persist({ bookCollapsed: next });
  };

  const [m, setM] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [hist, setHist] = useState<any[] | null>(null);
  const [related, setRelated] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[] | null>(null);   // null = first load (skeleton), [] = genuinely none
  const [side, setSide] = useState<'Yes' | 'No'>('Yes');
  const [otype, setOtype] = useState<'Market' | 'Limit'>('Market');
  const [amount, setAmount] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [tf, setTf] = useState('1W');
  const [view, setView] = useState<'chart' | 'desc'>('chart');   // center panel: chart ⇄ description
  const [booktab, setBooktab] = useState<'book' | 'trades'>('book');
  const [mtab, setMtab] = useState('Trade');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [pmFlag] = useState(pmTradeEnabled);

  // market by id (deep-linkable) — reset market-scoped state so a new market never
  // renders with the previous one's chart history (book/trades reset via their own effects)
  useEffect(() => {
    let alive = true; setM(null); setHist(null);
    poly.market(id).then((x: any) => { if (alive) setM(x); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const tokenYes = m?.tokenYes;
  const tokenFor = side === 'Yes' ? m?.tokenYes : m?.tokenNo;

  // live order book for the chosen outcome (4s poll — matches the perp book cadence)
  useEffect(() => {
    if (!tokenFor) { setBook(null); return; }
    let alive = true;
    const load = () => poly.book(tokenFor).then((b: any) => { if (alive && b) setBook(b); }).catch(() => {});
    load(); const t = window.setInterval(load, 4000);
    return () => { alive = false; window.clearInterval(t); };
  }, [tokenFor]);

  // live public trades for this market (data-api, 5s poll) — the "Trades" tape
  useEffect(() => {
    const cond = m?.conditionId;
    if (!cond) { setTrades([]); return; }
    let alive = true;
    const load = () => poly.trades(cond, 50).then((t: any[]) => { if (alive) setTrades(t || []); }).catch(() => {});
    load(); const t = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [m?.conditionId]);

  // probability history for the selected timeframe (null while (re)loading → chart shows a
  // loader and can't display the prior timeframe's curve)
  useEffect(() => {
    if (!tokenYes) return;
    let alive = true;
    setHist(null);
    const i = TFS.find((x) => x.k === tf)?.i || '1w';
    poly.priceHistory(tokenYes, i).then((h: any) => { if (alive) setHist(h?.history || []); }).catch(() => { if (alive) setHist([]); });
    return () => { alive = false; };
  }, [tokenYes, tf]);

  // related markets (same category, else top by volume) for the left panel,
  // plus the scrolling tape (top by volume, category-agnostic — always lively)
  useEffect(() => {
    let alive = true;
    poly.markets(40).then((list: any[]) => {
      if (!alive) return;
      const cur = m?.id ?? id;
      const others = list.filter((x) => x.id !== cur);
      setTrending(others.slice(0, 20));
      const cat = m?.category;
      const rel = others.filter((x) => !cat || x.category === cat);
      setRelated((rel.length ? rel : others).slice(0, 14));
    }).catch(() => {});
    return () => { alive = false; };
  }, [id, m?.id, m?.category]);

  // ⌘K / Ctrl+K opens the market palette (parity with the perp terminal)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // the user's Polymarket positions (public data-api) — the "your bets" table
  useEffect(() => {
    if (!auth.address) { setPositions([]); return; }
    let alive = true;
    const load = () => poly.positions(auth.address).then((p: any[]) => { if (alive) setPositions(p || []); }).catch(() => {});
    load(); const t = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(t); };
  }, [auth.address]);

  const yesP = m?.yes ?? 0;
  const noP = m?.no ?? 1 - yesP;
  const curP = side === 'Yes' ? yesP : noP;
  const asks = (book?.asks || []).slice().sort((a: any, b: any) => a.px - b.px);
  const bids = (book?.bids || []).slice().sort((a: any, b: any) => b.px - a.px);
  const bestAsk = asks[0]?.px || curP;
  const limitPx = Math.min(0.999, Math.max(0.001, (parseFloat(limitInput) || 0) / 100));   // ¢ input → 0–1
  const execPx = otype === 'Limit' && limitPx > 0.001 ? limitPx : bestAsk;
  const amt = parseFloat(amount) || 0;
  const shares = execPx > 0 ? amt / execPx : 0;
  const maxPayout = shares;                 // each winning share settles at $1
  const toWin = maxPayout - amt;
  const portfolio = (positions || []).reduce((s, p) => s + (p.value || 0), 0);
  const totalPnl = (positions || []).reduce((s, p) => s + (p.pnl || 0), 0);
  const posLoading = auth.authenticated && positions === null;   // first fetch in flight

  const submit = async () => {
    if (!amt) { toast('Enter an amount', { icon: 'card' }); return; }
    if (otype === 'Limit' && !(limitPx > 0.001)) { toast('Set a limit price in ¢', { icon: 'card' }); return; }
    if (pmFlag) {
      // Polymarket's own per-IP verdict (their builder guidance) — restricted regions get
      // an honest read-only message instead of an execution path that PM would reject.
      const geo = await pmGeoblock().catch(() => null);
      if (geo?.blocked) {
        toast('Live prediction trading isn’t available in your region — markets stay fully viewable.', { icon: 'info', duration: 3600 });
        return;
      }
      setPmOpen(true); return;
    }
    toast(`${otype === 'Limit' ? 'Limit ' : ''}Buy ${side} @ ${cents(execPx)} simulated — enable live trading to place it`, { icon: 'check' });
  };

  const maxBookSz = Math.max(0.0001, ...asks.slice(0, 9).map((r: any) => r.sz), ...bids.slice(0, 9).map((r: any) => r.sz));
  const BookRow = ({ r, sd }: { r: any; sd: 'ask' | 'bid' }) => (
    <div className={`pt-book-row pt-book-${sd}`} style={{ ['--d' as any]: `${(r.sz / maxBookSz) * 100}%` }}
      onClick={() => { setOtype('Limit'); setLimitInput((r.px * 100).toFixed(1)); }} title="Click to set limit price">
      <span className={sd === 'ask' ? 'down' : 'up'}>{cents(r.px)}</span><span>{fmtShares(r.sz)}</span><span className="muted">{fmtBig(r.px * r.sz)}</span>
    </div>
  );

  if (!m) {
    return (
      <div className="term term--pred">
        <ScreenHead title="Terminal" context="Prediction" />
        <PanelLoader label="Loading market…" fill />
      </div>
    );
  }
  const ctx = m.question.length > 46 ? m.question.slice(0, 46) + '…' : m.question;

  return (
    <>
      <div className="term term--pred" data-mtab={mtab} ref={L.termRef}>
        <ScreenHead title="Terminal" context={ctx} />
        {/* fav / trending bar */}
        <div className="term__fav">
          <span className="term__fav-star"><Icon name="bolt" size={13} /></span>
          {related.slice(0, 6).map((r) => {
            const u = (r.yes ?? 0) >= 0.5;
            return <button key={r.id} className="term__fav-i pt-fav-i" onClick={() => nav('/terminal/m/' + r.id)} title={r.question}>
              <span className="pt-fav-q">{r.question}</span> <span className={u ? 'up' : 'down'}>{pct(r.yes ?? 0)}</span>
            </button>;
          })}
          <button className="term__fav-cta" onClick={() => setPaletteOpen(true)}>Search markets <kbd>⌘K</kbd></button>
        </div>

        {/* scrolling market tape (trade.xyz anatomy) — trending prediction markets */}
        <PredTape items={trending} nav={nav} />

        {/* mobile section switcher */}
        <div className="term__mtabs">{M_TABS.map((tb) => <button key={tb} className={tb === mtab ? 'on' : ''} onClick={() => setMtab(tb)}>{tb}</button>)}</div>

        <div className="term__grid">
          {/* related markets (left) */}
          <aside className={'term__news' + (relCollapsed ? ' is-collapsed' : '')}>
            {!relCollapsed && L.rsz('rel', 'r')}
            <button className="term__news-rail" onClick={toggleRel} title="Expand related markets">
              <Icon name="chevR" size={13} />
              <span className="term__news-rail-l">Related</span>
            </button>
            <div className="term__news-full">
              <div className="term__news-h"><span className="term__news-h-l">Related markets</span>
                <button className="term__news-collapse" onClick={toggleRel} title="Collapse"><Icon name="back" size={14} /></button></div>
              <div className="term__news-list">
                {related.length === 0 ? <div className="term__news-loading">Loading markets…</div> : related.map((r) => {
                  const u = (r.yes ?? 0) >= 0.5;
                  return (
                    <button className={'pt-rel' + (r.id === m.id ? ' on' : '')} key={r.id} onClick={() => nav('/terminal/m/' + r.id)} title={r.question}>
                      {r.icon ? <img className="pt-rel-ic" src={r.icon} alt="" loading="lazy" /> : <span className="pt-rel-ic pt-rel-ic--ph">◆</span>}
                      <span className="pt-rel-body">
                        <span className="pt-rel-q">{r.question}</span>
                        <span className="pt-rel-meta"><span className={'pt-rel-p ' + (u ? 'up' : 'down')}>{pct(r.yes ?? 0)}</span><span className="pt-rel-v">{fmtBig(r.volume24hr)}</span></span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="term__news-foot">Polymarket · live odds</div>
            </div>
          </aside>

          {/* chart + market header (center) */}
          <section className="term__chart">
            <div className="term__chart-top">
              <button className="term__pair pt-pair" onClick={() => setPaletteOpen(true)} title={m.question}>
                {m.icon ? <img className="pt-pair-ic" src={m.icon} alt="" /> : <span className="pt-pair-ic pt-pair-ic--ph">◆</span>}
                <b className="pt-pair-q">{m.question}</b><Icon name="chevDown" size={14} />
              </button>
              <span className={'term__price ' + (yesP >= 0.5 ? 'up' : 'down')}>{cents(yesP)}</span>
              <div className="term__stats">
                <div className="term__stat"><span>Yes / No</span><b>{pct(yesP)} / {pct(noP)}</b></div>
                <div className="term__stat"><span>Resolves in</span><b>{resolvesIn(m.endDate)}</b></div>
                <div className="term__stat"><span>24H Volume</span><b>{fmtBig(m.volume24hr)}</b></div>
                <div className="term__stat"><span>Liquidity</span><b>{fmtBig(m.liquidity)}</b></div>
              </div>
            </div>
            <div className="term__chart-toolbar">
              {view === 'chart' ? (
                <>
                  <div className="term__tf">{TFS.map((x) => <button key={x.k} className={x.k === tf ? 'on' : ''} onClick={() => setTf(x.k)}>{x.k}</button>)}</div>
                  <div className="pt-outcomes">
                    <button className={'pt-out pt-out--yes' + (side === 'Yes' ? ' on' : '')} onClick={() => setSide('Yes')}>Yes {pct(yesP)}</button>
                    <button className={'pt-out pt-out--no' + (side === 'No' ? ' on' : '')} onClick={() => setSide('No')}>No {pct(noP)}</button>
                  </div>
                </>
              ) : <span className="pt-view-title">Resolution &amp; details</span>}
              <div className="pt-view-tabs">
                <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Chart</button>
                <button className={view === 'desc' ? 'on' : ''} onClick={() => setView('desc')}>Description</button>
              </div>
            </div>
            {view === 'chart' ? (
              <div className="pt-chart-wrap">
                <ProbabilityChart data={hist as any} up={yesP >= 0.5} resetKey={`${id}:${tf}`} />
              </div>
            ) : (
              <div className="pt-desc-view">
                <div className="pt-desc-meta">
                  <div className="pt-desc-metric"><span>Ends</span><b>{fmtDate(m.endDate)}</b></div>
                  <div className="pt-desc-metric"><span>Resolves in</span><b>{resolvesIn(m.endDate)}</b></div>
                  <div className="pt-desc-metric"><span>24H Volume</span><b>{fmtBig(m.volume24hr)}</b></div>
                  <div className="pt-desc-metric"><span>Liquidity</span><b>{fmtBig(m.liquidity)}</b></div>
                </div>
                <h4 className="pt-desc-h">Resolution</h4>
                {m.description ? (
                  <div className="pt-desc-body">
                    {descParts(m.description).map((para, i) => (
                      <p key={i}>{para.map((seg, j) => seg.type === 'link'
                        ? <a key={j} href={seg.v} target="_blank" rel="noopener noreferrer">{seg.v}</a>
                        : <span key={j}>{seg.v}</span>)}</p>
                    ))}
                  </div>
                ) : <p className="pt-desc-body pt-desc-empty">No description provided for this market.</p>}
              </div>
            )}
          </section>

          {/* YES/NO order book + live trades tape */}
          <aside className={'term__book pt-book' + (bookCollapsed ? ' is-collapsed' : '')}>
            {!bookCollapsed && L.rsz('book', 'l')}
            <button className="term__book-railbtn" onClick={toggleBook} title="Expand order book">
              <Icon name="back" size={13} />
              <span className="term__book-rail-l">Order Book</span>
            </button>
            <div className="term__book-full">
            <div className="pt-book-tabs">
              <button className={booktab === 'book' ? 'on' : ''} onClick={() => setBooktab('book')}>Order book <span className="muted">· {side}</span></button>
              <button className={booktab === 'trades' ? 'on' : ''} onClick={() => setBooktab('trades')}>Trades</button>
              <button className="term__book-cfg" title="Collapse" onClick={toggleBook}><Icon name="chevR" size={13} /></button>
            </div>
            {booktab === 'book' ? (
              <>
                <div className="pt-book-head"><span>Price</span><span>Shares</span><span>Value</span></div>
                <div className="pt-book-body">
                  {book ? <>
                    {asks.slice(0, 9).reverse().map((r: any, i: number) => <BookRow key={'a' + i} r={r} sd="ask" />)}
                    <div className="pt-book-spread">{cents(curP)}<span>spread {book.asks?.[0] && book.bids?.[0] ? cents(Math.max(0, (asks[0]?.px || 0) - (bids[0]?.px || 0))) : '—'}</span></div>
                    {bids.slice(0, 9).map((r: any, i: number) => <BookRow key={'b' + i} r={r} sd="bid" />)}
                  </> : <PanelLoader label="Loading book…" size={24} fill />}
                </div>
              </>
            ) : (
              <>
                <div className="pt-book-head pt-trades-head"><span>Price</span><span>Shares</span><span>Side</span><span className="r">Time</span></div>
                <div className="pt-book-body">
                  {trades.length === 0 ? <PanelLoader label="Loading trades…" size={24} fill /> : trades.slice(0, 40).map((t: any, i: number) => {
                    const buy = t.side === 'BUY';
                    return (
                      <div className="pt-trade-row" key={(t.txHash || '') + i} title={`${t.trader} · ${t.outcome}`}>
                        <span className={buy ? 'up' : 'down'}>{cents(t.price)}</span>
                        <span>{fmtShares(t.size)}</span>
                        <span className={buy ? 'up' : 'down'}>{t.side} {t.outcome}</span>
                        <span className="r muted">{timeAgo(t.time)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            </div>{/* /term__book-full */}
          </aside>

          {/* prediction ticket + account (right, full height) */}
          <aside className="term__entry">
            {L.rsz('entry', 'l')}
            <div className="term__ls pt-ls">
              <button className={'term__ls-btn pt-ls-yes' + (side === 'Yes' ? ' on' : '')} onClick={() => setSide('Yes')}>Buy Yes</button>
              <button className={'term__ls-btn pt-ls-no' + (side === 'No' ? ' on' : '')} onClick={() => setSide('No')}>Buy No</button>
            </div>
            <div className="term__entry-scroll">
              <div className="term__entry-body">
                <div className="term__orow">
                  <div className="term__otabs">{(['Market', 'Limit'] as const).map((o) => <button key={o} className={o === otype ? 'on' : ''} onClick={() => setOtype(o)}>{o}</button>)}</div>
                </div>
                {otype === 'Limit' && (
                  <label className="term__field"><span>Limit</span><input inputMode="decimal" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder={(bestAsk * 100).toFixed(1)} /><span className="term__field-unit">¢</span></label>
                )}
                <label className="term__field term__field--amt"><span>Amount</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><span className="term__field-unit">USDC</span></label>
                <div className="term__pcts">{[10, 25, 50, 100].map((p) => <button key={p} onClick={() => setAmount(String(p))}>${p}</button>)}</div>
              </div>
              <div className="term__pta">
                <div className="term__pta-row"><span>Avg price</span><b>{cents(execPx)}</b></div>
                <div className="term__pta-row"><span>Implied probability</span><b>{pct(execPx)}</b></div>
                <div className="term__pta-row"><span>Est. shares</span><b>{shares.toFixed(2)}</b></div>
                <div className="term__pta-row"><span>Max payout</span><b className="up">{fmtUsd(maxPayout)}</b></div>
                <div className="term__pta-row"><span>To win</span><b className="up">{fmtUsd(toWin)}</b></div>
                <div className="term__pta-row"><span>Resolves</span><b>{resolvesIn(m.endDate)}</b></div>
              </div>
            </div>
            <button className={'term__submit pt-submit--' + side.toLowerCase()} onClick={submit}>
              {otype === 'Limit' ? 'Place limit · ' : 'Buy '}{side} · {cents(execPx)}
            </button>
            {/* account card */}
            <div className="term__acctcard term__acctcard--desk pt-acct">
              <div className="term__ac-top">
                <button className="term__acct-sel term__ac-sel" onClick={() => window.dispatchEvent(new CustomEvent('hence:accounts'))}><Icon name="wallet" size={13} /><span>{auth.authenticated ? 'Polymarket' : 'Connect wallet'}</span></button>
                <span className={'term__ac-chg' + (totalPnl >= 0 ? '' : ' down')}>{totalPnl >= 0 ? '+' : ''}{fmtUsd(totalPnl)}</span>
              </div>
              <div className="term__ac-eq"><span className="term__ac-eq-l">Portfolio value</span><b className="term__ac-eq-v">{fmtUsd(portfolio)}</b></div>
              <div className="term__ac-btns">
                <button className="term__ac-btn term__ac-btn--pri" onClick={() => window.dispatchEvent(new CustomEvent('hence:accounts', { detail: { fund: 'polygon' } }))}>Deposit</button>
                <button className="term__ac-btn" onClick={() => setMtab('Account')}>Positions</button>
              </div>
              <div className="term__ac-rows">
                <div className="term__ac-row"><span>Open positions</span><b>{posLoading ? <Skeleton w={18} h={11} /> : (positions?.length || '—')}</b></div>
                <div className="term__ac-row term__ac-row--sub"><span>Unrealized PnL</span><b className={totalPnl >= 0 ? 'up' : 'down'}>{posLoading ? <Skeleton w={44} h={11} /> : positions?.length ? (totalPnl >= 0 ? '+' : '') + fmtUsd(totalPnl) : '—'}</b></div>
              </div>
            </div>
          </aside>

          {/* your bets (bottom) */}
          {/* UNIVERSAL account panel — the same strip/tabs as the perp terminal, so
              positions, predictions, orders and cross-venue history follow the user
              between market types (perps ⇄ events). */}
          <div className="term__bottom">
            {L.rsz('bottom', 't')}
            <AccountPanel />
          </div>
        </div>
      </div>

      {paletteOpen && <MarketSelect onPick={(sym: string) => { setPaletteOpen(false); nav('/terminal/' + sym.toUpperCase()); }} onClose={() => setPaletteOpen(false)} />}

      {pmFlag ? (
        <PmTradePanel
          open={pmOpen}
          onClose={() => setPmOpen(false)}
          market={{ tokenYes: m.tokenYes, tokenNo: m.tokenNo, question: m.question }}
          side={side}
          price={execPx}
          amountUsd={amt}
          limit={otype === 'Limit'}
        />
      ) : null}
    </>
  );
}

// Scrolling market tape — the prediction-mode counterpart to the perp TickerTape.
// Duplicates the list so the 70s CSS marquee (.term__tape-track) loops seamlessly;
// hovering pauses it (see terminal.css). Buttons client-side-nav to each market.
function PredTape({ items, nav }: { items: any[]; nav: (to: string) => void }) {
  if (!items.length) return <div className="term__tape"><div className="term__tape-track"><span className="term__tape-i">Loading markets…</span></div></div>;
  const Item = ({ p }: { p: any }) => {
    const u = (p.yes ?? 0) >= 0.5;
    return (
      <button className="term__tape-i" onClick={() => nav('/terminal/m/' + p.id)} title={p.question}>
        {p.icon ? <img className="pt-tape-ic" src={p.icon} alt="" loading="lazy" /> : null}
        <span className="term__tape-sym pt-tape-q">{p.question}</span>
        <span className={u ? 'up' : 'down'}>{pct(p.yes ?? 0)}</span>
      </button>
    );
  };
  return <div className="term__tape"><div className="term__tape-track">{items.map((p) => <Item key={'a' + p.id} p={p} />)}{items.map((p) => <Item key={'b' + p.id} p={p} />)}</div></div>;
}
