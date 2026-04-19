import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Web-only build of the dashboard for hosting at carboknot.us as a public demo.
// This config intentionally OMITS @crxjs/vite-plugin so the output is a
// standalone static site (no Chrome extension manifest, no service worker).
// At runtime the dashboard detects it is not in an extension context
// (see src/dashboard/lib/env.ts) and falls back to seed data + DEMO chip.
export default defineConfig({
  root: path.resolve(__dirname, 'src/dashboard'),
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    target: 'es2022',
    outDir: path.resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    sourcemap: false
  },
  preview: {
    port: 4173,
    strictPort: true
  }
});
