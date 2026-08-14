/* =========================================================
   funding.ts — the Hence Wallet funding catalog + QR helper.

   One embedded wallet address (Privy) serves every EVM venue Hence touches; the
   difference is which chain + stablecoin the funds land on. Privy's universal deposit
   addresses bridge ANY source asset/chain into the chosen destination token, and the
   fiat onramp buys crypto straight into the same wallet — both keyed off this catalog.

   Chains are ordered by where they feed: Base (cheapest, general), Arbitrum (Hyperliquid
   USDC bridge), Polygon (Polymarket USDC.e). Token addresses are the real mainnet
   contracts; the Polygon one matches lib/polymarket-trade.ts's USDC.e so a deposit there
   flows straight into the existing pUSD wrap → trade path.
   ========================================================= */
import QRCode from 'qrcode';

export type FundChain = {
  id: string;
  caip2: `${string}:${string}`;   // CAIP-2 id Privy's deposit/onramp hooks expect
  label: string;
  token: string;                  // destination token contract on that chain
  tokenLabel: string;
  feeds: string;                  // which Hence venue this chain funds (shown in the UI)
  recommended?: boolean;
};

export const FUND_CHAINS: FundChain[] = [
  { id: 'base', caip2: 'eip155:8453', label: 'Base', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', tokenLabel: 'USDC', feeds: 'Lowest fees · general balance', recommended: true },
  { id: 'arbitrum', caip2: 'eip155:42161', label: 'Arbitrum', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', tokenLabel: 'USDC', feeds: 'Funds Hyperliquid' },
  { id: 'polygon', caip2: 'eip155:137', label: 'Polygon', token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', tokenLabel: 'USDC.e', feeds: 'Funds Polymarket' },
];

export const chainById = (id: string) => FUND_CHAINS.find((c) => c.id === id) || FUND_CHAINS[0];

// dark-on-white PNG data URL for an <img>. White quiet-zone so it scans on the dark theme.
export async function qrDataUrl(text: string, size = 168): Promise<string> {
  try {
    return await QRCode.toDataURL(String(text || ''), {
      width: size, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#0a0a0b', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}
