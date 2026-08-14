/* =========================================================
   Hyperliquid L1-action signing (browser-side).
   Faithful port of the official SDK's sign_l1_action:
     hash   = keccak256( msgpack(action) ++ nonce(8, BE) ++ vaultFlag [++ expiresAfter] )
     agent  = { source: 'a'|'b', connectionId: hash }
     EIP712 domain { name:'Exchange', version:'1', chainId:1337, verifyingContract:0x0 }
   The order/cancel actions are built with keys in the exact order the
   chain hashes them — object key insertion order is significant here.
   No private keys live in this module; it takes a signTypedData callback
   so the same code signs via a Privy embedded wallet, a viem account, or a test key.
   ========================================================= */
import { encode } from '@msgpack/msgpack';
import { keccak256, parseSignature, toBytes, type Hex } from 'viem';

export type SignTypedDataFn = (td: {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<Hex>;

export type HlSignature = { r: Hex; s: Hex; v: number };

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// keccak256( msgpack(action) ++ nonce(8 BE) ++ vault-flag ++ [expiresAfter] )
export function actionHash(action: unknown, nonce: number, vaultAddress: string | null = null, expiresAfter?: number): Hex {
  const packed = encode(action);
  const parts: Uint8Array[] = [packed];

  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false);
  parts.push(nonceBytes);

  if (vaultAddress == null) {
    parts.push(Uint8Array.of(0x00));
  } else {
    parts.push(Uint8Array.of(0x01), toBytes(vaultAddress as Hex));
  }
  if (expiresAfter != null) {
    const eb = new Uint8Array(8);
    new DataView(eb.buffer).setBigUint64(0, BigInt(expiresAfter), false);
    parts.push(Uint8Array.of(0x00), eb);
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  return keccak256(all);
}

// Sign an L1 (exchange) action — orders, cancels, updateLeverage, etc.
export async function signL1Action(opts: {
  signTypedData: SignTypedDataFn;
  action: unknown;
  nonce: number;
  isMainnet?: boolean;
  vaultAddress?: string | null;
  expiresAfter?: number;
}): Promise<HlSignature> {
  const { signTypedData, action, nonce, isMainnet = true, vaultAddress = null, expiresAfter } = opts;
  const connectionId = actionHash(action, nonce, vaultAddress, expiresAfter);
  const sigHex = await signTypedData({
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO_ADDR },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: isMainnet ? 'a' : 'b', connectionId },
  });
  const parsed = parseSignature(sigHex);
  return { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)) };
}

/* ---------------- order wire formatting ---------------- */

