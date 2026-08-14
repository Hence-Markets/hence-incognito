/* =========================================================================
   Portfolio — "my money", unified across every venue Hence trades on.

   One screen answering: what am I worth, how has it moved, what am I holding,
   and how are my THESES doing (the belief-spine differentiator: basket P&L
   with per-leg attribution, matched from live positions).

   Data (all public per-address reads, no keys):
   - HL equity curve + cumulative P&L windows  → useHlPortfolio (/api/info portfolio)
   - HL live positions (native + xyz dexes)    → useHlAccount (clearinghouse)
   - Polymarket positions (entry¢ vs current¢) → venueBalances.pmPositions (data-api)
   - Wallet + PM cash balances                 → venueBalances snapshot
   - Theses + plan legs                        → /api/me/theses (auth)
   ========================================================================= */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '../components/Shell';
import RatingCard, { type RatingSelf } from '../components/RatingCard';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Skeleton } from '../components/Loading';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount, HlPosition } from '../hooks/useHlAccount';
import { useHlPortfolio, PfWindows } from '../hooks/useHlPortfolio';
import { walletBalances, pmBalances, pmPositions, loadActivity, PmPosition, ActivityRow, WalletBalances, PmBalances } from '../lib/venueBalances';
import { priceChart, initCharts } from '../lib/charts.js';
import * as market from '../lib/market.js';
// @ts-ignore — JS module
import * as me from '../lib/me.js';
import { openTrade } from '../lib/tradeTicket';
import { authenticatedApiFetch } from '../lib/auth-transport';
import { groupByThesis } from '../lib/thesis-positions';
import { closePosition } from '../lib/hl-close';
import { makeRunWithAgent } from '../lib/hl-run';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAgent } from '../hooks/useHlAgent';
import { track } from '../lib/analytics';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';
import '../styles/portfolio.css';

const fmtUsd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
const signUsd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

/* window key per range pill; HL names: day/week/month/allTime */
const RANGES: [string, string][] = [['1D', 'day'], ['1W', 'week'], ['1M', 'month'], ['All', 'allTime']];

function seriesFor(windows: PfWindows | null, key: string): [number, number][] {
  if (!windows) return [];
  return windows[key] || windows['allTime'] || [];
}

/* thesis ↔ position matching now lives in lib/thesis-positions (groupByThesis), which claims
   each position for at most ONE thesis. The matcher that used to live here was a non-exclusive
   first-match lookup, so two theses naming the same coin both counted its P&L — and it tested
   `leg.venue === 'pm'` while plan legs are actually written with venue 'prediction', so
   prediction legs fell through to the perp branch. */

/* The full portfolio view — rendered standalone at #/portfolio AND embedded as the
   "Portfolio" tab of the Watchlist screen (embedded hides the duplicate page header). */
/* `address` renders SOMEONE ELSE's portfolio (a public profile). Everything venue-side is
   already address-generic, but several paths keyed off `auth.authenticated` rather than off the
   address — so without an explicit self/other split they blend the viewer into the page being
   viewed: your theses would be matched against their positions, your daily snapshot would record
   THEIR equity, and Close buttons would render on their rows wired to your signer. `isSelf`
   gates every one of those. `profileTheses` supplies the target's PUBLIC theses instead. */
