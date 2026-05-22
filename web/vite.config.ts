import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@bvp/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3030',
      '/uploads': 'http://localhost:3030',
      '/healthz': 'http://localhost:3030',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
