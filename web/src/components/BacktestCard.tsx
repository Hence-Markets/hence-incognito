/* BacktestCard — an in-conversation historical replay: equity curve vs benchmark
   (inline SVG, no chart dep) + headline stats + a deep link into the full
   #/backtest screen with the spec pre-loaded. */
import { Icon } from './Icon';

export type BacktestResult = {
  curve: { t: number; v: number; b?: number | null }[];
  stats: {
    total_return: number; annualized: number | null; max_drawdown: number;
    win_days: number; trade_days: number; benchmark: string;
    benchmark_return: number | null; excess: number | null; days: number;
  };
  legs: { symbol: string; direction: string; weight: number; return: number; contribution: number }[];
  stopped_at?: number | null;
  spec?: any;
};

const pct = (v: number | null | undefined, signed = true) =>
  v == null ? '—' : (signed && v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

function Curve({ curve }: { curve: BacktestResult['curve'] }) {
  if (!curve || curve.length < 2) return null;
  const W = 560, H = 120, P = 4;
  const vs = curve.map((p) => p.v);
  const bs = curve.map((p) => p.b).filter((b): b is number => b != null);
  const lo = Math.min(...vs, ...(bs.length ? bs : vs));
  const hi = Math.max(...vs, ...(bs.length ? bs : vs));
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / (curve.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const path = (get: (p: any) => number | null | undefined) => {
    let d = '';
    curve.forEach((p, i) => {
      const v = get(p);
      if (v == null) return;
      d += (d ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    });
    return d;
  };
  const up = curve[curve.length - 1].v >= 1;
  return (
    <svg className="btcard__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line x1={P} x2={W - P} y1={y(1)} y2={y(1)} stroke="currentColor" opacity="0.14" strokeDasharray="3 4" />
      {bs.length ? <path d={path((p) => p.b)} fill="none" stroke="currentColor" opacity="0.30" strokeWidth="1.4" /> : null}
      <path d={path((p) => p.v)} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.8" />
    </svg>
  );
}

export function BacktestCard({ result }: { result: BacktestResult }) {
  const s = result.stats;
  const openFull = () => {
    if (!result.spec) return;
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(result.spec))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.hash = '#/backtest?spec=' + enc;
  };
  return (
    <div className="btcard">
      <div className="btcard__head">
        <b>Backtest</b>
        <span className="btcard__meta">{s.days}d · vs {s.benchmark}{result.stopped_at ? ' · stopped out' : ''}</span>
        {result.spec ? (
          <button className="btcard__open" onClick={openFull}>Open in Backtest <Icon name="arrowRight" size={12} /></button>
        ) : null}
      </div>
      <Curve curve={result.curve} />
      <div className="btcard__stats">
        <div><span>Total</span><b className={s.total_return >= 0 ? 'up' : 'down'}>{pct(s.total_return)}</b></div>
        <div><span>Max DD</span><b className="down">{pct(s.max_drawdown, false)}</b></div>
        <div><span>vs {s.benchmark}</span><b className={(s.excess ?? 0) >= 0 ? 'up' : 'down'}>{pct(s.excess)}</b></div>
        <div><span>Win days</span><b>{s.trade_days ? Math.round((s.win_days / s.trade_days) * 100) + '%' : '—'}</b></div>
      </div>
      {result.legs?.length > 1 ? (
        <div className="btcard__legs">
          {result.legs.map((l, i) => (
            <span key={i} className="btcard__leg">
              {l.symbol} <em className={l.direction === 'long' ? 'up' : 'down'}>{l.direction}</em> {pct(l.return)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
