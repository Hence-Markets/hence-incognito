import { track } from '../lib/analytics';
// @ts-ignore — JS module
import * as me from '../lib/me.js';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import '../styles/terminal.css';
import '../styles/accounts.css';
import { Shell } from '../components/Shell';

// Prediction mode is a separate (lazy) chunk so the heavy CLOB-v2 trade client only
// loads when you actually open a prediction market — perp-only users never pay for it.
const PredictBody = lazy(() => import('./PredictTerminal').then((m) => ({ default: m.PredictBody })));
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { TradingChart, type Candle } from '../components/TradingChart';
import { type LiveFeed } from '../components/OrderBook';
import { SealedBook } from '../components/SealedBook';
import { useEpoch } from '../hooks/useEpoch';
import { useShielded } from '../lib/useShielded';
import ShieldedAcct from '../components/ShieldedAcct';
import SealedOrders from '../components/SealedOrders';
import { placeShieldedOrder, shieldedReady } from '../lib/order';
import { openStream, type StreamStatus, type BookMsg, type TradesMsg } from '../lib/stream';
import { MarketSelect, getWatch } from '../components/MarketSelect';
import { ScreenHead } from '../components/ScreenHead';
import { useMarketReady } from '../hooks/useMarket';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount } from '../hooks/useHlAccount';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAgent } from '../hooks/useHlAgent';
import { makeRunWithAgent } from '../lib/hl-run';
import { closeAllPositions } from '../lib/hl-close';
import { useTradeCopilot, type CopilotLive } from '../hooks/useTradeCopilot';
import { marginGap, marginShortfall } from '../lib/thesis-sizing';
import { primeRebateStatus } from '../lib/rebate-status';
import { estLiqPrice } from '../lib/liq-estimate';
import { MARKET_PRICE_PROTECTION, isTestnet, placeOrder, placeTpsl, quoteOrder, updateLeverage, cancelOrder, marketLimits, queryMaxBuilderFee, approveBuilderFee, type PlaceOrderParams } from '../lib/hyperliquid-exchange';
import { consumeArm } from '../lib/tradeTicket';
import { getConfig, feeToPercent, type HenceConfig } from '../lib/config';
import { resolveBuilder } from '../lib/builder-fee';
import type { BuilderCode } from '../lib/hyperliquid-sign';
import { getTicker } from '../lib/data.js';
// @ts-ignore — JS module (history feeds go through the same /api/info proxy as useHlAccount)
import { info } from '../lib/hydromancer.js';
// @ts-ignore — JS module (Polymarket positions for the unified Predictions tab)
import { positions as pmPositions } from '../lib/polymarket.js';
import * as market from '../lib/market.js';
import { isAvantisSymbol } from '../lib/avantisUniverse';
import { marketOf } from '../lib/markets';
import type { Residual } from '../lib/order';
import * as fmp from '../lib/fmp.js';
import * as accounts from '../lib/accounts.js';
import { toast } from '../lib/ui.js';
import { fmtPx, fmtUsd, fmtPct } from '../lib/fmt';
import { Skeleton } from '../components/Loading';
import { BottomBody } from '../components/TerminalAccount';
import { pushRecent } from '../lib/recents';
// @ts-ignore — JS safety helpers used at the route/news trust boundary
import { safeHttpUrl, safeSymbol } from '../lib/safe-html.js';

const ORDER_TYPES = ['Market', 'Limit'] as const;
const SLIP_PRESETS = [0.5, 1, 2, 5];   // max-slippage presets (%) for market orders
const M_TABS = ['Markets', 'Trade', 'Account'] as const;
/* INCOGNITO: seven tabs became one. Balances, Positions, Predictions, Open Orders, Trade
   History, Order History and Bots were each a read of the user's Hyperliquid clearinghouse —
   permanently empty here at best, and at worst another venue's data sitting under a bar
   labelled "Sealed orders". The only history this app creates is the orders it sealed. */
const B_TABS = ['Sealed orders'];

function accountsList() {
  const out: { id: string; name: string }[] = [];
  // The terminal currently executes only against the authenticated Privy wallet.
  // Verified external connections stay in Accounts until an execution adapter can
  // actually switch the reads/signing context; listing them here would be cosmetic.
  if (accounts.hasWallet()) out.push({ id: 'hence', name: 'Hence Wallet' });
  return out;
}

function timeAgo(s?: string) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return mins + 'm';
  if (mins < 1440) return Math.round(mins / 60) + 'h';
  return Math.round(mins / 1440) + 'd';
}

// Unified terminal shell: ONE component mounted at /terminal/* keeps <Shell> (and the
// dock/chrome) mounted while you morph between perp and prediction markets — instead of
// remounting a whole new page. The route decides which body renders inside the shell.
export default function Terminal() {
  const loc = useLocation();
  const rest = loc.pathname.replace(/^\/terminal\/?/, '');       // '' | 'BTC' | 'm/558938'
  const parts = rest.split('/').filter(Boolean);
  const predict = parts[0] === 'm';
  const id = predict ? parts[1] : undefined;
  const sym = predict ? '' : (safeSymbol(parts[0] || 'BTC') || 'BTC');
  // feed the command menu's "Recent" group — only when the user CHOSE a market (the bare
  // /terminal default of BTC must not monopolize recents on every glance visit)
  useEffect(() => { if (parts[0] && sym) pushRecent(sym); }, [parts[0], sym]);
  return (
    <Shell dockActive="trade">
      {predict && id
        ? <Suspense fallback={<div className="term term--pred"><div className="term__loading">Loading market…</div></div>}><PredictBody id={id} /></Suspense>
        : <PerpBody sym={sym} />}
    </Shell>
  );
}

