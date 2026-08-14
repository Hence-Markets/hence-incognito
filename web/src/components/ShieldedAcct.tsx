/* The account rail, in incognito.
 *
 * WHAT THIS REPLACES, and why it had to go: the forked card showed the user's real Hyperliquid
 * account — total equity, margin used, Deposit/Transfer/Withdraw, the connected address with a
 * "Live" badge. All of it accurate, none of it true HERE. Orders on this app do not go to
 * Hyperliquid and are not signed by that address, so the column was answering a question nobody
 * had asked and contradicting the one thing the product claims. Anyone reading a screenshot
 * concluded the trade went to HL from the wallet shown.
 *
 * What belongs here instead is the account that actually executes: the shielded one. It holds
 * gas, it signs, it is the address that will appear on chain. Showing it IS the seatbelt — the
 * spec calls for an executing-address line precisely so a user can see that shielding engaged
 * rather than silently failed open.
 *
 * The identity wallet is deliberately never printed. Not because it would leak — this is the
 * user's own screen — but because a demo screenshot of this column should contain nothing that
 * links the two, and the cheapest way to guarantee that is to never render it.
 *
 * Reuses the term__ac-* classes so it inherits the card's geometry unchanged. Same chrome,
 * different account: that is the whole design language of incognito mode.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, formatEther, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { getLogsChunked } from '../lib/logs';

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';
const CHAIN = IS_MAINNET ? base : baseSepolia;
const CONTRACT = (import.meta.env.VITE_INCOGNITO_CONTRACT ?? '').trim() as Address | '';
const SCAN = IS_MAINNET ? 'https://basescan.org' : 'https://sepolia.basescan.org';

/** Below this an order cannot pay the Inco input fee plus gas, and would revert at the fee
 *  check. Kept in step with useShielded's MIN_BALANCE and the funder's TOP_UP_BELOW — a
 *  threshold above the grant would mark every freshly funded wallet as still needing gas. */
const MIN_GAS = 50_000_000_000_000n;   // 0.00005 ETH — ~14 orders

const ORDER_SUBMITTED = {
  type: 'event',
  name: 'OrderSubmitted',
  inputs: [
    { name: 'epoch', type: 'uint64', indexed: true },
    { name: 'trader', type: 'address', indexed: true },
    { name: 'side', type: 'uint8', indexed: false },
  ],
} as const;

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export default function ShieldedAcct({ which, shielded, epochId, secondsLeft, live }: {
  which: 'desk' | 'mob';
  shielded: {
    address: string | null;
    creating: boolean;
    reason: string | null;
    create: () => Promise<string | null>;
  };
  epochId: number | null;
  secondsLeft: number;
  live: boolean;
}) {
  const addr = shielded.address;
  const [balance, setBalance] = useState<bigint | null>(null);
  const [sealed, setSealed] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  /* Gas balance and this wallet's own sealed count, both read from chain.

     The count comes from OrderSubmitted logs filtered on (epoch, trader) rather than a local
     tally, so it survives a refresh and cannot drift from what actually landed. A local counter
     would show orders that reverted — the one number in this column that must never overstate. */
  useEffect(() => {
    if (!addr) { setBalance(null); setSealed(null); return; }
    let alive = true;
    const pub = createPublicClient({ chain: CHAIN, transport: http() });

    const read = async () => {
      try {
        const bal = await pub.getBalance({ address: addr as Address });
        if (alive) setBalance(bal);
      } catch { /* leave the last known value rather than flashing a zero balance */ }

      if (!CONTRACT || epochId == null) return;
      try {
        const logs = await getLogsChunked(pub, {
          address: CONTRACT,
          event: ORDER_SUBMITTED,
          args: { epoch: BigInt(epochId), trader: addr as Address },
        });
        if (alive) setSealed(logs.length);
      } catch {
        if (alive) setSealed(null);   // unknown renders as —, never as 0
      }
    };

    read();
    const t = setInterval(read, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [addr, epochId]);

  const funded = balance != null && balance >= MIN_GAS;
  const status = !addr ? '' : balance == null ? '' : funded ? 'Ready' : 'Needs gas';

  const copy = () => {
    if (!addr) return;
    void navigator.clipboard?.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

  return (
    <div className={'term__acctcard term__acctcard--' + which}>
      <div className="term__ac-top">
        <div className="term__ac-sel-wrap">
          <button className="term__acct-sel term__ac-sel" onClick={copy} title={addr || undefined}>
            <Icon name="wallet" size={13} />
            <span>{copied ? 'Copied' : 'Shielded account'}</span>
          </button>
        </div>
        <span className={'term__ac-chg' + (funded ? '' : ' is-flat')}>{status}</span>
      </div>

      {/* The executing-address line. This is the seatbelt: it is how a user confirms shielding
          engaged, rather than trusting that it did. */}
      <div className="term__ac-eq">
        <span className="term__ac-eq-l">Executing as</span>
        <b className="term__ac-eq-v term__ac-eq-v--addr">
          {addr ? short(addr) : shielded.creating ? <Skeleton w={90} h={14} /> : 'None yet'}
        </b>
      </div>

      <div className="term__ac-btns term__ac-btns--inc">
        {addr ? (
          <>
            <button className="term__ac-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <a className="term__ac-btn" href={`${SCAN}/address/${addr}`} target="_blank" rel="noreferrer">Explorer</a>
          </>
        ) : (
          <button
            className="term__ac-btn term__ac-btn--pri"
            disabled={shielded.creating}
            onClick={() => void shielded.create()}
          >{shielded.creating ? 'Creating…' : 'Create shielded account'}</button>
        )}
      </div>

      <div className="term__ac-rows">
        <div className="term__ac-row">
          <span>Gas</span>
          <b>{balance == null ? '—' : `${Number(formatEther(balance)).toFixed(4)} ETH`}</b>
        </div>
        <div className="term__ac-row">
          <span>Sealed this epoch</span>
          <b>{sealed == null ? '—' : sealed}</b>
        </div>
        <div className="term__ac-row term__ac-row--sub">
          <span>Epoch{epochId != null ? ` #${epochId}` : ''}</span>
          {/* An epoch past closesAt with nobody to net it is not "0:00" — it is waiting on the
              keeper. Saying so puts the one missing piece of the system on screen instead of
              dressing it as a countdown that finished. */}
          <b>{!live ? '—' : secondsLeft > 0 ? `closes ${mmss(secondsLeft)}` : 'awaiting keeper'}</b>
        </div>
        {/* Collateral is honestly nothing: no order has settled at a venue, so there is no
            position and no margin. A zero here would be a real balance; "—" is the truth. */}
        <div className="term__ac-row term__ac-row--sub">
          <span>Collateral</span><b>—</b>
        </div>

        <div className="term__ac-note">
          {!addr
            ? 'Orders execute from a separate address that is not linked to your wallet.'
            : !funded && balance != null
              ? 'Funded from a shared pool on your first order — never from your own wallet, which would link the two.'
              : 'Your connected wallet never signs here.'}
        </div>
      </div>
    </div>
  );
}
