/* Analyst coverage — FMP-backed Estimates / Ratings / Multiples. */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Segmented } from '../components/Segmented';
import { SvgChart } from '../components/SvgChart';
import { icon, fmtPct, cls } from '../lib/ui.js';
import { openCommandPalette } from './command.js';
import { barChart } from '../lib/charts.js';
import { getTicker } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { useMarketReady } from '../hooks/useMarket';
import { Skeleton, PanelLoader } from '../components/Loading';

const METRICS = ['Revenue', 'EBITDA', 'EBIT', 'Net Income', 'EPS'];

const EST_FIELD: Record<string, { est: string; rep: string; money: boolean }> = {
  Revenue: { est: 'revenueAvg', rep: 'revenue', money: true },
  EBITDA: { est: 'ebitdaAvg', rep: 'ebitda', money: true },
  EBIT: { est: 'ebitAvg', rep: 'operatingIncome', money: true },
  'Net Income': { est: 'netIncomeAvg', rep: 'netIncome', money: true },
  EPS: { est: 'epsAvg', rep: 'eps', money: false },
};

type RemoteStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type Remote<T> = { status: RemoteStatus; data: T | null };
const idleRemote = <T,>(): Remote<T> => ({ status: 'idle', data: null });

function finiteNumber(value: any): number | null {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(value: number, money: boolean) {
  if (!money) return value.toFixed(2);
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toFixed(2);
}

function yearOf(row: any): string {
  const value = row?.fiscalYear || row?.calendarYear || String(row?.date || '').slice(0, 4);
  return /^\d{4}$/.test(String(value)) ? String(value) : '';
}

function tintOf(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return '130,130,140';
  const h = match[1];
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}

function CoverageState({ kind, sym }: { kind: 'loading' | 'empty' | 'error'; sym: string }) {
  if (kind === 'loading') return <PanelLoader label="Loading verified analyst data" size={26} />;
  return (
    <div className="cover__empty" style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--dim)' }}>
      <div style={{ opacity: 0.5, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: icon('analyze', 28) }} />
      <div style={{ fontSize: 15, color: 'var(--text)' }}>
        {kind === 'error' ? 'Analyst data is unavailable right now' : `No analyst data was returned for ${sym}`}
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {kind === 'error' ? 'The data provider request failed. Try again later.' : 'No placeholder estimates or forecasts are shown.'}
      </div>
    </div>
  );
}

