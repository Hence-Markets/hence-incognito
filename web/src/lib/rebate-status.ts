/* Per-user xyz-rebate status — the ONE answer to "does the fee waiver apply to me?".

   Two campaign modes share one client rule:
   - open campaign: /api/config carries xyzRebate=true → waiver for everyone
   - whitelist (team-test) mode: config stays false; a signed-in whitelisted tester
     learns they're in via /api/me/rebates (active=true for their wallet only)

   placeOrder consults this before zeroing the builder fee, so the waiver a tester SEES
   is exactly the waiver their order GETS. Fail-closed: any error or signed-out state
   means no waiver — charging the normal disclosed fee is always the safe wrong answer,
   waiving it for someone outside the campaign is not. */
import { getConfig } from './config';
// @ts-ignore — JS module
import * as me from './me.js';

let cached: { at: number; active: boolean } | null = null;
const TTL = 60_000;

export async function rebateWaiverActive(): Promise<boolean> {
  const cfg = await getConfig().catch(() => null);
  if (cfg && (cfg as any).xyzRebate) return true;           // open campaign — no auth needed
  if (cached && Date.now() - cached.at < TTL) return cached.active;
  let active = false;
  try {
    const r: any = await me.rebates();
    active = !!(r && r.available && r.active);
  } catch { /* signed out or unreachable → no waiver */ }
  cached = { at: Date.now(), active };
  return active;
}

/** Terminal polls /api/me/rebates itself; it shares its freshest answer so the ticket UI
 *  and the order path can't disagree within the poll interval. */
export function primeRebateStatus(active: boolean) {
  cached = { at: Date.now(), active };
}
