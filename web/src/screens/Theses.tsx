/* =========================================================================
   Theses — every saved thesis (/api/me/theses) with its tracked status.
   The nightly checker (ideas_pipeline check_theses) flips breached theses to
   'invalidated' and flags past-review ones 'review_due' — this screen is
   where the full list + those verdicts live (Home shows only a 2-row strip).
   Per thesis: direction, status badge, symbols, the saved plan's legs with
   invalidation levels, evidence expansion, and Open-in-backtest (replays the
   plan's perp/stock legs from the thesis's creation date).
   ========================================================================= */
import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Skeleton } from '../components/Loading';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount } from '../hooks/useHlAccount';
import { groupByThesis } from '../lib/thesis-positions';
import { realizedPnl, userFills, type FillLike } from '../lib/thesis-pnl';
// @ts-ignore — JS modules
import * as me from '../lib/me.js';
// @ts-ignore — JS module
import { openAssistant } from '../lib/assistant';
import { openRun } from '../lib/thesisRun';
import '../styles/theses.css';

type Filter = 'all' | 'active' | 'review' | 'invalidated';

const b64uEncode = (o: any) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const HORIZON_OPTS = [30, 90, 180, 365, 730];
const snapHorizon = (d: number) => HORIZON_OPTS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), HORIZON_OPTS[1]);

const fmtDay = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const ago = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
};
const fmtPx = (v?: number | null) => (v == null ? null : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(v));

// the saved plan's replayable legs (perp/stock only — PM legs have no daily closes);
// falls back to the thesis's symbols as equal-weight legs in the thesis's direction.
function backtestSpec(t: any) {
  const dir = t.direction === 'short' ? 'short' : 'long';
  let legs = ((t.plan && t.plan.legs) || [])
    .filter((l: any) => l && l.venue !== 'prediction' && l.symbol)
    .map((l: any) => ({ symbol: String(l.symbol).toUpperCase(), direction: l.direction === 'short' ? 'short' : 'long', weight: 1 }));
  if (!legs.length) legs = (t.symbols || []).slice(0, 4).map((s: string) => ({ symbol: String(s).toUpperCase(), direction: dir, weight: 1 }));
  if (!legs.length) return null;
  const entry = fmtDay(t.created_at) || new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  return {
    legs: legs.slice(0, 4),
    entry: { date: entry },
    exit: { horizon_days: snapHorizon(Number(t.horizon_days) || 90) },
    benchmark: 'BTC',
  };
}

function statusBadge(t: any) {
  if (t.status === 'invalidated') return <span className="thx__badge thx__badge--inv">Invalidated</span>;
  if (t.status === 'resolved') return <span className="thx__badge thx__badge--res">Resolved</span>;
  const flags: string[] = (t.last_check && t.last_check.flags) || [];
  if (flags.includes('review_due')) return <span className="thx__badge thx__badge--due">Review due</span>;
  {/* Elfa A/B: nightly checker's leading-indicator flag — narrative dying before price confirms */}
  const fading = flags.find((f) => f.startsWith('attention_fading:'));
  if (fading) return <span className="thx__badge thx__badge--due" title="Social attention on this leg collapsed >50% in 24h — the narrative may be dying before price confirms. Advisory only.">Attention fading · {fading.split(':')[1]}</span>;
  return <span className="thx__badge thx__badge--act">Active</span>;
}

