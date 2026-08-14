/* Which venue OWNS a bare symbol — the rule that decides whether "BTC" means the native
   Hyperliquid perp (live-tradable) or some HIP-3 dex's copy of it (read-only).

   The old rule was first-write-wins with priority expressed only by CALL ORDER, so when the
   native meta fetch timed out on a slow load, whichever HIP-3 dex answered first (HYNA)
   claimed BTC/ETH/SOL for the entire session: majors went read-only, the screener stamped
   them HYNA, and none of it reproduced on a machine where native won the race.

   Priority is now a property of the VENUE, not of network luck: native > trade.xyz > other
   HIP-3 dexes; among equals, first write still wins. A late-arriving higher-priority venue
   reclaims the symbol. Dependency-free so the boundary is testable in node. */

/** Lower is stronger. '' = native HL, 'xyz' = trade.xyz, anything else = other HIP-3 dexes. */
export const venueRank = (dex: string): number => (dex === '' ? 0 : dex === 'xyz' ? 1 : 2);

/** May a venue of rank `next` take a symbol currently held at rank `prev` (null = unheld)? */
export const claims = (prev: number | null | undefined, next: number): boolean =>
  prev == null || next < prev;
