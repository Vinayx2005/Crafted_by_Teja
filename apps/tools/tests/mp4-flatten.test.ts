import { describe, expect, it } from 'vitest';
import { flattenMp4 } from '@/lib/studio/mp4-flatten';

const te = new TextEncoder();
const td = new TextDecoder();
const u32 = (...n: number[]) => {
  const a = new Uint8Array(n.length * 4);
  const d = new DataView(a.buffer);
  n.forEach((x, i) => d.setUint32(i * 4, x));
  return a;
};
const box = (type: string, ...parts: Uint8Array[]) => {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const o = new Uint8Array(len);
  new DataView(o.buffer).setUint32(0, len);
  o.set(te.encode(type), 4);
  let at = 8;
  for (const p of parts) { o.set(p, at); at += p.length; }
  return o;
};
const full = (type: string, v: number, flags: number, ...parts: Uint8Array[]) => box(type, new Uint8Array([v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);

// Laid out the way Chrome records: index without samples, then moof + mdat pieces.
// One video track, 1000 ticks a second, 40 ms per frame; the first frame of each piece is a key frame.
function fragmented() {
  const moov = box('moov',
    full('mvhd', 0, 0, u32(0, 0, 1000, 0), new Uint8Array(80)),
    box('trak',
      full('tkhd', 0, 3, u32(0, 0, 1, 0, 0), new Uint8Array(60)),
      box('mdia',
        full('mdhd', 0, 0, u32(0, 0, 1000, 0, 0)),
        full('hdlr', 0, 0, u32(0), te.encode('vide'), new Uint8Array(13)),
        box('minf', box('stbl', full('stsd', 0, 0, u32(0)), full('stts', 0, 0, u32(0)), full('stsz', 0, 0, u32(0, 0)))))),
    box('mvex', full('trex', 0, 0, u32(1, 1, 40, 0, 0))));
  const piece = (samples: number[][]) => {
    const make = (offset: number) =>
      box('moof', full('mfhd', 0, 0, u32(1)),
        box('traf', full('tfhd', 0, 0x20000, u32(1)), full('tfdt', 0, 0, u32(0)),
          full('trun', 0, 0x1 | 0x200 | 0x400, u32(samples.length, offset), ...samples.map((s, i) => u32(s.length, i === 0 ? 0 : 0x10000)))));
    return [make(make(0).length + 8), box('mdat', Uint8Array.from(samples.flat()))];
  };
  return new Blob([box('ftyp', te.encode('isom'), u32(0)), moov, ...piece([[1, 2, 3], [4, 5]]), ...piece([[6], [7, 8, 9, 10]])]);
}

async function read(b: Blob) {
  const d = new DataView(await b.arrayBuffer());
  const kids = (from: number, to: number) => {
    const out: { type: string; start: number; size: number }[] = [];
    for (let p = from; p + 8 <= to && d.getUint32(p) >= 8; p += d.getUint32(p)) out.push({ type: td.decode(new Uint8Array(d.buffer, p + 4, 4)), start: p, size: d.getUint32(p) });
    return out;
  };
  const at = (path: string[]) => {
    let from = 0;
    let to = d.byteLength;
    for (const t of path) {
      const hit = kids(from, to).find((k) => k.type === t)!;
      [from, to] = [hit.start + 8, hit.start + hit.size];
    }
    return from; // where the box's content starts
  };
  const nums = (start: number, count: number) => Array.from({ length: count }, (_, i) => d.getUint32(start + i * 4));
  return { d, top: kids(0, d.byteLength).map((k) => k.type), at, nums };
}

describe('MP4 from the recorder', () => {
  it('becomes a normal file: index first, real length, every frame where the index says', async () => {
    const out = await flattenMp4(fragmented());
    const { d, top, at, nums } = await read(out);
    expect(top).toEqual(['ftyp', 'moov', 'mdat']);

    const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
    expect(d.getUint32(at(['moov', 'mvhd']) + 16)).toBe(160); // 4 frames x 40 ms
    expect(nums(at([...stbl, 'stts']) + 4, 3)).toEqual([1, 4, 40]); // one run: 4 frames of 40
    expect(nums(at([...stbl, 'stsz']) + 4, 6)).toEqual([0, 4, 3, 2, 1, 4]);
    expect(nums(at([...stbl, 'stss']) + 4, 3)).toEqual([2, 1, 3]); // key frames: 1st and 3rd
    const [count, first, second] = nums(at([...stbl, 'stco']) + 4, 3);
    expect(count).toBe(2);
    expect([...new Uint8Array(d.buffer, first, 5)]).toEqual([1, 2, 3, 4, 5]);
    expect([...new Uint8Array(d.buffer, second, 5)]).toEqual([6, 7, 8, 9, 10]);
  });

  it('leaves a file that is already normal untouched', async () => {
    const plain = new Blob([box('ftyp', te.encode('isom'), u32(0)), box('moov'), box('mdat', new Uint8Array([1]))]);
    expect(await flattenMp4(plain)).toBe(plain);
  });
});
