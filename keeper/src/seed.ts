/* Seed a book, so netting has something to net.
 *
 * WHY THIS EXISTS. `matched = min(longs, shorts)` is zero until real orders arrive on BOTH
 * sides of the SAME market. A demo with one order shows a crossing engine crossing nothing —
 * which is a truthful picture of an empty venue and a useless picture of the product. Every
 * new venue starts by seeding its own book; this is that, written down.
 *
 * WHAT IT IS NOT. These are real orders: real wallets, real encryption, real transactions, real
 * netting. Nothing here is faked. What must be disclosed is only their ORIGIN — one person
 * controls all of them. Pre-seeded is not the same as simulated, and the distinction survives
 * scrutiny only if you volunteer it before anyone asks.
 *
 * TWO CONSTRAINTS THAT DECIDE THE SHAPE OF THIS SCRIPT:
 *
 *  1. ONE MARKET. `MIN_ORDERS_TO_REVEAL` is enforced per market, so ten orders spread across
 *     three markets is three thin books that each refuse to publish. Ten in one market is a
 *     book that reveals.
 *  2. ONE EPOCH. `_rollEpochIfDue()` runs inside `submitOrder`, so a seed that straddles a
 *     close is split in half — and both halves can land under the reveal floor, which cannot
 *     be undone (`netEpoch` is once-only and `currentEpoch` only moves forward). The script
 *     therefore refuses to start when too little of the window remains.
 */
