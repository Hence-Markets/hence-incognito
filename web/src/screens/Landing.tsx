/* The landing screen — and the honest disclosure.

   In the in-app design this was a dismissible modal. Standalone it becomes the landing page,
   which is better placement: people read a landing page and dismiss a modal. It is also the
   compliance surface that does the most work, so it is a build requirement, not decoration.

   Everything it claims comes from lib/disclosure.ts. If a claim is not in that file it does
   not get made here — that is what stops the landing screen, the ticket and the T&C drifting
   apart as the product changes. */
import { NOW_HIDDEN, STILL_PUBLIC, LIMITS } from '../lib/disclosure';
import { Glyph } from '../components/Glyph';

export function Landing({
  onEnter,
  status,
}: {
  onEnter: () => void;
  status: 'anon' | 'checking' | 'denied' | 'ready';
}) {
  const label =
    status === 'checking' ? 'Checking…'
    : status === 'denied' ? 'Not on the list'
    : status === 'ready' ? 'Enter incognito'
    : 'Sign in to continue';

  return (
    <main className="landing">
      <header className="landing__head">
        <Glyph size={40} />
        <h1>Hence Incognito</h1>
        <p className="landing__sub">
          Trade on Avantis without your name attached.
        </p>
      </header>

      {/* The two columns are the product's honesty, expressed as layout. Chrome does the
          same thing on its own incognito page, and people already trust the shape.
          NOTE: the right column SHRINKS in Phase 2 — crossed volume stops being public at
          all — so this grid must absorb rows leaving without a redesign. */}
      <section className="disclose" aria-label="What Incognito hides and what it does not">
        <div className="disclose__col">
          <h2 className="disclose__h disclose__h--hidden">Now hidden</h2>
          <ul>
            {NOW_HIDDEN.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="disclose__col">
          <h2 className="disclose__h disclose__h--public">Still public</h2>
          <ul>
            {STILL_PUBLIC.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className="landing__limits">{LIMITS}</p>

      <button className="landing__cta" onClick={onEnter} disabled={status !== 'ready'}>
        {label}
      </button>

      {status === 'denied' ? (
        <p className="landing__denied">
          This prototype is limited to the team while it is being tested.
        </p>
      ) : null}

      <footer className="landing__foot">
        Your trade is public. You are not.{' '}
        <a href="https://github.com/Hence-Markets/hence-incognito" target="_blank" rel="noreferrer">
          How it works
        </a>
      </footer>
    </main>
  );
}
