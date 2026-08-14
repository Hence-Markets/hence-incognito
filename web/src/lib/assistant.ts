/* =========================================================================
   assistant — the Ask Hence store. Owns the conversation thread, the display
   MODE (dock-anchored ▸ pinned side panel ▸ fullscreen), the live "working"
   phase, an abortable /api/navigate call, and the persisted CHAT HISTORY
   (localStorage ring of recent threads). Views are thin readers of this one
   store, so pinning to the side / going fullscreen keeps the thread.
   ========================================================================= */
import { track } from './analytics';
import { useSyncExternalStore } from 'react';
import { currentSymbol, screenLabel } from './screenctx';
import { agentStream } from './agentStream';

export type AskAction = { label: string; route: string };
export type AskLink = { label: string; url: string };
export type AskFollowup = { label: string; query: string };
export type AskTurn = {
  q: string; a?: string; actions?: AskAction[]; links?: AskLink[]; widget?: string;
  followups?: AskFollowup[];       // one-tap conversation continuations (conversion bridges)
  symbols?: string[];              // researched assets → inline chips in the answer text
  research?: string[];             // the research-only subset (chips avoid venue data — ticker collisions)
  plan?: any;                      // validated TradePlan (server-emitted) → PlanCard
  planTraceId?: number | null;     // corpus: the reasoning chain that produced the plan
  backtest?: any;                  // BacktestResult → BacktestCard
  loading?: boolean; error?: boolean;
  /** the server degraded to a keyword route match — not a real answer. Shown as such,
      excluded from Recent chats, and never fed back as conversation memory. */
  degraded?: boolean;
};
export type AskMode = 'closed' | 'dock' | 'side' | 'full';
export type AskThread = { id: string; title: string; ts: number; turns: AskTurn[] };

type AState = { mode: AskMode; turns: AskTurn[]; busy: boolean; phase: string; nonce: number; threadId: string | null };

let state: AState = { mode: 'closed', turns: [], busy: false, phase: '', nonce: 0, threadId: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<AState>) => { state = { ...state, ...patch }; emit(); };

/* ---- chat history (Vercel-agent-style Recent Chats) ---- */
const THREADS_KEY = 'hence.ask.threads';
const THREADS_MAX = 12;

export function listThreads(): AskThread[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREADS_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    // validate down to the TURN level — a corrupted entry (extension / divergent build)
    // must never crash the React tree when loaded back
    return v
      .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && Array.isArray(t.turns))
      .map((t) => ({ ...t, ts: typeof t.ts === 'number' ? t.ts : 0, turns: t.turns.filter((x: any) => x && typeof x.q === 'string') }))
      .filter((t) => t.turns.length > 0);
  } catch { return []; }
}

/** upsert the CURRENT thread into the history ring (called after every completed answer).
    Error turns are NOT persisted — a transient network failure must never occupy a
    history slot or replay a stale error forever. DEGRADED turns are excluded for the same
    reason: a keyword route match is a failure wearing an answer's clothes, and replaying it
    from history forever is worse than losing it. */
function persistThread() {
  try {
    const done = state.turns
      .filter((t) => t && !t.loading && !t.error && !t.degraded)
      // a backtest curve is down-sampled to 40 points before localStorage (quota safety)
      .map((t) => ({
        ...t,
        backtest: t.backtest && Array.isArray(t.backtest.curve)
          ? { ...t.backtest, curve: t.backtest.curve.filter((_: any, i: number, a: any[]) => i % Math.max(1, Math.ceil(a.length / 40)) === 0) }
          : t.backtest,
      }));
    if (!done.length || !state.threadId) return;
    const threads = listThreads().filter((t) => t.id !== state.threadId);
    threads.unshift({
      id: state.threadId,
      title: (done[0].q || 'Chat').slice(0, 64),
      ts: Date.now(),
      turns: done,
    });
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, THREADS_MAX)));
  } catch { /* storage disabled */ }
}

/** start a fresh conversation (keeps the panel open; the old thread stays in history). */
export function newChat() {
  if (ctrl) { ctrl.abort(); ctrl = null; }
  stopPhases();
  set({ turns: [], busy: false, phase: '', threadId: null, nonce: state.nonce + 1 });
}

