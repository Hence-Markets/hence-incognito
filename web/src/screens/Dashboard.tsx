/* Home — world-aware (Stocks ⇄ Crypto): market card + Daily recap feed.
   React port of app/screens/dashboard.js. */
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/dashboard-extra.css';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { SvgChart } from '../components/SvgChart';
import { SectionTabs } from '../components/Segmented';
import { henceMarkSvg } from '../components/HenceLogo';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount } from '../hooks/useHlAccount';
import { useHlPortfolio, pfSeriesForRange } from '../hooks/useHlPortfolio';
import { snapshotCachedAll, type Snapshot } from '../lib/venueBalances';
import { useMe } from '../hooks/useMe';
import { INTEREST_GROUPS } from '../lib/interests.js';
import { initCharts } from '../lib/charts.js';
import { getTicker } from '../lib/data.js';
import { icon, logo, fmtPct, cls, toast } from '../lib/ui.js';
import { createRoot } from 'react-dom/client';
import { WatchlistPanel } from '../components/WatchlistPanel';
import { ThesisCard } from '../components/ThesisCard';
import * as market from '../lib/market.js';
import * as ai from '../lib/ai.js';
import * as fmp from '../lib/fmp.js';
import * as signals from '../lib/signals.js';
import { nameOf, ensureNames } from '../lib/asset-name.js';
import { getWatch, toggleWatch } from '../components/MarketSelect';
import { openChipMenu } from '../components/ChipMenu';
import { linkEntities } from '../lib/entities';
import { SignalsFeed, SignalsRail } from '../components/SignalsRail';
import { isTeamWallet } from '../lib/team';
import * as stash from '../lib/stash';
import * as poly from '../lib/polymarket.js';
import { logIdea, loadTheses } from '../lib/me.js';
import { optionalAuthApiFetch } from '../lib/auth-transport';
import { useMarketReady } from '../hooks/useMarket';
import { Skeleton, SkeletonText, SkeletonValue } from '../components/Loading';
// @ts-ignore — JS safety helpers used by legacy HTML-string cards
import { escapeHtml, safeHttpUrl, safeSymbol, stripHtml } from '../lib/safe-html.js';

// source-interest slug → display name (e.g. 'arthur-hayes' → 'Arthur Hayes'), to match calls
const SOURCE_NAME: Record<string, string> = Object.fromEntries(
  ((INTEREST_GROUPS.find((g: any) => g.kind === 'source') || { items: [] }).items as any[]).map((i: any) => [i.topic, i.label]),
);
const bestExcess = (c: any) => { const r = c.returns || {}; const h = r.live || r['30d'] || r['7d'] || r['1d']; return h ? h.excess : null; };

/* Home teaser: a personalized "For you" strip (from the voices/assets the user follows) when we
   have interests + matching calls, else the shared top podcast/newsletter signals digest. */
function SignalsTeaser({ world }: { world: string }) {
  const { interests } = useMe();
  const [cards, setCards] = useState<any[] | null>(null);
  const [mine, setMine] = useState<any[] | null>(null);

  const followed = interests.filter((i: any) => i.kind === 'source').map((i: any) => SOURCE_NAME[i.topic] || i.topic);
  // learned assets seed at 0.75 (below curated 1.0); this drops rows a dismissal has decayed
  // below the initial-reaction level so a fading interest stops driving "For you" before it's removed
  const myAssets = interests.filter((i: any) => i.kind === 'asset' && Number(i.weight ?? 1) >= 0.75).map((i: any) => String(i.topic).toUpperCase());
  const hasInterests = followed.length > 0 || myAssets.length > 0;

  useEffect(() => {
    let alive = true;
    signals.digest('7d', world).then((r: any) => { if (alive && r.available) setCards(r.cards || []); }).catch(() => {});
    return () => { alive = false; };
  }, [world]);

  useEffect(() => {
    if (!hasInterests) { setMine(null); return; }
    let alive = true;
    signals.recentCalls(40).then((r: any) => {
      if (!alive || !r.available) return;
      const hit = (r.calls || []).filter((c: any) =>
        followed.includes(c.source) || followed.includes(c.person) || myAssets.includes(c.symbol));
      setMine(hit.slice(0, 3));
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interests.length]);

  const xp = (v: number) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '% vs BTC');
  const dcls = (v: number) => (v == null ? '' : v >= 0 ? 'up' : 'down');

  // personalized view: calls from the voices/assets you chose at onboarding
  if (mine && mine.length) {
    return (
      <a className="sig-teaser" href="#/signals">
        <div className="sig-teaser__h"><Icon name="bolt" size={13} /> For you <span className="sig-teaser__by">· voices &amp; assets you follow</span> <span className="more">View all</span></div>
        {mine.map((c: any, i: number) => (
          <div className="sig-teaser__row" key={i}>
            <Logo sym={c.symbol} size={18} /><span className="sym">{c.symbol}</span>
            <span className={'dir ' + c.direction}>{c.direction}</span>
            <span className="src">{c.person || c.source}</span>
            <span className={'ret ' + dcls(bestExcess(c))}>{xp(bestExcess(c))}</span>
          </div>
        ))}
      </a>
    );
  }

  if (!cards || !cards.length) return null;
  return (
    <a className="sig-teaser" href="#/signals">
      <div className="sig-teaser__h"><Icon name="bolt" size={13} /> Podcast &amp; newsletter signals <span className="more">View all</span></div>
      {cards.map((c: any, i: number) => {
        if (c.type === 'signal_top_caller') return (
          <div className="sig-teaser__row" key={i}>
            <span className="dg">★</span><span className="sym">Top caller</span>
            <span className="src">{c.name}</span>
            <span className={'ret ' + dcls(c.avg_excess)}>{xp(c.avg_excess)}</span>
          </div>
        );
        if (c.type === 'signal_consensus') return (
          <div className="sig-teaser__row" key={i}>
            <Logo sym={c.symbol} size={18} /><span className="sym">{c.symbol}</span>
            <span className={'dir ' + c.direction}>{c.callers} {c.direction}</span>
            <span className="src">consensus</span>
            {c.avg_excess != null && <span className={'ret ' + dcls(c.avg_excess)}>{xp(c.avg_excess)}</span>}
          </div>
        );
        if (c.type === 'signal_hot_call') return (
          <div className="sig-teaser__row" key={i}>
            <Logo sym={c.symbol} size={18} /><span className="sym">{c.symbol}</span>
            <span className={'dir ' + c.direction}>{c.direction}</span>
            <span className="src">{c.person || c.source}</span>
            <span className={'ret ' + dcls(c.excess)}>{xp(c.excess)}</span>
          </div>
        );
        return null;
      })}
    </a>
  );
}

/* ---------------------------------------------------------------
   "Today's setups" — AI setups for the current world (/api/setups),
   fed the same breadth/movers payload the recap uses (via the
   'hence:recapdata' event so it fetches once per world with real data).
   Renders nothing when signed-out fails / endpoint down / empty.
   --------------------------------------------------------------- */
const DISMISS_KEY = 'hence.dismissed.v1';
function readDismissed(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); }
  catch { return new Set(); }
}
function writeDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}
const SETUP_TAG: Record<string, string> = { for_you: 'For you', signals: 'Signals', momentum: 'Momentum' };

/* Setups and theses are generated from the SAME grounding payload by the same model, so left
   alone they collide — the home showed a "CASHCAT short" setup directly above a "CASHCAT
   short" thesis, and once that was deduped by direction, a "PURR short" setup above a "PURR
   long" thesis (the two blocks cache on different clocks, so they can disagree). Matching on
   SYMBOL alone kills both failure modes: restating an idea is bad, contradicting it on the
   same screen is worse. SetupsBlock publishes what it actually rendered via an event — not a
   shared ref — because neither block can assume it mounts or resolves first. */
let shownSetupSyms = new Set<string>();

