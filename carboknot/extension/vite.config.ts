import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        dashboard: 'src/dashboard/index.html',
        popup: 'src/popup/popup.html'
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 }
  }
});
