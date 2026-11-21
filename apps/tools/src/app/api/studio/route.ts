import { createHash, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { authorise, organisationFor, type Principal, type Ref, type Role } from '@/lib/studio/access';
import { dbStore } from '@/lib/studio/access-db';
import { HttpError, askJson, cached, insert, patch, principal, rows, withUsage } from '@/lib/studio/server';
import { cleanSource, newRef } from '@/lib/studio/safety';
import * as team from '@/lib/studio/team';
import { MAX_REVIEW_WORDS, parseReview, reviewPrompt } from '@/lib/studio/unwanted';
import * as knowledge from '@/lib/studio/knowledge';
import { knowledgeFor } from '@/lib/studio/knowledge';
import { findChannels, googleNews, googleTrends, hackerNews, hasYouTube, langCode, recentVideos, shortQuery, suggestions, topVideos, wikipedia, withFallback, type Source } from '@/lib/studio/sources';
import { competitorBrief, ideasPrompt, keywordsPrompt, learnedBlock, planPrompt, playbookPrompt, playbookText, readReelPrompt, revisePrompt, scriptPrompt, summarisePrompt, trendsPrompt, watchPrompt } from '@/lib/studio/prompts';
import { ALL_FORMATS, VIRAL, kindOf, lengthsFor, type Competitor, type FeedbackInput, type Page, type Playbook, type Script, type Summary, type Topic, type Video } from '@/lib/studio/shared';

export const maxDuration = 60;

const HOUR = 36e5;
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.round(n) : null;
};
// Ids go straight into PostgREST filters, so only real UUIDs get through.
const uuid = (v: unknown): string => {
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
  throw new HttpError(400, 'Bad id.');
};

async function pageOf(id: unknown): Promise<Page> {
  const [p] = await rows<Page>(`studio_brands?select=*&id=eq.${uuid(id)}`);
  if (!p) throw new HttpError(404, 'Page not found.');
  return p;
}

async function competitorOf(id: unknown): Promise<Competitor> {
  const [c] = await rows<Competitor>(`studio_competitors?select=*&id=eq.${uuid(id)}`);
  if (!c) throw new HttpError(404, 'Competitor not found.');
  return c;
}

// What the team has said before + what competitors do: both go into every prompt.
async function learnedFor(pageId: string) {
  const [fb, liked, disliked] = await Promise.all([
    rows(`studio_feedback?select=section,sentiment,note&page_id=eq.${pageId}&order=created_at.desc&limit=30`),
    rows<Script>(`studio_scripts?select=*&page_id=eq.${pageId}&rating=gte.4&order=created_at.desc&limit=3`),
    rows<Script>(`studio_scripts?select=*&page_id=eq.${pageId}&rating=lte.2&order=created_at.desc&limit=3`),
  ]);
  return learnedBlock(fb, liked, disliked);
}
// The combined playbook goes into every prompt; until one exists, the
// per-creator summaries stand in for it.
const playbookKey = (pageId: string) => `playbook:${pageId}`;
async function loadPlaybook(pageId: string): Promise<{ playbook: Playbook; at: string } | null> {
  const [row] = await rows(`studio_cache?select=data,at&key=eq.${encodeURIComponent(playbookKey(pageId))}`);
  return row ? { playbook: row.data as Playbook, at: row.at as string } : null;
}
async function briefFor(pageId: string) {
  const pb = await loadPlaybook(pageId);
  if (pb) return playbookText(pb.playbook);
  return competitorBrief(await rows(`studio_competitors?select=name,platform,summary&page_id=eq.${pageId}&summary=not.is.null`));
}

// ─── Work tab ──────────────────────────────────────────────────────────
// What the competitors uploaded in the last week, read live from YouTube so it
// is today's picture (the daily job only refreshes once a day). Each line says
// how the video is doing against that creator's usual views.
const UPLOAD_DAYS = 7;
async function competitorUploads(comps: Competitor[]): Promise<Source[]> {
  const youtube = comps.filter((c) => c.platform === 'youtube');
  if (!youtube.length || !hasYouTube()) return [];
  const lists = await Promise.all(
    youtube.map(async (c) => {
      const usual = c.summary?.stats?.median_views ?? 0;
      const vids = await recentVideos(c.ext_id, UPLOAD_DAYS, 20).catch(() => []);
      return vids.map((v) => {
        const ageDays = Math.round(((Date.now() - Date.parse(v.publishedAt)) / 864e5) * 10) / 10;
        const short = v.durationS > 0 && v.durationS <= VIRAL.maxShortS;
        const source: Source = {
          id: '',
          kind: 'video',
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          publisher: c.name,
          date: v.publishedAt,
          competitor: true,
          snippet: `${v.views.toLocaleString('en-IN')} views, ${ageDays} days old${usual > 0 ? `, ${Math.round((v.views / usual) * 10) / 10}x their usual` : ''}, ${short ? 'a Short' : 'a long video'}`,
        };
        return { ageDays, source };
      });
    }),
  );
  return lists.flat().sort((a, z) => a.ageDays - z.ageDays).slice(0, 60).map((x, i) => ({ ...x.source, id: `c${i + 1}` }));
}

