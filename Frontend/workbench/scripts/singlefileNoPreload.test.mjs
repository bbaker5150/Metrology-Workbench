// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { singlefileNoPreload } from './singlefileNoPreload.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixtureBuild({ fixed = true, modulePreload = false, inline = true, cssCodeSplit = false, imports = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'singlefile-preload-'));
  roots.push(root);
  await Promise.all([
    writeFile(path.join(root, 'index.html'), '<html><head></head><body><script type="module" src="/main.js"></script></body></html>'),
    writeFile(path.join(root, 'main.js'), imports ? `
      import './style.css';
      import { __vitePreload as localPreload } from 'fixture:helper';
      globalThis.loadFixture = () => import('./lazy.js').then(module => module.answer);
      globalThis.failFixture = () => localPreload(() => Promise.reject(new Error('fixture rejection')));
    ` : "import './style.css'; globalThis.fixturePrefix = true;"),
    writeFile(path.join(root, 'lazy.js'), 'globalThis.fixtureEffect = (globalThis.fixtureEffect || 0) + 1; export const answer = 42;'),
    writeFile(path.join(root, 'style.css'), 'body { color: navy; }'),
  ]);
  const result = await build({
    // Absolute base avoids import.meta.url in the unfixed Vite helper so the
    // emitted script can be evaluated directly in a no-eval VM. Both link
    // probes and the real dynamic-import transform are unchanged by the base.
    root, configFile: false, logLevel: 'silent', base: '/',
    plugins: [
      ...(fixed ? [singlefileNoPreload()] : []),
      {
        name: 'fixture-helper',
        resolveId(id) { if (id === 'fixture:helper') return '\0vite/preload-helper.js'; },
        // Bundles can have other generated helpers before Vite's polyfill. This
        // makes the inliner's start-of-script removal regex miss the real bug.
        renderChunk(code) { return { code: `globalThis.fixturePrefix = true;\n${code}`, map: null }; },
      },
      ...(inline ? [viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: true })] : []),
    ],
    build: {
      write: false, minify: false, modulePreload, cssCodeSplit,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  return result.output.find(file => file.fileName === 'index.html').source;
}

function evaluate(html) {
  const events = [];
  const document = { createElement(tag) { throw new Error(`Forbidden element: ${tag}`); } };
  const context = vm.createContext({ document, Event, window: { dispatchEvent(event) { events.push(event); } } },
    { codeGeneration: { strings: false, wasm: false } });
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    vm.runInContext(match[1], context);
  }
  return { context, events };
}

describe('single-file import helper under a no-link host', () => {
  it.each([true, false])('reproduces Vite link creation with modulePreload:%s before the fix', async modulePreload => {
    const html = await fixtureBuild({ fixed: false, modulePreload });
    expect(() => evaluate(html)).toThrow('Forbidden element: link');
  });

  it('boots without DOM probes and evaluates real inlined imports with their side effects', async () => {
    const html = await fixtureBuild();
    expect(html).not.toMatch(/<link\b|<script\b[^>]*\bsrc=/i);
    const { context } = evaluate(html);
    expect(context.fixturePrefix).toBe(true);
    await expect(context.loadFixture()).resolves.toBe(42);
    await expect(context.loadFixture()).resolves.toBe(42);
    expect(context.fixtureEffect).toBe(1);
  });

  it('preserves rejected imports and the cancelable vite:preloadError event', async () => {
    const { context, events } = evaluate(await fixtureBuild());
    await expect(context.failFixture()).rejects.toThrow('fixture rejection');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('vite:preloadError');
    expect(events[0].payload.message).toBe('fixture rejection');
    context.window.dispatchEvent = event => event.preventDefault();
    await expect(context.failFixture()).resolves.toBeUndefined();
  });

  it('rejects build configuration that would need CSS preloading', async () => {
    await expect(fixtureBuild({ cssCodeSplit: true })).rejects.toThrow('cssCodeSplit:false');
  });

  it('rejects output with JS/CSS left outside the HTML', async () => {
    await expect(fixtureBuild({ inline: false })).rejects.toThrow('all JavaScript and CSS');
  });

  it('fails closed if the expected Vite helper is never intercepted', async () => {
    await expect(fixtureBuild({ imports: false })).rejects.toThrow('did not intercept the Vite import helper');
  });
});
