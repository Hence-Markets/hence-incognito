/* App shell.
 *
 * Two states: the landing disclosure, and the terminal behind it. There is no "incognito
 * toggle" because the whole site IS the mode — the truest reading of the browser metaphor
 * (Chrome opens a separate window rather than flipping a switch), which also hands us session
 * scope for free: close the tab and the mode is over.
 */
import { useEffect, useState } from 'react';
import { Landing } from './screens/Landing';
import { checkAccess } from './lib/access';
import { useAuth } from './lib/useAuth';

type Status = 'anon' | 'checking' | 'denied' | 'ready';

export function App() {
  const hasAuth = !!import.meta.env.VITE_PRIVY_APP_ID;
  const [status, setStatus] = useState<Status>('anon');
  const [entered, setEntered] = useState(false);

  return hasAuth ? (
    <Authed status={status} setStatus={setStatus} entered={entered} setEntered={setEntered} />
  ) : (
    <Landing status="anon" onEnter={() => {}} onSignIn={() => {}} />
  );
}

function Authed({
  status,
  setStatus,
  entered,
  setEntered,
}: {
  status: Status;
  setStatus: (s: Status) => void;
  entered: boolean;
  setEntered: (b: boolean) => void;
}) {
  const { ready, authenticated, address, login, shortAddr } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !address) return setStatus('anon');
    setStatus('checking');
    let live = true;
    // The gate is asked of the server: the browser only ever learns a boolean about its own
    // address, never the cohort. Fails closed on any error.
    checkAccess(address).then((ok) => live && setStatus(ok ? 'ready' : 'denied'));
    return () => {
      live = false;
    };
  }, [ready, authenticated, address, setStatus]);

  if (!entered) {
    return (
      <Landing
        status={status}
        onEnter={() => setEntered(true)}
        onSignIn={login}
        shortAddr={shortAddr}
      />
    );
  }

  return (
    <main className="terminal">
      {/* TODO(step 3): ticket — Avantis assets only, and the executing-address line on review.
          That line is the seatbelt: it confirms the shielding actually engaged. If the shielded
          wallet is unavailable the order MUST fail loudly rather than fall back to the user's
          main wallet — failing open would publish exactly the link this product exists to hide. */}
      <p className="terminal__todo">Terminal — next milestone.</p>
    </main>
  );
}
