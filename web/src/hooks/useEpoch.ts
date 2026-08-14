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
import { getLogsChunked } from '../lib/logs';

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
  /** orders the previous epoch held IN THIS MARKET — 0 means there was no book to net */
  prevCount: number;
  /** which epoch `lastCrossed` describes — may be the CURRENT one, once it has been netted */
  crossedEpoch: number | null;
  /** positions in THIS epoch's book that belong to the caller's shielded address.
   *  "2 sealed" tells a trader nothing about whether they are in it; this does. */
  mine: number[];
};

const ORDER_SUBMITTED = {
  type: 'event',
  name: 'OrderSubmitted',
  inputs: [
    { name: 'epoch', type: 'uint64', indexed: true },
    { name: 'trader', type: 'address', indexed: true },
    { name: 'pair', type: 'uint16', indexed: true },
    { name: 'side', type: 'uint8', indexed: false },
    { name: 'routeResidual', type: 'bool', indexed: false },
  ],
} as const;

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
    type: 'function', name: 'bookSums', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ name: 'longs', type: 'bytes32' }, { name: 'shorts', type: 'bytes32' }],
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
const clientRef = client;

/* Once revealAggregate has run, the two totals are PUBLICLY decryptable — so the browser
   fetches the attestation itself rather than asking the keeper what happened. That is the
   contract's design intent ("after reveal, ANYONE can complete it") and it means the number on
   screen does not depend on trusting our own service.

   Cached per epoch+market: an attested reveal is a network round trip to Inco's covalidators,
   and the answer for a closed book never changes. */
const revealCache = new Map<string, { crossed: number } | null>();

async function fetchCrossed(
  client: NonNullable<typeof clientRef>, epId: bigint, pair: number
): Promise<number | null> {
  const key = `${epId}:${pair}`;
  if (revealCache.has(key)) return revealCache.get(key)?.crossed ?? null;
  try {
    const sums = (await client.readContract({
      address: CONTRACT as Address, abi: ABI, functionName: 'bookSums', args: [epId, pair],
    })) as any;
    const { Lightning } = await import('@inco/lightning-js/lite');
    const zap = IS_MAINNET ? await Lightning.baseMainnet() : await Lightning.baseSepoliaTestnet();
    const rev = await zap.attestedReveal([sums[0], sums[1]]);
    const longs = BigInt((rev?.[0] as any)?.plaintext?.value ?? 0);
    const shorts = BigInt((rev?.[1] as any)?.plaintext?.value ?? 0);
    const gross = longs + shorts;
    if (gross === 0n) { revealCache.set(key, null); return null; }
    /* Matched volume crosses on BOTH sides, so the crossed share of gross order value is
       2·min/(longs+shorts). It and the unfilled share sum to exactly 1, because
       2·min + (max − min) = min + max. */
    const matched = longs < shorts ? longs : shorts;
    const crossed = Number((matched * 2n * 10000n) / gross) / 10000;
    revealCache.set(key, { crossed });
    return crossed;
  } catch (err: any) {
    // A covalidator that will not answer is not a reason to invent a number. But it IS a reason
    // to say so out loud — a silent dash here is indistinguishable from "no book yet".
    console.warn('[incognito] attested reveal failed for', key, err?.message ?? err);
    revealCache.set(key, null);
    return null;
  }
}

const EMPTY: EpochState = {
  secondsLeft: EPOCH_SECONDS,
  sealed: 0,
  sealedAll: 0,
  lastCrossed: null,
  live: false,
  epochId: null,
  prevNetted: false,
  prevCount: 0,
  crossedEpoch: null,
  mine: [],
};

export function useEpoch(symbol?: string | null, shieldedAddress?: string | null): EpochState {
  const [state, setState] = useState<EpochState>(EMPTY);
  const pair = pairIndex(symbol);
  const me = (shieldedAddress ?? '').toLowerCase();

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
        /* THE MOST RECENT FINISHED BOOK, which is not necessarily the previous epoch.
           Epochs roll on a submit, not a clock, so a closed-and-netted epoch stays
           `currentEpoch` until someone trades again. Only ever looking one epoch back meant a
           book that had just netted showed nothing, while an empty older epoch was reported
           instead. Walk back from the current epoch to the first market book that is netted
           AND revealed. */
        let lastCrossed: number | null = null;
        let crossedEpoch: number | null = null;
        let prevNetted = false;
        let prevCount = 0;

        if (pair != null) {
          for (let back = 0n; back < 4n && epochId - back >= 1n; back++) {
            const id = epochId - back;
            const st = (await client.readContract({
              address: CONTRACT, abi: ABI, functionName: 'bookStatus', args: [id, pair],
            })) as any;
            const count = Number(st[0]);
            if (count === 0) continue;                 // no book here, keep walking back
            if (back === 0n && id === epochId) {
              // the open epoch's own book — its netted flag is what "awaiting keeper" reads
              prevCount = count;
              prevNetted = Boolean(st[1]);
            } else if (crossedEpoch == null) {
              prevCount = count;
              prevNetted = Boolean(st[1]);
            }
            if (Boolean(st[1]) && Boolean(st[2])) {
              lastCrossed = await fetchCrossed(client, id, pair);
              crossedEpoch = Number(id);
              break;
            }
          }
        }

        /* Which rows in this epoch's book are the caller's. The contract stores orders per
           (epoch, pair) in submission order and OrderSubmitted fires in that same order, so
           the log index IS the row index — no extra call needed to line them up. */
        let mine: number[] = [];
        if (me && pair != null && Number(sealedHere) > 0) {
          try {
            const all = await getLogsChunked(client, {
              address: CONTRACT, event: ORDER_SUBMITTED, args: { epoch: epochId, pair },
            });
            mine = all
              .map((l: any, i: number) => (String(l.args.trader).toLowerCase() === me ? i : -1))
              .filter((i: number) => i >= 0);
          } catch { mine = []; }
        }

        setState({
          secondsLeft: left,
          sealed: Number(sealedHere),
          sealedAll: Number(sealedAll),
          lastCrossed,
          live: true,
          epochId: Number(epochId),
          prevNetted,
          prevCount,
          crossedEpoch,
          mine,
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
  }, [pair, me]);

  return state;
}
