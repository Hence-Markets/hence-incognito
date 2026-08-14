/* =========================================================================
   Profile — a trader's public page, reachable by @handle or wallet address.

   The point of the attribution work was that a thesis card can say "from
   @alice". This is where that link goes: her positions, her theses, and her
   record. Public by design — a shared link opens for someone who has never
   signed in, which is the whole reason it is worth sharing.

   The portfolio itself is PortfolioView with an address, so there is one
   implementation of "show me this account". What it does NOT get is anything
   identity-bound: her page never shows your theses, never records her equity
   as your snapshot, and never renders a Close button wired to your wallet.
   ========================================================================= */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Skeleton } from '../components/Loading';
import { PortfolioView } from './Portfolio';
import { useAuth } from '../hooks/useAuth';
import { track } from '../lib/analytics';
import { optionalAuthApiFetch } from '../lib/auth-transport';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';
// @ts-ignore — JS module
import * as me from '../lib/me.js';
import '../styles/profile.css';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const short = (a?: string | null) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

type Prof = {
  wallet_only: boolean;
  handle: string | null; name?: string | null; avatar_url?: string | null;
  wallet?: string | null; joined_at?: string | null;
  theses?: any[]; record?: any; reach?: any; rating?: RatingPub;
  followers?: number; viewer_follows?: boolean | null;
};

type RatingPub = { tier: string; rated: boolean; scored: number };

/* The author rating, as seen by SOMEONE ELSE: a band and a count, never the integer and never
   a negative label. That asymmetry is deliberate (docs/author-rating.md) — a public number
   invites gaming and humiliates the unlucky, while a band still answers the only question a
   reader has, which is "has this person been right before". The number itself is on your own
   portfolio, where it can be explained. */
const TIER_COPY: Record<string, string> = {
  established: 'Established track record',
  tracking: 'Building a track record',
  emerging: 'Early track record',
  unrated: 'Not yet rated',
};

function RatingBand({ r }: { r?: RatingPub }) {
  if (!r) return null;
  const tier = r.rated ? r.tier : 'unrated';
  return (
    <span className={'prof__band prof__band--' + tier} title={TIER_COPY[tier] || ''}>
      <Icon name="spark" size={11} />
      {r.rated ? TIER_COPY[tier] : 'Not yet rated'}
      {r.scored > 0 && <em>{r.scored} closed</em>}
    </span>
  );
}

/* The rest of the record: what the product measures directly, alongside the band. */
function Record({ rec, reach }: { rec: any; reach: any }) {
  if (!rec || !rec.total) return null;
  const stats: [string, string][] = [
    ['Theses', String(rec.total)],
    ['Funded', `${rec.run}/${rec.total}`],
    ['Deployed', rec.deployed > 0 ? '$' + Math.round(rec.deployed).toLocaleString() : '—'],
    ['Still open', String(rec.active)],
    ['Invalidated', String(rec.invalidated)],
    ['Played out', String(rec.resolved)],
  ];
  if (reach && reach.people) stats.push(['Taken by', `${reach.people} ${reach.people === 1 ? 'person' : 'people'}`]);
  return (
    <div className="prof__record">
      {stats.map(([k, v]) => (
        <div key={k} className="prof__stat"><b>{v}</b><span>{k}</span></div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { id = '' } = useParams();
  const auth = useAuth();
  const [prof, setProf] = useState<Prof | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setState('loading'); setProf(null);
    optionalAuthApiFetch('/api/u/' + encodeURIComponent(id))
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Prof | null) => {
        if (!alive) return;
        if (!p) { setState('missing'); return; }
        setProf(p); setFollowing(p.viewer_follows ?? null); setState('ok');
        track('profile_viewed', { handle: p.handle || null, wallet_only: p.wallet_only });
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, [id]);

  const isMe = !!prof?.wallet && !!auth.address && prof.wallet.toLowerCase() === auth.address.toLowerCase();

  const toggleFollow = async () => {
    if (!auth.authenticated) { toast('Sign in to follow', { icon: 'wallet' }); auth.login?.(); return; }
    if (!prof?.handle || busy) return;
    const next = !following;
    setBusy(true); setFollowing(next);                 // optimistic
    try {
      await me.followUser(prof.handle, next);
      track(next ? 'user_followed' : 'user_unfollowed', { handle: prof.handle });
    } catch {
      setFollowing(!next);
      toast('Could not update follow just now', { icon: 'close' });
    } finally { setBusy(false); }
  };

  const copyLink = () => {
    const url = location.origin + '/u/' + (prof?.handle || id);
    navigator.clipboard?.writeText(url)
      .then(() => toast('Profile link copied', { icon: 'check' }))
      .catch(() => toast(url, { icon: 'link' }));
  };

  if (state === 'loading') {
    return <Shell><div className="prof"><Skeleton w={520} h={72} /><Skeleton w={520} h={220} /></div></Shell>;
  }

  if (state === 'missing') {
    const looksLikeAddress = ADDR.test(id);
    return (
      <Shell>
        <div className="prof">
          <div className="prof__empty">
            <Icon name="hidden" size={22} />
            <b>{looksLikeAddress ? 'Nothing to show for this address' : 'No trader called @' + id}</b>
            <p>{looksLikeAddress
              ? 'That address has no activity Hence can read.'
              : 'Check the handle, or paste a wallet address instead.'}</p>
            <a className="prof__cta" href="#/">Back to Hence</a>
          </div>
        </div>
      </Shell>
    );
  }

  const p = prof!;
  const title = p.handle ? '@' + p.handle : short(p.wallet);

  return (
    <Shell>
      <div className="prof">
        <header className="prof__head">
          <span className="prof__avatar">
            {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <Icon name="user" size={20} />}
          </span>
          <div className="prof__id">
            <h2>{title} {!p.wallet_only && <RatingBand r={p.rating} />}</h2>
            <span className="prof__sub">
              {p.name ? p.name + ' · ' : ''}
              {p.wallet ? short(p.wallet) : ''}
              {p.followers ? ` · ${p.followers} follower${p.followers === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          <div className="prof__acts">
            <button className="prof__act" onClick={copyLink}><Icon name="link" size={13} /> Share</button>
            {!isMe && p.handle && (
              <button className={'prof__act' + (following ? '' : ' prof__act--pri')} disabled={busy} onClick={toggleFollow}>
                {following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        </header>

        {p.wallet_only ? (
          <div className="prof__walletonly">
            <Icon name="info" size={12} /> This wallet isn’t on Hence — showing its public on-chain
            positions only, with no theses or track record.
          </div>
        ) : (
          <Record rec={p.record} reach={p.reach} />
        )}

        {/* one implementation of "show me this account", pointed at their address */}
        <PortfolioView embedded address={p.wallet || undefined} profileTheses={p.theses || null} />

        {!p.wallet_only && !(p.theses || []).length && (
          <div className="prof__note">
            {title} hasn’t shared any theses yet — only traders who run a thesis publish one.
          </div>
        )}
      </div>
    </Shell>
  );
}
