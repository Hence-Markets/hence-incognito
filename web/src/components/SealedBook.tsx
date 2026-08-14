/* The sealed book — what stands where an order book would.
 *
 * Two independent reasons there is no book here, and both are worth saying out loud because a
 * trader's eye goes to this panel first:
 *
 *   1. Avantis is VAULT-BACKED and ORACLE-PRICED. There is no central limit order book to
 *      render. Any bids and asks drawn here would be invented.
 *   2. Even if there were one, our own flow is encrypted until the epoch closes — so the
 *      orders that matter to you are precisely the ones nobody can see.
 *
 * So the emptiness is the product, not a gap awaiting a feature. This panel occupies the exact
 * slot where a trader asks "who else is in this market?" and answers: nobody can tell, and
 * that is the point. It shows the COUNT (which is public on-chain anyway) with sizes and owners
 * redacted, which is the honest shape of what Inco actually protects.
 *
 * Keeps the real panel's shell — `.term__book`, the collapse rail, the tab strip — so the grid
 * geometry and the collapse behaviour are unchanged from Hence.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/* Collapse behaviour is copied from OrderBook rather than approximated: same localStorage key,
   same --c-book width var, same rail width. The panel it replaces must feel identical to drag
   and collapse, or the swap announces itself for no reason. */
const BOOK_RAIL = 34;

type Props = {
  sym: string;
  resizer?: React.ReactNode;
  /** orders sealed in the open epoch IN THIS MARKET — what can actually cross with yours */
  sealed?: number;
  /** orders sealed across every market this epoch — the anonymity set */
  sealedAll?: number;
  /** the open epoch id, when known */
  epochId?: number | null;
  /** has the keeper netted the previous epoch's book for this market? */
  prevNetted?: boolean;
  /** how many orders the previous epoch held here — 0 means there was never a book */
  prevCount?: number;
  /** which epoch the crossed figure describes */
  crossedEpoch?: number | null;
  /** row indices in this epoch's book belonging to the viewer's shielded address */
  mine?: number[];
  /** seconds until the epoch closes and netting runs */
  secondsLeft?: number;
  /** share of the LAST epoch that crossed internally, 0–1 */
  lastCrossed?: number | null;
  /** false while the countdown is a local clock rather than contract state */
  live?: boolean;
};

const mmss = (s: number) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/* An epoch only ROLLS when someone submits an order — `_rollEpochIfDue()` lives inside
   submitOrder, so with no flow the open epoch sits past its close time indefinitely. That is
   fine on-chain (an empty epoch has nothing to net) but "00:00 until netting" counting down to
   nothing reads as a broken clock. Say what is actually true instead. */
const clockLabel = (secondsLeft: number, live: boolean, sealed: number, netted: boolean) => {
  if (!live) return { big: mmss(secondsLeft), sub: 'until netting' };
  if (secondsLeft > 0) return { big: mmss(secondsLeft), sub: 'until netting' };
  // A netted book is finished, not waiting. Saying "awaiting netting" over one the keeper has
  // already settled invents a backlog and makes a working system look stuck.
  if (netted) return { big: 'netted', sub: 'matched on ciphertext' };
  return sealed > 0
    ? { big: 'closed', sub: 'awaiting netting' }
    : { big: 'open', sub: 'starts on the first order' };
};

