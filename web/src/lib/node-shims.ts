/* Superseded by vite-plugin-node-polyfills — see vite.config.ts.
 *
 * This file used to assign globalThis.Buffer from the `buffer` package, imported first in
 * main.tsx. That fixed dev and NOT production: manualChunks puts every node_modules module,
 * `buffer` included, into a single `vendor` chunk which is evaluated before the app chunk this
 * shim lived in. Dev worked, prod rendered a blank page, and the console said only "Buffer is
 * not defined" from a minified vendor file.
 *
 * Kept as a stub rather than deleted so the import in main.tsx does not become a merge
 * surprise, and so the next person to hit a Node-global error finds this note instead of
 * re-deriving it. Add nothing here — fix it in the plugin config, which injects per-chunk.
 */
export {};
