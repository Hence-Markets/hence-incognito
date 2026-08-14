/* Onboarding — v2 signup flow (username → adaptive interests → welcome tour).
   The old plan/payment/card billing demo steps remain routable (command palette →
   "Billing & plan"), but the real first-run funnel starts at /onboarding/username. */
import { track } from '../lib/analytics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLinkAccount } from '@privy-io/react-auth';
import { Icon } from '../components/Icon';
import { PLANS } from '../lib/data.js';
import { toast } from '../lib/ui.js';
import { useAuth } from '../hooks/useAuth';
import { useMe } from '../hooks/useMe';
import { INTEREST_GROUPS, keyOf, parseKey } from '../lib/interests.js';
import * as me from '../lib/me.js';
import * as poly from '../lib/polymarket.js';
import { addWatch } from '../lib/watch';
import { PERSONA_KEY } from '../lib/persona';
import '../styles/onboarding.css';

const DEMO_EMAIL = 'samlee.mobbin@gmail.com';

function Signout() {
  const auth = useAuth();
  // identity chain for the signed-in label: email → @x-handle → wallet address. The demo
  // persona is ONLY for the logged-out preview flow — a wallet-only login has no email and
  // must never be shown as someone else's.
  const email = auth.authenticated
    ? (auth.email || (auth.xHandle ? '@' + auth.xHandle : '') || auth.shortAddr || 'wallet')
    : DEMO_EMAIL;
  return (
    <a className="flow__signout" href="#/login">
      <Icon name="signout" size={15} /> Sign out <span className="muted">({email})</span>
    </a>
  );
}

/* ===================== username (v2 step 1) ===================== */

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const cleanBase = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);

// temp-username candidates from what we know about the user (X handle > email > name)
function suggestFor(auth: { xHandle?: string; email?: string; name?: string }, seed: number): string[] {
  const bases: string[] = [];
  const push = (b?: string) => { const c = cleanBase(b || ''); if (c.length >= 3 && !bases.includes(c)) bases.push(c); };
  push(auth.xHandle);
  push(auth.email ? auth.email.split('@')[0] : '');
  push(auth.name ? auth.name.replace(/\s+/g, '_') : '');
  if (!bases.length) bases.push('trader');
  const b = bases[0];
  const out = [...bases, `${b}_${seed}`, b.length <= 12 ? `${b}_trades` : `${b}${seed}`];
  return [...new Set(out)].filter((h) => HANDLE_RE.test(h)).slice(0, 3);
}

const XSVG = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117z" />
  </svg>
);

type HandleStatus = 'idle' | 'checking' | 'ok' | 'yours' | 'taken' | 'invalid' | 'offline';

