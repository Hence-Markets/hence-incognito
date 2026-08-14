/* Epoch state — read from the contract when one is deployed, a local clock when not.
 *
 * ONE source, so every consumer sees the same numbers and `live` says plainly which mode it
 * is in. A demo that cannot be told apart from the real thing is the one thing this product
 * must not ship, so the flag is surfaced rather than hidden.
 *
 * PER MARKET. Netting happens per market, so "orders sealed" has to mean sealed in THIS market
 * — an epoch-wide count would tell a BTC trader that six orders are in the book when five of
 * them are SOL and nothing will cross. It reports both, because the epoch-wide figure is the
 * honest size of the anonymity set while the per-market figure is what will actually net.
 *
 * Read-only: no wallet, no signing, no keeper involvement. That is why this piece could land
 * before shielded wallets exist — it proves the app is talking to the deployed contract using
 * nothing but a public RPC.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia, base } from 'viem/chains';
import { pairIndex } from '../lib/markets';

const EPOCH_SECONDS = Number(import.meta.env.VITE_EPOCH_SECONDS ?? 300);
const CONTRACT = (import.meta.env.VITE_INCOGNITO_CONTRACT ?? '').trim() as Address | '';
const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';

export type EpochState = {
  /** seconds until the open epoch closes and netting runs */
  secondsLeft: number;
  /** orders sealed in the open epoch, IN THIS MARKET — what can actually cross */
  sealed: number;
  /** orders sealed across every market this epoch — the anonymity set */
  sealedAll: number;
  /** share of the LAST epoch that crossed internally, 0–1, or null if unknown */
  lastCrossed: number | null;
  /** true once these numbers come from the chain rather than a local clock */
  live: boolean;
  /** the open epoch id, when known */
  epochId: number | null;
  /** true once the keeper has netted the previous epoch */
  prevNetted: boolean;
};

const ABI = [
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'orderCount', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'orderCountIn', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'bookStatus', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ name: 'count', type: 'uint256' }, { name: 'netted', type: 'bool' }, { name: 'revealed', type: 'bool' }],
  },
  {
    type: 'function', name: 'epochs', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [
      { name: 'id', type: 'uint64' },
      { name: 'closesAt', type: 'uint64' },
      { name: 'orderCount', type: 'uint256' },
      { name: 'netted', type: 'bool' },
    ],
  },
] as const;

const client = CONTRACT
  ? createPublicClient({ chain: IS_MAINNET ? base : baseSepolia, transport: http() })
  : null;

const EMPTY: EpochState = {
  secondsLeft: EPOCH_SECONDS,
  sealed: 0,
  sealedAll: 0,
  lastCrossed: null,
  live: false,
  epochId: null,
  prevNetted: false,
};

export function useEpoch(symbol?: string | null): EpochState {
  const [state, setState] = useState<EpochState>(EMPTY);
  const pair = pairIndex(symbol);

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
        const [ep, sealedAll, sealedHere] = await Promise.all([
          client.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochs', args: [epochId] }),
          client.readContract({ address: CONTRACT, abi: ABI, functionName: 'orderCount', args: [epochId] }),
          pair == null
            ? Promise.resolve(0n)
            : client.readContract({ address: CONTRACT, abi: ABI, functionName: 'orderCountIn', args: [epochId, pair] }),
        ]);
        if (!alive) return;

        const closesAt = Number((ep as any)[1]);
        const left = Math.max(0, closesAt - Math.floor(Date.now() / 1000));

        // lastCrossed stays NULL until the previous epoch's book for THIS market is both netted
        // and revealed. The totals are euint handles until then — decrypting them is the
        // keeper's job, not the browser's, and inventing a number here would be exactly the
        // dishonesty the sealed book exists to avoid.
        let lastCrossed: number | null = null;
        let prevNetted = false;
        if (epochId > 1n && pair != null) {
          const prev = (await client.readContract({
            address: CONTRACT, abi: ABI, functionName: 'bookStatus', args: [epochId - 1n, pair],
          })) as any;
          prevNetted = Boolean(prev[1]);
          if (prevNetted && Boolean(prev[2])) {
            // TODO(keeper): the revealed aggregate arrives via attested decrypt, not from this
            // call — the on-chain value is still a handle. Wire it when the keeper publishes it.
            // Until then this stays null, which the UI renders as "—".
            lastCrossed = null;
          }
        }

        setState({
          secondsLeft: left,
          sealed: Number(sealedHere),
          sealedAll: Number(sealedAll),
          lastCrossed,
          live: true,
          epochId: Number(epochId),
          prevNetted,
        });
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
  }, [pair]);

  return state;
}