function SetupsBlock({ world }: { world: string }) {
  const [setups, setSetups] = useState<any[] | null>(null);
  // Elfa A/B cohort only (server omits the field otherwise): the attention strip above cards
  const [attention, setAttention] = useState<any[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const lastKey = useRef<string>('');

  useEffect(() => {
    let alive = true;
    const run = (data: any) => {
      const key = world + ':' + (data ? Object.keys(data).length : 0);
      if (lastKey.current === key) return; // already fetched this world with data
      lastKey.current = key;
      const social = (() => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } })();
      const body = { world: world === 'crypto' ? 'crypto' : 'markets', data: data || {}, social };
      optionalAuthApiFetch('/api/setups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then((r) => (r.ok ? r.json() : null))
          .then((res: any) => {
            if (!alive || !res || !res.available) return;
            if (Array.isArray(res.setups)) setSetups(res.setups);
            setAttention(Array.isArray(res.social_attention) ? res.social_attention : null);
          })
          .catch(() => {});
    };
    const onData = (e: any) => { if (e.detail?.world === world) run(e.detail.data); };
    window.addEventListener('hence:recapdata', onData);
    // if the recap already ran for this world before we mounted, use the cached payload
    if (activeRecapData) run(activeRecapData);
    return () => { alive = false; window.removeEventListener('hence:recapdata', onData); };
  }, [world]);

  // reset the per-world fetch guard so switching worlds refetches
  useEffect(() => { lastKey.current = ''; setSetups(null); }, [world]);

  const shown = (setups || []).filter((s) => !dismissed.has(s.id)).slice(0, 3);
  // publish what's on screen so the thesis block can avoid restating it
  useEffect(() => {
    shownSetupSyms = new Set(shown.map((s) => String(s.symbol || '').toUpperCase()));
    window.dispatchEvent(new CustomEvent('hence:setupsshown'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((s) => s.id).join(',')]);
  if (!shown.length) return null;

  const onDismiss = (s: any) => {
    const next = new Set(dismissed); next.add(s.id); setDismissed(next); writeDismissed(next);
    stash.record({ kind: 'dismiss', subject_type: 'setup', key: s.id, title: s.catalyst, symbols: s.symbol ? [s.symbol] : [] });
  };
  const onSave = (s: any) => {
    stash.record({ kind: 'save', subject_type: 'setup', key: s.id, symbol: s.symbol, symbols: s.symbol ? [s.symbol] : [], title: s.catalyst });
    toast(`Saved setup · ${s.symbol}`, s.symbol ? { ticker: s.symbol } : { icon: 'check' });
  };

  return (
    <div className="setups-block">
      <div className="sig-teaser__h"><Icon name="bolt" size={13} /> Today’s setups</div>
      {attention && attention.length ? (
        <div className="setups-attn" title="Social attention (X + Telegram, bot-filtered) — mention growth over 24h. A/B preview.">
          {attention.slice(0, 4).map((a: any) => (
            <span key={a.token} className="setups-attn__i">
              <b>{a.token}</b> {a.change_pct > 0 ? '+' : ''}{Math.round(a.change_pct)}% mentions
            </span>
          ))}
        </div>
      ) : null}
      {shown.map((s) => (
        <div className="setup-row" key={s.id}>
          <div className="setup-row__top">
            <span className={`setup-tag setup-tag--${s.source_tag}`}>{SETUP_TAG[s.source_tag] || s.source_tag}</span>
            <Logo sym={s.symbol} size={18} /><span className="sym">{s.symbol}</span>
            <span className={'dir ' + (s.direction === 'short' ? 'short' : s.direction === 'long' ? 'long' : 'neutral')}>{s.direction}</span>
          </div>
          <div className="setup-row__cat">{s.catalyst}</div>
          <div className="setup-row__meta">{[s.horizon, s.invalidation].filter(Boolean).join(' · ')}</div>
          <div className="feed-rail setup-row__rail">
            {s.action?.route ? <button className="rail-btn" onClick={() => { location.hash = s.action.route; }}>Trade</button> : null}
            <button className="rail-btn" onClick={() => onSave(s)}>Save</button>
            <button className="rail-btn" onClick={() => onDismiss(s)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------
   AI theses on the home feed (/api/thesis-feed) — the same cohort-cache +
   local-ranking architecture as SetupsBlock, one level up: a thesis is a
   belief with a horizon and an invalidation, and (since the run sheet) it
   can be funded straight from the card.

   Deliberately capped at ONE card per render. The home is a news feed with
   AI in it, not a wall of generated ideas — and dismissals share the same
   'hence.dismissed.v1' set as the setups block, so a dismissed idea stays
   gone across both surfaces.
   --------------------------------------------------------------- */
function ThesisFeedBlock({ world }: { world: string }) {
  const [theses, setTheses] = useState<any[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const lastKey = useRef<string>('');

  useEffect(() => {
    let alive = true;
    const run = (data: any) => {
      // ONE fetch per world, and only once the payload actually carries something to ground a
      // thesis in. The recap emits 'hence:recapdata' repeatedly as its payload fills in, so a key
      // derived from the payload's shape (what SetupsBlock does) re-fires on every growth step —
      // this block was firing eight times per page load for one hour-cached answer.
      const usable = data && ['movers', 'gainers', 'losers', 'breadth', 'categories'].some((k) => {
        const v = (data as any)[k];
        return Array.isArray(v) ? v.length > 0 : !!v;
      });
      if (!usable || lastKey.current === world) return;
      lastKey.current = world;
      const body = { world: world === 'crypto' ? 'crypto' : 'markets', data: data || {} };
      optionalAuthApiFetch('/api/thesis-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => (r.ok ? r.json() : null))
        .then((res: any) => { if (alive && res && res.available && Array.isArray(res.theses)) setTheses(res.theses); })
        .catch(() => {});
    };
    const onData = (e: any) => { if (e.detail?.world === world) run(e.detail.data); };
    window.addEventListener('hence:recapdata', onData);
    if (activeRecapData) run(activeRecapData);          // the recap already ran before we mounted
    return () => { alive = false; window.removeEventListener('hence:recapdata', onData); };
  }, [world]);

  useEffect(() => { lastKey.current = ''; setTheses(null); }, [world]);

  // re-filter when the setups block reports what it rendered
  const [setupsNonce, setSetupsNonce] = useState(0);
  useEffect(() => {
    const bump = () => setSetupsNonce((n) => n + 1);
    window.addEventListener('hence:setupsshown', bump);
    return () => window.removeEventListener('hence:setupsshown', bump);
  }, []);

  const candidates = (theses || []).filter((t) => {
    if (dismissed.has(t.id)) return false;
    // a thesis whose every leg names a symbol the setups block is already showing either
    // restates it or contradicts it — neither belongs on the same screen
    const legs = (t.legs || []).filter((l: any) => l && l.symbol);
    return !legs.length || !legs.every((l: any) => shownSetupSyms.has(String(l.symbol).toUpperCase()));
  });
  // a multi-leg thesis is the one that justifies the card: a single leg IS a setup, and the
  // setups block already does that better. Prefer baskets, fall back to a single only if
  // nothing else survived.
  const multi = candidates.filter((t) => (t.legs || []).length > 1);
  const shown = (multi.length ? multi : candidates).slice(0, 1);
  void setupsNonce;                                   // filter reads shownSetupSyms on render
  if (!shown.length) return null;

  const onDismiss = (t: any) => {
    const next = new Set(dismissed); next.add(t.id); setDismissed(next); writeDismissed(next);
    stash.record({
      kind: 'dismiss', subject_type: 'thesis', key: t.id, title: t.title,
      symbols: (t.legs || []).map((l: any) => l.symbol).filter(Boolean).slice(0, 4),
      // corpus: a dismissal is only a training label if we keep WHAT was dismissed — the
      // card's actual content at the moment of rejection, not just its id (feed ids are
      // content hashes; the content itself ages out of the cohort cache within hours).
      evidence: {
        card: {
          title: t.title, summary: (t.summary || '').slice(0, 400), direction: t.direction,
          horizon_days: t.horizon_days, source_tag: t.source_tag,
          author: t.author?.handle || null,
          legs: (t.legs || []).slice(0, 6).map((l: any) => ({
            symbol: l.symbol, direction: l.direction, venue: l.venue,
            invalidation: l.invalidation || null,
          })),
        },
      },
    });
  };
  const onSave = (t: any) => {
    stash.record({
      kind: 'save', subject_type: 'thesis', key: t.id, title: t.title,
      symbols: (t.legs || []).map((l: any) => l.symbol).filter(Boolean).slice(0, 4),
    });
  };

  return (
    <div className="thesis-block">
      <div className="sig-teaser__h"><Icon name="sparkle" size={13} /> A thesis for you</div>
      {shown.map((t) => <ThesisCard key={t.id} t={t} onSave={onSave} onDismiss={onDismiss} />)}
    </div>
  );
}

/* ---------------------------------------------------------------
   "From your stash" — up to 2 derived theses (/api/me/theses).
   Only renders when signed in AND ≥1 thesis. Tapping opens an
   imperative reader-style overlay with the thesis + its evidence.
   --------------------------------------------------------------- */
function StashBlock() {
  const [theses, setTheses] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!(window as any).henceMe) { setTheses(null); return; }
      loadTheses().then((r: any) => { if (alive && r && r.available && Array.isArray(r.theses)) setTheses(r.theses); else if (alive) setTheses(null); }).catch(() => {});
    };
    load();
    window.addEventListener('hence:me', load);
    return () => { alive = false; window.removeEventListener('hence:me', load); };
  }, []);

  const shown = (theses || []).slice(0, 2);
  if (!shown.length) return null;
  // nightly thesis-checker verdicts (copilot P5): a breached invalidation flips the thesis
  // to 'invalidated'; a past review date flags 'review_due' — both surface here.
  const checkBadge = (t: any) => {
    if (t.status === 'invalidated') return <span className="thesis-row__badge thesis-row__badge--inv">Invalidated</span>;
    const flags: string[] = (t.last_check && t.last_check.flags) || [];
    if (flags.includes('review_due')) return <span className="thesis-row__badge thesis-row__badge--due">Review due</span>;
    return null;
  };
  return (
    <div className="stash-block">
      <div className="sig-teaser__h"><Icon name="bookmark" size={13} /> From your stash</div>
      {shown.map((t: any) => (
        <button className="thesis-row" key={t.id} onClick={() => openThesis(t)}>
          <div className="thesis-row__top">
            <span className="thesis-row__logos">{(t.symbols || []).slice(0, 3).map((s: string) => <Logo key={s} sym={s} size={18} />)}</span>
            <span className="thesis-row__title">{t.title}</span>
            {checkBadge(t)}
            <span className="thesis-row__n">{t.evidence_count || (t.evidence || []).length} saves</span>
          </div>
          {t.summary ? <div className="thesis-row__sum">{t.summary}</div> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- STOCKS world ---------- */
const SECTORS2: [string, number][] = [
  ['Healthcare', 0.88], ['Financial', 0.65], ['Real Estate', 0.52], ['Consumer Defensive', 0.39],
  ['Energy', 0.23], ['Communication Services', 0.19], ['Basic Materials', 0.02], ['Industrials', -0.32],
  ['Utilities', -0.37], ['Consumer Cyclical', -0.60], ['Technology', -1.32],
];
const SUMMARY = 'Markets drift sideways as investors weigh mixed earnings against cooling inflation data. Energy leads on supply concerns while large‑cap tech consolidates after a strong run. Overseas, sentiment steadies on softer European prints and a calmer currency backdrop.';
const FEED: any[] = [
  { tickers: ['XOM', 'CVX', 'BP', 'SHEL', 'COP', 'OXY', 'SLB', 'HAL', 'VLO'], time: 'Today · 10m ago', body: 'Oil edges higher for a second session as fresh supply worries ripple through global energy markets.' },
  { ticker: 'NVDA', time: 'Today · 1h ago', body: `Demand for Nvidia's <span class="pill down">-2.60%</span> data‑center chips stays firm as cloud providers expand AI capacity, per supply‑chain checks.` },
  { ticker: 'TSLA', time: 'Today · 2h ago', body: 'A coming software update is said to add expanded city‑navigation features to assisted driving in select markets.' },
  { ticker: 'JNJ', time: 'Today · 4h ago', body: 'Healthcare group files suit over an alleged contract breach tied to a biosimilar program.' },
  {
    type: 'intel', time: 'Today · 8h ago', text: 'There are 4 important earnings calls tomorrow, including 1 from your watchlist.',
    earnings: [
      ['NVDA', 'NVIDIA Corporation', 'Feb 27, 5:00 AM', '27'],
      ['CRM', 'Salesforce Inc.', 'Feb 27, 5:00 AM', '27'],
      ['TJX', 'The TJX Companies Inc.', 'Feb 27, 12:30 AM', '27'],
      ['LOW', "Lowe's Companies Inc.", 'Tomorrow at 9:00 PM', '26'],
    ], footer: '4 events in total are happening tomorrow.',
  },
  { ticker: 'TEF', time: 'Today · 6h ago', body: 'Telecom group agrees to sell its Argentina unit in a deal valued near $1.2 billion.' },
  { ticker: 'REGN', time: 'Today · 6h ago', body: `An experimental gene therapy <span class="pill up">+2.41%</span> shows encouraging hearing improvements in an early‑stage study.` },
  { ticker: 'JPM', time: 'Today · 6h ago', body: `Bank leadership <span class="pill down">-0.89%</span> reaffirms its commitment to existing diversity programs amid an industry shift.` },
  { ticker: 'NKE', time: 'Today · 6h ago', body: 'An analyst upgrades the stock to buy from hold, lifting the price target on improving momentum.' },
];

/* ---------- CRYPTO world ---------- */
const CRYPTO_CATS: [string, number][] = [
  ['AI Agents', 6.40], ['Memecoins', 3.80], ['Layer 1', 2.90], ['DeFi', 2.10], ['RWA', 1.95],
  ['Liquid Staking', 0.90], ['Infrastructure', 0.40], ['Payments', -0.55], ['Gaming', -1.60],
  ['DePIN', -2.40], ['NFT', -3.10],
];
const CRYPTO_SUMMARY = 'Bitcoin holds above a key level as spot‑ETF inflows resume, lifting majors while liquidity rotates down the risk curve. AI tokens and Layer 1s lead, DeFi steadies, and memecoins swing hard on social momentum. On‑chain activity ticks up as stablecoin supply expands.';
const CRYPTO_FEED: any[] = [
  { ticker: 'BTC', time: 'Today · 12m ago', body: `Spot ETFs add to holdings for a third straight day <span class="pill up">+1.6%</span> as desks flag steady institutional demand.` },
  { ticker: 'ETH', time: 'Today · 1h ago', body: `Staking inflows climb <span class="pill up">+2.3%</span> ahead of a network upgrade as layer‑2 activity hits a new high.` },
  {
    type: 'movers', time: 'Today · 30m ago', text: 'Memecoins are moving — 4 names on your watchlist saw outsized volume in the last hour.',
    movers: [['WIF', 'dogwifhat', '+22.1%', true], ['BONK', 'Bonk', '+14.7%', true], ['DOGE', 'Dogecoin', '+8.4%', true], ['PEPE', 'Pepe', '-6.2%', false]],
    footer: 'Volatility is elevated across the Memecoins category.',
  },
  { ticker: 'SOL', time: 'Today · 2h ago', body: 'Throughput records and a wave of new app launches keep the ecosystem in focus among active traders.' },
  { tickers: ['RNDR', 'FET', 'TAO'], time: 'Today · 3h ago', body: `AI tokens extend their run <span class="pill up">+6.4%</span> as compute‑demand narratives draw fresh flows.` },
  { tickers: ['ONDO', 'MKR'], time: 'Today · 4h ago', body: 'Tokenized treasury products see fresh inflows as real‑world‑asset supply expands across chains.' },
  { ticker: 'UNI', time: 'Today · 5h ago', body: `Governance floats a fee‑switch proposal <span class="pill down">-0.9%</span>; DEX volumes hold near monthly highs.` },
];

const WORLDS: any = {
  stocks: {
    label: 'Stocks', cats: SECTORS2, summary: SUMMARY, feed: FEED,
    sentLead: 'The markets are', sentiment: { word: 'neutral', cls: 'sent-neutral' },
    stateLabel: 'The markets are <b>closed</b>', stateIcon: 'moon', stateToast: 'Light mode is coming soon',
    chart: { primary: 'SP500', secondary: 'VIX', secColor: 'rgba(150,120,220,0.9)', secFill: 'rgba(150,120,220,0.10)', legend: ['S&P 500', 'VIX'], connect: 'Connect Portfolio' },
  },
  crypto: {
    label: 'Crypto', cats: CRYPTO_CATS, summary: CRYPTO_SUMMARY, feed: CRYPTO_FEED,
    sentLead: 'The market is', sentiment: { word: 'bullish', cls: 'sent-bull' },
    stateLabel: 'Crypto is <b>live</b>', stateIcon: 'sun', stateToast: 'Crypto markets trade 24/7',
    chart: { primary: 'BTC', secondary: 'ETH', secColor: 'rgba(99,126,234,0.95)', secFill: 'rgba(99,126,234,0.10)', legend: ['BTC', 'ETH'], connect: 'Connect Wallet' },
  },
};

/* the reader reads the currently-active world's data (module-level, like vanilla) */
let activeFeed: any[] = FEED;
let activeSummary = SUMMARY;
let activeRecapData: any = null;   // breadth/movers/news payload for the "Read more" long brief
let activeRecapText = '';          // the recap currently on screen — the brief must expand THIS text
const activeLongBrief: Record<string, { key: string; text: string }> = {};   // per world, keyed by the recap it expands

/* in-memory + localStorage cache of the AI feed/recap so switching worlds or reloading
   doesn't re-fetch news or re-call DeepSeek. News is daily-ish, so ~8 min is plenty. */
const FEED_TTL = 8 * 60_000;
const _homeCache: Record<string, { at: number; cards: any[]; recap: string }> = (() => {
  try { return JSON.parse(localStorage.getItem('hence.homefeed.v4') || '{}'); } catch { return {}; }
})();
function cacheGet(world: string) {
  const e = _homeCache[world];
  return e && Date.now() - e.at < FEED_TTL ? e : null;
}
function cachePut(world: string, cards: any[], recap: string) {
  _homeCache[world] = { at: Date.now(), cards, recap };
  try { localStorage.setItem('hence.homefeed.v4', JSON.stringify(_homeCache)); } catch { /* ignore */ }
}

/* market-breadth equalizer: green (advancers) → red (decliners) */
function equalizer(pct: number, seedKey: string) {
  const n = 44;
  const greenFrac = Math.max(0.1, Math.min(0.92, 0.5 + pct / 3.2));
  const split = Math.round(n * greenFrac);
  const r = (i: number) => { let h = 2166136261 ^ (seedKey.charCodeAt(0) + i * 131); h = Math.imul(h ^ (h >>> 13), 65599); return ((h >>> 0) % 100) / 100; };
  let bars = '';
  for (let i = 0; i < n; i++) bars += `<i class="${i < split ? 'up' : 'down'}" style="height:${62 + r(i) * 38}%"></i>`;
  return `<div class="eqbar">${bars}</div>`;
}

/* friendlier names for the related-asset tooltips */
const ASSET_NAMES: any = {
  XOM: 'Exxon Mobil', CVX: 'Chevron', BP: 'BP', SHEL: 'Shell', COP: 'ConocoPhillips',
  OXY: 'Occidental', SLB: 'SLB', HAL: 'Halliburton', VLO: 'Valero',
  NVDA: 'NVIDIA', TSLA: 'Tesla', JNJ: 'Johnson & Johnson', TEF: 'Telefónica',
  REGN: 'Regeneron', JPM: 'JPMorgan', NKE: 'Nike',
};
const assetName = (s: string) => {
  const nm = ASSET_NAMES[s] || nameOf(s);
  if (!nm) ensureNames([s]); // queue unknown names for lazy resolution
  return nm || s;
};
// tooltip text: "Full Name · TICKER" when we have a real name, else just the ticker
// (avoids the redundant "DYDX · DYDX"); queues unknown names for lazy resolution.
function tipFor(s: string) {
  const nm = ASSET_NAMES[s] || nameOf(s);
  if (!nm) ensureNames([s]);
  return nm && nm !== s ? `${nm} · ${s}` : s; // skip redundant "ORDI · ORDI"
}

function logoStack(tickers: string[]) {
  const safe = (Array.isArray(tickers) ? tickers : []).map((s) => safeSymbol(s)).filter(Boolean);
  const shown = safe.slice(0, 4), rest = safe.slice(4);
  return `<span class="feed-stack">
    ${shown.map((s, i) => `<a class="feed-stack__l" href="#/stock/${encodeURIComponent(s)}" data-tip="${escapeHtml(tipFor(s))}" style="z-index:${10 - i}">${logo(s, 20)}</a>`).join('')}
    ${rest.length ? `<a class="feed-stack__more" href="#/stock/${encodeURIComponent(rest[0])}" data-tip="${escapeHtml(rest.join('  ·  '))}">+${rest.length}</a>` : ''}
  </span>`;
}

function intelCard(n: any) {
  const earnings = Array.isArray(n.earnings) ? n.earnings : [];
  return `<div class="feed-card feed-intel">
    <div class="feed-head"><span class="feed-pill">${icon('analyze', 12)} Hence Intelligence</span><span class="feed-time">${escapeHtml(n.time)}</span></div>
    <div class="feed-body feed-body--lg">${escapeHtml(stripHtml(n.text))}</div>
    <div class="feed-earn-list">
      ${earnings.map(([rawTk, name, when, day]: any) => { const tk = safeSymbol(rawTk); return tk ? `<a class="feed-earn" href="#/stock/${encodeURIComponent(tk)}/earnings">
        ${logo(tk, 22)}<b class="feed-earn__tk">${escapeHtml(tk)}</b><span class="feed-earn__nm">${escapeHtml(name)}</span>
        <span class="feed-earn__when">${escapeHtml(when)}</span><span class="feed-earn__day">${escapeHtml(day)}</span></a>` : ''; }).join('')}
    </div>
    <div class="feed-intel__foot"><span>${escapeHtml(stripHtml(n.footer))}</span><a href="#/calendar" class="feed-gocal">Go to calendar ${icon('chevR', 12)}</a></div>
  </div>`;
}

/* memecoin movers — the crypto spotlight card */
function moversCard(n: any) {
  const label = n.cat ? `${String(n.cat)} movers` : 'Memecoin movers';
  const movers = Array.isArray(n.movers) ? n.movers : [];
  return `<div class="feed-card feed-intel">
    <div class="feed-head"><span class="feed-pill">${icon(n.icon === 'chart' ? 'chart' : 'coin', 12)} ${escapeHtml(label)}</span><span class="feed-time">${escapeHtml(n.time)}</span></div>
    <div class="feed-body feed-body--lg">${escapeHtml(stripHtml(n.text))}</div>
    <div class="feed-earn-list">
      ${movers.map(([rawTk, name, chg, up]: any) => { const tk = safeSymbol(rawTk); return tk ? `<a class="feed-earn" href="#/stock/${encodeURIComponent(tk)}">
        ${logo(tk, 22)}<b class="feed-earn__tk">${escapeHtml(tk)}</b><span class="feed-earn__nm">${escapeHtml(name)}</span>
        <span class="feed-earn__when ${up ? 'up' : 'down'}">${escapeHtml(chg)}</span><span class="pill ${up ? 'up' : 'down'}">${up ? '▲ vol' : '▼ vol'}</span></a>` : ''; }).join('')}
    </div>
    <div class="feed-intel__foot"><span>${escapeHtml(stripHtml(n.footer))}</span><a href="#/screener" class="feed-gocal">View category ${icon('chevR', 12)}</a></div>
  </div>`;
}

// relative "12m / 3h / 2d" from an FMP "YYYY-MM-DD HH:MM:SS" timestamp
function relTime(s?: string) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
}

// quiet action rail appended inside a feed card. Cards with a ticker get Trade/Watch/Save;
// macro cards (no ticker) get Save only. `tk` is the primary/only ticker for the card.
const THUMB_UP_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
const THUMB_DN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';

// evidence-card rail: 👍/👎 capture a directional belief on the story (agree stashes it as
// thesis evidence), Trade is the one always-visible action. Watch lives in the card head
// as a bookmark icon (see feedBookmark).
function feedRail(tk?: string, url?: string) {
  const symbol = safeSymbol(tk);
  // news cards key the reaction by url; story cards (no url) key it by the asset itself
  const r = url ? stash.reactionFor(url) : stash.reactionForAsset(symbol || '');
  const thumbs = `<span class="rail-thumbs">
    <button class="rail-thumb${r === 'agree' ? ' on' : ''}" data-act="up"${symbol ? ` data-tk="${escapeHtml(symbol)}"` : ''} title="Agree — stash as thesis evidence">${THUMB_UP_SVG}</button>
    <button class="rail-thumb rail-thumb--dn${r === 'disagree' ? ' on' : ''}" data-act="down"${symbol ? ` data-tk="${escapeHtml(symbol)}"` : ''} title="Disagree">${THUMB_DN_SVG}</button>
  </span>`;
  const trade = symbol ? `<button class="rail-trade" data-act="trade" data-tk="${escapeHtml(symbol)}" title="Open in the trade view">Trade</button>` : '';
  return `<div class="feed-rail">${thumbs}${trade}</div>`;
}

// small bookmark in the card head — toggles the watchlist (same iconography as the dock/topbar)
function feedBookmark(tk?: string) {
  const symbol = safeSymbol(tk);
  if (!symbol) return '';
  const on = getWatch().has(symbol);
  return `<button class="feed-bm${on ? ' on' : ''}" data-act="watch" data-tk="${escapeHtml(symbol)}" title="${on ? 'Remove from' : 'Follow in your'} watchlist">${icon('bookmark', 13)}</button>`;
}

// Fey-style news card: real article distilled to one AI line, tagged with the relevant
// ticker + its live move + source. Tapping the card opens the source; the ticker → its page.
function newsAiCard(n: any, i: number) {
  const tk = safeSymbol(n.ticker);
  const source = escapeHtml(n.source || (tk ? '' : 'Markets'));
  const url = safeHttpUrl(n.url);
  const head = tk
    ? `<a class="feed-tklink" href="#/stock/${encodeURIComponent(tk)}" data-tip="${escapeHtml(tipFor(tk))}">${logo(tk, 22)}<span class="feed-tk">${escapeHtml(tk)}</span></a>`
      + (n.pct != null ? `<span class="pill ${n.pct >= 0 ? 'up' : 'down'}">${fmtPct(n.pct)}</span>` : '')
      + (source ? `<span class="feed-news__src">${source}</span>` : '')
    : `<span class="feed-news__pub"><img class="feed-news__fav" src="/api/icon?src=fav&amp;c=${encodeURIComponent(String(n.site || ''))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">${source}</span>`;
  return `<div class="feed-card feed-news is-link" data-url="${escapeHtml(url)}" data-primary="${escapeHtml(tk)}" data-source="${escapeHtml(n.source || '')}">
    <div class="feed-head">${head}<span class="feed-time">${escapeHtml(relTime(n.time))}</span>${feedBookmark(tk)}</div>
    <div class="feed-body">${escapeHtml(stripHtml(n.body))}</div>
    ${feedRail(tk, url)}
  </div>`;
}

/* ---------- Polymarket "agree/disagree" prediction card ---------- */
// module-level registry of markets shown in the feed, so any consumer (and a future Predict
// hand-off) can resolve the object by id. Predict itself refetches by id, so plain hash nav works.
const predictMarkets: Record<string, any> = Object.create(null);

// "ends in 3d" / "ends today" from an ISO endDate
function endsIn(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (!d) return '';
  const days = Math.round((d - Date.now()) / 86400000);
  if (days <= 0) return 'ends today';
  if (days === 1) return 'ends tomorrow';
  if (days < 30) return `ends in ${days}d`;
  const mo = Math.round(days / 30);
  return `ends in ${mo}mo`;
}
const cents = (p: number) => `${Math.round((p || 0) * 100)}¢`;

function predictCardHtml(n: any) {
  const m = n.market || {};
  const id = String(m.id ?? '').slice(0, 128);
  predictMarkets[id] = m;
  const iconUrl = safeHttpUrl(m.icon);
  const icon = iconUrl
    ? `<img class="feed-mkt-ic" src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<span class="feed-mkt-dot">◆</span>`;
  const yesC = cents(m.yes), noC = cents(m.no);
  return `<div class="feed-card feed-predict is-link" data-predict="${escapeHtml(id)}">
    <div class="feed-head">
      <span class="feed-news__pub">${icon}Prediction · Polymarket</span>
      <span class="feed-time">${escapeHtml(endsIn(m.endDate))}</span>
    </div>
    <div class="feed-body feed-predict__q">${escapeHtml(stripHtml(m.question || ''))}</div>
    <div class="feed-predict__px"><span class="pill up">Yes ${yesC}</span><span class="pill down">No ${noC}</span></div>
    <div class="feed-rail feed-predict__rail">
      <button class="rail-btn" data-act="agree" data-mkt="${escapeHtml(id)}" data-yes="${Number(m.yes) || 0}">Agree</button>
      <button class="rail-btn" data-act="disagree" data-mkt="${escapeHtml(id)}" data-yes="${Number(m.yes) || 0}">Disagree</button>
    </div>
  </div>`;
}

// pick 1–2 trending/liquid Polymarket markets for the world. Gamma gives no usable category,
// so we keyword-match the question (crypto vs macro/business). NO top-liquid fallback: an
// irrelevant market (FIFA outrights…) is worse than no card. Also skip near-resolved odds —
// a 0¢/100¢ belief-check is not a question.
const CRYPTO_RE = /\b(bitcoin|btc|ether|ethereum|eth|crypto|solana|\bsol\b|xrp|doge|memecoin|token|altcoin|binance|coinbase)\b/i;
const MACRO_RE = /\b(fed|rate cut|interest rate|recession|s&p|nasdaq|stock|gdp|inflation|cpi|jerome powell|earnings|economy|tariff|treasury)\b/i;
async function pickPredicts(world: string, exclude: (id: string) => boolean): Promise<any[]> {
  const all = await poly.markets(100).catch(() => []);   // Gamma caps at 100; sports outrights dominate the top, so go deep
  if (!Array.isArray(all) || !all.length) return [];
  const re = world === 'crypto' ? CRYPTO_RE : MACRO_RE;
  const chosen = all
    .filter((m: any) => m && m.id != null && m.yes != null && !exclude(String(m.id)))
    .filter((m: any) => re.test(m.question || ''))
    .filter((m: any) => m.yes >= 0.05 && m.yes <= 0.95)   // a live question, not a foregone conclusion
    .sort((a: any, b: any) => (b.liquidity || 0) - (a.liquidity || 0))
    .slice(0, 2);
  return chosen.map((m: any) => ({ type: 'predict', market: m }));
}
// interleave predict cards into the news stream at ~1 per 6 cards (secondary/news column).
function interleavePredicts(cards: any[], predicts: any[]): any[] {
  if (!predicts.length) return cards;
  const out: any[] = []; let pi = 0;
  cards.forEach((c, i) => {
    out.push(c);
    if (i % 6 === 5 && pi < predicts.length) out.push(predicts[pi++]);
  });
  while (pi < predicts.length) out.push(predicts[pi++]);
  return out;
}

function newsCardHtml(n: any, i: number) {
  if (n.type === 'intel') return intelCard(n);
  if (n.type === 'movers') return moversCard(n);
  if (n.type === 'predict') return predictCardHtml(n);
  if (n.type === 'news') return newsAiCard(n, i);
  const primary = safeSymbol(n.ticker || (n.tickers && n.tickers[0]));
  const head = Array.isArray(n.tickers)
    ? logoStack(n.tickers)
    : primary ? `<a class="feed-tklink" href="#/stock/${encodeURIComponent(primary)}" data-tip="${escapeHtml(tipFor(primary))}">${logo(primary, 22)}<span class="feed-tk">${escapeHtml(primary)}</span></a>` : '';
  return `<div class="feed-card is-link" data-story="${Number.isInteger(i) ? i : 0}" data-primary="${escapeHtml(primary)}">
    <div class="feed-head">${head}<span class="feed-time">${escapeHtml(n.time)}</span>${feedBookmark(primary)}</div>
    <div class="feed-body">${n.body}</div>
    ${feedRail(primary || '')}
  </div>`;
}

// shimmer feed cards shown before the live feed lands (and while the AI news cards distil),
// so the news column reads as "loading" rather than flashing template stories that get replaced.
function skelFeedCards(n: number) {
  return Array.from({ length: n }, (_, i) => (
    <div className="feed-card" key={'skf' + i} style={{ pointerEvents: 'none' }}>
      <div className="feed-head"><Skeleton w={22} h={22} r={6} /><Skeleton w={54} h={11} /><Skeleton w={38} h={10} style={{ marginLeft: 'auto' }} /></div>
      <div className="feed-body"><SkeletonText lines={2} /></div>
    </div>
  ));
}

/* ---------- real data derived from Hydromancer ---------- */
const RANGES = ['1M', '3M', 'YTD', '1Y', '2Y'];

const LIVE_T = 'Live · 24h';
function singleCard(sym: string) {
  const s = safeSymbol(sym);
  const t = getTicker(s), dir = t.chgPct >= 0 ? 'up' : 'down';
  return {
    ticker: s, time: LIVE_T, live: true,
    body: `${escapeHtml(t.name || s)} is ${t.chgPct >= 0 ? 'up' : 'down'} <span class="pill ${dir}">${fmtPct(t.chgPct)}</span> over the last 24 hours, trading at <b>${escapeHtml(market.fmtPrice(t.price))}</b>.`,
  };
}
/* the most volatile category that has enough movers to spotlight */
function pickVolCat(world: string, breadth: any[], exclude: string) {
  const cands = breadth.filter((b) => b.cat !== exclude);
  if (world === 'crypto') {
    const meme = cands.find((b) => b.cat === 'Memecoins');
    if (meme && market.categoryMovers(world, 'Memecoins', 3, { byAbs: true }).length >= 3) return 'Memecoins';
  }
  for (const b of [...cands].sort((a, z) => Math.abs(z.avg) - Math.abs(a.avg))) {
    if (market.categoryMovers(world, b.cat, 3, { byAbs: true }).length >= 3) return b.cat;
  }
  return null;
}
/* a rich, varied, fully-real feed */
function realFeed(world: string) {
  const breadth = market.categoryBreadth(world);
  const { gainers, losers } = market.topMovers(world, 10);
  if (!breadth || !breadth.length) {
    const seen = new Set<string>();
    return [...gainers, ...losers].filter((s) => !seen.has(s) && seen.add(s)).map(singleCard);
  }
  const cards: any[] = [], used = new Set<string>();
  const mark = (arr: string[]) => arr.forEach((s) => used.add(s));

  // 1) leading category — multi-ticker story
  const lead = breadth[0];
  const leadSyms = market.categoryMovers(world, lead.cat, 4);
  if (leadSyms.length >= 2 && lead.avg > 0) {
    mark(leadSyms);
    const g0 = getTicker(leadSyms[0]);
    cards.push({
      tickers: leadSyms, time: LIVE_T,
      body: `${escapeHtml(lead.cat)} ${world === 'crypto' ? 'lead the tape' : 'lead the market'}, up <span class="pill up">${fmtPct(lead.avg)}</span> on average over the last 24 hours — ${escapeHtml(g0.name || leadSyms[0])} out front at <span class="pill up">${fmtPct(g0.chgPct)}</span>.`,
    });
  }

  // 2) standout single gainer
  const topG = gainers.find((s: string) => !used.has(s));
  if (topG) { used.add(topG); cards.push(singleCard(topG)); }

  // 3) category movers spotlight (multi-ticker, volatility) — a different category
  const volCat = pickVolCat(world, breadth, lead.cat);
  if (volCat) {
    const movers = market.categoryMovers(world, volCat, 6, { byAbs: true })
      .filter((s: string) => !used.has(s)).slice(0, 4)
      .map((sym: string) => { const t = getTicker(sym); return [sym, assetName(sym), fmtPct(t.chgPct), t.chgPct >= 0]; });
    if (movers.length >= 3) {
      mark(movers.map((m: any) => m[0]));
      cards.push({
        type: 'movers', time: LIVE_T, cat: volCat, icon: world === 'crypto' ? 'coin' : 'chart',
        text: `${volCat} are moving — ${movers.length} names saw outsized swings over the last 24 hours.`,
        movers, footer: `Volatility is elevated across the ${volCat} category.`,
      });
    }
  }

  // 4) standout single loser
  const topL = losers.find((s: string) => !used.has(s));
  if (topL) { used.add(topL); cards.push(singleCard(topL)); }

  // 5) lagging category — multi-ticker story
  const lag = breadth[breadth.length - 1];
  if (lag.cat !== lead.cat && lag.avg < 0) {
    const lagSyms = market.categoryMovers(world, lag.cat, 3, { losers: true }).filter((s: string) => !used.has(s));
    if (lagSyms.length >= 2) {
      mark(lagSyms);
      cards.push({
        tickers: lagSyms, time: LIVE_T,
        body: `${escapeHtml(lag.cat)} lag the market, down <span class="pill down">${fmtPct(lag.avg)}</span> on average as flows rotate elsewhere.`,
      });
    }
  }

  // 6) fill with remaining individual movers for variety (cap the feed length)
  for (const sym of [...gainers, ...losers]) {
    if (cards.length >= 9) break;
    if (used.has(sym)) continue;
    used.add(sym); cards.push(singleCard(sym));
  }
  return cards;
}
// Narrative-led: lead with the live-market cards (sector rotation / category movers — diverse,
// always-on) and drop in a real-news catalyst every ~2 narratives, then append the rest. Keeps
// the home varied and scrollable instead of a wall of Bitcoin headlines.
function mixFeed(primary: any[], secondary: any[]) {
  const out: any[] = []; let j = 0;
  primary.forEach((c, i) => {
    out.push(c);
    if (i % 2 === 1 && secondary[j]) out.push(secondary[j++]);
  });
  while (j < secondary.length) out.push(secondary[j++]);
  return out;
}
function realCats(world: string): [string, number][] {
  const b = market.categoryBreadth(world);
  return (b && b.length) ? b.map((x: any) => [x.cat, x.avg]) : [];
}
function realSentiment(world: string) {
  const cats = market.categoryBreadth(world);
  if (!cats || !cats.length) return { word: 'awaiting live breadth', cls: '' };
  const avg = (cats && cats.length) ? cats.reduce((s: number, x: any) => s + x.avg, 0) / cats.length : 0;
  if (avg > 0.4) return { word: 'bullish', cls: 'sent-bull' };
  if (avg < -0.4) return { word: 'bearish', cls: 'sent-bear' };
  return { word: 'neutral', cls: 'sent-neutral' };
}
function realSummary(world: string) {
  const { gainers, losers } = market.topMovers(world, 1);
  if (!gainers.length || !losers.length) return 'Live 24-hour market breadth is not available yet.';
  const g = getTicker(gainers[0]), l = getTicker(losers[0]);
  const sent = realSentiment(world).word;
  const realm = world === 'crypto' ? 'Crypto markets' : 'Markets';
  return `${realm} are <span class="${realSentiment(world).cls}">${sent}</span> over the last 24 hours. ${escapeHtml(g.name || gainers[0])} leads at <b>${fmtPct(g.chgPct)}</b> while ${escapeHtml(l.name || losers[0])} lags at <b>${fmtPct(l.chgPct)}</b>. Live from Hyperliquid${world === 'stocks' ? ' · trade.xyz' : ''}.`;
}

/* real US equity-market hours (9:30–16:00 ET, weekdays) for the stocks world status */
function usMarketOpen() {
  try {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    if (day === 0 || day === 6) return false;
    const mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 570 && mins < 960;
  } catch (e) { return false; }
}
function marketStatus(world: string) {
  if (world === 'crypto') return { label: 'Crypto is <b>live</b>', icon: 'sun', toast: 'Crypto perps trade 24/7 on Hyperliquid' };
  return usMarketOpen()
    ? { label: 'Markets are <b>open</b>', icon: 'sun', toast: 'US equities are open · RWA perps trade 24/7 on trade.xyz' }
    : { label: 'Markets are <b>closed</b>', icon: 'moon', toast: 'US equities are closed · RWA perps still trade 24/7 on trade.xyz' };
}

function henceMark() {
  return henceMarkSvg(20);
}

/* module-level state persisted across data-driven re-renders (mirrors vanilla) */
// Last-viewed world survives reloads/sessions (localStorage); the module var keeps
// same-session remounts instant. A stored choice beats the interests-based default.
let _homeWorld = (() => { try { return localStorage.getItem('hence.homeWorld') || 'crypto'; } catch { return 'crypto'; } })();
let _homeRange = '1Y';

/* smoothPath clone (charts.js keeps it private): horizontal-tangent cubic between points. */
function pfSmooth(p: [number, number][]): string {
  if (!p.length) return '';
  let d = `M ${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

/* Paint (or clear) the connected wallet's equity curve as a dashed overlay on the hero chart.
   Shares the market chart's box exactly (viewBox 560×150, pad 6, index-based x, preserveAspect
   "none") so the two lines align on the time axis. Vertically it uses a FLOOR-compressed,
   centre-anchored scale rather than raw fit-to-box: a portfolio with real movement (≥ PF_FLOOR
   peak-to-peak) fills the box, but a nearly-flat portfolio reads flat instead of amplifying $-noise
   into a fake mountain — so overlaid on a moving market it honestly shows "mine barely moved". The
   chip carries the true value + %-change. pointer-events:none keeps the market hover crosshair
   working. MUST run after fillChart sets innerHTML (which would otherwise wipe the overlay). */
const PF_FLOOR = 0.03; // ≥3% peak-to-peak fills the box; below that the line compresses toward centre
function paintPfOverlay(container: HTMLElement | null, values: number[]) {
  if (!container) return;
  const wrap = container.querySelector('.chart-wrap');
  if (!wrap) return;
  wrap.querySelector('.hcard-pf-line')?.remove();
  if (!Array.isArray(values) || values.length < 2) return;
  const w = 560, h = 150, pad = 6, usable = h - pad * 2;
  const min = Math.min(...values), max = Math.max(...values), range = max - min;
  const pctRange = max ? range / max : 0;
  const fill = range ? Math.min(1, pctRange / PF_FLOOR) : 0; // 0 when flat → line sits at centre
  const step = (w - pad * 2) / (values.length - 1);
  const pts: [number, number][] = values.map((v, i) => {
    const t = range ? (v - min) / range : 0.5;       // 0 = window-min, 1 = window-max
    const yFrac = 0.5 + (0.5 - t) * fill;             // max→top band, min→bottom band, flat→centre
    return [pad + i * step, pad + yFrac * usable];
  });
  // literal green as the SVG presentation-attribute fallback; the CSS rule sets stroke:var(--up)
  const svg = `<svg class="hcard-pf-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${pfSmooth(pts)}" fill="none" stroke="#5fcf91" stroke-width="1.7" stroke-dasharray="5 4" stroke-linecap="round"/></svg>`;
  // sit above the market line but BELOW the .cx hover crosshair so the crosshair stays interactive-looking
  const cx = wrap.querySelector('.cx');
  if (cx) cx.insertAdjacentHTML('beforebegin', svg);
  else wrap.insertAdjacentHTML('beforeend', svg);
}

export default function Dashboard() {
  const ready = useMarketReady();
  const auth = useAuth();
  // Connected-wallet portfolio for the hero chart chip, keyed only to the authenticated
  // Privy wallet so an arbitrary local address cannot be presented as the user's account.
  const pfAddr = auth.address || undefined;
  const hl = useHlAccount(pfAddr);
  const pf = useHlPortfolio(pfAddr);
  const [world, setWorld] = useState<string>(_homeWorld);
  const [range, setRange] = useState<string>(_homeRange);
  const { me: myProfile, interests: myInterests } = useMe();
  const manualWorld = useRef(false);
  const autoWorld = useRef(false);
  // default the home world to what the user said they trade (stocks-only → Stocks), unless
  // they've manually toggled — and a REMEMBERED last view (any prior session) always wins
  // over the tuning default: what they actually looked at beats what they said.
  useEffect(() => {
    if (autoWorld.current || manualWorld.current) return;
    try { if (localStorage.getItem('hence.homeWorld')) { autoWorld.current = true; return; } } catch { /* storage off */ }
    const ac = myInterests.filter((i: any) => i.kind === 'asset_class').map((i: any) => i.topic);
    if (!ac.length) return;
    if (ac.includes('stocks') && !ac.includes('crypto') && world !== 'stocks') { setWorld('stocks'); _homeWorld = 'stocks'; }
    else if (ac.includes('crypto') && !ac.includes('stocks') && world !== 'crypto') { setWorld('crypto'); _homeWorld = 'crypto'; }
    autoWorld.current = true;
  }, [myInterests.length]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [aiText, setAiText] = useState<string | null>(null);
  const [newsCards, setNewsCards] = useState<any[]>([]);
  // Elfa A/B (team flag): top social narratives as belief-check cards. They ride the
  // standard news-card renderer, so the thumbs rail + stash recording come for free —
  // an Agree on a narrative is a labeled corpus row.
  const [narrCards, setNarrCards] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    let flag = false;
    try { flag = localStorage.getItem('hence.elfaSocial') === '1'; } catch { /* off */ }
    if (!flag || world !== 'crypto') { setNarrCards([]); return; }
    fetch('/api/social/narratives').then((r) => r.json()).then((d: any) => {
      if (!alive || !d || !d.available) return;
      setNarrCards((d.narratives || []).slice(0, 2).map((n: any) => ({
        type: 'news', body: String(n.narrative || '').slice(0, 220),
        url: (n.links || [])[0] || '', source: 'Narrative · social (A/B)', site: 'x.com',
        time: new Date().toISOString(), ticker: '', pct: null,
      })));
    }).catch(() => { /* section simply absent */ });
    return () => { alive = false; };
  }, [world]);
  const [, bumpNames] = useState(0);

  // re-render so resolved coin names ("dYdX") replace the bare ticker in tooltips/labels
  useEffect(() => {
    const h = () => bumpNames((n) => n + 1);
    window.addEventListener('hence:names', h);
    return () => window.removeEventListener('hence:names', h);
  }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<HTMLDivElement>(null);
  const secChartRef = useRef<HTMLDivElement>(null);

  // the connected wallet's equity curve, clipped + %-computed for the active range tab. A ref
  // mirror lets the (async) main-chart effect paint the overlay after fillChart without listing
  // the series as a dep (which would redraw the whole chart on every 60s portfolio poll).
  const pfSeries = useMemo(() => pfSeriesForRange(pf.windows, range), [pf.windows, range]);

  // Cross-venue total for the hero chip (wallet chains + HL + PM — the same aggregate the
  // WalletChip and Accounts sheet show). An email signup's funds live on-chain long before
  // they touch Hyperliquid; HL-equity-only left funded users staring at "Connect Wallet".
  const [vsnap, setVsnap] = useState<Snapshot | null>(null);
  const linkedKey = auth.authenticated ? ((auth.wallets as any[]) || []).map((w: any) => w.address).join(',') : '';
  useEffect(() => {
    setVsnap(null);
    if (!pfAddr || !ready) return;
    let alive = true;
    const linked = linkedKey ? linkedKey.split(',') : [];
    const load = () => { snapshotCachedAll(pfAddr, linked).then((s) => { if (alive && s) setVsnap(s); }).catch(() => { /* keep HL fallback */ }); };
    load();
    const iv = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(iv); };
  }, [pfAddr, ready, linkedKey]);
  const pfTotal = vsnap && !(vsnap.partial && vsnap.total === 0) ? vsnap.total : hl.accountValue;
  const pfSeriesRef = useRef(pfSeries);
  // "connected" = signed in with money ANYWHERE (any venue/chain), not just HL equity
  const pfConnected = !!auth.authenticated && ((hl.loaded && hl.accountValue > 0) || pfTotal > 0);

  // keep module-level mirrors in sync (so the reader/drawer read the active world)
  useEffect(() => { _homeWorld = world; }, [world]);
  useEffect(() => { _homeRange = range; }, [range]);

  const live = ready && market.isReady();
  // breadth/movers can lag isReady by a tick — gate the AI effect on it actually being
  // present (re-evaluated on each 2s tick) so the effect retries instead of bailing once.
  const breadthReady = live && (market.categoryBreadth(world) || []).length > 0;
  const w = WORLDS[world];

  // active feed/summary for this render (and stash for the reader overlay)
  const baseFeed: any[] = live ? realFeed(world) : w.feed;
  // rendered feed LEADS with the live narrative cards (sector rotation, category movers) — our
  // diverse, always-on edge — and interleaves real-news cards as supporting catalysts. Leading
  // with news made the home a BTC monoculture (FMP crypto news is ~80% Bitcoin).
  const feed: any[] = (live && (newsCards.length || narrCards.length))
    ? mixFeed(baseFeed, [...narrCards, ...newsCards]) : baseFeed;
  const summary: string = live ? realSummary(world) : w.summary;
  activeFeed = baseFeed; // reader operates on the clean data feed
  activeSummary = summary;

  const cats: [string, number][] = live ? realCats(world) : w.cats;
  const sentiment = live ? realSentiment(world) : w.sentiment;
  const pT = getTicker(w.chart.primary), sT = getTicker(w.chart.secondary);
  const endMain = live ? (pT.changeReal ? fmtPct(pT.chgPct) : '—') : w.chart.endMain;
  const endSec = live ? (sT.real && sT.price > 0 ? market.fmtPrice(sT.price) : '—') : w.chart.endSec;

  // fill the live charts when ready / world / range changes
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    // Clear the previous range/world immediately. Never paint deterministic template
    // series as a placeholder for a live chart.
    if (mainChartRef.current) mainChartRef.current.replaceChildren();
    if (secChartRef.current) secChartRef.current.replaceChildren();
    // fillChart replaces .chart-wrap async → paint the portfolio overlay only once it resolves
    market.fillChart(mainChartRef.current, w.chart.primary, range, { w: 560, h: 150, priceLabel: true })
      .then((ok: boolean) => {
        if (cancelled) return;
        if (!ok && mainChartRef.current) mainChartRef.current.textContent = 'Live chart unavailable';
        else paintPfOverlay(mainChartRef.current, pfSeriesRef.current.values);
      });
    market.fillChart(secChartRef.current, w.chart.secondary, range, { w: 560, h: 46, stroke: w.chart.secColor, fill: w.chart.secFill, dot: false, sw: 1 })
      .then((ok: boolean) => { if (!cancelled && !ok && secChartRef.current) secChartRef.current.textContent = 'Live chart unavailable'; });
    // real trade.xyz venue TVL chip on the stocks recap
    if (world === 'stocks') {
      market.dexTvl('xyz').then((v: number | null) => {
        const t = wrapRef.current?.querySelector('.feed-recap__t') as HTMLElement | null;
        if (v && t && !t.dataset.tvl) { t.dataset.tvl = '1'; t.insertAdjacentHTML('afterbegin', `<span class="muted" style="margin-right:8px">$${(v / 1e6).toFixed(0)}M TVL</span>`); }
      });
    }
    return () => { cancelled = true; };
  }, [live, world, range, w.chart.primary, w.chart.secondary, w.chart.secColor, w.chart.secFill]);

  // repaint the portfolio overlay when the equity curve (or the clipped range series) changes,
  // WITHOUT redrawing the market chart — the 60s poll / late-arriving history just updates the
  // dashed line on the already-drawn chart-wrap.
  useEffect(() => {
    pfSeriesRef.current = pfConnected ? pfSeries : { values: [], pct: 0 };
    if (live) paintPfOverlay(mainChartRef.current, pfSeriesRef.current.values);
  }, [pfSeries, live, pfConnected]);

  // one news fetch powers both: an AI recap that weaves the day's biggest theme into the
  // live breadth/movers, and a Fey-style feed that distills each article into a one-line
  // insight tagged with the most relevant tradeable ticker + its live move + source.
  useEffect(() => {
    if (!breadthReady) { setAiText(null); setNewsCards([]); return; }
    let alive = true;
    const breadth = market.categoryBreadth(world);
    if (!breadth || !breadth.length) return;
    const mv = market.topMovers(world, 1);
    const data: any = {
      sentiment: realSentiment(world).word,
      breadth: breadth.slice(0, 6).map((b: any) => ({ cat: b.cat, avgPct: +b.avg.toFixed(2), advancers: +(b.upFrac * 100).toFixed(0) })),
      topGainer: mv.gainers[0] ? { name: getTicker(mv.gainers[0]).name, pct: getTicker(mv.gainers[0]).chgPct } : null,
      topLoser: mv.losers[0] ? { name: getTicker(mv.losers[0]).name, pct: getTicker(mv.losers[0]).chgPct } : null,
      // symbol-level movers: the setups engine grounds its symbol universe in these (names alone
      // aren't tradeable references), and they give the recap/brief extra color for free.
      movers: [...(mv.gainers || []).slice(0, 6), ...(mv.losers || []).slice(0, 4)]
        .map((s: string) => ({ sym: s, pct: getTicker(s)?.chgPct })).filter((x: any) => x.pct != null),
      venue: world === 'crypto' ? 'Hyperliquid' : 'trade.xyz',
    };
    activeRecapData = data;
    // hand the fresh breadth/movers payload to SetupsBlock so it fetches /api/setups once per
    // world with real data (it can't read activeRecapData directly without a re-render race).
    window.dispatchEvent(new CustomEvent('hence:recapdata', { detail: { world, data } }));
    // warm the expanded "Read more" brief in the background so it's instant when opened — and
    // CONSISTENT: the brief is generated as an EXPANSION of the exact recap on screen (the server
    // caches it keyed by the recap's hash), so preview and Read more always tell the same edition.
    const preloadBrief = (recapText: string) => {
      const cur = activeLongBrief[world];
      if (cur && cur.key === recapText) return;                     // already have the brief for THIS recap
      ai.briefBest(world, data, recapText).then((t: string) => { if (t) activeLongBrief[world] = { key: recapText, text: t }; }).catch(() => {});
    };

    // serve from cache when fresh — no re-fetch, no DeepSeek re-call on world-switch/reload
    const hit = cacheGet(world);
    if (hit) { setAiText(hit.recap || realSummary(world)); setNewsCards(hit.cards || []); activeRecapText = hit.recap || ''; preloadBrief(activeRecapText); return () => { alive = false; }; }
    setAiText(null); setNewsCards([]);

    let cRecap: string | null = null, cCards: any[] | null = null;
    const maybeCache = () => { if (cRecap != null && cCards != null) cachePut(world, cCards, cRecap); };
    // best-of-3, server-cached recap (/api/recap). Run it ONCE, after news resolves, so the shared
    // cache stores the news-enriched winner rather than a breadth-only pre-pass.
    // on AI success show the recap; on failure/empty fall back to the real (non-AI) summary so the
    // recap skeleton always resolves to real text — never a blank or a permanent shimmer.
    const runRecap = () => ai.recapBest(world, data).then((text: string) => { if (text) { cRecap = text; activeRecapText = text; } if (alive) setAiText(text || realSummary(world)); maybeCache(); preloadBrief(text || ''); }).catch(() => { if (alive) setAiText(realSummary(world)); preloadBrief(''); });

    // personalize + broaden the news set: the user's watchlist first, then majors + live movers
    // (the default crypto feed is Bitcoin-only). Kept a mix so it's relevant but not over-fit.
    // taste-loop v0: also seed symbols the user thumbed-UP recently (agree, last 14d, max 6),
    // so the feed drifts toward beliefs they've actually endorsed.
    const watch = [...new Set([...getWatch(), ...stash.agreedSymbols(14, 6)])];
    let newsP: Promise<any>;
    if (world === 'crypto') {
      const majors = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'AVAX', 'LINK', 'SUI', 'AAVE'];
      const m = market.topMovers('crypto', 8);
      // one leader from EACH live narrative so DeFi/AI/memecoin/L2/RWA stories get queried, not
      // just the majors (whose news is ~all Bitcoin). Watchlist + per-category + movers lead; majors last.
      const byCat = (market.categoryBreadth('crypto') || []).flatMap((b: any) => market.categoryMovers('crypto', b.cat, 1));
      const watched = watch.filter((s) => getTicker(s)?.world === 'crypto');
      const syms = [...new Set([...watched, ...byCat, ...(m.gainers || []), ...(m.losers || []), ...majors])]
        .map((s: string) => s.replace(/^k/, '').replace(/^1000/, '')).slice(0, 22)
        .map((s: string) => s + 'USD').join(',');
      newsP = fmp.cryptoNews(26, syms);
    } else {
      const watched = watch.filter((s) => getTicker(s)?.world === 'stocks');
      const stockSyms = [...new Set([...watched, ...market.assetsByWorld('stocks').slice(0, 18).map((a: any) => a.sym)])].slice(0, 22).join(',');
      newsP = fmp.stockNews(stockSyms || 'NVDA,AAPL,TSLA', 26);
    }

    newsP.then((arts: any[]) => {
      // FMP returns the same article once per matching symbol — dedupe by url so the feed
      // doesn't show one story three times under different tickers.
      const seen = new Set<string>();
      const list = (Array.isArray(arts) ? arts : []).filter((a: any) => a && a.url && !seen.has(a.url) && seen.add(a.url));
      // feed the recap/brief the day's EVENTS (headline + lead text) as their substance, not just titles
      if (list.length) {
        data.news = list.slice(0, 8).map((a: any) => ({ title: a.title, text: String(a.text || a.snippet || '').slice(0, 220) })).filter((x: any) => x.title);
      }
      runRecap();   // generate the best-of-3 recap now (news-enriched if available, else breadth-only)
      if (!list.length) { cCards = []; return; }
      return ai.feedDigest(world, list).then((items: any[]) => {
        if (!alive || !items) return;
        const byI = new Map(items.map((it: any) => [it.i, it]));
        const perTicker: Record<string, number> = {};
        const cards = list.map((art: any, i: number) => {
          const it: any = byI.get(i);
          if (!it || !it.line || it.skip) return null; // drop low-signal clickbait
          const sym = String(it.ticker || '').toUpperCase();
          const t: any = sym ? getTicker(sym) : null;
          // world purity: a TSLA article must not carry a ticker pill in the crypto feed (and vice
          // versa) — the digest sometimes tags cross-world symbols; demote those to macro cards.
          const rightWorld = !!t && (world === 'crypto' ? t.world === 'crypto' : t.world !== 'crypto');
          const tradeable = !!(t && t.real && rightWorld);
          return {
            type: 'news', body: it.line, url: art.url, time: art.publishedDate,
            ticker: tradeable ? sym : '', pct: tradeable ? t.chgPct : null,
            source: art.publisher || art.site || '', site: art.site || '',
          };
        }).filter(Boolean).filter((c: any) => {
          if (!c.ticker) return true;                 // keep all macro cards
          perTicker[c.ticker] = (perTicker[c.ticker] || 0) + 1;
          const cap = (c.ticker === 'BTC' || c.ticker === 'ETH') ? 1 : 2;  // BTC/ETH flood the feed
          return perTicker[c.ticker] <= cap;          // one BTC/ETH story max → varied, Fey-style
        }).slice(0, 10);
        cCards = cards;
        if (alive && cards.length) setNewsCards(cards);
        maybeCache();
        // fetch 1–2 trending prediction markets and splice them into the news stream (dedupe by
        // what the user already reacted to this session). Purely additive — never blocks the feed.
        pickPredicts(world, (id) => stash.reactedMarket(id)).then((preds: any[]) => {
          if (!alive || !preds.length) return;
          const merged = interleavePredicts(cCards || cards, preds);
          cCards = merged;
          setNewsCards(merged);
          maybeCache();
        }).catch(() => {});
      });
    }).catch(() => { runRecap(); });
    return () => { alive = false; };
  }, [breadthReady, world]);

  // safety net: once live, the recap skeleton must resolve even if breadth/news/DeepSeek stall —
  // after 7s fall back to the real (non-AI) summary so the card can never shimmer forever.
  useEffect(() => {
    if (!live || aiText) return;
    const t = setTimeout(() => setAiText((prev) => prev || realSummary(world)), 7000);
    return () => clearTimeout(t);
  }, [live, aiText, world]);

  const status = marketStatus(world);
  const sectorRows = cats.map(([name, pct]) => (
    <div className="sec2-row" key={name}>
      <span className="sec2-name"><span className="sec2-ic"></span>{name}</span>
      <span className="sec2-right">
        <span className={`sec2-val ${pct >= 0 ? 'up' : 'down'}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
        <span dangerouslySetInnerHTML={{ __html: equalizer(pct, name) }} />
      </span>
    </div>
  ));

  // recap summary text: AI text overrides the template/live summary when available.
  // Ticker entity chips are woven in at RENDER time only (the cache stays plain HTML).
  // The chip DICTIONARY needs this world's universe — and the cached AI text usually wins
  // that race (per-day server cache answers in ms; the xyz meta takes seconds). Without a
  // re-linkify trigger the recap stayed chipless forever on stocks — same lag class as
  // breadthReady above, same shape of fix: watch until the dict exists, then re-render.
  const [dictReady, setDictReady] = useState((market.assetsByWorld(world) || []).length > 0);
  useEffect(() => {
    const has = () => (market.assetsByWorld(world) || []).length > 0;
    setDictReady(has());
    if (has()) return;
    const id = window.setInterval(() => { if (has()) { setDictReady(true); window.clearInterval(id); } }, 800);
    return () => window.clearInterval(id);
  }, [world]);
  const recapSummary = useMemo(() => linkEntities(aiText || summary, world),
    [aiText, summary, world, dictReady]);

  // click delegation for the feed (rail actions → trade/watch/save; entity chips → menu;
  // pills → asset; news cards → source; cards → reader)
  const onFeedClick = (e: any) => {
    // 1) action-rail buttons (highest priority — never fall through to card open)
    const act = e.target.closest?.('[data-act]');
    if (act) {
      e.stopPropagation?.();
      const tk = act.dataset.tk || '';
      const kind = act.dataset.act;
      if (kind === 'trade' && tk) { location.hash = (market.coinFor(tk) && market.coinFor(tk) !== tk) || getTicker(tk)?.world === 'crypto' ? `#/terminal/${tk}` : `#/stock/${tk}`; return; }
      if (kind === 'watch' && tk) {
        const on = toggleWatch(tk);
        act.classList.toggle('on', on);
        act.setAttribute('title', on ? 'Remove from watchlist' : 'Follow in your watchlist');
        toast(on ? `Added ${tk} to watchlist` : `Removed ${tk} from watchlist`, { ticker: tk });
        return;
      }
      // 👍/👎 on an evidence card — a DIRECTIONAL belief with provenance (richer than a bare save:
      // agree stashes the story as thesis evidence; disagree is negative signal for the spine)
      if (kind === 'up' || kind === 'down') {
        const cardEl = act.closest('[data-primary]') as HTMLElement | null;
        const title = (cardEl?.querySelector('.feed-body')?.textContent || '').trim().slice(0, 200);
        const url = cardEl?.dataset?.url || '';
        const source = cardEl?.dataset?.source || '';
        stash.record({
          // with a url it's a belief about the STORY (news); without one (live spotlight
          // cards) it's a belief about the ASSET's move — keyed by symbol server-side
          kind: kind === 'up' ? 'agree' : 'disagree', subject_type: url ? 'news' : 'asset',
          symbol: tk, symbols: tk ? [tk] : [], title, url, source,
          stance: kind === 'up' ? 'yes' : 'no',
        });
        act.closest('.rail-thumbs')?.querySelectorAll('.rail-thumb').forEach((b: Element) => b.classList.remove('on'));
        act.classList.add('on');
        toast(kind === 'up' ? 'Noted — added to your evidence' : 'Noted', kind === 'up' ? { icon: 'check' } : {});
        return;
      }
      if (kind === 'save') {
        const cardEl = act.closest('[data-primary]');
        const bodyEl = cardEl?.querySelector('.feed-body');
        const title = (bodyEl?.textContent || '').replace(/<[^>]+>/g, '').trim().slice(0, 200);
        const url = (cardEl as HTMLElement | null)?.dataset?.url || '';
        const source = (cardEl as HTMLElement | null)?.dataset?.source || '';
        stash.record({ kind: 'save', subject_type: 'news', symbol: tk, symbols: tk ? [tk] : [], title, url, source });
        toast(`Saved · linked to ${tk || 'market'}`, tk ? { ticker: tk } : { icon: 'check' });
        return;
      }
      // prediction-market agree/disagree → capture a stance idea, then let them back it
      if (kind === 'agree' || kind === 'disagree') {
        const mkt = String(act.dataset.mkt || '').slice(0, 128);
        const yesPx = act.dataset.yes ? parseFloat(act.dataset.yes) : null;
        const cardEl = act.closest('[data-predict]');
        const question = (cardEl?.querySelector('.feed-predict__q')?.textContent || '').trim();
        stash.record({
          kind, subject_type: 'prediction_market', market_id: mkt, title: question,
          stance: kind === 'agree' ? 'yes' : 'no',
          evidence: yesPx != null && !isNaN(yesPx) ? { yes_price_at_reaction: yesPx } : undefined,
        });
        // swap the rail to a single "Back it →" deep link (toast can't carry a link)
        const rail = cardEl?.querySelector('.feed-predict__rail');
        if (rail) rail.innerHTML = `<a class="rail-btn feed-predict__back" href="#/terminal/m/${encodeURIComponent(mkt)}">Back it →</a>`;
        toast('Noted — back it? →', { icon: 'check' });
        return;
      }
      return;
    }
    // prediction card body → open the market detail (Predict refetches by id → plain nav is fine)
    const predictCard = e.target.closest?.('.feed-predict[data-predict]');
    if (predictCard && !e.target.closest?.('.rail-btn')) { location.hash = `#/terminal/m/${encodeURIComponent(String(predictCard.dataset.predict || '').slice(0, 128))}`; return; }
    // 2) ticker entity chips (recap) → the quiet action popover
    const chip = e.target.closest?.('.tk-chip');
    if (chip) { e.stopPropagation?.(); openChipMenu(chip.dataset.tk, chip.getBoundingClientRect()); return; }
    const openRecap = e.target.closest?.('[data-open-recap]');
    if (openRecap) { openReader({ mode: 'recap' }); return; }
    if (e.target.closest?.('a')) return; // ticker links navigate themselves
    const pill = e.target.closest?.('.feed-body .pill');
    if (pill) { const c = pill.closest('[data-primary]'); if (c) location.hash = `#/stock/${c.dataset.primary}`; return; }
    const news = e.target.closest?.('.feed-news[data-url]');
    if (news && news.dataset.url) {
      const url = safeHttpUrl(news.dataset.url);
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    if (e.target.closest?.('a')) return; // let real links navigate
    const card = e.target.closest?.('.feed-card[data-story]');
    if (card) { openReader({ mode: 'story', i: +card.dataset.story }); }
  };

  // rail hidden below 1240 → the Signals TAB takes over there (mobile/tablet)
  const [narrow, setNarrow] = useState(() => { try { return !window.matchMedia('(min-width: 1240px)').matches; } catch { return false; } });
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1240px)');
    const on = () => setNarrow(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const elfaFlag = isTeamWallet(auth.address)
    && (() => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } })();
  return (
    <Shell dockActive="home">
      <div className="home-row">
      <div className="home2 has-sectabs" ref={wrapRef}>
        {elfaFlag ? (
          <div className="home-topnav">
            {/* same segmented container language as the Stocks/Crypto world switch */}
            <div className="home-topnav__seg">
              <a className="on" href="#/">Home</a>
              <a href="#/screener">Markets</a>
              <a href="#/terminal">Trade</a>
            </div>
            {/* the SECOND door to search — the ⌘K palette stays; this one is visible */}
            <button className="home-topnav__search" onClick={() => window.dispatchEvent(new CustomEvent('hence:cmdk'))}>
              <Icon name="search" size={14} /> <span>Search assets, markets, or ask Hence AI…</span> <kbd>⌘K</kbd>
            </button>
            <span />
          </div>
        ) : null}
        <div className="home2__top">
          <div className="home2__topL">
            <div className="home2__greet"><span className="home2__logo" dangerouslySetInnerHTML={{ __html: henceMark() }} /> Hello, {auth.ready ? (auth.authenticated ? (myProfile?.handle || auth.firstName || (auth.email ? auth.email.split('@')[0] : '') || auth.shortAddr || 'there') : 'Satoshi') : <SkeletonValue w={78} />}</div>
            <div className="world-switch">
              {['stocks', 'crypto'].map((k) => (
                <button key={k} className={world === k ? 'on' : ''} onClick={() => { manualWorld.current = true; if (k !== world) { setWorld(k); _homeWorld = k; try { localStorage.setItem('hence.homeWorld', k); } catch { /* storage off */ } } }}>
                  <Icon name={k === 'stocks' ? 'chart' : 'coin'} size={13} /> {WORLDS[k].label}
                </button>
              ))}
            </div>
          </div>
          {/* cohort: the open/closed pill is noise on 24/7 rails — hidden with the redesign */}
          {!elfaFlag ? (
            <button className="home2__state" data-toast={status.toast}>
              <span dangerouslySetInnerHTML={{ __html: status.label }} /> <span className="home2__moon"><Icon name={status.icon} size={15} /></span>
            </button>
          ) : null}
        </div>

        <SectionTabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'recap', label: 'Daily recap' },
          ...(elfaFlag && narrow ? [{ key: 'signals', label: 'Signals' }] : [])]} />

        <div className="home2__cols">
          <section className="hcard is-active" data-sec="overview">
            <div className="hcard__date">{live ? 'Live · Hyperliquid' + (world === 'stocks' ? ' · trade.xyz' : '') : <SkeletonValue w={150} />}</div>
            <div className="hcard__sent">{live ? <>The market is <span className={sentiment.cls}>{sentiment.word}</span></> : <SkeletonValue w={170} />}</div>

            <div className="hcard__chart">
              <span className={`hcard__lbl hcard__lbl--sp ${live ? cls(pT.chgPct) : ''}`}>{live ? endMain : <SkeletonValue w={52} />}</span>
              {live
                ? <div className="live-main" style={{ height: 150 }} ref={mainChartRef} />
                : <Skeleton w="100%" h={150} r={10} />}
            </div>
            <div className="hcard__vix">
              <span className="hcard__lbl hcard__lbl--vix" style={{ color: w.chart.secColor }}>{live ? endSec : <SkeletonValue w={44} />}</span>
              {live
                ? <div className="live-sec" style={{ height: 46 }} ref={secChartRef} />
                : <Skeleton w="100%" h={46} r={8} />}
            </div>

            <div className="hcard__legendrow">
              <div className="hcard__legend">
                <span className="hcard__leg on"><i className="bar"></i>{w.chart.legend[0]}</span>
                <span className="hcard__leg"><i className="bar" style={{ background: w.chart.secColor }}></i>{w.chart.legend[1]}</span>
                {pfConnected
                  ? <button className="hcard__connect hcard__connect--pf" onClick={() => { location.hash = '#/portfolio'; }} title="Your cross-venue portfolio — tap for the full view">
                      <i className="bar bar--dash"></i> Portfolio · ${pfTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      {pfSeries.values.length > 1 && (
                        <span className={'hcard__connect-pct ' + (pfSeries.pct >= 0 ? 'up' : 'down')}>
                          {pfSeries.pct >= 0 ? '+' : ''}{pfSeries.pct.toFixed(1)}%
                        </span>
                      )}
                    </button>
                  : <button className="hcard__connect" onClick={() => { if (auth.authenticated) window.dispatchEvent(new CustomEvent('hence:accounts')); else auth.login(); }}>
                      <Icon name="plus" size={11} /> {auth.authenticated ? 'Add funds' : w.chart.connect}
                    </button>}
              </div>
              <div className="range-tabs hcard__ranges">
                {RANGES.map((r) => (
                  <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
            </div>

            <div className="hcard__sectors">
              <div className="hcard__sectors-cap">{world === 'crypto' ? 'Categories' : 'Sectors'} · 24h</div>
              {live ? (sectorRows.length ? sectorRows : <div className="muted" style={{ padding: '14px 0', fontSize: 12 }}>Live breadth unavailable</div>) : Array.from({ length: 6 }, (_, i) => (
                <div className="sec2-row" key={i}>
                  <span className="sec2-name"><span className="sec2-ic"></span><Skeleton w={90} h={11} /></span>
                  <span className="sec2-right"><Skeleton w={48} h={11} /><Skeleton w={60} h={12} r={4} /></span>
                </div>
              ))}
            </div>
          </section>

          {elfaFlag && narrow ? (
            <section className="home2__signals" data-sec="signals"><SignalsFeed /></section>
          ) : null}
          <section className="home2__feed" data-sec="recap" onClick={onFeedClick}>
            <div className="feed-recap">
              <div className="feed-recap__h">
                <button className="feed-pill" data-open-recap><Icon name="back" size={12} /> {live ? 'Market recap' : 'Daily recap'}</button>
                <span className="feed-recap__t">{live ? 'Live · 24h' : 'Summarized at 6:00 AM'} <button className="feed-expand" data-open-recap><Icon name="arrowUp" size={13} /></button></span>
              </div>
              {aiText
                ? <p className="feed-recap__sum"><span dangerouslySetInnerHTML={{ __html: recapSummary }} /> <a className="feed-readmore" data-open-recap>Read more</a></p>
                : <div className="feed-recap__sum"><SkeletonText lines={3} /></div>}
            </div>
            <SetupsBlock world={world} />
            <ThesisFeedBlock world={world} />
            <StashBlock />
            <SignalsTeaser world={world} />
            {live ? (
              <>
                {feed.map((n, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: newsCardHtml(n, i) }} />
                ))}
                {breadthReady && !newsCards.length ? skelFeedCards(2) : null}
              </>
            ) : skelFeedCards(4)}
          </section>
        </div>

        <button className="home2__wl-handle" data-wl aria-label="Watchlist" onClick={openWatchlistDrawer}><Icon name="bookmark" size={16} /></button>
      </div>
      <SignalsRail />
      </div>
    </Shell>
  );
}

/* ============================================================
   Daily-recap READER — recap list ⇄ story detail. Reads the
   active world's feed (module-level activeFeed/activeSummary).
   Built imperatively against #modal-root, exactly like vanilla.
   ============================================================ */
function assetChip(s: string) {
  const sym = safeSymbol(s);
  if (!sym) return '';
  const t = getTicker(sym);
  return `<a class="reader-asset" href="#/stock/${encodeURIComponent(sym)}">${logo(sym, 26)}<span class="reader-asset__id"><b>${escapeHtml(sym)}</b><small>${escapeHtml(assetName(sym))}</small></span><span class="pill ${cls(t.chgPct)}">${t.changeReal ? fmtPct(t.chgPct) : '—'}</span></a>`;
}

function storyView(i: number) {
  const n = activeFeed[i] || {};
  const tickers = (Array.isArray(n.tickers) ? n.tickers : [n.ticker]).map((s: string) => safeSymbol(s)).filter(Boolean);
  const primary = tickers[0] || '';
  if (!primary) return '<div class="reader-lead">This market story is unavailable.</div>';
  const t = getTicker(primary);
  return `<article>
    <div class="reader-kicker">Daily recap · ${escapeHtml(n.time)}</div>
    <p class="reader-lead">${n.body}</p>
    <div class="reader-card">
      <div class="reader-card__h">${logo(primary, 22)} <b>${escapeHtml(primary)}</b> <span class="muted">${escapeHtml(assetName(primary))}</span>
        <span class="pill ${cls(t.chgPct)}" style="margin-left:auto">${t.changeReal ? fmtPct(t.chgPct) : '—'}</span></div>
      <div class="reader-chart"><div class="reader-live" data-sym="${escapeHtml(primary)}" style="height:160px"></div></div>
    </div>
    <div class="reader-sec">Related assets</div>
    <div class="reader-assets">${tickers.map(assetChip).join('')}</div>
    <div class="reader-sec">Data provenance</div>
    <div class="reader-sources">
      <span class="reader-src">${icon('doc', 14)} Hyperliquid${_homeWorld === 'stocks' ? ' · trade.xyz' : ''} <span class="muted">· live venue data summarized by Hence</span></span>
    </div>
  </article>`;
}

function recapView() {
  const items = activeFeed.map((n, i) => ({ n, i })).filter((x) => !x.n.type);
  // only show a brief that expands the recap currently on screen — a stale one is worse than loading
  const cur = activeLongBrief[_homeWorld];
  const brief = cur && cur.key === activeRecapText ? cur.text : '';
  // weave ticker entity chips into the brief at render (kept out of the cache/store)
  const briefHtml = brief
    ? brief.split(/\n\n+/).map((p: string) => `<p class="reader-lead">${linkEntities(p.trim(), _homeWorld)}</p>`).join('')
    : `<p class="reader-lead">${linkEntities(activeSummary, _homeWorld)}</p><div class="reader-brief__loading">${icon('analyze', 13)} Writing the full brief…</div>`;
  return `<div>
    <div class="reader-kicker">Today · ${escapeHtml(String(activeFeed[0]?.time || '').replace('Today · ', ''))}</div>
    <div class="reader-brief">${briefHtml}</div>
    <div class="reader-sec">Today’s stories</div>
    ${items.map(({ n, i }) => `<button class="reader-item" data-story="${i}">
      <span class="reader-item__logos">${(Array.isArray(n.tickers) ? n.tickers : [n.ticker]).slice(0, 3).map((s: string) => logo(safeSymbol(s), 20)).join('')}</span>
      <span class="reader-item__b">${escapeHtml(stripHtml(n.body))}</span>
      <span class="reader-item__t">${escapeHtml(String(n.time || '').replace('Today · ', ''))}</span>${icon('chevR', 14)}</button>`).join('')}
  </div>`;
}

function openReader(initial: { mode?: string; i?: number }) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const ov = document.createElement('div');
  ov.className = 'reader';
  ov.dataset.mode = initial.mode || 'recap';
  if (initial.i != null) ov.dataset.i = String(initial.i);
  function paint() {
    const mode = ov.dataset.mode;
    ov.innerHTML = `<div class="reader__panel">
      <div class="reader__bar">
        <button class="reader__back">${icon('back', 16)} Daily recap</button>
        <span class="reader__time">Live market recap</span>
        <button class="reader__x" data-x>${icon('close', 16)}</button>
      </div>
      <div class="reader__scroll">${mode === 'story' ? storyView(+(ov.dataset.i || 0)) : recapView()}</div>
    </div>`;
    initCharts(ov);
    const liveEl = ov.querySelector('.reader-live') as HTMLElement | null;
    if (liveEl) market.fillChart(liveEl, liveEl.dataset.sym, '1Y', { w: 620, h: 160 })
      .then((ok: boolean) => { if (!ok && liveEl.isConnected) liveEl.textContent = 'Live chart unavailable'; });
    // write the expanded "Read more" brief on open — normally already preloaded into activeLongBrief,
    // else fetch it now as an EXPANSION of the on-screen recap (server caches by the recap's hash,
    // so preview and Read more always tell the same edition, for every user in the window)
    const have = activeLongBrief[_homeWorld];
    if (mode === 'recap' && (!have || have.key !== activeRecapText) && activeRecapData) {
      ai.briefBest(_homeWorld, activeRecapData, activeRecapText).then((text: string) => {
        if (text) { activeLongBrief[_homeWorld] = { key: activeRecapText, text }; if (ov.isConnected && ov.dataset.mode === 'recap') paint(); }
      }).catch(() => {});
    }
  }
  function close() { ov.classList.remove('in'); setTimeout(() => ov.remove(), 220); }
  paint();
  root.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('in'));
  ov.addEventListener('click', (e: any) => {
    if (e.target.closest('[data-x]')) { close(); return; }
    // ticker entity chip inside the brief → quiet action popover (stays within the reader)
    const chip = e.target.closest('.tk-chip');
    if (chip) { e.stopPropagation(); openChipMenu(chip.dataset.tk, chip.getBoundingClientRect()); return; }
    if (e.target.closest('.reader__back')) { if (ov.dataset.mode === 'story') { ov.dataset.mode = 'recap'; paint(); } else close(); return; }
    const item = e.target.closest('[data-story]');
    if (item) { ov.dataset.mode = 'story'; ov.dataset.i = item.dataset.story; paint(); ov.scrollTop = 0; return; }
    if (e.target.closest('.reader-asset')) close();
  });
}

/* ============================================================
   Thesis reader — a small reader-style overlay listing a thesis
   summary + its evidence items (title, source/url link, time).
   Reuses the .reader classes (openReader pattern).
   ============================================================ */
function evTime(s?: string) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
function openThesis(t: any) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const ov = document.createElement('div');
  ov.className = 'reader';
  const esc = (x: string) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const evidence = Array.isArray(t.evidence) ? t.evidence : [];
  const symbols = Array.isArray(t.symbols) ? t.symbols : [];
  const ev = evidence.map((e: any) => {
    const time = evTime(e.created_at);
    const evidenceSymbol = safeSymbol((e.symbols && e.symbols[0]) || '');
    const inner = `${evidenceSymbol ? logo(evidenceSymbol, 20) : ''}<span class="thesis-ev__b">${esc(e.title || e.subject_type || 'Saved item')}</span>${time ? `<span class="thesis-ev__t">${esc(time)}</span>` : ''}`;
    const evidenceUrl = safeHttpUrl(e.url);
    return evidenceUrl
      ? `<a class="thesis-ev" href="${esc(evidenceUrl)}" target="_blank" rel="noopener">${inner}${icon('link', 13)}</a>`
      : `<div class="thesis-ev">${inner}</div>`;
  }).join('');
  ov.innerHTML = `<div class="reader__panel">
    <div class="reader__bar">
      <button class="reader__back" data-x>${icon('back', 16)} Your stash</button>
      <span class="reader__time">${symbols.length ? esc(symbols.slice(0, 3).map((s: string) => safeSymbol(s)).filter(Boolean).join(' · ')) : 'Thesis'}</span>
      <button class="reader__x" data-x>${icon('close', 16)}</button>
    </div>
    <div class="reader__scroll">
      <article>
        <div class="reader-kicker">Your stash · ${esc(String(Number.isFinite(+t.evidence_count) ? +t.evidence_count : evidence.length))} saves</div>
        <h2 class="thesis-title">${esc(t.title || '')}</h2>
        ${t.summary ? `<p class="reader-lead">${esc(t.summary)}</p>` : ''}
        <div class="reader-sec">Evidence</div>
        <div class="thesis-evs">${ev || '<div class="muted" style="padding:8px 0">No saved evidence yet.</div>'}</div>
      </article>
    </div>
  </div>`;
  function close() { ov.classList.remove('in'); setTimeout(() => ov.remove(), 220); }
  root.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('in'));
  ov.addEventListener('click', (e: any) => {
    if (e.target.closest('[data-x]')) { close(); return; }
    if (e.target.closest('.thesis-ev[href]')) { close(); } // let the link open, then dismiss
  });
}

/* watchlist slides in from the right (collapsed by default) — mounts the REAL React
   WatchlistPanel (per-user list + live tickers + real HL holdings) via a portal root. */
function openWatchlistDrawer() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (root.querySelector('.wl-drawer')) return; // already open
  const d = document.createElement('div');
  d.className = 'wl-drawer';
  const bd = document.createElement('div');
  bd.className = 'wl-drawer__bd';
  const panel = document.createElement('div');
  panel.className = 'wl-drawer__panel';
  d.appendChild(bd);
  d.appendChild(panel);
  root.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));

  const reactRoot = createRoot(panel);
  const close = () => {
    d.classList.remove('in');
    setTimeout(() => { try { reactRoot.unmount(); } catch { /* noop */ } d.remove(); }, 260);
  };
  bd.addEventListener('click', close);
  reactRoot.render(<WatchlistPanel onClose={close} />);
}