/** reopen a past conversation from the history ring. */
export function loadThread(id: string) {
  const t = listThreads().find((x) => x.id === id);
  if (!t) return;
  if (ctrl) { ctrl.abort(); ctrl = null; }
  stopPhases();
  set({ turns: t.turns, threadId: t.id, busy: false, phase: '', nonce: state.nonce + 1 });
}

// Hence-flavoured working phases (cycle while the request is in flight) — this is the
// "Collecting info… / Summarizing…" progress the dock shows instead of a bare spinner.
const PHASES = ['Reading the request…', 'Searching Hence…', 'Checking the markets…', 'Summarizing…'];
let phaseTimer: ReturnType<typeof setInterval> | undefined;
let ctrl: AbortController | null = null;

// screen label / symbol context (shared with the feedback composer) → lib/screenctx.ts
function stopPhases() { if (phaseTimer) { clearInterval(phaseTimer); phaseTimer = undefined; } }
function runPhases() {
  stopPhases();
  let i = 0;
  set({ phase: PHASES[0] });
  phaseTimer = setInterval(() => { i = Math.min(i + 1, PHASES.length - 1); set({ phase: PHASES[i] }); }, 1200);
}

/** patch the in-flight turn in place (tool trace / streamed fields) without finishing it. */
function patchTurn(idx: number, patch: Partial<AskTurn>) {
  set({ turns: state.turns.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });
}

const sanitizeWidget = (w: any) => (/^[A-Z0-9.\-]{1,12}$/.test(String(w || '')) ? String(w) : undefined);

export function ask(query: string) {
  track('ask_submitted', { len: query.length });
  const q = query.trim();
  if (!q || state.busy) return;
  const turns = [...state.turns, { q, loading: true } as AskTurn];
  const idx = turns.length - 1;
  // first question of a fresh conversation mints its history id
  const threadId = state.threadId || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  set({ turns, busy: true, threadId });
  runPhases();
  ctrl = new AbortController();
  const context = { path: location.hash || '#/', symbol: currentSymbol(), screen: screenLabel() };
  // multi-turn memory: the copilot sees the last 6 completed exchanges of this thread
  const history = state.turns
    .filter((t) => t.a && !t.error && !t.loading && !t.degraded)
    .slice(-6)
    .map((t) => ({ q: t.q.slice(0, 280), a: (t.a || '').slice(0, 700) }));

  /* One AUTOMATIC second attempt before any failure is shown. The transient-failure
     window that produces `model-failed` (a rate-limit burst, an upstream blip) is usually
     shorter than the time a human takes to read the degraded banner and press the button —
     so the machine presses it. Exactly once: a second consecutive failure means the model
     is genuinely down, and re-hammering it helps nobody. */
  let attempts = 0;
  const attempt = () => {
    attempts += 1;
    ctrl = new AbortController();
    const retryable = () => attempts < 2 && state.turns[idx] && !state.turns[idx].a;
    const retry = (reason: string) => {
      track('ask_auto_retry', { reason });
      set({ phase: 'Retrying…' });
      setTimeout(() => { if (retryable()) attempt(); }, 1200);
    };
    agentStream(
      // hence.elfaSocial='1' opts THIS BROWSER into the Elfa A/B cohort: same copilot,
      // one extra social-attention tool. Team-only comparison flag — costs credits.
      { query: q, context, history, social: (() => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } })() },
      (e) => {
        // one IN-PLACE activity label (the Google-Docs-AI treatment): phases and tool labels
        // swap in the same slot — rendered in the composer + a single chat line, never a list.
        if (e.type === 'phase') { stopPhases(); set({ phase: e.label }); }
        else if (e.type === 'tool') {
          stopPhases();
          if (e.status === 'run') set({ phase: e.label });
        } else if (e.type === 'plan') { patchTurn(idx, { plan: e.plan, planTraceId: e.trace_id ?? null }); track('plan_generated', { legs: (e.plan?.legs || []).length }); }
        else if (e.type === 'backtest') { patchTurn(idx, { backtest: e.result }); track('backtest_run', { source: 'copilot' }); }
        else if (e.type === 'answer') {
          // `fallback: true` means the server degraded to a keyword route match. It used to be
          // dropped here, so a degraded answer rendered identically to a real one — no signal,
          // no retry, and it was persisted to Recent chats as though it had worked.
          if (e.fallback && e.reason === 'model-failed' && retryable()) { retry('model-failed'); return; }
          if (e.fallback) track('ask_degraded', { source: 'agent', reason: e.reason || 'unknown' });
          finish(idx, { degraded: !!e.fallback, a: e.text || 'No answer.', actions: e.actions || [], links: e.links || [], widget: sanitizeWidget(e.widget), followups: (e.followups || []).filter((f: any) => f && typeof f.label === 'string' && typeof f.query === 'string').slice(0, 2), symbols: (e.symbols || []).filter((s: any) => /^[A-Z0-9.\-]{1,12}$/.test(String(s))).slice(0, 8), research: (e.research || []).filter((s: any) => /^[A-Z0-9.\-]{1,12}$/.test(String(s))).slice(0, 8) });
        } else if (e.type === 'error' && e.message) {
          if (retryable()) { retry('stream-error'); return; }
          finish(idx, { a: e.message, error: true });
        }
      },
      { signal: ctrl.signal },
    )
      .then(({ gotAnswer }) => { if (!gotAnswer) throw new Error('no answer'); })
      .catch((e) => {
        if (e && e.name === 'AbortError') return;
        if (!state.turns[idx] || !state.turns[idx].loading) return;   // already finished
        if (retryable()) { retry('stream-dead'); return; }
        askViaNavigate(q, idx, context);                              // degraded mode: the old one-shot
      });
  };
  attempt();
}

