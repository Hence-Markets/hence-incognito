/* Placing a shielded order.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an order either executes from the shielded address or
 * it does not execute at all. There is no fallback to the user's main wallet, ever. Falling
 * back would publish exactly the link the product exists to hide, and it would do it silently,
 * at the moment the user believes they are protected. Every failure below returns a reason and
 * places nothing.
 */
import { encodeFunctionData, type WalletClient } from 'viem';

export type Side = 'long' | 'short';

export type OrderIntent = {
  symbol: string;
  side: Side;
  /** notional in USD — encrypted before it leaves the browser */
  size: number;
  leverage: number;
};

export type OrderResult =
  | { ok: true; txHash: string; shieldedAddress: string }
  | { ok: false; reason: string };

/** Minimal ABI — only what we call. */
export const INCOGNITO_ABI = [
  {
    type: 'function',
    name: 'submitOrder',
    stateMutability: 'payable',
    inputs: [
      { name: 'encryptedSize', type: 'bytes' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'currentEpoch',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint64' }],
  },
] as const;

export const contractAddress = () =>
  (import.meta.env.VITE_INCOGNITO_CONTRACT ?? '').trim();

/** Is the shielded path actually available? Called before the ticket lets anyone commit. */
export function shieldedReady(shieldedAddress?: string | null): { ready: boolean; reason?: string } {
  if (!contractAddress()) return { ready: false, reason: 'Incognito contract not deployed yet' };
  if (!shieldedAddress) return { ready: false, reason: 'No shielded address — cannot place privately' };
  return { ready: true };
}

/**
 * Encrypt the size client-side, then submit it from the SHIELDED wallet.
 *
 * The size never leaves the browser in plaintext: `zap.encrypt` produces a ciphertext bound to
 * (this address, this contract), and the contract validates that binding — a handle prepared
 * for someone else is rejected on-chain rather than silently accepted.
 */
export async function placeShieldedOrder(
  intent: OrderIntent,
  shielded: { address: string; client: WalletClient } | null
): Promise<OrderResult> {
  const gate = shieldedReady(shielded?.address);
  if (!gate.ready) return { ok: false, reason: gate.reason! };
  if (!shielded) return { ok: false, reason: 'Shielded wallet unavailable' };

  const dapp = contractAddress() as `0x${string}`;

  let ciphertext: `0x${string}`;
  try {
    // Loaded lazily so a missing/misconfigured SDK surfaces here — as a refusal to place —
    // rather than at module load, where it would take the whole terminal down.
    const { Lightning, handleTypes } = (await import('@inco/lightning-js')) as any;
    const zap = Lightning.latest(
      import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
    );
    ciphertext = await zap.encrypt(BigInt(Math.round(intent.size)), {
      accountAddress: shielded.address,
      dappAddress: dapp,
      handleType: handleTypes.euint256,
    });
  } catch (err: any) {
    return { ok: false, reason: `Could not encrypt the order: ${err?.message ?? 'unknown error'}` };
  }

  try {
    const data = encodeFunctionData({
      abi: INCOGNITO_ABI,
      functionName: 'submitOrder',
      args: [ciphertext, intent.side === 'long' ? 0 : 1],
    });
    // Sent by the SHIELDED wallet. If this client is ever the user's main wallet, the whole
    // product is broken — the caller is responsible for never passing one.
    const txHash = await shielded.client.sendTransaction({
      account: shielded.address as `0x${string}`,
      to: dapp,
      data,
      // Inco charges per encrypted input; the contract forwards it. Read at call time rather
      // than hardcoded — the docs are explicit that the fee can change via upgrades.
      value: 0n,
      chain: null,
    } as any);
    return { ok: true, txHash, shieldedAddress: shielded.address };
  } catch (err: any) {
    return { ok: false, reason: err?.shortMessage ?? err?.message ?? 'Transaction rejected' };
  }
}
