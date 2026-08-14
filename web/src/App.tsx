import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useMarketReady } from './hooks/useMarket';
import { useMe } from './hooks/useMe';
import { closeAllModals, toast } from './lib/ui.js';
import { openCommandPalette, goAnalyze } from './screens/command.js';
import { openAccounts } from './screens/accounts.js';
import { openShortcuts } from './lib/shortcuts';
import { Assistant } from './components/Assistant';
import { toggleAsk, askOnNavigate, openAsk } from './lib/assistant';
import { mainAppUrl } from './lib/mainApp';
import { capturePendingAskFromUrl, peekPendingAsk, clearPendingAsk } from './lib/pendingAsk';
import { capturePendingRefFromUrl } from './lib/pendingRef';
import { initAnalytics, trackPageview } from './lib/analytics';
import { useAuth } from './hooks/useAuth';
import { clearDockOccupant } from './lib/dockSlot';
import { PanelLoader } from './components/Loading';

import Dashboard from './screens/Dashboard'; // eager: home loads in the main chunk

// landing → copilot handoff: grab ?ask=… from the arriving URL at MODULE LOAD, before any
// login/router redirect can rewrite the hash (Login bounces authed users to #/ immediately).
capturePendingAskFromUrl();
capturePendingRefFromUrl();
initAnalytics();   // anonymous start (key + prior consent permitting) — identify happens on login

// every other screen is its own on-demand chunk (loaded on navigation)
const Terminal = lazy(() => import('./screens/Terminal'));
const Stock = lazy(() => import('./screens/Stock'));
const AnalystCoverage = lazy(() => import('./screens/AnalystCoverage'));
const Analysis = lazy(() => import('./screens/Analysis'));
const Economy = lazy(() => import('./screens/Economy'));
const Backtest = lazy(() => import('./screens/Backtest'));
const Theses = lazy(() => import('./screens/Theses'));
const Watchlist = lazy(() => import('./screens/Watchlist'));
const Screener = lazy(() => import('./screens/Screener'));
const Calendar = lazy(() => import('./screens/Calendar'));
const Compare = lazy(() => import('./screens/Compare'));
const Onboarding = lazy(() => import('./screens/Onboarding'));
const Welcome = lazy(() => import('./screens/Welcome'));
const Settings = lazy(() => import('./screens/Settings'));
const Preferences = lazy(() => import('./screens/Preferences'));
const Referral = lazy(() => import('./screens/Referral'));
const Profile = lazy(() => import('./screens/Profile'));
const Legal = lazy(() => import('./screens/Legal'));
const Login = lazy(() => import('./screens/Login'));
const ErrorScreen = lazy(() => import('./screens/ErrorScreen'));
const Signals = lazy(() => import('./screens/Signals'));
const Predict = lazy(() => import('./screens/Predict'));
const SignalSource = lazy(() => import('./screens/SignalSource'));
const SignalShow = lazy(() => import('./screens/SignalShow'));

// Shown while a lazy screen's JS chunk downloads on first navigation — a branded ∴ loader
// beats the old blank div (which read as a frozen app on a slow connection).
const RouteFallback = () => <PanelLoader className="route-fallback" size={34} fill />;

