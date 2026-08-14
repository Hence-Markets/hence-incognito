/* SignalsRail — the persistent right-hand Signals column (Elfa A/B cohort).

   V0 structure (design round 3): FEED + LEADERBOARD.
   - Feed: smart-money-ranked posts across trending + the user's watchlist, re-ranked
     client-side by the user's own reactions — starred voices float, dismissed voices
     vanish. Every star/dismiss also lands in the stash → a labeled corpus row.
   - Leaderboard: voices ranked by WHO SMART MONEY LISTENS TO (Elfa's smart-follower
     graph), each with the ticker they're loudest on right now. Tapping a row filters
     the feed to that voice; starring seeds the user's own followed set — "following"
     emerges from behavior instead of being pretended.

   Renders ONLY for the team cohort (wallet + flag). */
import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { useAuth } from '../hooks/useAuth';
import { optionalAuthApiFetch } from '../lib/auth-transport';
import { isTeamWallet } from '../lib/team';
import * as stash from '../lib/stash';
// @ts-ignore — JS module
import { getTicker } from '../lib/data.js';

const flagOn = () => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } };

const ago = (iso: string) => {
  const ms = Date.now() - new Date(iso || 0).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const h = ms / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(ms / 6e4)) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
};

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n || 0));

/* the user's voice prefs — per-browser (V0); the stash carries the durable corpus copy */
const loadSet = (k: string): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); }
};
const saveSet = (k: string, v: Set<string>) => {
  try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* storage off */ }
};
const K_STAR = 'hence.sig.starred';
const K_HIDE = 'hence.sig.dismissed';

/* unknown tickers route to analysis (research surface), never to a dead stock page */
const tickerHref = (sym: string) => {
  try { const t = getTicker(sym); return (t && t.real) ? '#/stock/' + encodeURIComponent(sym) : '#/analysis/' + encodeURIComponent(sym); }
  catch { return '#/analysis/' + encodeURIComponent(sym); }
};

