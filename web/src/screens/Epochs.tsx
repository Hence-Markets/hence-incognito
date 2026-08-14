/* The epoch visualiser — the demo screen.
 *
 * One job: show the gap between what actually happened and what the world can see. That gap
 * IS the product, and it is invisible on a block explorer, which is exactly why it needs a
 * screen. Nothing in the main Hence app has an equivalent, so unlike the ticket this is new
 * UI by necessity rather than by choice.
 *
 * It renders from lib/epochs.ts, never from a contract call, so pointing it at real on-chain
 * data later is a change of source and nothing else.
 */
import { useState } from 'react';
import {
  type Epoch,
  simulatedEpoch,
  simulatedThinEpoch,
  canPublishAggregate,
  longShare,
  privateShare,
} from '../lib/epochs';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

export function Epochs() {
  const [ep, setEp] = useState<Epoch>(() => simulatedEpoch());
  const thin = ep.orderCount < 5;

  const pctPrivate = privateShare(ep);
  const publishable = canPublishAggregate(ep);

  return (
    <main className="ep">
      <header className="ep__head">
        <div>
          <h1>Epoch 0x{ep.id.toString(16)}</h1>
          <p className="ep__sub">
            {ep.orderCount} orders · {usd(ep.gross)} gross
            {ep.simulated ? <span className="ep__sim">simulated flow</span> : null}
          </p>
        </div>
        <div className="ep__switch">
          <button className={!thin ? 'on' : ''} onClick={() => setEp(simulatedEpoch())}>
            Full book
          </button>
          <button className={thin ? 'on' : ''} onClick={() => setEp(simulatedThinEpoch())}>
            Thin book
          </button>
        </div>
      </header>

      {/* The whole argument in one bar: how much of the book never reached a public venue. */}
      <section className="ep__bar" aria-label="Share of volume that stayed private">
        <div className="ep__barfill" style={{ width: `${pctPrivate}%` }} />
        <div className="ep__barlabel">
          <b>{pctPrivate}%</b> of this book never reached a public venue
        </div>
      </section>

      <section className="ep__cols">
        <div className="ep__col ep__col--real">
          <h2>What actually happened</h2>
          <dl>
            <div><dt>Orders</dt><dd>{ep.orderCount}</dd></div>
            <div><dt>Gross notional</dt><dd>{usd(ep.gross)}</dd></div>
            <div><dt>Longs</dt><dd>{usd(ep.sumLongs)}</dd></div>
            <div><dt>Shorts</dt><dd>{usd(ep.sumShorts)}</dd></div>
            <div className="ep__hero">
              <dt>Crossed internally</dt>
              <dd>{usd(ep.matched * 2)}</dd>
            </div>
          </dl>
          <p className="ep__note">
            Matched against each other at the oracle mark. No position was created on any public
            venue, so there is nothing to find later — this volume is absent, not hidden.
          </p>
        </div>

        <div className="ep__col ep__col--seen">
          <h2>What the world saw</h2>
          <dl>
            <div><dt>Positions</dt><dd>1</dd></div>
            <div><dt>Size</dt><dd>{usd(ep.residual)}</dd></div>
            <div><dt>Direction</dt><dd>{ep.sumLongs >= ep.sumShorts ? 'long' : 'short'}</dd></div>
            <div><dt>Attributable to</dt><dd className="ep__none">nobody</dd></div>
            <div className="ep__hero">
              <dt>Traders identified</dt>
              <dd>0 of {ep.orderCount}</dd>
            </div>
          </dl>
          <p className="ep__note">
            The residual goes to Avantis from a shared address. It is public and permanent — and
            it cannot be decomposed back into the orders that produced it.
          </p>
        </div>
      </section>

      {/* The honesty rule, enforced in the UI exactly as the contract enforces it on-chain.
          Showing sentiment here that revealAggregate() would have refused would be a screen
          telling a story the chain rejects. */}
      <section className={'ep__book' + (publishable ? '' : ' ep__book--withheld')}>
        {publishable ? (
          <>
            <b>{longShare(ep)}% of the book is long</b>
            <span>Published from the epoch total. Every individual order stays sealed.</span>
          </>
        ) : (
          <>
            <b>Book sentiment withheld</b>
            <span>
              Only {ep.orderCount} orders. A total over a book this small can be solved back into
              its parts, so the contract refuses to publish it — and so does this screen.
            </span>
          </>
        )}
      </section>
    </main>
  );
}
