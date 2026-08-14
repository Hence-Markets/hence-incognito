/* The keeper.
 *
 * Inco has no contract-triggered decryption, so something outside the chain has to drive
 * reveal and execution. That is this process. It is deliberately NOT trusted: once the
 * contract calls e.reveal(), any party can fetch the attestation and finish the job — the
 * keeper is a convenience, not a dependency.
 *
 * Shape copied from the Hence rebate-accrual and nightly-thesis loops, not imported.
 */

import './env.js';   // MUST be first: api/access/fund all read process.env at module scope
import { startApi } from './api.js';
import { envReport } from './env.js';
import { tick } from './tick.js';
import { fillerTick, FILLER_ON } from './filler.js';

const EPOCH_SECONDS = Number(process.env.EPOCH_SECONDS ?? 300);
const DRY_RUN = process.env.DRY_RUN !== '0';
const MAX_ORDER_USD = Number(process.env.MAX_ORDER_USD ?? 100);

/* DRY_RUN gates the OUTBOUND VENUE LEG, not netting.
   Netting and reveal move no user funds — they are the product, and a keeper that does nothing
   by default is a keeper nobody notices is broken. What DRY_RUN holds back is sending a
   residual to a public venue, which on Base Sepolia cannot happen anyway: Avantis is mainnet
   only. See tick.ts. */

async function main() {
  console.log(
    `[keeper] epoch=${EPOCH_SECONDS}s dry_run=${DRY_RUN} max_order=$${MAX_ORDER_USD}`
  );
  // Which configuration actually arrived. Every one of these silently took a fallback for the
  // whole of this project's life because nothing loaded .env.local — say it at boot instead.
  console.log(`[keeper] env: ${envReport(['INCOGNITO_CONTRACT', 'TEAM_WALLETS', 'OMNIBUS_KEY', 'NETWORK'])}`);
  if (DRY_RUN) console.log('[keeper] DRY_RUN — no funds will move. Set DRY_RUN=0 to arm.');
  if (FILLER_ON) console.log('[keeper] FILLER ON — background orders are real transactions from wallets we control. Disclose that.');
  startApi();
  for (;;) {
    try {
      await tick();
      // Background flow, so an epoch is never empty for the next person who walks up. Off by
      // default; refuses on mainnet. Runs AFTER netting so it never races a close it caused.
      await fillerTick();
    } catch (err) {
      console.error('[keeper] tick failed', err); // a bad tick must never kill the loop
    }
    /* Poll faster than the epoch, not once per epoch. Sleeping a full epoch means an epoch
       that closes just after a tick waits nearly two full epochs to be netted — on a 120s
       demo that is four minutes of a book sitting visibly unprocessed. */
    await new Promise((r) => setTimeout(r, Math.max(10, EPOCH_SECONDS / 6) * 1000));
  }
}

main();
