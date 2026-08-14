/* design-sync preview provider — wraps every preview card with the contexts the
   components read (Privy auth + a memory router), plus the app's dark ground.
   (generated for the sync; unused by the app itself — the app has AuthProvider). */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';

const PRIVY_APP_ID = 'cmp3r31c2011u0cl1uyrm2nvu';   // public client-side app id (same fallback as AuthProvider)

export function DsProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={{ loginMethods: ['email'], appearance: { theme: 'dark' } }}>
      <MemoryRouter>
        <div style={{ background: 'var(--bg, #0a0a0b)', color: 'var(--text, #ececef)', padding: 18, minHeight: '100%', fontFamily: 'var(--font, Inter, sans-serif)' }}>
          {children}
        </div>
      </MemoryRouter>
    </PrivyProvider>
  );
}
