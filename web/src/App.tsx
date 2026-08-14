/* App shell.
 *
 * Two states only for now: the landing disclosure, and the terminal behind it. There is no
 * "incognito toggle" because the whole site IS the mode — which is the truest reading of the
 * browser metaphor (Chrome opens a separate window rather than flipping a switch) and hands us
 * session scope for free: close the tab and the mode is over.
 */
import { useEffect, useState } from 'react';
import { Landing } from './screens/Landing';
import { checkAccess } from './lib/access';

type Status = 'anon' | 'checking' | 'denied' | 'ready';

export function App() {
  const [status, setStatus] = useState<Status>('anon');
  const [entered, setEntered] = useState(false);

  // TODO(M0): replace with the Privy address. Same app ID as the main Hence app — that is
  // what makes this the same user. incognito.hence.markets must be in Privy's allowed
  // origins or login fails outright.
  const address: string | null = null;

  useEffect(() => {
    if (!address) return setStatus('anon');
    setStatus('checking');
    let live = true;
    checkAccess(address).then((ok) => live && setStatus(ok ? 'ready' : 'denied'));
    return () => {
      live = false;
    };
  }, [address]);

  if (!entered) return <Landing status={status} onEnter={() => setEntered(true)} />;

  return (
    <main className="terminal">
      {/* TODO(M0): ticket — Avantis assets only, and the executing-address line on review.
          That line is the seatbelt: it is what confirms the shielding actually engaged.
          If the shielded wallet is unavailable the order MUST fail loudly rather than fall
          back to the user's main wallet — failing open would publish exactly the link this
          product exists to hide. */}
      <p className="terminal__todo">Terminal — next milestone.</p>
    </main>
  );
}
