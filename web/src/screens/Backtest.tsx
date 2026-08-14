/* =========================================================================
   Backtest — replay a multi-leg thesis against real Hyperliquid daily closes.
   Spec builder (≤4 perp/stock legs w/ direction + weight, entry date, horizon,
   whole-portfolio stop %, benchmark) → POST /api/backtest → equity curve vs
   benchmark + stats grid + per-leg contribution. Saved specs live in
   localStorage (hence.backtests, max 20 — spec + headline stat only).
   Deep link: #/backtest?spec=<base64url(JSON)> prefLoads + auto-runs (the
   assistant's PlanCard/BacktestCard emit these).
   ========================================================================= */
import { track } from '../lib/analytics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { SvgChart } from '../components/SvgChart';
import { Skeleton } from '../components/Loading';
import { searchMarkets } from '../lib/marketSearch';
import { useMarketReady } from '../hooks/useMarket';
// @ts-ignore — JS module
import { multiLine } from '../lib/charts.js';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';
import '../styles/backtest.css';

type Leg = { symbol: string; direction: 'long' | 'short'; weight: number };
type Spec = {
  legs: Leg[];
  entry: { date: string };
  exit: { horizon_days: number; stop_pct?: number | null; target_pct?: number | null };
  benchmark: 'BTC' | 'SP500';
};
type Result = {
  error?: string;
  curve: { t: number; v: number; b?: number | null }[];
  stats: any; legs: any[]; stopped_at?: number | null; entry?: number; end?: number; cached?: boolean;
};

const HORIZONS = [30, 90, 180, 365, 730];
const SAVED_KEY = 'hence.backtests';
const ymdAgo = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
const pct = (v: number | null | undefined, signed = true) =>
  v == null ? '—' : (signed && v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

const b64uEncode = (o: any) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDecode = (s: string) => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; } };

function loadSaved(): { spec: Spec; total?: number; ts: number }[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.spec && Array.isArray(x.spec.legs)) : [];
  } catch { return []; }
}
function pushSaved(entry: { spec: Spec; total?: number; ts: number }) {
  try {
    const cur = loadSaved().filter((x) => JSON.stringify(x.spec) !== JSON.stringify(entry.spec));
    cur.unshift(entry);
    localStorage.setItem(SAVED_KEY, JSON.stringify(cur.slice(0, 20)));
  } catch { /* storage disabled */ }
}

