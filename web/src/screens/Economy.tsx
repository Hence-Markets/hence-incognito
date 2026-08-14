import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { getTicker } from '../lib/data.js';
import { fmtPct, cls } from '../lib/ui.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { Skeleton, SkeletonValue } from '../components/Loading';
import { SvgChart } from '../components/SvgChart';
// @ts-ignore — JS module
import { priceChart, divergingArea } from '../lib/charts.js';
import { useMarketReady } from '../hooks/useMarket';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';

const YMD_AGO = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const TODAY = () => new Date().toISOString().slice(0, 10);
// tenor label → treasury-rates field
const CURVE_TENORS: [string, string][] = [['1M', 'month1'], ['3M', 'month3'], ['6M', 'month6'], ['1Y', 'year1'], ['2Y', 'year2'], ['5Y', 'year5'], ['7Y', 'year7'], ['10Y', 'year10'], ['20Y', 'year20'], ['30Y', 'year30']];

/* Real US Treasury yield curve (latest snapshot across tenors) via FMP treasury-rates. */
function TreasuryYieldCurve() {
  const [status, setStatus] = useState<RemoteStatus>('loading');
  const [row, setRow] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fmp.treasuryRates(YMD_AGO(12), TODAY())
      .then((d: any) => { if (!alive) return; const latest = Array.isArray(d) && d.length ? d[0] : null; setRow(latest); setStatus(latest ? 'ready' : 'empty'); })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, []);
  const cols = row ? CURVE_TENORS.filter(([, k]) => Number.isFinite(Number(row[k]))) : [];
  return (
    <div className="card econ-card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 13 }}>US Treasury yield curve</h3>
        {row && <span className="muted" style={{ fontSize: 11 }}>{row.date}</span>}
      </div>
      {status !== 'ready' || cols.length < 2
        ? <div className="muted" style={{ padding: '34px 8px', textAlign: 'center', fontSize: 13 }}>{status === 'loading' ? 'Loading Treasury yields…' : 'Treasury yields are unavailable right now.'}</div>
        : <>
            {/* straight segments (not smoothed) — a yield curve's tenors are unevenly spaced in
                real time, and the smoothed bezier falsely reads as a stair-stepped plateau.
                Hover for the exact yield at each tenor (real, from priceChart's crosshair). */}
            <div style={{ margin: '6px 0 2px' }}>
              <SvgChart className="econ-chart" html={priceChart(cols.map(([, k]) => Number(row[k])), {
                w: 320, h: 150, pad: 8, sw: 1.6, smooth: false, dot: false, nodes: true, nodeColor: '#e6c84f', nodeR: 2.4,
                stroke: '#e6c84f', fill: 'rgba(230,200,79,0.10)',
                labels: cols.map(([l]) => l), fmt: (v: number) => v.toFixed(2) + '%',
              })} />
            </div>
            <div className="muted" style={{ fontSize: 9.5, display: 'flex', justifyContent: 'space-between' }}>{cols.map(([l]) => <span key={l}>{l}</span>)}</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11.5 }}><span className="muted">2Y <b style={{ color: 'var(--text)' }}>{Number(row.year2).toFixed(2)}%</b></span><span className="muted">10Y <b style={{ color: 'var(--text)' }}>{Number(row.year10).toFixed(2)}%</b></span><span className="muted">30Y <b style={{ color: 'var(--text)' }}>{Number(row.year30).toFixed(2)}%</b></span></div>
          </>}
    </div>
  );
}