export function PortfolioView({ embedded = false, address: addressProp, profileTheses }: {
  embedded?: boolean;
  address?: string;
  profileTheses?: any[] | null;
}) {
  const auth = useAuth();
  // dev-only address override so the screen can be exercised with any public address
  const devAddr = (() => { try { return import.meta.env.DEV ? sessionStorage.getItem('hence.devPfAddr') || '' : ''; } catch { return ''; } })();
  const address = addressProp || devAddr || auth.address;
  // Someone else's page. devAddr counts as "other" too — it always did in effect, which is how
  // the thesis-mismatch bug was reachable in dev before this existed.
  const isSelf = !!address && !addressProp && !devAddr && address === auth.address;

  const acct = useHlAccount(address, { readOnly: !isSelf });
  const signer = useHlSigner();
  const agent = useHlAgent();
  const { windows, pnlWindows, loaded: pfLoaded } = useHlPortfolio(address);
  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [pm, setPm] = useState<PmBalances | null>(null);
  const [pmPos, setPmPos] = useState<PmPosition[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [theses, setTheses] = useState<any[] | null>(null);
  const [executions, setExecutions] = useState<any[]>([]);   // which thesis actually opened what
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [closingThesis, setClosingThesis] = useState<string | null>(null);
  const [range, setRange] = useState('1M');
  const [filter, setFilter] = useState<'All' | 'Perps' | 'Stocks' | 'Predictions'>('All');
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    walletBalances(address).then((w) => alive && setWallet(w));
    pmBalances(address).then((p) => alive && setPm(p));
    pmPositions(address).then((p) => alive && setPmPos(p));
    loadActivity(address, 30).then((a) => alive && setActivity(a));
    return () => { alive = false; };
  }, [address]);
  useEffect(() => {
    // Only YOUR theses and YOUR snapshots, and only on your own page. On someone else's
    // profile these would attribute their positions to your theses and graft their equity
    // onto your curve.
    if (!auth.authenticated || !isSelf) return;
    let alive = true;
    Promise.resolve(me.loadTheses()).then((r: any) => {
      if (alive && r && Array.isArray(r.theses)) {
        setTheses(r.theses); setExecutions(r.executions || []); setRating(r.rating || null);
      }
      else if (alive && Array.isArray(r)) setTheses(r);
    }).catch(() => { /* theses stay null */ });
    authenticatedApiFetch('/api/me/pfsnap').then((r) => r.json()).then((j: any) => {
      if (alive && j && Array.isArray(j.points)) setSnaps(j.points);
    }).catch(() => { /* no snapshots yet */ });
    return () => { alive = false; };
  }, [auth.authenticated, isSelf]);

  // a profile supplies the target's PUBLIC theses; they group their positions the same way
  useEffect(() => {
    if (isSelf) return;
    setTheses(profileTheses || null);
    setExecutions([]);          // executions are private — grouping falls back to plan legs
  }, [isSelf, profileTheses]);

  /* xyz fee rebates — money owed and money already paid into the HL balance. Self only:
     a rebate is personal, so it never renders on someone else's profile. */
  const [rebate, setRebate] = useState<{ accrued: number; paid: number; lifetime: number } | null>(null);
  useEffect(() => {
    if (!auth.authenticated || !isSelf) { setRebate(null); return; }
    let alive = true;
    const pull = () => me.rebates()
      .then((r: any) => { if (alive) setRebate(r && r.available && r.active ? r : null); })
      .catch(() => { if (alive) setRebate(null); });
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [auth.authenticated, isSelf]);

  // your author rating rides along with /api/me/theses — it is derived from those same theses,
  // and it is returned ONLY on this authenticated route (never on a public profile).
  const [rating, setRating] = useState<RatingSelf | null>(null);
  const [snaps, setSnaps] = useState<[number, number][]>([]);

  /* ---- header numbers ---- */
  const hlEquity = acct.loaded ? acct.accountValue : null;
  const pmTotal = pm ? pm.total : null;
  const walletTotal = wallet ? wallet.total : null;
  const total = hlEquity == null && pmTotal == null && walletTotal == null
    ? null : (hlEquity || 0) + (pmTotal || 0) + (walletTotal || 0);
  const uPnlHl = acct.loaded ? acct.positions.reduce((s, p) => s + p.uPnl, 0) : 0;
  const uPnlPm = (pmPos || []).reduce((s, p) => s + p.pnl, 0);
  const daySeries = seriesFor(windows, 'day');
  const dayDelta = daySeries.length >= 2 ? daySeries[daySeries.length - 1][1] - daySeries[0][1] : null;
  const pnl30 = (() => {
    const s = (pnlWindows && pnlWindows['month']) || [];
    return s.length >= 2 ? s[s.length - 1][1] - s[0][1] : null;
  })();

  /* daily portfolio-value snapshot (P4): one POST per UTC day builds the curve
     that outlives the venues' own history windows */
  useEffect(() => {
    // `isSelf` is load-bearing, not defensive: `total` here is whatever account is on screen,
    // so on someone else's profile this would write THEIR equity into YOUR history — and then
    // the All-range curve, which prefers these snapshots over the venue's own series, would
    // render it as your net worth. Silent, permanent, and wrong.
    if (!auth.authenticated || !isSelf || total == null || !Number.isFinite(total)) return;
    const day = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem('hence.pfsnap.day') === day) return;
      authenticatedApiFetch('/api/me/pfsnap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Math.round(total * 100) / 100 }),
      }).then((r) => { if (r.ok) { try { localStorage.setItem('hence.pfsnap.day', day); } catch { /* storage off */ } } });
    } catch { /* storage off */ }
  }, [auth.authenticated, isSelf, total]);

  /* ---- equity curve (P1) — HL account value, hoverable, real time axis ---- */
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const key = RANGES.find(([r]) => r === range)?.[1] || 'month';
    let pts = seriesFor(windows, key);
    // once our daily snapshots span further back than HL's allTime window, they win the All view
    if (range === 'All' && snaps.length >= 2 && (!pts.length || snaps[0][0] < pts[0][0])) pts = snaps;
    if (pts.length < 2) { el.innerHTML = pfLoaded ? '<div class="muted" style="padding:44px;text-align:center;font-size:13px">No account history yet — make a first trade and the curve begins.</div>' : ''; return; }
    const values = pts.map((p) => p[1]);
    const up = values[values.length - 1] >= values[0];
    el.innerHTML = priceChart(values, {
      w: 920, h: 210,
      stroke: up ? 'rgba(95,207,145,0.95)' : 'rgba(240,141,131,0.9)',
      fill: up ? 'rgba(74,201,134,0.07)' : 'rgba(240,141,131,0.06)',
      labels: pts.map((p) => market.fmtLabel(p[0], range === '1D' ? '1D' : '1Y')),
      fmt: (v: number) => fmtUsd(v),
    });
    initCharts(el);
  }, [windows, range, pfLoaded, snaps]);

  /* ---- positions rows, filterable (P1) ---- */
  const hlRows = (acct.positions || []).map((p) => ({ ...p, sym: p.coin.split(':').pop()!.toUpperCase(), cls: p.coin.includes(':') ? 'Stocks' : 'Perps' }));

  /* ---- theses as INDEXES: positions opened by a thesis group under it ----
     A thesis you funded is one instrument, not N loose rows. groupByThesis claims each
     position for at most one thesis (see lib/thesis-positions), so nothing is rendered — or
     counted — twice, and whatever no thesis opened stays in the loose table below. */
  const { groups, loose } = useMemo(
    () => groupByThesis(theses, hlRows, executions),
    [theses, executions, acct.positions],
  );
  /* A thesis earns a place here only while it still holds an OPEN leg. The portfolio is a view of
     live money; once every leg is closed the group is a husk — "0/2 legs open · $0 value" — and
     four of those stacked above "No open positions" is what the screen must never say. A closed
     thesis is history and keeps its final P&L on the Theses page. Partial exits still show: one
     open leg is enough. */
  const shownGroups = groups.filter((g) =>
    g.open.length > 0 && (filter === 'All' || g.open.some((p: any) => p.cls === filter)));
  const shownHl = loose.filter((p) => filter === 'All' || filter === p.cls);
  const shownPm = (filter === 'All' || filter === 'Predictions') ? (pmPos || []) : [];

  /* ---- closing, from the portfolio ----
     Same agent-signed, reduce-only, builder-attached rail the terminal uses (lib/hl-close),
     so an exit here is identical to an exit there. A whole-thesis close runs the legs in
     sequence and reports what actually closed rather than assuming. */
  const closeOne = async (p: any, thesisId?: number | string) => {
    if (!signer.ready || !signer.sign || !signer.address) { toast('Connect a wallet to close', { icon: 'wallet' }); return; }
    setClosingThesis(String(thesisId ?? p.coin));
    try {
      const r = await closePosition(makeRunWithAgent(agent), signer.sign, signer.address, p,
        { source: 'portfolio', thesisId: thesisId ?? null });
      if (r.ok) { toast(`Closed ${p.sym} · ${r.status}`, { ticker: p.sym }); acct.refresh?.(); }
      else toast(r.error, { icon: 'close' });
    } catch (e: any) { toast(e?.message || 'Close failed', { icon: 'close' }); }
    finally { setClosingThesis(null); }
  };

  const closeThesis = async (g: any) => {
    if (!signer.ready || !signer.sign || !signer.address) { toast('Connect a wallet to close', { icon: 'wallet' }); return; }
    setClosingThesis(String(g.thesis.id));
    let done = 0; const failed: string[] = [];
    try {
      const run = makeRunWithAgent(agent);
      for (const p of g.open) {
        const r = await closePosition(run, signer.sign, signer.address, p,
          { source: 'thesis_close', thesisId: g.thesis.id });
        if (r.ok) done++; else failed.push(`${p.sym}: ${r.error}`);
      }
      if (done) acct.refresh?.();
      if (!failed.length) toast(`Closed the thesis — ${done} leg${done === 1 ? '' : 's'}`, { icon: 'check' });
      else toast(`Closed ${done}, failed ${failed.length}: ${failed[0]}`, { icon: 'alert' });
      track('thesis_closed', { thesis_id: g.thesis.id, legs_closed: done, legs_failed: failed.length });
    } catch (e: any) { toast(e?.message || 'Close failed', { icon: 'close' }); }
    finally { setClosingThesis(null); }
  };

  /* ---- allocation (P5) ---- */
  const alloc = useMemo(() => {
    const perps = hlRows.filter((p) => p.cls === 'Perps').reduce((s, p) => s + p.positionValue, 0);
    const stocks = hlRows.filter((p) => p.cls === 'Stocks').reduce((s, p) => s + p.positionValue, 0);
    const preds = (pmPos || []).reduce((s, p) => s + p.value, 0);
    const cash = Math.max(0, (acct.loaded ? acct.available : 0)) + (pm ? pm.cash : 0) + (wallet ? wallet.total : 0);
    const parts = [
      { k: 'Perps', v: perps, c: 'var(--lav)' }, { k: 'Stocks', v: stocks, c: 'var(--peach)' },
      { k: 'Predictions', v: preds, c: 'var(--blue)' }, { k: 'Cash & wallets', v: cash, c: 'rgba(255,255,255,0.35)' },
    ].filter((p) => p.v > 0.5);
    const sum = parts.reduce((s, p) => s + p.v, 0) || 1;
    return { parts, sum };
  }, [hlRows.length, pmPos, wallet, pm, acct.loaded, acct.available]);

  const donut = useMemo(() => {
    let a0 = -Math.PI / 2;
    const R = 44, r = 28, cx = 50, cy = 50;
    return alloc.parts.map((p) => {
      // a full-circle arc renders as nothing in SVG — clamp a 100% slice just short of 2π
      const a1 = a0 + Math.min((p.v / alloc.sum) * Math.PI * 2, Math.PI * 2 - 0.004);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} L ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} A ${r} ${r} 0 ${large} 0 ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} Z`;
      a0 = a1;
      return { ...p, d };
    });
  }, [alloc]);

  if (!address) {
    return (
      <div className="pf">{!embedded && <header className="pf__head"><h2>Portfolio</h2></header>}
        <div className="pf__empty"><Icon name="wallet" size={22} /><b>Connect a wallet to see your portfolio</b>
          <p>Positions, P&amp;L and your theses — unified across Hyperliquid, trade.xyz and Polymarket.</p></div>
      </div>
    );
  }

  return (
      <div className="pf">
        <header className="pf__head">
          {!embedded && <h2>Portfolio</h2>}
          <span className="pf__addr">{address.slice(0, 6)}…{address.slice(-4)}</span>
        </header>

        {/* KPI strip */}
        <div className="pf__kpis">
          <div><span>Total value</span><b className="ph-mask">{total == null ? <Skeleton w={90} h={18} /> : fmtUsd(total)}</b></div>
          <div><span>Today</span><b className={dayDelta == null ? '' : dayDelta >= 0 ? 'up' : 'down'}>{dayDelta == null ? '—' : signUsd(dayDelta)}</b></div>
          <div><span>Unrealized</span><b className={uPnlHl + uPnlPm >= 0 ? 'up' : 'down'}>{signUsd(uPnlHl + uPnlPm)}</b></div>
          <div><span>P&amp;L · 30d</span><b className={pnl30 == null ? '' : pnl30 >= 0 ? 'up' : 'down'}>{pnl30 == null ? '—' : signUsd(pnl30)}</b></div>
          <div><span>Buying power</span><b>{acct.loaded ? fmtUsd(acct.available) : '—'}</b></div>
        </div>

        {/* equity curve */}
        <div className="card pf__curve">
          <div className="pf__curvehead">
            <span className="pf__curvetitle">Account equity · Hyperliquid + trade.xyz</span>
            <div className="segmented">{RANGES.map(([r]) => (
              <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}</div>
          </div>
          <div ref={chartRef} style={{ height: 210 }} />
          <div className="pf__venues">
            <span>Hyperliquid {fmtUsd(hlEquity)}</span>
            <span>Polymarket {fmtUsd(pmTotal)}</span>
            <span>Wallets {fmtUsd(walletTotal)}</span>
          </div>
        </div>

        {/* Fee rebates: earned money, so it belongs on the money screen rather than buried in
            the terminal. Pending is what the next payout sends (settles from $1); rebated is
            lifetime, already delivered into the Hyperliquid balance above. */}
        {rebate ? (
          <section className="pf__rebate ph-mask">
            <div className="pf__rebate-h">
              <b>Fee rebates</b>
              <span>trade.xyz markets — zero Hence fee, venue fees returned</span>
            </div>
            <div className="pf__rebate-n">
              <div>
                <span>Pending</span>
                <b>{fmtUsd(rebate.accrued)}</b>
                <small>{rebate.accrued >= 1 ? 'paying out shortly' : 'pays out from $1'}</small>
              </div>
              <div>
                <span>Rebated to date</span>
                <b className="up">{fmtUsd(rebate.paid)}</b>
                <small>paid into your Hyperliquid balance</small>
              </div>
            </div>
          </section>
        ) : null}

        {/* Your rating sits between the money and the positions on purpose: it is the score for
            the ideas BELOW it, not for the equity above it. Owner-only — see RatingCard. */}
        {isSelf && rating && <RatingCard r={rating} />}

        {/* POSITIONS — theses as indexes first, then whatever no thesis opened */}
        <section className="pf__sec ph-mask">
          <div className="sec-title">Positions <span className="sec-badge">P</span>
            <div className="pf__filters">
              {(['All', 'Perps', 'Stocks', 'Predictions'] as const).map((f) => (
                <button key={f} className={'btn-ghost' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
          {!acct.loaded && !pmPos ? <div className="pf__loading"><Skeleton w={640} h={44} /><Skeleton w={640} h={44} /></div> : null}

          {/* a funded thesis reads as ONE holding — its own P&L, expandable to the legs */}
          {shownGroups.map((g) => {
            const key = String(g.thesis.id);
            const open = !!expanded[key];
            const chk = (g.thesis as any).last_check || {};
            const busy = closingThesis === key;
            return (
              <div key={key} className="card pf__idx">
                <div className="pf__idxhead" onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))} role="button" tabIndex={0}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setExpanded((e) => ({ ...e, [key]: !open })); } }}>
                  <span className="pf__idxcaret"><Icon name={open ? 'arrowUp' : 'arrowRight'} size={12} /></span>
                  <span className="pf__idxlogos">{g.open.slice(0, 4).map((p: any) => <Logo key={p.coin} sym={p.sym} size={17} />)}</span>
                  <span className="pf__idxid">
                    <b>{g.thesis.title || 'Thesis'}</b>
                    <small>{g.entered}/{g.total} legs open{g.cost > 0 ? ` · ${fmtUsd(g.cost)} in` : ''}</small>
                  </span>
                  {chk.flags && chk.flags.includes('review_due') ? <span className="pf__badge gold">Review due</span> : null}
                  <span className="pf__cell">{fmtUsd(g.value)} <small>value</small></span>
                  <span className={'pf__pnl ' + (g.uPnl >= 0 ? 'up' : 'down')}>
                    {signUsd(g.uPnl)}<small>{g.roi != null ? (g.roi * 100).toFixed(1) + '%' : ''}</small>
                  </span>
                </div>
                {open && (
                  <div className="pf__idxbody">
                    {g.legs.map((x: any, j: number) => {
                      const sym = String(x.leg.symbol || '').toUpperCase();
                      const dir = String(x.leg.direction || '').toUpperCase();
                      return (
                        <div key={j} className="pf__idxleg">
                          <a className="pf__idxlegid" href={sym ? `#/stock/${sym}` : '#/predict'}>
                            {sym ? <Logo sym={sym} size={16} /> : <Icon name="chart" size={13} />}
                            <b>{sym || (x.leg.market && x.leg.market.question) || x.leg.question || 'Prediction'}</b>
                          </a>
                          <span className={'pf__dir ' + dir.toLowerCase()}>{dir}</span>
                          {x.pos ? (
                            <>
                              <span className="pf__cell">{x.pos.sz} <small>size</small></span>
                              <span className="pf__cell">{market.fmtPrice(x.pos.entryPx)} <small>entry</small></span>
                              <span className="pf__cell">{fmtUsd(x.pos.positionValue)} <small>value</small></span>
                              <span className={'pf__pnl ' + (x.pos.uPnl >= 0 ? 'up' : 'down')}>{signUsd(x.pos.uPnl)}<small>{(x.pos.roe * 100).toFixed(1)}%</small></span>
                              {isSelf && (
                                <button className="btn-ghost pf__closebtn" disabled={busy}
                                  onClick={() => closeOne(x.pos, g.thesis.id)}>Close</button>
                              )}
                            </>
                          ) : (
                            <span className="pf__legdetail ghost">
                              not open
                              {!x.leg.venue || x.leg.venue !== 'prediction'
                                ? (isSelf ? <button className="btn-ghost pf__arm" onClick={() => openTrade(sym, dir === 'SHORT' ? 'Short' : 'Long')}>Arm</button> : null)
                                : null}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <div className="pf__idxfoot">
                      <a className="btn-ghost" href="#/theses"><Icon name="doc" size={12} /> Thesis detail</a>
                      {isSelf && g.entered > 0 && (
                        <button className="btn-ghost pf__closeall" disabled={busy} onClick={() => closeThesis(g)}>
                          {busy ? 'Closing…' : `Close thesis · ${g.entered} leg${g.entered === 1 ? '' : 's'}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {shownHl.length > 0 && (
            <div className="card pf__table">
              {shownHl.map((p, i) => (
                <a key={i} className="pf__row" href={`#/stock/${p.sym}`}>
                  <span className="pf__who"><Logo sym={p.sym} size={20} /><b>{p.sym}</b>
                    <span className={'pf__dir ' + p.side.toLowerCase()}>{p.side.toUpperCase()} {p.leverage}×</span></span>
                  <span className="pf__cell">{p.sz} <small>size</small></span>
                  <span className="pf__cell">{market.fmtPrice(p.entryPx)} <small>entry</small></span>
                  <span className="pf__cell">{p.liqPx ? market.fmtPrice(p.liqPx) : '—'} <small>liq</small></span>
                  <span className="pf__cell">{fmtUsd(p.positionValue)} <small>value</small></span>
                  <span className={'pf__pnl ' + (p.uPnl >= 0 ? 'up' : 'down')}>{signUsd(p.uPnl)}<small>{(p.roe * 100).toFixed(1)}%</small></span>
                </a>
              ))}
            </div>
          )}
          {shownPm.length > 0 && (
            <div className="card pf__table">
              {shownPm.map((p, i) => (
                <div key={i} className="pf__row pf__row--pm">
                  <span className="pf__who"><span className={'pf__dir ' + (p.outcome.toLowerCase() === 'yes' ? 'long' : 'short')}>{p.outcome.toUpperCase()}</span>
                    <b className="pf__pmtitle">{p.title}</b></span>
                  <span className="pf__cell">{Math.round(p.avgPrice * 100)}¢ → {Math.round(p.curPrice * 100)}¢</span>
                  <span className="pf__cell">{fmtUsd(p.value)} <small>value</small></span>
                  <span className={'pf__pnl ' + (p.pnl >= 0 ? 'up' : 'down')}>{signUsd(p.pnl)}{p.redeemable ? <small className="up">claimable</small> : p.endDate ? <small>{String(p.endDate).slice(0, 10)}</small> : null}</span>
                </div>
              ))}
            </div>
          )}
          {/* thesis groups hold positions too, so they have to count as "something open" here —
              otherwise a funded thesis renders directly above the words "No open positions" */}
          {acct.loaded && shownGroups.length === 0 && shownHl.length === 0 && shownPm.length === 0 && (
            <div className="pf__empty pf__empty--soft"><b>No open positions{filter !== 'All' ? ` in ${filter}` : ''}</b>
              <p>Ask Hence for a trade idea, or open the screener to browse the markets.</p></div>
          )}
        </section>

        {/* ALLOCATION + ACTIVITY side by side */}
        <div className="pf__grid2">
          {alloc.parts.length > 0 && (
            <div className="card pf__alloc">
              <div className="sec-title" style={{ fontSize: 12, marginTop: 0 }}>Allocation</div>
              <div className="pf__allocrow">
                <svg viewBox="0 0 100 100" width="96" height="96">{donut.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}</svg>
                <div className="pf__alloclegend">
                  {alloc.parts.map((p, i) => (
                    <div key={i}><i style={{ background: p.c }} /><span>{p.k}</span><b>{Math.round((p.v / alloc.sum) * 100)}%</b></div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="card pf__activity">
            <div className="sec-title" style={{ fontSize: 12, marginTop: 0 }}>Activity</div>
            {activity === null ? <Skeleton w={280} h={60} /> : activity.length === 0
              ? <div className="muted" style={{ fontSize: 12.5, padding: '10px 0' }}>No venue activity yet.</div>
              : activity.slice(0, 12).map((a, i) => (
                <div key={i} className="pf__act">
                  <span>{a.kind}</span><span className="pf__actdetail">{a.detail}</span>
                  <span className="pf__acttime">{new Date(a.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
  );
}

export default function Portfolio() {
  return (
    <Shell dockActive="portfolio">
      <PortfolioView />
    </Shell>
  );
}
