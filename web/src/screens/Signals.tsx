/* Signals — "what the podcasts & newsletters called, and what happened" (priced vs BTC).
   Calls feed (SignalCall cards) + a credibility-ranked leaderboard across all sources. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/Segmented';
import { SignalCall, pct, upcls } from '../components/signals-ui';
import * as signals from '../lib/signals.js';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';

const HORIZONS = ['live', '7d', '30d'];
const HZ_LABEL: Record<string, string> = { live: 'Since call', '7d': '7-day', '30d': '30-day' };
const LB_ENT: Record<string, string> = { Everyone: 'all', Callers: 'person', Sources: 'source' };

function Leaderboard({ horizon }: { horizon: string }) {
  const [label, setLabel] = useState('Everyone');
  const entity = LB_ENT[label];
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    signals.leaderboard(entity, horizon, 1).then((r) => { if (alive) setRows(r.leaders); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [entity, horizon]);
  const all = entity === 'all';
  return (
    <div className="sig-lb">
      <div className="sig-lb__bar">
        <Segmented options={['Everyone', 'Callers', 'Sources']} value={label} onChange={(o) => setLabel(o as string)} />
        <span className="muted" style={{ fontSize: 11 }}>Ranked by credibility (shrunk excess vs BTC) · {HZ_LABEL[horizon]}</span>
      </div>
      {rows == null ? <div className="generating" style={{ marginTop: 24 }}>Ranking…</div>
        : !rows.length ? <div className="muted" style={{ padding: 24, fontSize: 13 }}>No ranked entries yet for this horizon.</div>
          : (
            <table className="sig-lbt">
              <thead><tr>
                <th className="lbl">#</th><th className="lbl">{all ? 'Caller / Source' : (entity === 'person' ? 'Caller' : 'Source')}</th>
                <th>Calls</th><th>Beat rate</th><th>Excess vs BTC</th><th>Credibility</th>
              </tr></thead>
              <tbody>
                {rows.map((l, i) => (
                  <tr key={(l.entity_type || '') + l.id + i}>
                    <td className="rk">{i + 1}</td>
                    <td className="nm">
                      <b>{l.name}</b>{l.handle && <span className="h">@{l.handle}</span>}
                      {all && <span className={'sig-etype ' + l.entity_type}>{l.entity_type === 'person' ? 'caller' : 'source'}</span>}
                    </td>
                    <td>{l.n}</td>
                    <td>{l.excess_win_rate != null ? (l.excess_win_rate * 100).toFixed(0) + '%' : '—'}</td>
                    <td className={upcls(l.avg_excess)}><b>{pct(l.avg_excess)}</b></td>
                    <td className={upcls(l.credibility)}>{pct(l.credibility)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </div>
  );
}

export default function Signals() {
  const { sym } = useParams();
  const [tab, setTab] = useState<'Calls' | 'Leaderboard'>('Calls');
  const [horizon, setHorizon] = useState('live');
  const [calls, setCalls] = useState<any[] | null>(null);
  const [available, setAvailable] = useState(true);

  // register the "Signals" command scope — view + leaderboard horizon
  useEffect(() => {
    const scope = {
      id: 'signals', label: 'Signals', icon: 'bolt', placeholder: 'Search commands',
      groups: [
        { title: 'View', radio: true, items: (['Calls', 'Leaderboard'] as const).map((v) => ({
          label: v, icon: 'bolt', checked: tab === v, run: () => setTab(v) })) },
        { title: 'Horizon', radio: true, items: HORIZONS.map((h) => ({
          label: HZ_LABEL[h], icon: 'calendar', checked: horizon === h, run: () => { setTab('Leaderboard'); setHorizon(h); } })) },
      ],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
  }, [tab, horizon]);

  useEffect(() => {
    let alive = true;
    setCalls(null);
    signals.recentCalls(40, sym ? sym.toUpperCase() : undefined).then((r) => {
      if (!alive) return;
      setAvailable(r.available); setCalls(r.calls);
    }).catch(() => { if (alive) { setAvailable(false); setCalls([]); } });
    return () => { alive = false; };
  }, [sym]);

  return (
    <Shell dockActive="signals">
      <div className="sig">
        <div className="sig-top">
          <div className="sig-title">
            <button className="icon-btn sig-back" aria-label="Back" onClick={() => history.back()}><Icon name="back" size={18} /></button>
            <Icon name="bolt" size={20} />
            <div>
              <h1>Signals{sym ? <span className="sig-sub-sym"> · {sym.toUpperCase()}</span> : ''}</h1>
              <p>What podcasts &amp; newsletters called — and what actually happened, priced vs BTC.</p>
            </div>
          </div>
          <div className="sig-controls">
            <Segmented options={['Calls', 'Leaderboard']} value={tab} onChange={(o) => setTab(o as any)} />
            {tab === 'Leaderboard' && (
              <Segmented options={HORIZONS.map((h) => HZ_LABEL[h])}
                value={HZ_LABEL[horizon]} onChange={(o) => setHorizon(HORIZONS.find((h) => HZ_LABEL[h] === o) || 'live')} />
            )}
          </div>
        </div>

        {!available ? (
          <div className="sig-empty">
            <Icon name="bolt" size={26} />
            <p>The signals database isn’t running.</p>
            <span>Start local Postgres + serve.py, then run <code>python signals_pipeline.py ingest</code>.</span>
          </div>
        ) : tab === 'Leaderboard' ? (
          <Leaderboard horizon={horizon} />
        ) : calls == null ? (
          <div className="generating" style={{ marginTop: 30 }}>Loading calls…</div>
        ) : !calls.length ? (
          <div className="muted" style={{ padding: 30, fontSize: 13 }}>No calls{sym ? ' for ' + sym.toUpperCase() : ''} yet.</div>
        ) : (
          <div className="sig-calls">
            {calls.map((c) => <SignalCall key={c.id} c={c} />)}
          </div>
        )}
      </div>
    </Shell>
  );
}
