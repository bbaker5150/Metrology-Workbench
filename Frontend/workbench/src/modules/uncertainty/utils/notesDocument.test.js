import { expect, it } from 'vitest';
import { createNotesDocument } from './notesDocument';

it('lays out imported AC-shunt notes as separate paragraphs, preserving blank lines and Unicode', () => {
  const lines = ['Source: AC-shunt session 93.', 'AC–DC repeatability: ±2 ppm.', '', 'Variability: ±5 ppm, Rectangular.'];
  const doc = createNotesDocument(lines.join('\r\n'));
  const paragraphs = doc.package.document.content;
  expect(paragraphs).toHaveLength(4);
  expect(paragraphs.every(paragraph => paragraph.type === 'paragraph')).toBe(true);
  expect(paragraphs.map(paragraph => paragraph.content.flatMap(run => run.content.map(part => part.text || '')).join(''))).toEqual(lines);
  expect(paragraphs.every(paragraph => paragraph.formatting.lineSpacing > 0)).toBe(true);
});
