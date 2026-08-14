/* The honest disclosure, as DATA rather than prose in a component.

   It is here so the landing screen, the ticket hint and the T&C cannot drift apart — every
   surface renders from this one list. If a claim is not in this file it does not get made.

   `stillPublic` SHRINKS in Phase 2: crossed volume never reaches a public venue, so those
   rows move out. Build layouts that can absorb that without a rebuild. */
export const NOW_HIDDEN = [
  'Who placed the trade',
  'Your handle and profile',
  'Your main wallet',
] as const;

export const STILL_PUBLIC = [
  'That the position exists',
  'Size and entry',
  'Leverage',
  'Liquidation price',
] as const;

/* Never omit this. A trader who believes they are invisible sizes up — and on Avantis their
   exact liquidation price is readable by anyone, which is precisely what a liquidation hunter
   looks for. Overclaiming here makes users MORE exploitable, not less. */
export const LIMITS =
  "Not private from Inco's operators, or from anyone analysing the chain.";
