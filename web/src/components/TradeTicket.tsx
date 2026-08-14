import { useEffect, useRef, useState } from 'react';
import { useTrade, closeTrade, openTrade } from '../lib/tradeTicket';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAgent } from '../hooks/useHlAgent';
import { makeRunWithAgent } from '../lib/hl-run';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount } from '../hooks/useHlAccount';
import { marginGap, marginShortfall } from '../lib/thesis-sizing';
import { useMarketReady } from '../hooks/useMarket';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { HenceSpinner } from './Loading';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import { toast } from '../lib/ui.js';
import { track } from '../lib/analytics';
import { MARKET_PRICE_PROTECTION, isTestnet, quoteOrder, placeOrder, updateLeverage, marketLimits, type PlaceOrderParams } from '../lib/hyperliquid-exchange';
import { resolveBuilder } from '../lib/builder-fee';
import { getConfig, feeToPercent, type HenceConfig } from '../lib/config';
// @ts-ignore — JS helper at the route/market-symbol boundary
import { safeSymbol } from '../lib/safe-html.js';
import '../styles/trade-ticket.css';

/* =========================================================================
   TradeTicket — place a Hyperliquid perp order straight from the dock. A
   bottom-anchored ticket (mirrors the Ask-Hence dock panel): Long/Short,
   USD amount, Market/Limit, a live size quote, and a signed on-device
   submit via the SAME path the terminal uses (useHlSigner → placeOrder).
   Keys never leave the browser. Signed-out → Connect.
   ========================================================================= */
const AMT_CHIPS = [25, 100, 500, 1000];

