// Blog agent pipeline — server only (used by /api/agent/tick).
//
//   seed keyword ──research──▶ ideas ──(you pick)──▶ outline ──(you approve)──▶
//   draft + images, saved to blog.posts as a draft ──(you approve)──▶ scheduled
//
// Demand evidence comes from Google Autocomplete (free, real queries);
// competition + facts come from Gemini with Google Search grounding.
// Neither gives absolute search volumes — the UI labels them as estimates.

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export type Site = 'root' | 'pft';

export interface AuthorInputs {
  text?: string | null;
  images?: { url: string; name?: string }[];
}

export interface Seed {
  id: number; site: Site; keyword: string; country: string;
  ideas_wanted: number; notes: string | null; cluster?: boolean;
  inputs?: AuthorInputs | null;
}

export interface Idea {
  title: string; primary_keyword: string; secondary_keywords: string[];
  intent: string; demand: string; competition: string; score: number;
  angle: string; evidence: string;
  role?: 'pillar' | 'supporting';   // cluster seeds only
}

export interface Plan {
  title: string; slug: string; meta_description: string; category: string;
  target_words: number; primary_keyword: string; secondary_keywords: string[];
  related_terms: string[]; questions: string[]; cover_image_query: string;
  top_results_miss: string;
}

export interface Item {
  id: number; seed_id: number; site: Site; stage: string; idea: Idea;
  plan: Plan | null; outline_md: string | null; note: string | null;
  post_id: number | null; inputs?: AuthorInputs | null;
}

// Who each site writes for. Edit these to change the voice.
const SITES: Record<Site, { name: string; path: string; profile: string; categories: string[] }> = {
  pft: {
    name: 'Personal FT blog (pft.craftedbyteja.com)',
    path: '/blogs',
    categories: ['tip', 'insight'],
    profile: `The blog of Personal FT, a software product by Teja. What a post is about is decided by the
editor's material — never steer it towards money, or any other subject of your own choosing.
Readers: mostly Indian, 22–40. Write for them: ₹ and lakh/crore where amounts come up, Indian context
where examples come up.
Voice: clear, practical, friendly and non-judgemental. Explain any term the first time you use it.
Do NOT mention, recommend or link Personal FT unless the editor's own material does. The app is what this blog belongs to, not what it is about.`,
  },
  root: {
    name: 'Crafted by Teja (craftedbyteja.com)',
    path: '/blog',
    categories: ['insight', 'tip'],
    profile: `Personal site of Teja — entrepreneur, author and builder (200+ YouTube videos, published books, several software products).
Readers: aspiring founders, creators and self-learners.
Topics: building products and businesses, entrepreneurship, writing, learning by doing, productivity, intentional living.
Voice: honest, reflective and conversational, speaking directly to the reader ("you"). Never invent personal anecdotes about Teja.`,
  },
};

const STYLE = `Writing rules:
- Simple English throughout. Short, everyday words a 15-year-old reads without stopping. No jargon, no
  business-speak, no technical vocabulary for its own sake. Where a term genuinely can't be avoided
  (an acronym, an industry term), say what it means in plain words the first time, in the same sentence.
- Explain, don't assert. Break a number or an idea into its parts when the reader needs that to follow
  it, and give a concrete example — real figures, a named situation — so the point can be pictured.
- Write for a smart friend: plain words, short paragraphs (1–3 sentences), active voice, concrete examples and real numbers.
- Every section must earn its place. No filler, no restating the question, no generic advice anyone could write.
- Use bullet lists and numbered steps where they help scanning; **bold** only for key takeaways.
- Never use these phrases: "in today's fast-paced world", "delve", "dive into", "navigate", "landscape", "unlock", "game-changer", "it's important to note", "in conclusion", "embark", "elevate", "seamless", "robust", "leverage", "tapestry", "realm".
- Never invent personal stories, testimonials, quotes or statistics.
- No promotion. Don't pitch, recommend or link any product, app or service — including our own — and don't end on a sign-up, download or "try our" line. The only exception is a product the editor's own material already talks about, and then you say only what they said about it. A conclusion sums up or leaves the reader with a next action they take themselves, never one that sends them to us.
- Markdown only: ## and ### headings, lists, **bold**, *italic*, [links](url), > quotes. No tables, no HTML, no H1.`;

const MODEL = process.env.GEMINI_BLOG_MODEL || 'gemini-flash-latest';
const WRITER_MODEL = process.env.GEMINI_BLOG_WRITER_MODEL || MODEL;

export function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'blog' },
  });
}

// ─── The model call ────────────────────────────────────────────────────
// Claude runs every step — research, outline and draft — whenever its key
// is set; Gemini takes over only when Claude is out of quota or overloaded
// (and runs everything when there's no Claude key at all).
// A bad key or a rejected prompt is not a fallback: that's a real error.
type AskOpts = { search?: boolean; json?: boolean; model?: string; images?: ImagePart[] };