const sourceLine = (s: Source) => `[${s.id}] ${s.title} (${s.publisher ?? ''}${s.date ? `, ${s.date.slice(0, 10)}` : ''})`;
const uploadLine = (s: Source) => `[${s.id}] ${s.publisher} | ${s.snippet} | "${s.title.slice(0, 110)}"`;
type RawTopic = Omit<Topic, 'sources'> & { source_ids?: string[] };

async function trends(b: any) {
  const page = await pageOf(b.pageId);
  const comps = await rows<Competitor>(`studio_competitors?select=*&page_id=eq.${page.id}&order=created_at`);
  // New direction or a new competitor means yesterday's ideas no longer fit.
  const direction = createHash('sha1').update(JSON.stringify([page.niche, page.audience, page.voice, page.languages, comps.map((c) => c.id)])).digest('hex').slice(0, 10);
  const topics = await cached<Topic[]>(`trends3:${page.id}:${direction}`, 6 * HOUR, !!b.fresh, async () => {
    const lang = langCode(page.languages[0] ?? 'English');
    const q = shortQuery(page.niche);
    const [trending, sugg, newsRaw, videosRaw, uploads] = await Promise.all([
      googleTrends(),
      withFallback(q, (s) => suggestions(s, lang)),
      withFallback(q, (s) => googleNews(s, lang)),
      hasYouTube() ? withFallback(q, (s) => topVideos(s, 14)).catch(() => []) : Promise.resolve([] as Source[]),
      competitorUploads(comps),
    ]);
    const news = newsRaw.map((s, i) => ({ ...s, id: `n${i + 1}` }));
    const videos = videosRaw.map((s, i) => ({ ...s, id: `y${i + 1}` }));
    const pool = new Map([...news, ...videos, ...uploads].map((s) => [s.id, s] as const));
    const [learned, brief] = await Promise.all([learnedFor(page.id), briefFor(page.id)]);
    const signals = {
      trending: trending.map((t) => `${t.term}${t.traffic ? ` (${t.traffic} searches)` : ''}${t.headline ? `: ${t.headline}` : ''}`).join('\n'),
      suggestions: sugg,
      news: news.map(sourceLine).join('\n'),
      videos: videos.map(sourceLine).join('\n'),
      uploads: uploads.map(uploadLine).join('\n'),
    };
    const raw = (await askJson<{ topics: RawTopic[] }>(trendsPrompt(page, signals, brief, learned))).topics ?? [];
    // An idea only stands if it cites real sources. The ids are looked up here,
    // so a source that does not exist can never reach the screen.
    return raw.flatMap(({ source_ids, ...t }) => {
      const found = [...new Set(Array.isArray(source_ids) ? source_ids.map(String) : [])].map((id) => pool.get(id)).filter((s): s is Source => !!s);
      return found.length ? [{ ...t, sources: found }] : [];
    });
  });
  return { topics };
}

// Search engines match loosely (a rare name drags in an election result and a
// football story), so keep only sources whose title or text shares enough of
// the topic's own keywords: at least a third of them, and never fewer than one.
function relevant(query: string, s: Source): boolean {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  if (!words.length) return true;
  const text = `${s.title} ${s.snippet ?? ''}`.toLowerCase();
  return words.filter((w) => text.includes(w)).length >= Math.max(1, Math.ceil(words.length / 3));
}

