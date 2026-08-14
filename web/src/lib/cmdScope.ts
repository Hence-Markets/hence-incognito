/* =========================================================================
   cmdScope — a contextual command scope that a screen registers so the dock's
   command menu (command.js) can surface page-specific commands with a scope
   chip (Fey pattern): Screener → sort commands, Estimates → metric picker, etc.
   The screen registers on mount and clears on unmount; the palette reads the
   current scope when it opens. One-liner opener for click-triggered scopes.
   ========================================================================= */

export type CmdItem = {
  label: string;
  sub?: string;
  icon?: string;
  tag?: string;
  key?: string;              // 1-key accelerator hint
  href?: string;             // navigate on activate
  run?: () => void;          // run an action on activate (palette closes after)
  checked?: boolean;         // radio/checkbox state (metric picker)
};
export type CmdGroup = { title?: string; items: CmdItem[]; radio?: boolean };
export type CmdScope = {
  id: string;
  label: string;             // chip label — "Screener", "Amazon.com Inc.", "TSLA"
  icon?: string;             // chip icon (when no logo symbol)
  sym?: string;              // chip logo (a ticker) for entity / metric scopes
  meta?: string;             // chip trailing text, e.g. "325.29  −1.58%"
  placeholder?: string;      // input placeholder — "Search commands" / "Select a metric"
  radio?: boolean;           // render items as a single-select radio list (metric picker)
  groups: CmdGroup[];
};

let current: CmdScope | null = null;
const subs = new Set<() => void>();

export function setCmdScope(s: CmdScope) { current = s; subs.forEach((f) => f()); }
export function clearCmdScope(s?: CmdScope) {
  if (!current) return;
  if (!s || current === s || current.id === s.id) { current = null; subs.forEach((f) => f()); }
}
export function getCmdScope(): CmdScope | null { return current; }
export function onCmdScope(cb: () => void) { subs.add(cb); return () => subs.delete(cb); }
