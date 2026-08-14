/* Reading contract logs from a public RPC without tripping its range cap.
 *
 * Base's public endpoint answers `eth_getLogs is limited to a 10,000 range` with HTTP 413.
 * viem surfaces that as a generic "RPC Request failed", which is what the sealed-orders panel
 * was showing instead of a trader's own history — a query problem wearing the costume of a
 * network problem.
 *
 * Two rules here, both learned the same way:
 *   · never ask for more than the cap in one call — chunk instead,
 *   · never start from `latest - N`. Start from the block the contract was DEPLOYED at, so the
 *     history stays complete as the chain moves on. A rolling window silently loses the
 *     earliest orders the moment the chain outruns it, and nothing looks wrong.
 */
/** The public Base RPC's hard limit. Chunks are sized just under it. */
const MAX_RANGE = 9_000n;

/** Block HenceIncognito was deployed at on Base Sepolia — the true start of all history.
 *  Override per-network via VITE_CONTRACT_BLOCK when the contract moves. */
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_CONTRACT_BLOCK ?? '45481692');

/**
 * getLogs across an arbitrary range, in cap-sized chunks, oldest first.
 *
 * Chunks run sequentially rather than in parallel: the same endpoint that rate-limits by range
 * also rate-limits by request, and a burst of parallel chunks trades one 413 for a 429.
 */
export async function getLogsChunked(
  /* Deliberately loose: viem's PublicClient is generic over its chain, and a client built for
     baseSepolia is not assignable to the bare PublicClient type. Narrowing it here buys nothing
     — the two calls this helper makes exist on every client. */
  client: any,
  params: { address: `0x${string}`; event: any; args?: any },
  fromBlock?: bigint,
): Promise<any[]> {
  const latest = await client.getBlockNumber();
  let from = fromBlock ?? DEPLOY_BLOCK;
  if (from > latest) return [];

  const out: any[] = [];
  while (from <= latest) {
    const to = from + MAX_RANGE > latest ? latest : from + MAX_RANGE;
    const logs = await client.getLogs({ ...params, fromBlock: from, toBlock: to } as any);
    out.push(...logs);
    from = to + 1n;
  }
  return out;
}
