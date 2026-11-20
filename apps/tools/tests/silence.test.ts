import { describe, expect, it } from 'vitest';
import { findSilences, keepSpans, levels } from '@/lib/studio/silence';

// 1 s of tone, 1 s of silence, 1 s of tone, at 1 kHz.
const rate = 1000;
const clip = Float32Array.from({ length: 3000 }, (_, i) => (i >= 1000 && i < 2000 ? 0 : Math.sin(i)));

describe('silence detection', () => {
  const vol = levels(clip, rate);
  it('finds the quiet second', () => {
    const [s, ...rest] = findSilences(vol, 25, 0.5, 0);
    expect(rest).toHaveLength(0);
    expect(s.start).toBeCloseTo(1, 1);
    expect(s.end).toBeCloseTo(2, 1);
  });
  it('ignores pauses shorter than the minimum', () => {
    expect(findSilences(vol, 25, 1.5, 0)).toHaveLength(0);
  });
  it('keeps a buffer at each end', () => {
    const [s] = findSilences(vol, 25, 0.5, 0.1);
    expect(s.start).toBeCloseTo(1.1, 1);
    expect(s.end).toBeCloseTo(1.9, 1);
  });
  it('lists what is left', () => {
    const keep = keepSpans(findSilences(vol, 25, 0.5, 0), 3);
    expect(keep).toHaveLength(2);
    expect(keep[1].end).toBe(3);
  });
});

import { cutSpans, editedTime, segments } from '@/lib/studio/silence';

describe('editing the cuts', () => {
  const sil = [{ start: 1, end: 2 }];
  it('hides silences by default and joins neighbours', () => {
    const segs = segments(sil, [], [], 3);
    expect(segs.map((s) => s.hidden)).toEqual([false, true, false]);
    expect(cutSpans(segments(sil, [1.5], [], 3))).toEqual([{ start: 1, end: 2 }]);
  });
  it('lets the user keep a silence, or remove speech', () => {
    expect(cutSpans(segments(sil, [], [{ start: 1, end: 2, hide: false }], 3))).toEqual([]);
    expect(cutSpans(segments(sil, [2.5], [{ start: 2, end: 2.5, hide: true }], 3))).toEqual([{ start: 1, end: 2.5 }]);
  });
  it('maps original time to edited time', () => {
    expect(editedTime(2.5, [{ start: 1, end: 2 }])).toBe(1.5);
    expect(editedTime(1.5, [{ start: 1, end: 2 }])).toBe(1);
  });
});

import { hopTarget, parseProject } from '@/lib/studio/silence';

describe('jumping over removed parts', () => {
  it('lands past the end, even when the browser rounds the time down', () => {
    const cuts = [{ start: 3, end: 6.500000000000001 }];
    const to = hopTarget(cuts, 4)!;
    expect(to).toBeGreaterThan(6.500000000000001);
    expect(hopTarget(cuts, 6.5)).not.toBeNull(); // rounded down: still inside, so it hops...
    expect(hopTarget(cuts, to)).toBeNull(); // ...and once there it never hops again
    expect(hopTarget(cuts, 2)).toBeNull();
  });
});

describe('project files', () => {
  const good = { v: 1, video: { name: 'a.mp4', size: 10 }, threshold: 30, minSilence: 0.7, buffer: 0.2, splits: [1.5], overrides: [{ start: 1, end: 2, hide: false }] };
  it('reads what it saved', () => {
    expect(parseProject(JSON.stringify(good))).toEqual(good);
  });
  it('rejects other files and cleans bad values', () => {
    expect(parseProject('not json')).toBeNull();
    expect(parseProject('{"v":2}')).toBeNull();
    const p = parseProject(JSON.stringify({ ...good, threshold: 9999, splits: [1, 'x', -3], overrides: [{ start: 2, end: 1, hide: true }] }))!;
    expect(p.threshold).toBe(60);
    expect(p.splits).toEqual([1]);
    expect(p.overrides).toEqual([]);
  });
});
