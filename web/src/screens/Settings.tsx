import { useEffect, useState } from 'react';
import '../styles/settings-extra.css';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { icon, openModal, toast } from '../lib/ui.js';
import { useAuth } from '../hooks/useAuth';
import { isTeamWallet } from '../lib/team';
import { useMe } from '../hooks/useMe';
import { INTEREST_GROUPS, keyOf } from '../lib/interests.js';
import { startDockTour } from '../components/DockTour';
import * as me from '../lib/me.js';
import { setCmdScope, clearCmdScope } from '../lib/cmdScope';
import { openFeedback } from '../lib/feedback';
// @ts-ignore — JS module
import { escapeHtml } from '../lib/safe-html.js';

/* kind:topic → display label (asset rows from learned/holdings fall back to the topic) */
const ALGO_LABEL: Record<string, string> = {};
INTEREST_GROUPS.forEach((g: any) => g.items.forEach((it: any) => { ALGO_LABEL[keyOf(g.kind, it.topic)] = it.label; }));

/* how each algorithm nudge reads in the "this week" trail */
const ALGO_NOTE: Record<string, string> = {
  agree: 'you agreed with an idea',
  save: 'you saved an idea',
  watch: 'you started watching',
  paper_call: 'you made a call',
  trade: 'you traded it',
  dismissed: 'you dismissed ideas',
  picked: 'picked in a retune',
  dropped: 'dropped in a retune',
  thesis: 'you asserted a thesis',
};

const relTime = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '';
  const m = Math.floor(Math.max(0, ms) / 60000);   // clamp clock skew → 'just now', never blank
  if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/* "Your algorithm" — the user's interest weights, visibly evolving as Hence learns.
   source 'onboarding' = they picked it; 'learned'/'holdings' = Hence inferred it.
   The weekly drift (▲/▼ per interest + the recent-nudge trail) comes from /api/me/algo. */
function AlgoBlock() {
  const { me: profile, interests } = useMe();
  const [algo, setAlgo] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    if (!profile) { setAlgo(null); return; }
    Promise.resolve(me.loadAlgo(7)).then((r: any) => {
      if (alive && r && r.available) setAlgo(r);
    });
    return () => { alive = false; };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = (interests || []).slice(0, 8);
  if (!profile) {
    return <div className="setx-algo__empty">Sign in to see the algorithm Hence builds around you.</div>;
  }

  // the "this week" trail doesn't need interest rows — it's exactly what explains an
  // emptied-out algorithm after a retune-to-zero, so build it before the empty-rows branch
  const events = (algo?.events || []).slice(0, 4);
  const feed = events.length ? (
    <div className="setx-algo__feed">
      <div className="setx-algo__feedhead">This week</div>
      {events.map((e: any, i: number) => (
        <div className="setx-algo__ev" key={i}>
          <span className={'setx-algo__evarrow' + (e.delta > 0 ? ' is-up' : ' is-dn')}>{e.delta > 0 ? '▲' : '▼'}</span>
          <span className="setx-algo__evlabel">{ALGO_LABEL[keyOf(e.kind, e.topic)] || e.topic}</span>
          <span className="setx-algo__evnote">{ALGO_NOTE[e.note] || e.note || 'nudged'}</span>
          <span className="setx-algo__evtime">{relTime(e.created_at)}</span>
        </div>
      ))}
    </div>
  ) : null;

  if (!rows.length) {
    return (
      <div className="setx-algo">
        <div className="setx-algo__empty">Nothing tuned yet — Hence learns from what you react to, or retune below.</div>
        {feed}
      </div>
    );
  }

  const deltaFor: Record<string, number> = {};
  (algo?.deltas || []).forEach((d: any) => { deltaFor[keyOf(d.kind, d.topic)] = Number(d.change) || 0; });
  const moved = (algo?.deltas || []).length > 0;

  return (
    <div className="setx-algo">
      {rows.map((r: any) => {
        const k = keyOf(r.kind, r.topic);
        const pct = Math.round(Math.min(Number(r.weight) || 1, 5) / 5 * 100);
        const ch = deltaFor[k];
        return (
          <div className="setx-algo__row" key={k}>
            <span className="setx-algo__label">{ALGO_LABEL[k] || r.topic}</span>
            <span className={'setx-algo__src' + (r.source !== 'onboarding' ? ' is-learned' : '')}>
              {r.source === 'onboarding' ? 'picked' : r.source}
            </span>
            <div className="peer-bar setx-algo__bar"><span style={{ width: pct + '%' }} /></div>
            {ch ? (
              <span className={'setx-algo__delta' + (ch > 0 ? ' is-up' : ' is-dn')}>
                {ch > 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(2)}
              </span>
            ) : (
              <span className="setx-algo__delta is-flat">·</span>
            )}
          </div>
        );
      })}
      {(interests || []).length > rows.length ? (
        <div className="setx-algo__more">+{(interests || []).length - rows.length} more shaping your feed</div>
      ) : null}
      {feed}
      {!feed && algo && !moved ? (
        <div className="setx-algo__more">No movement this week — react to ideas and watch this shift.</div>
      ) : null}
    </div>
  );
}