/* Real 2s10s spread over ~4 months (10Y − 2Y) via FMP treasury-rates; green above 0, red inverted. */
function Treasury2s10s() {
  const [status, setStatus] = useState<RemoteStatus>('loading');
  const [series, setSeries] = useState<number[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fmp.treasuryRates(YMD_AGO(125), TODAY())
      .then((d: any) => {
        if (!alive) return;
        const rows = Array.isArray(d) ? d.slice().reverse() : []; // API returns newest-first → chronological
        // keep date + spread zipped so hover labels stay aligned with their real value
        const pts = rows
          .map((r: any) => ({ date: r.date, v: Number(r.year10) - Number(r.year2) }))
          .filter((p: any) => Number.isFinite(p.v));
        setSeries(pts.map((p: any) => p.v)); setDates(pts.map((p: any) => p.date));
        setCur(pts.length ? pts[pts.length - 1].v : null); setStatus(pts.length > 1 ? 'ready' : 'empty');
      })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, []);
  const inverted = cur != null && cur < 0;
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 13 }}>2s10s spread</h3>
        {cur != null && <span className={inverted ? 'down' : 'up'} style={{ fontSize: 12, fontWeight: 600 }}>{(cur >= 0 ? '+' : '') + Math.round(cur * 100)} bps{inverted ? ' · inverted' : ''}</span>}
      </div>
      {status !== 'ready'
        ? <div className="muted" style={{ padding: '42px 8px', textAlign: 'center', fontSize: 13 }}>{status === 'loading' ? 'Loading Treasury spread…' : 'Treasury spread is unavailable right now.'}</div>
        : <>
            <div style={{ marginTop: 6 }}>
              <SvgChart className="econ-chart" html={divergingArea(series, {
                w: 320, h: 150, labels: dates,
                fmt: (v: number) => (v >= 0 ? '+' : '') + Math.round(v * 100) + ' bps',
              })} />
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>10Y minus 2Y · last ~4 months · below zero = inverted (a recession signal)</div>
          </>}
    </div>
  );
}

type RemoteStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type EconRow = { event: string; ccy: string; previous: string; actual: string; forecast: string; when: string; impact: number };
type InsiderRow = { who: string; tk: string; type: 'Purchase' | 'Sale' | 'Other'; valM: number | null; date: string };

const MARKET_GROUPS: [string, [string, string, string][]][] = [
  ['Broad market', [['S&P 500', 'SP500', 'USA'], ['Volatility Index', 'VIX', 'USA'], ['US Dollar Index', 'DXY', 'USA']]],
  ['Commodities', [['Gold', 'GOLD', 'Global'], ['Silver', 'SILVER', 'Global'], ['Copper', 'COPPER', 'Global'], ['Uranium', 'URANIUM', 'Global'], ['Natural Gas', 'NATGAS', 'Global'], ['Brent Crude', 'BRENTOIL', 'Global']]],
  ['Currencies and digital assets', [['Euro', 'EUR', 'FX'], ['Japanese Yen', 'JPY', 'FX'], ['Bitcoin', 'BTC', 'Digital'], ['Ethereum', 'ETH', 'Digital']]],
];

const SNAPSHOT = MARKET_GROUPS.flatMap(([, rows]) => rows).slice(0, 5);
const YMD = (date: Date) => date.toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMPACT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function fmtEconWhen(raw: any): string {
  const input = String(raw || '');
  const date = new Date(input.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(input) ? '' : 'Z'));
  if (Number.isNaN(+date)) return input || '—';
  let hour = date.getHours();
  const suffix = hour < 12 ? 'AM' : 'PM';
  hour = hour % 12 || 12;
  return `${MONTHS[date.getMonth()]} ${date.getDate()} · ${hour}:${String(date.getMinutes()).padStart(2, '0')} ${suffix}`;
}

function fmtEconValue(value: any, unit: any) {
  if (value == null || value === '') return '—';
  const suffix = unit && String(unit).length <= 3 ? String(unit) : '';
  return `${value}${suffix}`;
}

function EconCalRow({ row }: { row: EconRow }) {
  const impact = Math.max(0, Math.min(3, row.impact | 0));
  return (
    <div className="cal-grid">
      <span className="cal-name"><span className="flag">{row.ccy[0] || '—'}</span>{row.event}</span>
      <span className="chip-gray">{row.ccy}</span>
      <span>{row.previous}</span>
      <span className="actual">{row.actual}</span>
      <span>{row.forecast}</span>
      <span className="muted">{row.when}</span>
      <span className="impact">{[0, 1, 2].map((index) => <i key={index} className={index < impact ? 'on' : ''} />)}</span>
    </div>
  );
}

function EconCalRowSkeleton() {
  return (
    <div className="cal-grid">
      <span className="cal-name"><Skeleton w={14} h={14} r={3} /><Skeleton w={110} h={11} /></span>
      <span><SkeletonValue w={30} /></span><span><SkeletonValue w={40} /></span>
      <span><SkeletonValue w={40} /></span><span><SkeletonValue w={40} /></span>
      <span><SkeletonValue w={78} /></span><span className="impact"><Skeleton w={26} h={8} r={4} /></span>
    </div>
  );
}

