/* Per-show list — newest ⇄ best-vs-BTC, filterable by speaker (the differentiator: we rank
   by excess return, not raw %). Mirrors paste.trade's show page, scored our way. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/Segmented';
import { SignalCall, pct } from '../components/signals-ui';
import { PanelLoader, SkeletonValue } from '../components/Loading';
import * as signals from '../lib/signals.js';

const SORTS: Record<string, string> = { Newest: 'newest', 'Best vs BTC': 'pnl' };

export default function SignalShow() {
  const { id } = useParams();
  const [sortLabel, setSortLabel] = useState('Newest');
  const [speaker, setSpeaker] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [down, setDown] = useState(false);

  // On show→show navigation the [id] changes but data still holds the PREVIOUS
  // show's list — clear it so the loader (gated on !data) shows instead of stale rows.
  useEffect(() => { setData(null); setSpeaker(null); }, [id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    signals.show(id, SORTS[sortLabel], speaker || undefined).then((r: any) => {
      if (!alive) return;
      if (r.available === false) { setDown(true); setLoading(false); return; }
      setData(r.show); setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, sortLabel, speaker]);

  if (down) {
    return (
      <Shell dockActive="signals">
        <div className="sig">
          <a className="sig-back" href="#/signals"><Icon name="back" size={13} /> Signals</a>
          <div className="muted" style={{ marginTop: 30, fontSize: 13 }}>The signals database isn’t running.</div>
        </div>
      </Shell>
    );
  }

  const src = data?.source;
  const h = data?.header || {};
  const speakers = data?.speakers || [];
  const calls = data?.calls || [];
  return (
    <Shell dockActive="signals">
      <div className="sig sig-srcpage">
        <a className="sig-back" href={`#/signals/source/${id}`}><Icon name="back" size={13} /> Breakdown</a>
        <div className="sig-showhead">
          <h1>{src ? src.name : <SkeletonValue w={180} />}</h1>
          {src ? (
            <div className="sig-srcstats">
              <span>{h.episodes} {src.kind === 'newsletter' ? 'issues' : 'episodes'}</span>
              <span>{h.trades} trades</span>
              <span>{h.speakers} {h.speakers === 1 ? 'voice' : 'voices'}</span>
              {h.beat_rate != null && <span className="hl">{(h.beat_rate * 100).toFixed(0)}% beat BTC</span>}
            </div>
          ) : (
            // Skeleton stat pills until the header lands — never flash empty cells.
            <div className="sig-srcstats">
              <span><SkeletonValue w={64} /></span>
              <span><SkeletonValue w={56} /></span>
              <span><SkeletonValue w={52} /></span>
            </div>
          )}
        </div>

        <div className="sig-showbar">
          <Segmented options={['Newest', 'Best vs BTC']} value={sortLabel} onChange={(o) => setSortLabel(o as string)} />
        </div>

        {speakers.length > 1 && (
          <div className="sig-speakers">
            <button className={'sig-spk' + (speaker == null ? ' on' : '')} onClick={() => setSpeaker(null)}>
              All <span className="c">{h.trades}</span>
            </button>
            {speakers.map((s: any) => (
              <button key={s.person_id} className={'sig-spk' + (speaker === s.person_id ? ' on' : '')} onClick={() => setSpeaker(s.person_id)}>
                {s.name} <span className="c">{s.count}</span>
              </button>
            ))}
          </div>
        )}

        {loading && !data ? <PanelLoader label="Loading calls…" fill />
          : !calls.length ? <div className="muted" style={{ padding: 24, fontSize: 13 }}>No calls.</div>
            : <div className="sig-calls">{calls.map((c: any) => <SignalCall key={c.id} c={c} />)}</div>}
      </div>
    </Shell>
  );
}
