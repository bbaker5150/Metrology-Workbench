// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import {
  forgeHash,
  loadForgeRuntime,
  buildManifest,
  applyForgeRuntime,
  EXPECTED_HASHES,
} from './forgeRuntime.mjs';

// The reference values below come from a real artifact Forge shipped on
// 2026-08-10. They are what makes this more than a self-consistency check: the
// hash algorithm was recovered by matching candidates against those two
// published hashes, so reproducing them is the evidence it was recovered right.
const FORGE = {
  manifest:
    'eyJ2ZXJzaW9uIjoxLCJwcm9qZWN0IjoiUHJvamVjdCIsImdlbmVyYXRlZCI6IjIwMjYtMDgtMTBUMTk6MjM6MDkuOTY4WiIsImluZGV4IjoidW5jZXJ0YWludHktYnVkZ2V0Lmh0bWwiLCJmaWxlcyI6W3sia2luZCI6ImpzIiwicGF0aCI6ImRldmNvbnNvbGUuanMiLCJleHRlcm5hbCI6ZmFsc2UsImhhc2giOiJjNmM5MDViNyJ9LHsia2luZCI6ImpzIiwicGF0aCI6InRlc3RSZWNvcmRlci5qcyIsImV4dGVybmFsIjpmYWxzZSwiaGFzaCI6IjQ0ZWY0Y2VjIn1dfQ==',
  project: 'Project',
  generated: '2026-08-10T19:23:09.968Z',
  index: 'uncertainty-budget.html',
};

const page = (body = '<div id="root"></div>') =>
  `<!doctype html>\n<html lang="en">\n  <head>\n    <title>t</title>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>\n`;

const runtime = () => [
  { name: 'devconsole.js', source: 'window.__PseudoDevConsole = 1;', hash: 'aaaaaaaa' },
  { name: 'testRecorder.js', source: 'window.__rec = 1;', hash: 'bbbbbbbb' },
];

// Fixtures carry the real filenames (the manifest records them) but not the
// real bytes, so the hash guard is pointed at the fixture's own hashes here and
// exercised deliberately in its own test below.
const apply = (html, extra = {}) =>
  applyForgeRuntime(html, {
    index: 'uncertainty-budget.html',
    project: 'Uncertainty Budget',
    generated: '2026-01-01T00:00:00.000Z',
    files: runtime(),
    expectedHashes: {},
    ...extra,
  });

