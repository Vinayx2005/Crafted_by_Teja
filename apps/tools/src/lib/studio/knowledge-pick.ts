// Content Studio: choosing which parts of a brand's knowledge go into a prompt.
// Pure functions (no database, no network) so they are easy to test.

export type KnowledgeDoc = { title: string; content: string };

// Everyday words match almost every document, so they say nothing about relevance.
const STOP = new Set('the and for are was were you your how what why when who does did this that with from have has had not but can will about into our their they them its than then there here which would could should much many any all out get got use used also more most some such only very just like over'.split(' '));
const words = (t: string) => [...new Set((t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))];

// Cut a document into passages of about `size` characters, at paragraph or line breaks.
export function chunks(text: string, size = 1200): string[] {
  const out: string[] = [];
  let cur = '';
  for (const part of text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean)) {
    if (cur && cur.length + part.length + 1 > size) {
      out.push(cur);
      cur = '';
    }
    // A single very long paragraph is split on its own.
    if (part.length > size) {
      for (let i = 0; i < part.length; i += size) out.push(part.slice(i, i + size));
    } else {
      cur = cur ? `${cur}\n${part}` : part;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// The passages most relevant to the topic, best first, within `budget` characters.
// A passage scores one point for every distinct word of the topic it contains (a match in
// the document title counts too). When nothing matches at all, the start of each document
// is used, so a brand's basic facts still reach the writer.
export function pickKnowledge(docs: KnowledgeDoc[], query: string, budget = 10_000): string {
  const q = words(query);
  type Part = { title: string; text: string; score: number; order: number };
  const parts: Part[] = [];
  let order = 0;
  for (const d of docs) {
    const titleHits = q.filter((w) => d.title.toLowerCase().includes(w)).length;
    for (const text of chunks(d.content)) {
      const lower = text.toLowerCase();
      parts.push({ title: d.title, text, score: q.filter((w) => lower.includes(w)).length + titleHits, order: order++ });
    }
  }
  if (!parts.length) return '';

  let chosen = parts.filter((p) => p.score > 0).sort((a, z) => z.score - a.score || a.order - z.order);
  if (!chosen.length) {
    const seen = new Set<string>();
    chosen = parts.filter((p) => (seen.has(p.title) ? false : (seen.add(p.title), true)));
  }
  const picked: Part[] = [];
  let used = 0;
  for (const p of chosen) {
    if (used + p.text.length > budget) continue;
    picked.push(p);
    used += p.text.length;
  }
  // Reading order again, grouped under each document's title.
  picked.sort((a, z) => a.order - z.order);
  const out: string[] = [];
  let last = '';
  for (const p of picked) {
    if (p.title !== last) out.push(`[${p.title}]`);
    out.push(p.text);
    last = p.title;
  }
  return out.join('\n');
}

// Gemini ends a page-range reading with "TOTAL_PAGES: N". Split that line off the text.
export function splitTotal(raw: string): { text: string; total: number } {
  const m = raw.match(/(?:^|\n)\s*TOTAL_PAGES:\s*(\d+)\s*$/);
  return { text: (m ? raw.slice(0, m.index) : raw).trim(), total: m ? Number(m[1]) : 0 };
}
