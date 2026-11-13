import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.SALAMIFOCUS_SERVER_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  // PowerSync ships its own workers and WebAssembly, which Vite must not pre-bundle.
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    hmr: process.env.WEB_HMR !== 'false',
    proxy: {
      '/api': server,
      '/powersync': server,
    },
  },
});
