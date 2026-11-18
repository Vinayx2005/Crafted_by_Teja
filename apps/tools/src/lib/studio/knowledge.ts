// Content Studio: knowledge resources. Documents and notes a brand's team gives the
// writer. Only text is stored. Every handler is called after authorise() has proved the
// person may act on this brand, and every query is also limited to that brand.

import { HttpError, count, gemini, insert, patch, remove, rows } from './server';
import { pickKnowledge, splitTotal } from './knowledge-pick';
import { stripControl } from './safety';

const MAX_ITEMS = 50;
const MAX_CHARS = 60_000;
const MAX_PDF_BASE64 = 3_600_000; // about 2.6 MB of file; the host allows 4.5 MB per request
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; title: string; kind: 'text' | 'file'; file_name: string | null; content: string; updated_at: string };

const clean = (v: unknown, max: number) => stripControl(String(v ?? '')).trim().slice(0, max);
// Text keeps its line breaks; only control characters are removed.
const body = (v: unknown) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r\n?/g, '\n').trim();
const id = (v: unknown) => {
  if (typeof v === 'string' && UUID.test(v)) return v;
  throw new HttpError(404, 'Not found.');
};

// A missing table means the one-time database step has not been run yet.
async function table<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (/studio_knowledge|relation|does not exist|PGRST205/i.test(String((e as Error)?.message ?? e)))
      throw new HttpError(503, 'Knowledge needs a one-time database step first: run migrations/studio_knowledge.sql in Supabase.');
    throw e;
  }
}

const summary = (r: Row) => ({
  id: r.id, title: r.title, kind: r.kind, fileName: r.file_name, updatedAt: r.updated_at,
  chars: r.content.length, words: r.content.split(/\s+/).filter(Boolean).length, preview: r.content.slice(0, 280),
});

export const list = (b: any) =>
  table(async () => {
    const items = await rows<Row>(`studio_knowledge?select=id,title,kind,file_name,content,updated_at&brand_id=eq.${id(b.pageId)}&order=updated_at.desc`);
    return { items: items.map(summary), max: MAX_ITEMS };
  });

export const get = (b: any) =>
  table(async () => {
    const [r] = await rows<Row>(`studio_knowledge?select=id,title,kind,file_name,content,updated_at&id=eq.${id(b.id)}&brand_id=eq.${id(b.pageId)}`);
    if (!r) throw new HttpError(404, 'Not found.');
    return { item: { ...summary(r), content: r.content } };
  });

async function create(brandId: string, who: string, title: string, content: string, kind: 'text' | 'file', fileName: string | null) {
  if (!title) throw new HttpError(400, 'Give it a title.');
  if (!content) throw new HttpError(400, 'There is no text to save.');
  const n = await count(`studio_knowledge?select=id&brand_id=eq.${brandId}`);
  if (n >= MAX_ITEMS) throw new HttpError(409, `A brand can hold ${MAX_ITEMS} knowledge resources. Delete one first.`);
  const trimmed = content.length > MAX_CHARS;
  const [row] = await insert<Row>('studio_knowledge', { brand_id: brandId, title, kind, file_name: fileName, content: content.slice(0, MAX_CHARS), created_by: who });
  return { item: summary(row), trimmed };
}

// Free text typed or pasted in, or a text file the browser has already read (txt, md, csv, docx).
export const add = (b: any, who: string) =>
  table(() => create(id(b.pageId), who, clean(b.title, 120), body(b.content), b.fileName ? 'file' : 'text', b.fileName ? clean(b.fileName, 200) : null));

// A PDF is read a few pages at a time (a whole book cannot be retyped inside one request).
// Gemini reads the pages asked for and returns their text and the document's page count; the
// browser asks for the next range until the end, then saves the text. Nothing is stored here
// and the file itself is never kept.
export const readPdf = async (b: any) => {
  const data = String(b.data ?? '');
  if (!data || data.length > MAX_PDF_BASE64) throw new HttpError(413, 'That file is too large. Keep each file under 2.5 MB, or split it.');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data) || !Buffer.from(data.slice(0, 16), 'base64').toString('latin1').startsWith('%PDF'))
    throw new HttpError(400, 'That does not look like a PDF.');
  const from = Math.trunc(Number(b.from));
  const to = Math.trunc(Number(b.to));
  if (!(from >= 1 && to >= from && to - from < 25 && to <= 3000)) throw new HttpError(400, 'Bad page range.');
  const raw = await gemini(
    `Extract the full text of pages ${from} to ${to} of this PDF faithfully, in reading order. Plain text only: no commentary, no summary, no markdown. Keep headings on their own lines, write tables as one row per line with cells separated by " | ", and skip page numbers and headers or footers that repeat. If the document has fewer than ${from} pages, output nothing but the last line. On the very last line, write TOTAL_PAGES: followed by the total number of pages in the whole document.`,
    { lite: true, inline: { mime: 'application/pdf', data: data.replace(/\s+/g, '') }, timeoutMs: 55_000 },
  );
  const { text, total } = splitTotal(body(raw));
  return { text, total };
};

export const update = (b: any) =>
  table(async () => {
    const [r] = await rows<Row>(`studio_knowledge?select=id&id=eq.${id(b.id)}&brand_id=eq.${id(b.pageId)}`);
    if (!r) throw new HttpError(404, 'Not found.');
    const title = clean(b.title, 120);
    const content = body(b.content);
    if (!title || !content) throw new HttpError(400, 'A title and some text are both needed.');
    await patch(`studio_knowledge?id=eq.${r.id}&brand_id=eq.${id(b.pageId)}`, { title, content: content.slice(0, MAX_CHARS), updated_at: new Date().toISOString() });
    return { ok: true, trimmed: content.length > MAX_CHARS };
  });

export const del = (b: any) =>
  table(async () => {
    await remove(`studio_knowledge?id=eq.${id(b.id)}&brand_id=eq.${id(b.pageId)}`);
    return { ok: true };
  });

// What goes into the writer's prompt: the passages of the brand's knowledge that match the
// topic. Never fails a script: no table, no knowledge, or a read problem just means none.
export async function knowledgeFor(brandId: string, topic: string): Promise<string> {
  try {
    const docs = await rows<Pick<Row, 'title' | 'content'>>(`studio_knowledge?select=title,content&brand_id=eq.${brandId}&order=updated_at.desc&limit=${MAX_ITEMS}`);
    return Array.isArray(docs) ? pickKnowledge(docs, topic) : '';
  } catch {
    return '';
  }
}
