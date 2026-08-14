import { useEffect, useState } from 'react';
import * as market from '../lib/market.js';

let initStarted = false;

/** Kicks market.init() once and re-renders when the universe is ready. */
export function useMarketReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => market.isReady());
  useEffect(() => {
    if (market.isReady()) {
      setReady(true);
      return;
    }
    if (!initStarted) {
      initStarted = true;
      market.init();
    }
    const on = () => setReady(true);
    window.addEventListener('market:ready', on);
    return () => window.removeEventListener('market:ready', on);
  }, []);
  return ready;
}
