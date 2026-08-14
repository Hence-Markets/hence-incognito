/* The honest disclosure, as DATA rather than prose in a component.

   Every surface renders from here — landing screen, ticket hint, T&C. If a claim is not in
   this file it does not get made. That is what stops them drifting apart as the product moves.

   PHASE-AWARE, because the truth changes between phases and the copy has to change with it:

     Phase 1 (shielded execution) — your identity is hidden; the position is public on Avantis
     forever. The honest claim is narrow.

     Phase 2 (bounded netting) — orders are matched against each other first, and whatever
     matches NEVER REACHES A PUBLIC VENUE. Not obscured, absent. Only the unmatched remainder
     goes out, as one net position nobody can attribute.

   Note the Phase 2 framing is conditional on purpose: a trader cannot control whether their
   order crosses. Promising "your trade is invisible" would be false on the day the book is
   one-sided. Two columns, both true, is the only version that survives contact with an
   imbalanced epoch. */

/* DEFAULT 1, deliberately. A misconfigured deployment should UNDERCLAIM — promising Phase 2
   privacy while running Phase 1 execution is the one failure mode that actively harms users. */
export const PHASE: 1 | 2 = (Number(import.meta.env.VITE_PHASE) === 2 ? 2 : 1);

export type Disclosure = {
  tagline: string;
  left: { heading: string; items: readonly string[] };
  right: { heading: string; items: readonly string[] };
  limits: string;
  footer: string;
};

const PHASE_1: Disclosure = {
  tagline: 'Trade on Avantis without your name attached.',
  left: {
    heading: 'Now hidden',
    items: ['Who placed the trade', 'Your handle and profile', 'Your main wallet', 'Your order, before it executes'],
  },
  right: {
    heading: 'Still public',
    items: ['That the position exists', 'Size and entry', 'Leverage', 'Liquidation price'],
  },
  limits: "Not private from Inco's operators, or from anyone analysing the chain.",
  footer: 'Your trade is public. You are not.',
};

const PHASE_2: Disclosure = {
  tagline: 'Your order is matched against other traders first. Whatever matches never reaches a public venue.',
  left: {
    heading: 'If your order matches',
    items: [
      'It never reaches a public venue',
      'No position exists on-chain to find',
      'Nothing to trace back to you, ever',
      'No venue spread to pay',
    ],
  },
  right: {
    heading: 'If it does not',
    items: [
      'It goes out inside one net position',
      'That position is public on Avantis',
      'Still not attributable to you',
      'You cannot choose which happens',
    ],
  },
  limits:
    "Not private from Inco's operators, or from anyone analysing the chain. Matched positions are capped at ±100% of your stake.",
  footer: 'What we match never reaches a public venue.',
};

export const DISCLOSURE: Disclosure = PHASE === 2 ? PHASE_2 : PHASE_1;
