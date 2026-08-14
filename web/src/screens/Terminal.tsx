/* The Incognito terminal.
 *
 * The grid, class names and density are Hence's — `.term`, `.term__grid`, `.term__news`,
 * `.term__chart`, `.term__book`, `.term__entry`, `.term__bottom` — because this has to read as
 * the same product in a different mode, not as a different product. The stylesheet is copied
 * from the main app and is ~94% custom-property driven, so it inherits our tokens untouched.
 *
 * `.term--incognito` follows a convention the main app already established: `.term--pred`
 * exists in its markup with no rules attached, and `data-mtab` restyles the whole grid from the
 * root. One modifier on the root retints everything through the cascade.
 *
 * WHAT CHANGED FROM HENCE, and why each one is forced rather than chosen:
 *   news rail  → epoch rail   the unit of time here is the epoch, not the news cycle
 *   order book → sealed book  Avantis is oracle-priced; there is no CLOB to render
 *   trades tape → gone        our flow is private, so there is no public tape of it
 */
import { useEffect, useMemo, useState } from 'react';
import { EpochRail } from '../components/EpochRail';
import { SealedBook } from '../components/SealedBook';
import { Ticket } from '../components/Ticket';
import { simulatedEpoch } from '../lib/epochs';
import '../styles/terminal.css';

const EPOCH_SECONDS = 300;

/** Avantis-listed only. Which assets Avantis actually lists is still unverified — this is a
 *  placeholder universe, and the terminal must never offer a symbol the venue cannot fill. */
const UNIVERSE = ['BTC', 'ETH', 'SOL'];

export function Terminal({
  shieldedAddress,
  onOpenEpochs,
}: {
  shieldedAddress?: string | null;
  onOpenEpochs: () => void;
}) {
  const [sym, setSym] = useState(UNIVERSE[0]);
  const [left, setLeft] = useState(EPOCH_SECONDS - 137);

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => (s <= 1 ? EPOCH_SECONDS : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const last = useMemo(() => simulatedEpoch(), []);
  const sealed = 6;

  return (
    <div className="term term--incognito">
      {/* The favourites bar is where Hence puts its watchlist chips; here it carries the mode
          badge, because this is the one strip visible from every part of the terminal. */}
      <div className="term__fav">
        <span className="inc__badge">
          <Glyph />
          Incognito
        </span>
        {UNIVERSE.map((s) => (
          <button
            key={s}
            className={'inc__sym' + (s === sym ? ' is-on' : '')}
            onClick={() => setSym(s)}
          >
            {s}
          </button>
        ))}
        <button className="inc__epochs" onClick={onOpenEpochs}>
          Epochs →
        </button>
      </div>

      <div className="term__grid">
        <EpochRail secondsLeft={left} sealedCount={sealed} last={last} />

        <div className="term__chart">
          <div className="term__chart-top">
            <span className="term__pair">{sym}</span>
            <span className="term__stats">
              <span className="term__stat">
                <span className="term__stat-k">Venue</span>
                <span className="term__stat-v">Avantis</span>
              </span>
              <span className="term__stat">
                <span className="term__stat-k">Oracle</span>
                <span className="term__stat-v">Pyth</span>
              </span>
            </span>
          </div>
          <div className="term__chart-host inc__chart">
            {/* Chart lands with the Avantis oracle feed. Deliberately empty rather than faked:
                a placeholder candlestick would be the one thing on screen that is not true. */}
            <p>Oracle price chart — next milestone</p>
          </div>
        </div>

        <SealedBook sealedCount={sealed} last={last} />

        <Ticket symbol={sym} shieldedAddress={shieldedAddress} />

        <div className="term__bottom">
          <div className="term__bottom-bar">
            <div className="term__bottom-tabs">
              <button className="is-on">Positions</button>
            </div>
          </div>
          <div className="term__bottom-body">
            <p className="term__empty">
              No incognito positions yet. These live here only — they never appear in the main
              Hence app, because they belong to your shielded address.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Glyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 12.5h17M7 12.5c0-3.6.9-6 5-6s5 2.4 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="15.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
