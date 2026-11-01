import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './', // relative paths so the build works inside the Capacitor Android WebView
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Multi-page build: the game at / and the marketing landing page at /landing/.
      input: {
        main: resolve(root, 'index.html'),
        landing: resolve(root, 'landing/index.html'),
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