export function TradeTicket() {
  const { open, sym, side: seedSide, opts, nonce } = useTrade();
  const auth = useAuth();
  const signer = useHlSigner();
  const agent = useHlAgent();
  const marketReady = useMarketReady();
  const hl = useHlAccount(open ? auth.address : undefined);
  const [side, setSide] = useState<'Long' | 'Short'>('Long');
  const [otype, setOtype] = useState<'Market' | 'Limit'>('Market');
  const [amt, setAmt] = useState('');
  const [limit, setLimit] = useState('');
  const [placing, setPlacing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cfg, setCfg] = useState<HenceConfig | null>(null);
  const [lev, setLev] = useState(1);
  const [mkt, setMkt] = useState<{ maxLeverage: number; onlyIsolated: boolean } | null>(null);
  const [levSheet, setLevSheet] = useState(false);
  const levTouched = useRef(false);
  const [review, setReview] = useState<{ address: string; params: PlaceOrderParams; size: number; price: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { getConfig().then(setCfg).catch(() => {}); }, []);

  // reset per open — a plan-armed open (opts) seeds size/type/limit; a plain open starts clean
  useEffect(() => {
    if (!open) return;
    setSide(seedSide);
    setOtype(opts?.otype || 'Market');
    setAmt(opts?.usd ? String(opts.usd) : '');
    setLimit(opts?.limit ? String(opts.limit) : '');
    if (opts?.lev) { setLev(Math.round(opts.lev)); levTouched.current = true; } else { levTouched.current = false; }
    setPlacing(false); setReview(null);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, open]);

  // Escape closes (unless a higher overlay owns it)
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.cmdk-overlay, .sc-overlay, .modal, .acct-ov')) return;
      e.preventDefault(); closeTrade();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [open]);

  const safeSym = safeSymbol(sym);
  const coin = marketReady && safeSym ? market.coinFor(safeSym) : '';
  const t = safeSym ? getTicker(safeSym) : null;
  // The dock ticket has no independent stream/candle quote, so only a hydrated
  // live ticker is acceptable. Bundled seed prices are display fixtures, never orders.
  const mark = t && (t as any).real && Number((t as any).price) > 0 ? Number((t as any).price) : 0;
  const usd = parseFloat(amt) || 0;
  const limitPx = parseFloat(limit) || 0;
  const refPx = otype === 'Limit' ? limitPx : mark;
  const size = refPx > 0 && usd > 0 ? usd / refPx : 0;
  const buy = side === 'Long';
  // Tradability mirrors the terminal: native HL perps + the trade.xyz HIP-3 dex
  // (stocks/commodities/fx/indices). Distinguish "still booting" from "not tradeable"
  // so BTC doesn't flash Read-only while the universe loads.
  const notTradeable = marketReady && (!coin || !market.isTradeable(safeSym));
  const readOnly = !marketReady || notTradeable;
  const viaXyz = coin.includes(':');
  const builderPct = cfg?.hlBuilder ? feeToPercent(cfg.hlBuilderFee) : '';
  const maxLev = mkt?.maxLeverage || 0;

  // leverage: load the asset's cap, and default the selector to the account's CURRENT leverage
  // for this coin (from an open position) so a quick add-on doesn't silently change it.
  useEffect(() => {
    if (!open || readOnly || !coin) { setMkt(null); return; }
    let alive = true;
    marketLimits(coin).then((l) => { if (alive) setMkt(l); }).catch(() => { if (alive) setMkt(null); });
    return () => { alive = false; };
  }, [open, coin, readOnly]);
  useEffect(() => {
    if (levTouched.current) return;
    const pos = (hl.positions || []).find((p: any) => p.coin === coin);
    setLev(pos && pos.leverage >= 1 ? Math.round(pos.leverage) : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, nonce, hl.positions]);

  useEffect(() => { setReview(null); }, [signer.address, safeSym]);

  if (!open) return null;

  const params = (): PlaceOrderParams => ({
    coin, isBuy: buy, usd, markPrice: mark, type: otype,
    limitPrice: otype === 'Limit' ? limitPx : undefined,
  });

  const prepareReview = async () => {
    if (!auth.authenticated) { auth.login(); return; }
    if (!signer.ready || !signer.sign) { toast('Connect a wallet to trade', { icon: 'wallet' }); return; }
    if (readOnly) { toast('This market is read-only in Hence — live orders aren’t available for it yet.', { icon: 'info' }); return; }
    if (!hl.loaded) { toast(hl.unavailable ? 'Hyperliquid account data is unavailable — trading is paused' : 'Verifying your Hyperliquid account…', { icon: 'info' }); return; }
    if (usd <= 0) { toast('Enter an amount to trade', { icon: 'card' }); return; }
    // same rule as the terminal ticket and the run sheet (lib/thesis-sizing)
    { const short = marginShortfall(usd / Math.max(1, lev), hl.available); if (short) { toast(short, { icon: 'card' }); return; } }
    if (!(mark > 0)) { toast('No live price for this market yet', { icon: 'close' }); return; }
    if (otype === 'Limit' && limitPx <= 0) { toast('Enter a limit price', { icon: 'card' }); return; }
    try {
      const reviewedParams = params();
      const q = await quoteOrder(reviewedParams);
      if (!(q.size > 0)) { toast('Amount too small — size rounds to zero', { icon: 'close' }); return; }
      setReview({ address: signer.address!, params: reviewedParams, size: q.size, price: q.price });
    } catch (e: any) {
      toast(e?.message || 'Could not prepare order', { icon: 'close' });
    }
  };

  const execute = async () => {
    if (!review || !signer.ready || !signer.sign || review.address !== signer.address || !hl.loaded || readOnly) { setReview(null); return; }
    setPlacing(true);
    try {
      // L1 orders must be agent-signed (HL's Exchange domain is chainId 1337 — external
      // wallets refuse it). Approve-once + self-heal, same rail as the terminal.
      const runWithAgent = makeRunWithAgent(agent);
      // Set the asset's leverage on HL FIRST (agent-signed, no wallet popup) so the position
      // opens at the chosen leverage — mirrors the terminal. Skip if a position already sits
      // at this leverage. `usd` stays the notional; leverage only changes the margin required.
      const cross = !(mkt?.onlyIsolated);
      const openPos = (hl.positions || []).find((p: any) => p.coin === review.params.coin);
      if (mkt && lev >= 1 && (!openPos || Math.round(openPos.leverage) !== lev)) {
        const lr = await runWithAgent((sign) => updateLeverage(sign, review.params.coin, lev, cross));
        if (lr && 'error' in lr) { toast(`Couldn't set ${lev}x leverage: ${lr.error}`, { icon: 'close' }); setPlacing(false); return; }
      }
      // Attach the Hence routing fee (funds the app) — the SAME rail the terminal uses.
      // HL requires a one-time, user-signed max-fee cap; resolveBuilder prompts for it once,
      // caches it, and falls back to fee-free on any technical failure so a trade is never
      // stranded. A hard wallet reject cancels the order (the review stays open).
      setApproving(true);
      const bf = await resolveBuilder(signer.sign, review.address, review.params.usd || 0, { prompt: true });
      setApproving(false);
      if (bf.rejected) { toast('Order not placed — the routing fee is part of trading on Hence.', { icon: 'close' }); return; }

      const r = await runWithAgent((sign) => placeOrder(sign, { ...review.params, builder: bf.builder }));
      if (r.ok) {
        // volume + estimated Hence fee for the revenue dashboard
        track('trade_submitted', {
          coin: review.params.coin, side: buy ? 'buy' : 'sell', status: r.status, leverage: lev,
          usd: review.params.usd || 0, venue: String(review.params.coin).includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
          builder_attached: !!bf.builder, hence_fee_usd: bf.feeUsd, market: 'perp', source: 'quick_ticket',
        });
        toast(`${buy ? 'Bought' : 'Sold'} ${review.size} ${safeSym} · ${r.status}`, { ticker: safeSym });
        closeTrade();
      } else {
        toast(('error' in r && r.error) || 'Order rejected', { icon: 'close' });
      }
    } catch (e: any) {
      toast(e?.message || 'Order failed', { icon: 'close' });
    } finally {
      setPlacing(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !placing) { e.preventDefault(); review ? execute() : prepareReview(); }
  };

  return (
    <div className="tt-wrap" role="dialog" aria-label={`Trade ${sym}`}>
      <div className="tt">
        <header className="tt__head">
          <Logo sym={safeSym} size={22} />
          <div className="tt__id"><b>{safeSym}</b><span>{coin && coin !== safeSym ? coin : (t?.name || '')}</span></div>
          <span className="tt__mark">{mark > 0 ? market.fmtPrice(mark) : '—'}</span>
          {/* the full terminal (chart + book + positions) for this asset */}
          <a className="tt__x" href={`#/terminal/${encodeURIComponent(safeSym)}`} onClick={closeTrade} aria-label="Open in terminal" title="Open in terminal"><Icon name="candles" size={15} /></a>
          <button className="tt__x" onClick={closeTrade} aria-label="Close"><Icon name="close" size={15} /></button>
        </header>

        <div className="tt__side">
          <button className={'tt__sidebtn buy' + (buy ? ' on' : '')} onClick={() => { setSide('Long'); setReview(null); }}>Buy / Long</button>
          <button className={'tt__sidebtn sell' + (!buy ? ' on' : '')} onClick={() => { setSide('Short'); setReview(null); }}>Sell / Short</button>
        </div>

        <div className="tt__row">
          <div className="tt__seg">
            {(['Market', 'Limit'] as const).map((o) => (
              <button key={o} className={o === otype ? 'on' : ''} onClick={() => { setOtype(o); setReview(null); }}>{o}</button>
            ))}
          </div>
          {otype === 'Limit' && (
            <input className="tt__limit" inputMode="decimal" placeholder="Limit price" value={limit}
              onChange={(e) => { setLimit(e.target.value.replace(/[^0-9.]/g, '')); setReview(null); }} onKeyDown={onKey} />
          )}
          {maxLev > 1 && (
            <button type="button" className="tt__levbtn" onClick={() => setLevSheet(true)} title="Adjust leverage">
              {lev}&times; <Icon name="sliders" size={12} />
            </button>
          )}
        </div>

        {levSheet && maxLev > 1 && (
          <>
            <div className="tt__levpop-bd" onClick={() => setLevSheet(false)} />
            <div className="tt__levpop" role="dialog" aria-label="Adjust leverage">
              <div className="tt__levpop-h"><b>Adjust Leverage</b><button onClick={() => setLevSheet(false)} aria-label="Close"><Icon name="close" size={14} /></button></div>
              <div className="tt__levpop-row"><span>Maximum leverage</span><b>{maxLev}&times;</b></div>
              <div className="tt__levpop-slide">
                <input type="range" className="tt__lev-slider" min={1} max={maxLev} step={1} value={Math.min(lev, maxLev)}
                  onChange={(e) => { setLev(Number(e.target.value)); levTouched.current = true; setReview(null); }} aria-label="Leverage" />
                <input className="tt__levpop-num" type="text" inputMode="numeric" value={lev}
                  onChange={(e) => { const v = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); setLev(Number.isFinite(v) ? Math.min(Math.max(1, v), maxLev) : 1); levTouched.current = true; setReview(null); }} aria-label="Leverage value" />
              </div>
              <div className="tt__levpop-row"><span>Margin required &middot; {lev}&times;</span><b>{usd > 0 ? '$' + (usd / Math.max(1, lev)).toFixed(2) : '—'}</b></div>
              <div className="tt__levpop-sub">Set on Hyperliquid when you place the order.</div>
              <button className="tt__levpop-cta" onClick={() => setLevSheet(false)}>Confirm {lev}&times;</button>
            </div>
          </>
        )}

        <div className="tt__amt">
          <span className="tt__amt-cur">$</span>
          <input ref={inputRef} className="tt__amt-in" inputMode="decimal" placeholder="0" value={amt}
            onChange={(e) => { setAmt(e.target.value.replace(/[^0-9.]/g, '')); setReview(null); }} onKeyDown={onKey} aria-label="Amount in USD" />
          <span className="tt__amt-est">{size > 0 ? `≈ ${size.toFixed(size < 1 ? 4 : 2)} ${safeSym}` : ''}</span>
        </div>
        <div className="tt__chips">
          {AMT_CHIPS.map((v) => <button key={v} onClick={() => { setAmt(String(v)); setReview(null); }}>${v}</button>)}
        </div>

        {(() => {
          /* the dock ticket ran the same unguarded path the terminal did: an order whose
             margin cannot be funded sails to Review and dies at the venue after signing.
             One shared rule (lib/thesis-sizing), compact presentation. */
          const short = auth.authenticated && hl.loaded && usd > 0 ? marginGap(usd / Math.max(1, lev), hl.available) : null;
          return short ? <div className="tt__warn">Needs ${short.needed.toFixed(2)} margin · ${short.available.toFixed(2)} available</div> : null;
        })()}
        {review && <div className="tt__foot">Review: {review.size} {safeSym} · {otype === 'Market' ? `${buy ? 'max' : 'min'} ${market.fmtPrice(review.price)}` : `limit ${market.fmtPrice(review.price)}`}{maxLev > 1 ? ` · ${lev}×` : ''} · {isTestnet() ? 'testnet' : 'mainnet real funds'}{builderPct ? ` · incl. ${builderPct} Hence routing fee` : ''}</div>}
        <button className={'tt__go ' + (buy ? 'buy' : 'sell')}
          onClick={notTradeable
            ? () => { closeTrade(); location.hash = `#/terminal/${encodeURIComponent(safeSym)}`; }
            : review ? execute : prepareReview}
          disabled={placing || approving || !marketReady || (auth.authenticated && !notTradeable && !hl.loaded)
            || !!(auth.authenticated && !notTradeable && hl.loaded && usd > 0 && marginGap(usd / Math.max(1, lev), hl.available))}>
          {approving ? 'Approve fee in wallet…'
            : placing ? <HenceSpinner size={16} />
            : !marketReady ? 'Loading markets…'
              : notTradeable ? 'Read-only · open full terminal'
                : !auth.authenticated ? 'Connect to trade'
                  : !hl.loaded ? (hl.unavailable ? 'Account data unavailable' : 'Verifying account…')
                    : review ? `Confirm ${buy ? 'Buy' : 'Sell'} · $${usd.toLocaleString()}`
                      : `Review ${buy ? 'Buy' : 'Sell'} ${safeSym}${usd > 0 ? ` · $${usd.toLocaleString()}` : ''}`}
        </button>
        <div className="tt__foot">{notTradeable
          ? 'Read-only market · live orders aren’t available for this asset yet'
          : `Perp order via ${viaXyz ? 'trade.xyz on Hyperliquid' : 'Hyperliquid'} · signed on your device · market orders use ${(MARKET_PRICE_PROTECTION * 100).toFixed(2)}% max slippage`}</div>
      </div>
    </div>
  );
}

export { openTrade };
