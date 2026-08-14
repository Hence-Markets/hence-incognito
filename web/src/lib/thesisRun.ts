/* =========================================================================
   thesisRun — the store behind the RUN THESIS sheet, mirroring tradeTicket.

   A thesis can be run from three places (the copilot's PlanCard, the Theses
   screen, the home thesis card), and the sheet is position:fixed. Rendering
   it inline from each caller risks an overflow-hidden ancestor clipping it,
   so — exactly like the dock trade ticket — one instance is mounted in the
   Shell and every caller summons it through this store.
   ========================================================================= */
import { useSyncExternalStore } from 'react';
import { track } from './analytics';

export type RunTarget = {
  /** the persisted thesis id, when the thesis is saved. Absent for an unsaved copilot plan. */
  id?: number | string | null;
  title: string;
  summary?: string;
  direction?: string;
  plan: any;
  /** where the run was launched from, for telemetry */
  source?: string;
  /** set when this thesis was ADOPTED from another user — running it credits them */
  originThesisId?: number | null;
  /** corpus: the agent trace that produced this plan, when it came from the copilot */
  traceId?: number | null;
  author?: { handle: string } | null;
};

type RState = { open: boolean; target: RunTarget | null; nonce: number };
let state: RState = { open: false, target: null, nonce: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openRun(target: RunTarget) {
  const legs = (target?.plan && target.plan.legs) || [];
  track('thesis_run_opened', { thesis_id: target?.id ?? null, legs: legs.length, source: target?.source || 'unknown' });
  state = { open: true, target, nonce: state.nonce + 1 };
  emit();
}
export function closeRun() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const getSnapshot = () => state;
export function useRun(): RState { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
