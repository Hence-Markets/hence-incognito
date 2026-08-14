/* The book panel — and the best visual argument in the product.
 *
 * Avantis is vault-backed and oracle-priced: there is NO central limit order book to render.
 * And our own flow is encrypted until an epoch closes. So where the Hence terminal shows bids
 * and asks, there is deliberately nothing to see.
 *
 * That emptiness is the feature, not a gap to fill with a placeholder. It occupies the exact
 * slot a trader's eye goes to for "who else is in this market", and answers: nobody can tell.
 */
import type { Epoch } from '../lib/epochs';

export function SealedBook({ sealedCount, last }: { sealedCount: number; last: Epoch }) {
  return (
    <div className="term__book">
      <div className="term__book-head">
        <span>Sealed book</span>
        <span className="term__book-u">this epoch</span>
      </div>

      <div className="term__book-body sealed">
        <div className="sealed__count">
          <b>{sealedCount}</b>
          <span>orders sealed</span>
        </div>

        {/* One row per order, sizes redacted. Showing the COUNT is safe — order count is public
            on-chain anyway — while sizes and owners are exactly what stays encrypted. */}
        <ul className="sealed__rows" aria-label="Sealed orders">
          {Array.from({ length: Math.min(sealedCount, 9) }).map((_, i) => (
            <li key={i}>
              <span className="sealed__bar" style={{ width: `${38 + ((i * 17) % 46)}%` }} />
              <span className="sealed__redact">•••••</span>
            </li>
          ))}
        </ul>

        <p className="sealed__note">
          Sizes and owners stay encrypted until the epoch closes. Nothing here is a price level —
          Avantis is oracle-priced, so there is no book to read.
        </p>
      </div>

      <div className="term__book-spread sealed__last">
        <span>Last epoch</span>
        <b>{Math.round((last.matched * 2 / Math.max(1, last.gross)) * 100)}% crossed</b>
      </div>
    </div>
  );
}