/* the feed body — shared by the desktop rail and the mobile Signals tab */
export function SignalsFeed() {
  const auth = useAuth();
  const [tab, setTab] = useState<'feed' | 'leaders'>('feed');
  const [items, setItems] = useState<any[] | null>(null);
  const [voices, setVoices] = useState<any[] | null>(null);
  const [starred, setStarred] = useState<Set<string>>(() => loadSet(K_STAR));
  const [hidden, setHidden] = useState<Set<string>>(() => loadSet(K_HIDE));
  const [voiceFilter, setVoiceFilter] = useState<string | null>(null);
  const on = flagOn() && isTeamWallet(auth.address);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    const pull = () => {
      optionalAuthApiFetch('/api/social/feed?tab=foryou')
        .then((r) => r.json())
        .then((d) => { if (alive && d && d.available) setItems(d.items || []); })
        .catch(() => { if (alive) setItems([]); });
      optionalAuthApiFetch('/api/social/leaderboard')
        .then((r) => r.json())
        .then((d) => { if (alive && d && d.available) setVoices(d.voices || []); })
        .catch(() => { if (alive) setVoices([]); });
    };
    pull();
    const id = window.setInterval(pull, 120_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [on]);

  if (!on) return null;

  const star = (handle: string) => {
    const h = handle.toLowerCase();
    const next = new Set(starred);
    const adding = !next.has(h);
    if (adding) next.add(h); else next.delete(h);
    setStarred(next); saveSet(K_STAR, next);
    if (adding) stash.record({ kind: 'save', subject_type: 'asset', key: 'voice:' + h, title: 'Follows @' + handle, symbols: [] });
  };
  const dismiss = (handle: string) => {
    const h = handle.toLowerCase();
    const next = new Set(hidden); next.add(h);
    setHidden(next); saveSet(K_HIDE, next);
    stash.record({ kind: 'dismiss', subject_type: 'asset', key: 'voice:' + h, title: 'Dismissed @' + handle, symbols: [] });
  };

  // the user's reactions ARE the ranking: dismissed vanish, starred float
  const ranked = (items || [])
    .filter((it) => !hidden.has(it.handle.toLowerCase()))
    .filter((it) => !voiceFilter || it.handle.toLowerCase() === voiceFilter)
    .sort((a, b) => Number(starred.has(b.handle.toLowerCase())) - Number(starred.has(a.handle.toLowerCase())));
  const followingMode = starred.size >= 3;

  return (
    <>
      <div className="sig-rail__tabs">
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>{followingMode ? 'Following' : 'Feed'}</button>
        <button className={tab === 'leaders' ? 'on' : ''} onClick={() => setTab('leaders')}>Leaderboard</button>
      </div>

      {tab === 'feed' ? (
        <>
          {voiceFilter ? (
            <button className="sig-filter" onClick={() => setVoiceFilter(null)}>@{voiceFilter} ✕</button>
          ) : null}
          {items === null ? (
            <div className="sig-rail__empty">Reading the feed…</div>
          ) : !ranked.length ? (
            <div className="sig-rail__empty">{voiceFilter ? 'Nothing from this voice today.' : 'Quiet out there right now.'}</div>
          ) : ranked.map((it) => (
            <div className="sig-card" key={it.tweet_id}>
              <div className="sig-card__top">
                <span className="sig-card__ava">{(it.name || it.handle || '?')[0].toUpperCase()}</span>
                <div className="sig-card__who">
                  <b>{it.name || it.handle}{starred.has(it.handle.toLowerCase()) ? ' ★' : ''}</b>
                  <span>@{it.handle}</span>
                </div>
                <span className="sig-card__time">{ago(it.when)}</span>
                <button className="sig-card__act" title={starred.has(it.handle.toLowerCase()) ? 'Unfollow this voice' : 'Follow this voice'}
                  onClick={() => star(it.handle)}>{starred.has(it.handle.toLowerCase()) ? '★' : '☆'}</button>
                <button className="sig-card__act" title="Fewer from this voice (teaches your feed)" onClick={() => dismiss(it.handle)}>✕</button>
              </div>
              {it.text ? <div className="sig-card__text">{it.text}</div> : (
                <div className="sig-card__text sig-card__text--meta">
                  Posted about ${it.ticker} — {compact(it.views)} views{it.smart ? ` · ${it.smart} smart reposts` : ''}
                </div>
              )}
              <div className="sig-card__foot">
                <a className="sig-card__tk" href={tickerHref(it.ticker)}>
                  <Logo sym={it.ticker} size={14} /> {it.ticker}
                </a>
                <a className="sig-card__x" href={it.link} target="_blank" rel="noopener noreferrer">View on X ↗</a>
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          {voices === null ? (
            <div className="sig-rail__empty">Ranking the voices…</div>
          ) : voices.map((v, i) => (
            <div className="sig-voice" key={v.handle}
              onClick={() => { setVoiceFilter(v.handle.toLowerCase()); setTab('feed'); }}>
              <span className="sig-voice__rank">{i + 1}</span>
              <span className="sig-card__ava">{v.handle[0].toUpperCase()}</span>
              <div className="sig-voice__who">
                <b>@{v.handle}</b>
                <span>{compact(v.smart_followers)} smart · {compact(v.followers || 0)} followers</span>
              </div>
              {v.hot_ticker ? (
                <a className="sig-card__tk" href={tickerHref(v.hot_ticker)} onClick={(e) => e.stopPropagation()}>
                  <Logo sym={v.hot_ticker} size={13} /> {v.hot_ticker}
                </a>
              ) : null}
              <button className="sig-card__act" title="Follow this voice"
                onClick={(e) => { e.stopPropagation(); star(v.handle); }}>{starred.has(v.handle.toLowerCase()) ? '★' : '☆'}</button>
            </div>
          ))}
          <div className="sig-rail__note">Ranked by smart followers — the accounts smart money actually listens to</div>
        </>
      )}
      {tab === 'feed' ? <div className="sig-rail__note">Star a voice to build your Following · dismiss teaches your feed</div> : null}
    </>
  );
}

export function SignalsRail() {
  const auth = useAuth();
  if (!(flagOn() && isTeamWallet(auth.address))) return null;
  return (
    <aside className="sig-rail">
      <div className="sig-rail__head"><span className="sig-rail__title">Signals</span></div>
      <SignalsFeed />
    </aside>
  );
}
