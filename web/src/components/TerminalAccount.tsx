/* =========================================================================
   TerminalAccount — the UNIVERSAL bottom account panel shared by both terminal
   modes (perp PerpBody + prediction PredictBody): one surface for positions,
   predictions, orders and cross-venue history wherever the user is trading.

   - BottomBody: the tab content (moved out of Terminal.tsx unchanged, plus the
     dual-venue Trade History: Hyperliquid fills + Polymarket activity, merged).
   - AccountPanel: a self-contained strip+body+modals unit for screens that don't
     already own the account plumbing (the prediction terminal). The perp side
     keeps its own inline copy (user-approved frozen layout) — keep the two rails
     behaviourally identical when touching either.
   ========================================================================= */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { fmtPx, fmtUsd } from '../lib/fmt';
// @ts-ignore — JS module
import { getTicker } from '../lib/data.js';
// @ts-ignore — JS module
import { info } from '../lib/hydromancer.js';
// @ts-ignore — JS module
import { positions as pmPositions } from '../lib/polymarket.js';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';
import { useAuth } from '../hooks/useAuth';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAgent } from '../hooks/useHlAgent';
import { makeRunWithAgent } from '../lib/hl-run';
import { closeAllPositions } from '../lib/hl-close';
import { useHlAccount } from '../hooks/useHlAccount';
import { placeOrder, placeTpsl, cancelOrder } from '../lib/hyperliquid-exchange';
import { resolveBuilder } from '../lib/builder-fee';
import { track } from '../lib/analytics';