// News, YouTube, Hacker News and Wikipedia for a query, kept only when they are about it.
async function gather(query: string, language: string, fresh: boolean): Promise<Source[]> {
  const langs = [...new Set(['en' as const, langCode(language || 'English')])];
  const key = createHash('sha1').update(query.toLowerCase()).digest('hex');
  return cached<Source[]>(`sources3:${langs.join('')}:${key}`, 6 * HOUR, fresh, async () => {
    const [news, vids, hn, wiki] = await Promise.all([
      Promise.all(langs.map((l) => withFallback(query, (s) => googleNews(s, l, 14)))),
      hasYouTube() ? withFallback(query, (s) => topVideos(s, 120)).catch(() => []) : Promise.resolve([] as Source[]),
      withFallback(query, hackerNews),
      withFallback(query, wikipedia),
    ]);
    return [...wiki, ...news.flat(), ...vids, ...hn].filter((s) => relevant(query, s)).map((s, i) => ({ ...s, id: `s${i}` }));
  });
}

async function sources(b: any) {
  const topic = str(b.topic, 200);
  if (topic.length < 3) throw new HttpError(400, 'Enter a topic first.');
  // A trend idea brings short search keywords; a typed topic is searched as written.
  const query = str(b.query, 120) || topic;
  return { sources: await gather(query, str(b.language, 30) || 'English', !!b.fresh), youtube: hasYouTube() };
}

// Ideas for what the person typed or pasted, built only from sources that were searched
// for that subject. Every idea has to cite them, and the ids are checked here, so an idea
// without a real source never reaches the screen.
async function candidateIdeas(b: any) {
  const page = await pageOf(b.pageId);
  const brief = str(b.brief, 3000);
  if (brief.length < 3) throw new HttpError(400, 'Type a topic or paste a description first.');
  const platforms = ALL_FORMATS.filter((p) => Array.isArray(b.platforms) && b.platforms.includes(p));
  const language = str(b.language, 30) || page.languages[0] || 'English';

  // A topic of a few words is searched as written. A sentence or a longer description is boiled
  // down to keywords first: news search finds nothing for a whole sentence.
  const oneLine = brief.replace(/\s+/g, ' ');
  const query = oneLine.split(' ').length <= 5
    ? oneLine
    : str((await askJson<{ search_query?: string }>(keywordsPrompt(brief), { lite: true }).catch(() => ({}) as { search_query?: string })).search_query, 120) || oneLine.slice(0, 100);

  const comps = await rows<Competitor>(`studio_competitors?select=*&page_id=eq.${page.id}&order=created_at`);
  const [web, uploadsAll, learned, playbook] = await Promise.all([
    gather(query, language, !!b.fresh),
    competitorUploads(comps),
    learnedFor(page.id),
    briefFor(page.id),
  ]);
  const uploads = uploadsAll.filter((s) => relevant(query, s));
  // Text the person pasted is itself a source they trust.
  const own: Source[] = brief.length >= 200 ? [{ id: 'b1', kind: 'own', title: brief.split('\n')[0].slice(0, 80), snippet: brief.slice(0, 6000) }] : [];
  const pool = new Map([...own, ...web, ...uploads].map((s) => [s.id, s] as const));
  if (!pool.size) return { topics: [] as Topic[], query, reason: 'No news, videos or articles were found about this. Try other words, or paste an article or notes instead.' };

  const raw = (await askJson<{ topics: RawTopic[] }>(ideasPrompt({
    page, brief, platforms, language, playbook, learned, opinion: str(b.opinion, 1500),
    web: [...own.map((s) => `[${s.id}] pasted by the team: ${s.snippet?.slice(0, 600)}`), ...web.slice(0, 40).map(sourceLine)].join('\n'),
    uploads: uploads.map(uploadLine).join('\n'),
  }))).topics ?? [];
  const topics = raw.flatMap(({ source_ids, ...t }) => {
    const found = [...new Set(Array.isArray(source_ids) ? source_ids.map(String) : [])].map((id) => pool.get(id)).filter((s): s is Source => !!s);
    return found.length ? [{ ...t, sources: found }] : [];
  });
  return { topics, query, reason: topics.length ? '' : 'None of the sources found were close enough to your topic to build a reliable idea. Try other words, or paste an article or notes instead.' };
}

