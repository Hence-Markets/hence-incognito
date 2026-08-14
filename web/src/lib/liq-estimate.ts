/* Estimated liquidation price for a PROSPECTIVE order — the ticket previously read
   liquidation off the OPEN position only, so an account with no position showed "—"
   forever, exactly where a trader deciding on leverage most needs the number.

   Closed form for a fresh position at `entry` with leverage `lev` on an asset whose max
   leverage is `maxLev` (Hyperliquid: maintenance margin = half the initial margin at max
   leverage, so l = 1/(2·maxLev)):

     long :  liq = entry · (1 − (1/lev − l)/(1 − l))
     short:  liq = entry · (1 + (1/lev − l)/(1 + l))

   This is the isolated-margin estimate (margin posted = notional/lev). Under cross the
   whole account backs the position, so the true price is FURTHER away — the estimate is
   conservative, never optimistic. Hence the ≈ in the UI. */
export function estLiqPrice(entry: number, lev: number, maxLev: number, isLong: boolean): number | null {
  if (!(entry > 0) || !(lev >= 1) || !(maxLev > 1)) return null;
  const l = 1 / (2 * maxLev);
  const frac = (1 / lev - l) / (isLong ? 1 - l : 1 + l);
  // 1× long: the position survives any drawdown short of zero — no meaningful liq price.
  if (isLong && frac >= 1) return null;
  const liq = isLong ? entry * (1 - frac) : entry * (1 + frac);
  return liq > 0 ? liq : null;
}