function ThesisCard({ t, finalPnl }: { t: any; finalPnl?: { usd: number; pct: number | null } }) {
  const [showEv, setShowEv] = useState(false);
  const legs: any[] = (t.plan && t.plan.legs) || [];
  const evidence: any[] = Array.isArray(t.evidence) ? t.evidence : [];
  const spec = backtestSpec(t);
  const review = fmtDay(t.review_at);
  const checkedAt = t.last_check && t.last_check.checked_at;
  const breached: any[] = ((t.last_check && t.last_check.legs) || []).filter((l: any) => l && l.breached);
  // a thesis is runnable while it's still alive and has at least one non-prediction leg
  // with a symbol (PM legs are link-outs until Polymarket trading goes live)
  const runnable = (t.status || 'active') === 'active'
    && legs.some((l: any) => l && l.venue !== 'prediction' && l.symbol);

  const exited = !!t.executed_at && finalPnl != null;
  return (
    <article className={'thx__card' + (exited ? ' thx__card--exited' : '')}>
      <div className="thx__top">
        {t.direction ? <span className={'thx__dir thx__dir--' + t.direction}>{t.direction}</span> : null}
        <b className="thx__title">{t.title}</b>
        {statusBadge(t)}
        <span className="thx__meta">
          {t.created_by === 'user' ? 'asserted' : 'from your saves'} · {ago(t.updated_at || t.created_at)}
          {review ? ' · review ' + review : ''}
          {Number(t.executed_usd) > 0
            ? ' · $' + Number(t.executed_usd).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' behind it'
            : ''}
        </span>
      </div>
      {exited && finalPnl ? (
        <div className={'thx__final ' + (finalPnl.usd >= 0 ? 'thx__final--up' : 'thx__final--down')}>
          <Icon name={finalPnl.usd >= 0 ? 'check' : 'alert'} size={12} />
          Closed · {finalPnl.usd >= 0 ? '+' : '-'}${Math.abs(finalPnl.usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {finalPnl.pct != null ? ` · ${finalPnl.pct >= 0 ? '+' : ''}${finalPnl.pct.toFixed(1)}% on $${Number(t.executed_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''}
          <span className="thx__final-note">realized, from venue fills</span>
        </div>
      ) : null}
      {t.summary ? <p className="thx__sum">{t.summary}</p> : null}
      {(t.symbols || []).length ? (
        <div className="thx__syms">
          {(t.symbols || []).slice(0, 6).map((s: string) => (
            <a key={s} href={'#/stock/' + s}><Logo sym={s} size={15} /> {s}</a>
          ))}
        </div>
      ) : null}

      {legs.length ? (
        <div className="thx__legs">
          {legs.map((l: any, i: number) => (
            <div key={i} className="thx__leg">
              <span className={'thx__venue thx__venue--' + l.venue}>{l.venue === 'prediction' ? 'predict' : l.venue}</span>
              {l.symbol ? <b>{l.symbol}</b> : <b className="thx__q">{(l.market && l.market.question) || l.question}</b>}
              <span className={'thx__side thx__side--' + l.direction}>{l.direction}</span>
              {l.invalidation ? (
                <span className="thx__inv">
                  <Icon name="alert" size={10} /> {fmtPx(l.invalidation.level) ? fmtPx(l.invalidation.level) + ' — ' : ''}{l.invalidation.text}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {breached.length ? (
        <div className="thx__check thx__check--bad">
          <Icon name="alert" size={12} /> Invalidation hit: {breached.map((l: any) => `${l.symbol} closed ${fmtPx(l.px)} vs ${fmtPx(l.level)}`).join(' · ')}
        </div>
      ) : checkedAt ? (
        <div className="thx__check">Last checked {ago(checkedAt)} — no invalidation breached.</div>
      ) : null}

      <div className="thx__acts">
        {/* Run puts real money behind the whole basket in one motion (legs were previously
            armable only one at a time). Hidden once the thesis is dead — you can't act on a
            belief the checker has already invalidated. */}
        {runnable ? (
          <button
            className="thx__act thx__act--pri"
            onClick={() => openRun({ id: t.id, title: t.title, summary: t.summary, direction: t.direction, plan: t.plan, source: 'theses_screen' })}
          >
            <Icon name="bolt" size={13} /> {t.executed_at ? 'Run again' : 'Run thesis'}
          </button>
        ) : null}
        {spec ? (
          <a className={'thx__act' + (runnable ? '' : ' thx__act--pri')} href={'#/backtest?spec=' + b64uEncode(spec)}>
            <Icon name="chart" size={13} /> Open in backtest
          </a>
        ) : null}
        {evidence.length ? (
          <button className="thx__act" onClick={() => setShowEv((v) => !v)}>
            {showEv ? 'Hide evidence' : `Evidence (${t.evidence_count || evidence.length})`}
          </button>
        ) : null}
        <button className="thx__act" onClick={() => openAssistant(`Re-evaluate my thesis "${t.title}" — is it still on track?`)}>
          <Icon name="sparkle" size={12} /> Re-evaluate
        </button>
      </div>

      {showEv && evidence.length ? (
        <div className="thx__evs">
          {evidence.map((e: any, i: number) => {
            const url = typeof e.url === 'string' && /^https:\/\//.test(e.url) ? e.url : null;
            const inner = (
              <>
                {e.symbols && e.symbols[0] ? <Logo sym={e.symbols[0]} size={16} /> : null}
                <span className="thx__evt">{e.title || e.subject_type || 'Saved item'}</span>
                <span className="thx__evm">{ago(e.created_at)}</span>
                {url ? <Icon name="link" size={12} /> : null}
              </>
            );
            return url
              ? <a key={i} className="thx__ev" href={url} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <div key={i} className="thx__ev">{inner}</div>;
          })}
        </div>
      ) : null}
    </article>
  );
}

/* What your published theses did for other people. This is the whole point of the attribution
   graph: without a surface that shows reach, writing a good thesis earns nothing. Aggregates
   only — it never names who adopted. */
function ReachStrip({ reach }: { reach: any }) {
  if (!reach || !reach.published) return null;
  const { published, people, runs, usd } = reach;
  return (
    <div className="thx__reach">
      <div className="thx__reach-h"><Icon name="bolt" size={12} /> Your theses' reach</div>
      <div className="thx__reach-nums">
        <span><b>{published}</b> shared</span>
        <span><b>{people}</b> {people === 1 ? 'person took one' : 'people took one'}</span>
        {runs ? <span><b>{runs}</b> ran it</span> : null}
        {usd > 0 ? <span><b>${Math.round(usd).toLocaleString()}</b> behind them</span> : null}
      </div>
      {(reach.top || []).length && reach.top[0].adopt_count ? (
        <div className="thx__reach-top">Most taken: “{reach.top[0].title}” · {reach.top[0].adopt_count}</div>
      ) : null}
    </div>
  );
}

export default function Theses() {
  const auth = useAuth();
  const [theses, setTheses] = useState<any[] | null>(null);
  const [reach, setReach] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  // Gate on auth (like Portfolio) — not window.henceMe — and RETRY on a transient
  // unavailable/unauth. On a fresh load of #/theses the Privy token can still be settling,
  // so a single attempt returned {available:false} and stranded the page on "No theses yet"
  // while the Portfolio (which waits for auth.authenticated) showed the same theses fine.
  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.authenticated) { setTheses(null); setLoaded(true); return; }
    let alive = true;
    const attempt = (n: number) => {
      me.loadTheses()
        .then((r: any) => {
          if (!alive) return;
          if (r && r.available && Array.isArray(r.theses)) { setTheses(r.theses); setReach(r.reach || null); setLoaded(true); }
          else if (n < 4) setTimeout(() => attempt(n + 1), 600);   // token/DB still settling — retry
          else { setTheses(null); setLoaded(true); }
        })
        .catch(() => { if (alive) { if (n < 4) setTimeout(() => attempt(n + 1), 600); else setLoaded(true); } });
    };
    attempt(0);
    const refresh = () => attempt(0);        // a saved thesis updates the profile → re-fetch
    window.addEventListener('hence:me', refresh);
    return () => { alive = false; window.removeEventListener('hence:me', refresh); };
  }, [auth.ready, auth.authenticated]);

  /* ---- final P&L for run-then-exited theses ----
     The portfolio stops showing a thesis once its last leg closes (a portfolio is live
     money); THIS page is where the outcome lives on. Attribution is groupByThesis — the
     same exclusive matcher the portfolio uses — so "closed" here means exactly what
     "gone from the portfolio" means there: a run thesis with zero open legs. The dollar
     figure comes from the venue's own closedPnl on this address's fills (thesis-pnl.ts),
     and when it cannot be honestly attributed nothing is shown — never a made-up $0. */
  const acct = useHlAccount(auth.address, { readOnly: true });
  const [executions, setExecutions] = useState<any[]>([]);
  const [fills, setFills] = useState<FillLike[] | null>(null);
  useEffect(() => {
    if (!auth.authenticated || !auth.address) return;
    let alive = true;
    userFills(auth.address).then((f) => { if (alive) setFills(f); });
    me.loadTheses().then((r: any) => {
      if (alive && r && Array.isArray(r.executions)) setExecutions(r.executions);
    }).catch(() => { /* executions stay empty — no P&L shown */ });
    return () => { alive = false; };
  }, [auth.authenticated, auth.address]);
  const finalPnl = (() => {
    const out: Record<string, { usd: number; pct: number | null }> = {};
    if (!theses || !fills) return out;
    const hlRows = (acct.positions || []).map((p: any) => ({
      ...p, sym: p.coin.split(':').pop()!.toUpperCase(), cls: p.coin.includes(':') ? 'Stocks' : 'Perps',
    }));
    const { groups } = groupByThesis(theses, hlRows, executions);
    for (const g of groups) {
      if (g.open.length) continue;                       // still live — the portfolio owns it
      const execs = executions.filter((e) => String(e.thesis_id) === String(g.thesis.id));
      const pnl = realizedPnl(execs, fills);
      if (pnl == null) continue;
      const cost = Number(g.thesis.executed_usd) || 0;
      out[g.thesis.id] = { usd: pnl, pct: cost > 0 ? (pnl / cost) * 100 : null };
    }
    return out;
  })();

  const isDue = (t: any) => (((t.last_check && t.last_check.flags) || []) as string[]).includes('review_due');
  const all = theses || [];
  const shown = all.filter((t) =>
    filter === 'all' ? true
    : filter === 'active' ? t.status === 'active'
    : filter === 'review' ? t.status === 'active' && isDue(t)
    : t.status === 'invalidated');
  const counts = {
    all: all.length,
    active: all.filter((t) => t.status === 'active').length,
    review: all.filter((t) => t.status === 'active' && isDue(t)).length,
    invalidated: all.filter((t) => t.status === 'invalidated').length,
  };

  return (
    <Shell>
      <div className="thx">
        <header className="thx__head">
          <h2>Your theses</h2>
          <span className="thx__subtitle">Saved beliefs Hence tracks nightly — invalidation breaches and review dates surface here</span>
        </header>

        {!auth.ready || (!loaded && auth.authenticated) ? (
          <div className="thx__loading"><Skeleton w={520} h={84} /><Skeleton w={520} h={84} /></div>
        ) : !auth.authenticated ? (
          <div className="thx__empty">
            <Icon name="bookmark" size={22} />
            <b>Sign in to see your theses</b>
            <p>Saved trade plans and beliefs are tracked per account.</p>
            <button className="thx__cta" onClick={() => auth.login?.()}>Sign in</button>
          </div>
        ) : !all.length ? (
          <div className="thx__empty">
            <Icon name="sparkle" size={22} />
            <b>No theses yet</b>
            <p>Tell Hence AI what you believe — it builds a trade plan you can save, and the nightly checker tracks it from then on.</p>
            <button className="thx__cta" onClick={() => openAssistant('')}>Ask Hence</button>
          </div>
        ) : (
          <>
            <ReachStrip reach={reach} />
            <div className="thx__filters">
              {([['all', 'All'], ['active', 'Active'], ['review', 'Review due'], ['invalidated', 'Invalidated']] as [Filter, string][]).map(([k, label]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {label} <em>{counts[k]}</em>
                </button>
              ))}
            </div>
            <div className="thx__list">
              {shown.map((t) => <ThesisCard key={t.id} t={t} finalPnl={finalPnl[t.id]} />)}
              {!shown.length ? <div className="thx__none">Nothing under this filter.</div> : null}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