/** fallback path — the original /api/navigate one-shot (kept verbatim so the assistant is
    never worse than before the copilot upgrade). */
function askViaNavigate(q: string, idx: number, context: any) {
  ctrl = new AbortController();
  fetch('/api/navigate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, context }),
    signal: ctrl.signal,
  })
    .then((r) => {
      // without this a 429/5xx body parses fine, has no `answer`, and lands as a completed
      // non-error turn reading "No answer." — the worst terminal state the panel can reach.
      if (!r.ok) throw new Error('navigate ' + r.status);
      return r.json();
    })
    .then((d) => {
      track('ask_degraded', { source: 'navigate', reason: d.heuristic ? 'heuristic' : 'agent-failed' });
      finish(idx, {
        degraded: true, a: d.answer || 'No answer.', actions: d.actions || [],
        links: d.links || [], widget: sanitizeWidget(d.widget),
      });
    })
    .catch((e) => { if (e && e.name === 'AbortError') return; finish(idx, { a: "I couldn't reach the assistant just now — try search (press /) instead.", error: true }); });
}

function finish(idx: number, patch: Partial<AskTurn>) {
  stopPhases(); ctrl = null;
  const turns = state.turns.map((t, i) => (i === idx ? { ...t, loading: false, ...patch } : t));
  set({ turns, busy: false, phase: '' });
  persistThread();   // every completed answer lands the thread in Recent chats
}

export function stop() {
  if (ctrl) { ctrl.abort(); ctrl = null; }
  stopPhases();
  set({ turns: state.turns.filter((t) => !t.loading), busy: false, phase: '' });   // drop the in-flight turn
}

/** open (or focus) the assistant in a mode, optionally running a seed query. */
export function openAsk(seed = '', mode: Exclude<AskMode, 'closed'> = 'dock') {
  set({ mode, nonce: state.nonce + 1 });
  if (seed) ask(seed);
}
export function toggleAsk() { if (state.mode === 'closed') openAsk('', 'dock'); else closeAsk(); }
export function setMode(mode: Exclude<AskMode, 'closed'>) { set({ mode }); }

/** fully close + reset the live thread (the ✕ action) — history keeps the persisted copy. */
export function closeAsk() {
  if (ctrl) { ctrl.abort(); ctrl = null; }
  stopPhases();
  state = { ...state, mode: 'closed', busy: false, phase: '', turns: [], threadId: null };
  emit();
}
export function clearThread() { set({ turns: [], threadId: null }); }

/** navigation hook: the dock-anchored panel is ephemeral (close it); fullscreen DROPS TO THE
    SIDE so the destination is visible but the thread survives; a pinned side panel persists. */
export function askOnNavigate() {
  if (state.mode === 'dock') closeAsk();
  else if (state.mode === 'full') setMode('side');
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const getSnapshot = () => state;
export function useAsk(): AState { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }

/* back-compat aliases (older call sites) */
export const openAssistant = (seed = '') => openAsk(seed, 'dock');
export const closeAssistant = closeAsk;