// Several ideas become ONE. The AI picks the strongest, or combines the best of them, and
// the sources of the ideas it used travel with it. The person never has to choose.
async function choosePlan(page: Page, brief: string, opinion: string, platforms: string[], topics: Topic[]): Promise<Topic | null> {
  if (!topics.length) return null;
  if (topics.length === 1) return topics[0];
  const r = await askJson<{ title?: string; why_now?: string; angle?: string; hook_idea?: string; based_on?: unknown[] }>(
    planPrompt({ page, brief, platforms, opinion, topics }),
    { lite: true },
  ).catch(() => null);
  if (!r?.title) return topics[0]; // the AI could not decide: the strongest-ranked idea stands
  const used = (Array.isArray(r.based_on) ? r.based_on : []).map((n) => topics[Number(n) - 1]).filter((t): t is Topic => !!t);
  const from = used.length ? used : topics;
  const seen = new Set<string>();
  const sources = from.flatMap((t) => t.sources ?? []).filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, 12);
  return {
    title: str(r.title, 200), why_now: str(r.why_now, 400) || from[0].why_now, angle: str(r.angle, 500) || from[0].angle,
    hook_idea: str(r.hook_idea, 300) || from[0].hook_idea, search_query: from[0].search_query, sources,
  };
}

// One request from topic to plan: find sources, make candidate ideas, choose or combine them.
// With `trending`, the candidates come from what is trending for the brand instead of a typed topic.
async function ideas(b: any) {
  const page = await pageOf(b.pageId);
  const platforms = ALL_FORMATS.filter((p) => Array.isArray(b.platforms) && b.platforms.includes(p));
  let found: { topics: Topic[]; query?: string; reason: string };
  if (b.trending) {
    const t = (await trends(b)).topics;
    found = { topics: t, reason: t.length ? '' : 'No trending idea had a real source behind it today. Type your own topic instead.' };
  } else {
    found = await candidateIdeas(b);
  }
  let plan = await choosePlan(page, b.trending ? '' : str(b.brief, 3000), str(b.opinion, 1500), platforms, found.topics);
  // No idea could be backed by a source. A typed topic is still written about, from the team's own
  // words, opinion and knowledge; the screen says that the facts were not source-checked.
  let thin = false;
  if (!plan && !b.trending) {
    const text = str(b.brief, 3000);
    const one = text.replace(/\s+/g, ' ');
    plan = { title: (one.length <= 200 ? one : text.split(String.fromCharCode(10))[0].slice(0, 120)).slice(0, 200), why_now: '', angle: '', hook_idea: '', search_query: found.query ?? one.slice(0, 100), sources: [] };
    thin = true;
  }
  return { ...found, plan, thin };
}

type Parts = { hook: unknown; body: unknown; conclusion: unknown; cta: unknown };
const text = (v: unknown) => (Array.isArray(v) ? v.join('\n') : String(v ?? '')).trim();
function parts(r: Parts) {
  const out = { hook: text(r.hook), body: text(r.body), conclusion: text(r.conclusion), cta: text(r.cta) };
  if (!out.hook || !out.body) throw new HttpError(502, 'Gemini returned an incomplete script. Try again.');
  return out;
}

async function script(b: any, who: string) {
  const page = await pageOf(b.pageId);
  const [learned, brief] = await Promise.all([learnedFor(page.id), briefFor(page.id)]);

  if (b.reviseOf) {
    const [prev] = await rows<Script>(`studio_scripts?select=*&id=eq.${uuid(b.reviseOf)}`);
    if (!prev || prev.page_id !== page.id) throw new HttpError(404, 'Not found.');
    const feedback: FeedbackInput[] = Array.isArray(b.feedback) ? b.feedback.slice(0, 20) : [];
    const platform = ALL_FORMATS.find((p) => p === b.platform) ?? '';
    const know = await knowledgeFor(page.id, prev.topic);
    const r = await askJson<Parts>(revisePrompt({ knowledge: know, page, script: prev, feedback, sources: prev.sources as Source[], learned, brief, instruction: str(b.instruction, 400), platform, opinion: str(b.opinion, 1500), replyTo: str(b.replyTo, 3000) }), { timeoutMs: kindOf(platform) === 'long' ? 55_000 : undefined, noThink: kindOf(platform) === 'long' });
    const [top] = await rows<{ version: number }>(`studio_scripts?select=version&root_id=eq.${prev.root_id}&order=version.desc&limit=1`);
    const [row] = await insert<Script>('studio_scripts', {
      id: randomUUID(), page_id: page.id, root_id: prev.root_id, version: (top?.version ?? prev.version) + 1,
      topic: prev.topic, language: prev.language, length_s: prev.length_s, sources: prev.sources, created_by: who, ...parts(r),
    });
    return { script: row };
  }

  const topic = str(b.topic, 200);
  if (topic.length < 3) throw new HttpError(400, 'Pick or type a topic first.');
  const language = str(b.language, 30);
  const picked: Source[] = Array.isArray(b.sources) ? b.sources.slice(0, 15).map(cleanSource).filter((x: Source | null): x is Source => !!x) : [];
  const platform = ALL_FORMATS.find((p) => p === b.platform) ?? '';
  // Video formats have a length; Reddit posts and WhatsApp messages do not (stored as 0).
  const lengths = lengthsFor(kindOf(platform));
  const lengthS = lengths.length ? (lengths.includes(Number(b.lengthS)) ? Number(b.lengthS) : lengths[1]) : 0;
  // A long video script can take longer than the usual 45 seconds (the route allows 60).
  const know = await knowledgeFor(page.id, topic);
  const r = await askJson<Parts>(scriptPrompt({ knowledge: know, page, topic, language, lengthS, sources: picked, instruction: str(b.instruction, 400), brief, learned, platform, opinion: str(b.opinion, 1500), replyTo: str(b.replyTo, 3000) }), { timeoutMs: kindOf(platform) === 'long' ? 55_000 : undefined, noThink: kindOf(platform) === 'long' });
  const id = randomUUID();
  const [row] = await insert<Script>('studio_scripts', {
    id, page_id: page.id, root_id: id, version: 1, topic, language, length_s: lengthS, sources: picked, created_by: who, ...parts(r),
  });
  return { script: row };
}

