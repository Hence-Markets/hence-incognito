import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMe } from '../hooks/useMe';
import { useHlAccount } from '../hooks/useHlAccount';
import { useMarketReady } from '../hooks/useMarket';
import { snapshotCachedAll, type Snapshot } from '../lib/venueBalances';
import { Icon } from './Icon';

/* =========================================================================
   WalletChip — a global, fixed top-right chip for the connected wallet
   (mirrors the Dock's global-fixed pattern; there is no app-wide top bar).
   Signed out → "Connect" (Privy login). Signed in → avatar + LIVE BALANCE
   (buying power is the number people glance for on a trading app); tap opens
   the accounts/wallet sheet (deposit / withdraw / connections / identity).
   ========================================================================= */
const fmtBal = (v: number) => {
  const d = v >= 1000 ? 0 : 2;
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
};

export function WalletChip() {
  // hooks first — unconditional, so the order never changes across auth/route flips
  const auth = useAuth();
  const loc = useLocation();
  const { me: profile } = useMe();
  const hl = useHlAccount(auth.authenticated ? auth.address : undefined);
  const marketReady = useMarketReady();
  const [avatarBad, setAvatarBad] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  // Cross-venue total (wallet chains + HL + PM) for the embedded wallet PLUS the
  // on-chain balances of every linked external wallet — the user's whole picture in
  // one number. Waits for market data so ETH is priced before the first (cached)
  // load; refreshes on a slow ambient cadence.
  const addr = auth.authenticated ? auth.address : undefined;
  const linkedKey = auth.authenticated ? (auth.wallets || []).map((w: any) => w.address).join(',') : '';
  useEffect(() => {
    setSnap(null);
    if (!addr || !marketReady) return;
    let alive = true;
    const linked = linkedKey ? linkedKey.split(',') : [];
    const load = () => { snapshotCachedAll(addr, linked).then((s) => { if (alive && s) setSnap(s); }).catch(() => { /* keep fallback */ }); };
    load();
    const iv = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(iv); };
  }, [addr, marketReady, linkedKey]);

  if (!auth.ready) return null;
  // the trade terminal is a dense full-bleed UI with its OWN account selector — the floating
  // chip would overlap it (and be redundant), so step aside there.
  if ((loc.pathname || '').startsWith('/terminal')) return null;

  if (!auth.authenticated) {
    return (
      <button className="wchip wchip--connect" onClick={() => auth.login()} aria-label="Connect wallet">
        <Icon name="wallet" size={14} /><span>Connect</span>
      </button>
    );
  }

  // the claimed username is the user's chosen identity; it's the fallback label until the
  // balance loads (or if this address has no Hyperliquid account yet) — never a blank or a
  // misleading $0.00 for someone who simply hasn't funded.
  const handle = (profile?.handle ? '@' + profile.handle : '') || auth.shortAddr || 'Wallet';
  // Prefer the cross-venue total; a partial 0 means every venue failed → not a real $0.
  // Fall back to HL equity (its hook has its own cadence), then the handle.
  const label = snap && !(snap.partial && snap.total === 0) ? fmtBal(snap.total)
    : hl.loaded ? fmtBal(hl.accountValue)
      : handle;
  const openWallet = () => window.dispatchEvent(new CustomEvent('hence:accounts'));
  const showAvatar = auth.avatarUrl && !avatarBad;
  return (
    <button className="wchip" onClick={openWallet} aria-label="Wallet & accounts" title={handle + ' · Wallet & accounts'}>
      {showAvatar
        ? <img className="wchip__av" src={auth.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarBad(true)} />
        : <span className="wchip__av wchip__av--i" aria-hidden>{(auth.firstName || handle).slice(0, 1).toUpperCase()}</span>}
      <span className="wchip__addr ph-mask">{label}</span>
      <Icon name="chevDown" size={13} />
    </button>
  );
}