function DataState({ status, empty, error }: { status: RemoteStatus; empty: string; error: string }) {
  if (status !== 'empty' && status !== 'error') return null;
  return <div className="muted" role="status" style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13 }}>{status === 'error' ? error : empty}</div>;
}

function EconomicsView() {
  const [status, setStatus] = useState<RemoteStatus>('loading');
  const [rows, setRows] = useState<EconRow[]>([]);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const to = new Date(now.getTime() + 14 * 864e5);
    setStatus('loading');
    fmp.economicCalendar(YMD(now), YMD(to)).then((data) => {
      if (!alive) return;
      const normalized: EconRow[] = (Array.isArray(data) ? data : [])
        .filter((row: any) => row?.event && row?.date)
        .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
        .slice(0, 24)
        .map((row: any) => ({
          event: String(row.event),
          ccy: String(row.currency || row.country || '—'),
          previous: fmtEconValue(row.previous, row.unit),
          actual: fmtEconValue(row.actual, row.unit),
          forecast: fmtEconValue(row.estimate, row.unit),
          when: fmtEconWhen(row.date),
          impact: IMPACT_RANK[String(row.impact)] || 0,
        }));
      setRows(normalized);
      setStatus(normalized.length ? 'ready' : 'empty');
    }).catch(() => {
      if (!alive) return;
      setRows([]);
      setStatus('error');
    });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div className="econ__grid">
        <div className="card econ-card">
          <span className="econ-tag"><Icon name="compass" size={12} /> Economic calendar status</span>
          {status === 'loading' ? <div style={{ marginTop: 18 }}><Skeleton w="82%" h={13} /><div style={{ marginTop: 8 }}><Skeleton w="64%" h={13} /></div></div>
            : status === 'ready' ? <p>{rows.length} verified scheduled release{rows.length === 1 ? '' : 's'} were returned for the next 14 days. Actual values remain blank until the provider reports them.</p>
              : status === 'empty' ? <p>No scheduled economic releases were returned for the next 14 days.</p>
                : <p>Economic calendar data is unavailable right now.</p>}
        </div>
        <TreasuryYieldCurve />
      </div>
      <div className="cal-table" data-econ-cal>
        <div className="muted" style={{ fontSize: 12, margin: '18px 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
          Economic calendar <span style={{ marginLeft: 'auto' }} className="chip-gray">Next 14 days <Icon name="chevR" size={11} /></span>
        </div>
        <div className="cal-grid h"><span className="cal-name">Event</span><span>Ccy</span><span>Previous</span><span>Actual</span><span>Forecast</span><span>Date and time</span><span>Impact</span></div>
        {status === 'loading' ? Array.from({ length: 6 }, (_, index) => <EconCalRowSkeleton key={index} />)
          : status === 'ready' ? rows.map((row, index) => <EconCalRow key={`${row.when}-${row.event}-${index}`} row={row} />)
            : <DataState status={status} empty="No scheduled releases were returned." error="Economic calendar data is unavailable. Try again later." />}
      </div>
    </>
  );
}

function LiveMarketValue({ sym, ready, field }: { sym: string; ready: boolean; field: 'price' | 'change' }) {
  if (!ready) return <SkeletonValue w={field === 'price' ? 58 : 46} />;
  const ticker = getTicker(sym);
  const live = !!(ticker as any).real && Number.isFinite(Number(ticker.price)) && Number(ticker.price) > 0;
  if (!live) return <span className="muted">Unavailable</span>;
  if (field === 'price') return <>{market.fmtPrice(ticker.price)}</>;
  const change = Number(ticker.chgPct);
  return Number.isFinite(change) ? <span className={cls(change)}>{fmtPct(change)}</span> : <span className="muted">—</span>;
}

function MarketsView({ tick }: { tick: number }) {
  const ready = useMarketReady();
  void tick;

  return (
    <>
      <div className="econ__grid">
        <div className="card">
          <h3 style={{ fontSize: 13, marginBottom: 6 }}>Live market snapshot</h3>
          {SNAPSHOT.map(([name, sym, region]) => (
            <div className="idx-row" key={sym}>
              <Logo sym={sym} size={16} /><b style={{ fontWeight: 600 }}>{name}</b><span className="muted" style={{ fontSize: 11 }}>{region}</span>
              <span style={{ marginLeft: 'auto' }}><LiveMarketValue sym={sym} ready={ready} field="change" /></span>
              <span style={{ width: 70, textAlign: 'right' }}><LiveMarketValue sym={sym} ready={ready} field="price" /></span>
            </div>
          ))}
        </div>
        <Treasury2s10s />
      </div>
      {MARKET_GROUPS.map(([group, rows]) => (
        <div className="cal-table" key={group}>
          <div className="muted" style={{ fontSize: 12, margin: '18px 0 4px' }}>{group}</div>
          <div className="mk-row h" style={{ gridTemplateColumns: '2fr 0.8fr 1fr 1fr' }}><span className="mk-name">Market</span><span>24h</span><span>Price</span><span>Source</span></div>
          {rows.map(([name, sym, region]) => (
            <div className="mk-row" style={{ gridTemplateColumns: '2fr 0.8fr 1fr 1fr' }} key={sym} data-mk-sym={sym}>
              <span className="mk-name"><Logo sym={sym} size={18} />{name} <span className="muted" style={{ fontSize: 11 }}>{region}</span></span>
              <span><LiveMarketValue sym={sym} ready={ready} field="change" /></span>
              <span><LiveMarketValue sym={sym} ready={ready} field="price" /></span>
              <span className="muted">Hydromancer</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function parseTransactionType(transaction: any): 'Purchase' | 'Sale' | 'Other' {
  const raw = `${transaction?.transactionType || ''} ${transaction?.acquisitionOrDisposition || transaction?.acquistionOrDisposition || ''}`.trim();
  if (/purchase|acquisition|(^|\s)p(?:-|\s|$)/i.test(raw)) return 'Purchase';
  if (/sale|disposition|(^|\s)s(?:-|\s|$)/i.test(raw)) return 'Sale';
  return 'Other';
}

function insiderTickers(): string[] {
  const configured = ['NVDA', 'AAPL', 'MSFT', 'TSLA', 'META', 'AMZN'];
  const universe = new Set(market.getUniverse().map((asset: any) => String(asset.sym)));
  const available = configured.filter((sym) => universe.has(sym) && market.assetClass(sym) === 'equity');
  return available.length ? available : configured;
}

function InsiderRowEl({ row }: { row: InsiderRow }) {
  const valueText = row.valM == null ? '—' : `${row.valM >= 0 ? '+' : '−'}$${Math.abs(row.valM).toFixed(Math.abs(row.valM) >= 100 ? 0 : 1)}M`;
  return (
    <div className="mk-row" style={{ gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1fr 1fr' }}>
      <span className="mk-name">{row.who}</span><span><Logo sym={row.tk} size={18} /> {row.tk}</span>
      <span className={row.type === 'Purchase' ? 'up' : row.type === 'Sale' ? 'down' : ''}>{row.type}</span>
      <span className={row.valM == null ? '' : row.valM >= 0 ? 'up' : 'down'}>{valueText}</span><span className="muted">{row.date}</span>
    </div>
  );
}

function InsiderRowSkeleton() {
  return (
    <div className="mk-row" style={{ gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1fr 1fr' }}>
      <span className="mk-name"><Skeleton w={120} h={11} /></span><span><Skeleton w={54} h={18} r={4} /></span>
      <span><SkeletonValue w={48} /></span><span><SkeletonValue w={54} /></span><span><SkeletonValue w={60} /></span>
    </div>
  );
}

function InsiderView() {
  const ready = useMarketReady();
  const [status, setStatus] = useState<RemoteStatus>('idle');
  const [rows, setRows] = useState<InsiderRow[]>([]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setStatus('loading');
    const symbols = insiderTickers();
    Promise.allSettled(symbols.map((sym) => fmp.insiderTrades(market.fmpSymbol(sym), 20))).then((results) => {
      if (!alive) return;
      if (results.every((result) => result.status === 'rejected')) {
        setRows([]);
        setStatus('error');
        return;
      }
      const merged: (InsiderRow & { timestamp: number; absoluteValue: number })[] = [];
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
        for (const transaction of result.value) {
          if (!transaction?.transactionDate) continue;
          const quantity = Number(transaction.securitiesTransacted);
          const price = Number(transaction.price);
          const grossValue = Number.isFinite(quantity) && Number.isFinite(price) ? Math.abs(quantity * price) : 0;
          const type = parseTransactionType(transaction);
          merged.push({
            who: String(transaction.reportingName || transaction.typeOfOwner || 'Not reported'),
            tk: symbols[index],
            type,
            valM: grossValue > 0 && type !== 'Other' ? (type === 'Purchase' ? 1 : -1) * grossValue / 1e6 : null,
            date: String(transaction.transactionDate).slice(0, 10),
            timestamp: Date.parse(transaction.transactionDate) || 0,
            absoluteValue: grossValue,
          });
        }
      });
      merged.sort((a, b) => (b.timestamp - a.timestamp) || (b.absoluteValue - a.absoluteValue));
      setRows(merged.slice(0, 12).map(({ timestamp: _timestamp, absoluteValue: _absoluteValue, ...row }) => row));
      setStatus(merged.length ? 'ready' : results.some((result) => result.status === 'rejected') ? 'error' : 'empty');
    }).catch(() => {
      if (!alive) return;
      setRows([]);
      setStatus('error');
    });
    return () => { alive = false; };
  }, [ready]);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13 }}>Recent filing coverage</h3>
        {status === 'idle' || status === 'loading' ? <div style={{ marginTop: 16 }}><Skeleton w="72%" h={13} /></div>
          : status === 'ready' ? <p className="muted" style={{ fontSize: 13 }}>{rows.length} verified transactions are shown below, sorted by filing date.</p>
            : status === 'empty' ? <p className="muted" style={{ fontSize: 13 }}>No insider transactions were returned for the tracked companies.</p>
              : <p className="muted" style={{ fontSize: 13 }}>Insider filing data is unavailable right now.</p>}
      </div>
      <div className="cal-table" data-insider-cal>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Recent transactions</div>
        <div className="mk-row h" style={{ gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1fr 1fr' }}><span className="mk-name">Insider</span><span>Ticker</span><span>Type</span><span>Value</span><span>Date</span></div>
        {status === 'idle' || status === 'loading' ? Array.from({ length: 5 }, (_, index) => <InsiderRowSkeleton key={index} />)
          : status === 'ready' ? rows.map((row, index) => <InsiderRowEl key={`${row.tk}-${row.date}-${index}`} row={row} />)
            : <DataState status={status} empty="No insider transactions were returned." error="Insider filing data is unavailable. Try again later." />}
      </div>
    </>
  );
}

const TABS = ['Economics', 'Markets', 'Insider trading'] as const;
type Tab = (typeof TABS)[number];

export default function Economy() {
  const [tab, setTab] = useState<Tab>('Economics');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const scope = {
      id: 'economy', label: 'Analysis', icon: 'compass', placeholder: 'Search commands',
      groups: [{ title: 'View', radio: true, items: TABS.map((view) => ({ label: view, icon: 'compass', checked: view === tab, run: () => setTab(view) })) }],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
  }, [tab]);

  useEffect(() => {
    let detached = false;
    const onChanges = () => { if (!detached) setTick((value) => value + 1); };
    const load = () => {
      try {
        const coins = MARKET_GROUPS.flatMap(([, rows]) => rows.map(([, sym]) => market.coinFor(sym)));
        market.loadChanges([...new Set(coins)]).then(onChanges).catch(() => {});
      } catch (_error) { /* rows render an explicit unavailable state */ }
    };
    window.addEventListener('market:changes', onChanges);
    if (market.isReady()) load();
    else window.addEventListener('market:ready', load, { once: true });
    return () => {
      detached = true;
      window.removeEventListener('market:changes', onChanges);
      window.removeEventListener('market:ready', load);
    };
  }, []);

  return (
    <Shell dockActive="discover">
      <div className="econ">
        <div className="econ__head">
          <a className="icon-btn" href="#/"><Icon name="back" size={18} /></a><b style={{ fontSize: 15 }}>Analysis</b>
          <span className="hint-pill" style={{ margin: '0 auto' }}>Next time, hit <kbd className="keycap">G</kbd> then <kbd className="keycap">E</kbd> to come here.</span>
          <div className="segmented seg-sm">{TABS.map((view) => <button key={view} className={view === tab ? 'on' : ''} data-etab={view} onClick={() => setTab(view)}>{view}</button>)}</div>
        </div>
        {tab === 'Economics' && <EconomicsView />}
        {tab === 'Markets' && <MarketsView tick={tick} />}
        {tab === 'Insider trading' && <InsiderView />}
      </div>
    </Shell>
  );
}
