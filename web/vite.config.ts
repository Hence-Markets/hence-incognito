import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // the API lives in the keeper service; proxy in dev so the browser sees one origin
    proxy: { '/api': { target: 'http://localhost:4400', changeOrigin: true } },
  },
});
