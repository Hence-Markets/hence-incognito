// SSE subscription client for the server-side MarketHub (serve.py GET /api/stream).
// One EventSource per openStream() call; the terminal opens ONE with all its subs
// (mids + book:<COIN> + trades:<COIN>) and closes/reopens on pair change.
//
// Event contract (see serve.py MarketHub):
//   mids   → {sym: px} full dict ~2s (allMids naming, incl 'xyz:*' HIP-3 coins)
//   book   → {coin, time, bids:[{px,sz,n}...], asks:[...]} full snapshot ~1.8s
//   trades → {coin, trades:[{px,sz,side:'buy'|'sell',time}...], snapshot?:true}
//            first message per coin is a snapshot (REPLACE); later ones are deltas (append)
// On connect the hub seeds each resource's cached `last` payload — instant first paint.

export type StreamStatus = 'live' | 'connecting' | 'down';

export type BookMsg = { coin: string; time?: number; bids: { px: number; sz: number; n?: number }[]; asks: { px: number; sz: number; n?: number }[] };
export type TradeMsg = { px: number; sz: number; side: 'buy' | 'sell'; time: number };
export type TradesMsg = { coin: string; trades: TradeMsg[]; snapshot?: boolean };

type Handlers = {
  mids?: (m: Record<string, number>) => void;
  book?: (b: BookMsg) => void;
  trades?: (t: TradesMsg) => void;
  status?: (s: StreamStatus) => void;
};

// mirrors the server's validation: 'mids' | 'book:<COIN>' | 'trades:<COIN>',
// coin ^[A-Za-z0-9:._-]{1,24}$ (':' inside allows HIP-3 coins like book:xyz:NVDA)
const KEY_RE = /^(mids|(book|trades):[A-Za-z0-9:._-]{1,24})$/;
const MAX_KEYS = 8;
const DOWN_GRACE_MS = 5000; // onerror must persist this long (still disconnected) before we report 'down'
const HIDDEN_PAUSE_MS = 20000; // close the stream after the tab has been hidden this long; reopen on return

/** Open one SSE connection for `subs`; returns close(). Invalid keys are dropped, capped at 8. */
export function openStream(subs: string[], h: Handlers): () => void {
  const keys = [...new Set((subs || []).filter((k) => KEY_RE.test(k)))].slice(0, MAX_KEYS);
  if (!keys.length) {
    h.status?.('down');
    return () => {};
  }
  const url = '/api/stream?subs=' + encodeURIComponent(keys.join(','));

  let es: EventSource | null = null;
  let closed = false;
  let status: StreamStatus = 'connecting';
  let downTimer: number | undefined; // pending "report down" check after an onerror
  let retryTimer: number | undefined; // manual reconnect after a fatal (CLOSED) error
  let hideTimer: number | undefined; // pending hidden-tab pause

  const setStatus = (s: StreamStatus) => {
    if (!closed && s !== status) {
      status = s;
      h.status?.(s);
    }
  };

  const clearDown = () => {
    if (downTimer != null) {
      window.clearTimeout(downTimer);
      downTimer = undefined;
    }
  };

  const onEvent = (name: 'mids' | 'book' | 'trades') => (ev: MessageEvent) => {
    if (closed) return;
    clearDown();
    setStatus('live'); // any event = the pipe is alive (recovery included)
    try {
      const data = JSON.parse(ev.data);
      h[name]?.(data);
    } catch {
      /* malformed frame — skip it, the next one will be fine */
    }
  };

  const teardownEs = () => {
    if (es) {
      es.close();
      es = null;
    }
    clearDown();
    if (retryTimer != null) {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  const connect = () => {
    if (closed || es) return;
    es = new EventSource(url);
    es.addEventListener('mids', onEvent('mids'));
    es.addEventListener('book', onEvent('book'));
    es.addEventListener('trades', onEvent('trades'));
    es.onerror = () => {
      if (closed || !es) return;
      if (es.readyState === EventSource.CLOSED) {
        // fatal close (e.g. 4xx / server restart mid-handshake) — the browser will NOT
        // retry on its own here, so we do, on a modest timer.
        teardownEs();
        setStatus('down');
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          if (!closed && !document.hidden) connect();
        }, DOWN_GRACE_MS);
        return;
      }
      // transient drop — EventSource retries internally; only report 'down' if we're
      // still disconnected after the grace period (an event in the meantime cancels this).
      if (downTimer == null) {
        downTimer = window.setTimeout(() => {
          downTimer = undefined;
          if (!closed && es && es.readyState !== EventSource.OPEN) setStatus('down');
        }, DOWN_GRACE_MS);
      }
    };
  };

  // page-visibility pause: a tab hidden >20s closes the stream (frees a hub sub);
  // returning to the tab reopens it — the hub's cached `last` repaints instantly.
  const onVis = () => {
    if (closed) return;
    if (document.hidden) {
      if (hideTimer == null) {
        hideTimer = window.setTimeout(() => {
          hideTimer = undefined;
          if (!closed && document.hidden && es) {
            teardownEs();
            setStatus('connecting'); // paused, not broken
          }
        }, HIDDEN_PAUSE_MS);
      }
    } else {
      if (hideTimer != null) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
      if (!es) {
        setStatus('connecting');
        connect();
      }
    }
  };
  document.addEventListener('visibilitychange', onVis);

  h.status?.('connecting');
  connect();

  return () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('visibilitychange', onVis);
    if (hideTimer != null) window.clearTimeout(hideTimer);
    teardownEs();
  };
}
