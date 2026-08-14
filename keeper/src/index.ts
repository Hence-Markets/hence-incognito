/* The keeper.
 *
 * Inco has no contract-triggered decryption, so something outside the chain has to drive
 * reveal and execution. That is this process. It is deliberately NOT trusted: once the
 * contract calls e.reveal(), any party can fetch the attestation and finish the job — the
 * keeper is a convenience, not a dependency.
 *
 * Shape copied from the Hence rebate-accrual and nightly-thesis loops, not imported.
 */

import { startApi } from './api.js';

const EPOCH_SECONDS = Number(process.env.EPOCH_SECONDS ?? 300);
const DRY_RUN = process.env.DRY_RUN !== '0';
const MAX_ORDER_USD = Number(process.env.MAX_ORDER_USD ?? 100);

async function tick() {
  // 1. read orders whose epoch has closed
  // 2. PHASE 2: net on ciphertext (e.min matched, e.add net) — never decrypt an order
  // 3. PHASE 2: settle crossed legs internally, bounded +/-100%, and STOP — they never
  //    reach Avantis. This is the only genuinely private execution in the design.
  // 4. attested-decrypt the residual, sign EIP-712 OpenTradeReq from the shielded wallet
  //    via Avantis DelegateReq, submit to the relayer
  // 5. record fills
  //
  // Fail CLOSED at every step. If the shielded wallet is unavailable, the order must fail
  // loudly rather than fall back to the user's main wallet — falling back would publish
  // exactly the link this product exists to hide.
}

async function main() {
  console.log(
    `[keeper] epoch=${EPOCH_SECONDS}s dry_run=${DRY_RUN} max_order=$${MAX_ORDER_USD}`
  );
  if (DRY_RUN) console.log('[keeper] DRY_RUN — no funds will move. Set DRY_RUN=0 to arm.');
  startApi();
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error('[keeper] tick failed', err); // a bad tick must never kill the loop
    }
    await new Promise((r) => setTimeout(r, EPOCH_SECONDS * 1000));
  }
}

main();
