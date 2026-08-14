/* =========================================================================
   ThesisCard — an AI-generated thesis, served on the home feed like any
   other card.

   A setup card says "buy X". A thesis card says "here is a belief, here are
   the legs that express it, here is what would prove it wrong" — and, since
   the run sheet exists, it can be funded in one motion instead of being
   armed leg by leg. Save persists it so the nightly checker starts tracking
   its invalidation; Run persists it first (so the orders attribute to a
   tracked belief) and then opens the sheet.

   The card shape is deliberately the SAME object the copilot's PlanCard and
   the theses table already speak, so one component renders a generated
   thesis, a saved thesis and (Phase 3) a peer's thesis.
   ========================================================================= */
import { useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { useAuth } from '../hooks/useAuth';
import { openRun } from '../lib/thesisRun';
import { track } from '../lib/analytics';
// @ts-ignore — JS modules
import * as me from '../lib/me.js';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';

export type FeedThesis = {
  id: string;
  world: string;
  title: string;
  summary: string;
  direction: 'long' | 'short' | 'mixed';
  horizon_days: number;
  source_tag?: string;
  legs: any[];
  plan: any;
  /** set when the thesis came from ANOTHER USER rather than the generator */
  author?: { handle: string; tier?: string; rated?: boolean } | null;
  /** the author's thesis id — adopting it credits them */
  origin_thesis_id?: number | null;
  adopt_count?: number;
};

const TAG: Record<string, string> = { for_you: 'For you', ai: 'Thesis', peer: 'From a trader' };

export function ThesisCard({ t, onSave, onDismiss }: {
  t: FeedThesis;
  onSave?: (t: FeedThesis) => void;
  onDismiss?: (t: FeedThesis) => void;
}) {
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const runnable = (t.legs || []).some((l) => l && l.venue !== 'prediction' && l.symbol);

  // persist so the thesis is tracked (and, on a run, so the orders attribute to it).
  // The server dedupes an active thesis with the same title, so Save-then-Run is one row.
  // A PEER thesis is copied with its lineage intact, so the author keeps the credit.
  const persist = async (): Promise<number | string | null> => {
    const r: any = await me.addThesis({
      title: t.title, summary: t.summary, direction: t.direction,
      symbols: (t.legs || []).map((l) => l.symbol).filter(Boolean),
      plan: t.plan, horizon_days: t.horizon_days,
      origin_thesis_id: t.origin_thesis_id || null,
    });
    return r && r.id != null ? r.id : null;
  };

  const save = async () => {
    if (!auth.authenticated) { toast('Sign in to save a thesis', { icon: 'wallet' }); auth.login?.(); return; }
    setBusy(true);
    try {
      const id = await persist();
      if (t.origin_thesis_id) me.adoptThesis(t.origin_thesis_id, 'save', { thesis_id: id }).catch(() => {});
      setSaved(true);
      track('thesis_saved', {
        thesis_id: t.id, legs: (t.legs || []).length, source: 'home_feed',
        adopted_from: t.author?.handle || null,
      });
      toast('Thesis saved — Hence will track its invalidation.', { icon: 'check' });
      onSave?.(t);
    } catch {
      toast('Could not save the thesis just now', { icon: 'close' });
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!auth.authenticated) { toast('Sign in to run a thesis', { icon: 'wallet' }); auth.login?.(); return; }
    setBusy(true);
    let id: number | string | null = null;
    try { id = await persist(); } catch { id = null; }   // a failed save never blocks the trade
    setBusy(false);
    // the run itself records the adoption (with the amount), so it isn't credited twice here
    openRun({
      id, title: t.title, summary: t.summary, direction: t.direction, plan: t.plan,
      source: t.origin_thesis_id ? 'peer_thesis' : 'home_feed',
      originThesisId: t.origin_thesis_id || null, author: t.author || null,
    });
  };

  const inv = (t.legs || []).find((l) => l && l.invalidation && l.invalidation.text);

  return (
    <div className="thesis-card">
      <div className="thesis-card__top">
        <span className={`setup-tag setup-tag--${t.source_tag === 'for_you' ? 'for_you' : t.source_tag === 'peer' ? 'peer' : 'thesis'}`}>
          {TAG[t.source_tag || 'ai'] || 'Thesis'}
        </span>
        <span className={'dir ' + (t.direction === 'mixed' ? 'neutral' : t.direction)}>{t.direction}</span>
        <span className="thesis-card__horizon">{t.horizon_days}d</span>
        {t.author?.handle ? (
          <span className="thesis-card__author">
            from <a href={'#/u/' + t.author.handle} onClick={(e) => e.stopPropagation()}>@{t.author.handle}</a>
            {/* the author's BAND, never their number — it answers "have they been right before"
                without turning the feed into a leaderboard. Absent while they are unrated. */}
            {t.author.rated && t.author.tier && t.author.tier !== 'unrated'
              ? <em className={'thesis-card__band thesis-card__band--' + t.author.tier}> · {t.author.tier}</em>
              : null}
            {t.adopt_count ? <em> · {t.adopt_count} took it</em> : null}
          </span>
        ) : null}
      </div>

      <div className="thesis-card__title">{t.title}</div>
      <div className="thesis-card__sum">{t.summary}</div>

      <div className="thesis-card__legs">
        {(t.legs || []).slice(0, 4).map((l, i) => (
          <span key={i} className={'thesis-leg thesis-leg--' + (l.direction === 'short' ? 'short' : 'long')}>
            {l.symbol ? <Logo sym={l.symbol} size={14} /> : null}
            <b>{l.symbol || 'predict'}</b>
            <em>{l.direction}</em>
            {l.sizing && l.sizing.mode === 'pct' ? <span>{Math.round(l.sizing.value)}%</span> : null}
          </span>
        ))}
      </div>

      {inv ? (
        <div className="thesis-card__inv">
          <Icon name="alert" size={11} /> Wrong if: {inv.invalidation.text}
        </div>
      ) : null}

      {/* Another user's belief is not advice, and it is not vetted by us. Said plainly on the
          card rather than buried, because this is the one surface where a stranger's position
          can turn into the reader's. */}
      {t.author?.handle ? (
        <div className="thesis-card__peernote">
          Another Hence user's idea, not advice or a recommendation. You review and sign every trade.
        </div>
      ) : null}

      <div className="feed-rail thesis-card__rail">
        {runnable ? <button className="rail-btn rail-btn--pri" disabled={busy} onClick={run}>Run</button> : null}
        <button className="rail-btn" disabled={busy || saved} onClick={save}>{saved ? 'Saved' : 'Save'}</button>
        <button className="rail-btn" onClick={() => onDismiss?.(t)}>Dismiss</button>
      </div>
    </div>
  );
}
