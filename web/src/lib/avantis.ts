/* Avantis — the execution venue.
 *
 * VERIFIED 2026-08-15 against the live tx-builder, not from a research pass. Every address
 * below came from `GET /v2/meta` on mainnet; the two the earlier research had guessed
 * (tradingRouter, tradingStorage) matched, and the other nine are new.
 *
 * The published SDK is PYTHON ONLY (`avantis_trader_sdk`), which a browser cannot use and our
 * Node keeper should not have to shell out to. It does not matter: the SDK is a wrapper over a
 * plain HTTP API, and that API is the integration surface. Three steps, no SDK required:
 *
 *   1. BUILD    GET/POST /v2/intents/{action}  → { domain, types, primaryType, message, digest }
 *   2. SIGN     recompute the digest locally, verify it matches, sign 65 bytes r||s||v
 *   3. SUBMIT   POST to the relayer (gasless), or self-broadcast /v2/trade/{action} calldata
 *
 * ALWAYS recompute the digest before signing. The endpoint hands you both the typed data and
 * its digest; signing the returned digest without checking it against the message would mean
 * signing whatever the server felt like sending.
 */

export const AVANTIS_CHAIN_ID = 8453; // Base mainnet

export const AVANTIS_TX_BUILDER = {
  mainnet: 'https://tx-builder.avantisfi.com',
  testnet: 'https://tx-builder-testnet.avantisfi.com',
} as const;

/** From GET /v2/meta — do not hardcode elsewhere, and re-read if the venue upgrades. */
export const AVANTIS_ADDRESSES = {
  tradingRouter: '0x44914408af82bC9983bbb330e3578E1105e11d4e',
  tradingStorage: '0x8a311D7048c35985aa31C131B9A13e03a5f7422d',
  pairStorage: '0x5db3772136e5557EFE028Db05EE95C84D76faEC4',
  pairInfos: '0x81F22d0Cc22977c91bEfE648C9fddf1f2bd977e5',
  priceAggregator: '0x64e2625621970F8cfA17B294670d61CB883dA511',
  multicall: '0xA7cFc43872F4D7B0E6141ee8c36f1F7FEe5d099e',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  /** Builder/partner attribution lives here — the monetisation hook, still unregistered. */
  referral: '0x1A110bBA13A1f16cCa4b79758BD39290f29De82D',
  tranche: '0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9',
  execute: '0xdbDd7B8a8747904f53eb7AEF655a6FF81e2c306a',
  vaultManager: '0xe9fB8C70aF1b99F2Baaa07Aa926FCf3d237348DD',
} as const;

export type AvantisPair = {
  index: number;
  from: string;
  to: string;
  symbol: string;
  groupIndex: number;
  isPairListed: boolean;
  closeOnly: boolean;
  leverages?: unknown;
};

const base = () =>
  import.meta.env.VITE_NETWORK === 'mainnet' ? AVANTIS_TX_BUILDER.mainnet : AVANTIS_TX_BUILDER.testnet;

/**
 * The tradable universe — 118 pairs on mainnet as of 2026-08-15: crypto majors (BTC/ETH/SOL),
 * FX (EUR/USD, USD/JPY, GBP/USD), and Avantis' own *_UPSIDE perps.
 *
 * This is what the terminal may offer. The forked terminal currently lists the HYPERLIQUID
 * universe, which is wrong for Incognito: it will happily show a symbol Avantis cannot fill.
 * Narrowing to this set is the next piece of work.
 */
export async function fetchPairs(): Promise<AvantisPair[]> {
  const r = await fetch(`${base()}/v2/pairs`);
  if (!r.ok) throw new Error(`Avantis /v2/pairs → ${r.status}`);
  const j = await r.json();
  const rows = (j?.data ?? j) as AvantisPair[] | Record<string, AvantisPair>;
  const list = Array.isArray(rows) ? rows : Object.values(rows);
  // closeOnly pairs can be exited but not opened — offering one as an entry is a dead end.
  return list.filter((p) => p.isPairListed && !p.closeOnly);
}

/** Metadata: chainId, addresses, EIP-712 domains, enums, unit conventions. */
export async function fetchMeta(): Promise<any> {
  const r = await fetch(`${base()}/v2/meta`);
  if (!r.ok) throw new Error(`Avantis /v2/meta → ${r.status}`);
  const j = await r.json();
  return j?.data ?? j;
}
