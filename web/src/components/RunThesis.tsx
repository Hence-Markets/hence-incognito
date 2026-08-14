/* =========================================================================
   RunThesis — put ONE amount behind a whole thesis.

   Until this existed, a saved thesis could only be watched: acting on a
   three-leg belief meant arming three tickets by hand. This sheet takes an
   amount, spreads it across the plan's legs using the sizing the plan already
   carries (lib/thesis-run), and places them on the SAME rail as the terminal
   and the quick ticket — agent-signed L1 orders with the Hence builder code
   attached (lib/hl-run, lib/builder-fee).

   Sequencing is the whole design. Both signature-costing steps — the agent
   approval and the one-time builder-fee cap — happen BEFORE the first order,
   so a wallet popup can never land between leg 1 and leg 2. Legs then go out
   in order and the first failure HALTS the run: the sheet shows what filled
   and offers a retry, rather than unwinding (which spends fees and can itself
   fail) or ploughing on into an unbalanced basket.
   ========================================================================= */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun, closeRun } from '../lib/thesisRun';
import { useAuth } from '../hooks/useAuth';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAgent } from '../hooks/useHlAgent';
import { useHlAccount } from '../hooks/useHlAccount';
import { useMarketReady } from '../hooks/useMarket';
import { makeRunWithAgent } from '../lib/hl-run';
import { resolveBuilder } from '../lib/builder-fee';
import { marketLimits, placeOrder, updateLeverage, placeTpsl } from '../lib/hyperliquid-exchange';
import {
  buildRunLegs, preflight, minTotalFor, MIN_LEG_USD, SKIP_TEXT, type RunLeg,
} from '../lib/thesis-sizing';
import { executeLegs, type LegResult, type ProtectResult } from '../lib/thesis-run';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { HenceSpinner } from './Loading';
import { track } from '../lib/analytics';
import * as market from '../lib/market.js';
import { getTicker } from '../lib/data.js';
// @ts-ignore — JS modules
import { toast } from '../lib/ui.js';
// @ts-ignore — JS module
import * as me from '../lib/me.js';
import '../styles/trade-ticket.css';
import '../styles/run-thesis.css';

const PCT_CHIPS = [25, 50, 100];

// Only a hydrated LIVE ticker is an acceptable order price — bundled seed prices are
// display fixtures. Same rule the quick ticket applies.
const markFor = (sym: string) => {
  const t: any = getTicker(sym);
  return t && t.real && Number(t.price) > 0 ? Number(t.price) : 0;
};

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Running a thesis publishes the IDEA under your handle so it can reach other people. That's
   on by default, which makes it exactly the kind of thing a user should be told about the FIRST
   time it happens rather than discovering later. Says it once, then points at the setting. */
const SHARED_NOTICE_KEY = 'hence.thesisShared.v1';
function notePublished(title: string) {
  try {
    if (localStorage.getItem(SHARED_NOTICE_KEY)) return;
    localStorage.setItem(SHARED_NOTICE_KEY, '1');
  } catch { /* storage off — better to notify twice than never */ }
  toast(`"${title}" is now visible to other people under your handle — the idea only, never your size or P&L. Turn this off in Settings.`,
    { icon: 'info' });
}

