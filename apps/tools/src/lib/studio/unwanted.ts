// Finding the parts a careful editor would cut (fillers, fumbles, repeated takes) from a word-by-word
// transcript. Nothing here removes anything: the editor only highlights these for a person to decide.
// Plain logic, no browser, so it can be tested.

import { untrusted } from './safety';
import { WINDOW } from './silence';

export type Word = { w: string; s: number; e: number }; // the word, and when it starts and ends (seconds)
export type Kind = 'filler' | 'fumble' | 'repeat' | 'sound';
export type Flag = { start: number; end: number; kind: Kind; text: string; why: string; ignored?: boolean };

export const KIND_LABEL: Record<Kind, string> = { filler: 'Filler', fumble: 'Fumble', repeat: 'Repeat', sound: 'Sound, no words' };

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'eh', 'hmm', 'hm', 'mm', 'mhm', 'mmm']);
const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');
const say = (ws: Word[]) => ws.map((x) => x.w.trim()).join(' ');

/**
 * What can be found without AI:
 * - filler words ("um", "uh", ...)
 * - a word said twice in a row ("the the")
 * - a cut-off word ("wa-")
 * - sound where no word was heard: Whisper tends to leave "um" and "uh" out of its text, so a stretch
 *   that is loud enough to be speech but has no words is very often one of them (or a breath).
 */
export function localFlags(words: Word[], vol: number[] | null, threshold: number): Flag[] {
  const out: Flag[] = [];
  words.forEach((x, i) => {
    const n = bare(x.w);
    const prev = words[i - 1];
    if (FILLERS.has(n)) out.push({ start: x.s, end: x.e, kind: 'filler', text: x.w.trim(), why: 'Filler word' });
    else if (prev && n && n === bare(prev.w) && x.s - prev.e < 1) out.push({ start: prev.s, end: prev.e, kind: 'fumble', text: `${prev.w.trim()} ${x.w.trim()}`, why: 'Word said twice' });
    else if (/[a-z]-$/i.test(x.w.trim())) out.push({ start: x.s, end: x.e, kind: 'fumble', text: x.w.trim(), why: 'Word cut off' });
  });
  if (vol?.length) {
    const end = vol.length * WINDOW;
    const gaps: [number, number][] = [];
    let at = 0;
    for (const x of words) { gaps.push([at, x.s]); at = Math.max(at, x.e); }
    gaps.push([at, end]);
    // Inside each gap between words, every loud stretch of at least 0.2 s. A stretch touching a word is
    // left out: there it is usually just the word, whose time Whisper set a little short.
    for (const [a, b] of gaps) {
      const from = Math.ceil(a / WINDOW);
      const to = Math.min(vol.length, Math.floor(b / WINDOW));
      for (let i = from; i < to; ) {
        if (vol[i] < threshold + 10) { i++; continue; }
        let j = i;
        while (j < to && vol[j] >= threshold + 10) j++;
        if (j - i >= 0.2 / WINDOW && i > from && j < to) out.push({ start: i * WINDOW, end: j * WINDOW, kind: 'sound', text: '', why: 'Sound but no words: often "um", "uh" or a breath' });
        i = j;
      }
    }
  }
  return out;
}

const RANK: Record<Kind, number> = { repeat: 4, fumble: 3, filler: 2, sound: 1 };

/** Sorted, with overlapping highlights joined into one (named after the most important kind). */
export function mergeFlags(flags: Flag[]): Flag[] {
  const out: Flag[] = [];
  for (const f of [...flags].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && f.start < last.end - 0.01) {
      const top = RANK[f.kind] > RANK[last.kind] ? f : last;
      out[out.length - 1] = { ...top, start: last.start, end: Math.max(last.end, f.end), text: top.text || last.text || f.text };
    } else out.push({ ...f });
  }
  return out;
}

/**
 * Moves each edge to the quietest moment nearby, so a cut lands between sounds rather than inside a
 * word. Whisper's word times can be a little early or late.
 */
export function snapFlags(flags: Flag[], vol: number[] | null): Flag[] {
  if (!vol?.length) return flags;
  const quietest = (from: number, to: number, keep: number) => {
    let best = keep;
    let low = Infinity;
    for (let i = Math.max(0, Math.floor(from / WINDOW)); i <= Math.min(vol.length - 1, Math.floor(to / WINDOW)); i++) {
      if (vol[i] < low) { low = vol[i]; best = i * WINDOW; }
    }
    return best;
  };
  return flags.map((f) => {
    const start = quietest(f.start - 0.12, f.start + 0.06, f.start);
    const end = quietest(f.end - 0.06, f.end + 0.12, f.end) + WINDOW;
    return end - start > 0.05 ? { ...f, start, end } : f;
  });
}

// ---- Gemini: repeats, fumbles and fillers that need understanding ----

export const MAX_REVIEW_WORDS = 20000;

/** The transcript as numbered words, so the answer can point at exact words. */
export function reviewPrompt(words: string[]): string {
  const numbered = words.map((w, i) => `${i}:${w.replace(/\s+/g, ' ').trim().slice(0, 40)}`).join(' ');
  return `You help edit a talking-head video. Below is a word-for-word transcript of one speaker. Each word has a number ("12:word").

Find the parts a careful video editor would cut:
- "repeat": a sentence or phrase said again because the speaker retook it. Mark the earlier, weaker take; keep the last complete take.
- "fumble": a false start, an abandoned or self-corrected phrase, a stumble, or a note meant for the editor ("let me say that again", "cut that").
- "filler": filler words or phrases that add nothing in this spot ("like", "you know", "basically", "actually", "I mean", "kind of", "sort of", a meaningless "so" or "right"), and "um", "uh".

Rules:
- Be careful: when a word carries meaning, leave it. When unsure, leave it.
- Point at whole words. "from" and "to" are word numbers, both included.
- Keep "reason" short and plain (under 12 words), for example "Same line said again at word 40".

Answer as JSON only: {"items":[{"from":12,"to":15,"kind":"repeat","reason":"..."}]}

${untrusted('TRANSCRIPT', numbered)}`;
}

export type ReviewItem = { from: number; to: number; kind: Exclude<Kind, 'sound'>; reason: string };

/** Keeps only well-formed answers about words that exist. */
export function parseReview(raw: unknown, count: number): ReviewItem[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 1000)
    .filter((x: any) => x && Number.isInteger(x.from) && Number.isInteger(x.to) && x.from >= 0 && x.to < count && x.from <= x.to && x.to - x.from < 120 && ['filler', 'fumble', 'repeat'].includes(x.kind))
    .map((x: any) => ({ from: x.from, to: x.to, kind: x.kind, reason: String(x.reason ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 140) }));
}

/** Gemini's answers as highlights on the timeline. */
export const reviewFlags = (items: ReviewItem[], words: Word[]): Flag[] =>
  items.map((x) => ({ start: words[x.from].s, end: words[x.to].e, kind: x.kind, text: say(words.slice(x.from, x.to + 1)), why: x.reason || KIND_LABEL[x.kind] }));
