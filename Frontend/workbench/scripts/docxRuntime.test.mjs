import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyDocxRuntime } from './docxRuntime.mjs';

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
    addPackage(path.join(scope, 'docx-editor-agents'), '@heyirisai/docx-editor-agents', '1.11.0', 'react.js');
    const nested = path.join(adapter, 'node_modules/@heyirisai/docx-editor-agents');
    addPackage(nested, '@heyirisai/docx-editor-agents', '1.11.0', 'react.js');
    assert.doesNotThrow(() => verifyDocxRuntime(root));
    addPackage(nested, '@heyirisai/docx-editor-agents', '1.12.0', 'react.js');
    assert.throws(() => verifyDocxRuntime(root), /docx-editor-agents@1\.12\.0.*npm ci/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