export function RunThesis() {
  const { open, target, nonce } = useRun();
  const auth = useAuth();
  const signer = useHlSigner();
  const agent = useHlAgent();
  const marketReady = useMarketReady();
  const hl = useHlAccount(open ? auth.address : undefined);

  const [amt, setAmt] = useState('');
  const [lev, setLev] = useState(1);
  const [levSheet, setLevSheet] = useState(false);
  const [limits, setLimits] = useState<Record<string, { maxLeverage: number; onlyIsolated: boolean }>>({});
  const [phase, setPhase] = useState<'edit' | 'running' | 'done'>('edit');
  const [approving, setApproving] = useState(false);
  const [results, setResults] = useState<Record<number, LegResult>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const planLegs: any[] = useMemo(() => (target?.plan && target.plan.legs) || [], [target]);
  const total = parseFloat(amt) || 0;

  // reset per open
  useEffect(() => {
    if (!open) return;
    setAmt(''); setLev(1); setLevSheet(false); setPhase('edit'); setResults({}); setApproving(false);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [nonce, open]);

  // Escape closes — but never mid-flight, where the sheet is the only record of what filled.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase === 'running') return;
      if (document.querySelector('.cmdk-overlay, .sc-overlay, .modal, .acct-ov')) return;
      e.preventDefault(); bail();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [open, phase]);

  const legs: RunLeg[] = useMemo(() => {
    if (!open || !marketReady) return [];
    return buildRunLegs(planLegs, total, { coinFor: market.coinFor, isTradeable: market.isTradeable, markFor });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, marketReady, planLegs, total]);

  // leverage caps per leg — loaded once per open so the pre-flight can clamp before signing
  useEffect(() => {
    if (!open || !legs.length) return;
    let alive = true;
    const coins = [...new Set(legs.filter((l) => !l.skip).map((l) => l.coin))];
    Promise.all(coins.map((c) => marketLimits(c).then((l) => [c, l] as const).catch(() => null)))
      .then((rows) => {
        if (!alive) return;
        const next: Record<string, any> = {};
        rows.forEach((r) => { if (r) next[r[0]] = r[1]; });
        setLimits(next);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nonce, legs.length]);

  const sized: RunLeg[] = useMemo(
    () => legs.map((l) => ({ ...l, maxLev: limits[l.coin]?.maxLeverage || 0, onlyIsolated: !!limits[l.coin]?.onlyIsolated })),
    [legs, limits],
  );

  if (!open || !target) return null;

  const live = sized.filter((l) => !l.skip);
  const skipped = sized.filter((l) => l.skip);
  const available = hl.loaded ? hl.available : null;
  // the basket can't lever past its most conservative leg
  const maxLev = live.reduce((m, l) => (l.maxLev > 0 ? Math.min(m, l.maxLev) : m), 100);
  const issues = preflight(sized, total, lev, available);
  const margin = live.reduce((s, l) => s + l.usd, 0) / Math.max(1, lev);
  const blocked = issues.length > 0;
  const minTotal = live.length ? minTotalFor(live.map((l) => l.weight)) : MIN_LEG_USD;

  const setPct = (p: number) => {
    if (available == null) return;
    const usable = available * lev * (p / 100);
    setAmt(String(Math.max(0, Math.floor(usable * 100) / 100)));
  };

  /* corpus: walking away from an engaged sheet is a decision too — the user saw the
     plan, entered an amount, and declined. Only fires when there was real engagement
     (an amount typed, still in edit phase); an idle open-close is noise, not signal. */
  const bail = () => {
    if (phase === 'edit' && total > 0) {
      me.planFeedback({
        kind: 'abandoned', thesis_id: target.id ?? null, trace_id: target.traceId ?? null,
        detail: { total, leverage: lev, legs: live.length },
      }).catch(() => { /* never block the close */ });
    }
    closeRun();
  };

  const run = async () => {
    if (!auth.authenticated) { auth.login?.(); return; }
    if (!signer.ready || !signer.sign || !signer.address) { toast('Connect a wallet to trade', { icon: 'wallet' }); return; }
    if (!hl.loaded) { toast(hl.unavailable ? 'Hyperliquid account data is unavailable — trading is paused' : 'Verifying your Hyperliquid account…', { icon: 'info' }); return; }
    if (blocked) { toast(issues[0].message, { icon: 'close' }); return; }

    setPhase('running');
    const address = signer.address;
    try {
      // 1) the agent key, up front — one approval covers every leg in the basket
      await agent.ensureAgentSigner();
      // 2) the one-time builder-fee cap, up front — a signature here can never land
      //    between two legs. A hard reject cancels the run with nothing placed.
      setApproving(true);
      const bf = await resolveBuilder(signer.sign, address, total, { prompt: true });
      setApproving(false);
      if (bf.rejected) {
        toast('Nothing placed — the routing fee is part of trading on Hence.', { icon: 'close' });
        setPhase('edit');
        return;
      }

      const executions: any[] = [];
      const { results: rs, halted, protections } = await executeLegs(sized, {
        runWithAgent: makeRunWithAgent(agent),
        place: placeOrder,                   // injected so the executor stays wallet-free
        setLeverage: updateLeverage,
        // the plan's stop/target become reduce-only trigger orders as each leg fills —
        // injected like place/setLeverage so the executor itself never touches a wallet
        tpsl: (sign, p) => placeTpsl(sign, p),
        builder: bf.builder,
        leverage: lev,
        positions: (hl.positions || []).map((p: any) => ({ coin: p.coin, leverage: p.leverage })),
        done: results,                       // a retry never re-sends a leg that already filled
        onLeg: (r) => setResults((prev) => ({ ...prev, [r.i]: r })),
        onFilled: (leg, r) => {
          // volume + estimated Hence fee, per leg — the revenue dashboard reads
          // sum(trade_submitted.usd), so a silent order path is invisible revenue.
          track('trade_submitted', {
            coin: leg.coin, side: leg.isBuy ? 'buy' : 'sell', status: r.status, leverage: lev,
            usd: leg.usd, venue: leg.coin.includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
            builder_attached: !!bf.builder, hence_fee_usd: (leg.usd * (bf.feeUsd && total ? bf.feeUsd / total : 0)),
            market: 'perp', source: 'thesis_run', thesis_id: target.id ?? null,
          });
          executions.push({
            leg_index: leg.i, symbol: leg.symbol, coin: leg.coin, direction: leg.direction,
            venue: leg.coin.includes(':') ? 'hyperliquid_xyz' : 'hyperliquid',
            usd: leg.usd, leverage: lev, size: r.size ?? null, price: r.price ?? null,
            status: r.status, oid: r.oid ?? null,
          });
        },
      });

      const filled = rs.filter((r) => r.status === 'filled' || r.status === 'resting').length;
      const unprotected = protections.filter((p) => p.status === 'unprotected');
      track('thesis_executed', {
        thesis_id: target.id ?? null, legs_filled: filled, legs_total: live.length,
        total_usd: executions.reduce((s, e) => s + e.usd, 0), partial: halted, source: target.source || 'unknown',
        legs_protected: protections.filter((p) => p.status === 'attached').length,
        legs_unprotected: unprotected.length,
      });
      // an open position missing the stop it was promised is the one outcome that must
      // never pass silently — name the legs, point at the fix
      if (unprotected.length) {
        const names = unprotected.map((p) => sized.find((l) => l.i === p.i)?.symbol || `leg ${p.i + 1}`).join(', ');
        toast(`${names}: position open, stop/target not attached — set it in the terminal`, { icon: 'alert' });
      }

      // persist so the thesis reads as run (and Portfolio can attribute the basket). The same
      // call publishes the idea for propagation and, when this thesis was adopted from someone
      // else, credits them for the run.
      // corpus: the config the human ACTUALLY ran vs what the plan suggested — sizing,
      // leverage, which legs made it. The one label a paid annotator cannot produce.
      me.planFeedback({
        kind: 'run_config', thesis_id: target.id ?? null, trace_id: target.traceId ?? null,
        detail: {
          total, leverage: lev,
          legs: sized.filter((l) => !l.skip).map((l) => ({ symbol: l.symbol, usd: l.usd, weight: +l.weight.toFixed(4), stop: l.stop, target: l.target })),
          suggested: ((target.plan && target.plan.legs) || []).map((l: any) => ({ symbol: l.symbol, sizing: l.sizing || null })),
          filled, halted,
        },
      }).catch(() => { /* corpus write must never surface into a trade flow */ });
      if (target.id != null && executions.length) {
        me.recordThesisExecutions(target.id, executions, target.originThesisId)
          .then((r: any) => { if (r && r.published === 'published') notePublished(target.title); })
          .catch(() => { /* the trade happened and its telemetry already went out */ });
      }

      setPhase('done');
      if (filled && !halted) {
        toast(`Thesis running — ${filled} leg${filled > 1 ? 's' : ''} placed`, { icon: 'check' });
        hl.refresh?.();
      } else if (filled) {
        hl.refresh?.();
      }
    } catch (e: any) {
      toast(e?.message || 'Could not run this thesis', { icon: 'close' });
      setPhase(Object.keys(results).length ? 'done' : 'edit');
    } finally {
      setApproving(false);
    }
  };

  const filledCount = Object.values(results).filter((r) => r.status === 'filled' || r.status === 'resting').length;
  const failed = Object.values(results).find((r) => r.status === 'failed');
  const cta = phase === 'running'
    ? (approving ? 'Approve in your wallet…' : 'Placing…')
    : phase === 'done'
      ? 'Done'
      : `Run ${live.length} leg${live.length === 1 ? '' : 's'}${total > 0 ? ' · ' + money(total) : ''}`;

  return (
    <>
    <div className="rt-backdrop" />
    <div className="tt-wrap rt-wrap" role="dialog" aria-modal="true" aria-label={`Run thesis ${target.title}`}>
      <div className="tt rt">
        <header className="tt__head">
          <div className="tt__id">
            <b>{target.title}</b>
            <span>{live.length} tradeable leg{live.length === 1 ? '' : 's'}{skipped.length ? ` · ${skipped.length} skipped` : ''}</span>
          </div>
          {target.direction ? <span className={'rt__dir rt__dir--' + target.direction}>{target.direction}</span> : null}
          <button className="tt__x" onClick={bail} disabled={phase === 'running'} aria-label="Close"><Icon name="close" size={15} /></button>
        </header>

        {phase === 'edit' ? (
          <>
            <div className="tt__amt">
              <span className="tt__amt-cur">$</span>
              <input
                ref={inputRef} className="tt__amt-in" inputMode="decimal" placeholder="0.00" value={amt}
                onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) run(); }}
              />
              <span className="tt__amt-est">{available != null ? money(available) + ' available' : ''}</span>
            </div>

            <div className="tt__row">
              <div className="tt__chips rt__chips">
                {PCT_CHIPS.map((p) => (
                  <button key={p} onClick={() => setPct(p)} disabled={available == null}>{p === 100 ? 'Max' : p + '%'}</button>
                ))}
              </div>
              <button className="tt__levbtn" onClick={() => setLevSheet((v) => !v)} aria-label="Adjust leverage">
                {lev}× <Icon name="sliders" size={12} />
              </button>
            </div>
          </>
        ) : null}

        {levSheet ? (
          <>
            <div className="tt__levpop-bd" onClick={() => setLevSheet(false)} />
            <div className="tt__levpop">
              <div className="tt__levpop-h"><b>Basket leverage</b><button onClick={() => setLevSheet(false)}><Icon name="close" size={13} /></button></div>
              <div className="tt__levpop-slide">
                <input
                  className="tt__lev-slider" type="range" min={1} max={Math.max(1, maxLev)} step={1} value={lev}
                  onChange={(e) => setLev(Number(e.target.value))}
                />
                <div className="tt__levpop-num">{lev}×</div>
              </div>
              <div className="tt__levpop-row"><span>Margin required</span><b>{money(margin)}</b></div>
              <div className="tt__levpop-sub">Applied to every leg, capped at the most conservative market ({maxLev}×).</div>
              <button className="tt__levpop-cta" onClick={() => setLevSheet(false)}>Confirm {lev}×</button>
            </div>
          </>
        ) : null}

        <div className="rt__legs">
          {sized.map((l) => {
            const r = results[l.i];
            const st = l.skip ? 'skipped' : r?.status || 'pending';
            return (
              <div key={l.i} className={'rt__leg rt__leg--' + st}>
                <span className="rt__legsym">
                  {l.symbol ? <Logo sym={l.symbol} size={16} /> : <Icon name="chart" size={14} />}
                  <b>{l.symbol || l.label}</b>
                </span>
                <span className={'rt__side rt__side--' + l.direction}>{l.direction}</span>
                {l.skip ? (
                  l.route
                    ? <a className="rt__legroute" href={l.route} onClick={closeRun}>{SKIP_TEXT[l.skip]} <Icon name="arrowRight" size={11} /></a>
                    : <span className="rt__legskip">{SKIP_TEXT[l.skip]}</span>
                ) : (
                  <>
                    <span className="rt__legusd">{l.usd > 0 ? money(l.usd) : '—'}</span>
                    {(l.stop != null || l.target != null) && (
                      /* the trigger orders this run will place — shown BEFORE committing, so
                         they are part of what the user signs up for, never a surprise */
                      <span className="rt__legtpsl">
                        {l.stop != null && <em className="rt__sl">SL {l.stop}</em>}
                        {l.target != null && <em className="rt__tp">TP {l.target}</em>}
                      </span>
                    )}
                    <span className="rt__legstat">
                      {st === 'placing' ? <HenceSpinner size={12} />
                        : st === 'filled' || st === 'resting' ? <><Icon name="check" size={11} /> {r?.size ? `${r.size} @ ${r.price ?? '—'}` : st}</>
                        : st === 'failed' ? <span className="rt__legerr"><Icon name="alert" size={11} /> {r?.error}</span>
                        : l.mark > 0 && l.usd > 0 ? `≈ ${(l.usd / l.mark).toPrecision(3)}` : ''}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {phase === 'edit' && blocked && total > 0 ? (
          <div className="rt__warn"><Icon name="alert" size={12} /> {issues[0].message}</div>
        ) : phase === 'edit' && live.length ? (
          <div className="rt__meta">
            Margin required {money(margin)} at {lev}× · minimum {money(minTotal)} for {live.length} leg{live.length === 1 ? '' : 's'}
          </div>
        ) : null}

        {phase === 'done' && failed ? (
          <div className="rt__partial">
            <b><Icon name="alert" size={12} /> Partially executed</b>
            <span>{filledCount} leg{filledCount === 1 ? '' : 's'} placed. The rest was not sent — nothing was unwound, so you can retry or close the filled legs from the terminal.</span>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="rt__doneacts">
            {failed ? <button className="tt__go buy rt__retry" onClick={run}>Retry the rest</button> : null}
            <a className="rt__viewpf" href="#/portfolio" onClick={closeRun}>View in portfolio <Icon name="arrowRight" size={12} /></a>
            <button className="rt__close" onClick={closeRun}>Close</button>
          </div>
        ) : (
          <button
            className={'tt__go ' + (target.direction === 'short' ? 'sell' : 'buy')}
            disabled={phase === 'running' || blocked || !live.length}
            onClick={run}
          >
            {phase === 'running' ? <HenceSpinner size={16} /> : null}{cta}
          </button>
        )}

        <div className="tt__foot">
          {phase === 'edit'
            ? 'You approve once, then legs are placed in order. A failed leg stops the run.'
            : 'Legs place in order — a failure halts the rest.'}
        </div>
      </div>
    </div>
    </>
  );
}
