import { queryMaxBuilderFee, approveBuilderFee } from './hyperliquid-exchange';
import { getConfig, feeToPercent } from './config';
import type { BuilderCode, SignTypedDataFn } from './hyperliquid-sign';

// Per-session memo of addresses whose one-time on-chain max-fee cap is known good, so we
// don't re-read it on every order. Shared across all order paths in the app.
const _approved = new Set<string>();

export type BuilderResolution = { builder: BuilderCode | null; feeUsd: number; rejected?: boolean };

/**
 * Resolve Hence builder attribution (the routing fee that monetises the app) for ONE order.
 * Every L1 order path uses this so the fee is applied consistently — terminal, quick ticket
 * and closes — instead of each site hand-rolling (and forgetting) it.
 *
 * - `prompt: true` (order ENTRY) → request Hyperliquid's one-time, user-signed max-fee cap
 *   when it isn't yet on-chain. A hard wallet reject returns `{rejected:true}` so the caller
 *   aborts; any technical failure falls back to fee-free so a trader is never stranded.
 * - `prompt: false` (CLOSES) → attach only if the cap is already approved; never pop a
 *   signature mid-exit. Unapproved → fee-free close.
 *
 * ALWAYS resolves (never throws): monetisation must not block a trade beyond the single
 * intentional approval signature. `feeUsd` is the estimated Hence fee for telemetry.
 */
export async function resolveBuilder(
  sign: SignTypedDataFn | null | undefined,
  user: string,
  notionalUsd: number,
  opts: { prompt: boolean },
): Promise<BuilderResolution> {
  const none: BuilderResolution = { builder: null, feeUsd: 0 };
  let cfg;
  try { cfg = await getConfig(); } catch { return none; }
  if (!cfg?.hlBuilder || !user) return none;                       // feature off / no address
  const code: BuilderCode = { b: cfg.hlBuilder, f: cfg.hlBuilderFee };
  const attached: BuilderResolution = { builder: code, feeUsd: (notionalUsd || 0) * (cfg.hlBuilderFee || 0) / 100000 };
  const key = user.toLowerCase();

  if (_approved.has(key)) return attached;
  let onChain = false;
  try { onChain = (await queryMaxBuilderFee(user, cfg.hlBuilder)) >= cfg.hlBuilderFee; } catch { onChain = false; }
  if (onChain) { _approved.add(key); return attached; }

  if (!opts.prompt || !sign) return none;                          // closes: place fee-free, never interrupt the exit

  try {
    const res = await approveBuilderFee(sign, { builder: cfg.hlBuilder, maxFeeRate: feeToPercent(cfg.hlBuilderFee) });
    if ('error' in res) return none;                               // technical failure → fee-free, don't strand the trader
    _approved.add(key);
    return attached;
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/reject|denied|declin|cancel|4001/i.test(msg)) return { builder: null, feeUsd: 0, rejected: true };
    return none;
  }
}
