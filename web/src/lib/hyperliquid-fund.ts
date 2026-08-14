/* =========================================================
   Hyperliquid funding — deposit native USDC from the user's Arbitrum wallet
   into their Hyperliquid perps account.

   Hyperliquid credits a plain ERC-20 transfer of NATIVE Arbitrum USDC to its
   Bridge2 contract, to the account that sent it, in ~1 minute. There is no
   custom deposit method — it is literally `USDC.transfer(Bridge2, amount)`.

   VERIFIED 2026-07-13 against Arbiscan (contract label "Hyperliquid: Deposit
   Bridge 2") + the HL Bridge2 gitbook:
     - Bridge2            0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7  (Arbitrum One)
     - native USDC        0xaf88d065e77c8cC2239327C5EDb3A432268e5831  (NOT USDC.e)
     - minimum deposit    5 USDC   (smaller transfers are NOT credited)
   The wallet needs a little ETH on Arbitrum for gas. Keys never leave the browser —
   the Privy wallet signs the transfer via viem.
   ========================================================= */
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseUnits, formatUnits, type Hex, type WalletClient } from 'viem';
import { arbitrum } from 'viem/chains';

export const HL_BRIDGE2 = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7' as Hex;   // Arbitrum One deposit bridge
export const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex; // native USDC (NOT USDC.e)
export const HL_MIN_DEPOSIT = 5;   // USD — Hyperliquid forfeits smaller deposits
const ARB_CHAIN_HEX = '0xa4b1';    // 42161

const ERC20_ABI = [
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const pub = () => createPublicClient({ chain: arbitrum, transport: http() });

// Read the wallet's native-USDC balance on Arbitrum (in USD). 0 on any failure.
export async function arbUsdcBalance(address: string): Promise<number> {
  try {
    const bal = await pub().readContract({ address: USDC_ARBITRUM, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Hex] }) as bigint;
    return Number(formatUnits(bal, 6));
  } catch { return 0; }
}

// Read the wallet's native ETH balance on Arbitrum (for the gas check).
export async function arbEthBalance(address: string): Promise<number> {
  try {
    const bal = await pub().getBalance({ address: address as Hex });
    return Number(formatUnits(bal, 18));
  } catch { return 0; }
}

// Ensure the Privy wallet is on Arbitrum One. Required before ANY HL user-signed action
// (deposit transfer, withdraw3, usdClassTransfer): external wallets reject eth_signTypedData_v4
// unless domain.chainId (0xa4b1) matches the connected chain. Returns the wallet's provider.
export async function ensureArbitrum(privyWallet: any): Promise<any> {
  const provider = await privyWallet.getEthereumProvider();
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARB_CHAIN_HEX }] });
  } catch (err: any) {
    if (err?.code === 4902 || /unrecognized chain|not been added/i.test(err?.message || '')) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARB_CHAIN_HEX, chainName: 'Arbitrum One',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'],
        }],
      });
    } else if (err?.code === 4001) {
      throw new Error('You declined switching to Arbitrum.');
    } else { throw err; }
  }
  return provider;
}

// Ensure the Privy wallet is on Arbitrum One, then return a viem WalletClient for it.
async function walletOnArbitrum(privyWallet: any, address: string): Promise<WalletClient> {
  const provider = await ensureArbitrum(privyWallet);
  return createWalletClient({ account: address as Hex, chain: arbitrum, transport: custom(provider) });
}

export type DepositResult = { ok: true; hash: Hex } | { ok: false; error: string };

// Deposit `amountUsd` native USDC from the connected Arbitrum wallet into Hyperliquid
// (transfer to Bridge2). Guards the 5-USDC minimum + insufficient balance BEFORE signing.
export async function depositToHl(privyWallet: any, address: string, amountUsd: number): Promise<DepositResult> {
  try {
    if (!privyWallet || !address) return { ok: false, error: 'No wallet connected.' };
    if (!Number.isFinite(amountUsd) || amountUsd < HL_MIN_DEPOSIT) return { ok: false, error: `Minimum Hyperliquid deposit is ${HL_MIN_DEPOSIT} USDC.` };
    const bal = await arbUsdcBalance(address);
    if (bal + 1e-6 < amountUsd) return { ok: false, error: `Not enough native USDC on Arbitrum (have ${bal.toFixed(2)}, need ${amountUsd}).` };
    const wallet = await walletOnArbitrum(privyWallet, address);
    const amt = parseUnits(amountUsd.toFixed(6), 6);
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [HL_BRIDGE2, amt] });
    const hash = await wallet.sendTransaction({ account: address as Hex, chain: arbitrum, to: USDC_ARBITRUM, data } as any);
    // resolve on submission; wait for inclusion so the caller can poll HL for the credit
    await pub().waitForTransactionReceipt({ hash }).catch(() => {});
    return { ok: true, hash };
  } catch (e: any) {
    if (e?.code === 4001) return { ok: false, error: 'You declined the deposit transaction.' };
    return { ok: false, error: e?.shortMessage || e?.message || 'Deposit failed.' };
  }
}
