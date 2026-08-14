/* =========================================================================
   Thesis execution — turn a saved TradePlan into real orders.

   A thesis is a BASKET (long ETH + short SOL + a prediction leg), and until
   now the only way to act on one was to arm each leg into the terminal by
   hand. Sizing (thesis-sizing.ts) spreads ONE amount across the legs; this
   module places them.

   Two rules shape everything here:

   - Cross-venue execution cannot be atomic. Legs go out SEQUENTIALLY and the
     first failure HALTS the run — the caller shows what filled and offers
     retry/skip. We never auto-unwind (a failure path that spends fees and
     can itself fail) and never silently leave half a basket.
   - Nothing is signed until every pre-flight passes. An unlisted symbol or an
     under-minimum leg is caught BEFORE the first order, not discovered
     between leg 1 and leg 2.
   ========================================================================= */
import type { PlaceOrderParams } from './hyperliquid-exchange';
import type { BuilderCode } from './hyperliquid-sign';
import type { RunWithAgent } from './hl-run';
import type { RunLeg } from './thesis-sizing';

// NOTE: sizing is deliberately NOT re-exported from here. The two modules have different
// dependencies — thesis-sizing is pure, this one takes injected exchange calls — and a barrel
// would drag one into every importer of the other. Import sizing from './thesis-sizing'.

export type LegStatus = 'pending' | 'placing' | 'filled' | 'resting' | 'failed' | 'skipped';

/** What happened to a filled leg's trigger orders. 'none' = the plan supplied no levels —
    normal, not an error. 'unprotected' is the state the UI must never stay quiet about:
    the position is OPEN and the stop it was promised is not on the book. */
export type ProtectResult = {
  i: number;
  status: 'attached' | 'unprotected' | 'none';
  tp?: number;
  sl?: number;
  error?: string;
};
export type LegResult = {
  i: number;
  status: LegStatus;
  size?: number;
  price?: number;
  oid?: number;
  error?: string;
};

export type RunContext = {
  runWithAgent: RunWithAgent;
  builder: BuilderCode | null;
  leverage: number;
  /** open positions, so we skip a redundant (and signature-costing) leverage change */
  positions: { coin: string; leverage: number }[];
  onLeg: (r: LegResult) => void;
  /** called once per FILLED leg, for telemetry + persistence */
  onFilled?: (leg: RunLeg, r: LegResult) => void;
  /**
   * Results from a previous attempt at this same run. On a retry after a partial
   * execution, a leg that already filled MUST NOT be sent again — it is carried
   * through untouched. Without this, "retry the rest" doubles the filled legs.
   */
  done?: Record<number, LegResult>;
  /**
   * The two exchange calls, injected. They are passed in rather than imported so this module
   * carries no wallet/viem dependency and the ORDERING — which is the whole safety property
   * here — can be tested without a browser. RunThesis wires in the real ones.
   */
  place: (sign: any, p: PlaceOrderParams) => Promise<any>;
  setLeverage: (sign: any, coin: string, lev: number, isCross: boolean) => Promise<any>;
  /** Optional third exchange call: reduce-only TP/SL trigger orders (positionTpsl grouping),
      attached right after a leg FILLS. Injected like the others so the executor stays
      wallet-free. Absent = no protection is attempted (old callers keep working). */
  tpsl?: (sign: any, p: { coin: string; positionSide: 'Long' | 'Short'; sz: number; tp?: number; sl?: number }) => Promise<any>;
};

/**
 * Place the executable legs in order. Returns every leg's result and whether the
 * run halted early. The caller owns the builder resolution and the agent approval
 * so BOTH happen once, up front, before any leg can fill — a wallet popup between
 * leg 1 and leg 2 is the thing this ordering exists to prevent.
 */
