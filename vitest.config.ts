import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
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
