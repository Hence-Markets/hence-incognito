import { track } from '../lib/analytics';
import { useEffect, useRef, useState } from 'react';
import { useAsk, ask, stop, closeAsk, setMode, newChat, listThreads, loadThread, type AskTurn } from '../lib/assistant';
import { md } from '../lib/md';
import { PlanCard } from './PlanCard';
import { BacktestCard } from './BacktestCard';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { HenceSpinner } from './Loading';
import { openTrade } from '../lib/tradeTicket';
import { currentSymbol } from '../lib/screenctx';
// @ts-ignore — JS modules
import { getTicker } from '../lib/data.js';
// @ts-ignore — JS module
import * as market from '../lib/market.js';
// @ts-ignore — JS module
import { fmtPct, cls } from '../lib/ui.js';
import '../styles/assistant.css';

/* =========================================================================
   Ask Hence — the dock-integrated assistant. Three views, all thin readers
   of the assistant store:
     • dock  — a panel anchored to the bottom-centre that GROWS UP out of the
               dock, exactly where the ∴ dock input was.
     • side  — the same conversation pinned as a right-hand chat panel.
     • full  — the same conversation as a centred fullscreen takeover.
   Vercel-agent-inspired chrome: a Beta-labelled intro on the empty state,
   ROTATING screen-aware suggestions with ⌘1-3 accelerators, chat history
   (Recent chats), and a "may make mistakes" footer.
   ========================================================================= */

/* ---- rotating, screen-aware suggestions --------------------------------- */
const BASE_SUGGEST = [
  // The first slot is a BELIEF, not a question. The ask box's documented job is belief -> thesis
  // + legs (README), but every suggestion here used to be question-shaped, so nothing ever
  // showed a user that stating a view is valid input.
  'I think rate cuts are coming — what\'s the trade?',
  'What happened in markets today?',
  'Explain funding rates',
  "What's on the calendar this week?",
  'Where do I see my watchlist?',
  'How do I place a trade on Hence?',
  'Which assets are moving the most?',
];
function suggestionPool(): string[] {
  const sym = currentSymbol();
  const seg = (location.hash || '#/').split('/')[1] || '';
  const out: string[] = [];
  if (sym) out.push(`How is ${sym} doing today?`, `What's driving ${sym} right now?`, `When does ${sym} report earnings?`);
  if (seg.startsWith('screener')) out.push('Which perps have negative funding?', 'Show me the biggest movers');
  if (seg.startsWith('terminal')) out.push('What does open interest tell me?', 'How does a stop order work?');
  if (seg.startsWith('watchlist')) out.push('Summarize my watchlist today');
  return [...out, ...BASE_SUGGEST];
}
/** a rotating window of 3 suggestions (Vercel-style), advancing every 6s.
    The pool re-derives on NAVIGATION too, so a pinned panel never offers stale
    per-asset suggestions from the previous screen. */
function useSuggestions(active: boolean): string[] {
  const [off, setOff] = useState(0);
  const [pool, setPool] = useState<string[]>(() => suggestionPool());
  useEffect(() => {
    if (!active) return;
    setPool(suggestionPool());
    const onNav = () => setPool(suggestionPool());
    window.addEventListener('hashchange', onNav);
    const iv = window.setInterval(() => setOff((n) => n + 1), 6000);
    return () => { window.removeEventListener('hashchange', onNav); window.clearInterval(iv); };
  }, [active]);
  if (!pool.length) return [];
  return [0, 1, 2].map((i) => pool[(off + i) % pool.length]);
}

/* a stacked overlay that OWNS keyboard input while open (shared guard, incl. our history menu) */
const OVERLAY_SEL = '.cmdk-overlay, .sc-overlay, .modal, .acct-ov, .reader, .wl-drawer, .lgate';

