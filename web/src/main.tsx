import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { App } from './App';
import './styles.css';

/* Same Privy app as app.hence.markets — that is what makes this the same user and the same
   embedded wallet. The ID is public by design (it ships in every client bundle), but it is
   read from env rather than inlined so this repo does not carry it.
   `incognito.hence.markets` must be added to Privy's allowed origins or login fails. */
const APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {APP_ID ? (
      <PrivyProvider
        appId={APP_ID}
        config={{
          // 'wallet' leads deliberately. The access cohort is a list of REAL wallet addresses,
          // so an email-only login would mint a fresh embedded wallet whose address is not on
          // that list — the gate would then deny everyone, including the team.
          loginMethods: ['wallet', 'email'],
          appearance: {
            theme: 'dark',
            /* 'detected_ethereum_wallets' FIRST, and it is load-bearing rather than tidy:
               Rabby is an EIP-6963 injected extension with no pinnable entry of its own
               ('rabby_wallet' exists but is marked deprecated / no longer supported), so this
               is what surfaces it — along with any other extension a trader already runs.

               It also repairs an own goal. Privy's default list is
               ['detected_wallets','metamask','coinbase_wallet','rainbow','wallet_connect'],
               and specifying walletList REPLACES that default outright — the previous curated
               list silently dropped both detected wallets and WalletConnect, which made Rabby
               impossible to connect at all. */
            walletList: [
              'detected_ethereum_wallets',
              'metamask',
              'rainbow',
              'coinbase_wallet',
              'zerion',
              'okx_wallet',
              'wallet_connect',
            ],
          },
          // Still created for email users — and it is also what a shielded address will be
          // built on, which is why the embedded wallet is never the identity address below.
          embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        }}
      >
        <App />
      </PrivyProvider>
    ) : (
      // No app ID = no auth. Render the landing anyway so the disclosure is still reviewable,
      // but the CTA stays disabled — it must never look like you are signed in when you are not.
      <App />
    )}
  </StrictMode>
);
