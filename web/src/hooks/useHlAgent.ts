import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useHlSigner } from './useHlSigner';
import { newAgentKey, agentSigner, approveAgent } from '../lib/hyperliquid-exchange';
import { ensureArbitrum } from '../lib/hyperliquid-fund';
import type { SignTypedDataFn } from '../lib/hyperliquid-sign';
// @ts-ignore — JS module
import { toast } from '../lib/ui.js';

/* Agent (API) wallet manager for 1-click trading.

   External wallets refuse to sign Hyperliquid L1 actions (orders/cancels/leverage) because the
   phantom-agent EIP-712 domain uses chainId 1337, which no wallet is on. HL's answer is an agent
   key: the master wallet approves a locally-generated key ONCE (a user-signed action on the
   wallet's own chain), then that key signs every L1 action locally with no popup.

   The agent key can place/cancel trades on the account but CANNOT withdraw or transfer funds —
   those still require the master wallet. We persist it in localStorage keyed by master address,
   exactly as the Hyperliquid frontend does. Clearing storage just means a one-time re-approval. */

const KEY_PREFIX = 'hence.hlagent.v1.';
const DEVICE_KEY = 'hence.hlagent.device';

export type EnsuredSigner = { sign: SignTypedDataFn; fresh: boolean };

type StoredAgent = { privateKey: string; agentAddress: string; name: string; approvedAt: number; master: string };

// A stable per-DEVICE agent name. HL replaces an agent when the same name is re-approved, so a
// shared constant name makes multiple devices evict each other's keys. A device-scoped suffix keeps
// one distinct HL agent slot per browser; re-approving on the same device replaces only its own key.
function deviceAgentName(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = Math.random().toString(16).slice(2, 10); localStorage.setItem(DEVICE_KEY, id); }
    return `hence-${id}`;
  } catch { return 'hence'; }
}

function loadAgent(master: string): StoredAgent | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + master);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (a && a.privateKey && a.agentAddress && a.master === master) return a as StoredAgent;
  } catch { /* noop */ }
  return null;
}
function saveAgent(master: string, a: StoredAgent) {
  try { localStorage.setItem(KEY_PREFIX + master, JSON.stringify(a)); } catch { /* noop */ }
}
function clearAgent(master: string) {
  try { localStorage.removeItem(KEY_PREFIX + master); } catch { /* noop */ }
}

// Module-level in-flight approvals, keyed by master, so two concurrent first-time actions share ONE
// approveAgent instead of racing (which would generate two keys and evict each other on HL).
const inflight = new Map<string, Promise<StoredAgent>>();

export function useHlAgent() {
  const auth = useAuth();
  const signer = useHlSigner();
  const master = (auth.address || '').toLowerCase();
  const [agent, setAgent] = useState<StoredAgent | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => { setAgent(master ? loadAgent(master) : null); }, [master]);

  // Return an agent signer, approving a fresh key first if none is stored. `fresh` is true when this
  // call just approved a new key (so the caller can distinguish HL propagation delay from a truly
  // stale key). Throws if the user declines the one-time approval. localStorage is authoritative —
  // never the (possibly stale) `agent` state — so resetAgent()+re-ensure works within one call.
  const ensureAgentSigner = useCallback(async (): Promise<EnsuredSigner> => {
    if (!master) throw new Error('Connect a wallet to trade');
    const existing = loadAgent(master);
    if (existing) return { sign: agentSigner(existing.privateKey), fresh: false };
    if (!signer.sign) throw new Error('Connect a wallet to trade');

    // Dedup concurrent approvals for the same master.
    let p = inflight.get(master);
    const firstStarter = !p;
    if (!p) {
      p = (async () => {
        toast('Enable 1-click trading — approve a trading key once in your wallet', { icon: 'info' });
        if (auth.wallet) await ensureArbitrum(auth.wallet);   // approveAgent is user-signed; match the wallet's chain
        const { privateKey, address } = newAgentKey();
        const res = await approveAgent(signer.sign!, address, deviceAgentName());
        if ('error' in res) throw new Error(res.error);
        const saved: StoredAgent = { privateKey, agentAddress: address, name: deviceAgentName(), approvedAt: Date.now(), master };
        saveAgent(master, saved);
        // brief settle so HL registers the agent before the first order signed by it
        await new Promise((r) => setTimeout(r, 1200));
        return saved;
      })();
      inflight.set(master, p);
    }

    if (firstStarter) setApproving(true);
    try {
      const saved = await p;
      setAgent(saved);
      return { sign: agentSigner(saved.privateKey), fresh: firstStarter };
    } finally {
      if (firstStarter) { inflight.delete(master); setApproving(false); }
    }
  }, [master, signer.sign, auth.wallet]);

  // Forget the stored agent (e.g. HL reports it expired/unknown) so the next action re-approves.
  const resetAgent = useCallback(() => {
    if (master) clearAgent(master);
    setAgent(null);
  }, [master]);

  return {
    hasAgent: !!agent,
    agentAddress: agent?.agentAddress || null,
    approving,
    ensureAgentSigner,
    resetAgent,
  };
}