/* ---------- Shortcuts cheat sheet — right-side drawer ---------- */
const SHORTCUT_GROUPS: any[] = [
  ['General', [
    ['Hence Command', ['⌘', 'K']],
    ['Search', ['/']],
    ['View watchlist', ['W']],
    ['Shortcuts', ['?']],
    ['Sign out', ['option', 'shift', 'Q']],
  ]],
  ['Navigation', [
    ['Next / previous items', ['J', 'K']],
    ['Open', ['return']],
    ['Next tab', ['tab']],
    ['Previous tab', ['shift', 'tab']],
    ['Toggle option', ['Q']],
    ['Free navigation', ['←', '→', '↑', '↓']],
  ]],
  ['Pages', [
    ['Go to Home', ['G', 'then', 'H']],
    ['Go to Analysis', ['G', 'then', 'A']],
    ['Go to Markets', ['G', 'then', 'M']],
    ['Go to Insiders', ['G', 'then', 'I']],
    ['Go to Calendar', ['G', 'then', 'C']],
    ['Go to Watchlist', ['G', 'then', 'W']],
  ]],
];
function keysHtml(keys: string[]) {
  return keys.map(k => k === 'then'
    ? `<span class="setx-then">then</span>`
    : `<kbd class="setx-kbd">${k}</kbd>`).join('');
}
function rowsHtml(groups: any[]) {
  return groups.map(([title, items]: any) => `
    <div class="setx-sc-group">${title}</div>
    ${items.map(([label, keys]: any) => `
      <div class="setx-sc-row"><span class="setx-sc-label">${label}</span><span class="setx-sc-keys">${keysHtml(keys)}</span></div>`).join('')}
  `).join('');
}
function shortcutsDrawer() {
  const root = document.getElementById('modal-root') || document.body;
  const wrap: any = document.createElement('div');
  wrap.className = 'setx-drawer-overlay';
  wrap.innerHTML = `
    <div class="setx-drawer-backdrop" data-close></div>
    <aside class="setx-drawer">
      <div class="setx-sc-search">${icon('search', 16)}<input placeholder="Search shortcuts" autofocus /></div>
      <div class="setx-sc-list" data-list>${rowsHtml(SHORTCUT_GROUPS)}</div>
    </aside>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap._close = close;
  requestAnimationFrame(() => wrap.classList.add('in'));
  const input = wrap.querySelector('input');
  const listEl = wrap.querySelector('[data-list]');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    const groups = SHORTCUT_GROUPS
      .map(([t, items]: any) => [t, items.filter((it: any) => it[0].toLowerCase().includes(q))])
      .filter(([, items]: any) => items.length);
    listEl.innerHTML = rowsHtml(groups);
  });
  setTimeout(() => input.focus(), 60);
}

/* Feedback lives in the global bottom-anchored composer (lib/feedback.ts +
   FeedbackPanel), which persists across navigation. */

function profileModal(name?: string, email?: string) {
  const safeName = escapeHtml(name || 'Account');
  const safeEmail = email ? escapeHtml(email) : '';
  const initial = escapeHtml(Array.from(name || 'A')[0] || 'A');
  openModal(`
    <div class="modal-body" style="text-align:center;padding:30px">
      <div class="login__mark" style="margin-bottom:14px;background:radial-gradient(circle at 40% 30%,#c0c4cc,#6b7078)">${initial}</div>
      <h2 style="font-size:20px;font-weight:600">${safeName}</h2>
      ${safeEmail ? `<p class="muted" style="font-size:13px;margin-top:4px">${safeEmail}</p>` : ''}
      <p class="muted" style="font-size:11px;margin-top:18px;border-top:1px solid var(--line);padding-top:14px">Billing details are unavailable in this build.</p>
    </div>`);
}

/* ---------- screen ---------- */

export default function Settings() {
  const auth = useAuth();
  const { me: profile } = useMe();
  const isTeam = isTeamWallet(auth.address);

  // register the "Settings" command scope — the page's real actions as commands
  useEffect(() => {
    const flip = (key: string) => {
      try { localStorage.setItem(key, localStorage.getItem(key) === '1' ? '0' : '1'); } catch { /* noop */ }
      window.dispatchEvent(new Event('hence:dockpref'));
    };
    const scope = {
      id: 'settings', label: 'Settings', icon: 'settings', placeholder: 'Search commands',
      groups: [{ title: 'Commands', items: [
        { label: 'Toggle the navigation dock', icon: 'compass', run: () => flip('hence.hidedock') },
        { label: 'Toggle navigation hints', icon: 'bookmark', run: () => flip('hence.hidehints') },
        { label: 'Send feedback', icon: 'mail', run: () => openFeedback() },
        { label: 'Replay the dock tour', icon: 'play', run: () => startDockTour() },
        { label: 'Sign out', icon: 'signout', run: () => { auth.logout(); location.hash = '#/login'; } },
      ] }],
    };
    setCmdScope(scope);
    return () => clearCmdScope(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.authenticated]);

  const w = window as any;
  const authKey = auth.authenticated ? ((auth.user as any)?.id || auth.email || auth.address || 'account') : 'guest';
  const claimed = profile?.handle ? '@' + profile.handle : '';
  if (auth.authenticated && w._henceNameOwner !== authKey) {
    // prefer a real name; a wallet-only login has none (useAuth falls back to 'Trader'),
    // so the claimed username is the user's chosen identity there
    w._henceName = (auth.name && auth.name !== 'Trader' ? auth.name : '') || claimed || auth.name || 'Account';
    w._henceNameOwner = authKey;
  }
  // the profile loads async — upgrade the generic fallback once the handle arrives
  if (auth.authenticated && w._henceName === 'Trader' && claimed) w._henceName = claimed;
  w._henceEmail = auth.authenticated ? (auth.email || (auth.xHandle ? '@' + auth.xHandle : '') || auth.shortAddr || '') : '';
  const name = auth.authenticated ? (w._henceName || auth.name || 'Account') : 'Guest';

  /* ---- editable name field: click focuses, commit on blur/Enter ---- */
  const onNameFocus = (e: any) => { e.target.closest('.setx-namewrap')?.classList.add('is-edit'); };
  const onNameBlur = (e: any) => {
    const input = e.target;
    input.closest('.setx-namewrap')?.classList.remove('is-edit');
    if (!auth.authenticated) { input.value = 'Guest'; return; }
    const v = input.value.trim();
    if (v) w._henceName = v; else input.value = w._henceName;
  };
  const onNameKeyDown = (e: any) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };

  return (
    <Shell dockActive="settings">
      <div className="settings">
        <div className="settings__top">
          <div className="settings__title"><Icon name="back" size={18} /> Settings</div>
          <a className="btn-ghost" onClick={() => { if (auth.authenticated) auth.logout(); location.hash = '#/login'; }}><Icon name="signout" size={14} /> Sign out</a>
        </div>
        <div className="settings__grid">
          <div className="set-panel"><div className="set-navrow">
            <nav className="set-nav">
              <a className="on"><Icon name="user" size={15} /> Account</a>
              <div className="grp">Options</div>
              <a><Icon name="sliders" size={15} /> Options</a>
              <div className="grp">Support</div>
              <a><Icon name="heart" size={15} /> Support</a>
              <div className="grp">Referrals</div>
              <a><Icon name="gift" size={15} /> Referrals</a>
            </nav>
            <div className="set-body">
              <div className="set-row">
                <div className="set-row__l"><span className="set-row__ic"><Icon name="user" size={16} /></span>
                  <div className="setx-namewrap">
                    <input
                      className="setx-name"
                      defaultValue={name}
                      readOnly={!auth.authenticated}
                      onFocus={onNameFocus}
                      onBlur={onNameBlur}
                      onKeyDown={onNameKeyDown}
                    />
                  </div>
                </div>
                <button className="icon-btn" onClick={() => profileModal(name, w._henceEmail)}><Icon name="chevR" size={16} /></button>
              </div>

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Options</div>
              <ToggleRow icon="bookmark" label="Hide the navigation hints" storageKey="hence.hidehints" emitEvent="hence:dockpref" />
              <ToggleRow icon="compass" label="Hide the navigation dock" storageKey="hence.hidedock" emitEvent="hence:dockpref" />
              <ToggleRow icon="mail" label="Weekly newsletter (not connected)" />

              {isTeam ? (
                <>
                  <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Labs · team only</div>
                  {/* flips this browser into the Elfa cohort: copilot social tool, the
                      social-grounded recap, and the attention strip. Compare, then decide. */}
                  <ToggleRow icon="analyze" label="Social attention A/B (Elfa)" storageKey="hence.elfaSocial" />
                </>
              ) : null}

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Your algorithm</div>
              <AlgoBlock />
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => { location.hash = '#/onboarding/interests'; }}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="bolt" size={15} /></span><div className="set-row__t">Retune your interests</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => { location.hash = '#/welcome/splash'; }}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="play" size={15} /></span><div className="set-row__t">Replay the welcome tour</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => startDockTour()}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="compass" size={15} /></span><div className="set-row__t">Learn the dock</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Sharing</div>
              <ShareThesesRow />

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Support</div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => shortcutsDrawer()}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="list" size={15} /></span><div className="set-row__t">Shortcuts cheat sheet</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => openFeedback()}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="heart" size={15} /></span><div className="set-row__t">Contact support</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => openFeedback()}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="send" size={15} /></span><div className="set-row__t">Share feedback</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Legal</div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => { location.hash = '#/legal/terms'; }}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="doc" size={15} /></span><div className="set-row__t">Terms of Use</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => { location.hash = '#/legal/privacy'; }}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="hidden" size={15} /></span><div className="set-row__t">Privacy Policy</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>
              <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => { location.hash = '#/legal/cookies'; }}>
                <div className="set-row__l"><span className="set-row__ic"><Icon name="list" size={15} /></span><div className="set-row__t">Cookie &amp; Telemetry Policy</div></div>
                <span className="set-link"><Icon name="arrowUp" size={15} /></span>
              </div>

              <div className="grp" style={{ fontSize: 10, color: 'var(--dimmer)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 2px' }}>Referrals</div>
              <a className="refer-box" href="#/referral" style={{ cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div className="refer-box__t">Referral program</div>
                  <div className="refer-box__s">Share your link — every signup is tracked toward future rewards.</div>
                </div>
                <span className="refer-medal"></span>
              </a>
            </div>
          </div></div>

          {/* the billing-and-membership card + Hence-for-Mac banner lived here — removed
              2026-07-20 (user call): "unavailable in this build" placeholders read as broken
              product, not roadmap. Restore from git history when either actually ships. */}
        </div>
      </div>
    </Shell>
  );
}

/* ---------- "Share theses you run" (server-backed, unlike the localStorage rows) ----------
   Running a thesis publishes the IDEA under your handle so others can find it, with you
   credited. It never publishes the position — amount, size, leverage and P&L stay private.
   ON by default, so this row is where that becomes visible and reversible; turning it off
   also retracts everything already shared. */
function ShareThesesRow() {
  const { me: profile } = useMe();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (profile && typeof profile.share_theses === 'boolean') setOn(profile.share_theses); }, [profile]);

  const toggle = async () => {
    if (busy || on == null) return;
    const next = !on;
    setBusy(true); setOn(next);                       // optimistic — reverted below if the write fails
    try {
      const r: any = await me.setShareTheses(next);
      if (r && typeof r.share_theses === 'boolean') setOn(r.share_theses);
      toast(next
        ? 'Theses you run will be shared under your handle — the idea only.'
        : 'Sharing off. Your published theses have been made private again.', { icon: 'check' });
    } catch {
      setOn(!next);
      toast('Could not update sharing just now', { icon: 'close' });
    } finally { setBusy(false); }
  };

  if (on == null) return null;                        // don't flash a wrong default before the profile lands
  return (
    <div className="set-row">
      <div className="set-row__l">
        <span className="set-row__ic"><Icon name="send" size={15} /></span>
        <div className="set-row__t">
          Share theses you run
          <div style={{ fontSize: 11, color: 'var(--dimmer)', marginTop: 2, lineHeight: 1.4, maxWidth: 340 }}>
            Publishes the idea under your handle so others can find it, credited to you. Never your
            amount, size or P&amp;L.
          </div>
        </div>
      </div>
      <button className={'toggle' + (on ? ' on' : '')} onClick={toggle} aria-pressed={on}></button>
    </div>
  );
}

/* ---------- option toggle row (visual on/off, optionally persisted) ----------
   Pass storageKey to back the switch with localStorage ('1'/'0') and fire an
   optional window event so live listeners (the dock, hint chips) react at once. */
function ToggleRow({ icon: ic, label, defaultOn = false, storageKey, emitEvent }:
  { icon: string; label: string; defaultOn?: boolean; storageKey?: string; emitEvent?: string }) {
  const read = () => {
    if (!storageKey) return defaultOn;
    try { const v = localStorage.getItem(storageKey); return v == null ? defaultOn : v === '1'; } catch { return defaultOn; }
  };
  const [on, setOn] = useState(read);
  // stay in sync when the SAME preference is toggled elsewhere (e.g. the global Q shortcut
  // fires hence:dockpref) so the switch never shows a state that disagrees with the dock.
  useEffect(() => {
    if (!storageKey || !emitEvent) return;
    const sync = () => setOn(read());
    window.addEventListener(emitEvent, sync);
    return () => window.removeEventListener(emitEvent, sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, emitEvent]);
  const toggle = () => setOn((v) => {
    const next = !v;
    if (storageKey) { try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* noop */ } }
    if (emitEvent) window.dispatchEvent(new Event(emitEvent));
    return next;
  });
  return (
    <div className="set-row">
      <div className="set-row__l"><span className="set-row__ic"><Icon name={ic} size={15} /></span><div className="set-row__t">{label}</div></div>
      <button className={'toggle' + (on ? ' on' : '')} onClick={toggle}></button>
    </div>
  );
}