export function Assistant() {
  const { mode } = useAsk();
  // Escape closes from anywhere while open (not only when the composer holds focus) — BUT a
  // stacked overlay (command palette, cheat-sheet, any modal) owns Escape first, so dismissing
  // one of those never also wipes a pinned side-panel conversation. Fullscreen Escape drops
  // to the side panel instead of closing outright (the thread survives).
  useEffect(() => {
    if (mode === 'closed') return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // stacked overlays own Escape — including our OWN Recent-chats dropdown (it closes itself)
      if (document.querySelector(OVERLAY_SEL + ', .ask-hist')) return;
      e.preventDefault();
      if (mode === 'full') setMode('side'); else closeAsk();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [mode]);
  if (mode === 'closed') return null;
  if (mode === 'side') return <AskSidePanel />;
  if (mode === 'full') return <AskFullPanel />;
  return <AskDockPanel />;
}


/* chat auto-scroll: a NEW QUESTION pins to the bottom (question + working line in view);
   when the ANSWER lands, the viewport anchors at the START of that turn so long answers
   read top-down instead of arriving pre-scrolled to their end. */
function useAskAutoScroll(bodyRef: React.RefObject<HTMLDivElement>) {
  const { turns, busy } = useAsk();
  const prevLoading = useRef(false);
  const prevLen = useRef(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const last = turns[turns.length - 1];
    const lastLoading = !!(last && last.loading);
    if (turns.length > prevLen.current) {
      el.scrollTop = el.scrollHeight;                       // just asked
    } else if (prevLoading.current && !lastLoading && turns.length) {
      const nodes = el.querySelectorAll('.ask-turn');       // answer landed → top of the turn
      const node = nodes[nodes.length - 1] as HTMLElement | undefined;
      if (node) el.scrollTop = Math.max(0, node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 10);
    }
    prevLen.current = turns.length;
    prevLoading.current = lastLoading;
  }, [turns, busy, bodyRef]);
}

/* ---- the bottom-anchored dock panel ------------------------------------- */
function AskDockPanel() {
  const { turns, busy } = useAsk();
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasThread = turns.length > 0;
  useAskAutoScroll(bodyRef);

  return (
    <div className="ask-dock-wrap">
      {hasThread && (
        <div className="ask-pop" role="dialog" aria-label="Ask Hence">
          <ActionBar mode="dock" />
          <div className="ask-pop__body" ref={bodyRef}>
            {turns.map((t, i) => <Turn key={i} t={t} onJump={jump} />)}
          </div>
        </div>
      )}
      {!hasThread && !busy && <SuggestList variant="dock" />}
      <Composer variant="dock" />
      <Disclaimer />
    </div>
  );
}

/* ---- the pinned right-hand side panel ----------------------------------- */
function AskSidePanel() {
  const { turns } = useAsk();
  const bodyRef = useRef<HTMLDivElement>(null);
  useAskAutoScroll(bodyRef);
  useEffect(() => { document.body.classList.add('ask-side-open'); return () => document.body.classList.remove('ask-side-open'); }, []);

  return (
    <aside className="ask-side" role="complementary" aria-label="Ask Hence">
      <PanelHead mode="side" />
      <div className="ask-side__body" ref={bodyRef}>
        {turns.length === 0 ? <EmptyIntro /> : turns.map((t, i) => <Turn key={i} t={t} onJump={jump} />)}
      </div>
      <Composer variant="side" />
      <Disclaimer />
    </aside>
  );
}

/* ---- the centred fullscreen takeover ------------------------------------ */
function AskFullPanel() {
  const { turns } = useAsk();
  const bodyRef = useRef<HTMLDivElement>(null);
  useAskAutoScroll(bodyRef);

  return (
    <div className="ask-full-wrap" role="dialog" aria-label="Ask Hence">
      <div className="ask-full-backdrop" onClick={() => setMode('side')} />
      <div className="ask-full">
        <PanelHead mode="full" />
        <div className="ask-full__body" ref={bodyRef}>
          {turns.length === 0 ? <EmptyIntro /> : turns.map((t, i) => <Turn key={i} t={t} onJump={jump} />)}
        </div>
        <Composer variant="full" />
        <Disclaimer />
      </div>
    </div>
  );
}

/* ---- shared pieces ------------------------------------------------------- */
// jumping to an internal route: navigation itself closes an ephemeral dock panel and drops
// fullscreen to the side panel (App's askOnNavigate); a pinned side panel stays put.
function jump(route: string) { location.hash = route; }

const relTime = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h' : Math.round(h / 24) + 'd';
};

