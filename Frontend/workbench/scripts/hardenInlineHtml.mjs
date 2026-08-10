import { parseAst } from 'vite';

// ---------------------------------------------------------------------------
// Make a single-file build safe to hand to an HTML sanitiser.
// ---------------------------------------------------------------------------
// Forge ships an app by injecting its HTML into an `<iframe srcdoc>`, filtering
// it on the way in. A browser's own parser is not the problem: inside a
// `<script>` element only the exact sequence `</script` ends the element, and
// vite-plugin-singlefile already escapes that. The problem is everything that
// reads the document *before* the browser does.
//
// The first Forge ship died with `Uncaught SyntaxError: Unexpected identifier
// 'testRecorder'` and a blank page. `testRecorder` is not in our bundle — it is
// Forge's own injected instrumentation — so something upstream had already cut
// our script into pieces and left the tail of one fragment running into the
// head of the next. The bundle gives it plenty to cut on: React ships the
// literal `"<script><\/script>"`, mathjs emits `'<span class="math-...">'` by
// the hundred, and the print path writes a whole `<style>` block into a popup.
// Any scanner looking for `<script`, `<style`, or `-->` rather than running the
// real tokeniser finds those and splits the file in the wrong place.
//
// So: leave nothing to find. Every tag-like sequence in the emitted script is
// rewritten to an escape that means the identical character to a JavaScript
// engine and nothing at all to an HTML scanner.
//
// Escaping cannot be done by search-and-replace, because `<` is also the
// less-than operator and `\x3c` is a syntax error where an operator belongs.
// The rewrite is therefore driven by the parsed AST and touches only the source
// ranges of string literals, template chunks, and regular expressions — the
// only places a `<` can be data rather than code. `assertSanitiserSafe` then
// re-reads the finished HTML and fails the build if anything slipped through,
// so a future dependency cannot quietly reintroduce the fault.

/** Sequences that make a naive HTML scanner think a tag starts or a comment ends. */
const DANGEROUS = ['</', '<script', '<style', '<iframe', '<!--', '-->'];

/** Walk an ESTree tree, visiting every node that carries a `type`. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const value = node[key];
    if (value && typeof value === 'object') walk(value, visit);
  }
}

/**
 * Source ranges holding character data rather than code, sorted and disjoint.
 * A `<` inside one of these can be escaped without changing what the code does.
 */
export function findDataRanges(code) {
  const ranges = [];
  walk(parseAst(code), (node) => {
    if (node.type === 'TemplateElement') {
      ranges.push({ start: node.start, end: node.end, kind: 'template' });
    } else if (node.type === 'Literal') {
      if (node.regex) ranges.push({ start: node.start, end: node.end, kind: 'regex' });
      else if (typeof node.value === 'string') ranges.push({ start: node.start, end: node.end, kind: 'string' });
    }
  });
  ranges.sort((a, b) => a.start - b.start);

  // A string literal cannot contain another, so these should already be
  // disjoint; drop anything nested rather than trusting that and splicing the
  // same bytes twice.
  const disjoint = [];
  let reach = -1;
  for (const range of ranges) {
    if (range.start < reach) continue;
    disjoint.push(range);
    reach = range.end;
  }
  return disjoint;
}

/**
 * Escape tag-like sequences in one span of character data.
 *
 * `\x3c` is `<` to a JavaScript engine in a string, a template chunk, and a
 * regular expression alike. In a regex it is skipped after `(?` and `\k`, where
 * the `<` is regex syntax — a named group or a backreference — and not the
 * character.
 */