// An image the author pasted in, fetched once and handed to whichever model
// runs the step — Claude and Gemini want different envelopes for the bytes.
export interface ImagePart { media_type: string; data: string }

export async function fetchImages(urls: string[]): Promise<ImagePart[]> {
  const parts = await pool(urls.slice(0, 8), 4, async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.byteLength > 4_000_000) return null;      // keep the request sane
      const media_type = r.headers.get('content-type')?.split(';')[0] || 'image/png';
      if (!/^image\/(png|jpeg|webp|gif)$/.test(media_type)) return null;
      return { media_type, data: buf.toString('base64') };
    } catch {
      return null;
    }
  });
  return parts.filter(Boolean) as ImagePart[];
}

const outOfCapacity = (e: any) =>
  /\b(429|402|403|500|503|529)\b|quota|billing|credit balance|rate.?limit|overload|RESOURCE_EXHAUSTED/i
    .test(`${e?.status ?? ''} ${e?.message ?? e}`);

export const askForTest = (prompt: string, opts: AskOpts = {}) => ask(prompt, opts);

async function ask(prompt: string, opts: AskOpts = {}) {
  const haveClaude = !!process.env.ANTHROPIC_API_KEY;
  const [first, second] = haveClaude ? [claude, gemini] : [gemini, claude];
  const name = (f: typeof claude) => (f === claude ? 'Claude' : 'Gemini');
  try {
    return await first(prompt, opts);
  } catch (e: any) {
    const canRetry = second === claude ? haveClaude : !!process.env.GEMINI_BLOG_API_KEY;
    if (!canRetry || !outOfCapacity(e)) throw e;
    console.warn(`[blog-agent] ${name(first)} unavailable (${e?.message || e}) — falling back to ${name(second)}`);
    try {
      return await second(prompt, opts);
    } catch (e2: any) {
      // Both are down. Report both: showing only the fallback's error sends you
      // off to fix the wrong provider's billing.
      throw new Error(
        `${name(first)} failed: ${e?.message || e} — then ${name(second)} failed: ${e2?.message || e2}`,
      );
    }
  }
}

async function claude(prompt: string, opts: AskOpts) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Org-wide keys (not scoped to one workspace) must name the workspace.
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  });
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_BLOG_MODEL || 'claude-sonnet-5',
    max_tokens: 16_000,
    output_config: { effort: 'medium' },
    // Claude's own web search stands in for Gemini's Google Search grounding.
    tools: opts.search ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }] : undefined,
    messages: [{
      role: 'user',
      content: [
        ...(opts.images || []).map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.media_type as 'image/png', data: img.data },
        })),
        { type: 'text' as const, text: prompt },
      ],
    }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text.trim()) throw new Error(`Claude returned no text (${res.stop_reason})`);
  return text;
}

async function gemini(prompt: string, opts: AskOpts = {}) {
  const key = process.env.GEMINI_BLOG_API_KEY;
  if (!key) throw new Error('GEMINI_BLOG_API_KEY is not set on the CMS');
  // Overload (503/500) and rate-limit (429) spikes are common — wait and
  // retry here rather than burning one of the item's 3 attempts.
  let res: Response | undefined;
  for (let wait = 5_000; ; wait *= 3) {
    res = await callGemini(key, prompt, opts);
    if (![429, 500, 503].includes(res.status) || wait > 45_000) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const hint = res.status === 429 && opts.search
      ? ' (Google Search grounding needs billing enabled on the key\'s Google Cloud project)' : '';
    throw new Error(`Gemini ${res.status}: ${data?.error?.message || res.statusText}${hint}`);
  }
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text || '')
    .join('');
  if (!text.trim()) throw new Error(`Gemini returned no text (${data?.candidates?.[0]?.finishReason || 'no candidates'})`);
  return text;
}

