/* =========================================================================
   screenctx — "what screen is the user looking at" as structured context.
   Single source of truth for the route→label mapping (used by the Ask-Hence
   assistant AND the feedback composer), plus a best-effort screen thumbnail.
   ========================================================================= */
import { domToJpeg } from 'modern-screenshot';

export type ScreenCtx = {
  path: string;        // location.hash
  screen: string;      // human label ("Trade terminal for BTC")
  symbol: string;      // ticker in view, or ''
  viewport: string;    // "1440x900"
  theme: string;       // 'dark' | 'light'
  ts: number;          // capture time (ms)
  shot?: string;       // best-effort JPEG data-URL thumbnail (may be absent)
};

// the ticker in view — excludes the prediction terminal (#/terminal/m/<id>), whose id isn't a ticker
export function currentSymbol(): string {
  const m = (location.hash || '').match(/#\/(?:stock|analysis|analyst|compare)\/([^/?]+)|#\/terminal\/(?!m\/)([^/?]+)/);
  return m ? decodeURIComponent(m[1] || m[2] || '').toUpperCase() : '';
}

const SCREEN_NAMES: Record<string, string> = {
  '': 'Home — daily market recap & news feed', terminal: 'Trade terminal', stock: 'Asset page',
  analysis: 'AI analysis report', analyst: 'Analyst coverage', economy: 'Economy dashboard',
  watchlist: 'Watchlist & portfolio', screener: 'Stock screener', calendar: 'Calendar',
  signals: 'Signals', compare: 'Compare view', settings: 'Settings', predict: 'Prediction markets',
};

export function screenLabel(): string {
  const m = (location.hash || '#/').match(/#\/([^/?]*)(?:\/([^/?]+))?/);
  const seg = m ? m[1] : '';
  const name = SCREEN_NAMES[seg] ?? (seg || 'Home');
  const sym = currentSymbol();
  return sym ? `${name} for ${sym}` : name;
}

function themeNow(): string {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/* metadata-only context — always succeeds, never blocks */
export function screenMeta(): ScreenCtx {
  return {
    path: location.hash || '#/',
    screen: screenLabel(),
    symbol: currentSymbol(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    theme: themeNow(),
    ts: Date.now(),
  };
}

/* full capture: metadata + a best-effort downscaled JPEG thumbnail of the current screen.
   The thumbnail is a NICETY — the structured metadata is the source of truth. Charts drawn to
   <canvas> (the terminal) may thumbnail poorly; on any failure we simply return meta with no shot. */
export async function captureScreen(): Promise<ScreenCtx> {
  const meta = screenMeta();
  try {
    // yield a frame so the composer's open animation paints BEFORE the (main-thread-heavy)
    // rasterization runs — the metadata chip is already visible, the thumbnail fills in after
    await new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(null), { timeout: 400 }) : setTimeout(r, 120)));
    const shot = await domToJpeg(document.body, {
      quality: 0.6,
      scale: Math.min(480 / Math.max(1, window.innerWidth), 0.5),   // downscale to ≤480px-ish wide
      backgroundColor: meta.theme === 'light' ? '#ffffff' : '#0b0c0f',
      // keep the composer + dock + wallet chip out of the shot
      filter: (node: any) => !(node instanceof Element && node.closest?.('.fb-panel, .dock-slot, .wchip, .ask-side, .ask-dock-wrap')),
    });
    return (typeof shot === 'string' && shot.length > 64 && shot.length <= 300_000) ? { ...meta, shot } : meta;
  } catch {
    return meta;   // metadata-only fallback
  }
}