// Document-delegated section tabs + global keyboard + command/accounts overlays (ports app.js).
function GlobalBehaviors() {
  const loc = useLocation();
  // close any imperative overlays on navigation
  useEffect(() => {
    closeAllModals();
    askOnNavigate();       // close an ephemeral dock-anchored ask (a pinned side panel persists)
    clearDockOccupant();   // a stray inline/multiselect occupant must not survive into the next screen
    document.querySelectorAll('#modal-root > .reader, #modal-root > .cmdk-overlay, #modal-root > .wl-drawer, #modal-root > .docktour').forEach((el) => el.remove());
    document.body.classList.remove('cmdk-open', 'docktour-on');
    document.body.style.overflow = '';
  }, [loc.pathname]);

  useEffect(() => {
    const onClick = (e: any) => {
      const st = e.target.closest?.('[data-sectab]');
      if (!st) return;
      const scope = st.closest('.has-sectabs');
      if (!scope) return;
      const key = st.dataset.sectab;
      st.closest('.sectiontabs').querySelectorAll('[data-sectab]').forEach((x: any) => x.classList.toggle('on', x === st));
      scope.querySelectorAll('[data-sec]').forEach((s: any) => s.classList.toggle('is-active', s.dataset.sec === key));
    };
    // "G then X" go-to chords (mirror the dock destinations, Fey-style). Markets = the screener;
    // Analysis (a) is handled specially below via goAnalyze — contextual, else an asset picker.
    const GOTO: Record<string, () => string> = {
      h: () => '#/', t: () => '#/terminal/BTC', m: () => '#/screener',
      e: () => '#/economy', c: () => '#/calendar', s: () => '#/signals', w: () => '#/watchlist', p: () => '#/settings',
    };
    const toggleDock = () => {
      let hidden = false; try { hidden = localStorage.getItem('hence.hidedock') === '1'; } catch { /* noop */ }
      try { localStorage.setItem('hence.hidedock', hidden ? '0' : '1'); } catch { /* noop */ }
      window.dispatchEvent(new Event('hence:dockpref'));
    };
    let pendingG = false; let gTimer: number | undefined;
    const onKey = (e: any) => {
      const k = (e.key || '').toLowerCase();
      const inField = !!e.target?.matches?.('input, textarea, [contenteditable="true"]');
      // second key of a G-chord (comes first so G-then-W ≠ standalone W) — but NOT inside an
      // input, where a stray pending 'g' must never swallow the user's first typed character.
      if (pendingG) {
        if (inField) { pendingG = false; window.clearTimeout(gTimer); }   // a field keystroke ends the chord
        else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          pendingG = false; window.clearTimeout(gTimer);
          if (k === 'a') { e.preventDefault(); goAnalyze(); return; }        // G-A → analyze (contextual/picker)
          const dest = GOTO[k]; if (dest) { e.preventDefault(); location.hash = dest(); return; }
          // not a chord key → fall through and treat normally
        }
      }
      // In the terminal, ⌘K belongs to the market selector (the terminal registers its own
      // handler) — don't ALSO open the global command palette, or the two overlays stack.
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); if (!location.hash.startsWith('#/terminal')) openCommandPalette(); return; }
      if ((e.metaKey || e.ctrlKey) && k === 'j') { e.preventDefault(); toggleAsk(); return; }   // ⌘J → Ask Hence
      if (k === 'escape') { closeAllModals(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField) return;
      if (k === '?') { e.preventDefault(); openShortcuts(); return; }         // shift+/ → cheat-sheet
      if (k === '/') { e.preventDefault(); openCommandPalette({ search: true }); return; }   // / = securities search
      if (k === 'g') { pendingG = true; window.clearTimeout(gTimer); gTimer = window.setTimeout(() => { pendingG = false; }, 1300); e.preventDefault(); return; }
      if (k === 'q') { e.preventDefault(); toggleDock(); return; }
      if (k === '[' || k === ']') { window.dispatchEvent(new CustomEvent('hence:cyclerange', { detail: k === ']' ? 1 : -1 })); return; }
      if (k === 'w') { location.hash = '#/watchlist'; }
      else if (k === 'a') { e.preventDefault(); goAnalyze(); }
    };
    const onCmdk = () => openCommandPalette({ search: true });   // the dock search pod → securities search
    const onAccounts = (e: any) => openAccounts(e?.detail);   // optional { fund: 'arbitrum' } intent
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hence:cmdk', onCmdk);
    window.addEventListener('hence:accounts', onAccounts);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hence:cmdk', onCmdk);
      window.removeEventListener('hence:accounts', onAccounts);
    };
  }, []);
  // Once-ever: after the user has settled on the home screen, teach the "?" cheat-sheet.
  // Gated so it never fires mid-onboarding (pathname isn't '/' there) and never repeats.
  useEffect(() => {
    let seen = true; try { seen = localStorage.getItem('hence.coach.kb') === '1'; } catch { /* noop */ }
    if (seen) return;
    const t = window.setTimeout(() => {
      // only when truly settled on an unobstructed home — never behind the legal gate, the
      // assistant, the palette, onboarding tour, or any imperative modal (else the one-time
      // hint is silently consumed before the user has even entered the app).
      if (loc.pathname !== '/') return;
      if (document.querySelector('.cmdk-overlay, .sc-overlay, .ask-overlay, .lgate, .docktour, .modal, #modal-root > *')) return;
      try { localStorage.setItem('hence.coach.kb', '1'); } catch { /* noop */ }
      toast('Press ? anytime for keyboard shortcuts', { icon: 'bolt', duration: 4200 });
    }, 4500);
    return () => window.clearTimeout(t);
  }, [loc.pathname]);
  return null;
}

