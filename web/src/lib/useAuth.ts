/* Auth, deliberately the same shape as the main app's hook.

   COPIED, not imported — the whole point of the separate repo is that nothing crosses the
   boundary. What IS shared is the Privy app ID: the same app across two domains gives the same
   user and the same embedded wallet here as on app.hence.markets. That is the only integration
   point, and it is why `incognito.hence.markets` must be in Privy's allowed origins — without
   it login fails outright rather than degrading.

   The stale-wallet guard is carried over on purpose: Privy can hold a wallet object briefly
   while a logout is settling, and letting that drive a SHIELDED session would be worse here
   than in the main app — it would attribute a trade to the wrong identity. */
import { usePrivy, useWallets } from '@privy-io/react-auth';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function useAuth() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const wallet =
    wallets.find((w: any) => (w.walletClientType || '').startsWith('privy')) || wallets[0];
  const walletAddress: string | undefined = wallet?.address || (user as any)?.wallet?.address;

  const address: string | undefined =
    authenticated && typeof walletAddress === 'string' && EVM_ADDRESS.test(walletAddress)
      ? walletAddress
      : undefined;

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : undefined;

  return { ready, authenticated, login, logout, getAccessToken, wallet, address, shortAddr };
}
