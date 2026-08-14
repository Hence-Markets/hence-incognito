import { useEffect, useRef } from 'react';

/* =========================================================
   useTerminalLayout — the terminal shell's drag-to-resize panel behaviour,
   extracted so every terminal screen (perp Terminal, PredictTerminal, …) shares
   one workspace shell. Panel sizes live as CSS vars on the `.term` root, mutated
   directly during a pointer drag (no React re-render churn), persisted to
   localStorage on release. Double-click a handle resets that panel.

   Usage:
     const L = useTerminalLayout('hence.predictlayout.v1', PANELS);
     <div className="term" ref={L.termRef}> … {L.rsz('book','l')} … </div>
   ========================================================= */

export type PanelCfg = { v: string; def: number; min: number; max: number; sign: 1 | -1; axis: 'x' | 'y' };

export function useTerminalLayout(layoutKey: string, panels: Record<string, PanelCfg>) {
  const termRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<Record<string, number>>({});
  const extraRef = useRef<Record<string, any>>({});   // callers can persist extra flags (e.g. collapsed)

  // restore saved sizes on mount, applying them as CSS vars
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey) || '{}');
      for (const k of Object.keys(panels)) {
        const v = +saved[k];
        if (v >= panels[k].min && v <= panels[k].max) {
          sizesRef.current[k] = v;
          termRef.current?.style.setProperty(panels[k].v, v + 'px');
        }
      }
      for (const k of Object.keys(saved)) if (!(k in panels)) extraRef.current[k] = saved[k];
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (extra?: Record<string, any>) => {
    if (extra) Object.assign(extraRef.current, extra);
    try { localStorage.setItem(layoutKey, JSON.stringify({ ...sizesRef.current, ...extraRef.current })); } catch { /* noop */ }
  };
  const setVar = (cssVar: string, px: number) => termRef.current?.style.setProperty(cssVar, px + 'px');
  const getExtra = (k: string) => extraRef.current[k];

  const startResize = (key: string) => (e: React.PointerEvent) => {
    const c = panels[key]; const el = termRef.current;
    if (!c || !el) return;
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
      persist();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const resetVar = (key: string) => () => {
    delete sizesRef.current[key];
    termRef.current?.style.removeProperty(panels[key].v);
    persist();
  };

  const rsz = (key: string, side: 'l' | 'r' | 't') => (
    <span className={`term__rsz term__rsz--${side}`} title="Drag to resize · double-click to reset"
      onPointerDown={startResize(key)} onDoubleClick={resetVar(key)} />
  );

  return { termRef, rsz, setVar, getExtra, persist, sizesRef, panels };
}