// ─── Competition tab ───────────────────────────────────────────────────
async function search(b: any) {
  const term = str(b.term, 200);
  if (term.length < 2) throw new HttpError(400, 'Type a topic, a creator name, or paste a channel link.');
  return { channels: await findChannels(term) };
}

async function fetchVideos(b: any) {
  const c = await competitorOf(b.competitorId);
  if (c.platform !== 'youtube') throw new HttpError(400, 'Only YouTube channels are fetched automatically. Add Instagram reels by hand.');
  let vids = await recentVideos(c.ext_id, VIRAL.days);
  // Nothing viral lately? Read further back, so the widened windows have data.
  const viral = (v: { durationS: number; views: number }) => v.durationS > 0 && v.durationS <= VIRAL.maxShortS && v.views >= VIRAL.minViews;
  if (!vids.some(viral) && VIRAL.widenTo.length) vids = await recentVideos(c.ext_id, Math.max(...VIRAL.widenTo), 300);
  if (!vids.length) return { count: 0, shorts: 0 }; // no uploads at all: summarise() explains it
  await insert(
    'studio_videos?on_conflict=competitor_id,ext_id',
    vids.map((v) => ({
      competitor_id: c.id, ext_id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, caption: v.description,
      published_at: v.publishedAt, views: v.views, likes: v.likes, comments: v.comments, duration_s: v.durationS, is_short: v.durationS > 0 && v.durationS <= VIRAL.maxShortS,
    })),
    'resolution=merge-duplicates,return=minimal',
  );
  return { count: vids.length, shorts: vids.filter((v) => v.durationS > 0 && v.durationS <= VIRAL.maxShortS).length };
}

type Read = { transcript?: string; language?: string; hook?: string; hook_type?: string; beats?: unknown; cta?: string; topic?: string; style_notes?: string };
const readColumns = (r: Read) => ({
  transcript: text(r.transcript) || null,
  hook: text(r.hook) || null,
  structure: { hook_type: r.hook_type, beats: r.beats, cta: r.cta, topic: r.topic, style_notes: r.style_notes, language: r.language },
  analyzed_at: new Date().toISOString(),
});

// The shorts worth learning from: past 10K views, best 10 by views, from the
// last 30 days. If there are none, the window widens (90, then 365 days) and
// `days` says which window was used.
const isoDaysAgo = (days: number) => encodeURIComponent(new Date(Date.now() - days * 864e5).toISOString());
async function viralOf(competitorId: string): Promise<{ days: number; videos: (Video & { ext_id: string })[] }> {
  const windows = [VIRAL.days, ...VIRAL.widenTo];
  const widest = Math.max(...windows);
  const all = await rows<Video & { ext_id: string }>(
    `studio_videos?select=*&competitor_id=eq.${competitorId}&is_short=eq.true&published_at=gte.${isoDaysAgo(widest)}&views=gte.${VIRAL.minViews}&order=views.desc&limit=200`,
  );
  for (const days of windows) {
    const since = Date.now() - days * 864e5;
    const inWindow = all.filter((v) => Date.parse(v.published_at ?? '') >= since).slice(0, VIRAL.top);
    if (inWindow.length) return { days, videos: inWindow };
  }
  return { days: widest, videos: [] };
}

