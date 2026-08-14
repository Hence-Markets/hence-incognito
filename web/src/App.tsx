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
import { Terminal } from './screens/Terminal';
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

  if (devNoGate()) return <Surface shieldedAddress={null} />;

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

  // TODO(next): the SHIELDED address. Until the keeper mints one, the ticket refuses to place
  // rather than falling back to the user's main wallet — which is the correct behaviour
  // permanently, not a stub. Falling open would publish exactly the link this exists to hide.
  return <Surface shieldedAddress={null} />;
}


/* Terminal is the working surface; the epoch visualiser is one click away rather than the
   landing spot — it explains what happened, which only matters once you have traded. */
function Surface({ shieldedAddress }: { shieldedAddress?: string | null }) {
  const [view, setView] = useState<'terminal' | 'epochs'>('terminal');
  return view === 'terminal' ? (
    <Terminal shieldedAddress={shieldedAddress} onOpenEpochs={() => setView('epochs')} />
  ) : (
    <Epochs onBack={() => setView('terminal')} />
  );
}
