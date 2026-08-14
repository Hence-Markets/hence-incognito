/* =========================================================================
   The agent-signed L1 rail, shared by every path that sends an order.

   Hyperliquid's Exchange domain uses chainId 1337, which no external wallet
   will sign — so orders/cancels/leverage go through an agent (API) key the
   master wallet approved once (see hooks/useHlAgent). Two failure modes have
   to be handled the same way everywhere:

     - a JUST-approved key HL hasn't registered yet → propagation delay, so
       retry the SAME key with backoff;
     - a pre-existing key HL rejects → stale/evicted, so re-approve once and
       retry with the new key.

   This lived as three byte-identical copies (terminal, terminal account card,
   quick ticket) before the thesis runner needed a fourth. It is deliberately
   hook-free: `AgentRail` is structural, so useHlAgent()'s return value
   satisfies it directly and non-React callers can pass their own.
   ========================================================================= */
import type { SignTypedDataFn } from './hyperliquid-sign';

export type AgentRail = {
  ensureAgentSigner: () => Promise<{ sign: SignTypedDataFn; fresh: boolean }>;
  resetAgent: () => void;
};

export type RunWithAgent = <T>(run: (sign: SignTypedDataFn) => Promise<T>) => Promise<T>;

// True for HL's "agent/API wallet not registered" errors — the signal to re-approve. Deliberately
// scoped to agent wording so a generic "does not exist" from an unrelated action can't trip a reset.
export function isAgentNotFound(err: string): boolean {
  return /user or api wallet|api wallet.*(does not exist|invalid)|extraagent|agent.*(does not exist|not registered|invalid)/i.test(err || '');
}

// Run an agent-signed L1 action, self-healing a bad agent.
export function makeRunWithAgent(agent: AgentRail): RunWithAgent {
  return async function runWithAgent<T>(run: (sign: SignTypedDataFn) => Promise<T>): Promise<T> {
    const { sign, fresh } = await agent.ensureAgentSigner();
    let r = await run(sign);
    if (r && typeof r === 'object' && 'error' in r && isAgentNotFound((r as any).error)) {
      if (fresh) {
        for (let i = 0; i < 3 && r && typeof r === 'object' && 'error' in r && isAgentNotFound((r as any).error); i++) {
          await new Promise((res) => setTimeout(res, 1200));
          r = await run(sign);
        }
      } else {
        agent.resetAgent();
        const re = await agent.ensureAgentSigner();
        r = await run(re.sign);
      }
    }
    return r;
  };
}
