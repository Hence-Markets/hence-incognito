/* The shielded wallet — the address your orders execute from.
 *
 * It is a real Privy EMBEDDED wallet, not a keypair this app generates and holds. That was an
 * open question in the spec and the SDK settles it: `createWallet({ createAdditional: true })`
 * creates a second Ethereum embedded wallet for a user who already has one. So the user keeps
 * custody, Privy keeps the key, and we never hold one.
 *
 * IDENTITY vs SHIELDING — the whole point, and easy to get backwards:
 *
 *   identity  = the wallet you CONNECT (MetaMask, Rabby…). It is what the cohort gate checks
 *               and what the UI greets you by. It must never appear on Avantis.
 *   shielded  = the embedded wallet. It executes. It must never be shown as "you", linked to
 *               your handle, or used to sign anything that identifies you.
 *
 * Keeping them apart IS the product. If a bug ever lets the identity wallet execute, the trade
 * becomes permanently attributable and no later fix removes it from the chain.
 */
import { useCallback, useMemo, useState } from 'react';
import { useCreateWallet, useWallets } from '@privy-io/react-auth';

const isEmbedded = (w: any) => (w?.walletClientType || '').startsWith('privy');

export type Shielded = {
  /** the address orders execute from, once one exists */
  address: string | null;
  /** the Privy wallet object, for building a signer */
  wallet: any | null;
  /** true when a shielded address exists and can be used */
  ready: boolean;
  /** creating one right now */
  creating: boolean;
  /** why it is unusable, if it is */
  reason: string | null;
  /** create the shielded wallet. Idempotent — returns the existing one if there is one. */
  create: () => Promise<string | null>;
};

export function useShielded(): Shielded {
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = useMemo(() => wallets.find(isEmbedded) ?? null, [wallets]);
  const address = wallet?.address ?? null;

  const create = useCallback(async () => {
    if (address) return address;          // idempotent: never mint a second one by accident
    setCreating(true);
    setError(null);
    try {
      // No createAdditional flag: the embedded wallet is RESERVED for shielding here, so the
      // first one is the shielded one. Pass { createAdditional: true } only if a future change
      // starts using an embedded wallet for identity too — at which point the two roles need
      // separating explicitly rather than by position.
      const res: any = await createWallet();
      return res?.wallet?.address ?? null;
    } catch (e: any) {
      setError(e?.message ?? 'Could not create a shielded wallet');
      return null;
    } finally {
      setCreating(false);
    }
  }, [address, createWallet]);

  return {
    address,
    wallet,
    ready: !!address,
    creating,
    reason: error ?? (address ? null : 'No shielded address yet'),
    create,
  };
}