function callGemini(key: string, prompt: string, opts: AskOpts) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${opts.model || MODEL}:generateContent`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            ...(opts.images || []).map((img) => ({ inline_data: { mime_type: img.media_type, data: img.data } })),
            { text: prompt },
          ],
        }],
        tools: opts.search ? [{ google_search: {} }] : undefined,
        // JSON mode can't be combined with search grounding on every model,
        // so grounded calls ask for JSON in the prompt and parseJson copes.
        generationConfig: opts.json && !opts.search ? { responseMimeType: 'application/json' } : undefined,
      }),
      signal: AbortSignal.timeout(240_000),
    },
  );
}

export function parseJson<T>(text: string): T {
  const s = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('Model did not return JSON');
  return JSON.parse(s.slice(start, end + 1));
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ─── Research ──────────────────────────────────────────────────────────
// Google only autocompletes queries people actually search, and orders them
// roughly by popularity — the best free demand signal there is.
async function autocomplete(keyword: string, country: string) {
  const gl = country === 'GLOBAL' ? '' : `&gl=${country.toLowerCase()}`;
  const probes = [
    keyword,
    ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `${keyword} ${c}`),
    ...['how', 'what', 'why', 'which', 'is', 'can', 'best', 'should'].map((w) => `${w} ${keyword}`),
    `${keyword} vs`, `${keyword} for`,
  ];
  const ranked = new Map<string, number>();
  await pool(probes, 8, async (q) => {
    try {
      const r = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&hl=en${gl}&q=${encodeURIComponent(q)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(8000) },
      );
      const [, list] = (await r.json()) as [string, string[]];
      list.forEach((s, rank) => {
        const k = s.trim().toLowerCase();
        ranked.set(k, Math.min(ranked.get(k) ?? 99, rank + 1));
      });
    } catch { /* one probe failing doesn't matter */ }
  });
  return Array.from(ranked.entries()).sort((a, b) => a[1] - b[1]).slice(0, 150);
}

async function coveredTitles(site: Site) {
  const sb = db();
  const [{ data: posts }, { data: items }] = await Promise.all([
    sb.from('posts').select('title').eq('site', site).limit(500),
    sb.from('agent_items').select('idea->>title').eq('site', site).neq('stage', 'discarded').limit(1000),
  ]);
  return [...(posts || []).map((p: any) => p.title), ...(items || []).map((i: any) => i.title)];
}

// A seed holds the whole brief: every keyword the editor typed, on its own
// line. Demand is pooled across all of them and the model plans one set of
// ideas for the lot — not N ideas per keyword.
export const seedKeywords = (seed: Seed) =>
  seed.keyword.split('\n').map((k) => k.trim()).filter(Boolean);

// How many search terms a set of topics should turn into. Each one costs a
// round of autocomplete probes at research time, so this is the knob to turn
// if a run starts feeling slow.
const KEYWORDS_WANTED = 10;

// Topics in, search terms out. The editor thinks in subjects ("the mistake I
// made with my emergency fund"); Google needs head terms. Called from the
// Research form's "Generate keywords" button, and again inside research() as a
// fallback if a run somehow reaches the worker with no keywords.
export async function keywordsFromTopics(
  { site: siteKey, country, notes }: { site: Site; country: string; notes: string },
): Promise<string[]> {
  const site = SITES[siteKey];
  const found = parseJson<string[]>(await ask(`You are the SEO strategist for ${site.name}.
${site.profile}

The editor hasn't given keywords — only the topics on their mind, written however they came out:
${notes}

Target market: ${country === 'GLOBAL' ? 'worldwide' : country}. Everything is written in English.

Use Google Search to work out how real people search for these topics. Return exactly ${KEYWORDS_WANTED}
head keywords worth building a blog around: short search phrases someone would actually type, not titles
and not questions. Favour terms with real demand that this site can realistically rank for. Cover the
editor's topics between them — don't drift onto a neighbouring subject.

${KEYWORDS_WANTED} is a floor as well as a ceiling. If the topics are narrow, go wider the way a reader
would: the adjacent question, the comparison, the "how much", the "when", the common mistake, the
beginner version of the same search. Every one must still be a term people actually type — never pad
the list with near-duplicates of each other.

Return ONLY a JSON array of strings.`, { search: true }));
  const list = (Array.isArray(found) ? found : [])
    .map((k) => String(k || '').trim().toLowerCase()).filter(Boolean).slice(0, KEYWORDS_WANTED);
  if (!list.length) throw new Error('Could not work out keywords from those topics — add a keyword or two by hand');
  return list;
}

// ─── Plan one post ─────────────────────────────────────────────────────
// One run makes one post. Everything the editor gave — topics, keywords and
// their own material — goes in, and a title, description and plain-English
// outline come out. Their material is the spine: the post is built around it,
// never the other way round.
export async function planPost(seed: Seed, item?: Item): Promise<{ idea: Idea; plan: Plan; outline_md: string }> {
  const site = SITES[seed.site];
  let keywords = seedKeywords(seed);
  if (!keywords.length) {
    if (!seed.notes?.trim()) throw new Error('Give me either keywords or topics to work from');
    keywords = await keywordsFromTopics({ site: seed.site, country: seed.country, notes: seed.notes });
    await db().from('agent_seeds').update({ keyword: keywords.join('\n') }).eq('id', seed.id);
  }

  const author = item
    ? authorInputs(item, seed)
    : authorInputs({ inputs: null } as Item, seed);
  const images = await fetchImages(author.urls);
  const [queryLists, covered] = await Promise.all([
    Promise.all(keywords.map((k) => autocomplete(k, seed.country))),
    coveredTitles(seed.site),
  ]);
  const pooled = new Map<string, number>();
  for (const list of queryLists)
    for (const [q, rank] of list) pooled.set(q, Math.min(pooled.get(q) ?? 99, rank));
  const queries = Array.from(pooled.entries()).sort((a, b) => a[1] - b[1]).slice(0, 120);

  const prompt = `You are planning ONE blog post for ${site.name}.