export async function executeLegs(legs: RunLeg[], ctx: RunContext): Promise<{ results: LegResult[]; halted: boolean; protections: ProtectResult[] }> {
  const results: LegResult[] = [];
  const protections: ProtectResult[] = [];
  let halted = false;

  /* ---- pass 1: leverage, for every leg, before ANY money moves ----
     Leverage used to be set immediately before each leg's own order, which meant a leverage
     failure on leg 3 left legs 1 and 2 already filled — a half-basket caused by a setting,
     not by the market. Doing the whole leverage pass first turns that into a clean abort:
     nothing is placed. Setting leverage on a flat asset opens no position and costs nothing,
     so the pass is safe to run up front. */
  const live = legs.filter((l) => !l.skip
    && !(ctx.done?.[l.i]?.status === 'filled' || ctx.done?.[l.i]?.status === 'resting'));
  for (const leg of live) {
    const lev = Math.max(1, Math.min(ctx.leverage, leg.maxLev || ctx.leverage));
    const open = ctx.positions.find((p) => p.coin === leg.coin);
    if (open && Math.round(open.leverage) === lev) continue;      // already there
    try {
      const lr: any = await ctx.runWithAgent((sign) => ctx.setLeverage(sign, leg.coin, lev, !leg.onlyIsolated));
      if (lr && 'error' in lr) {
        const r: LegResult = { i: leg.i, status: 'failed', error: `Couldn't set ${lev}× leverage: ${lr.error}` };
        results.push(r); ctx.onLeg(r);
        // abort the whole run — no order has been sent, so there is nothing to unwind
        for (const other of legs) {
          if (other.i === leg.i) continue;
          const s: LegResult = { i: other.i, status: other.skip ? 'skipped' : 'pending' };
          results.push(s); ctx.onLeg(s);
        }
        return { results, halted: true, protections };
      }
    } catch (e: any) {
      const r: LegResult = { i: leg.i, status: 'failed', error: e?.message || 'Leverage change failed' };
      results.push(r); ctx.onLeg(r);
      return { results, halted: true, protections };
    }
  }

  /* ---- pass 2: the orders ---- */
  for (const leg of legs) {
    if (leg.skip) {
      const r: LegResult = { i: leg.i, status: 'skipped' };
      results.push(r); ctx.onLeg(r);
      continue;
    }
    const prior = ctx.done?.[leg.i];
    if (prior && (prior.status === 'filled' || prior.status === 'resting')) {
      results.push(prior); ctx.onLeg(prior);     // already on the book — never re-send
      continue;
    }
    if (halted) {
      const r: LegResult = { i: leg.i, status: 'pending' };
      results.push(r); ctx.onLeg(r);
      continue;
    }

    ctx.onLeg({ i: leg.i, status: 'placing' });
    try {
      // leverage is already set for every leg by pass 1 above
      const params: PlaceOrderParams = {
        coin: leg.coin, isBuy: leg.isBuy, usd: leg.usd, markPrice: leg.mark,
        type: 'Market', builder: ctx.builder,
      };
      const res: any = await ctx.runWithAgent((sign) => ctx.place(sign, params));
      if (res && res.ok) {
        const d = res.detail || {};
        const r: LegResult = {
          i: leg.i, status: res.status === 'resting' ? 'resting' : 'filled',
          size: Number(d.totalSz ?? d.sz ?? 0) || undefined,
          price: Number(d.avgPx ?? d.px ?? 0) || undefined,
          oid: d.oid,
        };
        results.push(r); ctx.onLeg(r); ctx.onFilled?.(leg, r);
        /* ---- protection: the plan's stop/target become trigger orders NOW ----
           Only for a FILL: 'resting' means no position exists yet, and positionTpsl
           against a flat book is a rejection waiting to happen. Sized to what actually
           filled, never to what we asked for. And a failure here must never halt the
           run or fail the leg — the position is already open; an unprotected position
           is a warning the caller surfaces, not a reason to abandon the rest of the
           basket half-placed. */
        if (r.status === 'filled' && (leg.stop != null || leg.target != null)) {
          const tp = leg.target ?? undefined;
          const sl = leg.stop ?? undefined;
          if (ctx.tpsl && (r.size ?? 0) > 0) {
            try {
              const pr: any = await ctx.runWithAgent((sign) => ctx.tpsl!(sign, {
                coin: leg.coin, positionSide: leg.isBuy ? 'Long' : 'Short',
                sz: r.size!, tp, sl,
              }));
              if (pr && pr.ok) protections.push({ i: leg.i, status: 'attached', tp, sl });
              else protections.push({ i: leg.i, status: 'unprotected', tp, sl, error: (pr && pr.error) || 'Trigger orders rejected' });
            } catch (e: any) {
              protections.push({ i: leg.i, status: 'unprotected', tp, sl, error: e?.message || 'Trigger orders failed' });
            }
          } else if (!ctx.tpsl) {
            protections.push({ i: leg.i, status: 'none' });
          } else {
            protections.push({ i: leg.i, status: 'unprotected', tp, sl, error: 'Fill reported no size' });
          }
        } else if (r.status === 'filled') {
          protections.push({ i: leg.i, status: 'none' });
        }
      } else {
        const r: LegResult = { i: leg.i, status: 'failed', error: (res && res.error) || 'Order rejected' };
        results.push(r); ctx.onLeg(r); halted = true;
      }
    } catch (e: any) {
      const r: LegResult = { i: leg.i, status: 'failed', error: e?.message || 'Order failed' };
      results.push(r); ctx.onLeg(r); halted = true;
    }
  }

  return { results, halted, protections };
}
