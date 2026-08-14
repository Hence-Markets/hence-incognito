/* =========================================================================
   Which live positions belong to which thesis.

   Hyperliquid NETS positions per coin: if you are long ETH from a thesis and
   long ETH from a hunch, the venue reports ONE position. So "which position
   belongs to which thesis" is not a fact any venue can answer — it has to be
   attributed, and attributed exclusively, or the same P&L gets counted twice.

   Two rules make this honest rather than merely plausible:

     1. Only a thesis that was actually RUN can claim anything. A saved thesis
        is a belief, not a position — without this a thesis saved months ago
        silently annexes a position you opened by hand this morning.
     2. A position is claimed by AT MOST ONE thesis: the one most recently run
        that names it. Everything unclaimed stays in the loose list, so every
        position appears exactly once on the screen.
   ========================================================================= */

export type Exec = {
  thesis_id: number | string;
  symbol: string;
  coin?: string | null;
  direction?: string | null;
  usd?: number | null;
  size?: number | null;
  price?: number | null;
  created_at?: string | null;
};

export type PosLike = {
  coin: string;
  side: 'Long' | 'Short';
  sz: number;
  entryPx: number;
  positionValue: number;
  uPnl: number;
  marginUsed?: number;
};

export type ThesisLike = {
  id: number | string;
  title?: string;
  status?: string;
  executed_at?: string | null;
  executed_usd?: number | null;
  plan?: { legs?: any[] } | null;
  last_check?: any;
};

export type ThesisGroup<P extends PosLike = PosLike> = {
  thesis: ThesisLike;
  legs: { leg: any; pos: P | null }[];
  open: P[];
  uPnl: number;
  value: number;
  cost: number;                 // what was put in, from the recorded executions
  roi: number | null;           // uPnl / cost
  entered: number;
  total: number;
};

const symOf = (coin: string) => String(coin || '').split(':').pop()!.toUpperCase();
const dirSide = (d: any): 'Long' | 'Short' => (String(d || '').toLowerCase() === 'short' ? 'Short' : 'Long');
const isPm = (leg: any) => {
  const d = String(leg?.direction || '').toLowerCase();
  // plan legs carry venue 'prediction' (never 'pm' — the older matcher checked the wrong value)
  return leg?.venue === 'prediction' || leg?.venue === 'pm' || d === 'yes' || d === 'no';
};

/** ms since epoch for an ISO-ish timestamp, 0 when absent/unparseable. */
function ts(s?: string | null): number {
  if (!s) return 0;
  const d = new Date(String(s).replace(' ', 'T'));
  const n = d.getTime();
  return Number.isFinite(n) ? n : 0;
}

/**
 * Attribute live positions to the theses that opened them.
 *
 * `executions` (server-recorded, one row per filled leg) is the authoritative signal — it
 * knows which thesis actually placed an order on a coin. The plan's legs are only a fallback
 * for a thesis that was run before executions were recorded.
 *
 * Returns the groups plus the positions nothing claimed.
 */
export function groupByThesis<P extends PosLike>(
  theses: ThesisLike[] | null | undefined,
  positions: P[] | null | undefined,
  executions: Exec[] | null | undefined,
): { groups: ThesisGroup<P>[]; loose: P[] } {
  // every caller feeds this from async state that starts null
  const pos: P[] = positions || [];
  // Only run theses compete for positions, newest run first — so when two theses name the
  // same coin, the one you most recently put money behind owns it.
  const runnable = (theses || [])
    .filter((t) => t && t.executed_at && (t.status || 'active') === 'active')
    .sort((a, b) => ts(b.executed_at) - ts(a.executed_at));

  const execByThesis = new Map<string, Exec[]>();
  for (const e of executions || []) {
    const k = String(e.thesis_id);
    if (!execByThesis.has(k)) execByThesis.set(k, []);
    execByThesis.get(k)!.push(e);
  }

  const claimed = new Set<string>();          // position coin → already owned by a thesis
  const groups: ThesisGroup<P>[] = [];

  for (const t of runnable) {
    const execs = execByThesis.get(String(t.id)) || [];
    const planLegs = (t.plan && Array.isArray(t.plan.legs) ? t.plan.legs : []) as any[];

    // What this thesis is entitled to claim: the coins it actually traded (preferred), else
    // the tradeable legs of its plan.
    const wanted = execs.length
      ? execs.map((e) => ({
        sym: String(e.symbol || '').toUpperCase(),
        coin: e.coin || null,
        side: dirSide(e.direction),
        usd: Number(e.usd) || 0,
      }))
      : planLegs.filter((l) => !isPm(l) && l.symbol).map((l) => ({
        sym: String(l.symbol).toUpperCase(), coin: null, side: dirSide(l.direction), usd: 0,
      }));

    const open: P[] = [];
    let cost = 0;
    const takenHere = new Map<string, P>();
    for (const w of wanted) {
      const hit = pos.find((p) =>
        !claimed.has(p.coin)
        && (w.coin ? p.coin === w.coin : symOf(p.coin) === w.sym)
        && p.side === w.side);
      if (hit) {
        claimed.add(hit.coin);
        open.push(hit);
        takenHere.set(symOf(hit.coin) + ':' + hit.side, hit);
      }
      cost += w.usd;
    }

    // Present the PLAN's legs (that's the thesis the user wrote), each with its position if
    // one is still open. A leg the user closed by hand shows as exited rather than vanishing.
    const legRows = (planLegs.length ? planLegs : wanted.map((w) => ({ symbol: w.sym, direction: w.side.toLowerCase(), venue: 'perp' })))
      .map((leg: any) => {
        if (isPm(leg)) return { leg, pos: null };
        const key = String(leg.symbol || '').toUpperCase() + ':' + dirSide(leg.direction);
        return { leg, pos: takenHere.get(key) || null };
      });

    if (!open.length && !legRows.length) continue;
    const uPnl = open.reduce((s, p) => s + p.uPnl, 0);
    const value = open.reduce((s, p) => s + p.positionValue, 0);
    // cost basis: what was recorded as put in; fall back to the thesis rollup, then to value
    const basis = cost > 0 ? cost : (Number(t.executed_usd) || value);
    groups.push({
      thesis: t, legs: legRows, open, uPnl, value, cost: basis,
      roi: basis > 0 ? uPnl / basis : null,
      entered: open.length,
      total: legRows.length,
    });
  }

  return {
    // a thesis with nothing open any more sinks below the live ones
    groups: groups.sort((a, b) => (b.entered ? 1 : 0) - (a.entered ? 1 : 0) || b.value - a.value),
    loose: pos.filter((p) => !claimed.has(p.coin)),
  };
}
