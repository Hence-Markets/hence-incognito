/* =========================================================
   Hence accounts model — the authenticated Privy wallet plus
   verified external account connections.

   IMPORTANT: wallet addresses must come from Privy. This module
   never generates or persists addresses in the browser. The old
   local mock state is removed on load so it can never be shown as
   a wallet or used as a funding destination.
   ========================================================= */
import * as me from './me.js';

const KEY = 'hence.accounts.v1';

// `hence.accounts.v1` only ever contained browser-generated mock wallets and mock
// account rows. Remove it eagerly instead of attempting to migrate potentially unsafe
// deposit addresses. Signed-in profiles and real connections are server-backed.
try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); } catch { /* storage disabled */ }

/* Venues the authenticated wallet can use. The Accounts modal does not claim a
   venue balance until a real balance adapter is connected. */
export const VENUES = [
  { id: 'hyperliquid', name: 'Hyperliquid', kind: 'Perp DEX', color: '#50d2c1' },
  { id: 'polymarket', name: 'Polymarket', kind: 'Prediction market', color: '#1A53F0' },
];

/* Planned external connections, grouped by category. These remain discovery-only until
   their real OAuth/wallet handshake is wired. Selecting one must never create a connection
   row or claim that a venue is connected. */
export const CONNECTABLE = [
  { id: 'hyperliquid', name: 'Hyperliquid', kind: 'Perp DEX', group: 'Perps & predictions', ckind: 'exchange', color: '#50d2c1', via: 'wallet' },
  { id: 'polymarket', name: 'Polymarket', kind: 'Prediction market', group: 'Perps & predictions', ckind: 'exchange', color: '#1A53F0', via: 'wallet' },
  { id: 'stake', name: 'Stake', kind: 'AUS / US brokerage', group: 'Brokerages', ckind: 'brokerage', color: '#00d09c', via: 'snaptrade' },
  { id: 'broker', name: 'Other broker', kind: 'IBKR · Robinhood · Webull…', group: 'Brokerages', ckind: 'brokerage', color: '#6366f1', via: 'snaptrade' },
  { id: 'coinbase', name: 'Coinbase', kind: 'Exchange', group: 'Exchanges', ckind: 'exchange', color: '#0052ff', via: 'snaptrade' },
  { id: 'binance', name: 'Binance', kind: 'Exchange', group: 'Exchanges', ckind: 'exchange', color: '#f3ba2f', via: 'snaptrade' },
  { id: 'kraken', name: 'Kraken', kind: 'Exchange', group: 'Exchanges', ckind: 'exchange', color: '#7132f5', via: 'snaptrade' },
  { id: 'wallet', name: 'External wallet', kind: 'MetaMask · WalletConnect', group: 'Wallets', ckind: 'wallet', color: '#f6851b', via: 'wallet' },
];
const byId = Object.fromEntries(CONNECTABLE.map(p => [p.id, p]));
export const providerInfo = (id) => byId[id] || { id, name: id, kind: '', color: '#3f3f46', ckind: 'exchange', via: 'native' };

/* grouped, in declaration order — for the connect dialog */
export function connectableGroups() {
  const g = {};
  for (const p of CONNECTABLE) (g[p.group] ||= []).push(p);
  return Object.entries(g).map(([title, items]) => ({ title, items }));
}

/* ---- authenticated wallet state ---- */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// AuthProvider mirrors Privy's verified session onto `window.henceAuth`. Requiring both
// authenticated=true and a valid EVM address prevents stale/logout state, arbitrary local
// values, and the retired mock wallet from becoming funding destinations.
export function walletAddress() {
  if (typeof window === 'undefined') return null;
  const auth = window.henceAuth;
  const address = auth && auth.authenticated && typeof auth.address === 'string' ? auth.address.trim() : '';
  return EVM_ADDRESS.test(address) ? address : null;
}

export const hasWallet = () => !!walletAddress();

// Kept as a read-only compatibility surface for older callers. It intentionally contains
// no browser wallet or anonymous account state.
export const getState = () => ({ wallet: null, external: [] });

/* Planned external-account entry point. Until a provider-specific handshake returns a stable
   external reference (or a backend marks it verified), this is intentionally a no-op. */
export function connect(providerId) {
  const p = providerInfo(providerId);
  return { providerId, name: p.name, status: 'unavailable', persisted: false };
}
export function disconnect(id) {
  if (typeof window !== 'undefined' && window.henceMe) me.removeConnection(id);
}
export function externalAccounts() {
  // No brokerage/exchange adapter currently verifies connection rows server-side. Historical
  // rows — including ones with a caller-supplied external_ref/meta blob — are therefore not
  // evidence of account ownership and must never render as connected or contribute balances.
  // A future provider callback may expose a separate server-verified read model here.
  return [];
}
export const externalCount = () => externalAccounts().length;