describe('forgeHash', () => {
  it('reproduces the hashes Forge published for its own runtime', () => {
    const files = loadForgeRuntime();
    expect(Object.fromEntries(files.map((f) => [f.name, f.hash]))).toEqual(EXPECTED_HASHES);
  });

  it('is stable and case-sensitive', () => {
    expect(forgeHash('abc')).toBe(forgeHash('abc'));
    expect(forgeHash('abc')).not.toBe(forgeHash('abC'));
  });

  it('notices a single changed byte, which is the point of asserting it', () => {
    const [dev] = loadForgeRuntime();
    expect(forgeHash(`${dev.source} `)).not.toBe(dev.hash);
  });

  it('is always eight hex digits', () => {
    for (const s of ['', 'a', 'x'.repeat(5000), 'é中']) {
      expect(forgeHash(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('buildManifest', () => {
  it('reproduces a real Forge manifest byte for byte', () => {
    const comment = buildManifest({
      files: [
        { name: 'devconsole.js', hash: 'c6c905b7' },
        { name: 'testRecorder.js', hash: '44ef4cec' },
      ],
      index: FORGE.index,
      project: FORGE.project,
      generated: FORGE.generated,
    });
    expect(comment).toBe(`<!--WFC-MANIFEST:${FORGE.manifest}-->\n`);
  });

  it('decodes to the shape Forge uses', () => {
    const comment = buildManifest({ files: runtime(), index: 'i.html', project: 'P', generated: 'G' });
    const decoded = JSON.parse(Buffer.from(/:(.*)-->/.exec(comment)[1], 'base64').toString());
    expect(decoded).toEqual({
      version: 1,
      project: 'P',
      generated: 'G',
      index: 'i.html',
      files: [
        { kind: 'js', path: 'devconsole.js', external: false, hash: 'aaaaaaaa' },
        { kind: 'js', path: 'testRecorder.js', external: false, hash: 'bbbbbbbb' },
      ],
    });
  });
});

describe('applyForgeRuntime', () => {
  it('puts the manifest on the first line, ahead of the doctype', () => {
    const out = apply(page());
    expect(out.startsWith('<!--WFC-MANIFEST:')).toBe(true);
    expect(out.indexOf('<!doctype html>')).toBe(out.indexOf('-->\n') + 4);
  });

  it('runs devconsole before the app, since it patches console and fetch', () => {
    const out = apply(page().replace('<title>t</title>', '<script type="module">APP</script>'));
    expect(out.indexOf('window.__PseudoDevConsole')).toBeLessThan(out.indexOf('APP'));
  });

  it('runs testRecorder last, before </body>', () => {
    const out = apply(page());
    expect(out.indexOf('window.__rec')).toBeGreaterThan(out.indexOf('<div id="root">'));
    expect(out.indexOf('window.__rec')).toBeLessThan(out.indexOf('</body>'));
  });

  it('injects both sources verbatim', () => {
    const out = apply(page());
    for (const file of runtime()) expect(out).toContain(file.source);
  });

  it('leaves the original document intact', () => {
    const out = apply(page());
    expect(out).toContain('<div id="root"></div>');
    expect(out).toContain('<html lang="en">');
    expect((out.match(/<\/body>/g) || [])).toHaveLength(1);
  });

  it('records our build stamp outside Forge\'s schema', () => {
    // Versioning is ours to control; Forge's manifest keys stay as Forge
    // defines them so nothing parsing it has to cope with extra fields.
    const out = apply(page(), { build: 'main@abc1234' });
    expect(out).toContain('<meta name="x-uncertainty-build" content="main@abc1234" />');
    expect(out).toContain('window.__UNCERTAINTY_BUILD__="main@abc1234"');
    const decoded = JSON.parse(Buffer.from(/WFC-MANIFEST:(.*?)-->/.exec(out)[1], 'base64').toString());
    expect(Object.keys(decoded)).toEqual(['version', 'project', 'generated', 'index', 'files']);
  });

  it('escapes a quote in the build stamp rather than breaking the meta tag', () => {
    const out = apply(page(), { build: 'a"b' });
    expect(out).toContain('content="a&quot;b"');
  });

  it('omits the stamp entirely when there is no build to record', () => {
    expect(apply(page())).not.toContain('x-uncertainty-build');
  });

  it('refuses a runtime whose bytes no longer match its published hash', () => {
    // The guard against a refreshed or reformatted vendor file silently
    // shipping alongside a manifest that describes the old one.
    const tampered = [{ name: 'devconsole.js', source: 'x', hash: 'deadbeef' }, runtime()[1]];
    expect(() => apply(page(), { files: tampered, expectedHashes: EXPECTED_HASHES }))
      .toThrow(/hashes to deadbeef, expected c6c905b7/);
  });

  it('reports a document it cannot inject into', () => {
    expect(() => apply('<p>no head here</p>')).toThrow(/no <head>/);
    expect(() => apply('<html><head></head></html>')).toThrow(/no <\/body>/);
  });

  it('is idempotent in shape when run on a document that already has a body', () => {
    const once = apply(page());
    expect((once.match(/WFC-MANIFEST/g) || [])).toHaveLength(1);
  });
});

describe('a Windows checkout', () => {
  // Git for Windows rewrites LF to CRLF on checkout unless told not to, and
  // these bytes are hashed into the manifest. It broke a real build: the guard
  // reported devconsole.js hashing to 7cd1d957 instead of c6c905b7. The vendor
  // directory has a .gitattributes now, and loading normalises regardless, so
  // the build no longer depends on the checkout being configured correctly.
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(nodePath.join(tmpdir(), 'forge-crlf-'));
    for (const name of ['devconsole.js', 'testRecorder.js']) {
      const lf = readFileSync(nodePath.join('vendor/forge', name), 'utf8');
      writeFileSync(nodePath.join(dir, name), lf.replace(/\n/g, '\r\n'));
    }
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('still produces the hashes Forge published', () => {
    const files = loadForgeRuntime(dir);
    expect(Object.fromEntries(files.map((f) => [f.name, f.hash]))).toEqual(EXPECTED_HASHES);
  });

  it('would fail without the normalisation, which is why it is tested', () => {
    const crlf = readFileSync(nodePath.join(dir, 'devconsole.js'), 'utf8');
    expect(crlf).toContain('\r\n');
    expect(forgeHash(crlf)).toBe('7cd1d957');
    expect(forgeHash(crlf)).not.toBe(EXPECTED_HASHES['devconsole.js']);
  });

  it('builds a page from a CRLF checkout without complaint', () => {
    const out = applyForgeRuntime(page(), {
      index: 'uncertainty-budget.html',
      project: 'P',
      generated: 'G',
      files: loadForgeRuntime(dir),
    });
    expect(out.startsWith('<!--WFC-MANIFEST:')).toBe(true);
    // And emits the same bytes a LF checkout would, so CI and a workstation agree.
    const fromLf = applyForgeRuntime(page(), {
      index: 'uncertainty-budget.html', project: 'P', generated: 'G', files: loadForgeRuntime(),
    });
    expect(out).toBe(fromLf);
  });
});

describe('the vendored runtime', () => {
  it('is present and non-trivial', () => {
    for (const file of loadForgeRuntime()) {
      expect(file.source.length).toBeGreaterThan(10000);
    }
  });

  it('installs the globals the host page looks for', () => {
    const [dev] = loadForgeRuntime();
    expect(dev.source).toContain('__PseudoDevConsole');
    expect(dev.source).toContain('wct-devconsole-button');
  });
});
