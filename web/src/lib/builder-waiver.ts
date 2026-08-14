/* xyz rebate campaign: on trade.xyz coins the builder fee drops to ZERO while the campaign
   flag is up — charging our 4bp and then rebating the venue's 0.9bp would be incoherent.
   Lives in its own dependency-free module so tests can import the boundary logic without
   dragging in the exchange module's Vite-only globals. */
import type { BuilderCode } from './hyperliquid-sign';

export function builderForCoin(
  coin: string,
  builder: BuilderCode | null | undefined,
  xyzRebateActive: boolean,
): BuilderCode | null {
  if (!builder) return null;
  if (xyzRebateActive && String(coin || '').startsWith('xyz:')) return { ...builder, f: 0 };
  return builder;
}