${site.profile}
Target market: ${seed.country === 'GLOBAL' ? 'worldwide' : seed.country}. Write everything in English — always, whatever the market.

THE EDITOR'S TOPICS — what this post is actually about:
${seed.notes || '(none given — work from the keywords)'}

Keywords to target:
${keywords.map((k) => `- ${k}`).join('\n')}
${author.block}
${item?.note ? `
Editor's feedback on the previous plan — apply it:
${item.note}

Previous outline:
${item.outline_md || ''}
` : ''}
Real Google autocomplete queries for these keywords (proof people search them; lower number = more popular):
${queries.length ? queries.map(([q, r]) => `${r}. ${q}`).join('\n') : '(autocomplete returned nothing — rely on search)'}

Already on the site — don't plan a post that competes with these:
${covered.length ? covered.map((t) => `- ${t}`).join('\n') : '(nothing yet)'}

HOW TO BUILD THE OUTLINE — this matters more than anything else here:
- The editor's topics and their own material decide what the post says. Every section must trace back
  to something they gave you. You may elaborate, rephrase, explain and illustrate it; you may not
  invent experiences, numbers or opinions for them.
- Where their material is thin, go deeper on it rather than wider off it. A short honest post beats a
  padded one.
- You may use Google Search to add supporting facts and link to authoritative sources where they
  genuinely back up a point the editor is already making. Never let an outside fact contradict them,
  and never build a section out of facts they never mentioned.
- Plan sections in plain language a reader would recognise, not SEO jargon.

Steps:
1. Use Google Search on the main keyword to see what already ranks — only to find what the editor's
   material can beat, never to decide what the post is about.
2. Build the keyword plan: the main keyword goes in the title, the first 100 words, one heading and the
   description. Others appear once or twice where they read naturally. Never keyword-stuff.
3. Write the outline as plain sections — a short heading plus one sentence saying what it covers — in
   exactly this shape, in this order:
   a) Introduction — what this post is about and why it matters to the reader, in a few lines.
   b) The body — as many sections as the editor's material supports. This is where the substance goes:
      the data points they gave, broken down into their parts wherever a number or an idea needs
      unpacking, and at least one concrete example per section so a reader can picture it. Say in the
      section note which of the editor's data points or examples that section is built on.
   c) Conclusion — pulls together what the post actually covered. Nothing new, no product, no app, no
      service, no sign-up, ours least of all. It summarises and stops.
   d) FAQ — last, after the conclusion. Only questions a reader of THIS post would still have; every
      answer must come from the material already covered above. No new topics smuggled in here.
   No section anywhere may exist to promote anything — no "why you need a tracker", no tool round-up.
   The single exception is a product the editor's own material already talks about.

Return ONLY a JSON object (no prose) with exactly these keys:
{"title": "final title, max 60 characters, contains the main keyword",
 "slug": "3–6 word kebab-case slug containing the main keyword",
 "meta_description": "140–155 characters, contains the main keyword, gives a reason to click",
 "category": "${site.categories.join(' | ')}",
 "target_words": number (usually 1200–2200 — match how much the editor actually gave you),
 "primary_keyword": "...",
 "secondary_keywords": ["..."],
 "related_terms": ["..."],
 "questions": ["FAQ questions a reader of THIS post would still have — answerable from its own content"],
 "cover_image_query": "2–4 word stock-photo search, concrete and visual (e.g. 'woman calculator bills')",
 "top_results_miss": "one sentence: what the editor's material lets this post say that the ranking pages can't",
 "angle": "one sentence in plain English: what this post is and who it's for",
 "outline_md": "the outline in Markdown: ## for each section heading, then a single - bullet under it saying what that section covers. No H1, no nesting."}`;

  const out = parseJson<Plan & { outline_md: string; angle: string }>(await ask(prompt, { search: true, images }));
  const { outline_md, angle, ...plan } = out;
  if (!outline_md || !plan.primary_keyword || !plan.title) throw new Error('Plan incomplete');
  if (!site.categories.includes(plan.category)) plan.category = site.categories[0];
  plan.secondary_keywords ||= []; plan.related_terms ||= []; plan.questions ||= [];
  plan.target_words = Math.min(Math.max(Number(plan.target_words) || 1500, 800), 3000);

  const idea: Idea = {
    title: plan.title,
    primary_keyword: plan.primary_keyword,
    secondary_keywords: plan.secondary_keywords,
    intent: 'informational',
    demand: '', competition: '', score: 0,
    angle: angle || plan.top_results_miss || '',
    evidence: '',
  };
  return { idea, plan, outline_md: stripPromo(outline_md, authorText(seed, item)) };
}

const authorText = (seed: Seed, item?: Item) =>
  `${seed.inputs?.text || ''}\n${item?.inputs?.text || ''}\n${seed.notes || ''}`;

// A prompt can be ignored; this can't. Drops any outline section that exists to
// talk about our own products — the conclusion is where it keeps reappearing.
// Skipped entirely when the editor's own material mentions the product, because
// then it is their point to make.
const PROMO = /\bpersonal\s*ft\b|\bpersonalft\b|craftedbyteja/i;

export function stripPromo(md: string, authorMaterial = '') {
  if (!md || PROMO.test(authorMaterial)) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  let dropping = false;
  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line)) dropping = PROMO.test(line);
    else if (dropping && /^\s*$/.test(line)) continue;
    if (dropping) continue;
    // A stray bullet that plugs the app inside an otherwise fine section.
    if (/^\s*[-*]\s+/.test(line) && PROMO.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Author inputs ─────────────────────────────────────────────────────
// Your own notes, numbers and screenshots. This is the material no competitor
// has, so the prompts treat it as authoritative and the model is told to build
// around it rather than sprinkle it in.
function authorInputs(item: Item, seed: Seed) {
  const blocks = [
    { scope: 'this whole topic', v: seed.inputs },
    { scope: 'this specific post', v: item.inputs },
  ].filter((b) => b.v?.text?.trim() || b.v?.images?.length);
  if (!blocks.length) return { block: '', urls: [] as string[] };

  const urls = blocks.flatMap((b) => (b.v!.images || []).map((i) => i.url));
  const block = `