function escapeDataSpan(text, kind) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '<') {
      const preceding = text.slice(Math.max(0, i - 2), i);
      if (kind === 'regex' && (preceding === '(?' || preceding === '\\k')) {
        out += char;
        continue;
      }
      out += '\\x3c';
      continue;
    }
    // `-->` only closes a comment once one is open, and `<!--` can no longer
    // survive the rule above — but a sanitiser that scans for the closer alone
    // would still find these, so break them too.
    if (char === '-' && text.startsWith('-->', i)) {
      out += '\\x2d';
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * The literal values a source produces, in source order: what the escaping is
 * required to leave untouched.
 */
function literalValues(code) {
  const values = [];
  walk(parseAst(code), (node) => {
    if (node.type === 'TemplateElement') values.push(['template', node.value.cooked]);
    else if (node.type === 'Literal' && node.regex) values.push(['regex', node.regex.pattern, node.regex.flags]);
    else if (node.type === 'Literal' && typeof node.value === 'string') values.push(['string', node.value]);
  });
  return values;
}

/**
 * Prove the rewrite was value-preserving rather than assuming it.
 *
 * `\x3c` cooks back to `<`, so every string and template chunk must compare
 * exactly equal. A regular expression is compared on its unescaped source and
 * then recompiled, which is what catches the one case where escaping a `<`
 * would change meaning rather than spelling: `(?<name>` and `\k<name>`, where
 * the `<` is grammar. Escaping those yields a pattern that will not compile.
 */
function assertLiteralsUnchanged(before, after) {
  const a = literalValues(before);
  const b = literalValues(after);
  if (a.length !== b.length) {
    throw new Error(`hardenInlineHtml: escaping changed the literal count (${a.length} -> ${b.length})`);
  }
  for (let i = 0; i < a.length; i += 1) {
    const [kind, value, flags] = a[i];
    const [afterKind, afterValue, afterFlags] = b[i];
    if (kind === 'regex') {
      if (afterValue.replaceAll('\\x3c', '<') !== value || afterFlags !== flags) {
        throw new Error(`hardenInlineHtml: escaping altered a regular expression: /${value}/${flags} -> /${afterValue}/${afterFlags}`);
      }
      // Throws if a `<` that was regex grammar got escaped.
      RegExp(afterValue, afterFlags);
      continue;
    }
    if (afterKind !== kind || afterValue !== value) {
      throw new Error(`hardenInlineHtml: escaping altered a ${kind} literal: ${JSON.stringify(value)} -> ${JSON.stringify(afterValue)}`);
    }
  }
}

/**
 * Rewrite a JavaScript source so it contains no tag-like sequence outside of
 * code. Returns the new source and how many characters were escaped.
 */
export function hardenScript(code) {
  const ranges = findDataRanges(code);
  let out = '';
  let cursor = 0;
  let escaped = 0;

  for (const range of ranges) {
    const span = code.slice(range.start, range.end);
    const safe = escapeDataSpan(span, range.kind);
    if (safe !== span) escaped += (safe.length - span.length) / 3;
    out += code.slice(cursor, range.start) + safe;
    cursor = range.end;
  }
  out += code.slice(cursor);

  if (escaped) assertLiteralsUnchanged(code, out);
  return { code: out, escaped };
}

/**
 * CSS has its own escape: `\3c ` is `<` inside a string or identifier. Only
 * tag-like `<` is touched, so a stylesheet using `<` any other way is left
 * alone and caught by the assertion rather than silently rewritten.
 */
export function hardenStyle(css) {
  let escaped = 0;
  const out = css
    .replace(/<(?=[/!?a-zA-Z])/g, () => {
      escaped += 1;
      return '\\3c ';
    })
    .replace(/-->/g, () => {
      escaped += 1;
      return '\\2d ->';
    });
  return { css: out, escaped };
}

/**
 * Locate every `<script>` and `<style>` body in a document, in order.
 *
 * These are raw-text elements: once one opens, nothing inside it is markup
 * until its close tag. Scanning has to respect that, because the bundle itself
 * contains the text `<style>` — resuming the search from the close tag rather
 * than from the next match is what stops a string inside the script from being
 * mistaken for a real stylesheet. It is the same mistake this whole module
 * exists to protect the app from.
 */
function findRawTextBodies(html) {
  const open = /<(script|style)\b[^>]*>/gi;
  const bodies = [];
  let cursor = 0;

  for (;;) {
    open.lastIndex = cursor;
    const match = open.exec(html);
    if (!match) return bodies;

    const tag = match[1].toLowerCase();
    const start = match.index + match[0].length;
    // Searched with a regex rather than `toLowerCase().indexOf` because
    // lowercasing can change a string's length, which would shift every offset
    // after the first such character.
    const close = new RegExp(`</${tag}`, 'i');
    close.lastIndex = 0;
    const found = close.exec(html.slice(start));
    if (!found) throw new Error(`hardenInlineHtml: unclosed <${tag}> in the emitted HTML`);
    const end = start + found.index;

    bodies.push({ tag, start, end });
    cursor = end;
  }
}

/**
 * Fail the build if the finished document still holds a sequence a sanitiser
 * could mistake for markup inside a script or style body. This is the check
 * that matters: the escaping above only covers what the AST classifies as
 * data, so a legal comment (`/*! … *\/`, which esbuild preserves) or a future
 * dependency doing something unforeseen would slip past it silently.
 */
export function assertSanitiserSafe(html) {
  const problems = [];
  for (const body of findRawTextBodies(html)) {
    const text = html.slice(body.start, body.end);
    for (const needle of DANGEROUS) {
      const at = text.indexOf(needle);
      if (at === -1) continue;
      const context = text.slice(Math.max(0, at - 60), at + 60);
      problems.push(`<${body.tag}> body contains ${JSON.stringify(needle)} at offset ${at}: ${JSON.stringify(context)}`);
    }
  }
  if (problems.length) {
    throw new Error(`hardenInlineHtml: emitted HTML is not sanitiser-safe\n  ${problems.join('\n  ')}`);
  }
}

/** Harden every inline script and style in a document. */
export function hardenHtml(html) {
  let out = html;
  let escaped = 0;

  // Rewrite back-to-front so the offsets of the spans still ahead stay valid
  // as escaping grows the text behind them.
  for (const span of findRawTextBodies(out).reverse()) {
    const body = out.slice(span.start, span.end);
    const result = span.tag === 'script' ? hardenScript(body) : hardenStyle(body);
    escaped += result.escaped;
    out = out.slice(0, span.start) + (result.code ?? result.css) + out.slice(span.end);
  }

  assertSanitiserSafe(out);
  return { html: out, escaped };
}

/**
 * Vite plugin wrapper. Must run after vite-plugin-singlefile has inlined the
 * bundle, which means being listed after it — both are `enforce: 'post'`, and
 * `generateBundle` runs in plugin order.
 */
export function hardenInlineHtml() {
  return {
    name: 'harden-inline-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (!chunk.fileName.endsWith('.html') || typeof chunk.source !== 'string') continue;
        const { html, escaped } = hardenHtml(chunk.source);
        chunk.source = html;
        this.info(`${chunk.fileName}: escaped ${escaped} tag-like character(s) for the sanitiser`);
      }
    },
  };
}
