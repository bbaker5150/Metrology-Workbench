import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { hardenInlineHtml } from './scripts/hardenInlineHtml.mjs';
import { forgeRuntime } from './scripts/forgeRuntime.mjs';
import { execSync } from 'node:child_process';

// Stamped into the page so anyone can tell which build is live — the file is
// overwritten in place in SharePoint, so its URL says nothing about its age.
const buildStamp = () => {
  if (process.env.BUILD_STAMP) return process.env.BUILD_STAMP;
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${sha} ${new Date().toISOString().slice(0, 16)}Z`;
  } catch {
    return `local ${new Date().toISOString().slice(0, 16)}Z`;
  }
};

// ---------------------------------------------------------------------------
// Single-file build, for shipping through Forge.
// ---------------------------------------------------------------------------
// Forge renders an app by injecting its HTML into an `<iframe srcdoc>` (and
// sanitising it on the way in — it strips href attributes off preload links).
// A srcdoc document has no URL of its own, so relative paths have nothing to
// resolve against and every chunk, font, and image request fails.
//
// The only shape that survives that container is one HTML file with zero
// subresource requests: all JavaScript and CSS inlined, and every font and
// image embedded as a data URI. That is what this config produces.
//
// It is a deliberately worse build than vite.standalone.config.mjs — no code
// splitting, no lazy loading, everything downloaded up front — and exists only
// because the hosting container requires it. Prefer the standalone build
// anywhere the app can be served from a real URL.

const projectRoot = process.cwd();

export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteSingleFile({ removeViteModuleLoader: true }),
    // Must follow viteSingleFile: it rewrites the bundle *after* it has been
    // inlined, so that nothing in the document can be mistaken for markup by
    // whatever reads it before the browser does. See the module header.
    hardenInlineHtml(),
    {
      // The generated file is index.html by default; give it a name that says
      // what it is, since it gets uploaded somewhere on its own.
      name: 'name-single-file-output',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const entry = bundle['index.standalone.html'];
        if (!entry) return;
        delete bundle['index.standalone.html'];
        entry.fileName = 'uncertainty-budget.html';
        bundle['uncertainty-budget.html'] = entry;
      },
    },
    // Last, and after the rename so the manifest names the file it ships as.
    // Also after hardenInlineHtml deliberately: the vendored runtime must not
    // be rewritten, or its bytes stop matching the hashes in the manifest.
    forgeRuntime({ build: buildStamp() }),
  ],
  // Nothing in public/ can be reached from a srcdoc frame, so copying it beside
  // the output would only be a trap: 6.5 MB of files that look like part of the
  // deliverable and are not. The one thing this build still needs from there,
  // the seal image, is imported as a module asset and inlined.
  publicDir: false,
  build: {
    outDir: 'build-singlefile',
    emptyOutDir: true,
    // Inline every asset regardless of size. Anything left on disk would be a
    // request the srcdoc frame cannot make.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(projectRoot, 'index.standalone.html'),
      output: {
        // Required for a single file: collapse the lazy routes into the one
        // bundle rather than emitting separate chunks.
        inlineDynamicImports: true,
      },
    },
    chunkSizeWarningLimit: 16384,
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(projectRoot, 'src') },
      { find: 'stream', replacement: 'stream-browserify' },
      { find: 'util', replacement: 'util' },
      // The header medallion calls useGLTF, which fetches 3demblem.glb at
      // runtime — impossible with no URL to fetch from. Aliasing the 3D
      // packages to a stub drops three.js from the bundle (~1 MB that would
      // otherwise be inlined as base64) and leaves the static seal image
      // showing, which is what the component already renders underneath.
      { find: /^@react-three\/fiber$/, replacement: path.resolve(projectRoot, 'src/standalone/stubs/threeStub.jsx') },
      { find: /^@react-three\/drei$/, replacement: path.resolve(projectRoot, 'src/standalone/stubs/threeStub.jsx') },
    ],
  },
});
