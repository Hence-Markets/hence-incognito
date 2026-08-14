/* App shell.
 *
 * Two states: the landing disclosure, and the terminal behind it. There is no "incognito
 * toggle" because the whole site IS the mode — the truest reading of the browser metaphor
 * (Chrome opens a separate window rather than flipping a switch), which also hands us session
 * scope for free: close the tab and the mode is over.
 */
import { useEffect, useState } from 'react';
import { Landing } from './screens/Landing';
import { Epochs } from './screens/Epochs';
import { checkAccess } from './lib/access';
import { useAuth } from './lib/useAuth';

type Status = 'anon' | 'checking' | 'denied' | 'ready';

/* Dev-only gate bypass, mirroring the main app's `hence.devNoGate` so the convention is one
   thing across both codebases. sessionStorage (not local) so it dies with the tab, and behind
   import.meta.env.DEV so it is COMPILED OUT of production — a gate you can turn off from the
   console is not a gate. */
const devNoGate = () => {
  try {
    return import.meta.env.DEV && sessionStorage.getItem('hence.devNoGate') === '1';
  } catch {
    return false;
  }
};

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

  if (devNoGate()) return <Epochs />;

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

  // TODO(next): the ticket, ported from Hence's TradeTicket rather than invented — Incognito
  // has to read as the same product in a different mode. Its review step carries the
  // executing-address line, which is the seatbelt: it confirms the shielding actually engaged.
  // If the shielded wallet is unavailable the order MUST fail loudly rather than fall back to
  // the main wallet — failing open would publish exactly the link this product exists to hide.
  return <Epochs />;
}
