import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { docxText } from '@/lib/studio/docx';
import { chunks, pickKnowledge, splitTotal } from '@/lib/studio/knowledge-pick';

describe('docxText', () => {
  it('reads the paragraphs of a real .docx file', async () => {
    const text = await docxText(new Blob([readFileSync('tests/fixtures/sample.docx')]));
    expect(text.split('\n')).toEqual(['Refund policy', 'Refunds are issued within 7 days & need an order number.', 'Plans: Basic\tRs 499']);
  });
  it('refuses a file that is not a .docx', async () => {
    await expect(docxText(new Blob(['just some text, not a zip file at all']))).rejects.toThrow(/docx/);
  });
});

describe('chunks', () => {
  it('keeps short text together and splits long text at line breaks', () => {
    expect(chunks('one\ntwo')).toEqual(['one\ntwo']);
    const long = Array.from({ length: 10 }, (_, i) => `line ${i} ${'x'.repeat(300)}`).join('\n');
    const parts = chunks(long, 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('\n')).toBe(long);
  });
  it('splits one huge paragraph on its own', () => {
    expect(chunks('a'.repeat(2500), 1000).map((p) => p.length)).toEqual([1000, 1000, 500]);
  });
});

describe('pickKnowledge', () => {
  const docs = [
    { title: 'Refund policy', content: 'Refunds are issued within 7 days.\n\nYou need the order number to get a refund.' },
    { title: 'About us', content: 'We make accounting software for small shops in Hyderabad.' },
    { title: 'Pricing', content: 'The Basic plan costs Rs 499 a month. The Pro plan costs Rs 1499 a month.' },
  ];
  it('puts the passages that match the topic first and leaves out unrelated documents', () => {
    const out = pickKnowledge(docs, 'how much does the pro plan cost', 400);
    expect(out).toContain('[Pricing]');
    expect(out).toContain('Rs 1499');
    expect(out).not.toContain('Refunds are issued');
  });
  it('falls back to the start of every document when nothing matches', () => {
    const out = pickKnowledge(docs, 'quantum physics');
    expect(out).toContain('[Refund policy]');
    expect(out).toContain('[About us]');
    expect(out).toContain('[Pricing]');
  });
  it('never goes over the budget', () => {
    const big = [{ title: 'Big', content: Array.from({ length: 50 }, (_, i) => `plan ${i} ${'word '.repeat(60)}`).join('\n\n') }];
    expect(pickKnowledge(big, 'plan', 3000).length).toBeLessThan(3000 + 200);
  });
  it('returns nothing when there is no knowledge', () => {
    expect(pickKnowledge([], 'anything')).toBe('');
  });
});

describe('splitTotal', () => {
  it('splits the page count off the end of a reading', () => {
    expect(splitTotal('Chapter one\nSome text\nTOTAL_PAGES: 137')).toEqual({ text: 'Chapter one\nSome text', total: 137 });
  });
  it('handles a reading that is only the count (past the last page)', () => {
    expect(splitTotal('TOTAL_PAGES: 12')).toEqual({ text: '', total: 12 });
  });
  it('leaves text alone when there is no count', () => {
    expect(splitTotal('Just text')).toEqual({ text: 'Just text', total: 0 });
  });
});
