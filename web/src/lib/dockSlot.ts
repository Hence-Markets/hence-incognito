import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/* =========================================================================
   dockSlot — the shared bottom-centre "slot" store.

   The dock is only the DEFAULT tenant of one shared position. Any screen can
   temporarily hand that slot to a contextual occupant (a multi-select action
   bar, a Quarterly|Annual toggle, a scoped inline-command footer, …) via
   setDockOccupant(), and clear it on unmount. <Dock> renders whichever occupant
   is set, else the nav pill. This is the Fey "one slot, swappable occupants"
   model (see dock-navigation-spec memory).
   ========================================================================= */

export type DockAction = { label: string; icon?: string; danger?: boolean; onClick: () => void };

export type DockOccupant =
  | { kind: 'multiselect'; count: number; noun?: string; actions: DockAction[]; onClear?: () => void }
  | { kind: 'toggle'; options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; lead?: string; trailing?: ReactNode }
  | { kind: 'inline'; title: string; placeholder: string; multiline?: boolean; submitLabel?: string; value?: string; extra?: DockAction; onSubmit: (v: string) => void; onCancel: () => void }
  | { kind: 'node'; node: ReactNode }
  | null;

let occupant: DockOccupant = null;
let token = 0;                                   // guards against a late clear() from a stale owner
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

// Returns a token; pass it to clearDockOccupant to only clear if you're still the owner.
export function setDockOccupant(o: DockOccupant): number {
  occupant = o;
  token += 1;
  emit();
  return token;
}
export function clearDockOccupant(owner?: number) {
  if (owner != null && owner !== token) return;   // a newer occupant took over — don't clobber it
  if (occupant !== null) { occupant = null; emit(); }
}

const getSnapshot = () => occupant;
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export function useDockOccupant(): DockOccupant {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
