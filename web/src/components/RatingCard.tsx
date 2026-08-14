/*
  Your author rating — the number, the reason, and the curve.

  This component is only ever rendered for its OWNER. Other people see a band on your profile
  (Profile.tsx `RatingBand`) and never the integer. docs/author-rating.md sets out why: a public
  number turns a measurement into a leaderboard and invites gaming, and it publicly labels the
  unlucky. But hiding it from YOU would be worse — a score you cannot inspect breeds resentment,
  so this shows the decomposition in native units (R, not points) and the history.

  Everything here is derived server-side from immutable outcome rows and recomputed nightly from
  scratch, so what you see is replayable rather than an accumulated counter.
*/
import { useMemo } from 'react';

export type RatingSelf = {
  value: number; n_w: number; tier: string; rated: boolean; base: number;
  components?: any; why?: string[];
  history?: { day: string; har: number }[];
};

const TIER_COPY: Record<string, string> = {
  established: 'Established', tracking: 'Tracking', emerging: 'Emerging', unrated: 'Unrated',
};

/* A sparkline over the rating history. Deliberately NOT auto-scaled to the data range: the
   baseline (1000) is drawn, and the y-window is symmetric around it, so a 4-point wobble looks
   like a 4-point wobble rather than a dramatic crash. */
function Spark({ points, base }: { points: { day: string; har: number }[]; base: number }) {
  const d = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.har);
    const span = Math.max(60, ...vals.map((v) => Math.abs(v - base) * 1.25));
    const lo = base - span, hi = base + span;
    const W = 260, H = 44;
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
    return {
      path: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      zero: y(base).toFixed(1), W, H,
      up: vals[vals.length - 1] >= vals[0],
    };
  }, [points, base]);
  if (!d) return null;
  return (
    <svg className="ratc__spark" viewBox={`0 0 ${d.W} ${d.H}`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={d.W} y1={d.zero} y2={d.zero} className="ratc__baseline" />
      <path d={d.path} className={'ratc__line' + (d.up ? ' is-up' : ' is-down')} />
    </svg>
  );
}

export default function RatingCard({ r }: { r?: RatingSelf | null }) {
  if (!r) return null;
  const c = r.components || {};
  const delta = Math.round(r.value - (r.base || 1000));
  const hist = r.history || [];

  return (
    <section className="ratc">
      <div className="ratc__top">
        <div>
          <div className="ratc__label">Your author rating</div>
          <div className="ratc__num">
            {r.rated ? r.value : '—'}
            <span className={'ratc__tier ratc__tier--' + (r.rated ? r.tier : 'unrated')}>
              {TIER_COPY[r.rated ? r.tier : 'unrated']}
            </span>
          </div>
        </div>
        {r.rated && delta !== 0 && (
          <div className={'ratc__delta' + (delta > 0 ? ' is-up' : ' is-down')}>
            {delta > 0 ? '+' : ''}{delta} vs base
          </div>
        )}
      </div>

      {hist.length > 1 && <Spark points={hist} base={r.base || 1000} />}

      {/* Why the number is where it is. In R — multiples of the risk YOU declared — because
          that is the unit the rating is actually computed in; points are only the display. */}
      {!!(r.why || []).length && (
        <ul className="ratc__why">
          {r.why!.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {r.rated && (
        <div className="ratc__grid">
          <div><b>{c.n ?? 0}</b><span>Closed theses</span></div>
          <div><b>{Number(c.mu ?? 0) >= 0 ? '+' : ''}{Number(c.mu ?? 0).toFixed(2)}R</b><span>Average outcome</span></div>
          <div><b>{Number(c.sigma_down ?? 0).toFixed(2)}R</b><span>Downside deviation</span></div>
          <div><b>{Number(r.n_w ?? 0).toFixed(1)}</b><span>Weighted record</span></div>
        </div>
      )}

      <p className="ratc__note">
        Only you see this number. On your profile, others see a band — {TIER_COPY[r.rated ? r.tier : 'unrated']}
        {r.rated ? '' : ' until three theses close'} — and never a negative one. Scored in R:
        each closed thesis is measured against the invalidation level you set yourself, so
        being right matters more than the size you put behind it.
      </p>
    </section>
  );
}
