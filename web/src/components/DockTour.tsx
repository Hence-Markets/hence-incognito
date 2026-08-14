/* =========================================================
   DockTour — Fey-style coach-marks over the real bottom dock.
   A small "?" pill (rendered by Shell wherever the dock is) starts a
   step-through: dim the app, spotlight one dock item at a time, explain it
   with its keyboard chord. Imperative overlay in #modal-root (same pattern
   as the cmdk/modal layers); desktop-only — the dock itself is hidden on
   mobile. One-time nudge dot until first run (hence.docktour.v1).
   ========================================================= */
import { useState } from 'react';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';

const KEY = 'hence.docktour.v1';

// one line per dock item, keyed by its aria-label (the stable DOM anchor).
// Keep in sync with Dock.tsx NAV + the wallet button + the search pod.
const BLURBS: Record<string, string> = {
  'Home': 'Your AI-read morning — recap, feed and Today’s Setups, tuned to your universe.',
  'Trade': 'The perp terminal: charts, order book, and one-tap tickets.',
  'Discover': 'Economy dashboards — rates, breadth, and what the wider world is doing.',
  'Markets': 'The screener: every asset class side by side, with real filters and live data — prediction markets included.',
  'Watchlist': 'Everything you watch, your holdings, and the ideas you’ve saved.',
  'Analysis': 'AI research reports with every source attached — analyzes the asset you’re viewing, or pick one.',
  'Signals': 'Podcast trade calls, transcribed and scored on real returns.',
  'Settings': 'Profile, preferences — and Your algorithm.',
  'Wallet & accounts': 'Connect wallets, brokers and exchanges; deposits and balances live here.',
  'Search or ask Hence': 'The everything key: search any asset, drill into its actions, place a trade right here, or ask the AI. ⌘K opens page commands too.',
};

function markSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage disabled */ }
}
export function dockTourSeen(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return true; }
}

export function startDockTour() {
  const slot = document.querySelector('.dock-slot');
  const root = document.getElementById('modal-root');
  if (document.querySelector('.docktour')) return;
  // nav icons + wallet button + the detached search-or-ask pod (it sits OUTSIDE .dock)
  const items = slot && root
    ? ([...slot.querySelectorAll('.dock__i, .dock__pod')] as HTMLElement[]).filter((el) => el.getAttribute('aria-label'))
    : [];
  if (!items.length) {
    // the dock is hidden (Q / the Settings toggle) or occupied — say so instead of doing nothing
    toast('Show the navigation dock first — press Q or use Settings → "Hide the navigation dock".', { icon: 'compass' });
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'docktour';
  wrap.innerHTML =
    '<div class="docktour__backdrop"></div>' +
    '<div class="docktour__pop" role="dialog" aria-label="Dock tour">' +
    '  <div class="docktour__t"><span data-t></span><span class="docktour__kb" data-kb></span></div>' +
    '  <div class="docktour__b" data-b></div>' +
    '  <div class="docktour__foot">' +
    '    <span class="docktour__n" data-n></span>' +
    '    <button type="button" class="docktour__skip" data-skip>Skip</button>' +
    '    <button type="button" class="docktour__next" data-next>Next</button>' +
    '  </div>' +
    '</div>';
  root!.appendChild(wrap);
  document.body.classList.add('docktour-on');

  const pop = wrap.querySelector('.docktour__pop') as HTMLElement;
  const tEl = wrap.querySelector('[data-t]') as HTMLElement;
  const kbEl = wrap.querySelector('[data-kb]') as HTMLElement;
  const bEl = wrap.querySelector('[data-b]') as HTMLElement;
  const nEl = wrap.querySelector('[data-n]') as HTMLElement;
  const nextBtn = wrap.querySelector('[data-next]') as HTMLButtonElement;

  let i = 0;
  const clearFocus = () => items.forEach((el) => el.classList.remove('dt-focus'));
  const place = () => {
    const el = items[i];
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140);
    pop.style.left = x + 'px';
    pop.style.top = (r.top - 14) + 'px';
  };
  const show = (n: number) => {
    i = n;
    clearFocus();
    const el = items[i];
    el.classList.add('dt-focus');
    const label = el.getAttribute('aria-label') || '';
    tEl.textContent = label;
    const kb = el.getAttribute('data-dkb') || '';
    kbEl.innerHTML = kb ? kb.split(' ').map((k) => `<span>${k}</span>`).join('') : '';
    bEl.textContent = BLURBS[label] || '';
    nEl.textContent = `${i + 1} / ${items.length}`;
    nextBtn.textContent = i + 1 >= items.length ? 'Done' : 'Next';
    place();
  };
  const close = () => {
    markSeen();
    clearFocus();
    document.body.classList.remove('docktour-on');
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    wrap.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    // capture-phase so the app's global shortcuts don't fire underneath the tour
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      i + 1 >= items.length ? close() : show(i + 1);
    } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); show(i - 1); }
  };

  nextBtn.addEventListener('click', () => (i + 1 >= items.length ? close() : show(i + 1)));
  (wrap.querySelector('[data-skip]') as HTMLElement).addEventListener('click', close);
  (wrap.querySelector('.docktour__backdrop') as HTMLElement).addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);

  show(0);
  requestAnimationFrame(() => wrap.classList.add('in'));
}

/* the "?" pill Shell renders next to the dock; peach dot until the tour has run once */
export function DockTourPill() {
  const [seen, setSeen] = useState(dockTourSeen);
  return (
    <button
      type="button"
      className={'docktour-pill' + (seen ? '' : ' is-new')}
      aria-label="Learn the dock"
      title="Learn the dock"
      onClick={() => { setSeen(true); startDockTour(); }}
    >?</button>
  );
}