import './env.js';   // MUST be first: the constants below read process.env at module scope
import {
  createWalletClient, createPublicClient, http, parseEther, formatEther,
  encodeFunctionData, type Hex, type Address,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const CHAIN = process.env.NETWORK === 'mainnet' ? base : baseSepolia;
const CONTRACT = (process.env.INCOGNITO_CONTRACT || '').trim() as Address;
const FUNDER_KEY = (process.env.OMNIBUS_KEY || '').trim() as Hex;

/** Inco Lightning — same address on Base and Base Sepolia. */
const INCO = '0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624' as const;

/** Avantis pair indices. ETH is the default because it is the deepest book on the venue and
 *  the one a viewer least questions. Keep every seed order in ONE of these. */
const PAIRS = { ETH: 0, BTC: 1, SOL: 2 } as const;

const PAIR = PAIRS[(process.env.SEED_PAIR || 'ETH') as keyof typeof PAIRS] ?? 0;

/** Gas per seed wallet. One order costs the Inco fee (1e12 wei) plus ~200k gas; this is a few
 *  times that, and deliberately not more — ten funded throwaway keys are ten liabilities. */
const PER_WALLET = parseEther(process.env.SEED_GAS_ETH || '0.0015');

/** Sizes in whole dollars. Deliberately lopsided: a book that nets to exactly zero shows
 *  crossing but hides the residual, and the residual is half the story. */
const LONGS = (process.env.SEED_LONGS || '12000,9500,8000,6200,4400').split(',').map(Number);
const SHORTS = (process.env.SEED_SHORTS || '11000,7300,5500,3700').split(',').map(Number);

const ABI = [
  {
    type: 'function', name: 'submitOrder', stateMutability: 'payable',
    inputs: [
      { name: 'encryptedSize', type: 'bytes' },
      { name: 'side', type: 'uint8' },
      { name: 'pair', type: 'uint16' },
      { name: 'routeResidual', type: 'bool' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'epochs', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [
      { name: 'id', type: 'uint64' }, { name: 'closesAt', type: 'uint64' },
      { name: 'orderCount', type: 'uint256' }, { name: 'netted', type: 'bool' },
    ],
  },
  { type: 'function', name: 'MIN_ORDERS_TO_REVEAL', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'epochSeconds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
] as const;

const INCO_ABI = [
  { type: 'function', name: 'getFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!CONTRACT) throw new Error('INCOGNITO_CONTRACT is not set');
  if (!FUNDER_KEY) throw new Error('OMNIBUS_KEY is not set — the seed wallets need gas from somewhere');

  const pub = createPublicClient({ chain: CHAIN, transport: http() });
  const funder = privateKeyToAccount(FUNDER_KEY);
  const funderWallet = createWalletClient({ account: funder, chain: CHAIN, transport: http() });

  const orders = [
    ...LONGS.map((size) => ({ size, side: 0 as const })),
    ...SHORTS.map((size) => ({ size, side: 1 as const })),
  ];

  const [epochId, fee, floor, epochSeconds] = await Promise.all([
    pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentEpoch' }),
    pub.readContract({ address: INCO, abi: INCO_ABI, functionName: 'getFee' }),
    pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'MIN_ORDERS_TO_REVEAL' }),
    pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochSeconds' }),
  ]);
  const ep = (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'epochs', args: [epochId] })) as any;
  const closesAt = Number(ep[1]);
  const left = closesAt - Math.floor(Date.now() / 1000);

  const longSum = LONGS.reduce((a, b) => a + b, 0);
  const shortSum = SHORTS.reduce((a, b) => a + b, 0);

  console.log(`[seed] contract  ${CONTRACT} on ${CHAIN.name}`);
  console.log(`[seed] market    pair ${PAIR} (${Object.keys(PAIRS).find((k) => PAIRS[k as keyof typeof PAIRS] === PAIR)})`);
  console.log(`[seed] epoch     #${epochId}, ${left}s left, reveal floor ${floor}`);
  console.log(`[seed] book      ${LONGS.length} long ($${longSum.toLocaleString()}) vs ${SHORTS.length} short ($${shortSum.toLocaleString()})`);
  console.log(`[seed] expect    matched $${Math.min(longSum, shortSum).toLocaleString()} · residual $${Math.abs(longSum - shortSum).toLocaleString()}`);

  if (orders.length < Number(floor)) {
    throw new Error(`${orders.length} orders is below the reveal floor of ${floor} — the aggregate would never publish`);
  }

  /* An order takes a couple of seconds: encrypt, fund, submit, confirm. Require comfortable
     headroom rather than "probably enough" — a seed split across an epoch boundary leaves two
     books that may BOTH be under the floor, and nothing can merge them afterwards.

     AN OVERDUE EPOCH IS NOT A PROBLEM, it is the normal resting state. `_rollEpochIfDue()` runs
     INSIDE submitOrder, so with no flow the open epoch sits past its close indefinitely and
     will never roll on its own — telling the operator to "wait for the next epoch" would be
     advice to wait forever. The first order rolls it and opens a full-length window, and every
     order including that one lands in the NEW epoch. So the time we have is the whole window,
     not the negative remainder of a window that expired hours ago. */
  const rollsOnFirstOrder = left <= 0;
  const window = rollsOnFirstOrder ? Number(epochSeconds) : left;
  const needed = orders.length * 8 + 20;

  if (rollsOnFirstOrder) {
    console.log(`[seed] epoch #${epochId} closed ${-left}s ago and only rolls on a submit — the`);
    console.log(`[seed]   first order opens #${Number(epochId) + 1} with a fresh ${epochSeconds}s window; all ${orders.length} land there`);
  }
  if (window < needed) {
    throw new Error(
      `only ${window}s of epoch #${epochId} usable and this needs ~${needed}s. ` +
      `Submit one throwaway order to roll the epoch, then seed into the fresh window.`
    );
  }

  const funderBal = await pub.getBalance({ address: funder.address });
  const totalGas = PER_WALLET * BigInt(orders.length);
  console.log(`[seed] funder    ${funder.address} holds ${formatEther(funderBal)} ETH, needs ${formatEther(totalGas)}`);
  if (funderBal < totalGas) throw new Error('funder cannot cover the seed');

  const { Lightning, handleTypes } = (await import('@inco/lightning-js')) as any;
  const zap = Lightning.latest(process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet');

  const placed: { addr: string; size: number; side: string; tx: string }[] = [];
  /* The epoch the book is being built in — learned from the FIRST order's own log rather than
     assumed, because that order may itself have rolled the epoch. Every later order is checked
     against it: a split book is unrecoverable, so it is worth stopping the moment one starts. */
  let bookEpoch: bigint | null = null;

  for (const [i, o] of orders.entries()) {
    // A fresh key per order. Reusing one address for ten orders would put ten orders in one
    // trader's name on chain — visibly a single participant, which is the opposite of a book.
    const key = generatePrivateKey();
    const acct = privateKeyToAccount(key);
    const wallet = createWalletClient({ account: acct, chain: CHAIN, transport: http() });

    const fundTx = await funderWallet.sendTransaction({ to: acct.address, value: PER_WALLET });
    await pub.waitForTransactionReceipt({ hash: fundTx });

    const ciphertext = await zap.encrypt(BigInt(o.size), {
      accountAddress: acct.address,
      dappAddress: CONTRACT,
      handleType: handleTypes.euint256,
    });

    const tx = await wallet.sendTransaction({
      to: CONTRACT,
      data: encodeFunctionData({
        abi: ABI, functionName: 'submitOrder',
        // routeResidual false: a seeded order must never pretend it intended to reach a public
        // venue. Everything unmatched here goes unfilled, which is what actually happens.
        args: [ciphertext, o.side, PAIR, false],
      }),
      value: fee as bigint,
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: tx });

    // OrderSubmitted(uint64 indexed epoch, address indexed trader, uint16 indexed pair, ...)
    // — topic 1 is the epoch this order actually landed in. Read it rather than polling
    // currentEpoch, which can move between the receipt and the poll.
    const log = rcpt.logs.find((l) => l.address.toLowerCase() === CONTRACT.toLowerCase());
    const landed = log?.topics?.[1] ? BigInt(log.topics[1]) : null;
    if (landed != null) {
      if (bookEpoch == null) bookEpoch = landed;
      else if (landed !== bookEpoch) {
        throw new Error(
          `the epoch rolled mid-seed (#${bookEpoch} → #${landed}) after ${placed.length} orders. ` +
          `The book is split and cannot be merged — re-run to build a clean one in the new epoch.`
        );
      }
    }

    placed.push({ addr: acct.address, size: o.size, side: o.side === 0 ? 'long' : 'short', tx });
    console.log(`[seed] ${String(i + 1).padStart(2)}/${orders.length}  ${o.side === 0 ? 'LONG ' : 'SHORT'} $${String(o.size).padStart(6)}  ${acct.address}  ${tx}`);

    // The private keys are discarded here, deliberately. Any leftover gas is unrecoverable —
    // that is the cost of not keeping ten funded keys lying around after a demo.
    await sleep(300);
  }

  console.log(`\n[seed] done — ${placed.length} orders sealed`);
  console.log(`[seed] all of it landed in epoch #${bookEpoch} — one book, ready to net`);
  console.log(`[seed] disclose this: ${placed.length} orders, ${placed.length} wallets, all controlled by one person.`);
}

main().catch((e) => {
  console.error('[seed] failed:', e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