/** Recent chats — the Vercel-style history dropdown. */
function HistoryMenu({ onClose }: { onClose: () => void }) {
  const threads = listThreads();
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.ask-hist, .ask-ibtn--hist')) onClose(); };
    // Escape closes JUST the dropdown (the assistant's Escape handler skips while .ask-hist is open)
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc, true); };
  }, [onClose]);
  return (
    <div className="ask-hist" role="menu" aria-label="Recent chats">
      <span className="ask-hist__k">RECENT CHATS</span>
      {threads.length === 0 ? (
        <span className="ask-hist__empty">Nothing yet — your conversations will appear here.</span>
      ) : threads.map((t) => (
        <button key={t.id} className="ask-hist__row" onClick={() => { loadThread(t.id); onClose(); }}>
          <span className="ask-hist__title">{t.title}</span>
          <span className="ask-hist__time">{relTime(t.ts)}</span>
        </button>
      ))}
    </div>
  );
}

/** header for the side + full panels: brand · Beta · new chat · history · fullscreen · close */
function PanelHead({ mode }: { mode: 'side' | 'full' }) {
  const [hist, setHist] = useState(false);
  return (
    <header className="ask-side__head">
      <span className="ask-mark" aria-hidden>∴</span>
      <span className="ask-side__title">Ask Hence</span>
      <span className="ask-beta">Beta</span>
      <span className="ask-pop__spacer" />
      <button className="ask-ibtn" title="New chat" aria-label="New chat" onClick={newChat}><Icon name="plus" size={15} /></button>
      <span style={{ position: 'relative' }}>
        <button className="ask-ibtn ask-ibtn--hist" title="Recent chats" aria-label="Recent chats" onClick={() => setHist((v) => !v)}><Icon name="clock" size={14} /></button>
        {hist && <HistoryMenu onClose={() => setHist(false)} />}
      </span>
      {mode === 'side' ? (
        <>
          <button className="ask-ibtn" title="Fullscreen" aria-label="Fullscreen" onClick={() => setMode('full')}><Icon name="expand" size={14} /></button>
          <button className="ask-ibtn" title="Move to bottom" aria-label="Move to bottom" onClick={() => setMode('dock')}><Icon name="sidebar" size={15} /></button>
        </>
      ) : (
        <button className="ask-ibtn" title="Exit fullscreen" aria-label="Exit fullscreen" onClick={() => setMode('side')}><Icon name="shrink" size={14} /></button>
      )}
      <button className="ask-ibtn" title="Close" aria-label="Close" onClick={closeAsk}><Icon name="close" size={15} /></button>
    </header>
  );
}

/** the Beta intro empty state (side + full) — brand, blurb, rotating suggestions. */
function EmptyIntro() {
  return (
    <div className="ask-empty">
      <span className="ask-intro-mark" aria-hidden>∴</span>
      <div className="ask-intro-t">Ask Hence <span className="ask-beta">Beta</span></div>
      <p className="ask-empty-h">I can help you understand the markets, your portfolio, and everything inside Hence. What do you need?</p>
      <SuggestList variant="panel" />
    </div>
  );
}

/** rotating suggestions with ⌘1-3 accelerators (fires only while the thread is empty). */
function SuggestList({ variant }: { variant: 'dock' | 'panel' }) {
  const { turns, busy } = useAsk();
  const active = turns.length === 0 && !busy;
  const sugg = useSuggestions(active);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = ['1', '2', '3'].indexOf(e.key);
      if (n === -1 || !sugg[n]) return;
      // a stacked overlay (palette, cheat-sheet, modal…) owns the keyboard — never submit
      // a suggestion invisibly underneath it
      if (document.querySelector(OVERLAY_SEL + ', .ask-hist')) return;
      e.preventDefault();
      ask(sugg[n]);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, sugg]);
  if (!active) return null;
  return (
    <div className={'ask-sugg' + (variant === 'panel' ? ' ask-sugg--col' : '')}>
      {sugg.map((s, i) => (
        <button key={s} className="ask-chip" onClick={() => ask(s)}>
          <span className="ask-chip__t">{s}</span>
          <kbd className="ask-chip__kbd">⌘{i + 1}</kbd>
        </button>
      ))}
    </div>
  );
}