function UsernameStep() {
  const auth = useAuth();
  const { me: profile } = useMe();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<HandleStatus>('idle');
  const [focus, setFocus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [xBusy, setXBusy] = useState(false);
  const touched = useRef(false);
  const latest = useRef('');

  const seed = useRef(10 + Math.floor(Math.random() * 90));
  const suggs = useMemo(
    () => suggestFor(auth, seed.current),
    [auth.email, auth.xHandle, auth.name] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // prefill: an already-claimed handle wins, else the first temp suggestion — never stomp typing
  useEffect(() => {
    if (touched.current) return;
    const pre = profile?.handle || suggs[0] || '';
    if (pre) setValue(pre);
  }, [profile?.handle, suggs]);

  // live availability (debounced); stale responses are ignored via `latest`
  useEffect(() => {
    const h = cleanBase(value.trim());
    latest.current = h;
    if (!h) { setStatus('idle'); return; }
    if (!HANDLE_RE.test(h)) { setStatus('invalid'); return; }
    if (profile?.handle && h === profile.handle.toLowerCase()) { setStatus('yours'); return; }
    setStatus('checking');
    const id = window.setTimeout(async () => {
      const r: any = await me.checkHandle(h);
      if (latest.current !== h) return;
      if (r?.unauth || r?.error || r?.available === false) { setStatus('offline'); return; }
      setStatus(r.status === 'available' ? 'ok' : r.status === 'yours' ? 'yours' : r.status === 'taken' ? 'taken' : 'invalid');
    }, 350);
    return () => window.clearTimeout(id);
  }, [value, profile?.handle]);

  // record the linked X identity as a (non-account) connection row — the hook for future
  // X-graph features. Idempotent per (provider:'x', external_ref:username); the accounts
  // drawer filters kind='social' so it never renders as a $0 exchange.
  const recordX = (username?: string | null, name?: string | null, avatar?: string | null, subject?: string | null) => {
    const u = (username || '').replace(/^@/, '');
    if (!u || !auth.authenticated) return;
    void me.saveConnection({
      kind: 'social', provider: 'x', label: '@' + u, external_ref: u.toLowerCase(),
      status: 'connected', meta: { username: u, name: name || null, avatar: avatar || null, subject: subject || null, source: 'onboarding' },
    });
  };

  // "claim from X": already-linked → just use it; else run Privy's Twitter OAuth link
  const { linkTwitter } = useLinkAccount({
    onSuccess: ({ user }: any) => {
      setXBusy(false);
      const tw = user?.twitter;
      const h = cleanBase(tw?.username || '');
      if (h) { touched.current = true; setValue(h); toast(`Pulled @${h} from X`); }
      recordX(tw?.username, tw?.name, tw?.profilePictureUrl, tw?.subject);
    },
    onError: () => setXBusy(false),
  });
  const onX = () => {
    if (auth.xHandle) {
      touched.current = true;
      setValue(cleanBase(auth.xHandle));
      recordX(auth.xHandle, auth.name, auth.avatarUrl);   // linked in a past session — still record the hook
      return;
    }
    if (!auth.authenticated) { toast('Sign in first to link your X account'); return; }
    setXBusy(true);
    linkTwitter();
  };

  const next = () => { location.hash = '#/onboarding/path'; };
  const submit = async () => {
    const h = cleanBase(value.trim());
    if (!auth.authenticated || status === 'offline') { next(); return; }  // preview/offline: never trap
    if (!HANDLE_RE.test(h)) { setStatus('invalid'); return; }
    if (status === 'taken') return;
    if (status === 'yours') { next(); return; }
    setSaving(true);
    const r: any = await me.setHandle(h);
    setSaving(false);
    if (r?.ok || r?.me) { toast(`You're @${h}`); next(); }
    else if (r?.status === 409) setStatus('taken');
    else if (r?.status === 400) setStatus('invalid');
    else {
      // server hiccup — don't block onboarding, but never silently drop the chosen name:
      // stash it and PendingHandleRunner (App.tsx) re-claims once the API recovers
      try { localStorage.setItem('hence.pendingHandle', h); } catch { /* storage off */ }
      toast(`We'll reserve @${h} as soon as the connection recovers`);
      next();
    }
  };
  const skip = () => {
    // keep the suggested temp name so the account still has one (best-effort, retried on failure)
    const h = suggs[0];
    if (auth.authenticated && !profile?.handle && h) {
      Promise.resolve(me.setHandle(h)).then((r: any) => {
        if (!(r?.ok || r?.me || r?.status === 409 || r?.status === 400)) {
          try { localStorage.setItem('hence.pendingHandle', h); } catch { /* storage off */ }
        }
      }).catch(() => { try { localStorage.setItem('hence.pendingHandle', h); } catch { /* storage off */ } });
    }
    next();
  };

  const h = cleanBase(value.trim());
  const verdict =
    status === 'ok' ? `@${h} is available` :
    status === 'yours' ? `@${h} is already yours` :
    status === 'taken' ? `@${h} is taken — try a variation` :
    status === 'invalid' && value.trim() ? '3–20 characters: letters, numbers, underscores' :
    status === 'checking' ? 'Checking…' :
    status === 'offline' ? 'We’ll reserve this once you’re signed in' : '';
  const fieldCls = 'ob2-field' + (focus ? ' is-focus' : '') +
    (status === 'ok' || status === 'yours' ? ' is-ok' : status === 'taken' || status === 'invalid' ? ' is-bad' : '');

  return (
    <>
      <Signout />
      <div className="flow__inner ob2-user">
        <h1 className="flow__title">Claim your <span className="grad">@name</span></h1>
        <p className="flow__sub">One name across everything you do here — the ideas you stash, the calls you make, the boards you climb. You can change it later.</p>
        <div className={fieldCls}>
          <span className="ob2-at">@</span>
          <input
            value={value}
            placeholder="username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onChange={(e) => { touched.current = true; setValue(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <span className={'ob2-status' + (status === 'ok' || status === 'yours' ? ' is-ok' : status === 'taken' || status === 'invalid' ? ' is-bad' : '')}>
            {status === 'checking' ? <span className="ob2-spin" /> :
             status === 'ok' || status === 'yours' ? <Icon name="check" size={15} /> :
             status === 'taken' || status === 'invalid' ? <Icon name="close" size={13} /> : null}
          </span>
        </div>
        <div className={'ob2-verdict' + (status === 'ok' || status === 'yours' ? ' is-ok' : status === 'taken' || status === 'invalid' ? ' is-bad' : '')}>{verdict}</div>
        <div className="ob2-suggs">
          {suggs.map((s) => (
            <button key={s} type="button" className="ob2-sugg" onClick={() => { touched.current = true; setValue(s); }}>
              <span className="ob2-sugg__at">@</span>{s}
            </button>
          ))}
        </div>
        <button type="button" className="ob2-x" onClick={onX} disabled={xBusy}>
          <XSVG /> {xBusy ? 'Waiting for X…' : auth.xHandle ? `Use @${cleanBase(auth.xHandle)} from X` : 'Claim your X username'}
        </button>
        {!auth.xHandle ? <span className="ob2-x__hint">Connect X once — your handle, name and avatar come with it.</span> : null}
        <div className="ob2-foot">
          <button className="btn btn--light btn--block" disabled={saving} onClick={submit} style={{ maxWidth: 460, margin: '0 auto' }}>
            {saving ? 'Claiming…' : h ? `Continue as @${h}` : 'Continue'}
          </button>
          <button type="button" className="ob2-skip" disabled={saving} onClick={skip}>
            Skip — keep @{suggs[0] || 'trader'} for now
          </button>
        </div>
      </div>
    </>
  );
}

/* ===================== the fork — personalize now, or straight in (v2 step 1.5) ===================== */
// Pro traders shouldn't lose momentum in setup: the fast path marks the account onboarded
// with zero interests (Hence learns from behavior) and everything remains tunable later in
// Settings → Your algorithm.
function PathStep() {
  const [busy, setBusy] = useState(false);
  const fast = async () => {
    if (busy) return;
    setBusy(true);
    try { await me.setInterests([]); } catch { /* anon/offline — gate re-asks next login */ }
    me.markOnboarded();
    toast('Skipping the tuning — tune it anytime in Settings → Your algorithm');
    setTimeout(() => { location.hash = '#/welcome/command'; }, 400);   // still show the one ⌘K finale
  };
  return (
    <>
      <Signout />
      <div className="flow__inner ob2-conv">
        <div className="ob2-card" key="path">
          <div className="ob2-kicker">Set-up, your way</div>
          <h1 className="flow__title">How do you want to <span className="grad">start</span>?</h1>
          <p className="flow__sub">Either way, everything here stays tunable in Settings → Your algorithm.</p>
          <div className="ob2-forks">
            <button type="button" className="ob2-fork" disabled={busy} onClick={() => { location.hash = '#/onboarding/interests'; }}>
              <span className="ob2-fork__meta">~60 seconds</span>
              <span className="ob2-fork__t">Tune it to me</span>
              <span className="ob2-fork__s">A few adaptive questions, one belief, your member pass — then an optional tour.</span>
            </button>
            <button type="button" className="ob2-fork" disabled={busy} onClick={fast}>
              <span className="ob2-fork__meta">Right now</span>
              <span className="ob2-fork__t">I know my way</span>
              <span className="ob2-fork__s">{busy ? 'Opening…' : 'Straight to the app with a neutral feed. Hence learns as you react.'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== adaptive interests (v2 step 2) ===================== */

// label lookup for the accumulating tray + summary
const CHIP_META: Record<string, { label: string; emoji?: string }> = {};
INTEREST_GROUPS.forEach((g: any) => g.items.forEach((it: any) => { CHIP_META[keyOf(g.kind, it.topic)] = it; }));

/* ---- first-belief: free-text world-view → /api/believe → venue-routable trade legs ---- */
// borrowable world-views for the rotating carousel (click = generate for that view)
const SUGGESTED_BELIEFS: { t: string; tag: string }[] = [
  { t: 'Rate cuts are coming sooner than the market thinks', tag: 'Macro' },
  { t: 'AI capex keeps running hot into 2027', tag: 'AI' },
  { t: 'Chip supply chains keep drifting away from Taiwan', tag: 'Semis' },
  { t: 'Solana keeps eating everyone else’s lunch', tag: 'Crypto' },
  { t: 'The dollar weakens into the election', tag: 'FX' },
  { t: 'Memecoins are done this cycle', tag: 'Crypto' },
  { t: 'Oil spikes on the next Middle East shock', tag: 'Energy' },
  { t: 'Prediction markets go mainstream this year', tag: 'Events' },
];

// widen /api/believe's symbol whitelist with what the user just told us they trade
function symbolsHint(sel: Set<string>): string[] {
  const has = (k: string, t: string) => sel.has(keyOf(k, t));
  const out = new Set<string>();
  if (has('asset_class', 'crypto') || has('asset_class', 'perps')) ['BTC', 'ETH', 'SOL', 'HYPE'].forEach((s) => out.add(s));
  if (has('sector', 'defi') || has('theme', 'onchain-yield')) ['SOL', 'LINK', 'AAVE'].forEach((s) => out.add(s));
  if (has('sector', 'memecoins')) out.add('DOGE');
  if (has('asset_class', 'stocks') || has('sector', 'tech') || has('sector', 'semis')) ['NVDA', 'TSLA', 'AAPL', 'AMD', 'TSM'].forEach((s) => out.add(s));
  if (has('sector', 'energy') || has('asset_class', 'commodities')) ['XOM', 'GLD'].forEach((s) => out.add(s));
  return [...out];
}

// prediction legs come back as bare questions — try to pin each to a live Polymarket market
async function enrichPredictionLegs(legs: any[]): Promise<any[]> {
  if (!legs.some((l) => l.venue === 'prediction')) return legs;
  try {
    const list: any[] = await poly.markets(80);
    const STOP = new Set(['will', 'does', 'the', 'this', 'that', 'after', 'before', 'next', 'month', 'year', 'meeting']);
    return legs.map((l) => {
      if (l.venue !== 'prediction') return l;
      const words = ((l.label || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w: string) => !STOP.has(w));
      let best: any = null, bestScore = 1;                     // need >= 2 shared meaningful words
      for (const m of list) {
        if (!m || !m.question || !(m.yes >= 0.03 && m.yes <= 0.97)) continue;
        const q = m.question.toLowerCase();
        const score = words.filter((w: string) => q.includes(w)).length;
        if (score > bestScore) { best = m; bestScore = score; }
      }
      return best ? { ...l, market: { id: best.id, question: best.question, yes: best.yes }, route: '#/terminal/m/' + best.id } : l;
    });
  } catch { return legs; }
}

// voices that fit the sectors/themes already picked — shown first with a "suggested" ring.
// (True X-graph matching needs X API access we don't have; the linked-X row is the hook.)
function suggestedVoices(sel: Set<string>): Set<string> {
  const has = (k: string, t: string) => sel.has(keyOf(k, t));
  const out = new Set<string>();
  if (has('sector', 'defi') || has('theme', 'onchain-yield')) ['ignas', 'the-defi-investor', 'the-defi-edge'].forEach((v) => out.add(v));
  if (has('theme', 'macro') || has('asset_class', 'fx') || has('asset_class', 'commodities')) ['arthur-hayes', 'forward-guidance'].forEach((v) => out.add(v));
  if (has('sector', 'memecoins') || has('sector', 'l1-l2') || has('sector', 'infrastructure') || has('sector', 'ai-agents')) ['empire', 'bankless'].forEach((v) => out.add(v));
  if (has('asset_class', 'perps')) out.add('arthur-hayes');
  if (!out.size) ['empire', 'arthur-hayes'].forEach((v) => out.add(v));
  return out;
}

type Q = { id: string; kind: string; kicker: string; title: JSX.Element; sub: string; items: any[]; sug?: Set<string> };

// the conversation reshapes itself around earlier answers: crypto/stock sector questions
// only exist if you trade them, copy references what you picked, voices only show when
// the (crypto-native) tracked voices are actually relevant to you.
function buildQuestions(sel: Set<string>, xLinked?: boolean): Q[] {
  const has = (kind: string, t: string) => sel.has(keyOf(kind, t));
  const cryptoish = has('asset_class', 'crypto') || has('asset_class', 'perps');
  const qs: Q[] = [{
    id: 'markets', kind: 'asset_class', kicker: 'First — your markets',
    title: <>Where do you <span className="grad">play</span>?</>,
    sub: 'Pick every market you actually follow. What we ask next depends on it.',
    items: INTEREST_GROUPS[0].items,
  }];
  if (cryptoish) {
    qs.push({
      id: 'crypto', kind: 'sector', kicker: 'Because you picked crypto',
      title: <>Which corners of <span className="grad">crypto</span>?</>,
      sub: has('asset_class', 'perps')
        ? 'Perps too — leverage-friendly setups will find you first.'
        : 'News, signals and setups get weighted toward these.',
      items: INTEREST_GROUPS[1].items,
    });
  }
  if (has('asset_class', 'stocks')) {
    qs.push({
      id: 'stocks', kind: 'sector', kicker: 'Because you picked stocks',
      title: <>Which <span className="grad">sectors</span> do you watch?</>,
      sub: 'Earnings, analyst moves and sector flow surface for these first.',
      items: INTEREST_GROUPS[2].items,
    });
  }
  qs.push({
    id: 'themes', kind: 'theme', kicker: sel.size ? 'Sharpening the picture' : 'Themes',
    title: <>What do you <span className="grad">believe</span> in?</>,
    sub: has('asset_class', 'predictions')
      ? 'You like event markets — these are the narratives that move them.'
      : 'The narratives you follow decide which setups we show you first.',
    items: INTEREST_GROUPS[3].items,
  });
  if (cryptoish) {
    const sug = suggestedVoices(sel);
    // suggested-first ordering; the ring style marks them in place
    const items = [...INTEREST_GROUPS[4].items].sort((a: any, b: any) => Number(sug.has(b.topic)) - Number(sug.has(a.topic)));
    qs.push({
      id: 'voices', kind: 'source', kicker: 'Voices',
      title: <>Voices worth <span className="grad">tracking</span>?</>,
      sub: 'We transcribe their calls and score the returns. The ringed ones fit your picks'
        + (xLinked ? ' — matching from your X graph comes later.' : '.'),
      items, sug,
    });
  }
  return qs;
}

function InterestsStep() {
  const auth = useAuth();
  const { me: profile } = useMe();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qi, setQi] = useState(0);
  const [saving, setSaving] = useState(false);
  const questions = useMemo(() => buildQuestions(sel, !!auth.xHandle), [sel, auth.xHandle]);
  const beliefIdx = questions.length;             // the belief card sits after the taxonomy
  const onBelief = qi === beliefIdx;
  const summary = qi > beliefIdx;
  const q = questions[Math.min(qi, questions.length - 1)];

  // belief card: free-text world-view → /api/believe legs
  const [beliefText, setBeliefText] = useState('');
  const [gen, setGen] = useState<any>(null);      // null | {loading} | {err} | {thesis, legs, heuristic}
  const [seeded, setSeeded] = useState<string | null>(null);
  const savedFor = useRef<string | null>(null);

  // retune mode: an already-onboarded user re-enters from Settings → prefill their picks
  // and exit back to Settings instead of the tour. One-shot; never stomps in-flight toggles.
  const retune = useRef(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !profile?.onboarded) return;
    prefilled.current = true;
    retune.current = true;
    setSel((cur) => cur.size ? cur : new Set(
      (profile.interests || [])
        .filter((r: any) => r.source === 'onboarding')
        .map((r: any) => keyOf(r.kind, r.topic))
    ));
  }, [profile]);

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const picksIn = (qq: Q) => qq.items.filter((it: any) => sel.has(keyOf(qq.kind, it.topic))).length;

  // the tour personalizes off this mirror instantly (and for anon runs) — profile catches up async
  const savePersona = () => {
    try { localStorage.setItem(PERSONA_KEY, JSON.stringify({ keys: [...sel], belief: seeded, ts: Date.now() })); } catch { /* quota */ }
  };

  const genFor = async (text: string) => {
    const t = text.trim();
    if (t.length < 8) { toast('Say a bit more — one sentence is plenty'); return; }
    setBeliefText(t);
    setGen({ loading: true });
    try {
      const r = await fetch('/api/believe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ belief: t, data: { symbols: symbolsHint(sel) } }),
      });
      const res: any = r.ok ? await r.json() : null;
      if (!res || !res.available || !res.legs?.length) { setGen({ err: true }); return; }
      const legs = await enrichPredictionLegs(res.legs);
      setGen({ thesis: res.thesis, legs, heuristic: !!res.heuristic });
      setSeeded(t);
      // persist as a user-asserted thesis (belief spine) — once per distinct belief; anon → no-op
      if (savedFor.current !== t) {
        savedFor.current = t;
        void me.addThesis({
          title: res.thesis?.title || t, summary: res.thesis?.summary || null,
          direction: res.thesis?.direction || null,
          symbols: legs.map((l: any) => l.symbol).filter(Boolean),
        });
      }
    } catch { setGen({ err: true }); }
  };

  const finish = async () => {
    setSaving(true);
    savePersona();
    // preserve evolved weights on retune — set_interests re-seeds at 1.0 otherwise
    const wmap: Record<string, number> = {};
    (profile?.interests || []).forEach((r: any) => { wmap[keyOf(r.kind, r.topic)] = r.weight; });
    const items = [...sel].map((k) => {
      const p: any = parseKey(k);
      if (wmap[k] && wmap[k] !== 1) p.weight = wmap[k];
      return p;
    });
    try { await me.setInterests(items); } catch { /* anon / offline → kept locally next login */ }
    track('onboarding_completed', { interests: items.length });
    if (retune.current) {
      toast('Your algorithm is updated');
      setTimeout(() => { location.hash = '#/settings'; }, 500);
    } else {
      me.markOnboarded();                            // never re-trap this device at the username step
      toast(items.length ? `Your universe: ${items.length} interest${items.length > 1 ? 's' : ''} tracked` : 'You can set interests anytime in Settings');
      setTimeout(() => { location.hash = '#/welcome/yourpass'; }, 600);
    }
  };

  const picked = [...sel];
  const tray = picked.slice(0, 10);

  const dots = (
    <div className="ob2-dots">
      {questions.map((qq, i) => (
        <span key={qq.id} className={'ob2-dot' + (i < qi ? ' is-done' : i === qi ? ' is-cur' : '')} />
      ))}
      <span className={'ob2-dot' + (onBelief ? ' is-cur' : summary ? ' is-done' : '')} />
      <span className={'ob2-dot' + (summary ? ' is-cur' : '')} />
    </div>
  );

  if (onBelief) {
    const legs: any[] = gen?.legs || [];
    return (
      <>
        <Signout />
        <div className="flow__inner ob2-conv">
          {dots}
          <div className="ob2-card" key="belief">
            <div className="ob2-kicker">Last one — say it out loud</div>
            <h1 className="flow__title">What do you <span className="grad">believe</span>?</h1>
            <p className="flow__sub">One sentence about the world. Hence turns it into positions you could actually hold — that's the whole product.</p>
            <div className={'ob2-ask' + (gen?.loading ? ' is-busy' : '')}>
              <input
                value={beliefText}
                placeholder="I think rate cuts are coming…"
                maxLength={280}
                disabled={!!gen?.loading}
                onChange={(e) => setBeliefText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') genFor(beliefText); }}
              />
              <button type="button" className="ob2-ask__go" disabled={!!gen?.loading} onClick={() => genFor(beliefText)}>
                {gen?.loading ? <span className="ob2-spin" /> : <>&there4; Show the trade</>}
              </button>
            </div>
            {!gen || gen.err ? (
              <>
                {gen?.err ? <div className="ob2-verdict is-bad">Couldn&rsquo;t read that one — try rewording, or borrow a view below.</div> : null}
                <div className="ob2-caro__label">or borrow a world-view</div>
                <div className="ob2-caro">
                  <div className="ob2-caro__track">
                    {[...SUGGESTED_BELIEFS, ...SUGGESTED_BELIEFS].map((b, i) => (
                      <button type="button" className="ob2-belcard" key={i} onClick={() => genFor(b.t)}>
                        <span className="ob2-belcard__tag">{b.tag}</span>
                        <span className="ob2-belcard__t">{b.t}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            {gen?.loading ? (
              <div className="ob2-legs ob2-legs--loading">&there4; reading your world view&hellip;</div>
            ) : null}
            {legs.length ? (
              <div className="ob2-legs">
                <div className="ob2-legs__head">
                  <span className="ob2-legs__title">{gen.thesis?.title || seeded}</span>
                  {gen.heuristic ? <span className="ob2-legs__tag">starter read</span> : null}
                </div>
                {gen.thesis?.summary ? <div className="ob2-legs__sum">{gen.thesis.summary}</div> : null}
                {legs.map((l: any, i: number) => (
                  <div className="ob2-leg" key={i}>
                    <span className={'ob2-venue ob2-venue--' + l.venue}>{l.venue === 'prediction' ? 'event' : l.venue}</span>
                    <span className="ob2-leg__label">
                      {l.label}
                      {l.market ? <span className="ob2-leg__odds"> · YES {Math.round(l.market.yes * 100)}&cent;</span> : null}
                    </span>
                    <span className={'ob2-leg__dir' + (l.direction === 'short' || l.direction === 'no' ? ' is-dn' : '')}>{l.direction.toUpperCase()}</span>
                    {l.symbol ? (
                      <button type="button" className="ob2-leg__watch" onClick={() => { addWatch(l.symbol); toast(`${l.symbol} added to your watchlist`); }}>Watch</button>
                    ) : l.market ? (
                      <a className="ob2-leg__watch" href={l.route}>Odds</a>
                    ) : null}
                  </div>
                ))}
                {legs[0]?.why ? <div className="ob2-legs__why">{legs[0].why}</div> : null}
                <div className="ob2-legs__foot">
                  Seeded as your first thesis — Hence gathers evidence for and against it from here on.
                  <button type="button" className="ob2-legs__again" onClick={() => { setGen(null); setBeliefText(''); }}>Try another</button>
                </div>
              </div>
            ) : null}
            <div className="ob2-nav">
              <button className="ob2-back" onClick={() => setQi((i) => i - 1)}><Icon name="back" size={12} /> Back</button>
              <button className="btn btn--light" onClick={() => setQi((i) => i + 1)}>
                {seeded ? 'Continue' : 'No take — skip'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (summary) {
    return (
      <>
        <Signout />
        <div className="flow__inner ob2-conv">
          {dots}
          <div className="ob2-card" key="summary">
            <div className="ob2-kicker">Your universe</div>
            <h1 className="flow__title">{picked.length ? <>Tuned to <span className="grad">you</span></> : <>Starting <span className="grad">neutral</span></>}</h1>
            <p className="flow__sub">
              {picked.length
                ? `These ${picked.length} picks tune your home feed, signals and Today's Setups. Tap any to drop it — Hence keeps learning as you react to ideas.`
                : 'No picks — no problem. Hence learns your universe from what you react to. You can also set these anytime in Settings.'}
            </p>
            <div className="intr__chips ob2-sum__groups">
              {picked.map((k) => {
                const c = CHIP_META[k] || { label: k.split(':')[1] };
                return (
                  <button key={k} type="button" className="intr__chip on" onClick={() => toggle(k)}>
                    {c.emoji ? <span className="intr__emoji">{c.emoji}</span> : null}{c.label}
                  </button>
                );
              })}
            </div>
            {seeded ? (
              <div className="ob2-sum__belief">First thesis seeded: <b>&ldquo;{seeded}&rdquo;</b></div>
            ) : null}
            <div className="ob2-nav">
              <button className="ob2-back" onClick={() => setQi(beliefIdx)}><Icon name="back" size={12} /> Back</button>
              <button className="btn btn--light" disabled={saving} onClick={finish}>
                {saving ? 'Saving…' : retune.current ? 'Save my algorithm' : 'Mint my pass'}
              </button>
            </div>
            <div className="ob2-sum__hint">{retune.current ? 'Changes apply to your feed immediately.' : 'Next: your member pass, then an optional 30-second tour.'}</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Signout />
      <div className="flow__inner ob2-conv">
        {dots}
        {picked.length ? (
          <div className="ob2-tray">
            <span className="ob2-tray__label">Your universe</span>
            {tray.map((k) => {
              const c = CHIP_META[k] || { label: k.split(':')[1] };
              return <span className="ob2-tchip" key={k}>{c.emoji ? <span>{c.emoji}</span> : null}{c.label}</span>;
            })}
            {picked.length > tray.length ? <span className="ob2-tchip__more">+{picked.length - tray.length}</span> : null}
          </div>
        ) : null}
        <div className="ob2-card" key={q.id}>
          <div className="ob2-kicker">{q.kicker}</div>
          <h1 className="flow__title">{q.title}</h1>
          <p className="flow__sub">{q.sub}</p>
          <div className="intr__chips">
            {q.items.map((it: any) => {
              const k = keyOf(q.kind, it.topic);
              const on = sel.has(k);
              const sug = q.sug?.has(it.topic) && !on;
              return (
                <button key={k} type="button" className={'intr__chip' + (on ? ' on' : '') + (sug ? ' ob2-chip-sug' : '')} onClick={() => toggle(k)}>
                  {it.emoji ? <span className="intr__emoji">{it.emoji}</span> : null}{it.label}
                </button>
              );
            })}
          </div>
          <div className="ob2-nav">
            {qi > 0 ? <button className="ob2-back" onClick={() => setQi(qi - 1)}><Icon name="back" size={12} /> Back</button> : null}
            {q.sug && [...q.sug].some((t) => !sel.has(keyOf(q.kind, t))) ? (
              <button
                className="ob2-back"
                onClick={() => setSel((s) => { const n = new Set(s); q.sug!.forEach((t) => n.add(keyOf(q.kind, t))); return n; })}
              >
                + Add suggested
              </button>
            ) : null}
            <button className="btn btn--light" onClick={() => setQi(qi + 1)}>
              {picksIn(q) ? 'Continue' : 'None of these — next'}
            </button>
          </div>
        </div>
        <button type="button" className="ob2-skip" disabled={saving} onClick={finish}>Skip the rest</button>
      </div>
    </>
  );
}

/* ===================== legacy billing demo steps (palette → Billing & plan) ===================== */

function PlanStep() {
  const [sel, setSel] = useState((PLANS as any[])[0]?.id);
  return (
    <>
      <Signout />
      <div className="flow__inner">
        <h1 className="flow__title">Choose your <span className="grad">plan</span></h1>
        <p className="flow__sub">Your full membership will start only after your free 7‑day trial period concludes. No charges will be made today.</p>
        <div className="plans">
          {(PLANS as any[]).map((p) => (
            <button
              key={p.id}
              className={'plan-card' + (p.id === sel ? ' sel' : '')}
              data-plan={p.id}
              onClick={() => setSel(p.id)}
            >
              {p.save ? <span className="plan-card__save">SAVE ${p.save}</span> : null}
              <span className="plan-card__wm"><span className="cur">$</span>{p.price}</span>
              <div className="plan-card__top"></div>
              <div><span className="plan-card__was">${p.was}</span><span className="plan-card__now">{p.label}</span></div>
              <div className="plan-card__desc">{p.desc}</div>
            </button>
          ))}
        </div>
        <a
          className="btn btn--dark btn--block"
          href="#/onboarding/payment"
          style={{ marginTop: 26, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Continue setting up your trial
        </a>
      </div>
    </>
  );
}

function PaymentStep() {
  const [pay, setPay] = useState('card');
  return (
    <>
      <Signout />
      <div className="flow__inner">
        <h1 className="flow__title">Secure your trial <span className="grad">access</span></h1>
        <p className="flow__sub">Your payment will only be processed after your 7‑day free trial. For peace of mind, we will remind you 24 hours in advance.</p>
        <div className="pay-methods">
          <button
            className={'pay-method' + (pay === 'card' ? ' sel' : '')}
            data-pay="card"
            onClick={() => setPay('card')}
          >
            <div className="pay-method__t">Credit card</div>
            <div className="pay-method__s">$30/mo after 7 days</div>
          </button>
          <button className="pay-method disabled" data-pay="applepay">
            <span className="pay-method__soon">Coming soon</span>
            <div className="pay-method__t"> Pay</div>
            <div className="pay-method__s">$30/mo after 7 days</div>
          </button>
        </div>
        <a className="btn btn--light btn--block" href="#/onboarding/card" style={{ maxWidth: 460, margin: '8px auto 0' }}>Continue</a>
      </div>
    </>
  );
}

function CardStep() {
  const auth = useAuth();
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    toast('Your 7‑day free trial has started 🎉');
    setTimeout(() => { location.hash = '#/onboarding/interests'; }, 900);  // → personalize
  };
  return (
    <>
      <Signout />
      <div className="flow__inner">
        <h1 className="flow__title">Payment <span className="grad">Method</span></h1>
        <p className="flow__sub">Your payment will only be processed after your 7‑day free trial. For peace of mind, we will remind you 24 hours in advance.</p>
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="field row"><div className="col"><label>Cardholder name</label><input defaultValue={auth.authenticated ? auth.name : 'Sam Lee'} /></div><Icon name="user" size={16} /></div>
          <div className="field row"><div className="col"><label>Card number</label><input defaultValue="4889 5080 3906 5149" /></div><span className="save-link"><Icon name="link" size={12} /> Save with <span style={{ color: '#5ad1c9' }}>link</span></span><b style={{ fontStyle: 'italic', color: 'var(--dim)', marginLeft: 8 }}>VISA</b></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field row" style={{ flex: 1 }}><div className="col"><label>Expiration date</label><input defaultValue="02 / 29" /></div><Icon name="card" size={15} /></div>
            <div className="field row" style={{ flex: 1 }}><div className="col"><label>CVC</label><input defaultValue="730" /></div><Icon name="list" size={15} /></div>
          </div>
          <p className="form-note">No charges will be made until your trial expires, and you are free to <b style={{ color: 'var(--text)' }}>cancel at any time</b>.</p>
          <button className="btn btn--light btn--block" data-start onClick={start}>Start your free trial</button>
        </form>
      </div>
    </>
  );
}

const STEPS: Record<string, () => JSX.Element> = {
  username: UsernameStep, path: PathStep, interests: InterestsStep,
  plan: PlanStep, payment: PaymentStep, card: CardStep,
};

export default function Onboarding() {
  const { step } = useParams();
  const Render = STEPS[step || 'username'] || UsernameStep;
  return (
    <div className="flow">
      <div className="referral__glow"></div>
      <Render />
    </div>
  );
}
