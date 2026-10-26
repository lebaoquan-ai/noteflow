import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, './src/core'),
      '@db': resolve(__dirname, './src/db'),
      '@state': resolve(__dirname, './src/state'),
      '@ui': resolve(__dirname, './src/ui'),
      '@ai': resolve(__dirname, './src/ai'),
    },
  },
});