/* symbol input with the shared universe autocomplete */
function SymInput({ value, onPick }: { value: string; onPick: (s: string) => void }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const ready = useMarketReady();
  useEffect(() => setQ(value), [value]);
  const hits = useMemo(() => (ready && open && q.trim() ? searchMarkets(q.trim(), { liveOnly: true, limit: 6 }) : []), [q, open, ready]);
  return (
    <div className="bts__sym">
      <input value={q} placeholder="Symbol" spellCheck={false}
        onChange={(e) => { setQ(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length ? (
        <div className="bts__symdrop">
          {hits.map((h: any) => (
            <button key={h.sym} onMouseDown={(e) => { e.preventDefault(); onPick(h.sym); setQ(h.sym); setOpen(false); }}>
              <Logo sym={h.sym} size={14} /> <b>{h.sym}</b> <span>{h.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Backtest() {
  const loc = useLocation();
  const [legs, setLegs] = useState<Leg[]>([{ symbol: 'BTC', direction: 'long', weight: 1 }]);
  const [entryDate, setEntryDate] = useState(ymdAgo(180));
  const [horizon, setHorizon] = useState(180);
  const [stopPct, setStopPct] = useState('');
  const [benchmark, setBenchmark] = useState<'BTC' | 'SP500'>('BTC');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(loadSaved());
  const ranFromLink = useRef(false);

  const spec = (): Spec => ({
    legs: legs.filter((l) => l.symbol.trim()),
    entry: { date: entryDate },
    exit: { horizon_days: horizon, stop_pct: stopPct ? Number(stopPct) : null },
    benchmark,
  });

  const run = async (s?: Spec) => {
    const body = s || spec();
    if (!body.legs.length) { toast('Add at least one leg', { icon: 'card' }); return; }
    track('backtest_run', { legs: body.legs.length, horizon: body.exit.horizon_days, source: 'screen' });
    setRunning(true);
    try {
      const r = await fetch('/api/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((x) => x.json());
      setResult(r);
      if (r.error) toast(r.error, { icon: 'close' });
    } catch {
      toast('Backtest failed — try again', { icon: 'close' });
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const applySpec = (s: Spec) => {
    setLegs((s.legs || []).slice(0, 4).map((l) => ({ symbol: String(l.symbol || '').toUpperCase(), direction: l.direction === 'short' ? 'short' : 'long', weight: Number(l.weight) || 1 })));
    if (s.entry?.date) setEntryDate(String(s.entry.date).slice(0, 10));
    if (s.exit?.horizon_days) setHorizon(Number(s.exit.horizon_days) || 180);
    setStopPct(s.exit?.stop_pct ? String(s.exit.stop_pct) : '');
    setBenchmark(s.benchmark === 'SP500' ? 'SP500' : 'BTC');
  };

  // deep link ?spec=<base64url> → prefill + auto-run (once)
  useEffect(() => {
    if (ranFromLink.current) return;
    const enc = new URLSearchParams(loc.search).get('spec');
    if (!enc) return;
    const s = b64uDecode(enc);
    if (s && Array.isArray(s.legs)) {
      ranFromLink.current = true;
      applySpec(s);
      setTimeout(() => run(s), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search]);

  const saveCurrent = () => {
    pushSaved({ spec: spec(), total: result?.stats?.total_return, ts: Date.now() });
    setSaved(loadSaved());
    toast('Backtest saved', { icon: 'check' });
  };

  const chart = useMemo(() => {
    if (!result || result.error || !result.curve?.length) return '';
    const vs = result.curve.map((p) => p.v);
    const series: any[] = [{ values: vs, color: vs[vs.length - 1] >= 1 ? 'var(--up)' : 'var(--down)', sw: 1.8 }];
    const bs = result.curve.map((p) => p.b);
    if (bs.some((b) => b != null)) series.push({ values: bs.map((b, i) => b ?? (i ? bs[i - 1] ?? 1 : 1)) as number[], color: 'color-mix(in srgb, currentColor 32%, transparent)', sw: 1.2, dash: '3 4' });
    return multiLine(series, { w: 720, h: 240, pad: 6 });
  }, [result]);

  const s = result?.stats;
  return (
    <Shell>
      <div className="bts">
        <header className="bts__head">
          <h2>Backtest</h2>
          <span className="bts__sub">Replay a thesis against real daily closes — crypto + trade.xyz stocks, commodities, FX, indices</span>
        </header>
        <div className="bts__grid">
          {/* ---- spec builder ---- */}
          <aside className="bts__builder">
            <h5>Legs</h5>
            {legs.map((l, i) => (
              <div key={i} className="bts__leg">
                <SymInput value={l.symbol} onPick={(sym) => setLegs(legs.map((x, j) => (j === i ? { ...x, symbol: sym } : x)))} />
                <div className="bts__dir">
                  <button className={l.direction === 'long' ? 'on up' : ''} onClick={() => setLegs(legs.map((x, j) => (j === i ? { ...x, direction: 'long' } : x)))}>Long</button>
                  <button className={l.direction === 'short' ? 'on down' : ''} onClick={() => setLegs(legs.map((x, j) => (j === i ? { ...x, direction: 'short' } : x)))}>Short</button>
                </div>
                <input className="bts__w" type="number" min={0.1} step={0.5} value={l.weight}
                  title="Relative weight (normalized)"
                  onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 1 } : x)))} />
                {legs.length > 1 && <button className="bts__x" onClick={() => setLegs(legs.filter((_, j) => j !== i))} aria-label="Remove leg"><Icon name="close" size={12} /></button>}
              </div>
            ))}
            {legs.length < 4 && <button className="bts__add" onClick={() => setLegs([...legs, { symbol: '', direction: 'long', weight: 1 }])}><Icon name="plus" size={12} /> Add leg</button>}
            <h5>Window</h5>
            <label className="bts__field"><span>Entry date</span>
              <input type="date" value={entryDate} min="2020-01-01" max={new Date().toISOString().slice(0, 10)} onChange={(e) => setEntryDate(e.target.value)} /></label>
            <label className="bts__field"><span>Horizon</span>
              <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                {HORIZONS.map((h) => <option key={h} value={h}>{h} days</option>)}
              </select></label>
            <label className="bts__field"><span>Stop (whole portfolio)</span>
              <div className="bts__pctin"><input type="number" min={1} max={95} placeholder="none" value={stopPct} onChange={(e) => setStopPct(e.target.value)} /><em>%</em></div></label>
            <label className="bts__field"><span>Benchmark</span>
              <div className="bts__dir">
                <button className={benchmark === 'BTC' ? 'on' : ''} onClick={() => setBenchmark('BTC')}>BTC</button>
                <button className={benchmark === 'SP500' ? 'on' : ''} onClick={() => setBenchmark('SP500')}>S&P 500</button>
              </div></label>
            <button className="bts__run" disabled={running} onClick={() => run()}>{running ? 'Replaying…' : 'Run backtest'}</button>
            <p className="bts__note">Daily closes, look-ahead-safe entry (first candle at/after the date). History, not a forecast.</p>
          </aside>

          {/* ---- results ---- */}
          <section className="bts__results">
            {running ? (
              <div className="bts__loading"><Skeleton w={280} h={16} /><Skeleton w={720} h={220} /></div>
            ) : result && !result.error ? (
              <>
                <div className="bts__rhead">
                  <b className={s.total_return >= 0 ? 'up' : 'down'}>{pct(s.total_return)}</b>
                  <span>{fmtDate(result.entry)} → {fmtDate(result.end)} · vs {s.benchmark} (dashed){result.stopped_at ? ' · stopped out ' + fmtDate(result.stopped_at) : ''}{result.cached ? ' · cached' : ''}</span>
                  <button className="bts__save" onClick={saveCurrent}><Icon name="bookmark" size={13} /> Save</button>
                </div>
                <SvgChart className="bts__chart" html={chart} />
                <div className="bts__stats">
                  <div><span>Total</span><b className={s.total_return >= 0 ? 'up' : 'down'}>{pct(s.total_return)}</b></div>
                  <div><span>Annualized</span><b>{pct(s.annualized)}</b></div>
                  <div><span>Max drawdown</span><b className="down">{pct(s.max_drawdown, false)}</b></div>
                  <div><span>vs {s.benchmark}</span><b className={(s.excess ?? 0) >= 0 ? 'up' : 'down'}>{pct(s.excess)}</b></div>
                  <div><span>Win days</span><b>{s.trade_days ? Math.round((s.win_days / s.trade_days) * 100) + '%' : '—'}</b></div>
                  <div><span>Best / worst day</span><b>{pct(s.best_day)} / {pct(s.worst_day)}</b></div>
                </div>
                {result.legs?.length ? (
                  <table className="bts__legs">
                    <thead><tr><th>Leg</th><th>Direction</th><th>Weight</th><th className="r">Return</th><th className="r">Contribution</th></tr></thead>
                    <tbody>
                      {result.legs.map((l: any, i: number) => (
                        <tr key={i}>
                          <td><Logo sym={l.symbol} size={15} /> {l.symbol}</td>
                          <td className={l.direction === 'long' ? 'up' : 'down'}>{l.direction}</td>
                          <td>{Math.round(l.weight * 100)}%</td>
                          <td className={'r ' + (l.return >= 0 ? 'up' : 'down')}>{pct(l.return)}</td>
                          <td className={'r ' + (l.contribution >= 0 ? 'up' : 'down')}>{pct(l.contribution)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            ) : (
              <div className="bts__empty">
                <Icon name="candles" size={22} />
                <b>{result?.error ? result.error : 'Build a spec and run it'}</b>
                <span>Up to 4 legs across crypto and trade.xyz markets. The copilot can also open pre-filled backtests from a chat.</span>
              </div>
            )}

            {saved.length ? (
              <div className="bts__saved">
                <h5>Saved backtests</h5>
                <div className="bts__savedrow">
                  {saved.map((x, i) => (
                    <button key={i} className="bts__savedcard" onClick={() => { applySpec(x.spec); run(x.spec); }}>
                      <b>{x.spec.legs.map((l) => (l.direction === 'short' ? '−' : '') + l.symbol).join(' · ')}</b>
                      <span>{x.spec.entry.date} · {x.spec.exit.horizon_days}d{x.total != null ? ' · ' + pct(x.total) : ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </Shell>
  );
}
