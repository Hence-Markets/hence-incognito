import { useCallback } from 'react';
import { createWalletClient, custom, type Hex } from 'viem';
import { useAuth } from './useAuth';
import type { SignTypedDataFn } from '../lib/hyperliquid-sign';

// Bridges the Privy embedded (or external) wallet to a viem signTypedData callback,
// so Hyperliquid L1 actions are signed in the browser — keys never leave the device.
export function useHlSigner() {
  const auth = useAuth();
  const wallet: any = auth.wallet;
  const address = auth.address;
  const ready = !!(auth.authenticated && wallet && address);

  const sign = useCallback<SignTypedDataFn>(async (td) => {
    if (!wallet || !address) throw new Error('No wallet connected');
    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({ account: address as Hex, transport: custom(provider) });
    return client.signTypedData({
      account: address as Hex,
      domain: td.domain as any,
      types: td.types as any,
      primaryType: td.primaryType as any,
      message: td.message as any,
    });
  }, [wallet, address]);

  return { ready, address, sign: ready ? sign : null };
}