function Disclaimer() {
  return <p className="ask-disclaim">Hence AI can make mistakes. Verify market data before trading.</p>;
}

function ActionBar({ mode }: { mode: 'dock' | 'side' }) {
  const { turns } = useAsk();
  const [hist, setHist] = useState(false);
  const last = [...turns].reverse().find((t) => t.a && !t.loading);
  const copy = () => { if (last?.a) navigator.clipboard?.writeText(last.a).catch(() => {}); };
  return (
    <header className="ask-pop__bar">
      <span className="ask-pop__brand"><span className="ask-mark ask-mark--sm" aria-hidden>∴</span><span className="ask-beta ask-beta--sm">Beta</span></span>
      <span className="ask-pop__spacer" />
      <button className="ask-ibtn" title="Copy answer" aria-label="Copy answer" onClick={copy} disabled={!last?.a}><Icon name="copy" size={14} /></button>
      {/* recent chats now reachable from the DOCK panel too (was side/full only) */}
      <span style={{ position: 'relative' }}>
        <button className="ask-ibtn ask-ibtn--hist" title="Recent chats" aria-label="Recent chats" onClick={() => setHist((v) => !v)}><Icon name="clock" size={14} /></button>
        {hist && <HistoryMenu onClose={() => setHist(false)} />}
      </span>
      <button className="ask-ibtn" title="New chat" aria-label="New chat" onClick={newChat}><Icon name="plus" size={15} /></button>
      <button className="ask-ibtn" title="Fullscreen" aria-label="Fullscreen" onClick={() => setMode('full')}><Icon name="expand" size={14} /></button>
      {mode === 'dock'
        ? <button className="ask-ibtn" title="Open in side panel" aria-label="Open in side panel" onClick={() => setMode('side')}><Icon name="sidebar" size={15} /></button>
        : <button className="ask-ibtn" title="Move to bottom" aria-label="Move to bottom" onClick={() => setMode('dock')}><Icon name="sidebar" size={15} /></button>}
      <button className="ask-ibtn" title="Close" aria-label="Close" onClick={closeAsk}><Icon name="close" size={15} /></button>
    </header>
  );
}

/* inline live asset widget — the answer's subject as a card: live quote + the three
   ways forward (asset page · quick trade ticket · full terminal) */
function AskAssetCard({ sym, onJump }: { sym: string; onJump: (r: string) => void }) {
  const { mode } = useAsk();
  const t = getTicker(sym);
  const real = !!(t as any).real;
  // the dock panel and the trade ticket share the bottom-centre slot — swap them; FULLSCREEN
  // drops to the side (its z-80 backdrop would bury the z-61 ticket); a PINNED side panel
  // stays open (the thread must survive placing a trade)
  const trade = () => {
    if (mode === 'dock') closeAsk();
    else if (mode === 'full') setMode('side');
    openTrade(sym);
  };
  return (
    <div className="ask-asset">
      <Logo sym={sym} size={26} />
      <div className="ask-asset__id">
        <b>{sym}</b>
        <span>{t.name || sym}</span>
      </div>
      {real && t.price != null ? (
        <span className="ask-asset__px">
          <b>{market.fmtPrice(t.price)}</b>
          <span className={cls(t.chgPct)}>{fmtPct(t.chgPct)}</span>
        </span>
      ) : null}
      <div className="ask-asset__acts">
        <button onClick={() => onJump(`#/stock/${sym}`)}>Open</button>
        <button onClick={trade}>Trade</button>
        <button onClick={() => onJump(`#/terminal/${sym}`)}>Terminal</button>
      </div>
    </div>
  );
}

