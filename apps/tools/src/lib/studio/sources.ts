// Content Studio — where trends, sources and competitor data come from.
// Free feeds (Google Trends / News / search suggestions, Hacker News,
// Wikipedia) plus the YouTube Data API. WhatsApp-style scraping is not used:
// everything here is an official API or a public feed.

import { HttpError } from './server';

import type { Lang, Source } from './shared';
export type { Lang, Source };

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; craftedbyteja-studio)' };
const get = (url: string) =>
  fetch(url, { cache: 'no-store', headers: UA, signal: AbortSignal.timeout(10_000) }).catch(() => null);

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string) =>
  decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '').trim();
const items = (xml: string) => xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

const REGION: Record<Lang, string> = { en: 'hl=en-IN&gl=IN&ceid=IN:en', te: 'hl=te&gl=IN&ceid=IN:te', hi: 'hl=hi&gl=IN&ceid=IN:hi' };

export const langCode = (language: string): Lang => (/telugu|tenglish/i.test(language) ? 'te' : /hindi|hinglish/i.test(language) ? 'hi' : 'en');

// A niche is written as a description ("Personal finance for young salaried
// people"), but Google searches need the short phrase: "Personal finance".
export const shortQuery = (niche: string) =>
  niche.split(/\s+(?:for|about|targeting|aimed|focused|that|who)\s+|[,.;:()]/i)[0].trim().slice(0, 60) || niche.slice(0, 60);

// If a phrase finds nothing, retry with its first two words.
export async function withFallback<T>(q: string, fetcher: (q: string) => Promise<T[]>): Promise<T[]> {
  const first = await fetcher(q);
  const words = q.split(/\s+/);
  return first.length || words.length <= 2 ? first : fetcher(words.slice(0, 2).join(' '));
}

// What India is searching right now (any topic; the AI filters for the niche).
export async function googleTrends(): Promise<{ term: string; traffic: string; headline: string }[]> {
  const res = await get('https://trends.google.com/trending/rss?geo=IN');
  if (!res?.ok) return [];
  return items(await res.text()).slice(0, 25).map((it) => ({
    term: tag(it, 'title'),
    traffic: tag(it, 'ht:approx_traffic'),
    headline: tag(it, 'ht:news_item_title'),
  }));
}

export async function googleNews(q: string, lang: Lang = 'en', days = 7): Promise<Source[]> {
  const res = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&${REGION[lang]}`);
  if (!res?.ok) return [];
  return items(await res.text()).slice(0, 8).map((it, i) => ({
    id: `news${i}`,
    kind: 'news' as const,
    title: tag(it, 'title'),
    url: tag(it, 'link'),
    publisher: tag(it, 'source'),
    date: tag(it, 'pubDate'),
  }));
}

// What people actually type into Google about this — the best free demand signal.
export async function suggestions(q: string, lang: Lang = 'en'): Promise<string[]> {
  const probes = [q, ...['how', 'what', 'why', 'best', 'vs'].map((w) => `${w} ${q}`)];
  const out = new Set<string>();
  await Promise.all(
    probes.map(async (p) => {
      const res = await get(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&gl=in&q=${encodeURIComponent(p)}`);
      const data = await res?.json().catch(() => null);
      for (const s of (data?.[1] ?? []) as string[]) out.add(s);
    }),
  );
  return [...out].slice(0, 25);
}

export async function hackerNews(q: string): Promise<Source[]> {
  const res = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`);
  const data = await res?.json().catch(() => null);
  return ((data?.hits ?? []) as { title: string; url?: string; objectID: string; points: number; created_at: string }[])
    .filter((h) => h.points >= 20)
    .slice(0, 4)
    .map((h, i) => ({
      id: `hn${i}`,
      kind: 'discussion' as const,
      title: h.title,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      publisher: `Hacker News · ${h.points} points`,
      date: h.created_at,
    }));
}

// Background reading: the Wikipedia summary for the topic, when there is one.
export async function wikipedia(q: string): Promise<Source[]> {
  const found = await (await get(`https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(q)}`))?.json().catch(() => null);
  const title = found?.[1]?.[0];
  if (!title) return [];
  const page = await (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`))?.json().catch(() => null);
  if (!page?.extract) return [];
  return [{ id: 'wiki0', kind: 'wiki', title: `${page.title} (Wikipedia)`, url: page.content_urls?.desktop?.page, snippet: String(page.extract).slice(0, 700) }];
}

