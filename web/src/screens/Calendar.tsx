import { useEffect, useRef, useState } from 'react';
import '../styles/calendar.css';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Skeleton, SkeletonText } from '../components/Loading';
import { getTicker, WATCHLIST } from '../lib/data.js';
import * as market from '../lib/market.js';
import * as fmp from '../lib/fmp.js';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';

/* ---------- neutral layout helpers ---------- */
function h32(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* =========================================================
   REAL earnings (FMP) — fetched once on mount for a window
   around the current month. Keyed by 'YYYY-MM-DD'. Gated on
   market.isReady(). Loading, empty, and unavailable states stay explicit.
   ========================================================= */
const MAX_PER_DAY = 24;                 // cap per-day list length (universe is huge)
let realMap: Map<string, any[]> | null = null; // Map<'YYYY-MM-DD', [event]> | null when unavailable
let realLoaded = false;                 // fetch attempted (resolved or failed)
let realFrom = '';
let realTo = '';

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

/* well-known US large caps (across report months) so the earnings calendar shows
   recognizable names, not thousands of obscure OTC/foreign listings */
const MAJORS = new Set(('AAPL MSFT GOOGL GOOG AMZN META NVDA TSLA AVGO ORCL ADBE CRM AMD INTC CSCO QCOM TXN IBM NOW INTU AMAT MU NFLX PYPL SMCI ARM PLTR SNOW CRWD PANW MDB DDOG NET UBER ABNB SHOP'
  + ' JPM BAC WFC C GS MS BLK SCHW AXP V MA SPGI COF USB PNC TFC PYPL COIN HOOD'
  + ' UNH JNJ LLY PFE ABBV MRK TMO ABT DHR BMY AMGN GILD CVS MDT ISRG VRTX REGN'
  + ' WMT COST PG KO PEP MCD NKE SBUX HD LOW TGT DIS LULU CMG DRI YUM EL CL KMB GIS STZ MO PM KMX MKC'
  + ' BA CAT GE HON UPS FDX LMT RTX DE UNP MMM EMR PAYX WGO LEN ACN JBL'
  + ' XOM CVX COP SLB EOG OXY PSX MPC VLO'
  + ' T VZ CMCSA TMUS CCL RCL NCLH F GM RIVN GME BBY DG DLTR ROST MAR').split(/\s+/).filter(Boolean));

/* normalize one FMP earnings row into the shape the views render */
function normEvent(row: any) {
  const sym = String(row.symbol || '').toUpperCase();
  const t = getTicker(sym);
  const epsEst = (row.epsEstimated == null) ? null : Number(row.epsEstimated);
  const epsAct = (row.epsActual == null) ? null : Number(row.epsActual);
  const reported = epsAct != null;
  // A beat/miss label is only knowable when both the reported and estimated EPS exist.
  const status = reported && epsEst != null ? ((epsAct as number) >= epsEst ? 'Beat' : 'Miss') : '';
  const rawTime = String(row.time || '').trim();
  const normalizedTime = rawTime.toLowerCase();
  const pre = /^(bmo|before market|pre-market|pre market)$/.test(normalizedTime)
    ? true
    : /^(amc|after market|post-market|post market)$/.test(normalizedTime)
      ? false
      : null;
  const epsDisplay = reported ? (epsAct as number).toFixed(2) : (epsEst != null ? epsEst.toFixed(2) : '');
  return {
    sym,
    name: (t && t.name) || sym,
    epsEstimated: epsEst,
    epsActual: epsAct,
    status,
    pre,
    eps: epsDisplay,
    epsLabel: reported ? 'EPS' : epsEst != null ? 'EPS est.' : '',
    time: pre === true ? 'Pre-market' : pre === false ? 'Post-market' : rawTime || 'Time unavailable',
  } as any;
}

/* fetch the earnings calendar for [from,to] around the current month and
   build the date→events map. Filters to the app universe so symbols map to
   real detail pages; caps per-day length. Returns true on success. */
async function loadEarnings() {
  if (realLoaded) return realMap != null;
  if (!market.isReady()) return false;
  realLoaded = true;
  try {
    const now = new Date();
    // FMP caps the earnings-calendar response (~4000 rows, chronological) — keep the
    // window tight (current month + 2 weeks) so it isn't truncated before the current week
    const fromD = new Date(now.getFullYear(), now.getMonth(), 1);     // 1st of current month
    const from = dateKey(fromD.getFullYear(), fromD.getMonth(), fromD.getDate());
    const toD = new Date(now.getFullYear(), now.getMonth() + 1, 15);  // mid next month
    const to = dateKey(toD.getFullYear(), toD.getMonth(), toD.getDate());
    realFrom = from;
    realTo = to;
    const rows = await fmp.earningsCalendar(from, to);
    if (!Array.isArray(rows)) return false;
    const uni = new Set(market.getUniverse().map((a: any) => String(a.sym).toUpperCase()));
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const sym = String(row.symbol || '').toUpperCase();
      if (!sym) continue;
      const inUni = uni.has(sym);
      // universe symbols + well-known US large caps only — keeps the calendar to
      // recognizable names instead of thousands of obscure OTC/foreign listings
      if (!inUni && !MAJORS.has(sym)) continue;
      const day = String(row.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const ev = normEvent(row); ev.inUni = inUni;
      const list = map.get(day) || [];
      list.push(ev);
      map.set(day, list);
    }
    // universe symbols first, then pre/post, then alpha; cap per day
    for (const [k, list] of map) {
      list.sort((a, b) => (a.inUni !== b.inUni ? (a.inUni ? -1 : 1) : a.pre !== b.pre ? (a.pre ? -1 : 1) : a.sym.localeCompare(b.sym)));
      if (list.length > MAX_PER_DAY) map.set(k, list.slice(0, MAX_PER_DAY));
    }
    realMap = map;
    return true;
  } catch (e) {
    realMap = null;
    return false;
  }
}

const realReady = () => market.isReady() && realMap != null;
/* Real earnings not yet available AND we still expect them. */
const earningsLoading = () => !realReady() && (!market.isReady() || !realLoaded);
const earningsUnavailable = () => market.isReady() && realLoaded && realMap == null;
const dateCovered = (y: number, m0: number, d: number) => {
  const key = dateKey(y, m0, d);
  return !!realFrom && !!realTo && key >= realFrom && key <= realTo;
};
/* real events for a covered calendar day, or null when unavailable/not loaded */
function realEventsFor(y: number, m0: number, d: number): any[] | null {
  if (!realReady() || !dateCovered(y, m0, d)) return null;
  return realMap!.get(dateKey(y, m0, d)) || [];
}

/* Resolve a desktop day number against the live current month. */
function realDeskEvents(dayNum: number, monthOffset = 0): any[] | null {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, dayNum);
  return realEventsFor(d.getFullYear(), d.getMonth(), d.getDate());
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const HOLD = WATCHLIST.holdings;
const WATCH = [...new Set([...WATCHLIST.favorites, ...WATCHLIST.tracking])];
const srcSet = (s: string) => (s === 'holdings' ? HOLD : s === 'watchlist' ? WATCH : []);

/* Earnings for a covered day, honouring source/session filters. */
function eventsForDay(y: number, m: number, day: number, filter: { source: string; market: string }) {
  const real = realEventsFor(y, m, day);
  if (!real) return [];
  let out = real.slice();
  if (filter.source !== 'all') {
    const srcUp = new Set([...new Set(srcSet(filter.source))].map((s) => String(s).toUpperCase()));
    out = out.filter((event) => srcUp.has(event.sym));
  }
  if (filter.market === 'pre') out = out.filter((event) => event.pre === true);
  if (filter.market === 'post') out = out.filter((event) => event.pre === false);
  const sessionRank = (event: any) => event.pre === true ? 0 : event.pre === false ? 1 : 2;
  out.sort((a, b) => sessionRank(a) - sessionRank(b) || a.sym.localeCompare(b.sym));
  return out;
}

function monthCells(y: number, m: number) {
  const first = new Date(y, m, 1).getDay();             // 0 = Sunday
  const days = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const cells: { d: number; out: number }[] = [];
  for (let i = 0; i < first; i++) cells.push({ d: prevDays - first + 1 + i, out: -1 });
  for (let d = 1; d <= days; d++) cells.push({ d, out: 0 });
  let nd = 1; while (cells.length < 42) cells.push({ d: nd++, out: 1 });
  return cells;
}

/* =========================================================
   DESKTOP — sub-render components
   ========================================================= */

function HeaderBar() {
  return (
    <div className="cal-topbar">
      <div className="cal-topbar__l">
        <a className="cal-back" href="#/" aria-label="Back"><Icon name="back" size={16} /></a>
        <span className="cal-title">Earnings calendar</span>
      </div>
      <div className="cal-topbar__r">
        <span className="cal-tab"><span className="cal-soon">Coming soon</span><Icon name="doc" size={13} /> Events</span>
        <span className="cal-tab on"><Icon name="card" size={13} /> Calendar</span>
      </div>
    </div>
  );
}

function PanelHead({ view, dateLabel, hw, onToggleHw, onView }: {
  view: string; dateLabel: any; hw: boolean; onToggleHw: () => void; onView: (v: string) => void;
}) {
  return (
    <div className="cal-head">
      <div className="cal-month">{dateLabel}</div>
      <div className="cal-controls">
        <label className="cal-toggle">Holdings &amp; Watchlist
          <button
            className={'cal-switch' + (hw ? ' on' : '')}
            data-toggle="hw"
            role="switch"
            aria-checked={hw}
            onClick={(e) => { e.preventDefault(); onToggleHw(); }}
          ><span></span></button>
        </label>
        <div className="cal-seg">
          {['Day', 'Week', 'Month'].map((v) => (
            <button key={v} className={v === view ? 'on' : ''} data-view={v} onClick={() => onView(v)}>{v}</button>
          ))}
        </div>
        <button className="cal-gridbtn" aria-label="Grid"><Icon name="list" size={15} /></button>
      </div>
    </div>
  );
}

/* ---------- mini month calendar (right side of Day view) ---------- */
function MiniCal({ selDay, onPick }: { selDay: number; onPick: (d: number) => void }) {
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const cells = monthCells(now.getFullYear(), now.getMonth());
  return (
    <div className="cal-mini">
      <div className="cal-mini__dow">{dow.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-mini__grid">
        {cells.map(({ d, out }, i) => {
          const isSel = out === 0 && d === selDay;
          const isToday = out === 0 && d === now.getDate();
          let c = 'cal-mini__c';
          if (out) c += ' out';
          if (isToday) c += ' today';
          if (isSel && !isToday) c += ' sel';
          return (
            <button key={i} className={c} onClick={out === 0 ? () => onPick(d) : undefined}>{d}</button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- DAY VIEW (#74, #78) ---------- */
function DayView({ selDay, onPick, onViewStock }: { selDay: number; onPick: (d: number) => void; onViewStock: (sym: string) => void }) {
  const loading = earningsLoading();
  const unavailable = earningsUnavailable();
  const real = realDeskEvents(selDay, 0);
  const evs = loading ? [] : real || [];
  const pre = evs.filter((event) => event.pre === true);
  const post = evs.filter((event) => event.pre === false);
  const unspecified = evs.filter((event) => event.pre == null);
  const now = new Date();
  const selectedDate = new Date(now.getFullYear(), now.getMonth(), selDay);
  const about = evs[0] ? getTicker(evs[0].sym) : null;

  const section = (label: string, list: any[]) => {
    if (!list.length) return null;
    return (
      <div className="cal-daysec">
        <div className="cal-daysec__h">{label}</div>
        {list.map((e, i) => (
          <a className="cal-dayrow" href={`#/stock/${e.sym}`} key={e.sym + i}>
            <Logo sym={e.sym} size={22} />
            <span className="cal-dayrow__tk">{e.sym}</span>
            <span className="cal-dayrow__nm">{e.name}</span>
            <span className="cal-dayrow__spacer"></span>
            {e.eps ? <span className="cal-eps">{e.epsLabel || 'EPS'} <b>{e.eps}</b></span> : null}
            {e.status ? <span className={'cal-pill ' + (e.status === 'Beat' ? 'beat' : 'miss')}>{e.status}</span> : null}
            <span className="cal-dayrow__time"><Icon name="bell" size={12} /> {e.time}</span>
          </a>
        ))}
      </div>
    );
  };

  // skeleton day rows sized to the real cal-dayrow (logo + ticker + name + meta)
  const skelSection = (label: string, n: number) => (
    <div className="cal-daysec">
      <div className="cal-daysec__h"><Skeleton w={90} h={13} r={4} /></div>
      {Array.from({ length: n }, (_, i) => (
        <div className="cal-dayrow" key={i} aria-hidden="true">
          <Skeleton w={22} h={22} r={11} />
          <span className="cal-dayrow__tk"><Skeleton w={44} h={13} r={4} /></span>
          <span className="cal-dayrow__nm"><Skeleton w={140} h={12} r={4} /></span>
          <span className="cal-dayrow__spacer"></span>
          <span className="cal-dayrow__time"><Skeleton w={70} h={12} r={4} /></span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="cal-day">
      <div className="cal-day__main">
        <div className="cal-dow-row">{loading ? <Skeleton w={90} h={15} r={4} /> : <span>{WEEKDAYS[selectedDate.getDay()]}</span>}</div>
        {loading
          ? <>{skelSection('Pre-market', 3)}{skelSection('Post-market', 4)}</>
          : unavailable
            ? <div className="cal-empty" role="status">Earnings data is unavailable right now.</div>
            : evs.length
              ? <>{section('Pre-market', pre)}{section('Post-market', post)}{section('Time not provided', unspecified)}</>
              : <div className="cal-empty">No tracked earnings were returned for this day.</div>}
      </div>
      <aside className="cal-day__side">
        <MiniCal selDay={selDay} onPick={onPick} />
        {loading ? (
          <div className="cal-about">
            <h3><Skeleton w={160} h={16} r={4} /></h3>
            <SkeletonText lines={4} />
            <div style={{ marginTop: 12 }}><Skeleton w={128} h={30} r={8} /></div>
          </div>
        ) : about ? (
          <div className="cal-about">
            <h3>About {about.name}</h3>
            <p>Open the company earnings page for verified reports, estimates, and historical results.</p>
            <button className="cal-viewbtn" data-stock={about.sym} onClick={() => onViewStock(about.sym)}><Icon name="chart" size={13} /> View earnings</button>
          </div>
        ) : (
          <div className="cal-about">
            <h3>{unavailable ? 'Data unavailable' : 'No company selected'}</h3>
            <p>{unavailable ? 'The earnings provider request failed. Try again later.' : 'Company details appear when a verified earnings event is available.'}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------- WEEK VIEW (#75) ---------- */
function WeekView() {
  const loading = earningsLoading();
  // [label, dayNum, monthOffset, isToday]
  const cols: [string, number, number, boolean][] = (() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const mo = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
      return [`${WEEKDAYS[d.getDay()]} ${d.getDate()}`, d.getDate(), mo, d.toDateString() === now.toDateString()] as [string, number, number, boolean];
    });
  })();
  // skeleton rows for a loading week column (varied count so columns don't look identical)
  const skelCol = (day: number) => {
    const n = 4 + (h32('wk-' + day) % 5);
    return (
      <>
        <div className="cal-wksec"><Skeleton w={70} h={11} r={4} /></div>
        {Array.from({ length: n }, (_, i) => (
          <div className="cal-wkrow" key={i} aria-hidden="true">
            <span className="cal-wkrow__tk"><Skeleton w={15} h={15} r={8} /><Skeleton w={38} h={12} r={4} /></span>
          </div>
        ))}
      </>
    );
  };
  const colInner = (day: number, mo = 0) => {
    if (loading) return skelCol(day);
    const real = realDeskEvents(day, mo);
    if (!real) return <div className="cal-wksec">Earnings data unavailable</div>;
    const pre = real.filter((event) => event.pre === true);
    const post = real.filter((event) => event.pre === false);
    const unspecified = real.filter((event) => event.pre == null);
    const rows = (list: any[]) =>
      list.map((e, i) => (
        <a className="cal-wkrow" href={`#/stock/${e.sym}`} key={e.sym + i}>
          <span className="cal-wkrow__tk"><Logo sym={e.sym} size={15} />{e.sym}</span>
          {e.status ? <span className={'cal-pill sm ' + (e.status === 'Beat' ? 'beat' : 'miss')}>{e.status}</span> : null}
        </a>
      ));
    if (!real.length) return <div className="cal-wksec">No tracked earnings</div>;
    return (
      <>
        {pre.length ? <><div className="cal-wksec">Pre-market</div>{rows(pre)}</> : null}
        {post.length ? <><div className="cal-wksec">Post-market</div>{rows(post)}</> : null}
        {unspecified.length ? <><div className="cal-wksec">Time not provided</div>{rows(unspecified)}</> : null}
      </>
    );
  };
  return (
    <div className="cal-week">
      {cols.map(([label, day, mo, isToday]) => (
        <div className={'cal-wkcol ' + (isToday ? 'today' : '')} key={label}>
          <div className="cal-wkhd">{isToday ? <span className="cal-wktoday">Today, {label.split(' ')[0]} {loading ? <Skeleton w={18} h={12} r={4} /> : ''}</span> : <span>{label}</span>}</div>
          <div className="cal-wkbody">{colInner(day, mo)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- MONTH VIEW (#76, #77) ---------- */
/* real current-month grid (correct weekday alignment + real FMP earnings) */
function RealMonthView() {
  const dow = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth(), today = now.getDate();
  const monthPrefix = `${y}-${pad2(mo + 1)}-`;
  const hasMonthEvents = !!realMap && [...realMap.keys()].some((key) => key.startsWith(monthPrefix) && (realMap!.get(key)?.length || 0) > 0);
  if (!hasMonthEvents) {
    return (
      <div className="cal-month">
        <div className="cal-mdow">{dow.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="cal-empty" role="status">No tracked earnings were returned for this month.</div>
      </div>
    );
  }
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const rows: (number | null)[][] = []; let week: (number | null)[] = new Array(5).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(y, mo, d).getDay();
    if (wd === 0 || wd === 6) continue;            // Mon–Fri grid
    week[wd - 1] = d;
    if (wd === 5) { rows.push(week); week = new Array(5).fill(null); }
  }
  if (week.some((x) => x != null)) rows.push(week);
  const cell = (d: number | null, key: number) => {
    if (d == null) return <div className="cal-mcell out" key={key}></div>;
    const evs = (realMap && realMap.get(dateKey(y, mo, d))) || [];
    const named = evs.slice(0, 2).map((e) => [e.sym, e.status || (e.pre === true ? 'Pre' : e.pre === false ? 'Post' : 'Time —')] as [string, string]);
    const more = Math.max(0, evs.length - named.length);
    return (
      <div className={'cal-mcell' + (d === today ? ' today' : '')} key={key}>
        <div className="cal-mcell__d">{d === 1 ? MONTHS[mo] + ' 1' : d}</div>
        {named.map(([sym, tag], i) => (
          <a className="cal-mchip" href={`#/stock/${sym}`} key={sym + i}>
            <Logo sym={sym} size={14} /><span className="cal-mchip__tk">{sym}</span>
            <span className={'cal-mchip__tag ' + (tag === 'Miss' ? 'miss' : '')}>{tag}</span>
          </a>
        ))}
        {more ? <div className="cal-mmore"><span className="cal-mmore__dot"><Icon name="doc" size={11} /></span>{more} more</div> : null}
        {(!evs.length && d === today) ? <div className="cal-mcell__empty">No earnings today</div> : null}
      </div>
    );
  };
  let k = 0;
  return (
    <div className="cal-month">
      <div className="cal-mdow">{dow.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-mgrid">{rows.map((w) => w.map((d) => cell(d, k++)))}</div>
    </div>
  );
}

/* skeleton month grid — real weekday-aligned rows can't be built until data
   lands, so we show a neutral 4-week Mon–Fri grid of shimmer cells with a couple
   of neutral (uncolored) chip placeholders per cell. */
function LoadingMonthView() {
  const dow = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  let k = 0;
  const cell = (key: number) => {
    const chips = h32('mo-' + key) % 3;                 // 0–2 neutral chip placeholders
    return (
      <div className="cal-mcell" key={key} aria-hidden="true">
        <div className="cal-mcell__d"><Skeleton w={20} h={13} r={4} /></div>
        {Array.from({ length: chips }, (_, i) => (
          <div className="cal-mchip" key={i}>
            <Skeleton w={14} h={14} r={7} /><Skeleton w={40} h={11} r={4} />
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="cal-month">
      <div className="cal-mdow">{dow.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-mgrid">{Array.from({ length: 20 }, () => cell(k++))}</div>
    </div>
  );
}

function MonthView() {
  if (realReady()) return <RealMonthView />;
  if (earningsLoading()) return <LoadingMonthView />;
  const dow = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  return (
    <div className="cal-month">
      <div className="cal-mdow">{dow.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-empty" role="status">Earnings calendar data is unavailable right now.</div>
    </div>
  );
}

/* ===================== MOBILE — native (Apple/Google) calendar ===================== */
function MobileCal({ st, setSt }: { st: any; setSt: (fn: (s: any) => any) => void }) {
  const loading = earningsLoading();
  const cells = monthCells(st.y, st.m);
  const now = new Date();
  const current = { y: now.getFullYear(), m: now.getMonth(), day: now.getDate() };
  const isTodayMonth = st.y === current.y && st.m === current.m;

  const evsSel = loading ? [] : eventsForDay(st.selY, st.selM, st.sel, st.filter);
  const pre = evsSel.filter((event) => event.pre === true);
  const post = evsSel.filter((event) => event.pre === false);
  const unspecified = evsSel.filter((event) => event.pre == null);
  const selectedCovered = dateCovered(st.selY, st.selM, st.sel);
  const weekday = WEEKDAYS[new Date(st.selY, st.selM, st.sel).getDay()];

  const evRow = (e: any, i: number) => (
    <a className="calm-ev" href={`#/stock/${e.sym}`} key={e.sym + i}>
      <Logo sym={e.sym} size={28} />
      <span className="calm-ev__id"><b>{e.sym}</b><small>{e.name}</small></span>
      <span className="calm-ev__meta"><span className="calm-ev__time">{e.time}</span>{e.status ? <span className={'cal-pill ' + (e.status === 'Beat' ? 'beat' : 'miss')}>{e.status}</span> : null}</span>
    </a>
  );
  const sec = (label: string, list: any[]) => list.length ? (
    <>
      <div className="calm-agenda__sec">{label} <span>{list.length}</span></div>
      {list.map(evRow)}
    </>
  ) : null;

  return (
    <div className="calm">
      <div className="calm-top">
        <a className="cal-back" href="#/" aria-label="Back"><Icon name="back" size={18} /></a>
        <div className="calm-nav">
          <button aria-label="Previous month" onClick={() => setSt((s) => { const nm = s.m - 1; return { ...s, m: (nm + 12) % 12, y: s.y + Math.floor(nm / 12) }; })}><Icon name="back" size={15} /></button>
          <span className="calm-mlabel">{MONTHS[st.m]} {st.y}</span>
          <button aria-label="Next month" onClick={() => setSt((s) => { const nm = s.m + 1; return { ...s, m: (nm + 12) % 12, y: s.y + Math.floor(nm / 12) }; })}><Icon name="chevR" size={15} /></button>
        </div>
        <button className="calm-today" onClick={() => setSt((s) => ({ ...s, y: current.y, m: current.m, sel: current.day, selY: current.y, selM: current.m }))}>Today</button>
      </div>
      <div className="calm-filters">
        <div className="calm-seg">
          {['all', 'holdings', 'watchlist'].map((src) => (
            <button key={src} className={st.filter.source === src ? 'on' : ''} onClick={() => setSt((s) => ({ ...s, filter: { ...s.filter, source: src } }))}>
              {src === 'all' ? 'All' : src[0].toUpperCase() + src.slice(1)}
            </button>
          ))}
        </div>
        <div className="calm-chips">
          {([['all', 'All day'], ['pre', 'Pre‑market'], ['post', 'Post‑market']] as [string, string][]).map(([k, l]) => (
            <button key={k} className={st.filter.market === k ? 'on' : ''} onClick={() => setSt((s) => ({ ...s, filter: { ...s.filter, market: k } }))}>{l}</button>
          ))}
        </div>
      </div>
      <div className="calm-dow">{DOW1.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="calm-grid">
        {cells.map((c, i) => {
          if (c.out !== 0) return <button className="calm-cell out" disabled key={i}><span className="calm-cell__n">{c.d}</span></button>;
          // While loading: neutral shimmer dots (not colored beat/miss) so we never
          // fabricate outcomes. Deterministic 0–2 count so the grid isn't uniform.
          const dots = loading
            ? Array.from({ length: h32('mdot-' + st.y + '-' + st.m + '-' + c.d) % 3 }, (_, j) => (
                <Skeleton key={j} w={5} h={5} r={3} />
              ))
            : eventsForDay(st.y, st.m, c.d, st.filter).slice(0, 3).map((event, j) => <i className={event.status === 'Beat' ? 'up' : event.status === 'Miss' ? 'down' : ''} key={j}></i>);
          const today = isTodayMonth && c.d === current.day;
          const sel = st.y === st.selY && st.m === st.selM && c.d === st.sel;
          return (
            <button className={'calm-cell ' + (today ? 'today' : '') + ' ' + (sel ? 'sel' : '')} key={i} onClick={() => setSt((s) => ({ ...s, sel: c.d, selY: s.y, selM: s.m }))}>
              <span className="calm-cell__n">{c.d}</span><span className="calm-cell__dots">{dots}</span>
            </button>
          );
        })}
      </div>
      <div className="calm-agenda">
        <div className="calm-agenda__h">{weekday}, {MONTHS[st.selM]} {st.sel}</div>
        {loading ? (
          <>
            <div className="calm-agenda__sec"><Skeleton w={80} h={12} r={4} /></div>
            {Array.from({ length: 4 }, (_, i) => (
              <div className="calm-ev" key={i} aria-hidden="true">
                <Skeleton w={28} h={28} r={14} />
                <span className="calm-ev__id"><Skeleton w={52} h={13} r={4} /><Skeleton w={110} h={11} r={4} /></span>
                <span className="calm-ev__meta"><Skeleton w={56} h={11} r={4} /></span>
              </div>
            ))}
          </>
        ) : earningsUnavailable()
          ? <div className="calm-agenda__empty"><Icon name="doc" size={22} /><span>Earnings data is unavailable right now</span></div>
          : !selectedCovered
            ? <div className="calm-agenda__empty"><Icon name="doc" size={22} /><span>This date is outside the loaded earnings window</span></div>
            : evsSel.length
              ? <>{sec('Pre‑market', pre)}{sec('Post‑market', post)}{sec('Time not provided', unspecified)}</>
              : <div className="calm-agenda__empty"><Icon name="doc" size={22} /><span>No tracked earnings{st.filter.source !== 'all' ? ' in your ' + st.filter.source : ''} were returned for this day</span></div>}
      </div>
    </div>
  );
}

/* ---------- main ---------- */
export default function Calendar() {
  const initialNow = new Date();
  const [view, setView] = useState('Day');
  const [selDay, setSelDay] = useState(initialNow.getDate());
  const picked = useRef(false);             // the user explicitly chose a day → never auto-snap over it
  const [hw, setHw] = useState(true);
  const [st, setStState] = useState<any>(() => ({
    y: initialNow.getFullYear(), m: initialNow.getMonth(), sel: initialNow.getDate(),
    selY: initialNow.getFullYear(), selM: initialNow.getMonth(),
    filter: { source: 'all', market: 'all' },
  }));
  const setSt = (fn: (s: any) => any) => setStState(fn);

  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  // force re-render when real earnings load
  const [, force] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Load REAL upcoming earnings, then repaint (swapping skeletons → real data).
  // If realLoaded is already true (cached from a prior mount) the first render
  // already used real data. If the market isn't ready yet at mount we wait for
  // the `market:ready` event before fetching — otherwise the skeletons would
  // never resolve.
  useEffect(() => {
    let alive = true;
    // Keep the initial Day view on today unless the user picked another date.
    const snapToToday = () => { if (alive && realReady() && !picked.current) setSelDay(new Date().getDate()); };
    if (realReady()) snapToToday();
    const run = () => {
      if (!market.isReady() || realLoaded) return;
      loadEarnings().then(() => { if (alive) { force((n) => n + 1); snapToToday(); } }).catch(() => { if (alive) force((n) => n + 1); });
    };
    if (market.isReady()) run();
    else window.addEventListener('market:ready', run, { once: true });
    return () => { alive = false; window.removeEventListener('market:ready', run); };
  }, []);

  function dateLabel() {
    if (earningsLoading()) return <Skeleton w={150} h={20} r={5} />;
    const n = new Date();
    if (view === 'Day') return <>{MONTHS[n.getMonth()]} {selDay} <span className="cal-month__yr">{n.getFullYear()}</span></>;
    return <>{MONTHS[n.getMonth()]} <span className="cal-month__yr">{n.getFullYear()}</span></>;
  }

  const onView = (v: string) => {
    setView(v);
  };
  const onViewStock = (sym: string) => { location.hash = `#/stock/${sym}/earnings`; };

  // register the "Calendar" command scope so the dock menu surfaces the Day/Week/Month views
  useEffect(() => {
    const scope = {
      id: 'calendar', label: 'Calendar', icon: 'calendar', placeholder: 'Search commands', radio: true,
      groups: [{ title: 'View', items: ['Day', 'Week', 'Month'].map((v) => ({ label: v + ' view', icon: 'calendar', checked: v === view, run: () => onView(v) })) }],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const body = () => {
    if (view === 'Day') return <DayView selDay={selDay} onPick={(d) => { picked.current = true; setSelDay(d); }} onViewStock={onViewStock} />;
    if (view === 'Week') return <WeekView />;
    return <MonthView />;
  };

  return (
    <Shell dockActive="discover">
      {mobile ? (
        <MobileCal st={st} setSt={setSt} />
      ) : (
        <div className="cal-screen">
          <HeaderBar />
          <div className={'cal-panel cal-panel--' + view.toLowerCase()}>
            <PanelHead view={view} dateLabel={dateLabel()} hw={hw} onToggleHw={() => setHw((v) => !v)} onView={onView} />
            {body()}
          </div>
        </div>
      )}
    </Shell>
  );
}