export function BottomBody({ btab, hl, addr, preds, onCancel, cancelling, onClose, closing, onTpsl }: { btab: string; hl: any; addr?: string; preds: any[] | null; onCancel: (o: any) => void; cancelling: number | null; onClose: (p: any) => void; closing: string | null; onTpsl: (p: any) => void }) {
  // Positions PnL ticks in real time between account polls: marks come from the live
  // ticker feed, this 2s bump just repaints (trade.xyz-style live PnL).
  const [, bump] = useState(0);
  useEffect(() => {
    if (btab !== 'Positions') return;
    const id = window.setInterval(() => bump((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, [btab]);

  // history feeds — lazy per tab, refreshed while the tab is open; reset on account change.
  // Trade History is CROSS-VENUE: Hyperliquid fills + Polymarket activity, merged by time.
  const [fills, setFills] = useState<any[] | null>(null);
  const [pmAct, setPmAct] = useState<any[] | null>(null);
  const [hist, setHist] = useState<any[] | null>(null);
  useEffect(() => { setFills(null); setPmAct(null); setHist(null); }, [addr]);
  useEffect(() => {
    if (!addr || (btab !== 'Trade History' && btab !== 'Order History')) return;
    let alive = true;
    const load = () => {
      if (btab === 'Trade History') {
        info({ type: 'userFills', user: addr }).then((r: any) => { if (alive) setFills(Array.isArray(r) ? r : []); }).catch(() => { if (alive) setFills((f) => f || []); });
        fetch('/api/poly/data/activity?user=' + encodeURIComponent(addr.toLowerCase()) + '&limit=100')
          .then((r) => (r.ok ? r.json() : []))
          .then((r: any) => { if (alive) setPmAct(Array.isArray(r) ? r : []); })
          .catch(() => { if (alive) setPmAct((a) => a || []); });
      } else {
        info({ type: 'historicalOrders', user: addr }).then((r: any) => { if (alive) setHist(Array.isArray(r) ? r : []); }).catch(() => { if (alive) setHist((h) => h || []); });
      }
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [btab, addr]);

  if (!hl.connected) return (
    <div className="term__empty"><Icon name="doc" size={22} /><b>No {btab.toLowerCase()}</b><span>Connect an account to see your positions, orders and balances.</span></div>
  );
  if (hl.unavailable) return (
    <div className="term__empty">
      <Icon name="alert" size={22} /><b>Account data unavailable</b>
      <span>Hyperliquid didn't answer just now — usually momentary. Hence keeps retrying automatically.</span>
      <button className="term__empty-btn" onClick={() => hl.refresh?.()}>Retry now</button>
    </div>
  );
  if (!hl.loaded) return (
    <div className="term__empty"><Skeleton w={120} h={14} /><span>Loading Hyperliquid account data…</span></div>
  );
  if (btab === 'Positions') {
    if (!hl.positions.length) return <div className="term__empty"><Icon name="doc" size={22} /><b>No open positions</b><span>Your Hyperliquid perp positions appear here.</span></div>;
    return (
      <table className="term__ptable">
        <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>Margin</th><th>TP / SL</th><th className="r">uPnL (ROE)</th><th className="r"></th></tr></thead>
        <tbody>{hl.positions.map((p: any) => { const sym = p.coin.split(':').pop();
          const pollMk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
          const t: any = getTicker(sym);
          const mk = t && t.real && +t.price > 0 ? +t.price : pollMk;
          const uPnl = (mk - p.entryPx) * p.sz * (p.side === 'Long' ? 1 : -1);
          const roe = p.marginUsed > 0 ? uPnl / p.marginUsed : p.roe;
          const tp = hl.triggers.find((tr: any) => tr.coin === p.coin && tr.tpsl === 'tp');
          const sl = hl.triggers.find((tr: any) => tr.coin === p.coin && tr.tpsl === 'sl');
          return (
          <tr key={p.coin}>
            <td><Link to={'/terminal/' + sym}>{sym}</Link> <span className={'term__levchip ' + (p.side === 'Long' ? 'up' : 'down')}>{p.leverage}×</span>{p.coin.includes(':') ? <span className="term__pos-dex"> {p.coin.split(':')[0]}</span> : null}</td>
            <td><span className={'term__pillside ' + (p.side === 'Long' ? 'up' : 'down')}>{p.side}</span></td>
            <td>{p.sz}</td><td>{fmtPx(p.entryPx)}</td><td>{fmtPx(mk)}</td>
            <td>{p.liqPx ? fmtPx(p.liqPx) : '—'}</td><td>{fmtUsd(p.marginUsed)}</td>
            <td><button className="term__tpsl-btn" onClick={() => onTpsl(p)} title="Set take-profit / stop-loss">
              {tp ? fmtPx(tp.triggerPx) : '--'} / {sl ? fmtPx(sl.triggerPx) : '--'} <Icon name="sliders" size={11} /></button></td>
            <td className={'r ' + (uPnl >= 0 ? 'up' : 'down')}>{uPnl >= 0 ? '+' : ''}{fmtUsd(uPnl)} ({(roe * 100).toFixed(2)}%)</td>
            <td className="r"><button className="term__ocancel" disabled={closing === p.coin} onClick={() => onClose(p)}>{closing === p.coin ? 'Closing…' : 'Close'}</button></td>
          </tr>); })}</tbody>
      </table>
    );
  }
  if (btab === 'Predictions') {
    // unified prediction positions — Polymarket today; HIP-4 outcome rows join this
    // same table once bounds markets are integrated (source chip per row)
    if (preds == null) return <div className="term__empty"><Skeleton w={140} h={14} /><span>Loading prediction positions…</span></div>;
    if (!preds.length) return <div className="term__empty"><Icon name="doc" size={22} /><b>No prediction positions</b><span>Your Polymarket bets (and HIP-4 outcomes, once live) appear here.</span></div>;
    const cents = (v: number) => (v * 100).toFixed(1) + '¢';
    const openPred = async (conditionId: string) => {
      // gamma's condition_ids lookup hides closed markets by default — retry with
      // closed=true so resolved/redeemable positions still deep-link
      for (const extra of ['', '&closed=true']) {
        try {
          const r = await fetch('/api/poly/gamma/markets?condition_ids=' + encodeURIComponent(conditionId) + extra).then((x) => x.json());
          const m = Array.isArray(r) ? r[0] : null;
          if (m && m.id) { location.hash = '#/terminal/m/' + m.id; return; }
        } catch { /* try next */ }
      }
      location.hash = '#/predict';
    };
    return (
      <table className="term__ptable">
        <thead><tr><th>Market</th><th>Outcome</th><th>Venue</th><th>Size</th><th>Entry</th><th>Now</th><th>Value</th><th className="r">PnL</th><th>Ends</th><th className="r"></th></tr></thead>
        <tbody>{preds.slice(0, 60).map((b: any, i: number) => (
          <tr key={(b.token || i) + ':' + i}>
            <td className="term__predq" title={b.title}>{b.title}</td>
            <td><span className={'term__pillside ' + (/yes/i.test(b.outcome) ? 'up' : 'down')}>{b.outcome || '—'}</span></td>
            <td><span className="term__venuechip">Polymarket</span></td>
            <td>{b.shares.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
            <td>{cents(b.avgPrice)}</td><td>{cents(b.curPrice)}</td><td>{fmtUsd(b.value)}</td>
            <td className={'r ' + (b.pnl >= 0 ? 'up' : 'down')}>{b.pnl >= 0 ? '+' : ''}{fmtUsd(b.pnl)} ({b.pnlPct >= 0 ? '+' : ''}{b.pnlPct.toFixed(1)}%)</td>
            <td>{b.redeemable ? <span className="term__status term__status--ok">Redeemable</span> : b.endDate ? new Date(b.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</td>
            <td className="r"><button className="term__ocancel" onClick={() => void openPred(b.marketId)}>Open</button></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (btab === 'Open Orders') {
    if (!hl.orders.length && !hl.triggers.length) return <div className="term__empty"><Icon name="doc" size={22} /><b>No open orders</b><span>Your resting Hyperliquid orders appear here.</span></div>;
    // cancel works on every dex — cancelOrder resolves HIP-3 asset indexes via assetInfo
    return (
      <table className="term__ptable">
        <thead><tr><th>Market</th><th>Type</th><th>Side</th><th>Size</th><th className="r">Price</th><th className="r"></th></tr></thead>
        <tbody>
          {hl.orders.map((o: any) => (
          <tr key={o.oid}>
            <td>{o.coin}</td><td>Limit</td><td className={o.side === 'Buy' ? 'up' : 'down'}>{o.side}</td><td>{o.sz}</td><td className="r">{fmtPx(o.limitPx)}</td>
            <td className="r"><button className="term__ocancel" disabled={cancelling === o.oid} onClick={() => onCancel(o)}>{cancelling === o.oid ? '…' : 'Cancel'}</button></td>
          </tr>
          ))}
          {hl.triggers.map((o: any) => (
          <tr key={'t' + o.oid}>
            <td>{o.coin}</td><td>{o.tpsl === 'tp' ? 'Take Profit' : 'Stop Loss'}</td><td className={o.side === 'Buy' ? 'up' : 'down'}>{o.side}</td>
            <td>{o.sz > 0 ? o.sz : 'Position'}</td><td className="r">{fmtPx(o.triggerPx)}</td>
            <td className="r"><button className="term__ocancel" disabled={cancelling === o.oid} onClick={() => onCancel(o)}>{cancelling === o.oid ? '…' : 'Cancel'}</button></td>
          </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (btab === 'Balances') {
    return (
      <table className="term__ptable">
        <thead><tr><th>Account</th><th>Value</th><th>Available</th><th>Margin used</th><th className="r">Withdrawable</th></tr></thead>
        <tbody className="ph-mask"><tr><td>Hyperliquid perps</td><td>{fmtUsd(hl.accountValue)}</td><td>{fmtUsd(hl.available)}</td><td>{fmtUsd(hl.marginUsed)}</td><td className="r">{fmtUsd(hl.withdrawable)}</td></tr></tbody>
      </table>
    );
  }
  const histTime = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (btab === 'Trade History') {
    if (fills == null && pmAct == null) return <div className="term__empty"><Skeleton w={140} h={14} /><span>Loading trade history…</span></div>;
    const cents = (v: number) => (v * 100).toFixed(1) + '¢';
    const rows = [
      ...(fills || []).map((f: any) => ({ kind: 'hl', t: +f.time, f })),
      ...(pmAct || []).filter((a: any) => a.type === 'TRADE' || a.type === 'REDEEM').map((a: any) => ({ kind: 'pm', t: (+a.timestamp || 0) * 1000, a })),
    ].sort((x, y) => y.t - x.t).slice(0, 80);
    if (!rows.length) return <div className="term__empty"><Icon name="doc" size={22} /><b>No trades yet</b><span>Your Hyperliquid fills and Polymarket trades appear here.</span></div>;
    return (
      <table className="term__ptable">
        <thead><tr><th>Time</th><th>Venue</th><th>Market</th><th>Side</th><th>Price</th><th>Size</th><th>Value</th><th>Fee</th><th className="r">Closed PnL</th></tr></thead>
        <tbody>{rows.map((row: any, i: number) => {
          if (row.kind === 'hl') {
            const f = row.f;
            const sym = String(f.coin).split(':').pop();
            const good = /open long|close short|buy/i.test(String(f.dir || f.side));
            const pnl = +f.closedPnl || 0;
            return (
              <tr key={'h' + i + ':' + (f.tid || f.oid || '') + ':' + f.time}>
                <td className="term__histtime">{histTime(row.t)}</td>
                <td><span className="term__venuechip term__venuechip--hl">Hyperliquid</span></td>
                <td><Link to={'/terminal/' + sym}>{sym}</Link></td>
                <td><span className={'term__pillside ' + (good ? 'up' : 'down')}>{f.dir || (f.side === 'B' ? 'Buy' : 'Sell')}</span></td>
                <td>{fmtPx(+f.px)}</td><td>{+f.sz} {sym}</td><td>{fmtUsd(+f.px * +f.sz)}</td>
                <td>{(+f.fee || 0).toFixed(2)} {f.feeToken || 'USDC'}</td>
                <td className={'r ' + (pnl >= 0 ? 'up' : 'down')}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}</td>
              </tr>);
          }
          const a = row.a;
          const redeem = a.type === 'REDEEM';
          const good = redeem || String(a.side).toUpperCase() === 'BUY';
          return (
            <tr key={'p' + i + ':' + a.timestamp}>
              <td className="term__histtime">{histTime(row.t)}</td>
              <td><span className="term__venuechip">Polymarket</span></td>
              <td className="term__predq" title={a.title}>{a.title}</td>
              <td><span className={'term__pillside ' + (good ? 'up' : 'down')}>{redeem ? 'Redeem' : `${String(a.side).toUpperCase() === 'BUY' ? 'Buy' : 'Sell'} ${a.outcome || ''}`}</span></td>
              <td>{redeem ? '—' : cents(+a.price || 0)}</td>
              <td>{(+a.size || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
              <td>{fmtUsd(+a.usdcSize || 0)}</td>
              <td>—</td>
              <td className="r">—</td>
            </tr>);
        })}</tbody>
      </table>
    );
  }
  if (btab === 'Order History') {
    if (hist == null) return <div className="term__empty"><Skeleton w={140} h={14} /><span>Loading order history…</span></div>;
    if (!hist.length) return <div className="term__empty"><Icon name="doc" size={22} /><b>No order history</b><span>Every order you place appears here with its final status.</span></div>;
    return (
      <table className="term__ptable">
        <thead><tr><th>Time</th><th>Type</th><th>Asset</th><th>Direction</th><th>Size</th><th>Price</th><th className="r">Status</th></tr></thead>
        <tbody>{hist.slice(0, 80).map((row: any, i: number) => {
          const o = row.order || {};
          const sym = String(o.coin).split(':').pop();
          const dirLabel = o.side === 'B' ? (o.reduceOnly ? 'Close Short' : 'Long') : (o.reduceOnly ? 'Close Long' : 'Short');
          const good = o.side === 'B' ? !o.reduceOnly : o.reduceOnly;
          const st = String(row.status || '');
          const stCls = /filled|triggered/.test(st) ? 'ok' : /rejected|marginCanceled/.test(st) ? 'bad' : /canceled/.test(st) ? 'dim' : '';
          return (
            <tr key={i + ':' + (o.oid || '') + ':' + (row.status || '')}>
              <td className="term__histtime">{histTime(row.statusTimestamp || o.timestamp)}</td>
              <td>{o.orderType || (o.isTrigger ? 'Trigger' : 'Limit')}</td>
              <td><Link to={'/terminal/' + sym}>{sym}</Link></td>
              <td><span className={'term__pillside ' + (good ? 'up' : 'down')}>{dirLabel}</span></td>
              <td>{+o.origSz > 0 ? `${+o.origSz} ${sym}` : 'Position'}</td>
              <td>{o.isTrigger ? fmtPx(+o.triggerPx) : fmtPx(+o.limitPx)}</td>
              <td className="r"><span className={'term__status term__status--' + (stCls || 'dim')}>{st.replace(/([a-z])([A-Z])/g, '$1 $2')}</span></td>
            </tr>);
        })}</tbody>
      </table>
    );
  }
  return <div className="term__empty"><Icon name="doc" size={22} /><b>No {btab.toLowerCase()}</b><span>Coming soon.</span></div>;
}

/* ---- self-contained account panel (strip + body + close/TP-SL modals) ----
   Used by the prediction terminal; owns its own hooks and signing handlers so any
   screen can mount the universal account surface with one line. */
const PANEL_TABS = ['Balances', 'Positions', 'Predictions', 'Open Orders', 'Trade History', 'Order History'];

export function AccountPanel({ note }: { note?: string }) {
  const auth = useAuth();
  const signer = useHlSigner();
  const agent = useHlAgent();
  const devHlAddr = import.meta.env.DEV ? sessionStorage.getItem('hence.devHlAddr') : null;
  const acctAddr = devHlAddr || auth.address || undefined;
  const hl = useHlAccount(acctAddr);
  const [btab, setBtab] = useState('Positions');

  const [preds, setPreds] = useState<any[] | null>(null);
  useEffect(() => {
    setPreds(null);
    if (!acctAddr) return;
    let alive = true;
    const load = () => { pmPositions(acctAddr).then((r: any[]) => { if (alive) setPreds(r || []); }).catch(() => { if (alive) setPreds((prev) => prev || []); }); };
    load();
    const id = window.setInterval(load, 45_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [acctAddr]);

  // same agent rail as the perp terminal (approve-once + self-heal)
  const runWithAgent = makeRunWithAgent(agent);

  const [closing, setClosing] = useState<string | null>(null);
  const [closeCfm, setCloseCfm] = useState<any | null>(null);
  const [closePct, setClosePct] = useState(100);
  const [skipCloseCfm, setSkipCloseCfm] = useState<boolean>(() => { try { return localStorage.getItem('hence.term.skipCloseConfirm') === '1'; } catch { return false; } });
  const doClose = async (p: any, pct = 100) => {
    if (!signer.ready || !signer.sign) { toast('Connect a wallet to close', { icon: 'wallet' }); return; }
    const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
    if (!(mk > 0)) { toast('No live price to close against', { icon: 'close' }); return; }
    const frac = Math.min(100, Math.max(1, pct)) / 100;
    const sym = p.coin.split(':').pop();
    setClosing(p.coin);
    try {
      const notional = p.sz * frac * mk;
      // Closes earn a builder fee too — attach it, but ONLY if the cap is already approved
      // (prompt:false); never interrupt an exit with a signature prompt.
      const bf = await resolveBuilder(signer.sign, signer.address!, notional, { prompt: false });
      const r = await runWithAgent((sign) => placeOrder(sign, {
        coin: p.coin, isBuy: p.side === 'Short', usd: notional, markPrice: mk,
        type: 'Market', reduceOnly: true, slippage: 0.01, builder: bf.builder,
      }));
      if ('error' in r) toast(r.error, { icon: 'close' });
      else {
        setCloseCfm(null);
        track('trade_submitted', {
          coin: p.coin, side: p.side === 'Short' ? 'buy' : 'sell', status: r.status,
          usd: notional, venue: String(p.coin).includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
          builder_attached: !!bf.builder, hence_fee_usd: bf.feeUsd, market: 'perp', source: 'close',
        });
        toast(r.status === 'filled'
          ? `Closed ${r.detail.totalSz} ${sym} @ ${fmtPx(+r.detail.avgPx)}${frac < 1 ? ` (${pct}%)` : ''}`
          : `Close order submitted · ${sym}`, { ticker: sym });
        hl.refresh?.();
      }
    } catch (e: any) { toast(e?.message || 'Close failed', { icon: 'close' }); }
    finally { setClosing(null); }
  };


  /* ---- close EVERYTHING ----
     One click against the whole book, so two rules that the single-position close
     does not need:
       - it ALWAYS confirms. `skipCloseCfm` is a preference someone set for closing one
         position; silently extending it to "flatten my entire account" is how a muscle-memory
         click liquidates a book. The preference deliberately does not apply here.
       - it reports per-position outcomes — partial success is the expected failure mode,
         not an edge case. */
  const [closingAll, setClosingAll] = useState(false);
  const [closeAllCfm, setCloseAllCfm] = useState(false);
  const doCloseAll = async () => {
    if (!signer.ready || !signer.sign || !signer.address) { toast('Connect a wallet to close', { icon: 'wallet' }); return; }
    setClosingAll(true);
    try {
      const out = await closeAllPositions(runWithAgent, signer.sign, signer.address, hl.positions, { slippage: 0.01 });
      setCloseAllCfm(false);
      if (!out.failed.length) toast(`Closed ${out.closed.length} position${out.closed.length === 1 ? '' : 's'}`, { icon: 'check' });
      else toast(`Closed ${out.closed.length}, failed ${out.failed.length}: ${out.failed.map((f) => String(f.coin).split(':').pop()).join(', ')}`, { icon: 'alert' });
      hl.refresh?.();
    } catch (e: any) { toast(e?.message || 'Close all failed', { icon: 'close' }); }
    finally { setClosingAll(false); }
  };

  const [cancelling, setCancelling] = useState<number | null>(null);
  const doCancel = async (o: any) => {
    if (!signer.ready || !signer.sign) { toast('Connect a wallet to cancel', { icon: 'wallet' }); return; }
    setCancelling(o.oid);
    try {
      const r = await runWithAgent((sign) => cancelOrder(sign, o.coin, o.oid));
      if ('error' in r) toast(r.error, { icon: 'close' });
      else { toast(`Cancelled ${String(o.coin).split(':').pop()} order`, { ticker: String(o.coin).split(':').pop() }); hl.refresh?.(); }
    } catch (e: any) { toast(e?.message || 'Cancel failed', { icon: 'close' }); }
    finally { setCancelling(null); }
  };

  const [tpslFor, setTpslFor] = useState<any | null>(null);
  const [tpIn, setTpIn] = useState('');
  const [slIn, setSlIn] = useState('');
  const [tpslBusy, setTpslBusy] = useState(false);
  const doTpsl = async () => {
    const p = tpslFor;
    if (!p || !signer.ready || !signer.sign) { toast('Connect a wallet first', { icon: 'wallet' }); return; }
    const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
    const tp = parseFloat(tpIn) || 0, sl = parseFloat(slIn) || 0;
    if (!tp && !sl) { toast('Set a take-profit or stop-loss price', { icon: 'card' }); return; }
    const long = p.side === 'Long';
    if (tp && (long ? tp <= mk : tp >= mk)) { toast(`Take profit must be ${long ? 'above' : 'below'} the mark (${fmtPx(mk)})`, { icon: 'close' }); return; }
    if (sl && (long ? sl >= mk : sl <= mk)) { toast(`Stop loss must be ${long ? 'below' : 'above'} the mark (${fmtPx(mk)})`, { icon: 'close' }); return; }
    const sym = p.coin.split(':').pop();
    setTpslBusy(true);
    try {
      const r = await runWithAgent((sign) => placeTpsl(sign, {
        coin: p.coin, positionSide: p.side, sz: p.sz, tp: tp || undefined, sl: sl || undefined,
      }));
      if ('error' in r) toast(r.error, { icon: 'close' });
      else {
        setTpslFor(null);
        toast([tp ? `TP @ ${fmtPx(tp)}` : '', sl ? `SL @ ${fmtPx(sl)}` : ''].filter(Boolean).join(' · ') + ` set on ${sym}`, { ticker: sym });
        hl.refresh?.();
      }
    } catch (e: any) { toast(e?.message || 'TP/SL failed', { icon: 'close' }); }
    finally { setTpslBusy(false); }
  };

  // keep pending sheets tied to the wallet that opened them
  const addrRef = useRef(acctAddr);
  useEffect(() => {
    if (addrRef.current !== acctAddr) { addrRef.current = acctAddr; setCloseCfm(null); setTpslFor(null); }
  }, [acctAddr]);

  return (
    <>
      <div className="term__bottom-bar">
        <div className="term__bottom-tabs">{PANEL_TABS.map((tb) => {
          const n = hl.connected && hl.loaded
            ? tb === 'Positions' ? hl.positions.length
              : tb === 'Predictions' ? (preds?.length || 0)
                : tb === 'Open Orders' ? hl.orders.length + hl.triggers.length
                  : tb === 'Balances' ? (hl.accountValue > 0 ? 1 : 0) : 0
            : 0;
          return <button key={tb} className={tb === btab ? 'on' : ''} onClick={() => setBtab(tb)}>{tb}{n > 0 ? ` (${n})` : ''}</button>;
        })}</div>
        {(note || (btab === 'Positions' && hl.positions.length > 0)) ? (
          <div className="term__bottom-tools">
            {note ? <span className="muted">{note}</span> : null}
            {btab === 'Positions' && hl.positions.length > 0 && <button className="term__closeall" disabled={closingAll} onClick={() => setCloseAllCfm(true)}>
              {closingAll ? 'Closing…' : 'Close all'}
            </button>}
          </div>
        ) : null}
      </div>
      <div className="term__bottom-body">
        <BottomBody btab={btab} hl={hl} addr={acctAddr} preds={preds} onCancel={doCancel} cancelling={cancelling} closing={closing}
          onClose={(p: any) => { if (skipCloseCfm) void doClose(p, 100); else { setClosePct(100); setCloseCfm(p); } }}
          onTpsl={(p: any) => { setTpIn(''); setSlIn(''); setTpslFor(p); }} />
      </div>


      {closeAllCfm && (() => {
        const total = hl.positions.reduce((s: number, p: any) => s + p.positionValue, 0);
        const upnl = hl.positions.reduce((s: number, p: any) => s + p.uPnl, 0);
        return (
          <div className="term__cfm" onClick={(e) => { if (e.target === e.currentTarget && !closingAll) setCloseAllCfm(false); }}>
            <div className="term__cfm-card">
              <div className="term__cfm-h">
                <span className="term__cfm-side term__cfm-side--short">Close all</span>
                <b>{hl.positions.length} position{hl.positions.length === 1 ? '' : 's'}</b><span className="term__cfm-type">Market</span>
                <button className="term__cfm-x" disabled={closingAll} onClick={() => setCloseAllCfm(false)}><Icon name="close" size={16} /></button>
              </div>
              <div className="term__cfm-rows">
                <div><span>Total value</span><b>{fmtUsd(total)}</b></div>
                <div><span>Unrealized PnL</span><b className={upnl >= 0 ? 'up' : 'down'}>{upnl >= 0 ? '+' : ''}{fmtUsd(upnl)}</b></div>
              </div>
              <div className="term__cfm-fine">Closes every position at market (reduce-only), one at a time. This flattens the whole account — it always asks, even with confirmations turned off.</div>
              <div className="term__cfm-actions">
                <button className="term__cfm-cancel" disabled={closingAll} onClick={() => setCloseAllCfm(false)}>Cancel</button>
                <button className="term__cfm-go term__cfm-go--short" disabled={closingAll} onClick={() => void doCloseAll()}>
                  {closingAll ? <><span className="term__cop-spin" /> Closing…</> : <>Close {hl.positions.length} position{hl.positions.length === 1 ? '' : 's'} <Icon name="arrowRight" size={13} /></>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {closeCfm && (() => {
        const p = closeCfm;
        const sym = p.coin.split(':').pop();
        const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
        const frac = closePct / 100;
        return (
          <div className="term__cfm" onClick={(e) => { if (e.target === e.currentTarget && closing !== p.coin) setCloseCfm(null); }}>
            <div className="term__cfm-card">
              <div className="term__cfm-h">
                <span className={'term__cfm-side term__cfm-side--' + (p.side === 'Long' ? 'long' : 'short')}>Close {p.side}</span>
                <b>{sym}</b><span className="term__cfm-type">Market</span>
                <button className="term__cfm-x" disabled={closing === p.coin} onClick={() => setCloseCfm(null)}><Icon name="close" size={16} /></button>
              </div>
              <div className="term__cfm-rows">
                <div><span>Size</span><b>{closePct === 100 ? p.sz : +(p.sz * frac).toPrecision(5)} {sym}</b></div>
                <div><span>Est. value</span><b>{fmtUsd(p.sz * frac * mk)}</b></div>
                <div><span>Unrealized PnL</span><b className={p.uPnl >= 0 ? 'up' : 'down'}>{p.uPnl >= 0 ? '+' : ''}{fmtUsd(p.uPnl * frac)}</b></div>
              </div>
              <div className="term__cfm-pcts">{[25, 50, 75, 100].map((v) => (
                <button key={v} className={v === closePct ? 'on' : ''} onClick={() => setClosePct(v)}>{v}%</button>
              ))}</div>
              <div className="term__cfm-fine">Closes at market (reduce-only, fee-free), up to 1% from mark.</div>
              <div className="term__cfm-actions">
                <label className="term__cfm-skip"><input type="checkbox" checked={skipCloseCfm} onChange={(e) => { setSkipCloseCfm(e.target.checked); try { localStorage.setItem('hence.term.skipCloseConfirm', e.target.checked ? '1' : ''); } catch { /* storage off */ } }} /> Don't show again</label>
                <button className="term__cfm-cancel" disabled={closing === p.coin} onClick={() => setCloseCfm(null)}>Cancel</button>
                <button className={'term__cfm-go term__cfm-go--' + (p.side === 'Long' ? 'short' : 'long')} disabled={closing === p.coin} onClick={() => void doClose(p, closePct)}>
                  {closing === p.coin ? <><span className="term__cop-spin" /> Closing…</> : <>Close {closePct < 100 ? closePct + '%' : p.side} <Icon name="arrowRight" size={13} /></>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {tpslFor && (() => {
        const p = tpslFor;
        const sym = p.coin.split(':').pop();
        const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
        const long = p.side === 'Long';
        const tp = parseFloat(tpIn) || 0, sl = parseFloat(slIn) || 0;
        const gain = tp ? (long ? tp - p.entryPx : p.entryPx - tp) * p.sz : 0;
        const loss = sl ? (long ? p.entryPx - sl : sl - p.entryPx) * p.sz : 0;
        const existing = hl.triggers.filter((t: any) => t.coin === p.coin);
        return (
          <div className="term__cfm" onClick={(e) => { if (e.target === e.currentTarget && !tpslBusy) setTpslFor(null); }}>
            <div className="term__cfm-card">
              <div className="term__cfm-h">
                <span className={'term__cfm-side term__cfm-side--' + (long ? 'long' : 'short')}>{p.side}</span>
                <b>{sym} TP / SL</b><span className="term__cfm-type">{p.sz} @ {fmtPx(p.entryPx)}</span>
                <button className="term__cfm-x" disabled={tpslBusy} onClick={() => setTpslFor(null)}><Icon name="close" size={16} /></button>
              </div>
              <div className="term__cfm-rows">
                <div><span>Mark price</span><b>{fmtPx(mk)}</b></div>
                {existing.map((t: any) => (
                  <div key={t.oid}><span>{t.tpsl === 'tp' ? 'Active TP' : 'Active SL'} @ {fmtPx(t.triggerPx)}</span>
                    <b><button className="term__ocancel" onClick={() => doCancel(t)}>Cancel</button></b></div>
                ))}
              </div>
              <label className="term__field"><span>TP price</span>
                <input type="text" inputMode="decimal" value={tpIn} placeholder={long ? `> ${fmtPx(mk)}` : `< ${fmtPx(mk)}`}
                  onChange={(e) => setTpIn(e.target.value.replace(/[^0-9.]/g, ''))} />
                <span className="term__field-unit">{tp > 0 && gain > 0 ? `+${fmtUsd(gain)}` : 'USDC'}</span></label>
              <label className="term__field"><span>SL price</span>
                <input type="text" inputMode="decimal" value={slIn} placeholder={long ? `< ${fmtPx(mk)}` : `> ${fmtPx(mk)}`}
                  onChange={(e) => setSlIn(e.target.value.replace(/[^0-9.]/g, ''))} />
                <span className="term__field-unit">{sl > 0 && loss > 0 ? `−${fmtUsd(loss)}` : 'USDC'}</span></label>
              <div className="term__cfm-fine">Triggers close the whole position at market (reduce-only, fee-free). Estimates are vs your entry; resting TP/SL show under Open Orders.</div>
              <div className="term__cfm-actions">
                <button className="term__cfm-cancel" disabled={tpslBusy} onClick={() => setTpslFor(null)}>Cancel</button>
                <button className="term__cfm-go term__cfm-go--long" disabled={tpslBusy || (!tp && !sl)} onClick={() => void doTpsl()}>
                  {tpslBusy ? <><span className="term__cop-spin" /> Placing…</> : <>Set TP/SL <Icon name="arrowRight" size={13} /></>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
