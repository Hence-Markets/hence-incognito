/* Boot — Hence's, with the Incognito layer in front of it.
 *
 * This app is a FORK of the Hence web app, not a lookalike. The terminal, the news feed, the
 * chart, the order book, the account card and every other screen are the real components, so
 * "Hence in incognito mode" is literally true rather than an aspiration. Rebuilding that from
 * scratch was the wrong instinct and produced a hollow shell; this replaces it.
 *
 * Three things are layered on top, and nothing else is altered:
 *   1. the Incognito landing + team gate, in front of the app
 *   2. data-incognito on <html>, which carries the tint to every surface INCLUDING the modals
 *      and dock chrome that render outside the .term subtree
 *   3. the order path, swapped from Hyperliquid to encrypt → submit (see lib/order.ts)
 */
import './lib/node-shims';   // MUST be first — the Inco SDK expects Node globals
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './providers/AuthProvider';
import * as market from './lib/market.js';
import { initAssetIcons } from './lib/asset-icon.js';
import { Landing } from './screens/Landing';
import { checkAccess } from './lib/access';
import { loadAvantisUniverse } from './lib/avantisUniverse';
import { useAuth } from './hooks/useAuth';
import './styles/app.css';
import './styles/loading.css';
import './styles/mobile.css';
import './styles/accounts.css';
import './styles/incognito.css';   // the tint + the panels that differ. Loaded LAST so it wins.

(window as any).henceMarket = market;
const timeout = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = createRoot(document.getElementById('root')!);

// The tint rides on <html> rather than on .term, because Hence renders seven order/confirm
// modals plus the dock and wallet chrome OUTSIDE the terminal subtree — a class on .term would
// leave all of them untinted and the mode would look half-applied.
document.documentElement.setAttribute('data-incognito', '1');

initAssetIcons();

/** Dev-only gate bypass, mirroring the main app's own convention. Compiled out of production. */
const devNoGate = () => {
  try {
    return import.meta.env.DEV && sessionStorage.getItem('hence.devNoGate') === '1';
  } catch {
    return false;
  }
};

function Gate() {
  const { ready, authenticated, address, login } = useAuth() as any;
  const [status, setStatus] = useState<'anon' | 'checking' | 'denied' | 'ready'>('anon');
  const [entered, setEntered] = useState(devNoGate());

  // Ask the server whether THIS address is in the cohort. The browser never receives the list.
  if (ready && authenticated && address && status === 'anon') {
    setStatus('checking');
    checkAccess(address).then((ok) => setStatus(ok ? 'ready' : 'denied'));
  }

  if (entered) return <App />;

  return (
    <Landing
      status={status}
      onEnter={() => setEntered(true)}
      onSignIn={login}
      shortAddr={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : undefined}
    />
  );
}

(async () => {
  // Render on the RACE so a slow venue never holds the first paint...
  await Promise.race([market.init(), timeout(3500)]);
  // ...but ingest Avantis off init()'s REAL completion. Chaining off the race was wrong and
  // silently so: when init overran 3.5s the universe was still empty, Avantis' 97 rows went
  // in, and init then hit its own `universe = []` reset and wiped every one of them. The log
  // said "97 added" while the terminal showed none. init() is idempotent, so calling it again
  // just returns the in-flight promise.
  market.init().then(() => loadAvantisUniverse()).catch(() => loadAvantisUniverse());
  root.render(
    <AuthProvider>
      <Gate />
    </AuthProvider>,
  );
  requestAnimationFrame(() => document.getElementById('boot-splash')?.remove());
})();