// Watches those shorts, three per call so each call stays inside the time
// limit. Ones already watched are skipped, so a daily re-run only reads new
// qualifiers. The browser keeps calling until none remain.
async function deepVideos(b: any) {
  const c = await competitorOf(b.competitorId);
  if (c.platform !== 'youtube') return { total: 0, remaining: 0 };
  const { videos: target } = await viralOf(c.id);
  const pending = target.filter((v) => !v.analyzed_at);
  const batch = pending.slice(0, 3);
  await Promise.all(
    batch.map(async (v) => {
      try {
        await patch(`studio_videos?id=eq.${v.id}`, readColumns(await askJson<Read>(watchPrompt(), { lite: true, video: v.url! })));
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) throw e; // out of quota: stop, don't mark it as failed
        await patch(`studio_videos?id=eq.${v.id}`, { analyzed_at: new Date().toISOString(), structure: { error: e instanceof Error ? e.message : 'Could not read this video' } });
      }
    }),
  );
  return { total: target.length, remaining: pending.length - batch.length };
}

const sorted = (vids: Video[]) => vids.map((v) => v.views ?? 0).sort((a, z) => a - z);
const mean = (n: number[]) => Math.round(n.reduce((s, x) => s + x, 0) / Math.max(1, n.length));

// Instagram: whatever reels the team pasted.
function statsOf(vids: Video[]): NonNullable<Summary['stats']> {
  const views = sorted(vids);
  const dates = vids.map((v) => Date.parse(v.published_at ?? '')).filter(Number.isFinite).sort((a, z) => a - z);
  const weeks = dates.length > 1 ? Math.max(1, (dates[dates.length - 1] - dates[0]) / (7 * 864e5)) : 1;
  return {
    videos: vids.length,
    shorts: vids.filter((v) => v.is_short).length,
    avg_views: mean(views),
    median_views: views[Math.floor(views.length / 2)] ?? 0,
    best_views: views[views.length - 1] ?? 0,
    per_week: Math.round((vids.length / weeks) * 10) / 10,
  };
}

// YouTube: how the channel's shorts did over the window, and how many went viral.
function windowStats(shorts: Video[], qualified: number, days: number): NonNullable<Summary['stats']> {
  const views = sorted(shorts);
  return {
    window_days: days,
    min_views: VIRAL.minViews,
    shorts_in_window: shorts.length,
    qualified,
    avg_views: mean(views),
    median_views: views[Math.floor(views.length / 2)] ?? 0,
    best_views: views[views.length - 1] ?? 0,
    per_week: Math.round((shorts.length / (days / 7)) * 10) / 10,
  };
}

const k = (n: number) => n.toLocaleString('en-IN');

async function summarise(b: any) {
  const c = await competitorOf(b.competitorId);
  let summary: Summary;
  if (c.platform === 'youtube') {
    const { days, videos: viral } = await viralOf(c.id);
    const inWindow = await rows<Video>(`studio_videos?select=views,published_at,is_short&competitor_id=eq.${c.id}&published_at=gte.${isoDaysAgo(days)}`);
    const shorts = inWindow.filter((v) => v.is_short);
    const longs = inWindow.filter((v) => !v.is_short);
    const stats = windowStats(shorts, viral.length, days);
    if (viral.length) {
      summary = { ...(await askJson<Summary>(summarisePrompt(c, stats, viral, { days, minViews: VIRAL.minViews }))), stats };
      if (days > VIRAL.days) summary.note = `No Shorts reached ${k(VIRAL.minViews)} views in the last ${VIRAL.days} days, so this looks at the last ${days} days instead.`;
    } else {
      const best = Math.max(0, ...shorts.map((v) => v.views ?? 0));
      const why = shorts.length
        ? `None of their ${shorts.length} Shorts from the last ${days} days reached ${k(VIRAL.minViews)} views (the best had ${k(best)}).`
        : longs.length
          ? `They have not posted any Shorts in the last ${days} days, only long videos (${longs.length} of them, the best with ${k(Math.max(...longs.map((v) => v.views ?? 0)))} views). This studio learns from Shorts only.`
          : `They have not posted anything in the last ${days} days.`;
      summary = { stats, note: `${why} Checked again every day.` };
    }
  } else {
    const vids = await rows<Video>(`studio_videos?select=*&competitor_id=eq.${c.id}&order=published_at.desc.nullslast&limit=60`);
    if (!vids.length) throw new HttpError(400, 'No videos to learn from yet.');
    summary = { ...(await askJson<Summary>(summarisePrompt(c, statsOf(vids), vids))), stats: statsOf(vids) };
  }
  await patch(`studio_competitors?id=eq.${c.id}`, { summary, analyzed_at: new Date().toISOString() });
  return { summary };
}

