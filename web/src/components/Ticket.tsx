/* The order ticket.
 *
 * Markup and classes are Hence's — `.term__entry`, `.term__ls`, `.term__field`, `.term__submit`,
 * `.term__cfm` — so order entry has the same shape, density and muscle memory as the main app.
 * Only the submission path differs: encrypt, then submit from the shielded address.
 *
 * The review step is not a formality. It carries the executing-address line, which is the one
 * element that confirms the shielding actually engaged. Everything else here is convenience;
 * that line is the seatbelt.
 */
import { useState } from 'react';
import { type Side, placeShieldedOrder, shieldedReady } from '../lib/order';

const CHIPS = [25, 100, 500, 1000];

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

export function Ticket({
  symbol,
  shieldedAddress,
}: {
  symbol: string;
  shieldedAddress?: string | null;
}) {
  const [side, setSide] = useState<Side>('long');
  const [amt, setAmt] = useState('');
  const [lev, setLev] = useState(1);
  const [review, setReview] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const size = Number(amt) || 0;
  const gate = shieldedReady(shieldedAddress);

  const submit = async () => {
    setErr(null);
    setPlacing(true);
    // No shielded client yet — the shielded wallet lands with the keeper work. Until then this
    // refuses rather than falling back, which is the correct behaviour permanently, not a stub.
    const res = await placeShieldedOrder({ symbol, side, size, leverage: lev }, null);
    setPlacing(false);
    if (!res.ok) {
      setErr(res.reason);
      return;
    }
    setReview(false);
    setAmt('');
  };

  return (
    <div className="term__entry">
      <div className="term__entry-body">
        <div className="term__ls">
          <button
            className={'term__ls-btn term__ls-long' + (side === 'long' ? ' is-on' : '')}
            onClick={() => setSide('long')}
          >
            Long
          </button>
          <button
            className={'term__ls-btn term__ls-short' + (side === 'short' ? ' is-on' : '')}
            onClick={() => setSide('short')}
          >
            Short
          </button>
        </div>

        <div className="term__entry-scroll">
          <label className="term__field">
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amt}
              onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))}
              aria-label="Order size in USD"
            />
            <span className="term__field-unit">USD</span>
          </label>

          <div className="term__pcts">
            {CHIPS.map((c) => (
              <button key={c} onClick={() => setAmt(String(c))}>
                ${c}
              </button>
            ))}
          </div>

          <div className="term__levrow">
            <span className="term__lev-m">Leverage</span>
            <div className="term__pcts">
              {[1, 2, 5].map((l) => (
                <button
                  key={l}
                  className={lev === l ? 'is-on' : ''}
                  onClick={() => setLev(l)}
                  // Phase 2 crosses at 1x with a bounded payoff; leverage on a crossed leg is
                  // Phase 3 and needs a real liquidation engine. Offered but flagged below.
                >
                  {l}x
                </button>
              ))}
            </div>
          </div>

          {lev > 1 ? (
            <p className="term__status term__status--dim">
              Above 1x cannot cross — it routes to Avantis and becomes public.
            </p>
          ) : null}

          <div className="term__pta">
            <div className="term__pta-row">
              <span>Routes via</span>
              <span>Avantis · Base</span>
            </div>
            <div className="term__pta-row">
              <span>Executing as</span>
              <span>{shieldedAddress ? `${short(shieldedAddress)} · shielded` : 'no shielded address'}</span>
            </div>
          </div>

          {!gate.ready ? (
            <p className="term__status term__status--bad">{gate.reason}</p>
          ) : null}
          {err ? <p className="term__status term__status--bad">{err}</p> : null}
        </div>

        <button
          className={'term__submit term__submit--' + side}
          disabled={!size || placing}
          onClick={() => setReview(true)}
        >
          {placing ? 'Placing…' : `${side === 'long' ? 'Long' : 'Short'} ${symbol}`}
        </button>
      </div>

      {review ? (
        <div className="term__cfm" onClick={() => setReview(false)}>
          <div className="term__cfm-card" onClick={(e) => e.stopPropagation()}>
            <div className="term__cfm-h">
              <span className={'term__cfm-side term__cfm-side--' + side}>{side}</span>
              <b>{symbol}</b>
              <button className="term__cfm-x" onClick={() => setReview(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="term__cfm-rows">
              <div><span>Size</span><span>${size.toLocaleString()}</span></div>
              <div><span>Leverage</span><span>{lev}x</span></div>
              <div><span>Venue</span><span>Avantis · Base</span></div>
            </div>

            {/* THE SEATBELT. Never remove, never soften, never let it render a main wallet.
                If this says anything other than a shielded address, the order must not go. */}
            <div className="cfm-exec">
              <span>Executing as</span>
              <b>{short(shieldedAddress)}</b>
              <em>shielded</em>
            </div>
            <p className="term__cfm-fine">Your main wallet does not appear in this transaction.</p>

            <div className="term__cfm-actions">
              <button className="term__cfm-cancel" onClick={() => setReview(false)}>
                Cancel
              </button>
              <button
                className={'term__cfm-go term__cfm-go--' + side}
                disabled={!gate.ready || placing}
                onClick={submit}
              >
                {placing ? 'Placing…' : gate.ready ? 'Confirm' : 'Unavailable'}
              </button>
            </div>

            {err ? <p className="term__status term__status--bad">{err}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
