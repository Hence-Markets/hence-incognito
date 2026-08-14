import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useDockOccupant, clearDockOccupant, type DockOccupant, type DockAction } from '../lib/dockSlot';
import { useAsk } from '../lib/assistant';
import { useTrade } from '../lib/tradeTicket';
import { useFeedback } from '../lib/feedback';
import { goAnalyze } from '../screens/command.js';

/* =========================================================================
   Dock — the floating bottom-centre navigation, reworked as the Fey-style
   state machine (see dock-navigation-spec memory). It renders whichever
   occupant owns the shared slot; by default that's the nav pill + a DETACHED
   search circle. On a single-asset drill-in the pill goes NEUTRAL (no active
   icon). Hover tooltips + ⌘K/search wiring are delegated by <Shell>.
   ========================================================================= */

// current nav item set. Markets = the screener (browse everything) — a top-level icon must never
// dump the user on one hardcoded stock. Analysis is CONTEXTUAL (see goAnalyze): it analyzes the
// asset in view, and off an asset opens an "Analyze an asset" picker — never a guessed recent.
const NAV: { ic: string; key: string; href?: string | (() => string); tip: string; kb: string }[] = [
  { ic: 'home', key: 'home', href: '#/', tip: 'Home', kb: 'G H' },
  { ic: 'candles', key: 'trade', href: '#/terminal/BTC', tip: 'Trade', kb: 'G T' },
  { ic: 'compass', key: 'discover', href: '#/economy', tip: 'Discover', kb: 'G E' },
  { ic: 'chart', key: 'markets', href: '#/screener', tip: 'Markets', kb: 'G M' },
  { ic: 'bookmark', key: 'portfolio', href: '#/portfolio', tip: 'Portfolio', kb: 'W' },
  { ic: 'doc', key: 'analysis', tip: 'Analysis', kb: 'A' },   // no href → button, handled by goAnalyze
  { ic: 'bolt', key: 'signals', href: '#/signals', tip: 'Signals', kb: 'G S' },
  { ic: 'settings', key: 'settings', href: '#/settings', tip: 'Settings', kb: 'G P' },
];

// Single-asset drill-ins where Fey shows the dock NEUTRAL (no icon lit) — you're
// "off" the top-level tabs even though a section icon points at a default asset.
// Matches react-router pathname (HashRouter puts the route in pathname, not hash).
const NEUTRAL_RE = /^\/(stock|analysis|analyst)\/[^/]|^\/signals\/(show|source)\//;

// respect the user setting (Fey: "Hide the navigation dock")
function dockHidden() {
  try { return localStorage.getItem('hence.hidedock') === '1'; } catch { return false; }
}

export function Dock({ active = 'home' }: { active?: string }) {
  const loc = useLocation();
  const occupant = useDockOccupant();
  const ask = useAsk();
  const trade = useTrade();
  const feedback = useFeedback();
  const [hidden, setHidden] = useState(dockHidden);

  // react to the hide-dock toggle (Settings dispatches this)
  useEffect(() => {
    const on = () => setHidden(dockHidden());
    window.addEventListener('hence:dockpref', on);
    return () => window.removeEventListener('hence:dockpref', on);
  }, []);

  const neutral = NEUTRAL_RE.test(loc.pathname || '');

  // the dock-anchored Ask panel (or its fullscreen takeover), the Trade ticket, and the Feedback
  // composer each own the stage, so the nav pill steps aside while one is open.
  if (ask.mode === 'dock' || ask.mode === 'full' || trade.open || feedback.open) return null;

  // an occupant owns the slot → render it instead of the nav pill. This is checked BEFORE the
  // hide setting: "Hide the navigation dock" suppresses the nav pill, but a transient action bar
  // (multiselect / inline / toggle) must still appear, or bulk actions become unreachable.
  if (occupant) return <div className="dock-slot"><DockOccupantView occupant={occupant} /></div>;

  if (hidden) return null;

  return (
    <div className="dock-slot">
      <nav className="dock" aria-label="Primary">
        {NAV.map((it) => (
          it.href == null
            ? <button key={it.key} type="button" className={'dock__i' + (!neutral && it.key === active ? ' on' : '')}
                onClick={goAnalyze} aria-label={it.tip} data-dtip={it.tip} data-dkb={it.kb}>
                <Icon name={it.ic} size={17} />
              </button>
            : <a key={it.key} className={'dock__i' + (!neutral && it.key === active ? ' on' : '')}
                href={typeof it.href === 'function' ? it.href() : it.href} aria-label={it.tip} data-dtip={it.tip} data-dkb={it.kb}>
                <Icon name={it.ic} size={17} />
              </a>
        ))}
        <span className="dock__sep" />
        {/* wallet & accounts (opens the accounts sheet via Shell's [data-accounts] handler) */}
        <button className="dock__i" data-accounts aria-label="Wallet & accounts" data-dtip="Wallet & accounts">
          <Icon name="wallet" size={17} />
        </button>
      </nav>
      {/* detached search-or-ask circle — opens the command menu (search + "Ask Hence") */}
      <button className="dock__pod" data-cmdk aria-label="Search or ask Hence" data-dtip="Search or ask Hence" data-dkb="/">
        <Icon name="search" size={17} />
      </button>
    </div>
  );
}

