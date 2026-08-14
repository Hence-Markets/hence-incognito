/* The omnibus funder — gives a freshly created shielded wallet enough to transact.
 *
 * WHY THIS IS SERVER-SIDE AND NOT IN THE BROWSER, which is the whole point:
 *
 * A shielded wallet is useless with a zero balance — every order costs Inco's fee
 * (1e12 wei) plus gas. So something has to fund it. If the WEB APP did that, the omnibus
 * private key would have to be in the client bundle, where every user could read it and drain
 * it. There is no version of client-side funding that is safe. The browser may only ASK.
 *
 * AND IT IS ALSO THE ANONYMITY SET. Funding each shielded wallet from the user's OWN wallet
 * would defeat the entire product: anyone could follow the transfer and link the two addresses
 * in seconds. Funding every shielded wallet from ONE shared omnibus is what breaks that link —
 * the crowd you blend into is everyone else this funder has paid.
 *
 * Which means the guards below are not bureaucracy. A funder that pays anyone, repeatedly, is
 * a faucet that drains; one that pays from the wrong source is a deanonymiser.
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { isAllowed } from './access.js';

const CHAIN = process.env.NETWORK === 'mainnet' ? base : baseSepolia;

/** One order costs the Inco fee (1e12 wei) plus gas. This is deliberately small — enough for
 *  a handful of orders, not a balance worth stealing. Top-ups are cheap; a fat hot wallet is not. */
const GRANT = parseEther(process.env.FUND_GRANT_ETH || '0.002');

/** Do not top up a wallet that already has enough. Without this, repeated calls drain the
 *  omnibus one grant at a time and nothing in the flow looks wrong. */
const TOP_UP_BELOW = parseEther(process.env.FUND_TOPUP_BELOW_ETH || '0.0005');

/** Hard ceiling on everything this process will ever pay out, across all wallets. The omnibus
 *  should hold only the campaign budget, but a cap means a bug cannot spend even that. */
const TOTAL_BUDGET = parseEther(process.env.FUND_TOTAL_BUDGET_ETH || '0.05');

let spent = 0n;

export type FundResult =
  | { ok: true; txHash: string; amount: string; reason?: never }
  | { ok: false; reason: string; txHash?: never };

const key = () => (process.env.OMNIBUS_KEY || '').trim();

export function funderAddress(): string | null {
  const k = key();
  if (!k) return null;
  try {
    return privateKeyToAccount(k as Hex).address;
  } catch {
    return null;
  }
}

/**
 * Fund a shielded address, once, if it needs it.
 *
 * Deliberately does NOT take an amount from the caller — the browser asking for money must
 * never get to say how much.
 */
export async function fundShielded(address: string): Promise<FundResult> {
  const k = key();
  if (!k) return { ok: false, reason: 'Funding is not configured' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, reason: 'Not an address' };

  // The cohort gate again, server-side. The web app checks it too, but that check is a
  // courtesy — this one is the one that holds, because it is the one guarding money.
  if (!isAllowed(address)) {
    // NOTE: this asks whether the SHIELDED address is in the cohort, which it will not be —
    // a shielded wallet is by definition not the identity wallet. Until the funder can verify
    // the requester's Privy token and check THEIR identity address, funding stays off. Opening
    // it without that check makes this an open faucet.
    return { ok: false, reason: 'Not eligible for funding' };
  }

  if (spent + GRANT > TOTAL_BUDGET) {
    return { ok: false, reason: 'Funding budget exhausted' };
  }

  const account = privateKeyToAccount(k as Hex);
  const pub = createPublicClient({ chain: CHAIN, transport: http() });

  const [balance, funderBal] = await Promise.all([
    pub.getBalance({ address: address as Hex }),
    pub.getBalance({ address: account.address }),
  ]);

  if (balance >= TOP_UP_BELOW) {
    return { ok: false, reason: `Already funded (${formatEther(balance)} ETH)` };
  }
  if (funderBal < GRANT) {
    return { ok: false, reason: `Omnibus is empty (${formatEther(funderBal)} ETH)` };
  }

  const wallet = createWalletClient({ account, chain: CHAIN, transport: http() });
  const txHash = await wallet.sendTransaction({ to: address as Hex, value: GRANT });
  spent += GRANT;

  return { ok: true, txHash, amount: formatEther(GRANT) };
}

/** For /api/health — never returns the key, only whether one is present and what it holds. */
export async function funderStatus() {
  const addr = funderAddress();
  if (!addr) return { configured: false as const };
  try {
    const pub = createPublicClient({ chain: CHAIN, transport: http() });
    const bal = await pub.getBalance({ address: addr as Hex });
    return {
      configured: true as const,
      address: addr,
      balance: formatEther(bal),
      spent: formatEther(spent),
      budget: formatEther(TOTAL_BUDGET),
    };
  } catch {
    return { configured: true as const, address: addr, balance: 'unknown' };
  }
}