export function SealedBook({
  sym, resizer, sealed = 0, sealedAll = 0, secondsLeft = 0,
  lastCrossed = null, live = false, epochId = null, prevNetted = false, prevCount = 0,
  crossedEpoch = null, mine = [],
}: Props) {
  const [tab, setTab] = useState<'sealed' | 'epochs'>('sealed');
  const asideRef = useRef<HTMLElement>(null);
  const prevW = useRef<string>('');
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('hence.term.bookCollapsed') === '1'; } catch { return false; }
  });
  const applyVar = (c: boolean) => {
    const term = asideRef.current?.closest('.term') as HTMLElement | null;
    if (!term) return;
    if (c) {
      const cur = (term.style.getPropertyValue('--c-book') || '').trim();
      if (cur && cur !== BOOK_RAIL + 'px') prevW.current = cur;
      term.style.setProperty('--c-book', BOOK_RAIL + 'px');
    } else if (prevW.current) {
      term.style.setProperty('--c-book', prevW.current);
    } else {
      term.style.removeProperty('--c-book');
    }
  };
  useEffect(() => {
    if (!collapsed) return;
    const t = window.setTimeout(() => applyVar(true), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    applyVar(next);
    try { localStorage.setItem('hence.term.bookCollapsed', next ? '1' : ''); } catch { /* storage off */ }
  };

  return (
    <aside ref={asideRef} className={'term__book' + (collapsed ? ' is-collapsed' : '')}>
      {!collapsed && resizer}
      <button className="term__book-railbtn" onClick={toggleCollapsed} title="Expand sealed book">
        <Icon name="back" size={13} />
        <span className="term__book-rail-l">Sealed Book</span>
      </button>

      <div className="term__book-full">
        <div className="term__book-tabs">
          <button className={tab === 'sealed' ? 'on' : ''} onClick={() => setTab('sealed')}>Sealed</button>
          <button className={tab === 'epochs' ? 'on' : ''} onClick={() => setTab('epochs')}>Epoch</button>
          <button className="term__book-cfg" title="Collapse" onClick={toggleCollapsed}>
            <Icon name="chevR" size={13} />
          </button>
        </div>

        {tab === 'sealed' ? (
          <>
            <div className="term__book-head"><span>Order</span><span>Size</span><span>Trader</span></div>
            <div className="term__book-body sealed">
              {/* "2 sealed" says nothing about whether YOU are one of them, which is the first
                  thing a trader wants to know after pressing the button. */}
              <div className="sealed__count">
                <b>{sealed}</b>
                <span>sealed this epoch{mine.length ? <> · <em className="sealed__mine-n">{mine.length} yours</em></> : ''}</span>
              </div>

              {sealed === 0 ? (
                <div className="term__book-empty">No orders sealed yet this epoch</div>
              ) : (
                <ul className="sealed__rows" aria-label={`${sealed} sealed orders`}>
                  {Array.from({ length: Math.min(sealed, 12) }).map((_, i) => (
                    <li key={i} className={mine.includes(i) ? 'is-mine' : undefined}>
                      <span className="sealed__ix">{String(i + 1).padStart(2, '0')}</span>
                      {/* A bar where a size would be. The widths are DECORATIVE and encode
                          nothing — deriving them from real sizes would leak the very thing
                          the encryption protects. */}
                      <span className="sealed__bar" style={{ width: `${34 + ((i * 23) % 52)}%` }} />
                      <span className="sealed__redact">•••••</span>
                      {/* Only the viewer sees this — it is derived from their own address in
                          the logs, which is public anyway. It reveals nothing to anyone else. */}
                      {mine.includes(i) && <span className="sealed__mine">yours</span>}
                    </li>
                  ))}
                </ul>
              )}

              {/* Netting is per market, so the count that matters is THIS market's. The
                  epoch-wide figure is still worth showing — it is the size of the crowd the
                  shielded address blends into, which is a different property from crossing. */}
              {sealedAll > sealed && (
                <div className="sealed__stat sealed__stat--all">
                  <span>Across all markets</span><b>{sealedAll}</b>
                </div>
              )}

              <p className="sealed__note">
                Sizes and owners stay encrypted until the epoch closes. This is not a price
                ladder — {sym} is oracle-priced on Avantis, so there is no book to read.
              </p>
            </div>
          </>
        ) : (
          <div className="term__book-body sealed">
            {(() => {
              const c = clockLabel(secondsLeft, live, sealed, prevNetted && prevCount > 0);
              return (
                <div className="sealed__count">
                  <b>{c.big}</b>
                  <span>{c.sub}</span>
                </div>
              );
            })()}
            <div className="sealed__stat"><span>Sealed in {sym}</span><b>{sealed}</b></div>
            <div className="sealed__stat"><span>Across all markets</span><b>{sealedAll}</b></div>
            {/* Whether these numbers came from the chain or a local clock. Surfaced rather
                than hidden: a demo indistinguishable from the real thing is the one outcome
                this product cannot afford. */}
            <div className="sealed__stat">
              <span>Source</span>
              <b className={live ? 'is-hidden' : ''}>{live ? 'on-chain' : 'local clock'}</b>
            </div>
            {/* The outcome, in the two words that matter. CROSSED is the product: volume that
                never touched a public venue. UNFILLED is what is left when nobody took the
                other side — ordinary crossing-network behaviour, not a failure, and not a
                refund either: nothing was escrowed, so nothing comes back.

                Both stay "—" until the keeper publishes the attested decrypt. Filling them in
                from a guess would make this panel indistinguishable from a mock, which is the
                one thing it must never be. */}
            <div className="sealed__stat">
              <span>Crossed internally{crossedEpoch != null ? ` · #${crossedEpoch}` : ''}</span>
              <b className="is-hidden">{lastCrossed == null ? '—' : `${Math.round(lastCrossed * 100)}%`}</b>
            </div>
            <div className="sealed__stat">
              <span>Unfilled</span>
              <b>{lastCrossed == null ? '—' : `${Math.round((1 - lastCrossed) * 100)}%`}</b>
            </div>
            {/* "awaiting keeper" over an epoch that never held an order in this market is a
                false alarm — there is nothing there to net. An empty book says so. */}
            <div className="sealed__stat">
              <span>Book status</span>
              <b>{!live ? '—' : prevCount === 0 ? 'no book' : prevNetted ? 'netted' : 'awaiting keeper'}</b>
            </div>
            <p className="sealed__note">
              At close, orders are matched against each other on ciphertext. Whatever crosses
              never reaches a public venue. Whatever finds no counterparty goes unfilled, unless
              you chose to route it out to Avantis.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
