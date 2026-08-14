/* =========================================================
   ChipMenu — a small fixed-position popover opened when a
   `.tk-chip` (ticker entity chip) is clicked in the recap.
   Rendered imperatively into #modal-root (like openReader),
   so it works both inside React feed cards and the imperative
   reader overlay. Header = logo · sym · name · live price · pct,
   then three quiet rows: Trade / Watch / Save.
   ========================================================= */
// @ts-ignore — JS module without types
import { getTicker } from '../lib/data.js';
// @ts-ignore — JS module without types
import { coinFor, fmtPrice } from '../lib/market.js';
// @ts-ignore — JS module without types
import { logo, icon, fmtPct, cls, toast } from '../lib/ui.js';
import { toggleWatch } from './MarketSelect';
import * as stash from '../lib/stash';
// @ts-ignore — JS module without types
import { escapeHtml, safeSymbol } from '../lib/safe-html.js';

let openEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

function closeChipMenu() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (openEl) { const el = openEl; openEl = null; el.classList.remove('in'); setTimeout(() => el.remove(), 150); }
}

export function openChipMenu(sym: string, anchorRect: DOMRect | { left: number; top: number; bottom: number; right: number; width: number }) {
  const s = safeSymbol(sym);
  if (!s) return;
  const root = document.getElementById('modal-root');
  if (!root) return;
  closeChipMenu(); // only one at a time

  const t = getTicker(s) || {};
  const dir = cls(t.chgPct || 0);
  const isCrypto = (() => { const c = coinFor(s); return !!(c && c !== s) || (t.world === 'crypto'); })();
  const tradeHref = isCrypto ? `#/terminal/${s}` : `#/stock/${s}`;

  const menu = document.createElement('div');
  menu.className = 'tk-menu';
  menu.innerHTML = `
    <button class="tk-menu__h" data-tk-act="open" title="View ${escapeHtml(s)} asset page">
      ${logo(s, 22)}
      <span class="tk-menu__id"><b>${escapeHtml(s)}</b><small>${escapeHtml(t.name || s)}</small></span>
      <span class="tk-menu__val"><span class="tk-menu__px">${fmtPrice(t.price)}</span><span class="pill ${dir}">${fmtPct(t.chgPct || 0)}</span></span>
      <span class="tk-menu__go">${icon('chevR', 13)}</span>
    </button>
    <button class="tk-menu__row" data-tk-act="trade">${icon('candles', 14)}<span class="tk-menu__lb">Trade<small>${isCrypto ? 'Open the perp terminal' : 'Open the stock page'}</small></span></button>
    <button class="tk-menu__row" data-tk-act="watch">${icon('bookmark', 14)}<span class="tk-menu__lb">Watch<small>Follow in your watchlist</small></span></button>
    <button class="tk-menu__row" data-tk-act="save">${icon('plus', 14)}<span class="tk-menu__lb">Save<small>Stash as thesis evidence</small></span></button>
  `;
  root.appendChild(menu);
  openEl = menu;

  // position: below-left of the anchor, clamped into the viewport. The clamp uses the
  // MEASURED width — the old hardcoded W=200 under-read the real menu (~320px with the
  // price column), so chips near the right edge pushed it off-screen on phones.
  const place = () => {
    const W = menu.offsetWidth || 200, H = menu.offsetHeight || 150;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (left < 8) left = 8;
    if (top + H > window.innerHeight - 8) top = anchorRect.top - H - 6; // flip above
    if (top < 8) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  };
  place();
  requestAnimationFrame(() => { place(); menu.classList.add('in'); });

  const onAct = (e: any) => {
    const btn = e.target.closest?.('[data-tk-act]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const act = btn.dataset.tkAct;
    if (act === 'open') { location.hash = `#/stock/${s}`; }   // header tap → the asset page
    else if (act === 'trade') { location.hash = tradeHref; }
    else if (act === 'watch') { const on = toggleWatch(s); toast(on ? `Added ${s} to watchlist` : `Removed ${s} from watchlist`, { ticker: s }); }
    else if (act === 'save') {
      stash.record({ kind: 'save', subject_type: 'asset', symbol: s, symbols: [s], title: t.name || s, source: '' });
      toast(`Saved · ${s}`, { ticker: s });
    }
    closeChipMenu();
  };
  menu.addEventListener('click', onAct);

  const onOutside = (e: any) => { if (openEl && !openEl.contains(e.target)) closeChipMenu(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeChipMenu(); };
  const onScroll = () => closeChipMenu();
  // defer outside-click binding a tick so the opening click doesn't immediately close it
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
  }, 0);
  cleanup = () => {
    menu.removeEventListener('click', onAct);
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
  };
}