// Auth gate: the app is a signed-in product. Any route reached logged-out redirects to
// the login screen, remembering the destination so login drops you where you were going
// (shared deep links like #/stock/NVDA survive the round-trip). Public exceptions: the
// login screen itself, the legal docs (readable pre-acceptance), and the error screen.
function AuthGate() {
  const { ready, authenticated } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    if (!ready || authenticated) return;
    // dev-only escape so logged-out local verification can still reach app screens;
    // import.meta.env.DEV is compile-time false in prod builds (dead-code eliminated)
    if (import.meta.env.DEV) {
      try { if (sessionStorage.getItem('hence.devNoGate')) return; } catch { /* storage off */ }
    }
    const p = loc.pathname;
    // '/u/' is public on purpose: a shared profile link has to render for someone who
    // has never signed in, which is the whole point of it being shareable.
    if (p === '/login' || p.startsWith('/legal') || p.startsWith('/u/') || p === '/error') return;
    try {
      if (p !== '/') sessionStorage.setItem('hence.afterLogin', p + (loc.search || ''));
    } catch { /* storage off */ }
    location.hash = '#/login';
  }, [ready, authenticated, loc.pathname, loc.search]);
  return null;
}

// First-run gate: a signed-in user who hasn't onboarded yet is routed once into the v2
// flow (username → adaptive interests → welcome tour). 'onboarded' flips true server-side
// when interests are saved (or skipped), so this never nags an existing account.
function OnboardingGate() {
  const { me: profile } = useMe();
  const loc = useLocation();
  useEffect(() => {
    if (!profile) return;
    // Belt-and-suspenders against a re-trap loop: a local completion marker (set when the server
    // confirms onboarded) survives the brief window where a racing login-sync could still report
    // onboarded:false. Keyed by privy_id, so a different user on this browser still onboards.
    let localDone = false;
    try { localDone = localStorage.getItem('hence.onboarded') === profile.privy_id; } catch { /* storage off */ }
    if (profile.onboarded || localDone) return;
    const p = loc.pathname;
    // '/u/' too: a half-onboarded user following a shared profile link should land on the
    // profile, not be yanked into the username step.
    if (p.startsWith('/onboarding') || p.startsWith('/welcome') || p.startsWith('/u/') || p === '/login') return;
    location.hash = '#/onboarding/username';
  }, [profile, loc.pathname]);
  return null;
}

// old #/predict/:id links (belief cards, shared URLs) → the prediction terminal
function PredictRedirect() {
  const { id } = useParams();
  return <Navigate to={'/terminal/m/' + id} replace />;
}

// legacy per-tab asset pages (#/stock/:sym/insider etc, the pre-single-scroll layout) →
// the asset page itself, scrolled to the matching section. Deep links keep working;
// the old tabbed chrome is retired.
function StockTabRedirect() {
  const { sym, tab } = useParams();
  try { if (tab) sessionStorage.setItem('hence.stockSec', tab); } catch { /* storage off */ }
  return <Navigate to={'/stock/' + sym} replace />;
}

export default function App() {
  useMarketReady();            // kick market.init() once + re-render on ready
  // drop the boot splash once the app has actually mounted (reliable than a main.tsx rAF,
  // which can race the now-async render under the Privy/auth providers)
  useEffect(() => { document.getElementById('boot-splash')?.remove(); }, []);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('market:changes', on);
    const id = window.setInterval(on, 5000); // keep live tickers fresh app-wide
    return () => { window.removeEventListener('market:changes', on); window.clearInterval(id); };
  }, []);

  return (
    <HashRouter>
      <GlobalBehaviors />
      <AuthGate />
      <OnboardingGate />
      {/* Legal consent is collected by Privy at signup (its popup uses our own /legal Terms &
          Privacy URLs) and recorded server-side on login — no separate in-app gate. */}
      <Suspense fallback={<RouteFallback />}>
        <AnimatedRoutes />
      </Suspense>
      <Assistant />
      <PendingAskRunner />
      <PendingHandleRunner />
      <PageviewTracker />
    </HashRouter>
  );
}

