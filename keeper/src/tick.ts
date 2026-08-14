/* The keeper loop: close epochs, net on ciphertext, publish the aggregate.
 *
 * This is the half of the product that makes the claim true. Intake alone proves orders can be
 * encrypted; this proves they can be MATCHED without being decrypted, which is the whole thesis.
 *
 * WHAT IT IS ALLOWED TO DO, and the limit is deliberate: `netEpoch` and `revealAggregate`, and
 * an attested decrypt of the residual — nothing else. It cannot move collateral, cannot read an
 * individual order, cannot cancel one. A compromised keeper stalls the book; it cannot drain it
 * or deanonymise anyone. Keep it that way when adding the Avantis leg.
 *
 * IT IS ALSO NOT A TRUSTED PARTY. Inco has no contract-triggered decryption, so SOMETHING
 * off-chain has to drive reveal — but once `revealAggregate` has run, the handles are publicly
 * decryptable and anyone can fetch the attestation. The browser does exactly that (see
 * web/src/hooks/useEpoch.ts). A keeper that goes quiet delays the book; it does not own it.
 *
 * EPOCHS ONLY ROLL ON A SUBMIT. `_rollEpochIfDue()` lives inside submitOrder, so with no flow
 * the open epoch sits past its close indefinitely — and it is still `currentEpoch`. Netting it
 * is safe regardless: once closesAt has passed, the next submit rolls to a new epoch, so no
 * order can join a book after it closes.
 */
