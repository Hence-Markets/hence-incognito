/* Shared Signals UI — the call card and its parts, reused by the Signals feed,
   the source-breakdown page, and the per-show page. The differentiators vs paste.trade
   live here: excess-vs-BTC headline + BEAT/LAGGED verdict, the return-PATH sparkline,
   cross-source tags, and a native (not referral) trade CTA. */
import { useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
// @ts-ignore — JS helper at the remote-feed URL boundary
import { safeHttpUrl, safeSymbol } from '../lib/safe-html.js';

export const pct = (v: any, sign = true) =>
  (v == null || isNaN(v)) ? '—' : (sign && v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
export const upcls = (v: any) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function ago(iso: string) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  const d = Math.round(s / 86400);
  return d < 30 ? d + 'd ago' : Math.round(d / 30) + 'mo ago';
}

export function DirBadge({ d }: { d: string }) {
  const m: Record<string, string> = { long: 'Long', short: 'Short', neutral: 'Neutral', exit: 'Exit' };
  return <span className={'sig-dir ' + d}>{m[d] || d}</span>;
}

export function Conviction({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span className="sig-conv" title={`Conviction ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </span>
  );
}

// the headline horizon — prefer live mark-to-now, else longest resolved
function heroOf(returns: any) {
  const r = returns || {};
  const hz = r.live ? 'live' : r['30d'] ? '30d' : r['7d'] ? '7d' : r['1d'] ? '1d' : null;
  return hz ? { hz, ...r[hz] } : null;
}

// the call's return PATH across horizons, with a faint BTC benchmark line behind it
function Sparkline({ returns }: { returns: any }) {
  const r = returns || {};
  const call: number[] = [0];
  const bench: (number | null)[] = [0];
  for (const h of ['1d', '7d', '30d', 'live']) {
    if (r[h] && r[h].signed != null) {
      call.push(r[h].signed);
      bench.push(r[h].benchmark != null ? r[h].benchmark : null);
    }
  }
  if (call.length < 2) return null;
  const vals = call.concat(bench.filter((x): x is number => x != null), [0]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const W = 124, H = 34, n = call.length;
  const x = (i: number) => (i / (n - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const poly = (arr: (number | null)[]) =>
    arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const last = call[call.length - 1];
  return (
    <svg className="sig-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line className="sig-spark__zero" x1="2" y1={y(0)} x2={W - 2} y2={y(0)} />
      {bench.some((v) => v != null) && <polyline className="sig-spark__bench" points={poly(bench)} fill="none" />}
      <polyline className={'sig-spark__call ' + (last >= 0 ? 'up' : 'down')} points={poly(call)} fill="none" />
    </svg>
  );
}

// the flagship: excess-vs-BTC as the headline verdict (paste.trade can't say this), the
// raw + benchmark context line, and the path sparkline.
export function ReturnPath({ returns }: { returns: any }) {
  const hero = heroOf(returns);
  if (!hero) return <div className="sig-ret"><div className="sig-hero"><div className="v">—</div><div className="k">unpriced</div></div></div>;
  const { excess, signed, benchmark } = hero;
  const headline = excess != null ? excess : signed;
  const verdict = excess == null ? 'LIVE' : excess >= 0 ? 'BEAT' : 'LAGGED';
  const vcls = excess == null ? 'live' : excess >= 0 ? 'beat' : 'lag';
  return (
    <div className="sig-ret">
      <div className={'sig-hero ' + upcls(headline)}>
        <div className="v">{pct(headline)}</div>
        <div className="k">{excess != null ? 'vs BTC' : 'since call'}</div>
      </div>
      <span className={'sig-verdict ' + vcls}>{verdict}</span>
      {signed != null && (
        <div className="sig-ctx">{pct(signed)} raw{benchmark != null ? ` · BTC ${pct(benchmark)}` : ''}</div>
      )}
      <Sparkline returns={returns} />
    </div>
  );
}

export function SignalTag({ kind, c }: { kind: string; c: any }) {
  const m: Record<string, [string, string]> = {
    position: ['Position', 'The speaker holds or is entering this — not just a watch idea.'],
    idea: ['Idea', 'A thesis / watch call — not a stated position.'],
    sentiment: ['Sentiment', 'An expressed bullish/bearish view — a lean, not a stated trade.'],
    first_mention: ['First mention', `First time ${c.person || c.source || 'this voice'} surfaced ${c.symbol} here.`],
    mapped: ['Mapped', `They named a belief, not a ticker — we mapped it to ${c.symbol}${c.edge ? '. ' + c.edge : '.'}`],
    crowded: ['Crowded', `Several voices are ${c.direction} ${c.symbol} right now — a consensus call.`],
    contrarian: ['Contrarian', `This goes against the current consensus on ${c.symbol}.`],
    unmapped: ['Unmapped', `This source named ${c.asset_mention || 'an asset or theme'}, but Hence could not safely map it to a tradeable ticker.`],
  };
  const t = m[kind];
  if (!t) return null;
  return <span className={'sig-tag t-' + kind}>{t[0]}<span className="sig-tip">{t[1]}</span></span>;
}

// native trade CTA — we ARE the venue (Hyperliquid / our stock page), not a referral
export function TradeCta({ venue }: { venue: any }) {
  if (!venue || venue.kind === 'none' || !venue.href) return null;
  const href = safeHttpUrl(venue.href);
  if (!href) return null;
  const kind = String(venue.kind || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  return <a className={'sig-cta v-' + kind} href={href}>{venue.label} →</a>;
}

export function SignalCall({ c, expanded = false }: { c: any; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const reasons: string[] = c.reasoning || [];
  const tg = c.tags || {};
  const symbol = safeSymbol(c.symbol);
  const fallbackAsset = String(c.asset_mention || c.asset_name || 'Unmapped idea').trim() || 'Unmapped idea';
  const episodeUrl = safeHttpUrl(c.episode_url);
  return (
    <div className={'sig-call' + (expanded ? ' is-expanded' : '')}>
      <div className="sig-call__main">
        <div className="sig-call__head">
          {symbol && <Logo sym={symbol} size={30} />}
          <div className="sig-call__id">
            <div className="r1"><b>{symbol || fallbackAsset}</b> <DirBadge d={c.direction} /> <Conviction n={c.conviction} /></div>
            {symbol && <div className="r2">{c.asset_name || c.asset_mention}</div>}
          </div>
        </div>
        {(c.headline_quote || c.quote) && <div className="sig-quote">“{c.headline_quote || c.quote}”</div>}
        {c.thesis && <div className="sig-thesis">{c.thesis}</div>}
        <div className="sig-tags">
          {c.call_type && <SignalTag kind={c.call_type} c={c} />}
          {!symbol && <SignalTag kind="unmapped" c={c} />}
          {symbol && tg.first_mention && <SignalTag kind="first_mention" c={{ ...c, symbol }} />}
          {symbol && tg.mapped && <SignalTag kind="mapped" c={{ ...c, symbol }} />}
          {symbol && tg.crowded && <SignalTag kind="crowded" c={{ ...c, symbol }} />}
          {symbol && tg.contrarian && <SignalTag kind="contrarian" c={{ ...c, symbol }} />}
        </div>
        <div className="sig-attr">
          <span className="who">{c.person || c.source}</span>
          {c.person && c.source && c.person !== c.source && (c.source_id
            ? <a className="via" href={`#/signals/show/${encodeURIComponent(String(c.source_id))}`}> · {c.source}</a>
            : <span className="via"> · {c.source}</span>)}
          <span className="when"> · {ago(c.call_ts)}</span>
          {c.source_id && <a className="ep" href={`#/signals/source/${encodeURIComponent(String(c.source_id))}`} title="Full breakdown"><Icon name="doc" size={11} /></a>}
          {episodeUrl && <a className="ep" href={episodeUrl} target="_blank" rel="noopener noreferrer"><Icon name="link" size={11} /></a>}
        </div>
        {reasons.length > 0 && (
          <div className="sig-reason">
            <button className="sig-reason__t" onClick={() => setOpen((o) => !o)}>
              {open ? '▾' : '▸'} {open ? 'Hide' : 'Show'} reasoning
            </button>
            {open && <ol>{reasons.map((b, i) => <li key={i}>{b}</li>)}</ol>}
          </div>
        )}
        {symbol && <TradeCta venue={c.venue} />}
      </div>
      <div className="sig-call__pnl">
        <ReturnPath returns={c.returns} />
      </div>
    </div>
  );
}
