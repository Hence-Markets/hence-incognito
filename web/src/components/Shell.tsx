import { useEffect, useRef, type ReactNode } from 'react';
import { toast } from '../lib/ui.js';
import { Dock } from './Dock';
import { MobileTabBar } from './MobileTabBar';
import { WalletChip } from './WalletChip';
import { TradeTicket } from './TradeTicket';
import { RunThesis } from './RunThesis';
import { FeedbackPanel } from './FeedbackPanel';
import { DockTourPill } from './DockTour';

// Reuses the vanilla dock + mobile tabbar markup (their #/… links work with HashRouter)
// and ports bindCommon's delegated wiring: [data-toast], the dock's accounts/search
// buttons (→ hence:accounts / hence:cmdk events, handled in App), and hover tooltips.
export function Shell({ children, dockActive = 'home' }: { children: ReactNode; dockActive?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let tip: HTMLDivElement | null = null;
    const onClick = (e: any) => {
      const tb = e.target.closest?.('[data-toast]');
      if (tb) { e.preventDefault(); toast(tb.dataset.toast, { ticker: tb.dataset.tk, icon: tb.dataset.ti }); return; }
      if (e.target.closest?.('[data-cmdk]')) { if (tip) tip.style.opacity = '0'; e.preventDefault(); window.dispatchEvent(new CustomEvent('hence:cmdk')); return; }
      if (e.target.closest?.('[data-accounts]')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('hence:accounts')); return; }
    };
    const ensureTip = () => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'dock-tip'; document.body.appendChild(tip); }
      return tip;
    };
    // place the body-tooltip above an element, centered, then clamp inside the viewport
    const place = (el: Element) => {
      const t = tip!;
      const r = el.getBoundingClientRect();
      t.style.opacity = '1';
      t.style.left = (r.left + r.width / 2) + 'px';
      t.style.top = (r.top - 10) + 'px';
      requestAnimationFrame(() => {
        const tr = t.getBoundingClientRect();
        let dx = 0;
        if (tr.left < 6) dx = 6 - tr.left;
        else if (tr.right > window.innerWidth - 6) dx = (window.innerWidth - 6) - tr.right;
        if (dx) t.style.left = (r.left + r.width / 2 + dx) + 'px';
      });
    };
    const hintsHidden = () => { try { return localStorage.getItem('hence.hidehints') === '1'; } catch { return false; } };
    const onOver = (e: any) => {
      const dk = e.target.closest?.('.dock__i[data-dtip], .dock__pod[data-dtip]');
      if (dk) {
        if (hintsHidden()) return;            // "Hide the navigation hints" suppresses dock tooltips
        ensureTip();
        const kb = (dk.dataset.dkb || '').split(' ').filter(Boolean).map((k: string) => `<kbd class="keycap">${k}</kbd>`).join(' ');
        tip!.innerHTML = `<span>${dk.dataset.dtip}</span>${kb ? `<span class="dock-tip__kb">${kb}</span>` : ''}`;
        place(dk);
        return;
      }
      const ti = e.target.closest?.('[data-tip]');
      if (ti) {
        ensureTip();
        tip!.textContent = ti.dataset.tip || '';
        place(ti);
      }
    };
    // hide-set MUST mirror onOver's show-set — the detached search pod (.dock__pod) carries
    // data-dtip but is NOT a .dock__i, so it was never cleared on mouseout and its tooltip stuck.
    const onOut = (e: any) => { if (e.target.closest?.('.dock__i, .dock__pod, [data-tip]') && tip) tip.style.opacity = '0'; };
    root.addEventListener('click', onClick);
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseout', onOut);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      tip?.remove();
    };
  }, []);

  return (
    <div className="app-chrome" ref={ref}>
      {children}
      <WalletChip />
      <TradeTicket />
      <RunThesis />
      <FeedbackPanel />
      <Dock active={dockActive} />
      <MobileTabBar />
      <DockTourPill />
    </div>
  );
}
