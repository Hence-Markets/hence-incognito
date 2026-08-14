/* Where "the rest of Hence" lives.
 *
 * Incognito is TWO SCREENS — the landing and the terminal — and nothing else. It is a fork of
 * the whole Hence app, so every other route still exists in the bundle and every dock button
 * still links to one. Left alone, a user clicking Home lands on a Dashboard that is a stale
 * copy of the real product: same markup, different deployment, quietly diverging from
 * app.hence.markets from the day this repo was cut.
 *
 * So every route except the terminal leaves for the real app, carrying the same path. Clicking
 * Portfolio in incognito puts you on Portfolio in Hence, not on a lookalike that nobody
 * maintains.
 */

/** Override per-environment; defaults to production Hence. */
export const MAIN_APP = (import.meta.env.VITE_MAIN_APP ?? 'https://app.hence.markets').replace(/\/$/, '');

/** The same screen, over there. `#/portfolio` here → `app.hence.markets/#/portfolio`. */
export function mainAppUrl(hashPath?: string): string {
  const p = (hashPath ?? '').replace(/^#?\/?/, '');
  return p ? `${MAIN_APP}/#/${p}` : `${MAIN_APP}/`;
}

/** The main app's own terminal, for the toggle in the incognito terminal's header. */
export const mainTerminalUrl = (sym?: string | null) =>
  mainAppUrl(sym ? `terminal/${String(sym).toUpperCase()}` : 'terminal');
