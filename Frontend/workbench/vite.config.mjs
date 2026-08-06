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
      allowedHosts: ['.trycloudflare.com'],
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
        // The DOCX editor's transitive SAX parser expects Node's legacy
        // `stream.Stream` constructor. In browser/Electron builds Vite would
        // otherwise externalize `stream` as an empty compatibility module,
        // causing the Notes route to fail during module initialization.
        stream: 'stream-browserify',
        // The same XML dependency relies on util.debuglog/inspect. Use the
        // browser implementation rather than Vite's empty Node shim.
        util: 'util',
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.js'],
      css: true,
      // Several statistical validation tests intentionally run tens of
      // thousands of deterministic Monte Carlo trials. They complete in a
      // few seconds in isolation, but can exceed Vitest's 5 s default while
      // the full suite is sharing CPU. Preserve their full assertions and
      // sample counts while allowing realistic CI/workstation contention.
      testTimeout: 30000,
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'text', 'html', 'lcov', 'json-summary'],
        reportsDirectory: './coverage',
        // Report on every source file, not just the ones a test happened to
        // import. Without this an untested module simply disappears from the
        // report and inflates the percentages.
        all: true,
        include: ['src/**/*.{js,jsx}'],
        exclude: [
          'src/**/*.test.{js,jsx}',
          'src/setupTests.js',
          'src/index.jsx',
          'src/**/assets/**',
          // Presentational 3D/scene wrappers are WebGL-only; jsdom cannot
          // execute them meaningfully and mocking them would assert nothing.
          'src/app/LauncherEmblem.jsx',
        ],
      },
    },
  };
});
