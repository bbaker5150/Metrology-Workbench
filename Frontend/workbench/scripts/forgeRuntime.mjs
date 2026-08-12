import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hardenScript } from './hardenInlineHtml.mjs';

// ---------------------------------------------------------------------------
// Do Forge's ship step at build time.
// ---------------------------------------------------------------------------
// Forge is a scaffolding tool for people building apps without a repository.
// Its "ship" step is not a security control and does not sign anything — it
// inlines two runtime scripts and prepends a manifest comment. Reproducing that
// in the build is what lets a push to `main` produce a finished, deployable
// file with no workstation in the loop.
//
// The host page renders the "Not Secured" banner by looking for the globals
// those scripts install, which is why including them settles it. See
// vendor/forge/README.md for the provenance of the vendored bytes.
//
// Ordering matters twice over:
//
//   - devconsole patches `console` and `fetch`, so it goes at the top of
//     <head>, ahead of the app bundle. testRecorder goes before </body>.
//   - This plugin runs after hardenInlineHtml has finished with the app
//     bundle, and hardens the vendored runtime itself on the way in. Forge
//     inlines those bytes raw and ships a broken regex because of it — see
//     inlineScript below.

const VENDOR = path.resolve(process.cwd(), 'vendor/forge');

/**
 * Forge's manifest hash: djb2-xor over UTF-16 code units, as 32-bit hex.
 *
 * Recovered from a shipped artifact by matching the two published hashes
 * against candidate algorithms. Non-cryptographic — it is a bookkeeping
 * checksum, in the same family as a hash-table function.
 */
export function forgeHash(text) {
  let hash = 5381;
  for (const char of text) hash = (Math.imul(hash, 33) ^ char.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The vendored runtime, with the hashes its manifest entry must carry. */
export function loadForgeRuntime(dir = VENDOR) {
  return ['devconsole.js', 'testRecorder.js'].map((name) => {
    const source = readFileSync(path.join(dir, name), 'utf8');
    return { name, source, hash: forgeHash(source) };
  });
}

/**
 * The hashes of the runtime as vendored. Asserted on every build so a refreshed
 * or accidentally reformatted file fails here rather than shipping a page whose
 * manifest disagrees with its own contents.
 */
export const EXPECTED_HASHES = {
  'devconsole.js': 'c6c905b7',
  'testRecorder.js': '44ef4cec',
};

export function buildManifest({ files, index, project, generated }) {
  // Key order follows Forge's own output, in case anything parses it strictly.
  const manifest = {
    version: 1,
    project,
    generated,
    index,
    files: files.map((f) => ({ kind: 'js', path: f.name, external: false, hash: f.hash })),
  };
  return `<!--WFC-MANIFEST:${Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64')}-->\n`;
}

/**
 * Inline one runtime file.
 *
 * The bytes are *not* copied verbatim, and that is deliberate. Forge inlines
 * them raw, and its own shipped apps are broken by it: testRecorder.js writes
 * `/[<>:"/\|?*\x00-\x1f]/` with the control characters themselves, and the HTML
 * tokeniser rewrites a raw NUL inside a `<script>` to U+FFFD, so every Forge
 * app throws "Range out of order in character class" on load.
 *
 * Running the source through the same AST-driven escaper the app bundle uses
 * fixes that: it only rewrites inside string, template, and regex literals, and
 * it re-reads the result to prove every literal still carries the same value.
 * The manifest hash describes the vendored *file*, which is untouched — this is
 * how the file is rendered into the page, not what it is.
 */
const inlineScript = (source) => `<script>\n${hardenScript(source).code}\n</script>\n`;

/**
 * Inject the runtime and manifest into a finished single-file document.
 *
 * @param {string} html
 * @param {object} options
 * @param {string} options.index    filename the manifest reports as the entry
 * @param {string} options.project  project name for the manifest
 * @param {string} options.generated ISO timestamp for the manifest
 * @param {string} [options.build]  our own build stamp, recorded separately so
 *   versioning does not depend on Forge's schema
 * @param {Array}  [options.files]  runtime override, for tests
 * @param {object} [options.expectedHashes] hashes to enforce; defaults to the
 *   published ones, and tests pass their own so a fixture does not have to
 *   impersonate the real runtime to exercise the injection
 */
export function applyForgeRuntime(html, {
  index,
  project,
  generated,
  build,
  files = loadForgeRuntime(),
  expectedHashes = EXPECTED_HASHES,
}) {
  for (const file of files) {
    const expected = expectedHashes[file.name];
    if (expected && file.hash !== expected) {
      throw new Error(
        `forgeRuntime: vendor/forge/${file.name} hashes to ${file.hash}, expected ${expected}. `
          + 'If the runtime was refreshed on purpose, update EXPECTED_HASHES; otherwise the file has been '
          + 'reformatted and its manifest entry would be wrong.',
      );
    }
  }

  const [devconsole, testRecorder] = files;

  const headAt = html.search(/<head\b[^>]*>/i);
  if (headAt === -1) throw new Error('forgeRuntime: no <head> to inject into');
  const headEnd = html.indexOf('>', headAt) + 1;

  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose === -1) throw new Error('forgeRuntime: no </body> to inject before');

  // Our own provenance, kept out of Forge's schema so nothing there has to be
  // reinterpreted. This is the stamp that answers "which build is live?".
  const stamp = build
    ? `<meta name="x-uncertainty-build" content="${String(build).replace(/"/g, '&quot;')}" />\n`
      + `<script>window.__UNCERTAINTY_BUILD__=${JSON.stringify(String(build))};</script>\n`
    : '';

  const withHead = html.slice(0, headEnd)
    + '\n' + inlineScript(devconsole.source) + stamp
    + html.slice(headEnd);

  const shifted = bodyClose + (withHead.length - html.length);
  const withBoth = withHead.slice(0, shifted) + inlineScript(testRecorder.source) + withHead.slice(shifted);

  return buildManifest({ files, index, project, generated }) + withBoth;
}

/**
 * Vite plugin. Must be listed after hardenInlineHtml — see the header.
 */
export function forgeRuntime({ project = 'Uncertainty Budget', build } = {}) {
  return {
    name: 'forge-runtime',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (!chunk.fileName.endsWith('.html') || typeof chunk.source !== 'string') continue;
        chunk.source = applyForgeRuntime(chunk.source, {
          index: chunk.fileName,
          project,
          generated: new Date().toISOString(),
          build,
        });
        this.info(`${chunk.fileName}: injected the Forge runtime${build ? ` (build ${build})` : ''}`);
      }
    },
  };
}