// Instagram has no free official way to read other people's reels, so the
// team pastes the link, caption and what is said, and the same analysis runs.
async function addReel(b: any) {
  const c = await competitorOf(b.competitorId);
  const url = str(b.url, 500), caption = str(b.caption, 3000), transcript = str(b.transcript, 6000);
  if (!caption && !transcript) throw new HttpError(400, 'Paste the caption or what is said in the reel.');
  const read = await askJson<Read>(readReelPrompt(caption, transcript), { lite: true });
  const [video] = await insert<Video>('studio_videos?on_conflict=competitor_id,ext_id', {
    competitor_id: c.id,
    ext_id: url || createHash('sha1').update(caption + transcript).digest('hex'),
    url: url || null,
    title: caption.slice(0, 120) || null,
    caption,
    views: num(b.views),
    likes: num(b.likes),
    is_short: true,
    ...readColumns(read),
    transcript: transcript || text(read.transcript) || null,
  }, 'resolution=merge-duplicates,return=representation');
  return { video };
}

async function getPlaybook(b: any) {
  const pb = await loadPlaybook(uuid(b.pageId));
  return { playbook: pb?.playbook ?? null, at: pb?.at ?? null };
}

// Reads every competitor's most viral Shorts (only the ones watched in full)
// and writes one combined playbook for the page. One Gemini call.
async function consolidate(b: any) {
  const page = await pageOf(b.pageId);
  const comps = await rows<Competitor>(`studio_competitors?select=*&page_id=eq.${page.id}&order=created_at`);
  const groups = (
    await Promise.all(
      comps.map(async (c) => {
        const videos =
          c.platform === 'youtube'
            ? (await viralOf(c.id)).videos
            : await rows<Video>(`studio_videos?select=*&competitor_id=eq.${c.id}&order=views.desc.nullslast&limit=${VIRAL.top}`);
        return { name: c.name, platform: c.platform, median: c.summary?.stats?.median_views ?? 0, videos: videos.filter((v) => v.analyzed_at && v.hook) };
      }),
    )
  ).filter((g) => g.videos.length);
  if (!groups.length) throw new HttpError(400, 'Analyse at least one competitor first: there are no watched viral Shorts to learn from yet.');
  const playbook: Playbook = {
    ...(await askJson<Playbook>(playbookPrompt(page, groups))),
    based_on: { creators: groups.length, videos: groups.reduce((s, g) => s + g.videos.length, 0) },
  };
  const at = new Date().toISOString();
  await insert('studio_cache?on_conflict=key', { key: playbookKey(page.id), data: playbook, at }, 'resolution=merge-duplicates,return=minimal');
  return { playbook, at };
}

// ─── Silence remover: unwanted parts ───────────────────────────────────
// Gemini reads the word-by-word transcript (made by Whisper in the browser) and points at repeated
// takes, fumbles and fillers. Nothing is cut here; the editor only highlights them.
async function unwanted(b: any) {
  const words: string[] = (Array.isArray(b.words) ? b.words : []).map((w: unknown) => String(w ?? '').slice(0, 40));
  if (!words.length) throw new HttpError(400, 'There is no transcript to check.');
  if (words.length > MAX_REVIEW_WORDS) throw new HttpError(400, `This part is too long to check at once (${words.length} words; ${MAX_REVIEW_WORDS} at most). Choose a shorter part.`);
  return { items: parseReview(await askJson<unknown>(reviewPrompt(words), { timeoutMs: 55_000, noThink: true }), words.length) };
}

// ─── Who may call what ─────────────────────────────────────────────────
// Every action says which role it needs and what it is about. authorise() looks
// up who really owns those things; the browser's word is never taken for it.
type Def = { need: Role; ref: (b: any) => Ref; cron?: boolean; run: (b: any, p: Principal) => Promise<object> };
const brandRef = (b: any): Ref => ({ brandId: String(b.pageId ?? b.brandId ?? '') });
const competitorRef = (b: any): Ref => ({ competitorId: String(b.competitorId ?? '') });
const who = (p: Principal) => (p.kind === 'user' ? p.email : 'cron');

