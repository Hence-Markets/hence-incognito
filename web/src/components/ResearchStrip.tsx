/* ResearchStrip — the honesty badge + demand capture on research-mode asset pages.
   Sits under the topbar for symbols we can research (full FMP data, EOD prices) but
   not trade. Every view pings the demand ledger (anonymous, aggregate-only); signed-in
   users can Request listing / get notified — the strong signals behind the
   listing-intelligence dataset. */
import { track } from '../lib/analytics';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../hooks/useAuth';
import { optionalAuthApiFetch } from '../lib/auth-transport';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';

type Counts = { requests: number; notifies: number; views: number };

async function demand(symbol: string, action: 'view' | 'request' | 'notify'): Promise<Counts | null> {
  try {
    // 'view' fires on every research-page mount — only explicit demand is a conversion
    if (action !== 'view') track('research_listing_requested', { sym: symbol, action });
    const r = await optionalAuthApiFetch('/api/research/demand', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, action }),
    });
    const d = await r.json();
    if (r.status === 401) { toast(d.error || 'Sign in first', { icon: 'wallet' }); return null; }
    return d && d.available ? d : null;
  } catch { return null; }
}

export function ResearchStrip({ sym }: { sym: string }) {
  const auth = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [done, setDone] = useState<{ request?: boolean; notify?: boolean }>({});
  const pinged = useRef('');

  // one view ping per symbol per mount (anonymous, weak demand signal)
  useEffect(() => {
    if (pinged.current === sym) return;
    pinged.current = sym;
    demand(sym, 'view').then((c) => c && setCounts(c));
  }, [sym]);

  const act = async (action: 'request' | 'notify') => {
    if (!auth.authenticated) { toast('Sign in to ' + (action === 'request' ? 'request a listing' : 'get notified'), { icon: 'wallet' }); auth.login?.(); return; }
    const c = await demand(sym, action);
    if (c) {
      setCounts(c);
      setDone((d) => ({ ...d, [action]: true }));
      toast(action === 'request' ? 'Listing request recorded — it counts.' : "You'll be notified when it's tradeable.", { icon: 'check' });
    }
  };

  return (
    <div className="rstrip">
      <span className="rstrip__badge"><Icon name="doc" size={11} /> Research only</span>
      <span className="rstrip__txt">Not tradeable on Hence yet · prices are end-of-day</span>
      {counts && counts.requests > 0 ? (
        <span className="rstrip__count">{counts.requests} trader{counts.requests === 1 ? '' : 's'} want{counts.requests === 1 ? 's' : ''} this listed</span>
      ) : null}
      <span className="rstrip__acts">
        <button className="rstrip__btn rstrip__btn--pri" disabled={!!done.request} onClick={() => act('request')}>
          {done.request ? <><Icon name="check" size={11} /> Requested</> : 'Request listing'}
        </button>
        <button className="rstrip__btn" disabled={!!done.notify} onClick={() => act('notify')}>
          {done.notify ? <><Icon name="check" size={11} /> Watching</> : 'Notify me'}
        </button>
      </span>
    </div>
  );
}
