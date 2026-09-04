import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Standalone SharePoint build.
// ---------------------------------------------------------------------------
// Produces a static bundle of the uncertainty module alone, for hosting inside
// a SharePoint site as plain files in a document library. It exists alongside
// the main workbench build (vite.config.mjs) rather than replacing it — the
// Electron/Django product is unaffected.
//
// The module source is shared, not copied. Only the entry point and the
// network boundary differ.
/**
 * Emit the entry as `index.html` rather than `index.standalone.html`.
 *
 * The source file needs a distinct name so it does not collide with the
 * workbench's own index.html, but the deployed artifact should be a plain
 * index.html: SharePoint serves that as a folder's default document, so the
 * hosting web part can be pointed at the folder instead of a long file name.
 */
function emitAsIndexHtml() {
  return {
    name: 'emit-as-index-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entry = bundle['index.standalone.html'];
      if (!entry) return;
      delete bundle['index.standalone.html'];
      entry.fileName = 'index.html';
      bundle['index.html'] = entry;
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the bundle works from whatever library folder it
  // is uploaded into without knowing that path at build time.
  base: './',
  plugins: [react(), emitAsIndexHtml()],
  build: {
    outDir: 'build-standalone',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(process.cwd(), 'index.standalone.html'),
      output: {
        // SharePoint serves these as ordinary library files with no bundling
        // help, so split the heavy, independently-loaded libraries out. The
        // browser caches them separately across deployments of the app code.
        manualChunks: {
          chart: ['chart.js', 'react-chartjs-2', 'chartjs-plugin-zoom'],
          katex: ['katex', 'react-katex'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          gsap: ['gsap'],
        },
      },
    },
    chunkSizeWarningLimit: 2048,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // Same Node-builtin shims the workbench build needs: the DOCX editor's
      // transitive XML parser expects stream.Stream and util.debuglog.
      stream: 'stream-browserify',
      util: 'util',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    css: true,
    testTimeout: 30000,
  },
});