import {
  createPublicClient, createWalletClient, http, formatEther,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const CHAIN = process.env.NETWORK === 'mainnet' ? base : baseSepolia;
const CONTRACT = (process.env.INCOGNITO_CONTRACT || '').trim() as Address;

/** The keeper signs netEpoch/revealAggregate. Falls back to the omnibus key because on a
 *  testnet build they are the same wallet; separate them before anything holds real value. */
const KEY = ((process.env.KEEPER_KEY || process.env.OMNIBUS_KEY || '').trim()) as Hex;

export const ABI = [
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'epochs', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [
      { name: 'id', type: 'uint64' }, { name: 'closesAt', type: 'uint64' },
      { name: 'orderCount', type: 'uint256' }, { name: 'netted', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'marketsInEpoch', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }], outputs: [{ type: 'uint16[]' }],
  },
  {
    type: 'function', name: 'bookStatus', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ name: 'count', type: 'uint256' }, { name: 'netted', type: 'bool' }, { name: 'revealed', type: 'bool' }],
  },
  {
    type: 'function', name: 'bookResidual', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'bookSums', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ name: 'longs', type: 'bytes32' }, { name: 'shorts', type: 'bytes32' }],
  },
  { type: 'function', name: 'netEpoch', stateMutability: 'nonpayable', inputs: [{ name: 'epId', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'revealAggregate', stateMutability: 'nonpayable', inputs: [{ name: 'epId', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'MIN_ORDERS_TO_REVEAL', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export type BookOutcome = {
  epoch: number;
  pair: number;
  orders: number;
  /** decrypted by the keeper, which holds e.allow on this handle and nothing else */
  residual: bigint | null;
  matched: bigint | null;
  revealed: boolean;
  /** what happened to the residual — on a chain without Avantis, it goes unfilled */
  disposition: 'unfilled' | 'routed';
};

/** In-memory record of what the loop has done. Served by /api/epochs for the UI and for a demo
 *  operator who wants to see the last netting without reading logs. */
export const outcomes: BookOutcome[] = [];

/* A closed epoch stays `currentEpoch` until somebody submits — epochs roll on a submit, not a
   clock — so the loop revisits it every tick forever. Without this it re-decrypts and re-appends
   the same book each time, and /api/epochs fills with duplicates of one netting. */
const recorded = new Set<string>();

const pub = createPublicClient({ chain: CHAIN, transport: http() });

function keeper() {
  if (!KEY) return null;
  try {
    const account = privateKeyToAccount(KEY);
    return { account, wallet: createWalletClient({ account, chain: CHAIN, transport: http() }) };
  } catch {
    return null;
  }
}

/** Highest epoch fully processed, so a restart does not re-walk the whole history every tick. */
let watermark = 0n;

export async function tick(): Promise<void> {
  if (!CONTRACT) { console.warn('[keeper] INCOGNITO_CONTRACT not set — nothing to do'); return; }
  const k = keeper();
  if (!k) { console.warn('[keeper] no KEEPER_KEY/OMNIBUS_KEY — cannot net'); return; }

  const current = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentEpoch' });
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (let id = watermark + 1n; id <= current; id++) {
    const ep = (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochs', args: [id] })) as any;
    const closesAt = BigInt(ep[1]);
    const orderCount = BigInt(ep[2]);
    let netted = Boolean(ep[3]);

    // An epoch with no orders has nothing to net and never will — skip it permanently rather
    // than reporting it as a backlog forever.
    if (orderCount === 0n) {
      if (id < current) watermark = id;
      continue;
    }
    if (!netted && now < closesAt) {
      console.log(`[keeper] epoch #${id} still open (${closesAt - now}s left)`);
      break;                      // later epochs cannot be closed if this one is not
    }

    if (!netted) {
      console.log(`[keeper] netting epoch #${id} — ${orderCount} orders`);
      const hash = await k.wallet.writeContract({
        address: CONTRACT, abi: ABI, functionName: 'netEpoch', args: [id], chain: CHAIN, account: k.account,
      });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`[keeper]   netted  ${hash}`);
      netted = true;
    }

    // Publish the aggregates. The contract skips markets under MIN_ORDERS_TO_REVEAL by itself,
    // so this is safe to call even when some books are too thin — it is not all-or-nothing.
    const markets = (await pub.readContract({
      address: CONTRACT, abi: ABI, functionName: 'marketsInEpoch', args: [id],
    })) as readonly number[];

    const anyUnrevealed = await Promise.all(markets.map(async (p) => {
      const st = (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bookStatus', args: [id, p] })) as any;
      return !st[2] && BigInt(st[0]) >= 5n;
    }));
    if (anyUnrevealed.some(Boolean)) {
      const hash = await k.wallet.writeContract({
        address: CONTRACT, abi: ABI, functionName: 'revealAggregate', args: [id], chain: CHAIN, account: k.account,
      });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`[keeper]   revealed ${hash}`);
    }

    for (const pair of markets) {
      const st = (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bookStatus', args: [id, pair] })) as any;
      const key = `${id}:${pair}`;
      if (recorded.has(key)) continue;

      const [residualH, sums] = await Promise.all([
        pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bookResidual', args: [id, pair] }),
        pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bookSums', args: [id, pair] }),
      ]);

      let residual: bigint | null = null;
      let matched: bigint | null = null;
      try {
        /* The keeper holds e.allow on the RESIDUAL only — that is the one figure it needs to
           size an outbound order, and the contract grants nothing more. `matched` is read via
           attestedReveal instead, which works only because revealAggregate made it public;
           if the book was too thin to publish, it stays null and the UI shows a dash. */
        const { Lightning } = await import('@inco/lightning-js/lite');
        const zap = process.env.NETWORK === 'mainnet'
          ? await Lightning.baseMainnet()
          : await Lightning.baseSepoliaTestnet();

        const dec = await zap.attestedDecrypt(k.wallet as any, [residualH as Hex]);
        residual = BigInt((dec?.[0] as any)?.plaintext?.value ?? 0);

        /* `matched` is NOT revealed by the contract — revealAggregate publishes sumLongs and
           sumShorts and nothing else. Reveal those and derive it: matched = min(longs, shorts).
           Better than revealing a third handle, because it means anyone can recompute both the
           crossed volume AND the residual from public data and check the keeper's arithmetic. */
        if (st[2]) {
          const rev = await zap.attestedReveal([(sums as any)[0] as Hex, (sums as any)[1] as Hex]);
          const longs = BigInt((rev?.[0] as any)?.plaintext?.value ?? 0);
          const shorts = BigInt((rev?.[1] as any)?.plaintext?.value ?? 0);
          matched = longs < shorts ? longs : shorts;

          // The residual the keeper decrypted must equal max - min from the public totals.
          // A mismatch means it is about to act on a figure the chain does not agree with.
          const expected = (longs > shorts ? longs : shorts) - matched;
          if (residual != null && residual !== expected) {
            console.error(`[keeper]   RESIDUAL MISMATCH pair ${pair}: decrypted ${residual}, public math says ${expected}`);
            residual = null;
          }
        }
      } catch (err: any) {
        console.warn(`[keeper]   decrypt failed for pair ${pair}:`, err?.shortMessage ?? err?.message);
      }

      /* THE RESIDUAL'S FATE.
         Avantis is Base MAINNET ONLY — there is no testnet deployment, verified against its own
         tx-builder, which answers chainId 8453 on both hosts. So on Sepolia nothing can be
         routed, and the honest outcome is the one the ticket already offers as its default: the
         unmatched remainder goes UNFILLED. Not refunded — nothing was escrowed. */
      const disposition: BookOutcome['disposition'] = 'unfilled';

      recorded.add(key);
      outcomes.push({
        epoch: Number(id), pair, orders: Number(st[0]),
        residual, matched, revealed: Boolean(st[2]), disposition,
      });

      const fmt = (v: bigint | null) => (v == null ? '—' : `$${v.toLocaleString()}`);
      console.log(
        `[keeper]   pair ${pair}: ${st[0]} orders · crossed ${fmt(matched)} · residual ${fmt(residual)} → ${disposition}`
      );
    }

    if (id < current) watermark = id;
  }
}

export async function keeperStatus() {
  const k = keeper();
  if (!k) return { configured: false as const };
  try {
    const bal = await pub.getBalance({ address: k.account.address });
    return {
      configured: true as const,
      address: k.account.address,
      balance: formatEther(bal),
      contract: CONTRACT,
      processed: outcomes.length,
    };
  } catch {
    return { configured: true as const, address: k.account.address, contract: CONTRACT };
  }
}
