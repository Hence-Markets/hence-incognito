import { useEffect, useRef, type ReactNode } from 'react';
import { PrivyProvider, usePrivy, useDepositAddress, useFiatOnramp } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { baseSepolia, polygon, arbitrum, base } from 'viem/chains';
import { useAuth } from '../hooks/useAuth';
import * as me from '../lib/me.js';
import { PERSONA_KEY } from '../lib/persona';
import { initAnalytics, trackSignin, resetSigninTracking, grantConsent, track } from '../lib/analytics';
import { setAuthTokenProvider } from '../lib/auth-transport';

const queryClient = new QueryClient();

// Mirrors Privy auth onto window.henceAuth so the vanilla-JS modules (accounts modal,
// dock) can read the real identity/wallet without importing React. Bearer tokens stay in
// the module-scoped authenticated transport and are never exposed on `window`. Fires
// 'hence:auth' on change, and syncs the per-user profile to the backend on login.
function AuthBridge() {
  const auth = useAuth();
  const { linkWallet } = usePrivy();
  const wasAuthed = useRef(false);
  useEffect(() => {
    setAuthTokenProvider(auth.authenticated ? auth.getAccessToken : null, auth.authenticated);
    (window as any).henceAuth = {
      authenticated: auth.authenticated,
      address: auth.address || null,
      name: auth.authenticated ? auth.name : null,
      firstName: auth.authenticated ? auth.firstName : null,
      email: auth.authenticated ? auth.email : null,
      handle: auth.authenticated ? auth.xHandle : null,
      avatar: auth.authenticated ? auth.avatarUrl : null,
      login: auth.login,                        // open the Privy login modal
      logout: auth.logout,                      // sign out (Privy) — used by the command menu
      // linked wallets (embedded + external) for the Accounts sheet; external = not the
      // Privy embedded wallet. linkWallet opens Privy's connect-a-wallet modal.
      wallets: auth.authenticated
        ? auth.wallets.map((w: any) => ({ address: w.address, type: w.walletClientType || 'external' }))
        : [],
      linkWallet,
    };
    window.dispatchEvent(new CustomEvent('hence:auth'));
    // upsert the per-user row on login (idempotent); clear the cached profile on logout.
    // A real logout (not the unauthenticated mount) also drops the onboarding-picks mirror
    // so the next user's tour/pass never renders the previous user's universe.
    if (auth.authenticated) {
      const firstSignin = !wasAuthed.current;   // read BEFORE the flag flips
      wasAuthed.current = true;
      me.syncMe({ email: auth.email, name: auth.name, handle: auth.xHandle, avatar: auth.avatarUrl, wallet: auth.address });
      // Privy's signup popup collects the Terms/Privacy consent (it uses our own /legal URLs),
      // so a completed login IS consent — grant it before initAnalytics so telemetry can start.
      // The server also records the acceptance on the syncMe above (the compliance ledger).
      grantConsent((auth.user as any)?.id || auth.address || null);
      initAnalytics((auth.user as any)?.id || auth.address || null,
        { handle: auth.xHandle || undefined, email: auth.email || undefined, name: auth.name });
      if (firstSignin) {
        trackSignin({ method: auth.email ? 'email' : auth.xHandle ? 'x' : 'wallet' });
        track('legal_accepted', { via: 'privy', bundle: 'hence-legal-v1' });   // funnel continuity (replaces the in-app gate)
      }
    } else {
      if (wasAuthed.current) {
        wasAuthed.current = false;
        resetSigninTracking();
        try { localStorage.removeItem(PERSONA_KEY); } catch { /* storage disabled */ }
      }
      me.clearMe();
    }
  }, [auth.authenticated, auth.address, auth.name, auth.email, auth.firstName, auth.xHandle, auth.avatarUrl, auth.getAccessToken]);
  return null;
}

