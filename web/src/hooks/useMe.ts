import { useEffect, useState } from 'react';
import * as me from '../lib/me.js';

// Reactive view of the signed-in user's server-side profile (synced by AuthBridge on login).
// Reads window.henceMe and re-renders on the 'hence:me' event. Returns null when logged out.
export function useMe() {
  const [profile, setProfile] = useState<any>((window as any).henceMe || null);
  useEffect(() => {
    const on = () => setProfile((window as any).henceMe || null);
    window.addEventListener('hence:me', on);
    return () => window.removeEventListener('hence:me', on);
  }, []);
  return {
    me: profile,
    interests: profile?.interests || [],
    watchlist: profile?.watchlist || [],
    connections: profile?.connections || [],
    onboarded: !!profile?.onboarded,
    setInterests: me.setInterests,
    saveConnection: me.saveConnection,
    removeConnection: me.removeConnection,
    setWatchlist: me.setWatchlist,
    refresh: me.loadMe,
  };
}