THE AUTHOR'S OWN MATERIAL — this is the most valuable part of this brief.
It is first-hand: his data, his experience, his opinions. Treat every fact in it as
authoritative and never contradict it. Where it is substantial, give it its own
section rather than scattering it. It is raw and unorganised on purpose — work out
what matters and use it well. Never invent detail to pad it out, and never present
his private numbers as if they came from a public source.
${blocks.map((b) => [
  `--- notes for ${b.scope} ---`,
  (b.v!.text || '(no text, see the attached images)').trim(),
  (b.v!.images || []).length ? `attached images: ${(b.v!.images || []).map((i) => i.name || i.url).join(', ')}` : '',
].filter(Boolean).join('\n')).join('\n\n')}
--- end of author material ---
${urls.length ? [
  'The attached image(s) are shown to you above this prompt. Read them carefully — if one supports a point, embed it at that point with ![descriptive alt](exact url) plus a one-line italic caption. Use these exact URLs:',
  ...urls.map((u) => `- ${u}`),
].join('\n') : ''}`;
  return { block, urls };
}

// ─── Draft ─────────────────────────────────────────────────────────────
const LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
const IMAGE_RE = /^\[\[IMAGE:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]\s*$/gm;

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// Cluster siblings that already have a post row. Their slugs are final, so a
// post can link to one that isn't published yet — it will be by the time the
// cluster finishes rolling out. Discarded items are excluded, and checkLinks()
// strips any internal path that isn't in this list.
async function clusterSiblings(item: Item) {
  const { data } = await db().from('agent_items')
    .select('id, idea, stage, post:posts(slug, title)')
    .eq('seed_id', item.seed_id).neq('stage', 'discarded').neq('id', item.id);
  return (data || [])
    .filter((r: any) => r.post?.slug)
    .map((r: any) => ({
      title: (r.post.title || r.idea?.title) as string,
      href: `${SITES[item.site].path}/${r.post.slug}`,
      role: (r.idea?.role || 'supporting') as 'pillar' | 'supporting',
    }));
}

async function livePosts(site: Site) {
  const { data } = await db().from('posts').select('title, slug')
    .eq('site', site).lte('published_at', new Date().toISOString()).limit(200);
  return (data || []).map((p: any) => ({ title: p.title as string, href: `${SITES[site].path}/${p.slug}` }));
}

export async function draft(item: Item, seed: Seed) {
  const site = SITES[item.site];
  const plan = item.plan!;
  const author = authorInputs(item, seed);
  const [live, siblings, images] = await Promise.all([
    livePosts(item.site), clusterSiblings(item), fetchImages(author.urls),
  ]);
  const pillar = siblings.find((p) => p.role === 'pillar');
  const isPillar = item.idea.role === 'pillar';
  // Dedupe: a sibling that is already live would otherwise appear twice.
  const internal = [...siblings, ...live.filter((l) => !siblings.some((sib) => sib.href === l.href))];
  const today = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const prompt = `Write the full blog post for ${site.name}.
${site.profile}

${STYLE}

Title (already shown as the page's H1 — don't repeat it): ${plan.title}
Target market: ${seed.country === 'GLOBAL' ? 'worldwide' : seed.country}. Write everything in English — always, whatever the market. Today is ${today}.
Length: about ${plan.target_words} words.

