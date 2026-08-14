import { useCallback, useState } from 'react';
import { l2Book } from '../lib/hydromancer.js';
import { tradeCopilot } from '../lib/ai.js';

export type CopilotResult = {
  bias: 'Long' | 'Short' | 'Neutral';
  conviction: 'low' | 'medium' | 'high';
  entry: string; stop: string; target: string;
  rationale: string; risk: string; position: string;
};

// Live snapshot the terminal already has on screen — passed into run() so the
// copilot reasons from exactly what the user sees.
export type CopilotLive = {
  mark: number;
  chg24h: number | null;
  fundingHourlyPct: number | null;
  volatilityPct: number | null;
  dayVolUsd: number | null;
  leverage: number;
  position: {
    side: 'Long' | 'Short'; sz: number; entryPx: number;
    uPnl: number; roe: number; leverage: number; liqPx: number | null;
  } | null;
};

// Builds the order-book microstructure (best bid/ask, spread, top-10 depth, imbalance)
// from the real L2 book, then asks DeepSeek for a grounded directional read.
export function useTradeCopilot(pair: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [at, setAt] = useState(0);

  const run = useCallback(async (live: CopilotLive) => {
    setLoading(true); setError(null);
    try {
      const book = await l2Book(pair).catch(() => null);
      let bookCtx: any = null;
      if (book && book.bids.length && book.asks.length) {
        const bestBid = book.bids[0].px, bestAsk = book.asks[0].px;
        const mid = (bestBid + bestAsk) / 2;
        const depth = (arr: { px: number; sz: number }[]) => arr.slice(0, 10).reduce((s, l) => s + l.px * l.sz, 0);
        const bidDepth = depth(book.bids), askDepth = depth(book.asks);
        const tot = bidDepth + askDepth || 1;
        bookCtx = {
          bestBid, bestAsk,
          spreadBps: +(((bestAsk - bestBid) / mid) * 10000).toFixed(2),
          bidDepthUsd: Math.round(bidDepth), askDepthUsd: Math.round(askDepth),
          imbalancePct: +(((bidDepth - askDepth) / tot) * 100).toFixed(1),
        };
      }
      const ctx = {
        sym: pair,
        mark: live.mark,
        chg24hPct: live.chg24h,
        fundingHourlyPct: live.fundingHourlyPct,
        volatility1hPct: live.volatilityPct,
        dayVolUsd: live.dayVolUsd,
        selectedLeverage: live.leverage,
        book: bookCtx,
        position: live.position,
      };
      const r = await tradeCopilot(ctx);
      setResult(r); setAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'AI copilot unavailable');
    } finally {
      setLoading(false);
    }
  }, [pair]);

  return { loading, error, result, at, run };
}