const ACTIONS: Record<string, Def> = {
  trends: { need: 'editor', ref: brandRef, run: (b) => trends(b) },
  ideas: { need: 'editor', ref: brandRef, run: (b) => ideas(b) },
  // Knowledge: documents and notes the writer may use.
  'knowledge.list': { need: 'viewer', ref: brandRef, run: (b) => knowledge.list(b) },
  'knowledge.get': { need: 'viewer', ref: brandRef, run: (b) => knowledge.get(b) },
  'knowledge.add': { need: 'editor', ref: brandRef, run: (b, p) => knowledge.add(b, who(p)) },
  'knowledge.readPdf': { need: 'editor', ref: brandRef, run: (b) => knowledge.readPdf(b) },
  'knowledge.update': { need: 'editor', ref: brandRef, run: (b) => knowledge.update(b) },
  'knowledge.delete': { need: 'editor', ref: brandRef, run: (b) => knowledge.del(b) },
  script: { need: 'editor', ref: (b) => ({ ...brandRef(b), ...(b.reviseOf ? { scriptId: String(b.reviseOf) } : {}) }), run: (b, p) => script(b, who(p)) },
  playbook: { need: 'viewer', ref: brandRef, run: (b) => getPlaybook(b) },
  // The daily job may refresh competitors and rebuild the playbook, and nothing else.
  fetchVideos: { need: 'editor', cron: true, ref: competitorRef, run: (b) => fetchVideos(b) },
  deepVideos: { need: 'editor', cron: true, ref: competitorRef, run: (b) => deepVideos(b) },
  summarise: { need: 'editor', cron: true, ref: competitorRef, run: (b) => summarise(b) },
  consolidate: { need: 'editor', cron: true, ref: brandRef, run: (b) => consolidate(b) },
  addReel: { need: 'editor', ref: competitorRef, run: (b) => addReel(b) },
  unwanted: { need: 'editor', ref: brandRef, run: (b) => unwanted(b) },
};

// Not about one brand: tied to the person's organisation unless a brand is named.
const OPEN: Record<string, (b: any) => Promise<object>> = { sources: (b) => sources(b), search: (b) => search(b) };

// Organisations, people, invitations, brands and usage (new).
const TEAM: Record<string, (b: any, p: Principal) => Promise<object>> = {
  'org.list': (_b, p) => team.orgList(p),
  'org.create': team.orgCreate,
  'org.update': team.orgUpdate,
  'member.list': team.memberList,
  'member.invite': team.memberInvite,
  'member.setRole': team.memberSetRole,
  'member.remove': team.memberRemove,
  'invite.revoke': team.inviteRevoke,
  'invite.accept': team.inviteAccept,
  'brand.list': team.brandList,
  'brand.create': team.brandCreate,
  'brand.update': team.brandUpdate,
  'brand.archive': team.brandArchive,
  'usage.get': team.usageGet,
};

export async function POST(req: Request) {
  try {
    const p = await principal(req);
    const b = await req.json().catch(() => ({}));
    const action = String(b?.action ?? '');

    if (TEAM[action]) return NextResponse.json(await TEAM[action](b, p));

    let run: (() => Promise<object>) | undefined;
    let access;
    if (ACTIONS[action]) {
      const def = ACTIONS[action];
      access = await authorise(dbStore, p, def.need, def.ref(b), { cronAllowed: def.cron });
      run = () => def.run(b, p);
    } else if (OPEN[action]) {
      access = b.pageId || b.brandId ? await authorise(dbStore, p, 'editor', brandRef(b)) : await organisationFor(dbStore, p, 'editor');
      run = () => OPEN[action](b);
    }
    if (!run || !access) throw new HttpError(400, 'Unknown action.');

    // AI calls made while this runs are counted against the organisation and limited.
    return NextResponse.json(await withUsage({ organisationId: access.organisationId, userId: p.kind === 'user' ? p.id : null, action }, run));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    // Anything else is a bug or an upstream failure. Details stay in the log, not on the screen.
    const ref = newRef();
    console.error(`studio api [${ref}]:`, e);
    return NextResponse.json({ error: `Something went wrong on our side (ref ${ref}). Try again, and quote the reference if it keeps happening.` }, { status: 500 });
  }
}
