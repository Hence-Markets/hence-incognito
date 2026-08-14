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
  /** orders sealed in the open epoch */
  sealed?: number;
  /** seconds until the epoch closes and netting runs */
  secondsLeft?: number;
  /** share of the LAST epoch that crossed internally, 0–1 */
  lastCrossed?: number | null;
};

const mmss = (s: number) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function SealedBook({ sym, resizer, sealed = 0, secondsLeft = 0, lastCrossed = null }: Props) {
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
              <div className="sealed__count">
                <b>{sealed}</b>
                <span>sealed this epoch</span>
              </div>

              {sealed === 0 ? (
                <div className="term__book-empty">No orders sealed yet this epoch</div>
              ) : (
                <ul className="sealed__rows" aria-label={`${sealed} sealed orders`}>
                  {Array.from({ length: Math.min(sealed, 12) }).map((_, i) => (
                    <li key={i}>
                      <span className="sealed__ix">{String(i + 1).padStart(2, '0')}</span>
                      {/* A bar where a size would be. The widths are DECORATIVE and encode
                          nothing — deriving them from real sizes would leak the very thing
                          the encryption protects. */}
                      <span className="sealed__bar" style={{ width: `${34 + ((i * 23) % 52)}%` }} />
                      <span className="sealed__redact">•••••</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="sealed__note">
                Sizes and owners stay encrypted until the epoch closes. This is not a price
                ladder — {sym} is oracle-priced on Avantis, so there is no book to read.
              </p>
            </div>
          </>
        ) : (
          <div className="term__book-body sealed">
            <div className="sealed__count">
              <b>{mmss(secondsLeft)}</b>
              <span>until netting</span>
            </div>
            <div className="sealed__stat"><span>Orders sealed</span><b>{sealed}</b></div>
            <div className="sealed__stat">
              <span>Last epoch crossed</span>
              <b className="is-hidden">{lastCrossed == null ? '—' : `${Math.round(lastCrossed * 100)}%`}</b>
            </div>
            <p className="sealed__note">
              At close, orders are matched against each other on ciphertext. Whatever matches
              never reaches a public venue; only the remainder is sent to Avantis.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
