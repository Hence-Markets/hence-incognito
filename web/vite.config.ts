import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Dev: Vite serves the React app and proxies /api/* to the existing serve.py (port 4317),
// which holds the secret keys and talks to Hydromancer / FMP / DeepSeek / Polymarket.
// So the key-security model and the whole proxy layer are reused unchanged.
export default defineConfig(() => ({
  // the app is served at the ROOT of app.hence.markets (serve.py host-routes the
  // landing to hence.markets); legacy /app/* URLs are 301-stripped server-side
  base: '/',
  plugins: [
    react(),
    /* @inco/lightning-js is written for Node and reaches for `Buffer`. Vite polyfills nothing,
       so in the browser that throws from inside the SDK — and it did, twice, at the two moments
       that matter: zap.encrypt (every order) and zap.attestedReveal (reading the published
       aggregate).

       A hand-written shim imported first in main.tsx fixed DEV and not PROD. manualChunks below
       puts every node_modules module — including `buffer` itself — into one `vendor` chunk, and
       that chunk is evaluated before the app chunk that held the shim. The result was a blank
       page in production while dev worked perfectly, which is the worst version of this bug.

       This plugin injects the polyfill into whichever chunks actually reference the global, so
       chunk ordering stops mattering.

       exclude: ['fs'] is load-bearing. The SDK imports `fs/promises` for a local-node helper
       the browser never calls, and the fs polyfill maps fs → empty.js, then resolves
       fs/promises to `empty.js/promises` — not a directory — which fails the build outright.
       Vite already handled that import fine before this plugin existed. */
    nodePolyfills({
      exclude: ['fs'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: false,
    }),
  ],
  server: {
    host: '127.0.0.1', // bind IPv4 so localhost (and readiness probes) resolve consistently
    port: 5180,
    proxy: {
      // 127.0.0.1 (not "localhost") so Node doesn't resolve to ::1 and miss serve.py's IPv4 listener
      // Market data comes from the EXISTING Hence backend, read-only and unchanged — the
      // fork needs prices, news and books, and standing up a second copy of that would be
      // pure duplication. It does not breach the repo boundary: nothing is written, and
      // serve.py is not modified.
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true },
      // The Incognito keeper gets its OWN prefix so the two backends can never collide.
      '/inc': { target: 'http://127.0.0.1:4400', changeOrigin: true, rewrite: (p) => p.replace(/^\/inc/, '/api') },
    },
  },
  build: {
    outDir: 'dist',
    // Production bundles are public; do not publish original source trees and comments.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split only the independent, leaf-ish heavy lib (lightweight-charts, terminal-only).
        // Keep React + react-query + Privy/viem/walletconnect together in ONE vendor chunk:
        // splitting react out from libs that import it (Privy, react-query) creates a
        // cross-chunk init-order cycle that breaks the minified prod build (dev is unaffected).
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lightweight-charts')) return 'charts';
            return 'vendor';
          }
        },
      },
    },
  },
}));
