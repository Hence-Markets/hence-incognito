import { usePrivy, useWallets } from '@privy-io/react-auth';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Normalizes the Privy user/wallet into the shape the Hence UI needs.
// Privy-only: email/google/twitter login + embedded wallet (or connected external wallet).
export function useAuth() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  // prefer the Privy embedded wallet, else the first connected wallet, else the linked one
  const wallet = wallets.find((w: any) => (w.walletClientType || '').startsWith('privy')) || wallets[0];
  const walletAddress: string | undefined = wallet?.address || (user as any)?.wallet?.address;
  // Privy may retain a wallet object briefly while a logout/account transition is
  // settling. Never let that stale object drive balances, funding, or signing UI.
  const address: string | undefined = authenticated && typeof walletAddress === 'string' && EVM_ADDRESS.test(walletAddress)
    ? walletAddress
    : undefined;

  const email: string | undefined = user?.email?.address || (user as any)?.google?.email;
  const xHandle: string | undefined = (user as any)?.twitter?.username;
  const name: string =
    (user as any)?.google?.name ||
    (user as any)?.twitter?.name ||
    (email ? email.split('@')[0] : '') ||
    (xHandle ? '@' + xHandle : '') ||
    'Trader';
  const firstName = (name.replace(/^@/, '').split(/[ .]/)[0]) || 'there';
  const avatarUrl: string | undefined = (user as any)?.twitter?.profilePictureUrl || (user as any)?.google?.profilePictureUrl;

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : undefined;

  return { ready, authenticated, user, login, logout, getAccessToken, wallet, wallets, address, shortAddr, email, xHandle, name, firstName, avatarUrl };
}
