import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { henceMarkSvg } from './HenceLogo';
import { useAsk, openAsk } from '../lib/assistant';
import { useTrade } from '../lib/tradeTicket';
import { useFeedback } from '../lib/feedback';
// @ts-ignore — JS module
import * as me from '../lib/me.js';

/* =========================================================================
   MobileTabBar — the phone-first primary nav (the floating desktop Dock is
   hidden ≤760px). Five thumb targets tuned to what people actually DO with
   Hence on a phone, not a squeezed desktop menu:
     • Home      — the pulse check (recap, feed, setups)
     • Markets   — browse / react (screener + asset pages live under it)
     • ∴ Ask     — capture a belief → plan: the mission primitive, centre + raised
     • Portfolio — positions + watchlist + theses, with a dot when the nightly
                   checker flags a thesis (review due / invalidated)
     • Search    — the universal typed entry to everything else
   Wallet + balance live in the top-right chip, not here (see WalletChip). This
   replaces the old Home·Markets·Calendar·Watchlist·Search bar — Calendar was
   burning a prime slot and there was no belief-capture or positions view.
   ========================================================================= */

// Markets owns the browse/react surfaces; Portfolio owns "my money & my ideas".
const MARKETS_RE = /^\/(screener|stock|compare|economy|analysis|analyst|calendar)/;
const PORT_RE = /^\/(watchlist|theses)/;

// a dot on Portfolio when the nightly checker has something waiting (fetched once
// per session + on login; theses status barely changes intra-session).
function useThesisFlag() {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!(window as any).henceMe) { setFlag(false); return; }
      me.loadTheses()
        .then((r: any) => {
          if (!alive || !r || !r.available || !Array.isArray(r.theses)) return;
          setFlag(r.theses.some((t: any) =>
            t.status === 'invalidated'
            || (((t.last_check && t.last_check.flags) || []) as string[]).includes('review_due')));
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('hence:me', load);
    return () => { alive = false; window.removeEventListener('hence:me', load); };
  }, []);
  return flag;
}

export function MobileTabBar() {
  const loc = useLocation();
  const ask = useAsk();
  const trade = useTrade();
  const feedback = useFeedback();
  const thesisFlag = useThesisFlag();
  const p = loc.pathname || '/';

  // mirror the Dock: step aside while an owned surface (ask / trade / feedback) holds the stage
  if (ask.mode !== 'closed' || trade.open || feedback.open) return null;

  const cell = (test: boolean) => 'tabbar__t' + (test ? ' on' : '');
  return (
    <nav className="tabbar" aria-label="Primary">
      <a className={cell(p === '/')} href="#/"><Icon name="home" size={21} /><span>Home</span></a>
      <a className={cell(MARKETS_RE.test(p))} href="#/screener"><Icon name="chart" size={21} /><span>Markets</span></a>
      <button className="tabbar__ask" onClick={() => openAsk('', 'dock')} aria-label="Ask Hence">
        <span className="tabbar__askmark" dangerouslySetInnerHTML={{ __html: henceMarkSvg(22) }} />
        <span>Ask</span>
      </button>
      <a className={cell(PORT_RE.test(p))} href="#/portfolio">
        <span className="tabbar__ic">
          <Icon name="bookmark" size={21} />
          {thesisFlag ? <i className="tabbar__badge" aria-hidden /> : null}
        </span>
        <span>Portfolio</span>
      </a>
      <button className="tabbar__t" data-cmdk aria-label="Search"><Icon name="search" size={21} /><span>Search</span></button>
    </nav>
  );
}