// HL requires normalized decimal strings: no trailing zeros, no scientific notation, "0" not "-0".
export function floatToWire(x: number): string {
  const rounded = x.toFixed(8);
  let s = rounded;
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

// size → szDecimals places
export function roundSize(size: number, szDecimals: number): number {
  const f = Math.pow(10, szDecimals);
  return Math.round(size * f) / f;
}

// price → ≤5 significant figures and ≤ (MAX_DECIMALS - szDecimals) decimals; integers always allowed
export function roundPrice(px: number, szDecimals: number, isPerp = true): number {
  if (Number.isInteger(px)) return px;
  const maxDecimals = (isPerp ? 6 : 8) - szDecimals;
  const sig = Number(px.toPrecision(5));
  const factor = Math.pow(10, Math.max(0, maxDecimals));
  return Math.round(sig * factor) / factor;
}

export type OrderInput = {
  assetIndex: number;
  isBuy: boolean;
  price: number;
  size: number;
  reduceOnly?: boolean;
  tif?: 'Gtc' | 'Ioc' | 'Alo';
  // trigger order (TP/SL). When set, `price` becomes the post-trigger limit cap
  // (slippage protection for isMarket triggers) and `t` carries the trigger wire.
  trigger?: { isMarket: boolean; triggerPx: number; tpsl: 'tp' | 'sl' };
};

// keys MUST stay in this order — they are hashed positionally
export function orderToWire(o: OrderInput) {
  return {
    a: o.assetIndex,
    b: o.isBuy,
    p: floatToWire(o.price),
    s: floatToWire(o.size),
    r: o.reduceOnly ?? false,
    t: o.trigger
      ? { trigger: { isMarket: o.trigger.isMarket, triggerPx: floatToWire(o.trigger.triggerPx), tpsl: o.trigger.tpsl } }
      : { limit: { tif: o.tif ?? 'Gtc' } },
  };
}

// Optional builder-code (fee monetization). `b` = builder address (LOWERCASED),
// `f` = fee in TENTHS OF A BASIS POINT (10 → 1bp). Appended as the LAST key of the
// action AFTER grouping — the chain hashes keys positionally, so builder must come last
// and the EXACT same object must be POSTed to /exchange.
export type BuilderCode = { b: string; f: number };

export function buildOrderAction(orders: OrderInput[], builder?: BuilderCode | null, grouping: 'na' | 'positionTpsl' = 'na') {
  const action: Record<string, unknown> = { type: 'order', orders: orders.map(orderToWire), grouping };
  if (builder && builder.b) action.builder = { b: builder.b.toLowerCase(), f: builder.f };
  return action;
}

// cancel by asset index + order id
export function buildCancelAction(cancels: { assetIndex: number; oid: number }[]) {
  return { type: 'cancel', cancels: cancels.map((c) => ({ a: c.assetIndex, o: c.oid })) };
}

// set per-asset leverage + margin mode. isCross=false → isolated. Keys hashed positionally.
export function buildUpdateLeverageAction(assetIndex: number, isCross: boolean, leverage: number) {
  return { type: 'updateLeverage', asset: assetIndex, isCross, leverage };
}

/* ---------------- builder-fee approval (user-signed, one-time) ----------------
   A DIFFERENT signing scheme from L1 actions: this is an EIP-712 "user-signed
   action" over the HyperliquidSignTransaction domain (not the Exchange/Agent
   connectionId hash). Signed by the user's MAIN wallet (the Privy embedded wallet
   qualifies). The action itself carries `signatureChainId`; the EIP-712 domain
   chainId MUST equal that same value as a number. POST {action, nonce, signature}
   to /exchange. `maxFeeRate` is a percent STRING (e.g. "0.01%"). */

// default signature chain id for user-signed actions (withdraw3 / usdClassTransfer /
// approveBuilderFee). MUST match the wallet's ACTIVE chain: external wallets (MetaMask,
// Rabby) reject eth_signTypedData_v4 when domain.chainId ≠ the connected chain — silently,
// no popup. The HL Python SDK uses 0x66eee because it signs with a raw key (no wallet to
// enforce the match); a browser wallet on Arbitrum One needs 0xa4b1 (42161). HL validates
// the signature against whatever signatureChainId the action carries, so 0xa4b1 is accepted.
// Callers ensure the wallet is on Arbitrum One before signing (see ensureArbitrum).
export const DEFAULT_SIG_CHAIN_ID = '0xa4b1';

export type ApproveBuilderFeeResult = {
  action: {
    type: 'approveBuilderFee';
    hyperliquidChain: 'Mainnet' | 'Testnet';
    signatureChainId: Hex;
    maxFeeRate: string;
    builder: string;
    nonce: number;
  };
  nonce: number;
  signature: HlSignature;
};

export async function signApproveBuilderFee(
  signTypedData: SignTypedDataFn,
  opts: {
    builder: string;                 // builder address
    maxFeeRate: string;              // percent string, e.g. "0.01%"
    isMainnet?: boolean;
    signatureChainId?: string;       // hex string; falls back to DEFAULT_SIG_CHAIN_ID
    nonce?: number;
  },
): Promise<ApproveBuilderFeeResult> {
  const { builder, maxFeeRate, isMainnet = true } = opts;
  const nonce = opts.nonce ?? Date.now();
  const sigChainHex = (opts.signatureChainId || DEFAULT_SIG_CHAIN_ID) as Hex;
  const chainIdNum = parseInt(sigChainHex, 16);
  const hyperliquidChain: 'Mainnet' | 'Testnet' = isMainnet ? 'Mainnet' : 'Testnet';
  const builderLc = builder.toLowerCase();

  // The action as it must be POSTed. Key order matches the reference; the EIP-712
  // message below carries only the four signed fields (NOT type/signatureChainId).
  const action = {
    type: 'approveBuilderFee' as const,
    hyperliquidChain,
    signatureChainId: sigChainHex,
    maxFeeRate,
    builder: builderLc,
    nonce,
  };

  const sigHex = await signTypedData({
    domain: {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: chainIdNum,
      verifyingContract: ZERO_ADDR,
    },
    types: {
      'HyperliquidTransaction:ApproveBuilderFee': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'maxFeeRate', type: 'string' },
        { name: 'builder', type: 'address' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
    message: { hyperliquidChain, maxFeeRate, builder: builderLc, nonce },
  });

  const parsed = parseSignature(sigHex);
  const signature: HlSignature = { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)) };
  return { action, nonce, signature };
}

