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
import { createPublicClient, createWalletClient, custom, http, type WalletClient, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const isEmbedded = (w: any) => (w?.walletClientType || '').startsWith('privy');

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';
const CHAIN = IS_MAINNET ? base : baseSepolia;
const CHAIN_HEX = `0x${CHAIN.id.toString(16)}` as const;

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
  /** a viem WalletClient bound to the SHIELDED wallet, on the right chain. Null if unavailable. */
  getClient: () => Promise<{ address: string; client: WalletClient } | null>;
  /** make sure the shielded wallet can pay for an order; asks the keeper for a grant if not */
  ensureFunded: () => Promise<{ ok: boolean; reason?: string }>;
};

/** Enough for the Inco input fee (1e12 wei) plus gas, several times over. Below this an order
 *  would revert at the fee check, which reads as "the app is broken" rather than "top me up". */
/* MUST stay BELOW the funder's grant (FUND_GRANT_ETH, now 0.0002). A threshold above the
   grant means a freshly funded wallet still reads as unfunded — it would ask for another
   grant on every order, and the card would say "Needs gas" over a wallet holding plenty.
   Matches the funder's own TOP_UP_BELOW so both sides agree on what "funded" means. */
const MIN_BALANCE = 50_000_000_000_000n;   // 0.00005 ETH — ~14 orders

/** MUST match keeper/src/verify.ts fundMessage() byte for byte, or recovery yields a different
 *  address and every request is refused for a reason that looks like ineligibility. */
const fundMessage = (shielded: string, issuedAt: number) =>
  [
    'Hence Incognito — fund shielded wallet',
    '',
    `shielded: ${shielded.toLowerCase()}`,
    `issued:   ${issuedAt}`,
    '',
    'Signing proves you control this account. It authorises a small gas grant and nothing else.',
  ].join('\n');

export function useShielded(): Shielded {
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = useMemo(() => wallets.find(isEmbedded) ?? null, [wallets]);
  const address = wallet?.address ?? null;

  /* The IDENTITY wallet — the connected one. Used for exactly ONE thing: signing the funding
     request, which proves cohort membership. It must never sign an order, and it never sends
     the grant itself (that transfer would link the two addresses on-chain forever — the
     omnibus exists precisely so nobody can draw that line). */
  const identity = useMemo(() => wallets.find((w) => !isEmbedded(w)) ?? null, [wallets]);

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

  /* Bridge the shielded Privy wallet → viem WalletClient, switching it to Base first.
     Shape copied from lib/polymarket-trade.ts getWalletClient(), including the 4902 add-chain
     fallback — an embedded wallet may not know Base Sepolia yet.

     THE ONE INVARIANT: this must only ever bind the EMBEDDED wallet. `wallet` comes from
     useWallets().find(isEmbedded), so a connected MetaMask can never end up here. If that
     lookup is ever loosened, the identity wallet could sign an order and the position becomes
     permanently attributable. */
  const getClient = useCallback(async () => {
    if (!wallet || !address) return null;
    try {
      const provider = await wallet.getEthereumProvider();
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
      } catch (err: any) {
        if (err?.code === 4902 || /unrecognized chain|not been added/i.test(err?.message || '')) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: CHAIN_HEX,
              chainName: CHAIN.name,
              nativeCurrency: CHAIN.nativeCurrency,
              rpcUrls: [CHAIN.rpcUrls.default.http[0]],
              blockExplorerUrls: [CHAIN.blockExplorers?.default?.url].filter(Boolean),
            }],
          });
        } else {
          throw err;
        }
      }
      return {
        address,
        client: createWalletClient({ account: address as Hex, chain: CHAIN, transport: custom(provider) }),
      };
    } catch (e: any) {
      setError(e?.message ?? 'Could not reach the shielded wallet');
      return null;   // fail closed: the caller places nothing
    }
  }, [wallet, address]);

  /* Ask the keeper for a gas grant, but only if one is actually needed.

     The IDENTITY wallet signs — that is what proves cohort membership without the shielded
     address ever needing to be in the cohort, and without this app holding a Privy app secret.
     The message binds the shielded address, so a captured signature cannot be replayed to fund
     someone else's wallet. It is a SIGNATURE, not a transaction: nothing goes on chain from the
     identity wallet, so no link is published. */
  const ensureFunded = useCallback(async () => {
    if (!address) return { ok: false, reason: 'No shielded address' };

    // Already funded is the common case after the first order — never prompt for a signature
    // we do not need. A signature request with no visible cause reads as a phishing attempt.
    try {
      const pub = createPublicClient({ chain: CHAIN, transport: http() });
      if ((await pub.getBalance({ address: address as Hex })) >= MIN_BALANCE) return { ok: true };
    } catch {
      // Can't read the balance — ask anyway. The keeper refuses a wallet that already has
      // enough, so the worst case is a wasted round trip, not a double grant.
    }

    if (!identity?.address) return { ok: false, reason: 'Connect your wallet to enable trading' };
    try {
      const issuedAt = Date.now();
      const provider = await identity.getEthereumProvider();
      const signature = await provider.request({
        method: 'personal_sign',
        params: [fundMessage(address, issuedAt), identity.address],
      });
      const r = await fetch('/inc/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shielded: address, identity: identity.address, signature, issuedAt }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.reason ?? 'Funding refused');
      return j;
    } catch (e: any) {
      const reason = e?.code === 4001 ? 'You declined the signature' : (e?.message ?? 'Funding failed');
      setError(reason);
      return { ok: false, reason };
    }
  }, [address, identity]);

  return {
    address,
    wallet,
    getClient,
    ensureFunded,
    ready: !!address,
    creating,
    reason: error ?? (address ? null : 'No shielded address yet'),
    create,
  };
}
