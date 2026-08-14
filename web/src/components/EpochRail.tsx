/* The left rail. Hence shows a news feed here; the unit of time in Incognito is the EPOCH, so
   this shows where we are in one — how long until orders are netted, and what the last one did.
   Same `.term__news` chrome so the grid reads identically. */
import type { Epoch } from '../lib/epochs';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

export function EpochRail({
  secondsLeft,
  sealedCount,
  last,
}: {
  secondsLeft: number;
  sealedCount: number;
  last: Epoch;
}) {
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="term__news">
      <div className="term__news-h">
        <span className="term__dot" />
        <span className="term__news-h-l">Epoch open</span>
      </div>

      <div className="term__news-full erail">
        <div className="erail__clock">
          <b>{mm}:{ss}</b>
          <span>until orders are netted</span>
        </div>

        <div className="erail__stat">
          <span>Sealed now</span>
          <b>{sealedCount}</b>
        </div>

        <div className="erail__div" />

        <div className="erail__h">Last epoch</div>
        <div className="erail__stat"><span>Orders</span><b>{last.orderCount}</b></div>
        <div className="erail__stat"><span>Crossed</span><b className="is-hidden">{usd(last.matched * 2)}</b></div>
        <div className="erail__stat"><span>Sent to venue</span><b className="is-public">{usd(last.residual)}</b></div>

        <p className="erail__note">
          Orders are matched against each other first. Whatever matches never reaches a public
          venue.
        </p>
      </div>
    </div>
  );
}
