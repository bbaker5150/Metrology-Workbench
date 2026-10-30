import { createDocumentWithText } from '@heyirisai/docx-editor-core';

// Literal newlines in a DOCX text run are not paragraph breaks. The layout
// engine measures that run as one line, causing subsequent lines to overlap.
export function createNotesDocument(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const document = createDocumentWithText(lines[0]);
  document.package.document.content = lines.flatMap(line =>
    createDocumentWithText(line).package.document.content);
  return document;
}