/* ---------------- withdraw to Arbitrum (user-signed, withdraw3) ----------------
   Same HyperliquidSignTransaction / user-signed-action scheme as approveBuilderFee.
   VERIFIED against the HL Python SDK (hyperliquid/utils/signing.py): sign types are
   [hyperliquidChain, destination, amount, time] in THIS order, primaryType
   'HyperliquidTransaction:Withdraw', signatureChainId FIXED at 0x66eee (not the
   wallet's chain), domain chainId = 421614, hyperliquidChain 'Mainnet', and the POST
   nonce EQUALS the action's `time`. HL charges a $1 withdrawal fee; funds arrive as
   native USDC on Arbitrum at `destination` (default: the withdrawing account itself). */
export type WithdrawResult = {
  action: {
    type: 'withdraw3';
    hyperliquidChain: 'Mainnet' | 'Testnet';
    signatureChainId: Hex;
    destination: string;
    amount: string;
    time: number;
  };
  nonce: number;
  signature: HlSignature;
};

export async function signWithdraw(
  signTypedData: SignTypedDataFn,
  opts: {
    destination: string;             // 0x… address to receive USDC on Arbitrum
    amount: string;                  // USD amount as a string, e.g. "5"
    isMainnet?: boolean;
    signatureChainId?: string;
    nonce?: number;                  // = time; defaults to Date.now()
  },
): Promise<WithdrawResult> {
  const { destination, amount, isMainnet = true } = opts;
  const time = opts.nonce ?? Date.now();
  const sigChainHex = (opts.signatureChainId || DEFAULT_SIG_CHAIN_ID) as Hex;   // 0x66eee, per the SDK
  const chainIdNum = parseInt(sigChainHex, 16);
  const hyperliquidChain: 'Mainnet' | 'Testnet' = isMainnet ? 'Mainnet' : 'Testnet';
  const dest = destination.toLowerCase();

  const action = {
    type: 'withdraw3' as const,
    hyperliquidChain,
    signatureChainId: sigChainHex,
    destination: dest,
    amount,
    time,
  };

  const sigHex = await signTypedData({
    domain: {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: chainIdNum,
      verifyingContract: ZERO_ADDR,
    },
    types: {
      'HyperliquidTransaction:Withdraw': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'destination', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'time', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:Withdraw',
    message: { hyperliquidChain, destination: dest, amount, time },
  });

  const parsed = parseSignature(sigHex);
  const signature: HlSignature = { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)) };
  return { action, nonce: time, signature };
}

/* ---------------- move USDC between spot and perp (usdClassTransfer) ----------------
   A Bridge2 deposit credits the SPOT balance; perps trading + withdraw3 use the PERP
   balance — so a deposit must be followed by a spot→perp transfer (toPerp=true), exactly
   what the HL frontend does automatically. VERIFIED against the HL Python SDK: sign types
   [hyperliquidChain, amount, toPerp, nonce], primaryType HyperliquidTransaction:UsdClassTransfer,
   signatureChainId 0x66eee, amount via floatToWire. */
