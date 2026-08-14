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

/* The Inco Lightning entrypoint. Same address on Base and Base Sepolia per @inco/lightning's
   generated Lib.sol; the contract itself calls this to charge per encrypted input. */
export const INCO_ADDRESS = '0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624' as const;

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

/** Inco's live fee, read from the contract it will be paid to. NEVER hardcode it — the docs
 *  are explicit that the fee can change via upgrades, and a stale constant means every order
 *  reverts with FeeTooLow at the worst possible moment. */
const INCO_ABI = [
  { type: 'function', name: 'getFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

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
    // submitOrder reverts with FeeTooLow below inco.getFee(). Read it from the live Inco
    // contract rather than sending 0 — which is what this did, and would have failed every
    // order the first time one was actually attempted.
    let fee = 0n;
    try {
      const { createPublicClient, http } = await import('viem');
      const pub = createPublicClient({ chain: shielded.client.chain!, transport: http() });
      fee = (await pub.readContract({
        address: INCO_ADDRESS, abi: INCO_ABI, functionName: 'getFee',
      })) as bigint;
    } catch {
      return { ok: false, reason: 'Could not read the Inco fee — not placing blind' };
    }

    const txHash = await shielded.client.sendTransaction({
      account: shielded.address as `0x${string}`,
      to: dapp,
      data,
      value: fee,
      chain: shielded.client.chain,
    } as any);
    return { ok: true, txHash, shieldedAddress: shielded.address };
  } catch (err: any) {
    return { ok: false, reason: err?.shortMessage ?? err?.message ?? 'Transaction rejected' };
  }
}