Keyword plan:
- Primary: "${plan.primary_keyword}" — within the first 100 words, in at least one H2, then naturally about once every 120–150 words. Never forced.
- Secondary (each at least once): ${plan.secondary_keywords.map((k) => `"${k}"`).join(', ') || '—'}
- Related terms for depth: ${plan.related_terms.join(', ') || '—'}
Our edge over what ranks today: ${plan.top_results_miss || item.idea.angle}

Approved outline — follow its structure and order:
---
${item.outline_md}
---

${author.block}
WHERE THE CONTENT COMES FROM — the rule this post is judged on:
The editor's topics and their own material above are the whole substance of this post. Build every
section out of what they gave you. You may elaborate it, rephrase it, explain it properly, walk through
it step by step, and add illustrative examples that help a reader understand their point — an example
you make up to explain something must read as an illustration, never as something the editor did or
measured. You may NOT invent experiences, opinions, numbers or events for them, and you may not fill a
thin section with generic advice. If their material does not support a section in the outline, cut that
section rather than making it up. A shorter honest post is the correct outcome.
Outside facts are allowed only in support: a figure, rule or date you confirm by search, used to back up
a point the editor is already making. Never let one contradict them, never present their private numbers
as public data, and never let outside facts become the backbone of the post.

Facts: use Google Search to confirm every number, rate, limit, rule or date you state. Include at least one short verbatim quote (one sentence, in quotation marks, attributed and linked) from an official source where it genuinely supports a point — quotable evidence is what AI answer engines cite. Never invent a quote. Prefer current figures and write "as of ${today}" for anything that changes. If you can't confirm a number, leave it out.
Links: add 2–4 links to genuinely authoritative sources for whatever this post is about — the primary source itself: the organisation, regulator, standards body, researcher, documentation or official site behind the claim. Never cite content aggregators, SEO blogs or news round-ups rewriting someone else's work. Use URLs you are certain exist — prefer homepages over deep links.${internal.length ? `
Internal links — use these paths exactly, and only where the link genuinely helps the reader:
${internal.map((p) => `- [${p.title}](${p.href})${siblings.some((sib) => sib.href === p.href) ? ' (same topic cluster)' : ''}`).join('\n')}${
  isPillar && siblings.length
    ? `\nThis post is the PILLAR of its cluster: link to every post marked "same topic cluster" above, each from the section that covers its subtopic, so the reader can go deeper.`
    : pillar
      ? `\nThis post SUPPORTS the pillar "${pillar.title}": link back to it early (intro or first section) as the complete guide, and link to one or two sibling posts where genuinely relevant.`
      : ''}` : ''}
Images: place 2 or 3 image markers, each on its own line directly after the first paragraph of a different H2 section, exactly in this form:
[[IMAGE: 2–4 word stock-photo search | descriptive alt text]]
${item.note ? `\nEditor's feedback on the previous draft — apply it:\n${item.note}\n` : ''}
Return only the Markdown body.`;

  let body = cleanMarkdown(await ask(prompt, { search: true, model: WRITER_MODEL, images }));

  // One targeted revision if the draft misses the essentials.
  const issues = seoIssues(body, plan);
  if (issues.length) {
    body = cleanMarkdown(await ask(
      `Revise this blog post to fix these problems:\n${issues.map((i) => `- ${i}`).join('\n')}\n\n${STYLE}\n\nKeep everything else as it is, including links and [[IMAGE: …]] marker lines. Return the complete revised Markdown only.\n\n---\n${body}`,
      { model: WRITER_MODEL },
    ));
  }

  body = await checkLinks(body, new Set(internal.map((p) => p.href)), new Set(author.urls));
  const used = new Set<number>();
  const cover = await pexels(plan.cover_image_query || plan.primary_keyword, used);
  body = await replaceImages(body, used);

  const phrases = await phraseCheck(body);
  return { body, cover, seo: { ...seoReport(body, plan), phrases } };
}

// ─── Phrase check (lightweight plagiarism guard) ───────────────────────
// Takes the draft's most distinctive sentences and searches the web for each
// one verbatim. A hit means the sentence exists elsewhere — copied, or a
// deliberate quote that grew too long. Catches lifted sentences, not
// reworded copying (no tool does that reliably, paid ones included).
// Every sentence in the post worth checking — the whole body, not a sample.
// Capped so one enormous post can't fan out into hundreds of searches.
export function allPhrases(md: string, cap = 150) {
  return sentencesOf(md).slice(0, cap);
}

export function pickPhrases(md: string, max = 5) {
  const sentences = sentencesOf(md);
  // Spread the picks across the post rather than taking five from the intro.
  const step = Math.max(1, Math.floor(sentences.length / max));
  const picked: string[] = [];
  for (let i = 0; i < sentences.length && picked.length < max; i += step) picked.push(sentences[i]);
  return picked;
}

function sentencesOf(md: string) {
  const prose = md
    .split('\n')
    .filter((l) => !/^\s*(#|>|-|\d+\.|!\[|\*Photo)/.test(l) && l.trim())
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    // Drop anything inside quotation marks: those quotes are attributed on
    // purpose, so finding them elsewhere proves nothing.
    .replace(/["“][^"”]{20,}["”]/g, ' ');
  return prose.split(/(?<=[.!?])\s+/)
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter((x) => {
      const words = x.split(' ').length;
      return words >= 9 && words <= 22 && !/[|{}]/.test(x);
    });
}

export interface PhraseHit { phrase: string; url: string | null; unchecked?: boolean }

export async function phraseCheck(md: string, override?: string[]): Promise<PhraseHit[]> {
  const phrases = override ?? pickPhrases(md);
  if (!phrases.length) return [];
  try {
    const out = await ask(
      `Check whether these sentences already exist on the web. For each one, search the web for the sentence as an exact phrase (in quotation marks).

