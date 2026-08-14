/* Source breakdown — the hero page: one source, its episodes, and every call with the
   full verbatim quote / reasoning / return-path. Newsletter variant = summary + read-more
   (podcast video + ▶timestamps land with the transcription run). */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { SignalCall, pct } from '../components/signals-ui';
import * as signals from '../lib/signals.js';
// @ts-ignore — JS helper at the remote episode URL boundary
import { safeHttpUrl } from '../lib/safe-html.js';

const fdate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export default function SignalSource() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'done' | 'empty' | 'down'>('loading');
  useEffect(() => {
    let alive = true;
    setState('loading');
    signals.source(id).then((r: any) => {
      if (!alive) return;
      if (r.available === false) { setState('down'); return; }
      if (r.source) { setData(r.source); setState('done'); } else setState('empty');
    }).catch(() => { if (alive) setState('empty'); });
    return () => { alive = false; };
  }, [id]);

  if (state !== 'done' || !data) {
    return (
      <Shell dockActive="signals">
        <div className="sig">
          <a className="sig-back" href="#/signals"><Icon name="back" size={13} /> Signals</a>
          <div className={state === 'loading' ? 'generating' : 'muted'} style={{ marginTop: 30, fontSize: 13 }}>
            {state === 'loading' ? 'Loading breakdown…'
              : state === 'down' ? 'The signals database isn’t running.'
                : 'Source not found.'}
          </div>
        </div>
      </Shell>
    );
  }

  const { source, stats, episodes } = data;
  const kindLabel = source.kind === 'podcast' ? 'Podcast' : source.kind === 'newsletter' ? 'Newsletter' : source.kind;
  return (
    <Shell dockActive="signals">
      <div className="sig sig-srcpage">
        <a className="sig-back" href="#/signals"><Icon name="back" size={13} /> Signals</a>
        <div className="sig-srchead">
          <div className="sig-srchead__main">
            <h1>Every {source.name} trade, tracked</h1>
            <p>Every tradeable thesis we found {source.kind === 'newsletter' ? 'in the newsletter' : 'on the show'} — priced vs BTC.</p>
            <div className="sig-srcstats">
              <span>{stats.episodes} {source.kind === 'newsletter' ? 'issues' : 'episodes'}</span>
              <span>{stats.calls} trades</span>
              <span>{stats.speakers} {stats.speakers === 1 ? 'voice' : 'voices'}</span>
              {stats.beat_rate != null && <span className="hl">{(stats.beat_rate * 100).toFixed(0)}% beat BTC</span>}
              {stats.avg_excess != null && <span className="hl">{pct(stats.avg_excess)} avg vs BTC</span>}
            </div>
          </div>
          <a className="sig-srchead__show" href={`#/signals/show/${encodeURIComponent(String(source.id))}`}>Ranked view →</a>
        </div>

        {episodes.map((ep: any) => (
          <div className="sig-ep" key={ep.id}>
            <div className="sig-ep__head">
              <span className="kind">{ep.is_podcast ? '▶' : '✎'} {kindLabel}</span>
              <span className="d">{fdate(ep.published_at)}</span>
            </div>
            <div className="sig-ep__title">{ep.title}</div>
            {ep.summary && (
              <div className="sig-ep__summary">
                {ep.summary.trim()}…{' '}
                {safeHttpUrl(ep.url) && <a href={safeHttpUrl(ep.url)} target="_blank" rel="noopener noreferrer">Read the full piece →</a>}
              </div>
            )}
            <div className="sig-ep__calls">
              {ep.calls.map((c: any) => <SignalCall key={c.id} c={c} expanded />)}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
