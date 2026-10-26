import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const serverPort = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  root: 'client',
  publicDir: false,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
} as never);