/* ---- the swappable occupants ---------------------------------------------- */
function DockOccupantView({ occupant }: { occupant: NonNullable<DockOccupant> }) {
  if (occupant.kind === 'node') return <>{occupant.node}</>;
  if (occupant.kind === 'multiselect') return <MultiSelectBar o={occupant} />;
  if (occupant.kind === 'toggle') return <TogglePill o={occupant} />;
  // keyed by title so swapping composers (Feedback → Referral) REMOUNTS the field —
  // the typed draft must never leak from one composer into the other
  if (occupant.kind === 'inline') return <InlineCommand key={occupant.title} o={occupant} />;
  return null;
}

function MultiSelectBar({ o }: { o: Extract<DockOccupant, { kind: 'multiselect' }> }) {
  return (
    <div className="dock-occ dock-occ--multi" role="toolbar">
      <button className="dock-occ__count" onClick={o.onClear} title="Clear selection">
        <span>{o.count} {o.noun || 'selected'}</span>
      </button>
      {o.actions.map((a: DockAction, i) => (
        <button key={i} className={'dock-occ__act' + (a.danger ? ' danger' : '')} onClick={a.onClick}>
          {a.icon ? <Icon name={a.icon} size={13} /> : null}{a.label}
        </button>
      ))}
    </div>
  );
}

function TogglePill({ o }: { o: Extract<DockOccupant, { kind: 'toggle' }> }) {
  return (
    <div className="dock-occ dock-occ--toggle">
      {o.lead ? <span className="dock-occ__lead">{o.lead}</span> : null}
      <div className="dock-occ__seg">
        {o.options.map((opt) => (
          <button key={opt.key} className={opt.key === o.value ? 'on' : ''} onClick={() => o.onChange(opt.key)}>{opt.label}</button>
        ))}
      </div>
      {o.trailing}
    </div>
  );
}

function InlineCommand({ o }: { o: Extract<DockOccupant, { kind: 'inline' }> }) {
  const [v, setV] = useState(o.value || '');
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);
  const submit = () => { if (v.trim()) o.onSubmit(v.trim()); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); o.onCancel(); }
    else if (e.key === 'Enter' && !(o.multiline && e.shiftKey)) { e.preventDefault(); submit(); }
  };
  return (
    <div className="dock-occ dock-occ--inline">
      <span className="dock-occ__title">{o.title}</span>
      {o.multiline
        ? <textarea ref={ref as any} className="dock-occ__field" rows={1} placeholder={o.placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} />
        : <input ref={ref as any} className="dock-occ__field" placeholder={o.placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} />}
      <span className="dock-occ__hints">
        {o.extra ? <button className="dock-occ__act" onClick={o.extra.onClick}>{o.extra.icon ? <Icon name={o.extra.icon} size={12} /> : null}{o.extra.label}</button> : null}
        <button className="dock-occ__submit" onClick={submit}>{o.submitLabel || 'Send'} <kbd>⏎</kbd></button>
        <button className="dock-occ__cancel" onClick={o.onCancel}>esc</button>
      </span>
    </div>
  );
}

// convenience: clear the slot on unmount for the current owner
export { clearDockOccupant };
