import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite config for the AC Shunt React frontend.
// - base: './' so the built index.html loads assets via relative URLs
//   when Electron opens it through file://.
// - outDir: 'build' to preserve the path electron-builder + serve:build expect.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.VITE_BACKEND_PORT ?? '8000';
  const backendTarget = `http://127.0.0.1:${backendPort}`;

  return {
    base: './',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      hmr: {
        overlay: false // <-- Added this to disable the malformed URI error overlay
      },
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
        '/ws': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          manualChunks: {
            chart: ['chart.js', 'react-chartjs-2', 'chartjs-plugin-zoom'],
            katex: ['katex', 'react-katex'],
            dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
            gsap: ['gsap'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.js'],
      css: true,
    },
  };
});
