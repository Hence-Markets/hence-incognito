/* The honest disclosure, as DATA rather than prose in a component.

   Every surface renders from here — landing screen, ticket hint, T&C. If a claim is not in
   this file it does not get made. That is what stops them drifting apart as the product moves.

   PHASE-AWARE, because the truth changes between phases and the copy has to change with it:

     Phase 1 (shielded execution) — your identity is hidden; the position is public on Avantis
     forever. The honest claim is narrow.

     Phase 2 (bounded netting) — orders are matched against each other first, and whatever
     matches NEVER REACHES A PUBLIC VENUE. Not obscured, absent. Only the unmatched remainder
     goes out, as one net position nobody can attribute.

   THE SHAPE CHANGED, and why matters. This was two columns of four bullets — "if your order
   matches" against "if it does not" — eight claims to explain one idea, which read as hedging
   rather than honesty. The mechanic is three beats: encrypt, match, send the remainder. Say
   those, and put the caveats where caveats belong.

   Note the Phase 2 framing stays conditional on purpose: a trader cannot control whether their
   order crosses, so "your trade is invisible" would be false on the day the book is one-sided.
   Step three says "whatever is left" rather than promising there will be nothing left. */

/* DEFAULT 1, deliberately. A misconfigured deployment should UNDERCLAIM — promising Phase 2
   privacy while running Phase 1 execution is the one failure mode that actively harms users. */
export const PHASE: 1 | 2 = (Number(import.meta.env.VITE_PHASE) === 2 ? 2 : 1);

export type Step = { n: string; title: string; body: string };

export type Disclosure = {
  tagline: string;
  /** the one-line attribution under the tagline — who actually does the cryptography */
  poweredBy: string;
  steps: readonly Step[];
  footer: string;
};

const PHASE_1: Disclosure = {
  tagline: 'Trade on Avantis without your name attached.',
  poweredBy: 'Shielded execution on Base.',
  steps: [
    { n: '1', title: 'A separate address', body: 'Orders execute from an address that is not linked to you.' },
    { n: '2', title: 'Sent to the venue', body: 'The position opens on Avantis like any other.' },
    { n: '3', title: 'Public, but not yours', body: 'Size, entry and liquidation price are visible. Your name is not.' },
  ],
  footer: 'Your trade is public. You are not.',
};

const PHASE_2: Disclosure = {
  tagline: 'Your orders route through the Hence Pool — matched against other traders before any venue sees them.',
  poweredBy: 'Encrypted with Inco Lightning, on Base.',
  steps: [
    { n: '1', title: 'Encrypted in your browser', body: 'Your size is encrypted before it leaves your device.' },
    { n: '2', title: 'Matched in the pool', body: 'Orders net against each other while still encrypted. Nobody decrypts yours.' },
    // "whatever is left" and not "the rest is private" — on a one-sided book, everything is
    // left, and the copy has to survive that day too.
    { n: '3', title: 'Only the remainder leaves', body: 'Whatever matches never reaches a public venue. Whatever is left goes out as one net position.' },
  ],
  footer: 'What we match never reaches a public venue.',
};

export const DISCLOSURE: Disclosure = PHASE === 2 ? PHASE_2 : PHASE_1;
