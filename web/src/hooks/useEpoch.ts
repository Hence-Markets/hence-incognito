/* Epoch state — the countdown, the sealed count, and how much the last epoch crossed.
 *
 * ONE source, so swapping simulated → on-chain is a change here and nowhere else. Every
 * consumer reads this shape, which mirrors HenceIncognito.sol: an epoch has a close time, a
 * public order COUNT (public on-chain anyway), and — once netted — a matched/residual split.
 *
 * Today it runs on a local clock because the contract is not deployed. That is stated in the
 * returned `live` flag rather than hidden, and the UI surfaces it: a demo that cannot be told
 * apart from the real thing is the one thing this product cannot ship.
 */
import { useEffect, useState } from 'react';

const EPOCH_SECONDS = Number(import.meta.env.VITE_EPOCH_SECONDS ?? 300);

export type EpochState = {
  /** seconds until the open epoch closes and netting runs */
  secondsLeft: number;
  /** orders sealed in the open epoch */
  sealed: number;
  /** share of the LAST epoch that crossed internally, 0–1, or null if unknown */
  lastCrossed: number | null;
  /** false while this is a local clock rather than contract state */
  live: boolean;
};

export function useEpoch(): EpochState {
  const [secondsLeft, setSecondsLeft] = useState(EPOCH_SECONDS);

  useEffect(() => {
    const tick = () => {
      // Anchored to wall-clock so every client in the same epoch agrees, rather than each
      // counting down from whenever it happened to load.
      const now = Math.floor(Date.now() / 1000);
      setSecondsLeft(EPOCH_SECONDS - (now % EPOCH_SECONDS));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // TODO(step 3): read from HenceIncognito — orderCount(currentEpoch) for `sealed`, and the
  // previous epoch's matched/residual for `lastCrossed`. Both are already on the contract.
  return { secondsLeft, sealed: 0, lastCrossed: null, live: false };
}
