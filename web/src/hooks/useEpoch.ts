/* Epoch state — read from the contract when one is deployed, a local clock when not.
 *
 * ONE source, so every consumer sees the same numbers and `live` says plainly which mode it
 * is in. A demo that cannot be told apart from the real thing is the one thing this product
 * must not ship, so the flag is surfaced rather than hidden.
 *
 * Read-only: no wallet, no signing, no keeper involvement. That is why this piece could land
 * before shielded wallets exist — it proves the app is talking to the deployed contract using
 * nothing but a public RPC.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia, base } from 'viem/chains';

const EPOCH_SECONDS = Number(import.meta.env.VITE_EPOCH_SECONDS ?? 300);
const CONTRACT = (import.meta.env.VITE_INCOGNITO_CONTRACT ?? '').trim() as Address | '';
const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';

export type EpochState = {
  /** seconds until the open epoch closes and netting runs */
  secondsLeft: number;
  /** orders sealed in the open epoch */
  sealed: number;
  /** share of the LAST epoch that crossed internally, 0–1, or null if unknown */
  lastCrossed: number | null;
  /** true once these numbers come from the chain rather than a local clock */
  live: boolean;
  /** the open epoch id, when known */
  epochId: number | null;
};

const ABI = [
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'epochSeconds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'orderCount', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'epochs', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [
      { name: 'id', type: 'uint64' },
      { name: 'closesAt', type: 'uint64' },
      { name: 'orderCount', type: 'uint256' },
      { name: 'netted', type: 'bool' },
      { name: 'sumLongs', type: 'bytes32' },
      { name: 'sumShorts', type: 'bytes32' },
      { name: 'matched', type: 'bytes32' },
      { name: 'residual', type: 'bytes32' },
      { name: 'revealed', type: 'bool' },
    ],
  },
] as const;

const client = CONTRACT
  ? createPublicClient({ chain: IS_MAINNET ? base : baseSepolia, transport: http() })
  : null;

export function useEpoch(): EpochState {
  const [state, setState] = useState<EpochState>({
    secondsLeft: EPOCH_SECONDS,
    sealed: 0,
    lastCrossed: null,
    live: false,
    epochId: null,
  });

  useEffect(() => {
    let alive = true;

    // Fallback clock. Anchored to wall time so every client in an epoch agrees, rather than
    // each counting down from whenever it happened to load.
    const localTick = () => {
      const now = Math.floor(Date.now() / 1000);
      setState((s) => ({ ...s, secondsLeft: EPOCH_SECONDS - (now % EPOCH_SECONDS) }));
    };

    if (!client || !CONTRACT) {
      localTick();
      const t = setInterval(localTick, 1000);
      return () => clearInterval(t);
    }

    const read = async () => {
      try {
        const epochId = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentEpoch' });
        const [ep, sealed] = await Promise.all([
          client.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochs', args: [epochId] }),
          client.readContract({ address: CONTRACT, abi: ABI, functionName: 'orderCount', args: [epochId] }),
        ]);
        if (!alive) return;

        const closesAt = Number((ep as any)[1]);
        const left = Math.max(0, closesAt - Math.floor(Date.now() / 1000));

        // lastCrossed stays NULL until the previous epoch is both netted AND revealed. The
        // totals are euint handles until then — decrypting them is the keeper's job, not the
        // browser's, and inventing a number here would be exactly the dishonesty the sealed
        // book exists to avoid.
        let lastCrossed: number | null = null;
        if (epochId > 1n) {
          const prev = (await client.readContract({
            address: CONTRACT, abi: ABI, functionName: 'epochs', args: [epochId - 1n],
          })) as any;
          const netted = Boolean(prev[3]);
          const revealed = Boolean(prev[8]);
          if (netted && revealed) {
            // TODO(keeper): the revealed aggregate arrives via attested decrypt, not from
            // this call — the on-chain value is still a handle. Wire it when the keeper
            // publishes it. Until then this stays null, which the UI renders as "—".
            lastCrossed = null;
          }
        }

        setState({ secondsLeft: left, sealed: Number(sealed), lastCrossed, live: true, epochId: Number(epochId) });
      } catch {
        // A dead RPC must not freeze the countdown — fall back to the clock and stay honest
        // about not being live.
        if (alive) setState((s) => ({ ...s, live: false }));
        localTick();
      }
    };

    read();
    const poll = setInterval(read, 15_000);   // chain state moves per block; 15s is plenty
    const tick = setInterval(() => setState((s) => ({ ...s, secondsLeft: Math.max(0, s.secondsLeft - 1) })), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  return state;
}
