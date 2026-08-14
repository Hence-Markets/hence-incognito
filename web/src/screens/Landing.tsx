/* The landing screen — and the honest disclosure.

   In the in-app design this was a dismissible modal. Standalone it becomes the landing page,
   which is better placement: people read a landing page and dismiss a modal. It is also the
   compliance surface doing the most work, so it is a build requirement, not decoration.

   Everything it claims comes from lib/disclosure.ts, and that file is PHASE-AWARE — the
   columns describe whichever phase is actually running. In Phase 2 they stop being
   hidden/public and become "if your order matches" / "if it does not", because that is the
   real mechanic and a trader cannot control which side they land on. */
import { DISCLOSURE, PHASE } from '../lib/disclosure';
import { Glyph } from '../components/Glyph';

export function Landing({
  onEnter,
  status,
}: {
  onEnter: () => void;
  status: 'anon' | 'checking' | 'denied' | 'ready';
}) {
  const d = DISCLOSURE;
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
        <p className="landing__sub">{d.tagline}</p>
      </header>

      {/* Two columns, equal weight. Making the weaker column quieter than the stronger one
          would be the exact dishonesty this screen exists to prevent — and in Phase 2 the
          right-hand column is not a caveat, it is half of what actually happens. */}
      <section className="disclose" aria-label="What Incognito does and does not hide">
        <div className="disclose__col">
          <h2 className="disclose__h disclose__h--hidden">{d.left.heading}</h2>
          <ul>
            {d.left.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="disclose__col">
          <h2 className="disclose__h disclose__h--public">{d.right.heading}</h2>
          <ul>
            {d.right.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className="landing__limits">{d.limits}</p>

      <button className="landing__cta" onClick={onEnter} disabled={status !== 'ready'}>
        {label}
      </button>

      {status === 'denied' ? (
        <p className="landing__denied">
          This prototype is limited to the team while it is being tested.
        </p>
      ) : null}

      <footer className="landing__foot">
        {d.footer}{' '}
        <a href="https://github.com/Hence-Markets/hence-incognito" target="_blank" rel="noreferrer">
          How it works
        </a>
        {PHASE === 1 ? <span className="landing__phase"> · shielded execution</span> : null}
      </footer>
    </main>
  );
}
