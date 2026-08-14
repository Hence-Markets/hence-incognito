/* PlanCard — the copilot's belief → trade plan, rendered as actionable leg cards.
   Server-validated plan only (symbols whitelisted, sizing capped, invalidation checked),
   so everything here is safe to act on. Per leg: Trade arms the FULL terminal ticket
   (side/size/leverage seeded, nothing submitted — the user reviews and signs), Watch
   adds to the watchlist, Save stashes the leg as a setup idea. PM legs show live odds
   and browse to the market (no trade button — PM trading is gated). The footer saves
   the whole plan as a persistent THESIS that the nightly checker then tracks. */
import { track } from '../lib/analytics';
import { useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { armTicket } from '../lib/tradeTicket';
import { openRun } from '../lib/thesisRun';
import { addWatch } from '../lib/watch';
import * as stash from '../lib/stash';
import { useAuth } from '../hooks/useAuth';
// @ts-ignore — JS modules
import * as me from '../lib/me.js';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';

export type PlanLeg = {
  venue: 'perp' | 'stock' | 'prediction';
  symbol?: string;
  question?: string;
  direction: 'long' | 'short' | 'yes' | 'no';
  sizing?: { mode: 'usd' | 'pct'; value: number } | null;
  entry?: { type: 'market' | 'zone'; low?: number; high?: number };
  invalidation: { type: 'price' | 'condition'; level?: number; text: string };
  catalyst?: string;
  why?: string;
  label?: string;
  px?: number | null;
  market?: { id: string; question: string; yes?: number | null };
  route?: string;
};
export type TradePlan = {
  thesis: { title: string; summary: string; direction: 'long' | 'short' | 'mixed' };
  horizon_days: number;
  review_at: string;
  confidence: 'low' | 'medium' | 'high';
  legs: PlanLeg[];
};

const fmtPx = (v?: number | null) => (v == null ? '—' : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(v));
const sizingLabel = (s?: PlanLeg['sizing']) =>
  !s ? null : s.mode === 'usd' ? `$${s.value.toLocaleString()}` : `${s.value}% of available`;

export function PlanCard({ plan, traceId }: { plan: TradePlan; traceId?: number | null }) {
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<number | string | null>(null);
  const [savedLegs, setSavedLegs] = useState<Record<number, boolean>>({});
  const [watched, setWatched] = useState<Record<number, boolean>>({});

  const tradeLeg = (l: PlanLeg) => {
    if (!l.symbol) return;
    const side = l.direction === 'short' ? 'Short' : 'Long';
    const usd = l.sizing?.mode === 'usd' ? l.sizing.value : undefined;
    armTicket(l.symbol, side, { usd });
    location.hash = '#/terminal/' + l.symbol;
  };
  const watchLeg = (l: PlanLeg, i: number) => {
    if (!l.symbol) return;
    addWatch(l.symbol);
    setWatched((w) => ({ ...w, [i]: true }));
    toast(l.symbol + ' added to your watchlist', { icon: 'check' });
  };
  const saveLeg = (l: PlanLeg, i: number) => {
    stash.record({
      kind: 'save', subject_type: 'setup',
      key: 'plan:' + (l.symbol || l.question || i) + ':' + l.direction,
      symbol: l.symbol, title: (l.label || l.symbol || l.question || 'Plan leg'),
      snippet: l.why || '', stance: l.direction as any,
    });
    setSavedLegs((s) => ({ ...s, [i]: true }));
    toast('Saved to your stash', { icon: 'check' });
  };
  // persist the plan as a tracked thesis, returning its id (idempotent — the server
  // dedupes an active thesis with the same title and refreshes its plan).
  const persist = async (): Promise<number | string | null> => {
    const syms = plan.legs.map((l) => l.symbol).filter(Boolean) as string[];
    const r: any = await me.addThesis({
      title: plan.thesis.title, summary: plan.thesis.summary, direction: plan.thesis.direction,
      symbols: syms, plan, horizon_days: plan.horizon_days,
      trace_id: traceId ?? null,          // corpus: thesis ← reasoning chain
    });
    const id = r && r.id != null ? r.id : null;
    setSavedId(id);
    setSaved(true);
    return id;
  };

  const saveThesis = async () => {
    if (!auth.authenticated) { toast('Sign in to save a thesis', { icon: 'wallet' }); auth.login?.(); return; }
    try {
      await persist();
      track('thesis_saved', { legs: plan.legs.length, horizon: plan.horizon_days });
      toast('Thesis saved — Hence will track its invalidation and review date.', { icon: 'check' });
    } catch {
      toast('Could not save the thesis just now', { icon: 'close' });
    }
  };

  // Run the WHOLE plan: one amount from the wallet, split across the legs. The thesis is
  // persisted first (silently) so the run is attributed to a tracked belief rather than to a
  // chat message that scrolls away — but a failed save never blocks the trade.
  const runPlan = async () => {
    if (!auth.authenticated) { toast('Sign in to run a thesis', { icon: 'wallet' }); auth.login?.(); return; }
    let id = savedId;
    if (id == null) { try { id = await persist(); } catch { id = null; } }
    openRun({
      id, title: plan.thesis.title, summary: plan.thesis.summary,
      direction: plan.thesis.direction, plan, source: 'plan_card', traceId: traceId ?? null,
    });
  };

  return (
    <div className="plancard">
      <div className="plancard__head">
        <span className={'plancard__dir plancard__dir--' + plan.thesis.direction}>{plan.thesis.direction}</span>
        <b className="plancard__title">{plan.thesis.title}</b>
        <span className="plancard__meta">{plan.horizon_days}d · review {plan.review_at} · {plan.confidence} conviction</span>
      </div>
      <p className="plancard__sum">{plan.thesis.summary}</p>
      <div className="plancard__legs">
        {plan.legs.map((l, i) => (
          <div key={i} className="plancard__leg">
            <div className="plancard__legtop">
              <span className={'plancard__venue plancard__venue--' + l.venue}>{l.venue === 'prediction' ? 'predict' : l.venue}</span>
              {l.symbol ? <span className="plancard__sym"><Logo sym={l.symbol} size={16} /> <b>{l.symbol}</b></span>
                : <b className="plancard__q">{l.market?.question || l.question}</b>}
              <span className={'plancard__side plancard__side--' + l.direction}>{l.direction}</span>
              {l.venue === 'prediction' && l.market?.yes != null
                ? <span className="plancard__odds">{Math.round((l.market.yes || 0) * 100)}% yes</span> : null}
            </div>
            <div className="plancard__facts">
              {l.entry && <span>Entry {l.entry.type === 'zone' ? `${fmtPx(l.entry.low)}–${fmtPx(l.entry.high)}` : 'market'}</span>}
              {sizingLabel(l.sizing) && <span>Size {sizingLabel(l.sizing)}</span>}
              {l.px != null && <span>Now {fmtPx(l.px)}</span>}
            </div>
            <div className="plancard__inv"><Icon name="alert" size={11} /> Invalidation: {l.invalidation.type === 'price' && l.invalidation.level != null ? `${fmtPx(l.invalidation.level)} — ` : ''}{l.invalidation.text}</div>
            {l.why ? <div className="plancard__why">{l.why}</div> : null}
            <div className="plancard__acts">
              {l.venue !== 'prediction' && l.symbol ? (
                <button className="plancard__act plancard__act--pri" onClick={() => tradeLeg(l)}>Trade</button>
              ) : l.route ? (
                <button className="plancard__act plancard__act--pri" onClick={() => { location.hash = l.route!; }}>View market</button>
              ) : null}
              {l.symbol ? <button className="plancard__act" disabled={!!watched[i]} onClick={() => watchLeg(l, i)}>{watched[i] ? 'Watching' : 'Watch'}</button> : null}
              <button className="plancard__act" disabled={!!savedLegs[i]} onClick={() => saveLeg(l, i)}>{savedLegs[i] ? 'Saved' : 'Save'}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="plancard__foot">
        <span className="plancard__note">You review and sign every trade — this plan never executes on its own.</span>
        <button className="plancard__savethesis" disabled={saved} onClick={saveThesis}>
          {saved ? <><Icon name="check" size={13} /> Thesis saved</> : <>Save thesis <Icon name="arrowRight" size={13} /></>}
        </button>
        {plan.legs.some((l) => l.venue !== 'prediction' && l.symbol) ? (
          <button className="plancard__runthesis" onClick={runPlan}>
            <Icon name="bolt" size={13} /> Run thesis
          </button>
        ) : null}
      </div>
    </div>
  );
}
