/* =========================================================================
   Referral — your invite link + the real referral graph (/api/me/referrals).
   Each referred signup is an immutable referred_by edge recorded at signup;
   this screen shows the counts and per-referral QUALITY signals (onboarded /
   connected / active) — the substrate the future rewards & fee-share math
   will build on. Replaces the old static "Sam referred you" demo screen.
   ========================================================================= */
import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Loading';
import { useAuth } from '../hooks/useAuth';
import { authenticatedApiFetch } from '../lib/auth-transport';
import { track } from '../lib/analytics';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';
import '../styles/referral.css';

type Ref = { handle: string | null; joined_at: string; onboarded: boolean; connected: boolean; active: boolean; score: number };
type Stats = { code: string; vanity: string | null; link: string; count: number; onboarded: number; connected: number; active: number; referrals: Ref[] };

const ago = (s: string) => {
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
};

function StatusChips({ r }: { r: Ref }) {
  return (
    <span className="rfl__chips">
      <em className="on">Joined</em>
      <em className={r.onboarded ? 'on' : ''}>Onboarded</em>
      <em className={r.connected ? 'on' : ''}>Connected</em>
      <em className={r.active ? 'on' : ''}>Active</em>
    </span>
  );
}

export default function Referral() {
  const auth = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!auth.ready || !auth.authenticated) return;
    let alive = true;
    authenticatedApiFetch('/api/me/referrals')
      .then((r: Response) => r.json())
      .then((j: any) => { if (!alive) return; j && j.available ? setStats(j) : setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [auth.ready, auth.authenticated]);

  const copy = async () => {
    if (!stats) return;
    try { await navigator.clipboard.writeText(stats.link); track('referral_link_copied', {}); toast('Invite link copied', { icon: 'check' }); }
    catch { toast('Could not copy — long-press the link instead', { icon: 'close' }); }
  };

  const share = async () => {
    if (!stats) return;
    const nav: any = navigator;
    if (nav.share) {
      try { await nav.share({ title: 'Join me on Hence', text: 'Turn what you believe into real trades — join me on Hence.', url: stats.link }); } catch { /* user dismissed */ }
    } else copy();
  };

  return (
    <Shell>
      <div className="rfl">
        <header className="rfl__head">
          <h2>Refer a friend</h2>
          <span className="rfl__sub">Every signup through your link is tracked — rewards and fee sharing will build on this.</span>
        </header>

        {!auth.ready ? (
          <div className="rfl__loading"><Skeleton w={520} h={64} /><Skeleton w={520} h={120} /></div>
        ) : !auth.authenticated ? (
          <div className="rfl__empty">
            <Icon name="gift" size={22} />
            <b>Sign in to get your invite link</b>
            <p>Your referrals are tracked per account.</p>
            <button className="rfl__cta" onClick={() => auth.login?.()}>Sign in</button>
          </div>
        ) : failed ? (
          <div className="rfl__empty"><b>Couldn’t load your referrals just now</b><p>Try again in a moment.</p></div>
        ) : !stats ? (
          <div className="rfl__loading"><Skeleton w={520} h={64} /><Skeleton w={520} h={120} /></div>
        ) : (
          <>
            <div className="rfl__linkcard">
              <div className="rfl__linkrow">
                <span className="rfl__link">{stats.link}</span>
                <button className="rfl__act rfl__act--pri" onClick={copy}><Icon name="copy" size={13} /> Copy</button>
                <button className="rfl__act" onClick={share}><Icon name="send" size={13} /> Share</button>
              </div>
              {stats.vanity ? <div className="rfl__vanity">Also works: <b>hence.markets/?ref={stats.vanity}</b> (your username)</div> : null}
            </div>

            <div className="rfl__stats">
              <div><span>Invited</span><b>{stats.count}</b></div>
              <div><span>Onboarded</span><b>{stats.onboarded}</b></div>
              <div><span>Connected</span><b>{stats.connected}</b></div>
              <div><span>Active</span><b>{stats.active}</b></div>
            </div>

            {stats.referrals.length ? (
              <div className="rfl__list">
                {stats.referrals.map((r, i) => (
                  <div key={i} className="rfl__row">
                    <span className="rfl__who">{r.handle ? '@' + r.handle : 'New member'}</span>
                    <StatusChips r={r} />
                    <span className="rfl__when">{ago(r.joined_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rfl__empty rfl__empty--soft">
                <b>No referrals yet</b>
                <p>Share your link — you’ll see every signup here, with how far they’ve made it (onboarded → connected → active).</p>
              </div>
            )}

            <p className="rfl__note">A referral counts when someone signs up through your link. Quality = how far they get:
              onboarding finished, an account or wallet connected, and real activity (watchlist, saved ideas, theses).</p>
          </>
        )}
      </div>
    </Shell>
  );
}
