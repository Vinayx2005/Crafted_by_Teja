// Silence detection: pure maths, no browser needed (so it can be tested).
// Volume is shown as 0 to 100: 100 is the loudest moment of the clip, 0 is 60 dB below it.

export type Span = { start: number; end: number };

export const WINDOW = 0.02; // seconds per volume reading

/** One 0-100 volume reading per 20 ms of audio. */
export function levels(samples: Float32Array, rate: number): number[] {
  const size = Math.max(1, Math.round(rate * WINDOW));
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    let sum = 0;
    const end = Math.min(i + size, samples.length);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const peak = Math.max(...rms, 1e-9);
  return rms.map((r) => Math.max(0, Math.min(100, 100 + (20 * Math.log10(Math.max(r, 1e-9) / peak)) * (100 / 60))));
}

/**
 * Quiet stretches: volume below `threshold` (0-100) for at least `minSilence` seconds.
 * `buffer` seconds are kept at each end of a stretch, so words are not clipped.
 */
export function findSilences(vol: number[], threshold: number, minSilence: number, buffer: number): Span[] {
  const out: Span[] = [];
  let from = -1;
  const close = (to: number) => {
    const start = from * WINDOW;
    const end = to * WINDOW;
    if (end - start >= minSilence && end - start - 2 * buffer > 0) out.push({ start: start + buffer, end: end - buffer });
    from = -1;
  };
  vol.forEach((v, i) => {
    if (v < threshold) {
      if (from < 0) from = i;
    } else if (from >= 0) close(i);
  });
  if (from >= 0) close(vol.length);
  return out;
}

/** The parts to keep: everything outside the silences. */
export function keepSpans(silences: Span[], duration: number): Span[] {
  const keep: Span[] = [];
  let at = 0;
  for (const s of silences) {
    if (s.start > at) keep.push({ start: at, end: s.start });
    at = s.end;
  }
  if (duration > at) keep.push({ start: at, end: duration });
  return keep;
}

export const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export type Seg = Span & { hidden: boolean };
export type Override = Span & { hide: boolean };

/**
 * The timeline as separate parts. Cut points come from the silences and from splits the user made.
 * A part is hidden when the user's latest choice for it says so; with no choice, when it is silent.
 */
export function segments(silences: Span[], splits: number[], overrides: Override[], total: number): Seg[] {
  const pts = [0, total, ...silences.flatMap((s) => [s.start, s.end]), ...splits]
    .filter((p) => p >= 0 && p <= total)
    .sort((a, b) => a - b)
    .filter((p, i, all) => i === 0 || p - all[i - 1] > 1e-6);
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [start, end] = [pts[i - 1], pts[i]];
    const mid = (start + end) / 2;
    const choice = [...overrides].reverse().find((o) => mid >= o.start && mid < o.end);
    out.push({ start, end, hidden: choice ? choice.hide : silences.some((s) => mid >= s.start && mid < s.end) });
  }
  return out;
}

/** Hidden parts, with neighbours joined into one. */
export function cutSpans(segs: Seg[]): Span[] {
  const out: Span[] = [];
  for (const s of segs) {
    if (!s.hidden) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - s.start) < 1e-6) last.end = s.end;
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Time in the edited video for a moment in the original. */
export const editedTime = (t: number, cuts: Span[]) => t - cuts.reduce((n, c) => n + Math.max(0, Math.min(t, c.end) - c.start), 0);

/**
 * Where to jump when `t` is inside a removed part, or null. It aims a hair past the end: browsers round
 * the playback time, so landing on the exact end can still read as "inside" and the video would jump
 * again and again, never moving.
 */
export function hopTarget(cuts: Span[], t: number): number | null {
  const c = cuts.find((x) => t >= x.start && t < x.end);
  return c ? c.end + 0.002 : null;
}

export type Project = { v: 1; video: { name: string; size: number }; threshold: number; minSilence: number; buffer: number; splits: number[]; overrides: Override[] };

const num = (x: unknown, min: number, max: number, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback);

/** Reads a saved project file. Returns null when it is not one of ours. */
export function parseProject(text: string): Project | null {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || j.v !== 1 || typeof j.video?.name !== 'string') return null;
  const times = (a: unknown) => (Array.isArray(a) ? a.slice(0, 5000).filter((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0) : []);
  const overrides = (Array.isArray(j.overrides) ? j.overrides.slice(0, 5000) : [])
    .filter((o: any) => o && Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start && typeof o.hide === 'boolean')
    .map((o: any) => ({ start: o.start, end: o.end, hide: o.hide }));
  return {
    v: 1,
    video: { name: j.video.name.slice(0, 300), size: num(j.video.size, 0, Number.MAX_SAFE_INTEGER, 0) },
    threshold: num(j.threshold, 1, 60, 25),
    minSilence: num(j.minSilence, 0.1, 3, 0.5),
    buffer: num(j.buffer, 0, 0.5, 0.1),
    splits: times(j.splits),
    overrides,
  };
}