// Mirrors Privy's funding hooks onto window.henceFund so the vanilla accounts drawer can
// trigger universal crypto deposits + fiat onramps without importing React. deposit() opens
// Privy's cross-chain deposit-address modal (bridges ANY source asset → the chosen token on
// the chosen chain, into the embedded wallet); addCash() opens the fiat onramp modal. Both
// resolve/reject from Privy; the drawer catches DEPOSIT_ADDRESSES_NOT_ENABLED (dashboard
// toggle off) and falls back to a native receive sheet. Fires 'hence:fund' when readiness
// changes so the drawer re-renders.
function FundBridge() {
  const auth = useAuth();
  const { createDepositAddress } = useDepositAddress();
  const { fund } = useFiatOnramp();
  useEffect(() => {
    (window as any).henceFund = {
      ready: !!(auth.authenticated && auth.address),
      address: auth.address || null,
      // universal deposit: bridge any source asset/chain → `token` on `caip2` into the wallet
      deposit: async (caip2: string, token: string) => {
        if (!auth.address) throw { code: 'NO_WALLET' };
        return createDepositAddress({ destinationChain: caip2, destinationCurrency: token, destinationAddress: auth.address });
      },
      // fiat → crypto straight into the embedded wallet (card / Apple Pay / bank via Privy)
      addCash: async (caip2: string, token: string, amount?: string) => {
        if (!auth.address) throw { code: 'NO_WALLET' };
        return fund({
          source: { assets: ['usd', 'eur', 'gbp'], defaultAsset: 'usd' },
          destination: { asset: token, chain: caip2 as `${string}:${string}`, address: auth.address },
          ...(amount ? { defaultAmount: amount } : {}),
        });
      },
    };
    window.dispatchEvent(new CustomEvent('hence:fund'));
  }, [auth.authenticated, auth.address, createDepositAddress, fund]);
  return null;
}

// Public Privy app id (client-side by design). From web/.env, falls back to the real id.
const PRIVY_APP_ID = (import.meta as any).env?.VITE_PRIVY_APP_ID || 'cmp3r31c2011u0cl1uyrm2nvu';

// Hence tri-dot logo for the Privy modal (white dots, transparent — reads on the dark theme).
const LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='10.3' r='2.6' fill='white'/%3E%3Ccircle cx='11' cy='18.8' r='2.6' fill='white'/%3E%3Ccircle cx='21' cy='18.8' r='2.6' fill='white'/%3E%3C/svg%3E";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // email + wallet ONLY (Google was broken and redundant with email; X-linking for the
        // username claim is account LINKING, not login, so it is unaffected)
        loginMethods: ['email', 'wallet'],
        // the same legal bundle the in-app gate enforces, surfaced inside
        // Privy's own auth modal (matches the original Hence app's config)
        legal: {
          termsAndConditionsUrl: 'https://app.hence.markets/#/legal/terms',
          privacyPolicyUrl: 'https://app.hence.markets/#/legal/privacy',
        },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        // Chains the embedded wallet can operate on. Polygon → Polymarket (CLOB V2);
        // Base → the general/low-fee balance + fiat onramp destination; Arbitrum →
        // Hyperliquid's USDC bridge. Universal deposits + onramps land funds here. HL
        // itself is signature-only (no chain switch) so this doesn't affect its flow.
        // baseSepolia is REQUIRED for Incognito: the shielded wallet signs submitOrder on
        // chain 84532, and a chain absent from this list makes the embedded wallet refuse with
        // "Unsupported chainId 84532" — surfaced only as a small line under the trade button,
        // while the confirm sheet still showed a valid shielded address. Add the mainnet chain
        // here too before ever pointing VITE_NETWORK at Base.
        supportedChains: [base, baseSepolia, arbitrum, polygon],
        // Themes every Privy-rendered modal (login, connect/link wallet, embedded-wallet,
        // funding/deposit/onramp) to the Hence brand — peach accent to match the login
        // gradient + interest chips. Radii + secondary surfaces + status tones are set via
        // the body{--privy-*} block in app.css (the only hook for those). MoonPay's iframe
        // is a separate theme path (dark + accent) since appearance doesn't reach it.
        appearance: {
          theme: '#0a0a0b',
          accentColor: '#f4c39a',        // Hence peach (brand accent) — dark text sits on it
          logo: LOGO,
          landingHeader: 'Welcome to Hence',
          loginMessage: 'Beliefs, not tickers. Sign in to trade yours.',
          emailDomain: 'hence.markets',  // shown on the email-verify screen (was 'privy.io')
          showWalletLoginFirst: false,
          walletChainType: 'ethereum-only',
          // detected_ethereum_wallets surfaces ANY injected wallet — incl. Rabby (Privy lists
          // Rabby via detection; the literal 'rabby_wallet' entry is deprecated but harmless,
          // kept for older modal builds). wallet_connect covers Rabby mobile.
          walletList: ['detected_ethereum_wallets', 'metamask', 'phantom', 'rabby_wallet', 'coinbase_wallet', 'rainbow', 'wallet_connect'],
        },
        fundingMethodConfig: {
          moonpay: { uiConfig: { theme: 'dark', accentColor: '#f4c39a' } },
        },
      }}
    >
      <QueryClientProvider client={queryClient}><AuthBridge /><FundBridge />{children}</QueryClientProvider>
    </PrivyProvider>
  );
}
