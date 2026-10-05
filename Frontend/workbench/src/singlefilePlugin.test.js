// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The plugin only uses isMatch. Its scoped picomatch alias removes the unpatched
// braces dependency; exercise both the default path and optional include filters.
it.each([[[]], [['assets/app.{js,css}']]])('preserves single-file inlining with patterns %j', inlinePattern => {
  const plugin = viteSingleFile({ inlinePattern });
  const bundle = {
    'index.html': { type:'asset', fileName:'index.html', source:'<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/external.js"></script>' },
    'assets/app.js': { type:'chunk', fileName:'assets/app.js', code:'window.testValue=42;' },
    'assets/app.css': { type:'asset', fileName:'assets/app.css', source:'body{color:red}' },
    'external.js': { type:'chunk', fileName:'external.js', code:'window.externalValue=1;' },
  };
  plugin.generateBundle.call({info:vi.fn()}, {}, bundle);
  expect(bundle['index.html'].source).toContain('window.testValue=42;');
  expect(bundle['index.html'].source).toContain('body{color:red}');
  expect(bundle['assets/app.js']).toBeUndefined();
  expect(bundle['assets/app.css']).toBeUndefined();
  if (inlinePattern.length) {
    expect(bundle['external.js']).toBeDefined();
    expect(bundle['index.html'].source).toContain('src="/external.js"');
  } else expect(bundle['external.js']).toBeUndefined();
});
