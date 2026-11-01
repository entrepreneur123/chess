import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths so the build works inside the Capacitor Android WebView
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
