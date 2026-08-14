/* =========================================================================
   feedback — the "Send feedback" store (Fey-style composer). PERSISTS across
   navigation (unlike a dock occupant) so the user can visit several screens and
   attach each one as context. Mirrors tradeTicket.ts.
   ========================================================================= */
import { useSyncExternalStore } from 'react';
import { captureScreen, screenMeta, type ScreenCtx } from './screenctx';
import { sendFeedback } from './me.js';
import { track } from './analytics';

type FState = { open: boolean; text: string; screens: ScreenCtx[]; sending: boolean; done: boolean; nonce: number };
let state: FState = { open: false, text: '', screens: [], sending: false, done: false, nonce: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<FState>) => { state = { ...state, ...patch }; emit(); };

// attach `meta` instantly (chip shows at once), then upgrade it with the async thumbnail.
// The capture is ~2s async — if the user navigated away before it resolved, KEEP the
// metadata-only chip rather than pinning a thumbnail of the wrong screen onto it.
function attach(meta: ScreenCtx) {
  set({ screens: state.screens.filter((x) => x.path !== meta.path).concat(meta).slice(-6) });
  captureScreen().then((full) => {
    if (!state.open || !full.shot || (location.hash || '#/') !== meta.path) return;
    set({ screens: state.screens.map((x) => (x.ts === meta.ts && x.path === meta.path ? full : x)) });
  });
}

/** open the composer and auto-attach the screen the user is on right now */
export function openFeedback() {
  set({ open: true, text: '', screens: [], sending: false, done: false, nonce: state.nonce + 1 });
  attach(screenMeta());
}
/** attach the CURRENT screen (deduped by path so the same screen isn't added twice) */
export function addCurrentScreen() {
  if (state.open) attach(screenMeta());
}
export function removeScreen(i: number) { set({ screens: state.screens.filter((_, idx) => idx !== i) }); }
export function setText(v: string) { set({ text: v }); }
export function closeFeedback() { if (state.open) set({ open: false, nonce: state.nonce + 1 }); }

export async function submitFeedback() {
  const text = state.text.trim();
  if (!text || state.sending) return;
  const my = state.nonce;                      // tie this submit to THIS composer session
  set({ sending: true });
  try {
    await sendFeedback({ message: text, url: location.hash || '#/', screens: state.screens });
  } catch { /* the endpoint never hard-fails; thank the user regardless */ }
  track('feedback_submitted', {
    path: location.hash || '#/', screens_count: state.screens.length,
    has_shot: state.screens.some((s) => !!s.shot), message: text.slice(0, 500),
  });
  // the composer may have been closed + reopened while the request was in flight — a stale
  // resolution must NOT flip the fresh session into the thank-you state (nonce guards it)
  if (state.nonce !== my) return;
  set({ sending: false, done: true });
  window.setTimeout(() => { if (state.done && state.nonce === my) set({ open: false }); }, 2400);
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const getSnapshot = () => state;
export function useFeedback(): FState { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