A sentence counts as a match ONLY if you find a page containing it essentially word for word (ignoring punctuation). A page merely covering the same topic is NOT a match. Ignore any page on craftedbyteja.com.

Sentences:
${phrases.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Return ONLY a JSON array with one object per sentence, in the same order:
[{"n": 1, "url": "https://… the page containing it, or null if no match"}]`,
      { search: true },
    );
    const hits = parseJson<{ n: number; url: string | null }[]>(out);
    return phrases.map((phrase, i) => {
      const hit = hits.find((h) => h.n === i + 1);
      const url = typeof hit?.url === 'string' && /^https?:/.test(hit.url) ? hit.url : null;
      return { phrase, url };
    });
  } catch {
    // A failed check must not fail the draft, and must not look like a pass:
    // an empty list renders as "not checked" in the review UI.
    return [];
  }
}

// The whole post, checked. Sentences go out in small batches because one
// search call per sentence would be dozens of round trips; batching keeps the
// same strict "word for word" test while staying inside a request.
export async function phraseCheckAll(md: string, batch = 8, concurrency = 3): Promise<PhraseHit[]> {
  const phrases = allPhrases(md);
  if (!phrases.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < phrases.length; i += batch) batches.push(phrases.slice(i, i + batch));
  const results = await pool(batches, concurrency, (group) => phraseCheck(md, group));
  // A batch that failed comes back empty; keep its sentences as unchecked
  // rather than silently reporting them as original.
  return batches.flatMap((group, i) =>
    results[i]?.length === group.length
      ? results[i]
      : group.map((phrase) => ({ phrase, url: null, unchecked: true })));
}

function cleanMarkdown(text: string) {
  return text
    .replace(/^\s*```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '')
    .replace(/^\s*#\s+.+\n+/, '') // the page renders the title as H1 already
    .trim();
}