function Turn({ t, onJump }: { t: AskTurn; onJump: (r: string) => void }) {
  return (
    <div className="ask-turn">
      <div className="ask-q">{t.q}</div>
      <div className="ask-a">
        {t.loading ? <ProgressLine /> : (
          <>
            <div className={'ask-a-txt' + (t.error ? ' err' : '') + (t.degraded ? ' degraded' : '')}>{t.error ? t.a : md(t.a || '', { symbols: t.symbols, researchSyms: t.research })}</div>
            {/* A degraded answer is a failure wearing an answer's clothes. Say so, and give the
                one-tap recovery — the incident that prompted this was transient, so a single
                retry would have produced a real answer instead of a dead-end route match. */}
            {t.degraded && !t.error ? (
              <div className="ask-degraded">
                <Icon name="info" size={12} />
                <span>Couldn't reach the model — this is a quick route match.</span>
                <button className="ask-degraded__retry" onClick={() => ask(t.q)}>Try again</button>
              </div>
            ) : null}
            {t.plan ? <PlanCard plan={t.plan} traceId={t.planTraceId} /> : null}
            {t.backtest ? <BacktestCard result={t.backtest} /> : null}
            {t.widget && !t.plan && !(t.symbols && t.symbols.length) ? <AskAssetCard sym={t.widget} onJump={onJump} /> : null}
            {t.actions && t.actions.length ? (
              <div className="ask-actions">
                {t.actions.map((a, j) => (
                  <button key={j} className="ask-jump" onClick={() => onJump(a.route)}>
                    <span>{a.label}</span><Icon name="arrowRight" size={13} />
                  </button>
                ))}
              </div>
            ) : null}
            {t.links && t.links.length ? (
              <div className="ask-links">
                {t.links.map((l, j) => (
                  <a key={j} className="ask-link" href={l.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="link" size={12} /><span>{l.label}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {t.followups && t.followups.length ? (
              // conversion bridges: one tap continues the conversation toward something
              // executable (research answer → tradeable plan → armed ticket)
              <div className="ask-followups">
                {t.followups.map((f, j) => (
                  <FollowupChip key={j} label={f.label} query={f.query} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* conversion follow-up: one tap asks the canned continuation in the SAME thread
   (multi-turn memory carries the theme — research answer → tradeable plan). */
function FollowupChip({ label, query }: { label: string; query: string }) {
  // conversion chips are the research→executable bridge — measure their pull
  const { busy } = useAsk();
  return (
    <button className="ask-followup" disabled={busy} onClick={() => { track('followup_clicked', { label }); ask(query); }}>
      <Icon name="bolt" size={12} /><span>{label}</span>
    </button>
  );
}

/* one transient activity line while the copilot works — the label swaps IN PLACE
   (keyed re-mount → micro-fade) instead of stacking a checklist into the chat.
   It disappears entirely when the answer lands. */
function ProgressLine() {
  const { phase } = useAsk();
  const label = phase || 'Thinking…';
  return (
    <div className="ask-progress">
      <HenceSpinner size={15} />
      <span key={label} className="ask-progress__label ask-shimmer">{label}</span>
      <button className="ask-progress__stop" onClick={stop} title="Stop" aria-label="Stop"><Icon name="stop" size={12} /></button>
    </div>
  );
}

function Composer({ variant }: { variant: 'dock' | 'side' | 'full' }) {
  const { busy, phase } = useAsk();
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 40); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!busy) { const t = setTimeout(() => ref.current?.focus(), 60); return () => clearTimeout(t); } }, [busy]);
  const submit = () => { const q = v.trim(); if (q && !busy) { ask(q); setV(''); } };
  // Enter submits; Escape is handled once by the document capture listener above (no dupe here)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  };
  const workingLabel = phase || 'Working…';
  return (
    <div className={'ask-composer ask-composer--' + variant + (busy ? ' is-working' : '')}>
      <span className="ask-composer__mark" aria-hidden>∴</span>
      <input ref={ref} className="ask-composer__field" value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={onKey} placeholder={busy ? '' : 'Ask Hence anything…'} aria-label="Ask Hence" disabled={busy} />
      {busy && (
        // the live activity, IN the input box (the Google-Docs-AI treatment): one shimmering
        // label that swaps in place as the copilot moves between checks
        <span className="ask-composer__working" aria-live="polite">
          <em key={workingLabel} className="ask-shimmer">{workingLabel}</em>
        </span>
      )}
      {busy
        ? <button className="ask-composer__send ask-composer__send--stop" onClick={stop} aria-label="Stop"><Icon name="stop" size={13} /></button>
        : <button className="ask-composer__send" onClick={submit} disabled={!v.trim()} aria-label="Send"><Icon name="send" size={15} /></button>}
    </div>
  );
}
