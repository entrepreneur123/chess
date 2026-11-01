import { defineConfig } from 'vite';
export default defineConfig({ root: __dirname, publicDir: '../public', base: './', server: { port: 5199, strictPort: true, fs: { allow: ['..'] } } });