// ─── YouTube Data API ──────────────────────────────────────────────────
async function yt<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new HttpError(501, 'YOUTUBE_API_KEY is not set on the tools app.');
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const quota = data?.error?.errors?.[0]?.reason === 'quotaExceeded';
    throw new HttpError(quota ? 429 : 502, quota ? 'YouTube’s free daily limit is used up. It resets at midnight Pacific time.' : `YouTube: ${data?.error?.message ?? res.statusText}`);
  }
  return data as T;
}

export const hasYouTube = () => !!process.env.YOUTUBE_API_KEY;

export type Channel = { id: string; name: string; handle: string; url: string; thumb: string; followers: number; videos: number };

const toChannel = (c: any): Channel => {
  const custom: string = c.snippet?.customUrl ?? '';
  return {
    id: c.id,
    name: c.snippet?.title ?? '',
    handle: custom,
    url: `https://www.youtube.com/${custom.startsWith('@') ? custom : `channel/${c.id}`}`,
    thumb: c.snippet?.thumbnails?.default?.url ?? '',
    followers: Number(c.statistics?.subscriberCount ?? 0),
    videos: Number(c.statistics?.videoCount ?? 0),
  };
};

// A pasted link / @handle / channel id goes straight to that channel;
// anything else is a topic or creator name and gets searched.
export async function findChannels(term: string): Promise<Channel[]> {
  const part = 'snippet,statistics';
  const id = term.match(/channel\/(UC[\w-]{22})/)?.[1] ?? (/^UC[\w-]{22}$/.test(term.trim()) ? term.trim() : null);
  const handle = term.match(/(@[\w.-]+)/)?.[1];
  if (id || handle) {
    const r = await yt('channels', { part, ...(id ? { id } : { forHandle: handle! }) });
    return (r.items ?? []).map(toChannel);
  }
  const found = await yt('search', { part: 'snippet', type: 'channel', q: term, maxResults: '10', regionCode: 'IN' });
  const ids = (found.items ?? []).map((i: any) => i.id?.channelId).filter(Boolean);
  if (!ids.length) return [];
  const r = await yt('channels', { part, id: ids.join(',') });
  return (r.items ?? []).map(toChannel);
}

export type YtVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  durationS: number;
};

const seconds = (iso: string) => {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

// Everything the channel uploaded in the last `sinceDays` days, with stats
// (up to `maxVideos`). An uploads playlist id is the channel id with "UC"
// swapped for "UU"; it lists newest first, so we stop at the first old video.
export async function recentVideos(channelId: string, sinceDays: number, maxVideos = 150): Promise<YtVideo[]> {
  const cutoff = Date.now() - sinceDays * 864e5;
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < maxVideos) {
    const list = await yt('playlistItems', {
      part: 'contentDetails',
      playlistId: `UU${channelId.slice(2)}`,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    let reachedOld = false;
    for (const i of (list.items ?? []) as any[]) {
      if (Date.parse(i.contentDetails?.videoPublishedAt ?? '') < cutoff) reachedOld = true;
      else ids.push(i.contentDetails.videoId);
    }
    pageToken = list.nextPageToken;
    if (!pageToken || reachedOld) break;
  }
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
    for (const v of (r.items ?? []) as any[])
      out.push({
        id: v.id,
        title: v.snippet.title,
        description: String(v.snippet.description ?? '').slice(0, 1500),
        publishedAt: v.snippet.publishedAt,
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
        durationS: seconds(v.contentDetails?.duration ?? ''),
      });
  }
  return out;
}

// Most-watched recent videos on a topic: a "what's working right now" signal
// and a source list for scripts.
export async function topVideos(q: string, days: number): Promise<Source[]> {
  const r = await yt('search', {
    part: 'snippet',
    type: 'video',
    q,
    order: 'viewCount',
    maxResults: '8',
    regionCode: 'IN',
    publishedAfter: new Date(Date.now() - days * 864e5).toISOString(),
  });
  return (r.items ?? []).map((v: any, i: number) => ({
    id: `yt${i}`,
    kind: 'video' as const,
    title: decode(v.snippet.title),
    url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
    publisher: decode(v.snippet.channelTitle),
    date: v.snippet.publishedAt,
  }));
}
