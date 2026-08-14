/* =========================================================================
   analytics — thin PostHog wrapper. DORMANT by default: it does nothing unless
   BOTH (a) VITE_POSTHOG_KEY is set at build time, AND (b) the user has logged in
   (Privy collects the Terms/Privacy/Cookie consent at signup → grantConsent()). So
   the feature ships with zero telemetry until a key is provided + consent given.
   Session replay is ON with money masked (see SESSION_RECORDING below).
   ========================================================================= */
import posthog from 'posthog-js';

// public client-side project key (same pattern as the Privy app id fallback in AuthProvider —
// web/.env is gitignored, so the CI/Docker build needs the literal to reach production builds)
const KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) || 'phc_aTmNUwA7ztsNYNXpkRDUCaEvZXB8SeHYUMOr1my6tnl';
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';
let started = false;

/* Session replay on a TRADING app. Replay is how UX problems get found — but a naive
   recording is a video of somebody's balances, positions and P&L. The masking contract:

   - every input is masked (posthog's default, restated here so it can't be lost in an
     upgrade): typed amounts, addresses, anything a user keys in;
   - anything wearing `.ph-mask` has its TEXT replaced with asterisks in the recording.
     Applied to the money surfaces — wallet chip, portfolio header, account cards, the
     positions tables — so the layout and interaction stay watchable while the figures
     do not leave the browser as readable text.

   A convention beats an enumeration here: new money UI opts in by adding one class,
   rather than silently leaking because a selector list went stale. */
const SESSION_RECORDING = {
  maskAllInputs: true,
  maskTextSelector: '.ph-mask, .ph-mask *',
} as const;

// Consent = the `hence.legal.v1` marker in localStorage. It's written on login now (Privy
// collects the Terms/Privacy consent at signup, and the Cookie & Telemetry policy is part of
// that bundle) — previously the in-app gate wrote it. Kept as a marker so this stays sync + offline-safe.
function consented(): boolean {
  try { return !!JSON.parse(localStorage.getItem('hence.legal.v1') || 'null'); } catch { return false; }
}

// A completed Privy login IS consent (its signup popup surfaces our own Terms + Privacy). Call
// this on login before initAnalytics so telemetry turns on. Idempotent; never overwrites.
export function grantConsent(did?: string | null) {
  try {
    if (localStorage.getItem('hence.legal.v1')) return;
    localStorage.setItem('hence.legal.v1', JSON.stringify({
      did: did || '', bundleVersion: 'hence-legal', acceptedAt: new Date().toISOString(), via: 'privy-login',
    }));
  } catch { /* storage disabled */ }
}

// The sign-in event usually happens BEFORE consent exists (fresh users see the legal
// gate after logging in), so a plain track() swallowed it — analytics showed fewer
// sign-ins than legal accepts. Park it here and flush once analytics actually starts.
let pendingSignin: Record<string, any> | null = null;
let signinSent = false;

/** Track the sign-in now if analytics is live, else park it for the post-consent flush. */
export function trackSignin(props?: Record<string, any>) {
  if (started) {
    if (!signinSent) { signinSent = true; try { posthog.capture('user_signed_in', props); } catch { /* noop */ } }
    return;
  }
  pendingSignin = props || {};
}

/** A real logout ends the session's sign-in dedupe so a re-login counts again. */
export function resetSigninTracking() { signinSent = false; pendingSignin = null; }

/** idempotent; safe to call on every auth change. No-op without a key or consent. */
export function initAnalytics(did?: string | null, person?: Record<string, any>) {
  if (!KEY || !consented()) return;
  if (!started) {
    try {
      // Route events through our own origin so ad blockers can't drop them: serve.py proxies
      // /ingest/* → PostHog. Only on the prod *.hence.markets hosts; localhost/preview hit
      // PostHog directly (the dev server doesn't proxy /ingest). ui_host keeps toolbar/links
      // pointing at the real PostHog UI.
      const onProd = typeof window !== 'undefined' && /(^|\.)hence\.markets$/i.test(window.location?.hostname || '');
      const apiHost = onProd ? window.location.origin + '/ingest' : HOST;
      posthog.init(KEY, {
        api_host: apiHost,
        ui_host: 'https://us.posthog.com',
        capture_pageview: false,        // hash-router SPA — we send our own events
        autocapture: false,
        disable_session_recording: false,
        session_recording: SESSION_RECORDING,
        // Unhandled exceptions as events. This session alone produced three bugs that were
        // invisible in prod until a user reported them (a serialization 500, an auth-less
        // agent stream, a dead payables query) — every one would have surfaced here.
        capture_exceptions: true,
        person_profiles: 'identified_only',
      });
      started = true;
    } catch { return; }
  }
  if (did) { try { posthog.identify(did, person); } catch { /* noop */ } }
  // consent may have just landed — emit the sign-in that happened pre-consent
  if (pendingSignin && !signinSent) {
    signinSent = true;
    const p = pendingSignin; pendingSignin = null;
    try { posthog.capture('user_signed_in', p); } catch { /* noop */ }
  }
}

export function track(event: string, props?: Record<string, any>) {
  if (!started) return;
  try { posthog.capture(event, props); } catch { /* noop */ }
}

/** SPA pageview (hash router — posthog's auto capture can't see route changes). */
export function trackPageview(path: string) {
  if (!started) return;
  try { posthog.capture('$pageview', { $current_url: location.origin + '/app/#' + path, path }); } catch { /* noop */ }
}
