// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docxRuntime, repairDocxRuntime, verifyDocxRuntime } from './docxRuntime.mjs';

test('checks the agents version actually resolved by the React adapter', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'docx-runtime-test-'));
  const addPackage = (directory, name, version, main = 'index.js') => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, main }));
    writeFileSync(path.join(directory, main), '');
  };
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { '@heyirisai/docx-editor-react': '1.11.0' },
    }));
    const scope = path.join(root, 'node_modules/@heyirisai');
    const adapter = path.join(scope, 'docx-editor-react');
    addPackage(adapter, '@heyirisai/docx-editor-react', '1.11.0');
    addPackage(path.join(scope, 'docx-editor-core'), '@heyirisai/docx-editor-core', '1.11.0');
    addPackage(path.join(scope, 'docx-editor-i18n'), '@heyirisai/docx-editor-i18n', '1.11.0');
    addPackage(path.join(scope, 'docx-editor-agents'), '@heyirisai/docx-editor-agents', '1.11.0', 'react.js');
    const nested = path.join(adapter, 'node_modules/@heyirisai/docx-editor-agents');
    addPackage(nested, '@heyirisai/docx-editor-agents', '1.11.0', 'react.js');
    const nestedPeer = path.join(adapter, 'node_modules/prosemirror-state');
    addPackage(nestedPeer, 'prosemirror-state', '1.0.0');
    const plugin = docxRuntime({ reuseOptimizer: true });
    const cacheKey = () => plugin.config({ root }, { command: 'serve' }).optimizeDeps.esbuildOptions.define.__WORKBENCH_NOTES_RUNTIME_HASH__;
    const initial = cacheKey();
    assert.equal(cacheKey(), initial);
    writeFileSync(path.join(nested, 'react.js'), '// offline replacement');
    const replaced = cacheKey();
    assert.notEqual(replaced, initial);
    writeFileSync(path.join(nestedPeer, 'index.js'), '// replaced editor peer');
    assert.notEqual(cacheKey(), replaced);
    assert.equal(plugin.config({ root }, { command: 'build' }), undefined);
    addPackage(nested, '@heyirisai/docx-editor-agents', '1.12.0', 'react.js');
    assert.throws(
      () => verifyDocxRuntime(root),
      /docx-editor-agents@1\.12\.0.*npm run repair:notes/,
    );
    assert.deepEqual(repairDocxRuntime(root), ['@heyirisai/docx-editor-agents@1.12.0']);
    assert.doesNotThrow(() => verifyDocxRuntime(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