function PerpBody({ sym }: { sym: string }) {
  const pair = (sym || 'BTC').toUpperCase();
  const nav = useNavigate();
  const ready = useMarketReady();
  const auth = useAuth();
  // Account state must always belong to the authenticated wallet. DEV-only read QA:
  // sessionStorage 'hence.devHlAddr' views any address's positions/orders/balances
  // (devPfAddr pattern — display only; signing needs the real authenticated wallet).
  const devHlAddr = import.meta.env.DEV ? sessionStorage.getItem('hence.devHlAddr') : null;
  const acctAddr = devHlAddr || auth.address || undefined;
  const hl = useHlAccount(acctAddr);
  // Polymarket positions for the unified Predictions tab (HIP-4 outcomes slot in here
  // once bounds markets are integrated) — one light data-api read on a slow cadence
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
  // xyz (HIP-3) positions carry the full coin name ('xyz:GOLD') while pair is the bare symbol
  const myPos = hl.positions.find((p) => p.coin === pair || p.coin.endsWith(':' + pair));
  // total unrealized PNL across open positions (the hook exposes per-position uPnl, not a sum)
  const unrealizedPnl = hl.positions.reduce((s: number, p: any) => s + (p.uPnl || 0), 0);
  const copilot = useTradeCopilot(pair);
  const signer = useHlSigner();
  // Agent (API) wallet — signs L1 actions (orders/cancels/leverage) without a per-trade wallet
  // popup. The master wallet approves it once; external wallets can't sign the chainId-1337 domain.
  const agent = useHlAgent();
  const submittingRef = useRef(false);

  // Run an agent-signed L1 action, self-healing a bad agent (approve-on-demand, retry a
  // propagating key, re-approve a stale one). Shared with the quick ticket and thesis runner.
  const runWithAgent = makeRunWithAgent(agent);

  const [tf, setTf] = useState('15m');
  const [side, setSide] = useState<'Long' | 'Short'>('Long');
  const [otype, setOtype] = useState<(typeof ORDER_TYPES)[number]>('Market');
  const [ai, setAi] = useState<'Off' | 'Copilot'>('Off');
  const [sizePct, setSizePct] = useState(0);
  const [amt, setAmt] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [confirm, setConfirm] = useState<{ address: string; params: PlaceOrderParams; size: number; price: number; lev: number; cross: boolean } | null>(null);
  const [placing, setPlacing] = useState(false);
  // real per-asset leverage + margin mode (signed updateLeverage). appliedLev drives sizing; lev/isCross
  // are the ticket's target until "Set" signs them onto the account.
  const [lev, setLev] = useState(1);
  const [appliedLev, setAppliedLev] = useState(1);
  const [isCross, setIsCross] = useState(true);
  const [appliedCross, setAppliedCross] = useState(true);
  const [mktLimits, setMktLimits] = useState<{ maxLeverage: number; onlyIsolated: boolean } | null>(null);
  const [levBusy, setLevBusy] = useState(false);
  const [levSheet, setLevSheet] = useState(false);   // the Adjust Leverage popup (trade.xyz pattern)
  const [slipPct, setSlipPct] = useState(1);          // market-order max slippage (%), user-set

  /* ---- close EVERYTHING ----
     One click against the whole book, so two rules that the single-position close
     does not need:
       - it ALWAYS confirms. `skipCloseCfm` is a preference someone set for closing one
         position; silently extending it to "flatten my entire account" is how a muscle-memory
         click liquidates a book. The preference deliberately does not apply here.
       - it reports per-position outcomes — partial success is the expected failure mode,
         not an edge case. */
  const [closingAll, setClosingAll] = useState(false);
  /* xyz rebate campaign: accrual counter. The counter IS the instant gratification —
     it ticks from our ledger seconds after a fill; the usdSend follows at the $1
     threshold. Null = campaign off or signed out → the strip simply doesn't render. */
  const [rebate, setRebate] = useState<{ accrued: number; paid: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      me.rebates().then((r: any) => {
        const on = !!(r && r.available && r.active);
        primeRebateStatus(on);            // the order path shares this answer (rebate-status)
        if (alive && on) setRebate({ accrued: r.accrued, paid: r.paid });
        else if (alive) setRebate(null);
      }).catch(() => { if (alive) setRebate(null); });
    };
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
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

  // one-shot copilot handoff: a plan leg armed via armTicket() SEEDS the ticket inputs for
  // this symbol (side/amount/type/limit + the leverage SLIDER only — appliedLev still needs
  // the user's explicit apply). Consume-once + TTL'd in the store; all sign gates untouched.
  useEffect(() => {
    const armed = consumeArm(sym || '');
    if (!armed) return;
    setSide(armed.side);
    if (armed.opts.usd) { setAmt(String(armed.opts.usd)); setSizePct(0); }
    if (armed.opts.otype) setOtype(armed.opts.otype);
    if (armed.opts.limit) setLimitInput(String(armed.opts.limit));
    if (armed.opts.lev) setLev(armed.opts.lev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  // ---- Hyperliquid builder code (fee monetization) ----
  // config.hlBuilder empty ⇒ feature fully OFF (all builder code below no-ops).
  // No separate consent sheet: the first order's Confirm also signs HL's required
  // one-time max-fee cap (see doPlace) — one modal, fee disclosed inline.
  const [cfg, setCfg] = useState<HenceConfig | null>(null);
  const [approving, setApproving] = useState(false);   // the one-time fee-cap signature in flight
  // trade.xyz-style "Don't show again": skip the confirm modal and place directly
  // (first-time approvals still run — toasts + the wallet popup carry the feedback)
  const [skipCfm, setSkipCfm] = useState<boolean>(() => { try { return localStorage.getItem('hence.term.skipConfirm') === '1'; } catch { return false; } });
  const [enableSheet, setEnableSheet] = useState(false);   // "Enable 1-click trading" consent open
  /* What happens to the part of this order that finds no counterparty. Defaults to leaving it
     unfilled, which is both the honest state on a testnet and ordinary crossing-network
     behaviour — the alternative sends it to a public venue, which is the thing users came here
     to avoid, so it must be chosen rather than assumed. */
  const [resid, setResid] = useState<Residual>('unfilled');
  const [enabling, setEnabling] = useState(false);
  // An order preview belongs to the wallet that created it. Clear pending
  // confirmations if Privy changes or removes that wallet.
  const signerAddressRef = useRef(signer.address);
  useEffect(() => {
    if (signerAddressRef.current !== signer.address) {
      signerAddressRef.current = signer.address;
      setConfirm(null);
    }
  }, [signer.address]);
  // per-session, per-address memo: 'approved' = the on-chain fee cap is known good
  const builderSessionRef = useRef<Record<string, 'approved'>>({});
  useEffect(() => { getConfig().then(setCfg).catch(() => {}); }, []);

  const builderEnabled = !!(cfg && cfg.hlBuilder);
  const builderCode: BuilderCode | null = builderEnabled ? { b: cfg!.hlBuilder, f: cfg!.hlBuilderFee } : null;
  const builderPct = builderEnabled ? feeToPercent(cfg!.hlBuilderFee) : '';
  /* xyz rebate campaign: on trade.xyz coins the Hence fee is waived at the choke point
     (lib/builder-waiver) and the venue's own fee is rebated server-side. The UI must say so
     AT THE MOMENT OF THE ORDER — a fee promise nobody sees while deciding is not a promise. */
  const [mtab, setMtab] = useState<(typeof M_TABS)[number]>('Markets');
  const [btab, setBtab] = useState('Sealed orders');
  const [acct, setAcct] = useState('');
  const [acctMenu, setAcctMenu] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [candlesFor, setCandlesFor] = useState('');
  const [chartErr, setChartErr] = useState(false);      // candles fetch failed after all retries
  const [chartNonce, setChartNonce] = useState(0);      // bump to re-run the candles effect (Retry)
  const [stats, setStats] = useState<any>(null);
  const [statsFor, setStatsFor] = useState('');
  const [news, setNews] = useState<any[]>([]);
  const [newCount, setNewCount] = useState(0);
  const newsListRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // ---- live market stream: ONE SSE connection per active pair (mids + book + trades) ----
  // Terminal owns the connection; OrderBook/TradesTape render from these props while the
  // stream is 'live' and fall back to their own polling otherwise. Trades accumulate here
  // per the hub's snapshot/delta contract (snapshot REPLACES, deltas prepend; newest first,
  // cap 100), reset on pair change. `streamMid` drives the big header price + order mark.
  // NOTE: mids is used ONLY for the active pair here — rewiring market.js's global TICKERS
  // polling onto the stream is a separate future step.
  const [liveBook, setLiveBook] = useState<LiveFeed['book']>(null);
  const [liveTrades, setLiveTrades] = useState<LiveFeed['trades']>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [streamMid, setStreamMid] = useState(0);
  const [liveDataCoin, setLiveDataCoin] = useState('');
  const expectedStreamCoin = market.coinFor(pair);

  useEffect(() => {
    // same coin mapping the poll paths use (market.orderBook/recentTrades → coinFor);
    // the hub polls upstream with the coin AS PASSED, so book:xyz:NVDA etc. round-trips.
    const coin = market.coinFor(pair);
    setLiveDataCoin(''); setLiveBook(null); setLiveTrades(null); setStreamMid(0); setStreamStatus('connecting');
    if (!ready) return;
    const close = openStream(['mids', 'book:' + coin, 'trades:' + coin], {
      status: setStreamStatus,
      mids: (m) => { const px = +m[coin]; if (px > 0) { setLiveDataCoin(coin); setStreamMid(px); } },
      book: (b: BookMsg) => {
        if (b && b.coin === coin && Array.isArray(b.bids) && Array.isArray(b.asks)) { setLiveDataCoin(coin); setLiveBook({ bids: b.bids, asks: b.asks }); }
      },
      trades: (t: TradesMsg) => {
        if (!t || t.coin !== coin || !Array.isArray(t.trades)) return;
        const fresh = t.trades.slice().reverse();          // hub sends time-ascending; the tape is newest-first
        setLiveDataCoin(coin);
        if (t.snapshot) { setLiveTrades(fresh.slice(0, 100)); return; }
        setLiveTrades((prev) => {
          if (!prev || !prev.length) return fresh.slice(0, 100);
          // append strictly-fresh fills only (guards against a re-seeded delta after reconnect;
          // matches the hub's own strictly-greater time cursor)
          const add = fresh.filter((x) => x.time > prev[0].time);
          return add.length ? [...add, ...prev].slice(0, 100) : prev;
        });
      },
    });
    return close;
  }, [pair, expectedStreamCoin, ready]);

  // Every candle array belongs to an exact pair + timeframe generation. The owner key
  // prevents even the render before an effect cleanup from exposing the previous route's
  // candles; the generation rejects async results that resolve after a route/retry change.
  const candleOwner = `${pair}:${tf}`;
  const currentCandles = candlesFor === candleOwner ? candles : null;
  const candlesRef = useRef<Candle[] | null>(null);
  candlesRef.current = currentCandles;
  const candleGenerationRef = useRef(0);
  const pagingRef = useRef<number | null>(null);

  const MAX_BARS = 6000;   // cap total loaded history; stop backfilling past this (never drop recent)

  // merge helper: union two candle arrays by time (t). Prepended history + a fresh tail candle both
  // go through here, so we always merge by time — never by index — keeping bars sorted & de-duped.
  const mergeByTime = (base: Candle[], incoming: Candle[]): Candle[] => {
    const byT = new Map<number, Candle>();
    for (const k of base) byT.set(k.t, k);
    for (const k of incoming) byT.set(k.t, k);   // incoming wins (fresher OHLCV for same t)
    return Array.from(byT.values()).sort((a, b) => a.t - b.t);
  };

  // candles drive the chart + the OHLC/price header (one fetch, shared).
  // Bug 2 fix: retry up to 3 times with backoff before surfacing an explicit error state — never
  // an eternal spinner. Retry button bumps chartNonce to re-run this.
  useEffect(() => {
    let alive = true;
    const generation = ++candleGenerationRef.current;
    const ownerPair = pair;
    const ownerTf = tf;
    const ownerKey = `${ownerPair}:${ownerTf}`;
    setCandlesFor(''); setCandles(null); setChartErr(false);
    pagingRef.current = null;
    const stale = () => !alive || generation !== candleGenerationRef.current;
    if (!ready) return () => {
      alive = false;
      if (candleGenerationRef.current === generation) candleGenerationRef.current += 1;
    };
    const delays = [0, 800, 2500];
    // test hook (gated, harmless): `localStorage['hence.chartfail.test']` forces candle failures so
    // the error/Retry UI can be exercised in the browser. '1' fails only the FIRST attempt (verifies
    // retry recovery, self-clears); 'all' fails every attempt until the flag is removed (verifies the
    // persistent error state + Retry button). Neither is ever set in normal use.
    let failMode = '';
    try { failMode = localStorage.getItem('hence.chartfail.test') || ''; } catch { /* noop */ }
    (async () => {
      for (let attempt = 0; attempt < delays.length && alive; attempt++) {
        if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
        if (stale()) return;
        try {
          if (failMode === 'all') throw new Error('forced chart failure (test hook, all)');
          if (failMode === '1' && attempt === 0) {
            try { localStorage.removeItem('hence.chartfail.test'); } catch { /* noop */ }
            throw new Error('forced chart failure (test hook)');
          }
          const c = await market.candles(ownerPair, ownerTf);
          if (stale()) return;
          if (c && c.length) { setCandlesFor(ownerKey); setCandles(c); return; }
          throw new Error('empty candles');
        } catch {
          if (attempt === delays.length - 1 && !stale()) setChartErr(true);
        }
      }
    })();
    return () => {
      alive = false;
      if (candleGenerationRef.current === generation) candleGenerationRef.current += 1;
    };
  }, [pair, tf, chartNonce, ready]);

  // live tail poll: refresh the most-recent window and merge by time so the chart stays live while
  // any backfilled older history is preserved. Merges by t (never index). Skips while errored/empty.
  useEffect(() => {
    let alive = true;
    const generation = candleGenerationRef.current;
    const ownerPair = pair;
    const ownerTf = tf;
    const id = window.setInterval(() => {
      if (!alive || generation !== candleGenerationRef.current) return;
      const cur = candlesRef.current;
      if (!cur || !cur.length) return;
      market.candles(ownerPair, ownerTf).then((tail: Candle[] | null) => {
        if (!alive || generation !== candleGenerationRef.current) return;
        if (!tail || !tail.length) return;
        const now = candlesRef.current;
        if (!now || !now.length) return;
        const merged = mergeByTime(now, tail);
        // only commit if something actually changed (avoid needless re-renders / view churn)
        const changed = merged.length !== now.length || merged[merged.length - 1].c !== now[now.length - 1].c;
        if (changed) setCandles(merged.length > MAX_BARS ? merged.slice(merged.length - MAX_BARS) : merged);
      }).catch(() => { /* transient; next tick retries */ });
    }, 8000);
    return () => { alive = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, tf, chartNonce, ready]);

  // history backfill: fetch one older window before the current oldest bar, dedupe by t, prepend,
  // cap total at MAX_BARS (stop backfilling once hit; never drop the recent end). Returns how many
  // NEW bars were added (0 = no more history / at cap) so the chart can stop paging and preserve view.
  const onNeedHistory = async (): Promise<number> => {
    const generation = candleGenerationRef.current;
    const ownerPair = pair;
    const ownerTf = tf;
    if (pagingRef.current === generation) return 0;
    const cur = candlesRef.current;
    if (!cur || !cur.length) return 0;
    if (cur.length >= MAX_BARS) return 0;              // at cap — stop backfilling (keep recent end)
    pagingRef.current = generation;
    try {
      const oldest = cur[0].t;
      const older = await market.candlesBefore(ownerPair, ownerTf, oldest);
      if (generation !== candleGenerationRef.current) return 0;
      if (!older || !older.length) return 0;
      // Tail data may have committed while the history request was in flight. Merge
      // against the latest same-generation array so neither async path can overwrite it.
      const latest = candlesRef.current;
      if (!latest || !latest.length) return 0;
      const existing = new Set(latest.map((k) => k.t));
      const fresh = older.filter((k) => k.t < oldest && !existing.has(k.t));
      if (!fresh.length) return 0;                     // fully overlapping window → end of history
      const merged = mergeByTime(latest, fresh);
      const capped = merged.length > MAX_BARS ? merged.slice(merged.length - MAX_BARS) : merged;
      if (generation !== candleGenerationRef.current) return 0;
      setCandles(capped);                              // prepend only; recent end untouched
      return Math.max(0, capped.length - latest.length);
    } catch {
      return 0;
    } finally {
      if (pagingRef.current === generation) pagingRef.current = null;
    }
  };

  // assetStats: Bug 2 fix — retry up to 3 times with backoff (header shows — on failure already).
  useEffect(() => {
    let alive = true;
    setStatsFor(''); setStats(null);
    if (!ready) return () => { alive = false; };
    const delays = [0, 800, 2500];
    (async () => {
      for (let attempt = 0; attempt < delays.length && alive; attempt++) {
        if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
        if (!alive) return;
        try {
          const s = await market.assetStats(pair);
          if (!alive) return;
          if (s) { setStatsFor(pair); setStats(s); return; }
          throw new Error('no stats');
        } catch {
          if (attempt === delays.length - 1) return;   // give up quietly; header shows —
        }
      }
    })();
    return () => { alive = false; };
  }, [pair, ready]);

  // live news feed — poll every 60s and merge in fresh articles (dedup by url, newest first).
  // when new posts arrive while the user has scrolled down, surface a "N new posts" badge.
  // Scope toggle: '{PAIR}' = only the selected asset's news (default), 'all' = the universal feed.
  // If the asset has no coverage (long-tail memecoins), fall back to the universal feed with a note.
  const [newsScope, setNewsScope] = useState<'asset' | 'all'>(() => {
    try { return localStorage.getItem('hence.termnews.v1') === 'all' ? 'all' : 'asset'; } catch { return 'asset'; }
  });
  const [newsThin, setNewsThin] = useState(false);   // asset scope fell back to the universal feed
  const setScope = (s: 'asset' | 'all') => {
    setNewsScope(s); setNewsThin(false);
    try { localStorage.setItem('hence.termnews.v1', s); } catch { /* noop */ }
  };
  useEffect(() => {
    let alive = true;
    setNews([]); setNewCount(0); setNewsThin(false);
    if (!ready) return () => { alive = false; };
    const merge = (incoming: any[]) => {
      if (!alive || !Array.isArray(incoming)) return;
      setNews((prev) => {
        const known = new Set(prev.map((a) => a.url));
        // one batch can carry the same story twice (tagged to multiple symbols) —
        // adding to `known` as we go dedupes within the batch, not just vs prev
        const fresh = incoming.filter((a) => {
          if (!a || !a.url || known.has(a.url)) return false;
          known.add(a.url);
          return true;
        });
        if (!fresh.length) return prev;
        if (prev.length) {
          const el = newsListRef.current;
          if (el && el.scrollTop >= 40) setNewCount((c) => c + fresh.length); // only badge if not at top
        }
        return [...fresh, ...prev]
          .sort((a, b) => String(b.publishedDate || '').localeCompare(String(a.publishedDate || '')))
          .slice(0, 50);
      });
    };
    const cls = market.assetClass(pair);
    const loadAll = () => (cls === 'equity'
      ? fmp.stockNews('NVDA,AAPL,MSFT,TSLA,AMZN,GOOGL,META,AMD', 40)
      : fmp.cryptoNews(40));
    const loadAsset = () => (cls === 'equity'
      ? fmp.stockNews(pair, 40)
      : fmp.cryptoNews(40, market.fmpSymbol(pair)));
    const load = () => {
      if (newsScope === 'all') return loadAll().then(merge).catch(() => {});
      return loadAsset().then((arts: any[]) => {
        if (Array.isArray(arts) && arts.length) { merge(arts); return; }
        // no coverage for this asset — universal feed instead, flagged so the UI says so
        if (alive) setNewsThin(true);
        return loadAll().then(merge);
      }).catch(() => {});
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(id); };
  }, [pair, newsScope, ready]);

  const scrollNewsTop = () => { newsListRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setNewCount(0); };

  // ---- modular layout: drag the panel edges to resize (news | chart | book | entry, + bottom) ----
  // Sizes live as CSS vars on the .term root, mutated directly during drag (no re-render churn),
  // persisted to localStorage on release. Double-click a handle to reset that panel. Hidden ≤900px.
  const termRef = useRef<HTMLDivElement>(null);
  const LAYOUT_KEY = 'hence.termlayout.v1';
  const PANELS: Record<string, { v: string; def: number; min: number; max: number; sign: 1 | -1; axis: 'x' | 'y' }> = {
    news:   { v: '--c-news',   def: 240, min: 160, max: 440, sign: 1,  axis: 'x' },   // handle on its right edge
    book:   { v: '--c-book',   def: 234, min: 180, max: 380, sign: -1, axis: 'x' },   // handle on its left edge
    entry:  { v: '--c-entry',  def: 300, min: 250, max: 460, sign: -1, axis: 'x' },
    bottom: { v: '--r-bottom', def: 200, min: 110, max: 520, sign: -1, axis: 'y' },   // handle on its top edge
  };
  const sizesRef = useRef<Record<string, number>>({});
  // News drawer collapse: shrinks --c-news to a 36px rail without clobbering the user's
  // dragged width (kept in sizesRef so expand restores it). Persisted as `newsCollapsed`.
  const NEWS_RAIL = 36;
  const [newsCollapsed, setNewsCollapsed] = useState(false);
  const [collapsing, setCollapsing] = useState(false);   // adds the transition class only during a toggle
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      for (const k of Object.keys(PANELS)) {
        const v = +saved[k];
        if (v >= PANELS[k].min && v <= PANELS[k].max) { sizesRef.current[k] = v; termRef.current?.style.setProperty(PANELS[k].v, v + 'px'); }
      }
      if (saved.newsCollapsed) { setNewsCollapsed(true); termRef.current?.style.setProperty('--c-news', NEWS_RAIL + 'px'); }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistLayout = () => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...sizesRef.current, newsCollapsed })); } catch { /* noop */ }
  };
  const toggleNews = () => {
    const next = !newsCollapsed;
    setNewsCollapsed(next);
    setCollapsing(true);
    window.setTimeout(() => setCollapsing(false), 220);   // drop the transition class after the ease
    const el = termRef.current;
    if (el) {
      if (next) el.style.setProperty('--c-news', NEWS_RAIL + 'px');
      else el.style.setProperty('--c-news', (sizesRef.current.news ?? PANELS.news.def) + 'px');
    }
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...sizesRef.current, newsCollapsed: next })); } catch { /* noop */ }
  };
  const startResize = (key: string) => (e: React.PointerEvent) => {
    const c = PANELS[key]; const el = termRef.current;
    if (!c || !el) return;
    if (key === 'news' && newsCollapsed) return;   // no dragging the collapsed rail
    e.preventDefault();
    const start = c.axis === 'x' ? e.clientX : e.clientY;
    const startVal = sizesRef.current[key] ?? c.def;
    document.body.classList.add(c.axis === 'x' ? 'term-rsz-x' : 'term-rsz-y');
    const move = (ev: PointerEvent) => {
      const d = ((c.axis === 'x' ? ev.clientX : ev.clientY) - start) * c.sign;
      const v = Math.round(Math.min(c.max, Math.max(c.min, startVal + d)));
      sizesRef.current[key] = v;
      el.style.setProperty(c.v, v + 'px');
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.classList.remove('term-rsz-x', 'term-rsz-y');
      persistLayout();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const resetResize = (key: string) => () => {
    delete sizesRef.current[key];
    termRef.current?.style.removeProperty(PANELS[key].v);
    persistLayout();
  };
  const rsz = (key: string, side: 'l' | 'r' | 't') => (
    <span className={`term__rsz term__rsz--${side}`} title="Drag to resize · double-click to reset"
      onPointerDown={startResize(key)} onDoubleClick={resetResize(key)} />
  );
  const favUrl = (site?: string) => (site ? '/api/icon?src=fav&c=' + encodeURIComponent(site) : '');

  // ⌘K / Ctrl+K opens the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // keep the header price/% fresh as market loaders update TICKERS
  useEffect(() => { const id = window.setInterval(() => force((n) => n + 1), 2000); return () => window.clearInterval(id); }, []);

  const t = getTicker(pair);
  const up = (t.chgPct || 0) >= 0;
  // while the stream is live, its mids drive the big price + the order mark (fall back to
  // the polled TICKERS tick otherwise)
  const streamDataCurrent = liveDataCoin === expectedStreamCoin;
  const currentStats = statsFor === pair ? stats : null;
  const livePx = streamStatus === 'live' && streamDataCurrent && streamMid > 0 ? streamMid : 0;
  // A real price exists once the stream is live OR the ticker has a real, non-zero price.
  // Until then we shimmer rather than paint a seed/$0.00 that snaps to the true value a beat later.
  const priced = livePx > 0 || (t.real && t.price > 0);
  const last = currentCandles && currentCandles.length ? currentCandles[currentCandles.length - 1] : null;
  const prev = currentCandles && currentCandles.length > 1 ? currentCandles[currentCandles.length - 2] : last;
  const ch = last && prev ? last.c - prev.c : 0;
  const chp = prev && prev.c ? (ch / prev.c) * 100 : 0;
  const vol = useMemo(() => {
    if (!currentCandles || currentCandles.length < 2) return null;
    const win = currentCandles.slice(-12); const rets: number[] = [];
    for (let i = 1; i < win.length; i++) if (win[i - 1].c) rets.push((win[i].c - win[i - 1].c) / win[i - 1].c);
    const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
    return rets.length ? Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length) * 100 : null;
  }, [currentCandles]);

  // Execution may use only a streamed, hydrated-market, or freshly fetched candle
  // price. Bundled visual-development seeds are never valid order references.
  const realMark = livePx
    || (t.real && t.price > 0 ? t.price : 0)
    || (last && last.c > 0 ? last.c : 0);

  // snapshot of exactly what's on screen — the copilot reasons from this + the live book
  const buildLive = (): CopilotLive => ({
    mark: realMark,
    chg24h: t.changeReal ? t.chgPct : null,
    fundingHourlyPct: currentStats && currentStats.fundingHourly != null ? +(currentStats.fundingHourly * 100).toFixed(4) : null,
    volatilityPct: vol == null ? null : +vol.toFixed(2),
    dayVolUsd: currentStats && currentStats.dayVolUsd != null ? currentStats.dayVolUsd : null,
    leverage: myPos?.leverage || 1,
    position: myPos ? { side: myPos.side, sz: myPos.sz, entryPx: myPos.entryPx, uPnl: myPos.uPnl, roe: myPos.roe, leverage: myPos.leverage, liqPx: myPos.liqPx } : null,
  });
  const runCopilot = () => {
    if (!(realMark > 0)) { toast('Live market data is still loading', { icon: 'info' }); return; }
    copilot.run(buildLive());
  };
  // auto-run a fresh read when the user turns AI on or switches markets while it's on
  useEffect(() => {
    if (ai === 'Off') return;
    runCopilot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, pair]);

  const watch = getWatch();
  const accts = accountsList();
  const acctName = (acct && accts.find((a) => a.id === acct)?.name)
    || (hl.connected ? (signer.address ? `${signer.address.slice(0, 6)}…${signer.address.slice(-4)}` : 'Your wallet') : false);

  const pickPair = (s: string) => { setPaletteOpen(false); nav('/terminal/' + s.toUpperCase()); };
  const reEntry = () => {/* state-driven, no-op */};
  const mark = realMark;
  const mkt = marketOf(pair);          // null for anything outside the three netted markets
  const tradeCoin = market.coinFor(pair);
  /* Campaign scope must key off the coin the ORDER carries, not the symbol on screen: the
     terminal shows "AAPL" while market.coinFor resolves it to "xyz:AAPL", so checking the
     display symbol missed every stock — the confirm sheet (which reads params.coin) said
     FREE while the ticket beside it still quoted 0.045%. One source of truth: tradeCoin. */
  // open campaign (public flag) OR this user is whitelisted (their rebate poll came back
  // active) — same rule the order path applies in lib/rebate-status
  const xyzFree = (!!cfg?.xyzRebate || rebate != null) && /^xyz:/i.test(String(tradeCoin || ''));
  // Live orders: native HL perps + the trade.xyz HIP-3 dex (stocks/commodities/fx/indices),
  // all USDC-collateralized under a unified account. Everything else stays read-only.
  // INCOGNITO: /terminal/:sym is parsed with no membership check, so an off-venue symbol
  // reaches the ticket via a pasted link. Treated read-only exactly as Hence treats a
  // non-tradeable market — the UI path already exists, it just needs the venue in the test.
  const readOnlyMarket = !market.isTradeable(pair) || !isAvantisSymbol(pair);
  // Per market: "6 sealed" must mean six orders that can cross with YOURS, not six spread
  // across markets that will each net alone.
  const epoch = useEpoch(pair);
  const shielded = useShielded();   // the address orders execute from — never the user's own
  // Percentage buttons: buying power = available collateral × the SELECTED leverage. The order flow
  // applies this leverage on HL before opening, so sizing matches what actually executes. HL still
  // enforces the true limit; this is a convenience estimate.
  const setPct = (p: number) => {
    setSizePct(p);
    if (hl.connected && hl.available > 0) setAmt(String(Math.floor(hl.available * lev * (p / 100))));
  };

  // asset leverage limits (native perps only) when the market changes
  useEffect(() => {
    if (readOnlyMarket || !market.isReady()) { setMktLimits(null); return; }
    let alive = true;
    marketLimits(tradeCoin).then((l) => { if (alive) setMktLimits(l); }).catch(() => { if (alive) setMktLimits(null); });
    return () => { alive = false; };
  }, [tradeCoin, readOnlyMarket]);

  // reflect the account's real leverage for this asset (from an open position) as the applied baseline
  useEffect(() => {
    const l = myPos?.leverage;
    if (l && l >= 1) { setAppliedLev(l); setLev(l); } else { setAppliedLev(1); setLev(1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, myPos?.leverage]);

  const maxLev = mktLimits?.maxLeverage || 50;
  /* the margin rule, computed ONCE at component scope: the row, the submit button and the
     submit handler must all read the same answer or they drift into contradiction */
  const marginReq = (parseFloat(amt) || 0) / Math.max(1, lev);
  const marginShort = hl.loaded && !reduceOnly ? marginGap(marginReq, hl.available) : null;
  const isoOnly = !!mktLimits?.onlyIsolated;
  const effCross = isoOnly ? false : isCross;
  const levDirty = lev !== appliedLev || effCross !== appliedCross;

  // Explicit one-time "Enable 1-click trading" — approve the agent key up front (mirrors HL's
  // "Establish Connection"), so the security delegation is its own clear step, not a surprise
  // popup mid-order. After this, orders/cancels/leverage sign silently.
  const doEnableAgent = async () => {
    if (!signer.ready || !signer.sign) { toast('Connect a wallet first', { icon: 'wallet' }); return; }
    setEnabling(true);
    try {
      await agent.ensureAgentSigner();
      toast('1-click trading enabled — orders now sign instantly.', { icon: 'check' });
      setEnableSheet(false);
    } catch (e: any) {
      toast(e?.shortMessage || e?.message || 'Approval cancelled', { icon: 'close' });
    } finally {
      setEnabling(false);
    }
  };

  // sign updateLeverage to set the account's real leverage + margin mode for this asset
  const doSetLeverage = async () => {
    /* INCOGNITO GUARD. This path signs with the user's OWN wallet. Closing, cancelling or
       adjusting a shielded position from the identity wallet does not merely deanonymise that
       action — it LINKS the identity wallet to a position that was opened shielded, undoing
       the protection retroactively and permanently. Refuse until the shielded route covers it.
       Removing this guard without routing through the shielded wallet re-opens that hole. */
    if (!shielded.address) {
      toast('Incognito: this needs a shielded address, and would otherwise sign as you', { icon: 'close' });
      return;
    }

    if (readOnlyMarket) return;
    if (!signer.ready || !signer.sign) { toast('Connect a wallet to set leverage', { icon: 'wallet' }); if (auth.ready && !auth.authenticated) auth.login(); return; }
    setLevBusy(true);
    try {
      const r = await runWithAgent((sign) => updateLeverage(sign, tradeCoin, lev, effCross));
      if ('error' in r) { toast(r.error, { icon: 'close' }); }
      else { setAppliedLev(lev); setAppliedCross(effCross); toast(`Leverage set to ${lev}× ${effCross ? 'cross' : 'isolated'} on ${pair}`, { icon: 'check' }); hl.refresh?.(); }
    } catch (e: any) { toast(e?.message || 'Leverage change cancelled', { icon: 'close' }); }
    finally { setLevBusy(false); }
  };

  // close an open position: reduce-only market order for the full size, opposite side,
  // agent-signed (no popup). Reduce-only is exempt from the $10 minimum and HL clamps it
  // to the position, so this can never flip the direction.
  const [closing, setClosing] = useState<string | null>(null);
  const [closeCfm, setCloseCfm] = useState<any | null>(null);      // position pending close-confirm
  const [closePct, setClosePct] = useState(100);                    // partial close (trade.xyz % chips)
  const [skipCloseCfm, setSkipCloseCfm] = useState<boolean>(() => { try { return localStorage.getItem('hence.term.skipCloseConfirm') === '1'; } catch { return false; } });
  const doClose = async (p: any, pct = 100) => {
    /* INCOGNITO GUARD. This path signs with the user's OWN wallet. Closing, cancelling or
       adjusting a shielded position from the identity wallet does not merely deanonymise that
       action — it LINKS the identity wallet to a position that was opened shielded, undoing
       the protection retroactively and permanently. Refuse until the shielded route covers it.
       Removing this guard without routing through the shielded wallet re-opens that hole. */
    if (!shielded.address) {
      toast('Incognito: this needs a shielded address, and would otherwise sign as you', { icon: 'close' });
      return;
    }

    if (!signer.ready || !signer.sign) { toast('Connect a wallet to close', { icon: 'wallet' }); return; }
    const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
    if (!(mk > 0)) { toast('No live price to close against', { icon: 'close' }); return; }
    const frac = Math.min(100, Math.max(1, pct)) / 100;
    const sym = p.coin.split(':').pop();
    setClosing(p.coin);
    try {
      const notional = p.sz * frac * mk;
      // Closes are fills that earn a builder fee too — attach it, but ONLY if the cap is
      // already approved (prompt:false); never interrupt an exit with a signature prompt.
      const bf = await resolveBuilder(signer.sign, signer.address!, notional, { prompt: false });
      const r = await runWithAgent((sign) => placeOrder(sign, {
        coin: p.coin, isBuy: p.side === 'Short', usd: notional, markPrice: mk,
        type: 'Market', reduceOnly: true, slippage: slipPct / 100, builder: bf.builder,
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

  // position TP/SL — reduce-only trigger orders via placeTpsl (grouping positionTpsl)
  const [tpslFor, setTpslFor] = useState<any | null>(null);
  const [tpIn, setTpIn] = useState('');
  const [slIn, setSlIn] = useState('');
  const [tpslBusy, setTpslBusy] = useState(false);
  const doTpsl = async () => {
    /* INCOGNITO GUARD. This path signs with the user's OWN wallet. Closing, cancelling or
       adjusting a shielded position from the identity wallet does not merely deanonymise that
       action — it LINKS the identity wallet to a position that was opened shielded, undoing
       the protection retroactively and permanently. Refuse until the shielded route covers it.
       Removing this guard without routing through the shielded wallet re-opens that hole. */
    if (!shielded.address) {
      toast('Incognito: this needs a shielded address, and would otherwise sign as you', { icon: 'close' });
      return;
    }

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

  // cancel a resting Hyperliquid order (native perps only)
  const doCancel = async (o: any) => {
    /* INCOGNITO GUARD. This path signs with the user's OWN wallet. Closing, cancelling or
       adjusting a shielded position from the identity wallet does not merely deanonymise that
       action — it LINKS the identity wallet to a position that was opened shielded, undoing
       the protection retroactively and permanently. Refuse until the shielded route covers it.
       Removing this guard without routing through the shielded wallet re-opens that hole. */
    if (!shielded.address) {
      toast('Incognito: this needs a shielded address, and would otherwise sign as you', { icon: 'close' });
      return;
    }

    if (!signer.ready || !signer.sign) { toast('Connect a wallet to cancel', { icon: 'wallet' }); return; }
    setCancelling(o.oid);
    try {
      const r = await runWithAgent((sign) => cancelOrder(sign, o.coin, o.oid));
      if ('error' in r) toast(r.error, { icon: 'close' });
      else { toast('Order cancelled', { icon: 'check' }); hl.refresh?.(); }
    } catch (e: any) { toast(e?.message || 'Cancel cancelled', { icon: 'close' }); }
    finally { setCancelling(null); }
  };

  // step 1 — validate + quote, then open the confirm sheet
  const submit = async () => {
    if (readOnlyMarket) {
      toast(`${pair} is not one of the netted markets — Incognito trades BTC, ETH and SOL.`, { icon: 'close' });
      return;
    }
    if (!signer.ready) {
      toast('Connect a wallet to trade live', { icon: 'wallet' });
      if (auth.ready && !auth.authenticated) auth.login();
      return;
    }
    /* INCOGNITO: two gates removed here, and both of them BLOCKED REAL ORDERS.

       The first waited on `hl.loaded` — the user's Hyperliquid account snapshot. An incognito
       order never touches Hyperliquid, so this made a healthy order fail whenever HL was slow
       or the trader simply had no HL account, with a message about a venue they were not using.

       The second was marginShortfall() against `hl.available`: it refused to seal an order
       unless the trader held collateral on Hyperliquid. Nothing is escrowed here — the order is
       an encrypted intent — so this rejected everyone starting from zero, which is everyone.

       Both are gone. What is left is what actually constrains a sealed order. */
    const usd = Number(amt.trim());
    if (!Number.isFinite(usd) || usd <= 0) { toast('Enter a valid amount to trade', { icon: 'card' }); return; }
    // The size is encrypted as whole dollars, so anything under $1 rounds to nothing on chain.
    // There is no venue minimum to enforce: Avantis' $100 floor applies to a routed RESIDUAL,
    // which is an aggregate — a small order can be part of one without meeting it alone.
    if (usd < 1) { toast('Minimum order value is $1.', { icon: 'card' }); return; }
    if (!(mark > 0)) { toast('No live price for this market yet', { icon: 'close' }); return; }
    const limitPrice = otype === 'Limit' ? Number(limitInput.trim()) : undefined;
    if (otype === 'Limit' && (!Number.isFinite(limitPrice) || (limitPrice ?? 0) <= 0)) {
      toast('Enter a valid limit price', { icon: 'card' });
      return;
    }
    const params: PlaceOrderParams = {
      coin: tradeCoin, isBuy: side === 'Long', usd, markPrice: mark, type: otype,
      limitPrice,
      reduceOnly,
      slippage: otype === 'Market' ? slipPct / 100 : undefined,
    };
    try {
      // No venue quote: nothing is being filled at a price right now. The order seals at its
      // notional and nets against other traders at the epoch close, so "size" here is simply
      // what that notional buys at the current mark — shown for orientation, not as a fill.
      const size = usd / mark;
      if (!(size > 0)) { toast('Amount too small — size rounds to zero', { icon: 'close' }); return; }
      setConfirm({ address: signer.address!, params, size, price: mark, lev, cross: effCross });
    } catch (e: any) {
      toast(e?.message || 'Could not prepare order', { icon: 'close' });
    }
  };

  // Actually sign + submit the order (optionally with the builder code attached).
  // Never blocks on monetization — the builder is an optional add-on to params.
  const submitOrder = async (builder: BuilderCode | null) => {
    if (!confirm) { setConfirm(null); return; }

    /* ── INCOGNITO: the order goes to Inco, not to Hyperliquid ────────────────────────────
       The size is encrypted in this browser and submitted from the SHIELDED wallet. The
       Hyperliquid implementation below is kept (renamed) only because the confirm sheet,
       leverage UI and toasts around it are shared — it is no longer reachable.

       FAIL CLOSED. With no contract or no shielded address this refuses and says why. It
       must NEVER fall through to the Hyperliquid branch: that signs with the user's OWN
       wallet, publishing the exact link this product exists to hide, at the moment they
       believe they are protected. */
    const gate = shieldedReady(shielded.address);
    if (!gate.ready) {
      toast(gate.reason ?? 'Incognito is not ready', { icon: 'close' });
      setConfirm(null);
      return;
    }
    setPlacing(true);
    try {
      // The shielded wallet is brand new and holds nothing, so it cannot pay the Inco input fee.
      // Fund it FIRST — otherwise the order reverts at the fee check and looks like a bug. The
      // grant comes from the shared omnibus, never from the user's own wallet: that transfer
      // would link the two addresses on-chain and undo the entire point.
      const funded = await shielded.ensureFunded();
      if (!funded.ok) {
        toast(funded.reason ?? 'Could not prepare the shielded wallet', { icon: 'close' });
        setPlacing(false);
        setConfirm(null);
        return;
      }

      // PlaceOrderParams carries the notional directly as `usd` — no need to reconstruct it
      // from size × price, which is where the first attempt went wrong.
      const usd = Number(confirm.params.usd) || 0;
      const res = await placeShieldedOrder(
        {
          symbol: String(confirm.params.coin).split(':').pop() || pair,
          side: confirm.params.isBuy ? 'long' : 'short',
          size: usd,
          leverage: confirm.lev,
          residual: resid,
        },
        // The shielded signer. getClient() switches the embedded wallet to Base first and
        // returns null on any failure, so a signer we could not reach places nothing rather
        // than falling through to a wallet that would identify the user.
        await shielded.getClient(),
      );
      if (!res.ok) toast(res.reason, { icon: 'close' });
      else toast(`Order sealed into epoch ${epoch.epochId ?? '—'}`, { icon: 'check' });
    } catch (e: any) {
      toast(e?.message ?? 'Could not seal the order', { icon: 'close' });
    } finally {
      setPlacing(false);
      setConfirm(null);
    }
  };

  /** Hyperliquid submit — UNREACHABLE in Incognito. Retained so the shared confirm/leverage
   *  UI still compiles against it, and as the reference for what the Inco path replaced. */
  const submitOrderHyperliquid = async (builder: BuilderCode | null) => {
    if (!confirm || !signer.sign || confirm.address !== signer.address) { setConfirm(null); return; }
    setPlacing(true);
    try {
      // Enforce the chosen leverage BEFORE opening. HL's per-asset default is the MAX (e.g. 20x for
      // BTC), and the slider is only a UI value until an updateLeverage is signed — so without this
      // an order opens at HL's default, not what the user selected. Skip for reduce-only (closing).
      const openPos = hl.positions.find((p) => p.coin === confirm.params.coin);
      const needLev = !confirm.params.reduceOnly && (!openPos || openPos.leverage !== confirm.lev || appliedCross !== confirm.cross);
      if (needLev) {
        const lr = await runWithAgent((sign) => updateLeverage(sign, confirm.params.coin, confirm.lev, confirm.cross));
        if (lr && 'error' in lr) { toast(`Couldn't set ${confirm.lev}× leverage: ${lr.error}`, { icon: 'close' }); setPlacing(false); return; }
        setAppliedLev(confirm.lev); setAppliedCross(confirm.cross);
      }
      // L1 orders sign with the agent key (no wallet popup); first order approves it once.
      // runWithAgent approves-on-demand and self-heals a stale/propagating agent.
      const r = await runWithAgent((sign) => placeOrder(sign, { ...confirm.params, builder }));
      if ('error' in r) {
        toast(r.error, { icon: 'close' });
      } else {
        {
          // per-action card with the asset's logo (trade.xyz anatomy)
          const sym = String(confirm.params.coin).split(':').pop();
          toast(
            r.status === 'filled'
              ? `${confirm.params.isBuy ? 'Bought' : 'Sold'} ${r.detail.totalSz} ${sym} @ ${fmtPx(+r.detail.avgPx)}`
              : `${confirm.params.isBuy ? 'Buy' : 'Sell'} order resting · ${sym} #${r.detail.oid}`,
            { ticker: sym },
          );
        }
        {
          // Revenue/activity telemetry: notional VOLUME + the estimated Hence builder
          // fee (usd × tenths-of-bp/1e5) so the dashboards can chart volume driven and
          // fees earned per user. `builder` truthy = the fee was actually attached; the
          // ON-CHAIN collected total still lives in HL's builder-fills CSV (ground truth).
          const notional = confirm.params.usd || 0;
          const feeUsd = builder ? notional * (cfg?.hlBuilderFee || 0) / 100000 : 0;
          track('trade_submitted', {
            coin: confirm.params.coin, side: confirm.params.isBuy ? 'buy' : 'sell',
            status: r.status, leverage: confirm.lev || undefined,
            usd: notional, venue: String(confirm.params.coin).includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
            builder_attached: !!builder, hence_fee_usd: feeUsd, market: 'perp',
          });
        }
        setConfirm(null); setAmt(''); setSizePct(0);
        hl.refresh();
      }
    } catch (e: any) {
      toast(e?.message || 'Signing was cancelled', { icon: 'close' });
    } finally {
      setPlacing(false);
    }
  };

  // step 2 — Confirm pressed. ONE modal, no separate consent sheet: the routing fee is
  // part of trading on Hence (industry-standard builder-app model — Phantom/pvp do the
  // same). The first order also signs HL's one-time max-fee cap, which the protocol
  // REQUIRES to be user-signed. Rejecting that signature cancels the order; only a
  // TECHNICAL approval failure lets the order through fee-free (our monetization infra
  // must never strand a trader mid-trade).
  // "Don't show again": when a preview lands with the modal suppressed, place it
  // immediately — one auto-fire per preview (the ref re-arms when confirm clears).
  const autoFired = useRef(false);
  useEffect(() => {
    if (!confirm) { autoFired.current = false; return; }
    if (skipCfm && !autoFired.current && !placing && !approving) { autoFired.current = true; void doPlace(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, skipCfm]);

  const doPlace = async () => {
    if (submittingRef.current) return;   // guard: builder path awaits before `placing` disables the button
    if (!confirm || !signer.sign || confirm.address !== signer.address) { setConfirm(null); return; }
    submittingRef.current = true;
    try {
      const addr = signer.address;
      if (!builderEnabled || !addr) { await submitOrder(null); return; }

      if (builderSessionRef.current[addr] !== 'approved') {
        // returning users already carry the on-chain cap — check once per session
        let onChain = false;
        try { onChain = (await queryMaxBuilderFee(addr, cfg!.hlBuilder)) >= cfg!.hlBuilderFee; } catch { /* treat as unapproved */ }
        if (!onChain) {
          setApproving(true);
          try {
            const res = await approveBuilderFee(signer.sign, { builder: cfg!.hlBuilder, maxFeeRate: builderPct });
            if ('error' in res) {
              toast(res.error || 'Fee approval failed — this order goes through without it', { icon: 'close' });
              await submitOrder(null);
              return;
            }
          } catch (e: any) {
            const msg = String(e?.message || '');
            if (/reject|denied|declin|cancel|4001/i.test(msg)) {
              // the user said no to the fee cap → no order; the confirm modal stays open
              toast('Order not placed — the routing-fee approval is part of trading on Hence.', { icon: 'close' });
              return;
            }
            toast(msg || 'Fee approval failed — this order goes through without it', { icon: 'close' });
            await submitOrder(null);
            return;
          } finally {
            setApproving(false);
          }
        }
        builderSessionRef.current[addr] = 'approved';
      }
      await submitOrder(builderCode);
    } finally {
      submittingRef.current = false;
    }
  };

  const stat = (k: string, v: React.ReactNode, cls = '') => (
    <div className="term__stat"><span className="term__stat-k">{k}</span><span className={'term__stat-v ' + cls}>{v}</span></div>
  );

  // the news-drawer 'Connected' dot doubles as the market-stream health indicator
  // (green live / amber connecting / red down — see .term__dot--* in terminal.css)
  const dotCls = 'term__dot term__dot--' + streamStatus;
  const dotTitle = streamStatus === 'live' ? 'Market stream: live'
    : streamStatus === 'connecting' ? 'Market stream: connecting…'
      : 'Market stream: down — polling fallback active';

  return (
    <>
      <div className={'term' + (collapsing ? ' is-newsanim' : '')} data-mtab={mtab} ref={termRef}>
        <ScreenHead title="Terminal" context={`${pair}-PERP`} />
        {/* fav / watch bar */}
        <div className="term__fav">
          {/* INCOGNITO — the only edit to this file's chrome. The tint alone is too subtle to
              answer "am I shielded right now?", and that question must never need thinking
              about. Leads the bar so it is the first thing read, on every screen. */}
          <span className="inc__badge" title="Orders are encrypted and matched before they reach a venue">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3.5 12.5h17M7 12.5c0-3.6.9-6 5-6s5 2.4 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="8.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="15.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            Incognito
          </span>
          <span className="term__fav-star"><Icon name="bookmark" size={13} /></span>
          {[...watch].slice(0, 14).map((s) => { const tt = getTicker(s); const u = (tt.chgPct || 0) >= 0; return (
            <Link key={s} className="term__fav-i" to={'/terminal/' + s}><Logo sym={s} size={14} />{s} <span className={tt.changeReal ? (u ? 'up' : 'down') : 'muted'}>{tt.changeReal ? fmtPct(tt.chgPct) : '—'}</span></Link>
          ); })}
          <button className="term__fav-cta" onClick={() => setPaletteOpen(true)}>{watch.size ? '+ Add' : 'Search markets'} <kbd>⌘K</kbd></button>
        </div>

        {/* ticker marquee — top header strip (trade.xyz anatomy) */}
        <TickerTape ready={ready} />

        {/* mobile section switcher */}
        <div className="term__mtabs">{M_TABS.map((tb) => <button key={tb} className={tb === mtab ? 'on' : ''} onClick={() => setMtab(tb)}>{tb}</button>)}</div>

        <div className="term__grid">
          {/* news */}
          {/* both the full feed and the collapsed rail live in the DOM; .is-collapsed (desktop
              only, scoped ≤900px off in CSS) swaps which one is shown, so mobile always shows
              the full feed in its Markets mtab regardless of the persisted collapsed state. */}
          <aside className={'term__news' + (newsCollapsed ? ' is-collapsed' : '')}>
            {!newsCollapsed && rsz('news', 'r')}
            <button className="term__news-rail" onClick={toggleNews} title="Expand news">
              <span className={dotCls} title={dotTitle} />
              <Icon name="chevR" size={14} />
              <span className="term__news-rail-l">News</span>
            </button>
            <div className="term__news-full">
              <div className="term__news-h">
                <span className={dotCls} title={dotTitle} /><span className="term__news-h-l" title={dotTitle}>Connected</span>
                {newCount > 0 && (
                  <button className="term__news-new" onClick={scrollNewsTop}>↑ {newCount} new post{newCount > 1 ? 's' : ''}</button>
                )}
                <span className="term__news-scope">
                  <button className={newsScope === 'asset' ? 'on' : ''} onClick={() => setScope('asset')} title={`Only ${pair} news`}>{pair}</button>
                  <button className={newsScope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="All markets">All</button>
                </span>
                <button className="term__news-collapse" onClick={toggleNews} title="Collapse news"><Icon name="back" size={14} /></button>
              </div>
              <div className="term__news-list" ref={newsListRef} onScroll={(e) => { if (newCount && e.currentTarget.scrollTop < 40) setNewCount(0); }}>
                {newsThin && <div className="term__news-thin">No {pair} coverage yet — showing all markets</div>}
                {news.length === 0 ? <div className="term__news-loading">Loading market news…</div> : news.map((a, i) => {
                  const articleUrl = safeHttpUrl(a.url);
                  const body = <>
                    <div className="term__news-src">
                      {a.site && <img className="term__news-fav" src={favUrl(a.site)} alt="" decoding="async" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />}
                      <b>{a.publisher || a.site}</b><span>{timeAgo(a.publishedDate)}</span>
                    </div>
                    <div className="term__news-title">{a.title}</div>
                  </>;
                  return articleUrl
                    ? <a className="term__news-i" key={articleUrl || i} href={articleUrl} target="_blank" rel="noopener noreferrer">{body}</a>
                    : <div className="term__news-i" key={i}>{body}</div>;
                })}
              </div>
              <div className="term__news-foot">powered by <Icon name="analyze" size={11} /> Hence Intel</div>
            </div>
          </aside>

          {/* chart */}
          <section className="term__chart">
            <div className="term__chart-top">
              <button className="term__pair" onClick={() => setPaletteOpen(true)}><Logo sym={pair} size={22} /><b>{pair}:PERP-USDC</b><Icon name="chevDown" size={14} /></button>
              <span className={'term__price ' + (up ? 'up' : 'down')}>{priced ? fmtPx(livePx || t.price) : <Skeleton w={104} h={24} r={6} />}</span>
              <div className="term__stats">
                {stat('24H Price', t.changeReal ? fmtPct(t.chgPct) : '—', t.changeReal ? (up ? 'up' : 'down') : '')}
                {stat('24H Volume', currentStats && currentStats.dayVolUsd != null ? fmtUsd(currentStats.dayVolUsd) : '—')}
                {stat('1H Volatility', vol == null ? '—' : `±${vol.toFixed(2)}%`)}
                {stat('Funding Rate', currentStats && currentStats.fundingHourly != null ? `${(currentStats.fundingHourly * 100).toFixed(4)}%` : '—', currentStats && currentStats.fundingHourly >= 0 ? 'up' : 'down')}
              </div>
            </div>
            <div className="term__chart-toolbar">
              <div className="term__tf">{market.TIMEFRAMES.map((x: string) => <button key={x} className={x === tf ? 'on' : ''} onClick={() => setTf(x)}>{x}</button>)}</div>
              <span className="term__chart-tools"><button className="term__tool"><Icon name="chart" size={13} /> Indicators</button><button className="term__tool"><Icon name="compass" size={13} /> View as</button></span>
            </div>
            <div className="term__ohlc">{last ? (
              <>
                <span>O <b>{fmtPx(last.o)}</b></span><span>H <b>{fmtPx(last.h)}</b></span><span>L <b>{fmtPx(last.l)}</b></span><span>C <b>{fmtPx(last.c)}</b></span>
                <span className={ch >= 0 ? 'up' : 'down'}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)} ({chp.toFixed(2)}%)</span>
              </>
            ) : null}</div>
            <TradingChart
              candles={currentCandles}
              onNeedHistory={onNeedHistory}
              resetKey={`${pair}:${tf}`}
              error={chartErr}
              onRetry={() => setChartNonce((n) => n + 1)}
            />
          </section>

          {/* order book — fed by the terminal's single stream; polls only as fallback */}
          {/* INCOGNITO: the order book is replaced, not hidden. Avantis is vault-backed and
              oracle-priced so there is no CLOB to render, and our own flow is encrypted until
              the epoch closes — the panel shows what is actually knowable. */}
          <SealedBook sym={pair} resizer={rsz('book', 'l')} sealed={epoch.sealed} sealedAll={epoch.sealedAll}
            secondsLeft={epoch.secondsLeft} lastCrossed={epoch.lastCrossed} live={epoch.live}
            epochId={epoch.epochId} prevNetted={epoch.prevNetted} prevCount={epoch.prevCount} crossedEpoch={epoch.crossedEpoch} />

          {/* order entry + account card (right column) */}
          <aside className="term__entry">
            {rsz('entry', 'l')}
            {/* Long / Short tabs live OUTSIDE the scroll container — only the form body scrolls */}
            <div className="term__ls">
              <button className={'term__ls-btn term__ls-long' + (side === 'Long' ? ' on' : '')} onClick={() => setSide('Long')}>Long</button>
              <button className={'term__ls-btn term__ls-short' + (side === 'Short' ? ' on' : '')} onClick={() => setSide('Short')}>Short</button>
            </div>
            <div className="term__entry-scroll">
            <div className="term__entry-body">
              <div className="term__orow">
                <div className="term__otabs">{ORDER_TYPES.map((o) => <button key={o} className={o === otype ? 'on' : ''} onClick={() => setOtype(o)}>{o}</button>)}</div>
              </div>
              {readOnlyMarket && <div className="term__cfm-note"><Icon name="alert" size={12} /> Read-only market · live orders aren’t available for this asset yet.</div>}
              {/* "Available to Trade" and "Current Position" both read the Hyperliquid
                  clearinghouse. Neither has an answer here: no collateral is posted for a
                  sealed order, and no position exists until a residual settles at a venue.
                  What a trader actually needs to know at this point is how much company their
                  order will have when the epoch closes. */}
              <div className="term__avail">
                <span title="Orders already sealed into this epoch for this market. They are what yours can cross against.">Sealed in {pair} this epoch</span>
                <b>{epoch.live ? epoch.sealed : '—'}</b>
              </div>
              <div className="term__avail">
                <span title="Time until the epoch closes and netting runs.">Epoch closes</span>
                <b>{!epoch.live ? '—' : epoch.secondsLeft > 0
                  ? `${Math.floor(epoch.secondsLeft / 60)}:${String(epoch.secondsLeft % 60).padStart(2, '0')}`
                  : 'awaiting keeper'}</b>
              </div>
              {/* Leverage + margin mode as compact chips (trade.xyz anatomy) — the slider
                  lives in the Adjust Leverage popup, not permanently in the column. */}
              {!readOnlyMarket && (
                <div className="term__levrow">
                  <button className="term__levbtn" onClick={() => setLevSheet(true)} title="Adjust leverage">
                    {lev}× <Icon name="sliders" size={12} />
                  </button>
                  <span className="term__lev-mode">
                    <button className={effCross ? 'on' : ''} disabled={isoOnly} onClick={() => setIsCross(true)} title={isoOnly ? 'This market is isolated-only' : 'Shared margin across positions'}>Cross</button>
                    <button className={!effCross ? 'on' : ''} onClick={() => setIsCross(false)} title="Margin isolated to this position">Isolated</button>
                  </span>
                </div>
              )}
              {levSheet && (
                <>
                  <div className="term__levpop-bd" onClick={() => setLevSheet(false)} />
                  <div className="term__levpop" role="dialog" aria-label="Adjust leverage">
                    <div className="term__levpop-h"><b>Adjust Leverage</b><button onClick={() => setLevSheet(false)} aria-label="Close"><Icon name="close" size={14} /></button></div>
                    <div className="term__levpop-row"><span>Maximum leverage</span><b>{maxLev}×</b></div>
                    <div className="term__levpop-slide">
                      <input type="range" className="term__lev-slider" min={1} max={maxLev} step={1} value={Math.min(lev, maxLev)} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" />
                      <input className="term__levpop-num" type="text" inputMode="numeric" value={lev}
                        onChange={(e) => { const v = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); setLev(Number.isFinite(v) ? Math.min(Math.max(1, v), maxLev) : 1); }} aria-label="Leverage value" />
                    </div>
                    <div className="term__levpop-row"><span>Buying power</span><b>{hl.connected && hl.loaded ? fmtUsd(hl.available * lev) : '—'}</b></div>
                    {levDirty && <div className="term__lev-sub">Applies to the residual if you route it out; sealed orders net at notional.</div>}
                    <button className="term__levpop-cta" disabled={levBusy}
                      onClick={async () => { if (hl.connected && levDirty && signer.ready) { await doSetLeverage(); } setLevSheet(false); }}>
                      {levBusy ? 'Signing…' : hl.connected && levDirty && signer.ready ? `Confirm ${lev}×` : 'Done'}
                    </button>
                  </div>
                </>
              )}
              {otype === 'Limit' && (
                <label className="term__field"><span>Limit</span><input type="text" inputMode="decimal" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="Required" /><span className="term__field-unit">USDC</span></label>
              )}
              <label className="term__field term__field--amt"><span>Amount</span><input type="text" inputMode="decimal" value={amt} onChange={(e) => {
                // A money field should refuse a letter as it is typed, not at submit. The
                // handler already rejects NaN, so this was never unsafe — just a confusing
                // way to learn you had typed nonsense. One decimal point, digits only.
                const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                setAmt(v); setSizePct(0);
              }} placeholder="0.00" /><button className="term__max" onClick={() => setPct(100)}>MAX</button><span className="term__field-unit">USD</span></label>
              <div className="term__pcts">{[10, 25, 50, 75, 100].map((p) => <button key={p} className={p === sizePct ? 'on' : ''} onClick={() => setPct(p)}>{p}%</button>)}</div>
              <div className="term__checks">
                <label className="term__check"><input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} /> Reduce Only</label>
              </div>
            </div>

            {/* INCOGNITO: the order summary.

                What was here described a Hyperliquid order — liquidation price, margin at
                leverage, max slippage, "Est. fee at 0.045%". None of it applies: this order is
                an encrypted intent netted against other traders, with no collateral posted, no
                position to liquidate and no taker fee. Leaving those rows would have been the
                account card's mistake again, in the one panel the user reads before committing. */}
            <div className="term__pta">
              <div className="term__pta-row">
                <span>Market</span>
                <b>{mkt ? `${mkt.sym}/USD · Avantis #${mkt.pair}` : '—'}</b>
              </div>
              <div className="term__pta-row"><span>Order value</span><b>{fmtUsd(parseFloat(amt) || 0)}</b></div>
              <div className="term__pta-row">
                <span title="Orders are batched into fixed windows and netted together when the window closes. Yours stays encrypted until then.">Seals into</span>
                <b>{epoch.epochId != null ? `Epoch #${epoch.epochId}` : '—'}</b>
              </div>
              <div className="term__pta-row term__pta-row--slip">
                <span title="If nobody takes the other side of your order, the remainder either goes unfilled or is routed out to Avantis, where it is public like any venue order.">If unmatched</span>
                <span className="term__slip term__resid">
                  <button className={resid === 'unfilled' ? 'on' : ''} onClick={() => setResid('unfilled')}>Return unfilled</button>
                  <button className={resid === 'avantis' ? 'on' : ''} onClick={() => setResid('avantis')}>Route to Avantis</button>
                </span>
              </div>
              <div className="term__residnote">
                {resid === 'unfilled'
                  ? 'No counterparty, no fill — nothing is escrowed, so nothing comes back. Retry next epoch.'
                  : 'The unmatched remainder opens on Avantis, publicly, like any other venue order.'}
              </div>
            </div>

            <div className="term__ai">
              <div className="term__ai-top"><span className="term__ai-l"><Icon name="analyze" size={12} /> AI Mode</span>
                <div className="term__ai-seg">{(['Off', 'Copilot'] as const).map((m) => <button key={m} className={m === ai ? 'on' : ''} onClick={() => setAi(m)}>{m}</button>)}</div>
              </div>
              {ai !== 'Off' && (
                <div className="term__cop">
                  {copilot.loading && !copilot.result && <div className="term__cop-load"><span className="term__cop-spin" /> Reading order flow on {pair}…</div>}
                  {copilot.error && !copilot.loading && (
                    <div className="term__cop-err"><Icon name="alert" size={12} /> {copilot.error}<button onClick={runCopilot}>Retry</button></div>
                  )}
                  {copilot.result && (() => {
                    const r = copilot.result; const b = r.bias.toLowerCase();
                    return (
                      <>
                        <div className="term__cop-h">
                          <span className={'term__cop-bias term__cop-bias--' + b}>{r.bias} · {r.conviction} conviction</span>
                          <button className="term__cop-refresh" disabled={copilot.loading} onClick={runCopilot} title="Refresh read"><Icon name="refresh" size={12} /></button>
                        </div>
                        <div className="term__cop-levels">
                          <div><span>Entry</span><b>{r.entry || '—'}</b></div>
                          <div><span>Target</span><b className="up">{r.target || '—'}</b></div>
                          <div><span>Stop</span><b className="down">{r.stop || '—'}</b></div>
                        </div>
                        {r.rationale && <p className="term__cop-rationale">{r.rationale}</p>}
                        {r.position && <p className="term__cop-pos"><Icon name="wallet" size={11} /> {r.position}</p>}
                        {r.risk && <p className="term__cop-risk"><Icon name="alert" size={11} /> {r.risk}</p>}
                        {(r.bias === 'Long' || r.bias === 'Short') && (
                          <button className="term__cop-apply" onClick={() => { setSide(r.bias as 'Long' | 'Short'); toast(`Ticket set to ${r.bias} ${pair}`, { icon: 'check' }); }}>
                            Apply {r.bias} to ticket <Icon name="arrowRight" size={12} />
                          </button>
                        )}
                        <div className="term__cop-foot">You sign every trade. · DeepSeek on live book + funding</div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            </div>{/* /term__entry-scroll */}

            {/* submit CTA — pinned below the scrolling form so it's always visible (trade.xyz anatomy) */}
            {(() => {
              // Before the agent is approved, the trade button becomes "Enable 1-click trading"
              // (like HL's "Enable Trading") — one clear consent step, then normal order flow.
              const needsAgent = signer.ready && hl.loaded && !readOnlyMarket && !agent.hasAgent;
              const label = readOnlyMarket ? 'Read-only · trading unavailable'
                : !signer.ready ? 'Connect wallet to trade'
                : !hl.loaded ? (hl.unavailable ? 'Account data unavailable' : 'Verifying account…')
                : needsAgent ? 'Enable 1-click trading'
                : `${side} ${pair}`;
              // margin gates the ORDER, not the agent-consent step
              const blocked = !needsAgent && !readOnlyMarket && signer.ready && marginShort;
              return (
                <>
                  <button
                    className={'term__submit term__submit--' + (needsAgent ? 'long' : side.toLowerCase())}
                    onClick={needsAgent ? () => setEnableSheet(true) : submit}
                    disabled={placing || readOnlyMarket || (signer.ready && !hl.loaded) || !!blocked}
                  >{label}</button>
                  {blocked && <div className="term__whyoff">Needs {fmtUsd(blocked.needed)} margin · {fmtUsd(blocked.available)} available</div>}
                </>
              );
            })()}

            {/* INCOGNITO: the account that executes, not the account you funded elsewhere.
                The Hyperliquid card (AcctCard, below) showed real equity and Deposit/Withdraw for
                an account this app never touches — accurate, and a lie in this context. */}
            <ShieldedAcct which="desk" shielded={shielded} epochId={epoch.epochId}
              secondsLeft={epoch.secondsLeft} live={epoch.live} />
          </aside>

          {/* bottom positions/orders — spans under news/chart/book only (right column is full-height) */}
          <div className="term__bottom">
            {rsz('bottom', 't')}
            <div className="term__bottom-bar">
              <div className="term__bottom-tabs">
                {B_TABS.map((tb) => (
                  <button key={tb} className={tb === btab ? 'on' : ''} onClick={() => setBtab(tb)}>{tb}</button>
                ))}
              </div>
              <div className="term__bottom-tools">
                <span className="muted">
                  {shielded.address
                    ? `${shielded.address.slice(0, 6)}…${shielded.address.slice(-4)} · Base ${import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'Sepolia'}`
                    : `Base ${import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'Sepolia'}`}
                </span>
              </div>
            </div>
            <div className="term__bottom-body">
              <SealedOrders shieldedAddress={shielded.address} currentEpoch={epoch.epochId} />
            </div>
          </div>

          {/* mobile-only: account card lives in the Account mtab (hidden on desktop) */}
          <ShieldedAcct which="mob" shielded={shielded} epochId={epoch.epochId}
            secondsLeft={epoch.secondsLeft} live={epoch.live} />
        </div>
      </div>

      {paletteOpen && <MarketSelect onPick={pickPair} onClose={() => setPaletteOpen(false)} />}

      {confirm && !skipCfm && (() => {
        const c = confirm; const isLong = c.params.isBuy; const coin = c.params.coin;
        return (
          <div className="term__cfm" onClick={(e) => { if (e.target === e.currentTarget && !placing) setConfirm(null); }}>
            <div className="term__cfm-card">
              <div className="term__cfm-h">
                <span className={'term__cfm-side term__cfm-side--' + (isLong ? 'long' : 'short')}>{isLong ? 'Long' : 'Short'}</span>
                <b>{coin}-PERP</b>
                <span className="term__cfm-type">{c.params.type}{c.params.reduceOnly ? ' · Reduce' : ''}</span>
                <button className="term__cfm-x" disabled={placing} onClick={() => setConfirm(null)}><Icon name="close" size={16} /></button>
              </div>
              <div className="term__cfm-rows">
                <div><span>Order value</span><b>{fmtUsd(c.params.usd)}</b></div>
                <div><span>Reference price</span><b>{fmtPx(c.price)}</b></div>
                <div><span>Seals into</span><b>Epoch {epoch.epochId ?? '—'}</b></div>
                <div><span>If unmatched</span><b>{resid === 'unfilled' ? 'Return unfilled' : 'Route to Avantis'}</b></div>
                {/* THE SEATBELT. The spec calls for an executing-address line here and this is
                    why: it is the last screen before signing, and it is the only moment a user
                    can confirm that shielding actually engaged rather than silently failed
                    open. If this ever showed the connected wallet, the trade would be
                    permanently attributable and no later fix removes it from the chain. */}
                <div className="term__cfm-shield">
                  <span>Executing as</span>
                  <b>{shielded.address ? `${shielded.address.slice(0, 6)}…${shielded.address.slice(-4)}` : '—'} <em>shielded</em></b>
                </div>
              </div>
              {/* quiet fine print, trade.xyz-style — plain facts, no warning chrome; the fee
                  also lives as a sidenote in the entry column so this stays one dim line */}
              {/* The slippage and fee lines that were here described a Hyperliquid fill: a taker
                  fee, a builder fee, a price band. None of them apply — nothing fills at a
                  price right now, and the only cost is Inco's input fee plus gas. */}
              <div className="term__cfm-fine">
                Your size is encrypted in this browser and stays sealed until the epoch closes.
                Base {import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'Sepolia'} · costs the Inco input fee plus gas.
              </div>
              <div className="term__cfm-actions">
                <label className="term__cfm-skip"><input type="checkbox" checked={skipCfm} onChange={(e) => { setSkipCfm(e.target.checked); try { localStorage.setItem('hence.term.skipConfirm', e.target.checked ? '1' : ''); } catch { /* storage off */ } }} /> Don't show again</label>
                <button className="term__cfm-cancel" disabled={placing} onClick={() => setConfirm(null)}>Cancel</button>
                <button className={'term__cfm-go term__cfm-go--' + (isLong ? 'long' : 'short')} disabled={placing || approving} onClick={doPlace}>
                  {approving ? <><span className="term__cop-spin" /> Approve fee cap in wallet…</>
                    : placing ? <><span className="term__cop-spin" /> {agent.approving ? 'Approve in wallet…' : 'Placing…'}</>
                      : <>Confirm {isLong ? 'Long' : 'Short'} <Icon name="arrowRight" size={13} /></>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* "Enable 1-click trading" — the one-time agent approval, surfaced up front (HL's
          "Establish Connection"). Gas-free signature; the key trades but can't withdraw funds. */}
      {enableSheet && (
        <div className="term__cfm" onClick={(e) => { if (e.target === e.currentTarget && !enabling) setEnableSheet(false); }}>
          <div className="term__cfm-card">
            <div className="term__cfm-h">
              <span className="term__cfm-side term__cfm-side--long">Hence</span>
              <b>Enable 1-click trading</b>
              <span className="term__cfm-type">one-time</span>
              <button className="term__cfm-x" disabled={enabling} onClick={() => setEnableSheet(false)}><Icon name="close" size={16} /></button>
            </div>
            <p className="term__cfm-blurb">
              Approve a trading key once and orders, cancels and leverage changes sign instantly —
              no wallet popup each time. The signature is <b>gas-free</b>.
            </p>
            <div className="term__cfm-note"><Icon name="alert" size={12} /> The key can place and close trades on your account but <b>cannot withdraw or move your funds</b> — that always needs your wallet. Revoke it anytime on Hyperliquid.</div>
            <div className="term__cfm-actions">
              <button className="term__cfm-cancel" disabled={enabling} onClick={() => setEnableSheet(false)}>Not now</button>
              <button className="term__cfm-go term__cfm-go--long" disabled={enabling} onClick={doEnableAgent}>
                {enabling ? <><span className="term__cop-spin" /> Approve in wallet…</> : <>Enable trading <Icon name="arrowRight" size={13} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* close-position confirm — receipt style, with trade.xyz's partial-close % chips */}

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
              <div className="term__cfm-fine">Closes at market (reduce-only, fee-free), up to {slipPct}% from mark.</div>
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

      {/* position TP/SL — reduce-only trigger orders (grouping positionTpsl, fee-free) */}
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

/* The Hyperliquid AcctCard was removed here, not commented out. It rendered real equity,
   margin and Deposit/Transfer/Withdraw for an account this app never touches. Keeping a dead
   copy around is how Ticket.tsx got edited for an hour while the running screen imported
   something else — see components/ShieldedAcct.tsx for what replaced it. */

function TickerTape({ ready }: { ready: boolean }) {
  const mv0 = ready ? market.topMovers('crypto', 14) : { gainers: [], losers: [] };
  // INCOGNITO: the marquee bypasses searchMarkets, so it needs the same narrowing — a tape
  // scrolling markets this venue cannot fill is an invitation to click one.
  const mv = {
    gainers: (mv0.gainers || []).filter((r: any) => isAvantisSymbol(r.sym || r)),
    losers: (mv0.losers || []).filter((r: any) => isAvantisSymbol(r.sym || r)),
  };
  const syms = [...new Set([...(mv.gainers || []), ...(mv.losers || [])])] as string[];
  if (!syms.length) return <div className="term__tape"><div className="term__tape-track"><span className="term__tape-i">Loading markets…</span></div></div>;
  const Item = ({ s }: { s: string }) => { const t = getTicker(s); const u = (t.chgPct || 0) >= 0; return (
    <Link className="term__tape-i" to={'/terminal/' + s}><Logo sym={s} size={14} /><span className="term__tape-sym">{s}</span><span className="term__tape-px">{t.real && t.price > 0 ? market.fmtPrice(t.price) : '—'}</span><span className={t.changeReal ? (u ? 'up' : 'down') : 'muted'}>{t.changeReal ? fmtPct(t.chgPct) : '—'}</span></Link>
  ); };
  return <div className="term__tape"><div className="term__tape-track">{syms.map((s) => <Item key={'a' + s} s={s} />)}{syms.map((s) => <Item key={'b' + s} s={s} />)}</div></div>;
}

// bottom panel: real Hyperliquid positions / open orders / balances for the connected account