/* landing → copilot handoff, step 2: once the user is SIGNED IN and clear of the
   login/onboarding/legal flows, open Hence AI on the dock with the belief they typed on
   the landing page — the thesis generates exactly once, always post-auth. */
// every hash-route change → a PostHog $pageview (no-op until key + consent)
function PageviewTracker() {
  const loc = useLocation();
  useEffect(() => { trackPageview(loc.pathname + (loc.search || '')); }, [loc.pathname, loc.search]);
  return null;
}

function PendingAskRunner() {
  const auth = useAuth();
  const loc = useLocation();
  useEffect(() => {
    if (!auth.ready || !auth.authenticated) return;
    if (['/login', '/onboarding'].some((b) => loc.pathname.startsWith(b))) return;
    if (!peekPendingAsk()) return;
    // poll briefly: the legal-consent gate (a blocking modal, not a route) must clear first
    const iv = window.setInterval(() => {
      if (document.querySelector('.lgate, .docktour')) return;
      window.clearInterval(iv);
      const q = peekPendingAsk();
      clearPendingAsk();
      if (q) openAsk(q, 'dock');
    }, 1200);
    return () => window.clearInterval(iv);
  }, [auth.ready, auth.authenticated, loc.pathname]);
  return null;
}

// A username claim that failed on a server hiccup (outage, 5xx) is stashed in
// localStorage by the onboarding step — re-claim it here once the API is back, so
// the user's chosen alias eventually sticks instead of silently defaulting away.
function PendingHandleRunner() {
  const { me: profile } = useMe();
  useEffect(() => {
    if (!profile) return;
    let want = '';
    try { want = localStorage.getItem('hence.pendingHandle') || ''; } catch { /* storage off */ }
    if (!want) return;
    if (profile.handle) { try { localStorage.removeItem('hence.pendingHandle'); } catch { /* storage off */ } return; }
    import('./lib/me.js').then((me: any) => me.setHandle(want)).then((r: any) => {
      // success, taken, or invalid all settle the intent; only hiccups keep it pending
      if (r?.ok || r?.me || r?.status === 409 || r?.status === 400) {
        try { localStorage.removeItem('hence.pendingHandle'); } catch { /* storage off */ }
      }
    }).catch(() => { /* still down — retried next profile refresh */ });
  }, [profile]);
  return null;
}

// Keyed by pathname so each navigation re-mounts the subtree → re-runs the
// .view-enter (viewIn: fade + 6px slide-up) page transition the migration dropped.
// (The key sits inside <Suspense>, so for lazy chunks the animation runs once the
// screen actually mounts, not on the loading fallback.)
/* Hand the visitor to the real app, on the same screen they asked for.
   A visible beat rather than a bare redirect: a window that navigates itself with no
   explanation reads as a hijack, and this one is crossing to a different domain. */
function LeaveToMain() {
  const location = useLocation();
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(mainAppUrl(location.pathname)), 550);
    return () => clearTimeout(t);
  }, [location.pathname]);
  return (
    <div className="inc__leave">
      <div className="inc__leave-card">
        <b>Leaving incognito</b>
        <p>That screen lives in the main Hence app. Taking you there…</p>
        <a href={mainAppUrl(location.pathname)}>Continue to app.hence.markets</a>
      </div>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  // The page-enter animation (viewIn: fade + 6px slide) is keyed so it replays on real
  // screen changes — but ALL /terminal/* paths share one key, so hopping between markets
  // or between perp↔prediction morphs the shell in place instead of sliding the whole page.
  const animKey = location.pathname.startsWith('/terminal') ? '/terminal' : location.pathname;
  return (
    <div className="view-enter" key={animKey}>
      {/* TWO SCREENS. Incognito is a fork of the entire Hence app, so every other route is
          still compiled in and every dock button still points at one — but rendering them here
          would serve a stale copy of the real product from a different deployment, silently
          diverging from app.hence.markets. Everything except the terminal leaves for the real
          app, carrying the same path, so Portfolio goes to Portfolio rather than to a
          lookalike nobody maintains. */}
      <Routes location={location}>
        <Route path="/terminal/*" element={<Terminal />} />
        <Route path="*" element={<LeaveToMain />} />
      </Routes>
    </div>
  );
}