export type UsdClassTransferResult = {
  action: {
    type: 'usdClassTransfer';
    hyperliquidChain: 'Mainnet' | 'Testnet';
    signatureChainId: Hex;
    amount: string;
    toPerp: boolean;
    nonce: number;
  };
  nonce: number;
  signature: HlSignature;
};

export async function signUsdClassTransfer(
  signTypedData: SignTypedDataFn,
  opts: { amount: string; toPerp: boolean; isMainnet?: boolean; signatureChainId?: string; nonce?: number },
): Promise<UsdClassTransferResult> {
  const { amount, toPerp, isMainnet = true } = opts;
  const nonce = opts.nonce ?? Date.now();
  const sigChainHex = (opts.signatureChainId || DEFAULT_SIG_CHAIN_ID) as Hex;
  const chainIdNum = parseInt(sigChainHex, 16);
  const hyperliquidChain: 'Mainnet' | 'Testnet' = isMainnet ? 'Mainnet' : 'Testnet';

  const action = {
    type: 'usdClassTransfer' as const,
    hyperliquidChain,
    signatureChainId: sigChainHex,
    amount,
    toPerp,
    nonce,
  };

  const sigHex = await signTypedData({
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: chainIdNum, verifyingContract: ZERO_ADDR },
    types: {
      'HyperliquidTransaction:UsdClassTransfer': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'toPerp', type: 'bool' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:UsdClassTransfer',
    message: { hyperliquidChain, amount, toPerp, nonce },
  });

  const parsed = parseSignature(sigHex);
  const signature: HlSignature = { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)) };
  return { action, nonce, signature };
}

/* ---------------- approve an agent (API) wallet (approveAgent) ----------------
   A user-signed action that authorises a locally-generated key to sign L1 actions (orders,
   cancels, leverage) on the master account's behalf — WITHOUT the per-action wallet popup that
   external wallets block (they reject the phantom-agent domain's chainId 1337). The agent can
   trade but NOT withdraw/transfer funds. Named agents: re-approving the same agentName replaces
   the prior key. Types [hyperliquidChain, agentAddress, agentName, nonce], primaryType
   HyperliquidTransaction:ApproveAgent. Signed by the MASTER wallet (its active chain). */
export type ApproveAgentResult = {
  action: {
    type: 'approveAgent';
    hyperliquidChain: 'Mainnet' | 'Testnet';
    signatureChainId: Hex;
    agentAddress: string;
    agentName: string;
    nonce: number;
  };
  nonce: number;
  signature: HlSignature;
};

export async function signApproveAgent(
  signTypedData: SignTypedDataFn,
  opts: { agentAddress: string; agentName: string; isMainnet?: boolean; signatureChainId?: string; nonce?: number },
): Promise<ApproveAgentResult> {
  const { agentName, isMainnet = true } = opts;
  const nonce = opts.nonce ?? Date.now();
  const sigChainHex = (opts.signatureChainId || DEFAULT_SIG_CHAIN_ID) as Hex;
  const chainIdNum = parseInt(sigChainHex, 16);
  const hyperliquidChain: 'Mainnet' | 'Testnet' = isMainnet ? 'Mainnet' : 'Testnet';
  const agentAddress = opts.agentAddress.toLowerCase();

  const action = {
    type: 'approveAgent' as const,
    hyperliquidChain,
    signatureChainId: sigChainHex,
    agentAddress,
    agentName,
    nonce,
  };

  const sigHex = await signTypedData({
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: chainIdNum, verifyingContract: ZERO_ADDR },
    types: {
      'HyperliquidTransaction:ApproveAgent': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'agentAddress', type: 'address' },
        { name: 'agentName', type: 'string' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:ApproveAgent',
    message: { hyperliquidChain, agentAddress, agentName, nonce },
  });

  const parsed = parseSignature(sigHex);
  const signature: HlSignature = { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)) };
  return { action, nonce, signature };
}
