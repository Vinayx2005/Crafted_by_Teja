// Content Studio — types and constants used by both the browser and the server.

export const LANGUAGE_RULES: Record<string, string> = {
  English: 'Simple, spoken Indian English. Short sentences. Explain any jargon in plain words.',
  Telugu:
    'Telugu, written in Telugu script (తెలుగు). Casual spoken style, the way a creator talks to friends, never bookish. Everyday English words that people normally say in English can stay in English.',
  Hindi:
    'Hindi, written in Devanagari (हिन्दी). Casual spoken style, the way a creator talks to friends, never bookish. Everyday English words that people normally say in English can stay in English.',
  Tenglish:
    'Telugu written in English letters (Tenglish), exactly how Telugu creators speak, mixing English words naturally. No Telugu script.',
  Hinglish:
    'Hindi written in English letters (Hinglish), exactly how Hindi creators speak, mixing English words naturally. No Devanagari script.',
};
export const LANGUAGE_OPTIONS = Object.keys(LANGUAGE_RULES);
export const PAGE_LANGUAGES = ['English', 'Telugu', 'Hindi'];

// The script languages worth offering for a page: each language it posts in,
// plus the romanised mix (Tenglish / Hinglish) for Telugu and Hindi.
export const scriptLanguages = (pageLanguages: string[]): string[] => {
  const out = LANGUAGE_OPTIONS.filter(
    (l) => pageLanguages.includes(l) || (l === 'Tenglish' && pageLanguages.includes('Telugu')) || (l === 'Hinglish' && pageLanguages.includes('Hindi')),
  );
  return out.length ? out : LANGUAGE_OPTIONS;
};
export const LENGTHS = [30, 45, 60, 90];

// What a script is written for. Every format is stored the same way (hook, body,
// conclusion, cta): for a Reddit post the hook is the title, for a WhatsApp message
// it is the opening line.
export const PLATFORM_OPTIONS = ['YouTube long format', 'Shorts / Reels', 'Reddit post', 'WhatsApp group'];
export const PLATFORM_HINTS: Record<string, string> = {
  'YouTube long format': 'A 3 to 10 minute video script',
  'Shorts / Reels': 'A vertical video under 90 seconds',
  'Reddit post': 'A new post, or a reply to a comment',
  'WhatsApp group': 'A short message for a group',
};
// "Reddit post" on the card turns into one of these two, depending on the answer to "new post or reply?".
export const REDDIT_REPLY = 'Reddit reply';
export const ALL_FORMATS = [...PLATFORM_OPTIONS, REDDIT_REPLY];
export type Kind = 'long' | 'short' | 'reddit' | 'redditReply' | 'whatsapp';
export const kindOf = (platform?: string): Kind =>
  platform === 'YouTube long format' ? 'long' : platform === 'Reddit post' ? 'reddit' : platform === REDDIT_REPLY ? 'redditReply' : platform === 'WhatsApp group' ? 'whatsapp' : 'short';
export const SHORT_LENGTHS = [30, 45, 60, 90];
export const LONG_LENGTHS = [180, 300, 480, 600]; // seconds
// Reddit posts and WhatsApp messages have no length setting (stored as 0).
export const lengthsFor = (k: Kind): number[] => (k === 'long' ? LONG_LENGTHS : k === 'short' ? SHORT_LENGTHS : []);
export const lengthLabel = (s: number) => (s <= 0 ? '' : s >= 180 ? `${Math.round(s / 60)} min` : `${s}s`);

// What counts as "gone viral" when studying a competitor: only Shorts, only
// recent ones, only those past a view count, and only the best few of them.
// If nothing qualifies in `days`, the window widens to each of `widenTo` in
// turn (and the card says so). Set `widenTo: []` to keep it strictly 30 days.
export const VIRAL = { days: 30, minViews: 10_000, top: 10, maxShortS: 180, widenTo: [90, 365] };

export type Lang = 'en' | 'te' | 'hi';
export type Source = {
  id: string;
  kind: 'news' | 'video' | 'wiki' | 'discussion' | 'own';
  title: string;
  url?: string;
  publisher?: string;
  date?: string;
  snippet?: string;
  competitor?: boolean; // a video one of the page's competitors uploaded
};

export type Page = {
  id: string;
  name: string;
  niche: string;
  audience: string | null;
  voice: string | null;
  languages: string[];
  created_at: string;
  // The rest of a brand's profile (organisations release). All optional.
  organisation_id?: string;
  description?: string | null;
  writing_rules?: string | null;
  prohibited_terms?: string[];
  supported_platforms?: string[];
  archived_at?: string | null;
};

// An idea only exists if it has real sources behind it (news, YouTube, competitor uploads);
// they travel with it into the Sources step. search_query finds more reading on it.
export type Topic = { title: string; why_now: string; angle: string; hook_idea: string; search_query?: string; sources?: Source[] };

export type Summary = {
  about?: string;
  // YouTube fills the *_in_window / qualified fields; Instagram (pasted reels) fills videos / shorts.
  stats?: {
    avg_views: number;
    median_views: number;
    best_views: number;
    per_week: number;
    videos?: number;
    shorts?: number;
    window_days?: number;
    min_views?: number;
    shorts_in_window?: number;
    qualified?: number;
  };
  note?: string;
  topics?: { topic: string; evidence: string }[];
  hook_patterns?: { pattern: string; example: string; use_it: string }[];
  script_structure?: string;
  cta_style?: string;
  caption_style?: string;
  recent_trends?: string[];
  what_works?: string[];
  what_to_avoid?: string[];
};

// The combined learnings from every competitor's most viral Shorts.
export type Playbook = {
  summary?: string;
  content_types?: { type: string; why: string; topics?: string[] }[];
  hooks?: { rules?: string[]; patterns?: { name: string; template: string; example: string; seen?: string }[] };
  body?: { structure?: string; rules?: string[] };
  conclusion?: { rules?: string[]; examples?: string[] };
  cta?: { rules?: string[]; examples?: string[] };
  style?: string[];
  avoid?: string[];
  based_on?: { creators: number; videos: number };
};

export type Competitor = {
  id: string;
  page_id: string;
  platform: 'youtube' | 'instagram';
  ext_id: string;
  name: string;
  handle: string | null;
  url: string | null;
  thumb: string | null;
  followers: number | null;
  summary: Summary | null;
  analyzed_at: string | null;
};

export type Video = {
  id: string;
  competitor_id: string;
  url: string | null;
  title: string | null;
  caption: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  duration_s: number | null;
  is_short: boolean;
  transcript: string | null;
  hook: string | null;
  structure: { hook_type?: string; cta?: string; topic?: string; error?: string } | null;
  analyzed_at: string | null;
};

export type Script = {
  id: string;
  page_id: string;
  root_id: string;
  version: number;
  topic: string;
  language: string;
  length_s: number;
  sources: unknown[];
  hook: string;
  body: string;
  conclusion: string;
  cta: string;
  rating: number | null;
  created_at: string;
};

export type Section = 'hook' | 'body' | 'conclusion' | 'cta';
export const SECTIONS: { key: Section; label: string; hint: string }[] = [
  { key: 'hook', label: 'Hook', hint: 'First 3 seconds' },
  { key: 'body', label: 'Body', hint: 'The main content' },
  { key: 'conclusion', label: 'Conclusion', hint: 'The takeaway' },
  { key: 'cta', label: 'CTA', hint: 'What to do next' },
];

export type FeedbackInput = { section: Section | 'overall'; sentiment: 'up' | 'down' | null; note: string };
