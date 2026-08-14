/* The bottom panel: your own sealed orders.
 *
 * WHAT THIS REPLACES: the forked panel's tabs were Balances, Positions, Predictions, Open
 * Orders, Trade History, Order History and Bots — every one of them a read of the user's
 * Hyperliquid clearinghouse. An incognito order posts no collateral, opens no position and
 * rests on no book, so all seven were permanently empty or, worse, populated with a different
 * venue's data under a bar that says "Sealed orders".
 *
 * What belongs here is the only history this app creates: the orders this shielded address has
 * sealed, and what happened to them at each epoch close.
 *
 * SIZES ARE NOT SHOWN, and that is not an omission. They are encrypted on chain; only the
 * trader can decrypt their own, via `myOrderSize`, and doing so needs an attested decrypt the
 * browser cannot perform today. Rendering a size we do not have — even the one the user typed a
 * minute ago — would make this panel a local memory dressed as chain state, and the moment it
 * disagreed with the chain nobody would know which was wrong.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { MARKETS } from '../lib/markets';

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';
const CHAIN = IS_MAINNET ? base : baseSepolia;
const CONTRACT = (import.meta.env.VITE_INCOGNITO_CONTRACT ?? '').trim() as Address | '';
const SCAN = IS_MAINNET ? 'https://basescan.org' : 'https://sepolia.basescan.org';

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

const BOOK_STATUS = {
  type: 'function',
  name: 'bookStatus',
  stateMutability: 'view',
  inputs: [{ name: 'epId', type: 'uint64' }, { name: 'pair', type: 'uint16' }],
  outputs: [{ name: 'count', type: 'uint256' }, { name: 'netted', type: 'bool' }, { name: 'revealed', type: 'bool' }],
} as const;

type Row = {
  epoch: number;
  pair: number;
  side: 'Long' | 'Short';
  route: boolean;
  txHash: string;
  netted: boolean;
};

const symOf = (pair: number) => MARKETS.find((m) => m.pair === pair)?.sym ?? `#${pair}`;

export default function SealedOrders({ shieldedAddress, currentEpoch }: {
  shieldedAddress: string | null;
  currentEpoch: number | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!CONTRACT || !shieldedAddress) { setRows([]); return; }
    let alive = true;
    const pub = createPublicClient({ chain: CHAIN, transport: http() });

    const read = async () => {
      try {
        const latest = await pub.getBlockNumber();
        // Public RPCs cap log ranges; ~50k blocks is roughly a day on Base, which is more
        // history than a demo needs and short enough to be served in one call.
        const from = latest > 50_000n ? latest - 50_000n : 0n;
        const logs = await pub.getLogs({
          address: CONTRACT,
          event: ORDER_SUBMITTED,
          args: { trader: shieldedAddress as Address },
          fromBlock: from,
          toBlock: latest,
        });

        // One bookStatus per (epoch, pair) actually present, not per row — a trader with six
        // orders in one epoch would otherwise make six identical calls.
        const keys = [...new Set(logs.map((l: any) => `${l.args.epoch}:${l.args.pair}`))];
        const netted = new Map<string, boolean>();
        await Promise.all(keys.map(async (k) => {
          const [ep, pr] = k.split(':');
          try {
            const st = (await pub.readContract({
              address: CONTRACT, abi: [BOOK_STATUS], functionName: 'bookStatus',
              args: [BigInt(ep), Number(pr)],
            })) as any;
            netted.set(k, Boolean(st[1]));
          } catch { netted.set(k, false); }
        }));

        if (!alive) return;
        setRows(
          logs
            .map((l: any): Row => ({
              epoch: Number(l.args.epoch),
              pair: Number(l.args.pair),
              side: Number(l.args.side) === 0 ? 'Long' : 'Short',
              route: Boolean(l.args.routeResidual),
              txHash: l.transactionHash,
              netted: netted.get(`${l.args.epoch}:${l.args.pair}`) ?? false,
            }))
            .reverse()      // newest first
        );
        setErr(null);
      } catch (e: any) {
        if (alive) { setErr(e?.shortMessage ?? 'Could not read your sealed orders'); setRows(null); }
      }
    };

    read();
    const t = setInterval(read, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [shieldedAddress]);

  if (!CONTRACT) {
    return <div className="term__book-empty">Incognito contract not configured — nothing can be sealed yet.</div>;
  }
  if (!shieldedAddress) {
    return <div className="term__book-empty">Your sealed orders appear here once a shielded account exists.</div>;
  }
  if (err) return <div className="term__book-empty">{err}</div>;
  if (rows == null) return <div className="term__book-empty">Reading the chain…</div>;
  if (!rows.length) {
    return <div className="term__book-empty">No orders sealed yet. Yours will appear here, with sizes still encrypted.</div>;
  }

  return (
    <table className="term__tbl term__tbl--sealed">
      <thead>
        <tr>
          <th>Epoch</th><th>Market</th><th>Side</th><th>Size</th>
          <th>If unmatched</th><th>Status</th><th>Tx</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.txHash + r.epoch}>
            <td>#{r.epoch}</td>
            <td>{symOf(r.pair)}</td>
            <td className={r.side === 'Long' ? 'up' : 'down'}>{r.side}</td>
            {/* Encrypted, and only the trader can decrypt it — via an attestation this browser
                cannot fetch yet. Showing the typed value instead would be a local memory
                pretending to be chain state. */}
            <td className="sealed__redact" title="Encrypted on chain — only you can decrypt it">•••••</td>
            <td>{r.route ? 'Route to Avantis' : 'Return unfilled'}</td>
            <td>
              {r.epoch === currentEpoch ? 'Sealed · open epoch'
                : r.netted ? 'Netted'
                  : 'Awaiting keeper'}
            </td>
            <td>
              <a href={`${SCAN}/tx/${r.txHash}`} target="_blank" rel="noreferrer">
                {r.txHash.slice(0, 8)}…
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
