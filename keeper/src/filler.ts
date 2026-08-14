/* Background flow, so an epoch is never empty when someone walks up to it.
 *
 * THE PROBLEM IT SOLVES. `matched = min(longs, shorts)` is zero until real orders exist on both
 * sides of the same market. A tester who places one order alone sees a crossing engine crossing
 * nothing — a truthful picture of an empty venue and a useless picture of the product. This
 * keeps a thin two-sided book alive so the next person to arrive has something to cross with.
 *
 * IT IS NOT FAKE VOLUME, AND THE DISTINCTION IS WORTH HOLDING. Each order is a real transaction
 * from a real wallet, encrypted the same way a user's is, netted by the same contract. What is
 * synthetic is only WHOSE it is: one operator controls all of them. That is disclosable in one
 * sentence, and it must actually be disclosed — /api/health reports `filler.active` for exactly
 * that reason. Wash-trading language is deserved the moment we let anyone believe otherwise.
 *
 * OFF BY DEFAULT. It spends real gas on a schedule with no human watching, which is precisely
 * the kind of thing that should require someone to say yes.
 */
import {
  createWalletClient, createPublicClient, http, parseEther, formatEther,
  encodeFunctionData, type Hex, type Address,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const CHAIN = process.env.NETWORK === 'mainnet' ? base : baseSepolia;
const CONTRACT = (process.env.INCOGNITO_CONTRACT || '').trim() as Address;
const KEY = ((process.env.FILLER_KEY || process.env.OMNIBUS_KEY || '').trim()) as Hex;
const INCO = '0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624' as const;

/** Off unless someone deliberately turns it on. */
export const FILLER_ON = process.env.FILLER_ENABLED === '1';

/** MAINNET REFUSAL, not a warning. On Base this would spend real USDC against real positions
 *  on a public venue, on a timer, unattended. There is no version of that we want by accident. */
const MAINNET = process.env.NETWORK === 'mainnet';

/** Orders per round. Small: the point is a live book, not a busy one, and every order costs gas.
 *  Kept above the reveal floor across two rounds so an epoch can still publish its aggregate. */
const PER_ROUND = Math.max(2, Math.min(8, Number(process.env.FILLER_ORDERS ?? 4)));

/** Which markets to keep alive. Spreading thin flow across three books crosses nothing in any
 *  of them, so this defaults to ONE — the same reason lib/markets.ts narrows to three. */
const PAIRS = (process.env.FILLER_PAIRS ?? '1').split(',').map((n) => Number(n.trim()));

/** Gas per throwaway wallet, and a hard ceiling on everything this will ever spend. */
const PER_WALLET = parseEther(process.env.FILLER_GAS_ETH || '0.0008');
const BUDGET = parseEther(process.env.FILLER_BUDGET_ETH || '0.01');

const ABI = [
  {
    type: 'function', name: 'submitOrder', stateMutability: 'payable',
    inputs: [
      { name: 'encryptedSize', type: 'bytes' }, { name: 'side', type: 'uint8' },
      { name: 'pair', type: 'uint16' }, { name: 'routeResidual', type: 'bool' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'orderCountIn', stateMutability: 'view',
    inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'epochs', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [
      { name: 'id', type: 'uint64' }, { name: 'closesAt', type: 'uint64' },
      { name: 'orderCount', type: 'uint256' }, { name: 'netted', type: 'bool' },
    ],
  },
] as const;
const FEE_ABI = [
  { type: 'function', name: 'getFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

let spent = 0n;
let rounds = 0;
let lastEpochFilled = 0n;

export function fillerStatus() {
  return {
    active: FILLER_ON && !MAINNET,
    rounds,
    spent: formatEther(spent),
    budget: formatEther(BUDGET),
    /* Said plainly in the API, because anything that generates flow has to be inspectable.
       A viewer who finds this string has been told the truth without having to ask. */
    note: 'Background orders are real transactions from wallets one operator controls.',
  };
}

/* Sizes vary so the book does not look mechanical, and lean slightly imbalanced so there is a
   residual to talk about. No randomness source: Math.random is banned in some of our runtimes
   and, more usefully, a deterministic walk is reproducible when a demo misbehaves. */
const SIZES = [3200, 1800, 4500, 2600, 5100, 1400, 3900, 2200];
const sizeAt = (n: number) => SIZES[n % SIZES.length];

export async function fillerTick(): Promise<void> {
  if (!FILLER_ON) return;
  if (MAINNET) {
    console.warn('[filler] refusing to run on mainnet — this spends real money unattended');
    return;
  }
  if (!CONTRACT || !KEY) { console.warn('[filler] not configured'); return; }
  if (spent >= BUDGET) return;                         // silent once exhausted; logged below once

  const pub = createPublicClient({ chain: CHAIN, transport: http() });
  const funder = privateKeyToAccount(KEY);
  const funderWallet = createWalletClient({ account: funder, chain: CHAIN, transport: http() });

  const epochId = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentEpoch' });

  /* One round per epoch. Epochs roll on a SUBMIT, not a clock — so a filler that ignored this
     would top up the same open epoch forever, and its own orders would keep it from ever
     rolling into a fresh one. */
  if (epochId === lastEpochFilled) return;

  const ep = (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochs', args: [epochId] })) as any;
  const left = Number(ep[1]) - Math.floor(Date.now() / 1000);

  // Do not start a round that cannot finish inside the window: a split book can leave both
  // halves under the reveal floor, and nothing can merge them afterwards.
  const needed = PER_ROUND * 8 + 10;
  if (left > 0 && left < needed) return;

  const need = PER_WALLET * BigInt(PER_ROUND);
  if (spent + need > BUDGET) {
    console.log(`[filler] budget exhausted (${formatEther(spent)} of ${formatEther(BUDGET)} ETH) — standing down`);
    spent = BUDGET;
    return;
  }
  const bal = await pub.getBalance({ address: funder.address });
  if (bal < need) { console.warn('[filler] funder cannot cover a round'); return; }

  const fee = (await pub.readContract({ address: INCO, abi: FEE_ABI, functionName: 'getFee' })) as bigint;
  const { Lightning } = await import('@inco/lightning-js/lite');
  const zap = await Lightning.baseSepoliaTestnet();

  const pair = PAIRS[rounds % PAIRS.length];
  let nonce = await pub.getTransactionCount({ address: funder.address });
  let placed = 0;

  for (let i = 0; i < PER_ROUND; i++) {
    try {
      const acct = privateKeyToAccount(generatePrivateKey());
      const wallet = createWalletClient({ account: acct, chain: CHAIN, transport: http() });

      const fundTx = await funderWallet.sendTransaction({ to: acct.address, value: PER_WALLET, nonce: nonce++ });
      await pub.waitForTransactionReceipt({ hash: fundTx });
      // The public RPC lags its own receipts; a send routed to a stale node sees an empty
      // account. Wait for the balance to be VISIBLE, not merely mined.
      for (let t = 0; t < 40; t++) {
        if ((await pub.getBalance({ address: acct.address })) >= PER_WALLET) break;
        await new Promise((r) => setTimeout(r, 750));
      }

      const size = sizeAt(rounds * PER_ROUND + i);
      // Alternate sides, then lean the last one long so a residual exists to demonstrate.
      const side = i === PER_ROUND - 1 ? 0 : (i % 2 === 0 ? 0 : 1);

      const ct = await zap.encrypt(BigInt(size), {
        accountAddress: acct.address, dappAddress: CONTRACT, handleType: 8,
      });
      const tx = await wallet.sendTransaction({
        to: CONTRACT,
        data: encodeFunctionData({
          abi: ABI, functionName: 'submitOrder',
          // never routes out: synthetic flow must not reach a public venue, on any chain
          args: [ct as any, side, pair, false],
        }),
        value: fee,
      });
      await pub.waitForTransactionReceipt({ hash: tx });
      spent += PER_WALLET;
      placed++;
    } catch (err: any) {
      // One bad order must not abort the round or kill the keeper loop.
      console.warn('[filler] order failed:', err?.shortMessage ?? err?.message);
    }
  }

  rounds++;
  lastEpochFilled = epochId;
  console.log(`[filler] round ${rounds}: ${placed}/${PER_ROUND} orders into pair ${pair}, epoch #${epochId} · spent ${formatEther(spent)} ETH`);
}
