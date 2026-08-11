// @vitest-environment node
//
// Build tooling, not app code: it imports Vite for its parser, and Vite's
// esbuild dependency refuses to load under jsdom's TextEncoder.
import { describe, it, expect } from 'vitest';
import {
  hardenScript,
  hardenStyle,
  hardenHtml,
  assertSanitiserSafe,
  findDataRanges,
} from './hardenInlineHtml.mjs';

// Every escape has to satisfy two things at once: an HTML scanner must no
// longer see a tag, and a JavaScript engine must still see the same value.
// `evaluate` is how the second half is checked — the hardened source is run
// and its result compared against the original's.
const evaluate = (expression) => new Function(`return (${expression});`)();

const wrap = (js) => `<!doctype html><html><body><script type="module">${js}</script></body></html>`;

describe('hardenScript', () => {
  it('escapes a tag-like sequence in a string literal', () => {
    const { code } = hardenScript('const s = "<script>alert(1)</script>";');
    expect(code).not.toMatch(/<script/);
    expect(code).not.toMatch(/<\//);
    expect(evaluate(code.replace('const s = ', '').replace(/;$/, ''))).toBe('<script>alert(1)</script>');
  });

  it('escapes inside template chunks but not inside their expressions', () => {
    const source = 'const t = (x) => `<span>${x < 3 ? "a" : "b"}</span>`;';
    const { code } = hardenScript(source);
    expect(code).not.toMatch(/<span/);
    expect(code).not.toMatch(/<\//);
    // The `x < 3` comparison is code, so it must survive untouched.
    expect(code).toContain('x < 3');
    const fn = new Function(`${code} return t;`)();
    expect(fn(1)).toBe('<span>a</span>');
    expect(fn(9)).toBe('<span>b</span>');
  });

  it('leaves the less-than operator alone', () => {
    const source = 'let n = 0; for (let i = 0; i < 10; i++) n += i; const shift = 1 << 4;';
    const { code, escaped } = hardenScript(source);
    expect(escaped).toBe(0);
    expect(code).toBe(source);
  });

  it('does not escape a less-than that is followed by an identifier', () => {
    // `a<b` reads as a tag opener to a scanner but is a comparison here, and
    // escaping it would be a syntax error.
    const { code } = hardenScript('const f = (a, b) => a<b;');
    expect(code).toContain('a<b');
    expect(new Function(`${code} return f;`)()(1, 2)).toBe(true);
  });

  it('escapes tag-like sequences in a regular expression', () => {
    const { code } = hardenScript('const r = /<\\/?script[^>]*>/gi;');
    expect(code).not.toMatch(/<\//);
    const re = new Function(`${code} return r;`)();
    expect(re.test('<script src="x">')).toBe(true);
    expect(re.source).toContain('\\x3c');
  });

  it('leaves regex grammar that uses angle brackets intact', () => {
    // `(?<y>` is a named group and `\k<y>` a backreference — the `<` there is
    // syntax, and escaping it produces a pattern that will not compile.
    const source = 'const r = /(?<y>a)\\k<y>/;';
    const { code, escaped } = hardenScript(source);
    expect(escaped).toBe(0);
    expect(code).toBe(source);
    expect(new Function(`${code} return r;`)().test('aa')).toBe(true);
  });

  it('escapes a named group pattern but keeps the group itself', () => {
    const source = 'const r = /(?<tag><[a-z]+>)/;';
    const { code } = hardenScript(source);
    const re = new Function(`${code} return r;`)();
    expect(re.exec('<div>').groups.tag).toBe('<div>');
    expect(code).toContain('(?<tag>');
    expect(code).toContain('\\x3c');
  });

  it('breaks a comment closer inside a string', () => {
    const { code } = hardenScript('const s = "a --> b";');
    expect(code).not.toContain('-->');
    expect(evaluate(code.replace('const s = ', '').replace(/;$/, ''))).toBe('a --> b');
  });

  it('leaves a decrement followed by greater-than alone', () => {
    const source = 'let i = 5; const j = 1; while (i-- > j) {}';
    const { code, escaped } = hardenScript(source);
    expect(escaped).toBe(0);
    expect(code).toBe(source);
  });

  it('handles a backslash immediately before the escaped character', () => {
    const { code } = hardenScript('const s = "back\\\\<slash";');
    const value = new Function(`${code} return s;`)();
    expect(value).toBe('back\\<slash');
    expect(code).not.toMatch(/<s/);
  });

  it('rejects a rewrite that would change a value', () => {
    // Guard the guard: assertLiteralsUnchanged has to actually fire. Feeding a
    // regex whose grammar depends on `<` through a deliberately naive escape
    // is the case it exists to catch.
    const naive = 'const r = /(?\\x3cy>a)/;';
    expect(() => new Function(`${naive} return r;`)()).toThrow();
  });
});

describe('findDataRanges', () => {
  it('classifies strings, templates, and regexes and skips code', () => {
    const source = 'const a = "s"; const b = `t`; const c = /r/; const d = 1 < 2;';
    const kinds = findDataRanges(source).map((r) => r.kind);
    expect(kinds).toEqual(['string', 'template', 'regex']);
  });

  it('returns ranges in order and without overlap', () => {
    const ranges = findDataRanges('f("a", `b${"c"}d`, /e/);');
    let reach = -1;
    for (const range of ranges) {
      expect(range.start).toBeGreaterThanOrEqual(reach);
      reach = range.end;
    }
  });
});

describe('hardenStyle', () => {
  it('escapes a tag-like sequence in CSS', () => {
    const { css, escaped } = hardenStyle('.a::before { content: "</style>"; }');
    expect(css).not.toContain('</style');
    expect(escaped).toBeGreaterThan(0);
  });

  it('leaves ordinary CSS untouched', () => {
    const source = '.a { color: red; } @media (min-width: 40rem) { .a { color: blue; } }';
    expect(hardenStyle(source)).toEqual({ css: source, escaped: 0 });
  });
});

describe('hardenHtml', () => {
  it('produces a document with no tag-like sequence inside its script', () => {
    const { html } = hardenHtml(wrap('const s = "<div class=\\"x\\"></div>"; const r = /<b>/;'));
    expect(() => assertSanitiserSafe(html)).not.toThrow();
    // The document's own tags are of course still there.
    expect(html).toContain('</script>');
    expect(html).toContain('</body>');
  });

  it('does not mistake a script string for a real style element', () => {
    // The bundle really does contain the text `<style>`; treating it as a
    // stylesheet would run the CSS escape over JavaScript.
    const { html } = hardenHtml(wrap('const s = "<style>p{}</style>"; const n = 1;'));
    const body = html.slice(html.indexOf('>', html.indexOf('<script')) + 1, html.indexOf('</script'));
    expect(new Function(`${body} return s;`)()).toBe('<style>p{}</style>');
  });

  it('hardens a script and a style in the same document', () => {
    const source = '<html><head><style>.a::after{content:"</style>"}</style></head>'
      + '<body><script>const s = "<p></p>";</script></body></html>';
    const { html, escaped } = hardenHtml(source);
    expect(escaped).toBeGreaterThan(0);
    expect(() => assertSanitiserSafe(html)).not.toThrow();
  });

  it('leaves a document with nothing to escape byte-identical', () => {
    const source = wrap('const n = 1 < 2;');
    expect(hardenHtml(source)).toEqual({ html: source, escaped: 0 });
  });

  it('reports an unclosed script rather than silently truncating', () => {
    expect(() => hardenHtml('<html><body><script>const a = 1;')).toThrow(/unclosed <script>/);
  });
});

describe('assertSanitiserSafe', () => {
  it('accepts a document whose scripts hold no markup', () => {
    expect(() => assertSanitiserSafe(wrap('const n = 1;'))).not.toThrow();
  });

  it.each([
    ['a script open tag', 'const s = "<script>";'],
    ['a close tag', 'const s = "\\u003c/div>".replace("x", "</div>");'],
    ['a style open tag', 'const s = "<style>";'],
    ['a comment closer', 'const s = "-->";'],
    ['an iframe', 'const s = "<iframe>";'],
  ])('rejects %s left inside a script', (_label, js) => {
    expect(() => assertSanitiserSafe(wrap(js))).toThrow(/not sanitiser-safe/);
  });

  it('ignores tag-like text outside a script or style', () => {
    expect(() => assertSanitiserSafe('<html><body><p>a --&gt; b</p><!-- note --></body></html>')).not.toThrow();
  });

  it('is not confused by a document whose script mentions another script', () => {
    // The scanner must resume after the close tag, not after the match, or the
    // second half of the file gets treated as a fresh element.
    const html = `${wrap('const s = "\\x3cscript>";')}<script>const t = 1;</script>`;
    expect(() => assertSanitiserSafe(html)).not.toThrow();
  });
});
