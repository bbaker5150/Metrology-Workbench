// @vitest-environment node
import { test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createDocx, createDocumentWithText, parseDocx, repackDocx } from '@heyirisai/docx-editor-core';
import { verifyDocxRuntime } from './docxRuntime.mjs';

test('upgraded real Notes core preserves text, tables and embedded images through full saves', async () => {
  verifyDocxRuntime(fileURLToPath(new URL('../', import.meta.url)));
  const commands = await import('@heyirisai/docx-editor-core/prosemirror/commands');
  expect(commands.insertImageFromFile).toBeTypeOf('function');
  const zip = await JSZip.loadAsync(await createDocx(createDocumentWithText('Existing calibration note')));
  const xml = await zip.file('word/document.xml').async('string');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFioAAAAASUVORK5CYII=', 'base64');
  zip.file('word/media/notes.png', image);
  const relPath = 'word/_rels/document.xml.rels';
  const rels = await zip.file(relPath).async('string');
  zip.file(relPath, rels.replace('</Relationships>', '<Relationship Id="rIdNoteImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/notes.png"/></Relationships>'));
  const types = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
  const extra = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>10 A reference</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Note image"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="notes.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdNoteImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  zip.file('word/document.xml', xml.replace('<w:sectPr', `${extra}<w:sectPr`));
  let bytes = await zip.generateAsync({ type:'uint8array' });
  for (let i=0;i<2;i++) {
    const document = await parseDocx(bytes, { preloadFonts:false });
    bytes = new Uint8Array(await repackDocx(document));
    const saved = await JSZip.loadAsync(bytes);
    const body = await saved.file('word/document.xml').async('string');
    expect(body).toContain('Existing calibration note');
    expect(body).toContain('10 A reference');
    expect(body).toContain('w:tbl');
    expect(body).toContain('w:drawing');
    expect(Buffer.from(await saved.file('word/media/notes.png').async('uint8array'))).toEqual(image);
  }
});