// Drop links the model made up: internal ones not in our list, external
// ones that 404 or don't resolve. The link text stays.
async function checkLinks(md: string, internal: Set<string>, authorUrls = new Set<string>()) {
  const external = new Set<string>();
  for (const [, bang, , href] of Array.from(md.matchAll(LINK_RE))) {
    if (!bang && /^https?:/.test(href) && !authorUrls.has(href)) external.add(href);
  }
  const dead = new Set<string>();
  await pool(Array.from(external), 6, async (href) => {
    try {
      const r = await fetch(href, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (r.status === 404 || r.status === 410) dead.add(href);
    } catch (e: any) {
      if (e?.name !== 'TimeoutError') dead.add(href); // DNS / TLS failure; slow sites get the benefit of the doubt
    }
  });
  return md.replace(LINK_RE, (all, bang, text, href) => {
    if (bang) return all;
    if (href.startsWith('/')) return internal.has(href) ? all : text;
    return dead.has(href) ? text : all;
  });
}

// ─── Images (Pexels: free for commercial use, credit requested) ────────
async function pexels(query: string, used: Set<number>) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`,
      { headers: { Authorization: key }, cache: 'no-store', signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const photo = ((await r.json()).photos || []).find((p: any) => !used.has(p.id));
    if (!photo) return null;
    used.add(photo.id);
    const clean = (s: string) => (s || '').replace(/[[\]()*_|]/g, '').trim();
    const name = clean(photo.photographer);
    return {
      url: photo.src.large2x || photo.src.large,
      credit: `*Photo: [${/^https?:/i.test(name) || !name ? 'Pexels contributor' : name}](${photo.photographer_url}) on [Pexels](${photo.url})*`,
    };
  } catch {
    return null;
  }
}

async function replaceImages(md: string, used: Set<number>) {
  const markers = Array.from(md.matchAll(IMAGE_RE));
  const found: Awaited<ReturnType<typeof pexels>>[] = [];
  for (const [, query] of markers) found.push(await pexels(query, used)); // sequential: no duplicate photos
  let k = 0;
  return md.replace(IMAGE_RE, (_, _q, alt) => {
    const img = found[k++];
    // Image + credit on consecutive lines = one paragraph; the sites' CSS
    // (p > img + em) renders the credit small under the photo.
    return img ? `![${alt.replace(/[[\]]/g, '')}](${img.url})\n${img.credit}` : '';
  }).replace(/\n{3,}/g, '\n\n');
}

// ─── SEO checks ────────────────────────────────────────────────────────
function analyse(md: string, plan: Plan) {
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // punctuation would make "chahiye?" miss "chahiye"
    .toLowerCase();
  const words = plain.split(/\s+/).filter(Boolean);
  const text = ` ${words.join(' ')} `;
  const norm = (k: string) => k.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const has = (k: string) => text.split(` ${norm(k)} `).length - 1;
  const pk = norm(plan.primary_keyword);
  const h2s = md.match(/^## .+$/gm) || [];
  const links = Array.from(md.matchAll(LINK_RE)).filter((m) => !m[1]);
  return {
    words: words.length,
    inIntro: ` ${words.slice(0, 100).join(' ')} `.includes(` ${pk} `),
    inH2: h2s.some((h) => h.toLowerCase().includes(pk)),
    density: (has(pk) * pk.split(/\s+/).length * 100) / Math.max(words.length, 1),
    missing: plan.secondary_keywords.filter((k) => !has(k)),
    h2: h2s.length,
    internal: links.filter((m) => m[3].startsWith('/')).length,
    external: links.filter((m) => /^https?:/.test(m[3])).length,
    images: (md.match(/!\[[^\]]+\]\(/g) || []).length,
  };
}

function seoIssues(md: string, plan: Plan) {
  const a = analyse(md, plan);
  const issues: string[] = [];
  if (a.words < plan.target_words * 0.75) issues.push(`Too short: ${a.words} words, aim for about ${plan.target_words}. Expand the thinnest sections with specifics, not filler.`);
  if (!a.inIntro) issues.push(`Use the exact phrase "${plan.primary_keyword}" within the first 100 words.`);
  if (!a.inH2) issues.push(`Use the exact phrase "${plan.primary_keyword}" in at least one ## heading.`);
  if (a.density > 3) issues.push(`"${plan.primary_keyword}" is overused (${a.density.toFixed(1)}%). Replace some with natural variations.`);
  if (a.missing.length > plan.secondary_keywords.length / 2) issues.push(`Work these phrases in naturally: ${a.missing.map((k) => `"${k}"`).join(', ')}.`);
  return issues;
}

export function seoReport(md: string, plan: Plan) {
  const a = analyse(md, plan);
  return {
    words: a.words,
    density: Number(a.density.toFixed(2)),
    checks: [
      { label: `${a.words} words (target ${plan.target_words})`, ok: a.words >= plan.target_words * 0.75 },
      { label: 'Primary keyword in first 100 words', ok: a.inIntro },
      { label: 'Primary keyword in an H2', ok: a.inH2 },
      // No evidence a minimum density helps; stuffing measurably hurts. Upper bound only.
      { label: `Keyword density ${a.density.toFixed(1)}% (under 2.5% — no minimum)`, ok: a.density <= 2.5 },
      { label: a.missing.length ? `Missing: ${a.missing.join(', ')}` : 'All secondary keywords used', ok: !a.missing.length },
      { label: `${a.h2} H2 sections`, ok: a.h2 >= 3 },
      { label: `Title ${plan.title.length} chars (≤ 60)`, ok: plan.title.length <= 60 },
      { label: `Meta description ${plan.meta_description.length} chars (120–160)`, ok: plan.meta_description.length >= 120 && plan.meta_description.length <= 160 },
      { label: `${a.external} source links, ${a.internal} internal links`, ok: a.external >= 1 },
      { label: `${a.images} images`, ok: a.images >= 1 },
    ],
  };
}

// ─── Save as a draft post ──────────────────────────────────────────────
export async function savePost(item: Item, body: string, cover: { url: string } | null) {
  const sb = db();
  const plan = item.plan!;
  const fields = {
    site: item.site,
    category: plan.category,
    title: plan.title,
    excerpt: plan.meta_description,
    body_md: body,
    cover_url: cover?.url ?? null,
    og_title: plan.title,
    og_description: plan.meta_description,
    og_image_url: cover?.url ?? null,
  };
  if (item.post_id) {
    const { error } = await sb.from('posts').update(fields).eq('id', item.post_id);
    if (error) throw error;
    return item.post_id;
  }
  const base = slugify(plan.slug || plan.title) || `post-${item.id}`;
  const { data: taken } = await sb.from('posts').select('slug').eq('site', item.site).like('slug', `${base}%`);
  const slugs = new Set((taken || []).map((p: any) => p.slug));
  let slug = base;
  for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
  const { data, error } = await sb.from('posts')
    .insert({ ...fields, slug, published_at: null, author_email: 'blog-agent' })
    .select('id').single();
  if (error) throw error;
  return data.id as number;
}
