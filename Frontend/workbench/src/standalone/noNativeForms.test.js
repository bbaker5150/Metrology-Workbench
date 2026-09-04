// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Nothing that ships to SharePoint may rely on native form submission.
// ---------------------------------------------------------------------------
// Firepit, the sanitiser in front of the Forge-hosted app, blocks it outright —
// including the implicit submission a <button> performs inside a form without
// `type="button"`. A form that works everywhere else fails silently there: the
// click lands, nothing happens, and there is no error to notice.
//
// This is a source check rather than a render test because that is the shape of
// the rule. The constraint is on the markup the module is allowed to contain at
// all, not on how any one component behaves once mounted, and a render test
// would only cover the components someone remembered to write one for.
//
// Enter-to-submit is provided instead by utils/submitOnEnter.js.

const ROOT = path.resolve(import.meta.dirname, '..');
const SHIPPED = ['modules/uncertainty', 'standalone'];

const sources = SHIPPED.flatMap((dir) => globSync(`${dir}/**/*.{js,jsx}`, { cwd: ROOT }))
  .filter((file) => !/\.test\.[jt]sx?$/.test(file))
  .sort();

// Comments go first, or every note explaining *why* there is no `<form>` here
// reads as one. `//` after a colon is a URL, not a comment.
const code = (file) => readFileSync(path.join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const offenders = (pattern) => sources.filter((file) => pattern.test(code(file)));

describe('the SharePoint-hosted module', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('contains no form element', () => {
    expect(offenders(/<form[\s>]/)).toEqual([]);
  });

  it('contains no submit or reset button', () => {
    expect(offenders(/type=["'](submit|reset)["']/)).toEqual([]);
  });
});
