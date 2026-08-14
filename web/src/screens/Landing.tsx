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
  onSignIn,
  status,
  shortAddr,
}: {
  onEnter: () => void;
  onSignIn: () => void;
  status: 'anon' | 'checking' | 'denied' | 'ready';
  shortAddr?: string;
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

      {/* THE DEMO NOTICE, above the button rather than in the footer.
          It is the single most important sentence on this page and the one a person is most
          likely to skip, so it sits where the eye already is: directly over the thing they are
          about to press. Testnet, hackathon, no warranty, no real money. */}
      <div className="landing__demo">
        <p className="landing__demo-lead">
          This is a demo on the <b>Base Sepolia</b> testnet, built for the <b>Inco hackathon</b>.
        </p>
        <p>
          Nothing here is real money. Orders are encrypted trade <em>intents</em> on a test
          network — no funds are held, transferred or invested, no position is opened at any
          venue, and nothing can be withdrawn or redeemed. Testnet ETH has no value.
        </p>
        <p>
          Provided as-is, with no warranty and no liability, by people who will change it
          without notice. It is unaudited prototype software and may lose orders, mis-net a
          book, or stop working entirely. Nothing here is financial advice or an offer to
          trade. Do not send real assets to any address shown in this app.
        </p>
        <p>
          Privacy has limits, and they are stated plainly above: sides, markets and addresses
          are public on chain, and matched volume is hidden from a venue — not from Inco's
          operators, and not from anyone analysing the chain.
        </p>
      </div>

      {/* One button, two jobs — sign in, then enter. Never show "Enter incognito" to someone
          who is not signed in: the promise only holds once we know which address is shielded. */}
      <button
        className="landing__cta"
        onClick={status === 'anon' ? onSignIn : onEnter}
        disabled={status === 'checking' || status === 'denied'}
      >
        {label}
      </button>

      {shortAddr && status !== 'anon' ? (
        <p className="landing__who">Signed in as {shortAddr}</p>
      ) : null}

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
