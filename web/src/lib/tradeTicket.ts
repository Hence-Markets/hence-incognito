/* =========================================================================
   tradeTicket — a tiny store for the dock TRADE TICKET (a beyond-Fey surface:
   place a Hyperliquid perp order right from the dock, without leaving the page).
   Any surface (command menu "Trade SYM", the AI, an asset page) can summon it.

   Copilot additions: `openTrade` accepts ArmOpts (usd/otype/limit/lev) so a plan
   leg can pre-fill the quick ticket, and `armTicket`/`consumeArm` is a one-shot
   handoff into the FULL terminal (PerpBody consumes it exactly once on mount —
   deliberately NOT URL params: terminal routes are bookmarkable, and order state
   replaying on every revisit would be wrong). Arming only SEEDS inputs; every
   confirm/sign gate is untouched — the user still reviews and signs.
   ========================================================================= */
import { track } from './analytics';
import { useSyncExternalStore } from 'react';

export type ArmOpts = { usd?: number; lev?: number; otype?: 'Market' | 'Limit'; limit?: number };

type TState = { open: boolean; sym: string; side: 'Long' | 'Short'; opts?: ArmOpts; nonce: number };
let state: TState = { open: false, sym: '', side: 'Long', nonce: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const cleanOpts = (o?: ArmOpts): ArmOpts | undefined => {
  if (!o) return undefined;
  const out: ArmOpts = {};
  if (Number.isFinite(o.usd) && o.usd! > 0) out.usd = Math.min(o.usd!, 1_000_000);
  if (Number.isFinite(o.lev) && o.lev! >= 1) out.lev = Math.min(Math.round(o.lev!), 100);
  if (o.otype === 'Market' || o.otype === 'Limit') out.otype = o.otype;
  if (Number.isFinite(o.limit) && o.limit! > 0) out.limit = o.limit;
  return Object.keys(out).length ? out : undefined;
};

export function openTrade(sym: string, side: 'Long' | 'Short' = 'Long', opts?: ArmOpts) {
  track('trade_ticket_opened', { sym, side });
  state = { open: true, sym: String(sym || '').toUpperCase(), side, opts: cleanOpts(opts), nonce: state.nonce + 1 };
  emit();
}
export function closeTrade() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

/* ---- one-shot terminal arm (plan leg → full terminal ticket) ---- */
const ARM_TTL_MS = 60_000;
let arm: { sym: string; side: 'Long' | 'Short'; opts: ArmOpts; ts: number } | null = null;

export function armTicket(sym: string, side: 'Long' | 'Short', opts?: ArmOpts) {
  track('plan_leg_armed', { sym, side });
  arm = { sym: String(sym || '').toUpperCase(), side, opts: cleanOpts(opts) || {}, ts: Date.now() };
}
/** consume the pending arm for this symbol (match + clear; stale arms expire). */
export function consumeArm(sym: string): { side: 'Long' | 'Short'; opts: ArmOpts } | null {
  if (!arm) return null;
  if (Date.now() - arm.ts > ARM_TTL_MS || arm.sym !== String(sym || '').toUpperCase()) {
    if (Date.now() - arm.ts > ARM_TTL_MS) arm = null;   // expire stale; keep a mismatched arm for its target
    return null;
  }
  const out = { side: arm.side, opts: arm.opts };
  arm = null;
  return out;
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const getSnapshot = () => state;
export function useTrade(): TState { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