function EstimatesView({
  sym,
  metric,
  onMetricToggle,
  remote,
}: {
  sym: string;
  metric: string;
  onMetricToggle: () => void;
  remote: Remote<{ est: any[]; inc: any[] }>;
}) {
  const map = EST_FIELD[metric];
  const model = useMemo(() => {
    if (remote.status !== 'ready' || !remote.data || !map) return null;
    const reported: Record<string, number> = {};
    const estimates: Record<string, number> = {};

    for (const row of remote.data.inc) {
      const year = yearOf(row);
      const value = finiteNumber(row?.[map.rep]);
      if (year && value != null) reported[year] = value;
    }
    for (const row of remote.data.est) {
      const year = yearOf(row);
      const value = finiteNumber(row?.[map.est]);
      if (year && value != null) estimates[year] = value;
    }

    const years = Array.from(new Set([...Object.keys(reported), ...Object.keys(estimates)]))
      .sort((a, b) => Number(a) - Number(b))
      .slice(-8);
    if (!years.length) return null;
    return { reported, estimates, years };
  }, [remote, map]);

  const chartHtml = useMemo(() => {
    if (!model || !map) return null;
    const points = model.years
      .map((year) => {
        if (model.reported[year] != null) return { year, value: model.reported[year], forecast: false };
        if (model.estimates[year] != null) return { year, value: model.estimates[year], forecast: true };
        return null;
      })
      .filter(Boolean) as { year: string; value: number; forecast: boolean }[];
    if (points.length < 2) return null;
    const divisor = map.money ? 1e9 : 1;
    return barChart(points.map((point) => point.value / divisor), {
      w: 860,
      h: 190,
      colors: points.map((point) => point.forecast ? 'rgba(244,170,110,0.85)' : 'rgba(255,255,255,0.42)'),
    });
  }, [model, map]);

  const body = remote.status === 'idle' || remote.status === 'loading'
    ? <CoverageState kind="loading" sym={sym} />
    : remote.status === 'error'
      ? <CoverageState kind="error" sym={sym} />
      : !model
        ? <CoverageState kind="empty" sym={sym} />
        : (
          <>
            <table className="dtable" data-est-table="">
              <thead>
                <tr>
                  <th>{metric} in USD</th>
                  {model.years.map((year) => <th key={year}>{year}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="rowlabel">Reported</td>
                  {model.years.map((year) => <td key={year}>{model.reported[year] == null ? '—' : compact(model.reported[year], map.money)}</td>)}
                </tr>
                <tr>
                  <td className="rowlabel">Consensus estimate</td>
                  {model.years.map((year) => <td className={model.estimates[year] == null ? '' : 'estcol'} key={year}>{model.estimates[year] == null ? '—' : compact(model.estimates[year], map.money)}</td>)}
                </tr>
              </tbody>
            </table>
            <div className="cover__charts">
              <div className="cover__chart" style={{ width: '100%' }}>
                <h4>Annual {metric.toLowerCase()}</h4>
                <div className="leg">
                  <span><i style={{ background: 'rgba(255,255,255,.5)' }}></i>Reported</span>
                  <span><i style={{ background: 'var(--peach)' }}></i>Consensus estimate</span>
                </div>
                {chartHtml ? <SvgChart html={chartHtml} className="" /> : <div className="muted" style={{ padding: 28 }}>Not enough verified observations to draw a chart.</div>}
              </div>
            </div>
            <div className="cover-copyright">Source: Financial Modeling Prep via the Hence server proxy.</div>
          </>
        );

  return (
    <>
      {body}
      <div className="cover__metric">
        <button className="metric-select" data-metric-toggle="" onClick={onMetricToggle}>
          <Icon name="chevDown" size={14} /> {metric} <Icon name="search" size={14} />
        </button>
      </div>
    </>
  );
}

function RatingsView({
  sym,
  remote,
  price,
}: {
  sym: string;
  remote: Remote<{ grades: any; target: any; actions: any[] }>;
  price: number | null;
}) {
  if (remote.status === 'idle' || remote.status === 'loading') return <CoverageState kind="loading" sym={sym} />;
  if (remote.status === 'error') return <CoverageState kind="error" sym={sym} />;
  if (remote.status === 'empty' || !remote.data) return <CoverageState kind="empty" sym={sym} />;

  const { grades, target, actions } = remote.data;
  const buckets = [
    ['Strong sell', finiteNumber(grades?.strongSell) || 0, 'var(--down)'],
    ['Sell', finiteNumber(grades?.sell) || 0, 'rgba(244,170,110,0.85)'],
    ['Hold', finiteNumber(grades?.hold) || 0, 'rgba(255,255,255,0.45)'],
    ['Buy', finiteNumber(grades?.buy) || 0, 'rgba(95,207,145,0.7)'],
    ['Strong buy', finiteNumber(grades?.strongBuy) || 0, 'var(--up)'],
  ] as [string, number, string][];
  const total = buckets.reduce((sum, bucket) => sum + bucket[1], 0);
  const consensus = String(grades?.consensus || '').trim();
  const targetConsensus = finiteNumber(target?.targetConsensus);
  const hasTarget = [target?.targetLow, target?.targetMedian, target?.targetConsensus, target?.targetHigh].some((value) => finiteNumber(value) != null);
  const upside = targetConsensus != null && price != null && price > 0 ? ((targetConsensus - price) / price) * 100 : null;

  if (!total && !consensus && !hasTarget && !(actions && actions.length)) return <CoverageState kind="empty" sym={sym} />;

  const targetCell = (label: string, value: any) => {
    const number = finiteNumber(value);
    return <div className="cover__ptcell"><span className="muted">{label}</span><b>{number == null ? '—' : market.fmtPrice(number)}</b></div>;
  };

  return (
    <div data-ratings-real="">
      {total || consensus ? (
        <div className="cover__ratecard">
          <div className="cover__ratehd"><span>Analyst consensus{consensus ? <> · <b>{consensus}</b></> : null}</span><span className="muted">{total || '—'} ratings</span></div>
          {total ? <div className="cover__ratebar">{buckets.filter((bucket) => bucket[1] > 0).map(([label, value, color]) => <span aria-label={`${label}: ${value}`} key={label} style={{ flex: value, background: color }} />)}</div> : null}
          {total ? <div className="cover__ratelegend">{buckets.map(([label, value, color]) => <span className="rate-leg" key={label}><i style={{ background: color }} />{label} <b>{value}</b></span>)}</div> : null}
        </div>
      ) : null}
      {hasTarget ? (
        <div className="cover__ptcard">
          <div className="cover__pthd">Price target {upside == null ? null : <span className={'pill ' + cls(upside)}>{fmtPct(upside)}</span>}</div>
          <div className="cover__ptrow">
            {targetCell('Low', target?.targetLow)}
            {targetCell('Median', target?.targetMedian)}
            {targetCell('Consensus', target?.targetConsensus)}
            {targetCell('High', target?.targetHigh)}
          </div>
        </div>
      ) : null}
      {Array.isArray(actions) && actions.length ? (
        <div className="cover__ratecard" style={{ marginTop: 12 }}>
          <div className="cover__ratehd"><span>Recent rating changes</span><span className="muted">{actions.length} action{actions.length === 1 ? '' : 's'}</span></div>
          <table className="dtable cover__actions">
            <thead><tr><th>Firm</th><th>Action</th><th>Rating</th><th className="r">Date</th></tr></thead>
            <tbody>
              {actions.slice(0, 12).map((a: any, i: number) => {
                const act = String(a.action || '').toLowerCase();
                const cx = act === 'upgrade' ? 'up' : act === 'downgrade' ? 'down' : 'muted';
                const rating = a.previousGrade && a.newGrade && a.previousGrade !== a.newGrade ? `${a.previousGrade} → ${a.newGrade}` : (a.newGrade || a.previousGrade || '—');
                return (
                  <tr key={i}>
                    <td className="rowlabel">{a.gradingCompany || '—'}</td>
                    <td className={cx} style={{ textTransform: 'capitalize' }}>{a.action || '—'}</td>
                    <td>{rating}</td>
                    <td className="r muted">{a.date || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="cover-copyright">Source: Financial Modeling Prep via the Hence server proxy.</div>
    </div>
  );
}

function MultiplesView({ sym, remote }: { sym: string; remote: Remote<{ ratios: any; metrics: any }> }) {
  if (remote.status === 'idle' || remote.status === 'loading') return <CoverageState kind="loading" sym={sym} />;
  if (remote.status === 'error') return <CoverageState kind="error" sym={sym} />;
  if (remote.status === 'empty' || !remote.data) return <CoverageState kind="empty" sym={sym} />;

  const r = remote.data.ratios || {};
  const k = remote.data.metrics || {};
  const candidates: [string, any, 'ratio' | 'percent'][] = [
    ['Price / earnings', r.priceToEarningsRatioTTM, 'ratio'],
    ['Price / sales', r.priceToSalesRatioTTM, 'ratio'],
    ['Price / book', r.priceToBookRatioTTM, 'ratio'],
    ['Price / free cash flow', r.priceToFreeCashFlowRatioTTM, 'ratio'],
    ['EV / revenue', k.evToSalesTTM, 'ratio'],
    ['EV / EBITDA', k.evToEBITDATTM, 'ratio'],
    ['Dividend yield', r.dividendYieldTTM, 'percent'],
  ];
  const rows = candidates
    .map(([label, raw, kind]) => [label, finiteNumber(raw), kind] as const)
    .filter(([, value]) => value != null);

  if (!rows.length) return <CoverageState kind="empty" sym={sym} />;

  return (
    <>
      <table className="dtable" data-mult-table="">
        <thead><tr><th>Valuation multiple</th><th>TTM</th></tr></thead>
        <tbody>
          {rows.map(([label, value, kind]) => (
            <tr key={label}><td className="rowlabel">{label}</td><td>{kind === 'percent' ? `${((value as number) * 100).toFixed(2)}%` : (value as number).toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="cover-copyright">Source: Financial Modeling Prep via the Hence server proxy. TTM values only.</div>
    </>
  );
}

function NoCoverage() {
  return (
    <div className="cover__empty" style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--dim)' }}>
      <div style={{ opacity: 0.5, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: icon('analyze', 28) }} />
      <div style={{ fontSize: 15, color: 'var(--text)' }}>No analyst coverage for this asset type</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Estimates, ratings and multiples are available for equities only.</div>
    </div>
  );
}

export default function AnalystCoverage() {
  const { sym: symParam } = useParams();
  const sym = (symParam || 'TSLA').toUpperCase();
  const ready = useMarketReady();
  const ticker = getTicker(sym);
  const hasRealPrice = ready && !!(ticker as any).real && Number.isFinite(Number(ticker.price)) && Number(ticker.price) > 0;
  const hasRealChange = hasRealPrice && Number.isFinite(Number(ticker.chgPct));

  const [tab, setTab] = useState<'Estimates' | 'Ratings' | 'Multiples'>('Estimates');
  const [metric, setMetric] = useState('Revenue');
  const [estimates, setEstimates] = useState<Remote<{ est: any[]; inc: any[] }>>(idleRemote);
  const [ratings, setRatings] = useState<Remote<{ grades: any; target: any; actions: any[] }>>(idleRemote);
  const [multiples, setMultiples] = useState<Remote<{ ratios: any; metrics: any }>>(idleRemote);

  const isEquity = ready && market.assetClass(sym) === 'equity';
  const noCoverage = ready && !isEquity;

  useEffect(() => {
    setEstimates(idleRemote());
    setRatings(idleRemote());
    setMultiples(idleRemote());
  }, [sym]);

  useEffect(() => {
    if (!isEquity) return;
    let alive = true;
    const fs = market.fmpSymbol(sym);

    if (tab === 'Estimates') {
      setEstimates({ status: 'loading', data: null });
      Promise.allSettled([
        fmp.analystEstimates(fs, 'annual', 8),
        fmp.incomeStatement(fs, 'annual', 8),
      ]).then((results) => {
        if (!alive) return;
        const [estResult, incResult] = results;
        if (estResult.status === 'rejected' && incResult.status === 'rejected') {
          setEstimates({ status: 'error', data: null });
          return;
        }
        const est = estResult.status === 'fulfilled' && Array.isArray(estResult.value) ? estResult.value : [];
        const inc = incResult.status === 'fulfilled' && Array.isArray(incResult.value) ? incResult.value : [];
        setEstimates({ status: est.length || inc.length ? 'ready' : 'empty', data: { est, inc } });
      });
    } else if (tab === 'Ratings') {
      setRatings({ status: 'loading', data: null });
      Promise.allSettled([fmp.grades(fs), fmp.priceTarget(fs), fmp.gradesHistory(fs, 14)]).then((results) => {
        if (!alive) return;
        const [gradesResult, targetResult, actionsResult] = results;
        if (gradesResult.status === 'rejected' && targetResult.status === 'rejected' && actionsResult.status === 'rejected') {
          setRatings({ status: 'error', data: null });
          return;
        }
        const grades = gradesResult.status === 'fulfilled' ? gradesResult.value : null;
        const target = targetResult.status === 'fulfilled' ? targetResult.value : null;
        const actions = actionsResult.status === 'fulfilled' && Array.isArray(actionsResult.value) ? actionsResult.value : [];
        setRatings({ status: grades || target || actions.length ? 'ready' : 'empty', data: { grades, target, actions } });
      });
    } else {
      setMultiples({ status: 'loading', data: null });
      Promise.allSettled([fmp.ratiosTtm(fs), fmp.keyMetricsTtm(fs)]).then((results) => {
        if (!alive) return;
        const [ratiosResult, metricsResult] = results;
        if (ratiosResult.status === 'rejected' && metricsResult.status === 'rejected') {
          setMultiples({ status: 'error', data: null });
          return;
        }
        const ratiosData = ratiosResult.status === 'fulfilled' ? ratiosResult.value : null;
        const metricsData = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
        setMultiples({ status: ratiosData || metricsData ? 'ready' : 'empty', data: { ratios: ratiosData, metrics: metricsData } });
      });
    }

    return () => { alive = false; };
  }, [sym, tab, isEquity]);

  function openMetricDropdown() {
    openCommandPalette({
      scope: {
        id: 'metric-' + sym,
        label: sym,
        sym,
        meta: hasRealChange ? `${ticker.chg.toFixed(2)}  ${fmtPct(ticker.chgPct)}` : '',
        placeholder: 'Select a metric',
        radio: true,
        groups: [{
          title: 'Analyst Estimates',
          items: METRICS.map((item) => ({ label: item, icon: 'filter', checked: item === metric, run: () => setMetric(item) })),
        }],
      },
    });
  }

  return (
    <div className="cover brand-vignette" style={{ ['--tint' as any]: `rgba(${tintOf(ticker.color)},0.16)` }}>
      <div className="cover__head">
        <a className="icon-btn" href={`#/stock/${sym}/analyst`}><Icon name="close" size={18} /></a>
        <div className="cover__title">
          <Logo sym={sym} size={24} /> {sym} Analyst coverage{' '}
          {!ready ? <Skeleton w={104} h={22} r={11} />
            : hasRealChange ? <span className={'pill ' + cls(ticker.chg)}>{ticker.chg.toFixed(2)} ({fmtPct(ticker.chgPct)})</span>
              : hasRealPrice ? <span className="pill">{market.fmtPrice(ticker.price)} <span className="muted">—</span></span>
                : <span className="pill muted">Price unavailable</span>}
        </div>
        <div className="cover__tabs">
          <Segmented options={['Estimates', 'Ratings', 'Multiples']} value={tab} onChange={(option) => setTab(option as any)} />
        </div>
      </div>

      {!ready ? <CoverageState kind="loading" sym={sym} />
        : noCoverage ? <NoCoverage />
          : tab === 'Estimates' ? <EstimatesView sym={sym} metric={metric} onMetricToggle={openMetricDropdown} remote={estimates} />
            : tab === 'Ratings' ? <RatingsView sym={sym} remote={ratings} price={hasRealPrice ? Number(ticker.price) : null} />
              : <MultiplesView sym={sym} remote={multiples} />}
    </div>
  );
}
