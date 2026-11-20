// Chrome records MP4 as a live-style "fragmented" file: many small pieces, no total length and no
// index up front. Players then show it as a live stream and cannot seek. This rewrites it as a normal
// MP4: one index (moov) first, then all the media (mdat). The picture and sound bytes are copied as they
// are, nothing is re-encoded. Only the small index boxes are read into memory, so long videos are fine.

type Box = { type: string; start: number; size: number; hdr: number };
type Sample = { size: number; dur: number; cto: number; sync: boolean };
type Track = { id: number; scale: number; trak: Box; samples: Sample[]; trex: { dur: number; size: number; flags: number } };
type Chunk = { track: Track; count: number; at: number; bytes: number };

const td = new TextDecoder();
const te = new TextEncoder();

const view = async (b: Blob, from: number, to: number) => new DataView(await b.slice(from, to).arrayBuffer());

function readHeader(d: DataView, p: number, end: number): Box | null {
  if (p + 8 > end) return null;
  let size = d.getUint32(p);
  let hdr = 8;
  const type = td.decode(new Uint8Array(d.buffer, d.byteOffset + p + 4, 4));
  if (size === 1) {
    if (p + 16 > end) return null;
    size = Number(d.getBigUint64(p + 8));
    hdr = 16;
  } else if (size === 0) size = end - p;
  return size < hdr || p + size > end ? null : { type, start: p, size, hdr };
}

/** Boxes directly inside `parent` (positions are within the DataView `d`). */
function kids(d: DataView, parent: Box): Box[] {
  const out: Box[] = [];
  for (let p = parent.start + parent.hdr, end = parent.start + parent.size; ; ) {
    const b = readHeader(d, p, end);
    if (!b) return out;
    out.push(b);
    p += b.size;
  }
}
const kid = (d: DataView, parent: Box, type: string) => kids(d, parent).find((k) => k.type === type);
const body = (b: Box) => b.start + b.hdr; // where a box's content starts
const version = (d: DataView, b: Box) => d.getUint8(body(b));
const copy = (d: DataView, b: Box) => new Uint8Array(d.buffer.slice(d.byteOffset + b.start, d.byteOffset + b.start + b.size));

// ---- writing ----
function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(te.encode(type), 4);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const full = (type: string, v: number, flags: number, ...parts: Uint8Array[]) => box(type, new Uint8Array([v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
function u32(...n: number[]) {
  const a = new Uint8Array(n.length * 4);
  const d = new DataView(a.buffer);
  n.forEach((x, i) => d.setUint32(i * 4, x >>> 0));
  return a;
}
function i32(...n: number[]) {
  const a = new Uint8Array(n.length * 4);
  const d = new DataView(a.buffer);
  n.forEach((x, i) => d.setInt32(i * 4, x));
  return a;
}
function u64(...n: number[]) {
  const a = new Uint8Array(n.length * 8);
  const d = new DataView(a.buffer);
  n.forEach((x, i) => d.setBigUint64(i * 8, BigInt(x)));
  return a;
}
/** Run-length pairs: [count, value, count, value, ...]. */
function runs(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length && out[out.length - 1] === v) out[out.length - 2]++;
    else out.push(1, v);
  }
  return out;
}
/** Writes a duration into a copied full box: 4 bytes for version 0, 8 for version 1. */
function setDuration(b: Uint8Array, v0At: number, v1At: number, value: number) {
  const d = new DataView(b.buffer);
  const hdr = d.getUint32(0) === 1 ? 16 : 8;
  if (b[hdr] === 1) d.setBigUint64(hdr + v1At, BigInt(Math.round(value)));
  else d.setUint32(hdr + v0At, Math.min(0xffffffff, Math.round(value)));
}

/** Returns a normal (seekable) MP4. Files that are not fragmented are returned unchanged. */
export async function flattenMp4(src: Blob): Promise<Blob> {
  // Top level: ftyp, moov, then moof + mdat pairs.
  const top: Box[] = [];
  for (let p = 0; p + 8 <= src.size; ) {
    const d = await view(src, p, Math.min(p + 16, src.size));
    const b = readHeader(d, 0, src.size - p);
    if (!b) break;
    top.push({ ...b, start: p });
    p += b.size;
  }
  const moovAt = top.find((b) => b.type === 'moov');
  if (!moovAt || !top.some((b) => b.type === 'moof')) return src;

  const mv = await view(src, moovAt.start, moovAt.start + moovAt.size);
  const moov: Box = { ...moovAt, start: 0 };
  const mvhd = kid(mv, moov, 'mvhd')!;
  const movieScale = mv.getUint32(body(mvhd) + (version(mv, mvhd) ? 20 : 12));
  const trexes = kids(mv, kid(mv, moov, 'mvex') ?? moov).filter((b) => b.type === 'trex');

  const tracks = new Map<number, Track>();
  for (const trak of kids(mv, moov).filter((b) => b.type === 'trak')) {
    const tkhd = kid(mv, trak, 'tkhd')!;
    const id = mv.getUint32(body(tkhd) + (version(mv, tkhd) ? 20 : 12));
    const mdhd = kid(mv, kid(mv, trak, 'mdia')!, 'mdhd')!;
    const scale = mv.getUint32(body(mdhd) + (version(mv, mdhd) ? 20 : 12));
    const t = trexes.find((x) => mv.getUint32(body(x) + 4) === id);
    const trex = t ? { dur: mv.getUint32(body(t) + 12), size: mv.getUint32(body(t) + 16), flags: mv.getUint32(body(t) + 20) } : { dur: 0, size: 0, flags: 0 };
    tracks.set(id, { id, scale, trak, samples: [], trex });
  }

  // Every fragment: which samples it holds and where their bytes are.
  const chunks: Chunk[] = [];
  for (const m of top.filter((b) => b.type === 'moof')) {
    const mf = await view(src, m.start, m.start + m.size);
    for (const traf of kids(mf, { ...m, start: 0 }).filter((b) => b.type === 'traf')) {
      const tfhd = kid(mf, traf, 'tfhd')!;
      const fl = mf.getUint32(body(tfhd)) & 0xffffff;
      let q = body(tfhd) + 4;
      const tr = tracks.get(mf.getUint32(q));
      q += 4;
      if (!tr) continue;
      let base = m.start;
      if (fl & 0x1) { base = Number(mf.getBigUint64(q)); q += 8; }
      if (fl & 0x2) q += 4;
      const dDur = fl & 0x8 ? mf.getUint32((q += 4) - 4) : tr.trex.dur;
      const dSize = fl & 0x10 ? mf.getUint32((q += 4) - 4) : tr.trex.size;
      const dFlags = fl & 0x20 ? mf.getUint32((q += 4) - 4) : tr.trex.flags;
      let ptr = base;
      for (const trun of kids(mf, traf).filter((b) => b.type === 'trun')) {
        const v = version(mf, trun);
        const f = mf.getUint32(body(trun)) & 0xffffff;
        let r = body(trun) + 4;
        const n = mf.getUint32(r);
        r += 4;
        if (f & 0x1) { ptr = base + mf.getInt32(r); r += 4; }
        let firstFlags: number | null = null;
        if (f & 0x4) { firstFlags = mf.getUint32(r); r += 4; }
        const chunk: Chunk = { track: tr, count: n, at: ptr, bytes: 0 };
        for (let i = 0; i < n; i++) {
          const dur = f & 0x100 ? mf.getUint32((r += 4) - 4) : dDur;
          const size = f & 0x200 ? mf.getUint32((r += 4) - 4) : dSize;
          let flags = f & 0x400 ? mf.getUint32((r += 4) - 4) : dFlags;
          if (i === 0 && firstFlags !== null) flags = firstFlags;
          const cto = f & 0x800 ? (v ? mf.getInt32((r += 4) - 4) : mf.getUint32((r += 4) - 4)) : 0;
          tr.samples.push({ size, dur, cto, sync: !(flags & 0x10000) });
          chunk.bytes += size;
        }
        ptr += chunk.bytes;
        if (n) chunks.push(chunk);
      }
    }
  }

  // The new index. Chunk positions depend on the index's own size, which does not depend on them
  // (fixed-width numbers), so it is built once with the final positions.
  const mediaBytes = chunks.reduce((n, c) => n + c.bytes, 0);
  const wide = moovAt.size * 2 + mediaBytes + 1e6 > 0xffffffff; // positions over 4 GB need 8-byte numbers
  const mdatHdr = mediaBytes + 8 > 0xffffffff ? 16 : 8;
  const ftyp = box('ftyp', te.encode('isom'), u32(512), te.encode('isomiso2avc1mp41'));

  const build = (dataStart: number) => {
    const offsets = new Map<Track, number[]>();
    let at = dataStart;
    for (const c of chunks) {
      offsets.set(c.track, [...(offsets.get(c.track) ?? []), at]);
      at += c.bytes;
    }
    let movieDur = 0;
    const traks: Uint8Array[] = [];
    for (const tr of tracks.values()) {
      const s = tr.samples;
      const mediaDur = s.reduce((n, x) => n + x.dur, 0);
      const dur = tr.scale ? (mediaDur / tr.scale) * movieScale : 0;
      movieDur = Math.max(movieDur, dur);
      const mine = chunks.filter((c) => c.track === tr);
      const stsc: number[] = [];
      mine.forEach((c, i) => { if (!stsc.length || stsc[stsc.length - 2] !== c.count) stsc.push(i + 1, c.count, 1); });
      const stts = runs(s.map((x) => x.dur));
      const tables = [
        full('stts', 0, 0, u32(stts.length / 2, ...stts)),
        ...(s.some((x) => x.cto) ? [s.some((x) => x.cto < 0) ? full('ctts', 1, 0, u32(runs(s.map((x) => x.cto)).length / 2), i32(...runs(s.map((x) => x.cto)))) : full('ctts', 0, 0, u32(runs(s.map((x) => x.cto)).length / 2, ...runs(s.map((x) => x.cto))))] : []),
        ...(s.some((x) => !x.sync) ? [full('stss', 0, 0, u32(s.filter((x) => x.sync).length, ...s.flatMap((x, i) => (x.sync ? [i + 1] : []))))] : []),
        full('stsc', 0, 0, u32(stsc.length / 3, ...stsc)),
        full('stsz', 0, 0, u32(0, s.length, ...s.map((x) => x.size))),
        wide ? full('co64', 0, 0, u32(mine.length), u64(...(offsets.get(tr) ?? []))) : full('stco', 0, 0, u32(mine.length, ...(offsets.get(tr) ?? []))),
      ];
      const rebuild = (b: Box): Uint8Array => {
        switch (b.type) {
          case 'tkhd': { const c = copy(mv, b); setDuration(c, 20, 28, dur); return c; }
          case 'mdhd': { const c = copy(mv, b); setDuration(c, 16, 24, mediaDur); return c; }
          case 'mdia': case 'minf': return box(b.type, ...kids(mv, b).map(rebuild));
          case 'stbl': return box('stbl', copy(mv, kid(mv, b, 'stsd')!), ...tables);
          default: return copy(mv, b);
        }
      };
      // The edit list is dropped: in a fragmented file it often says "length 0", which would hide the track.
      traks.push(box('trak', ...kids(mv, tr.trak).filter((k) => k.type !== 'edts').map(rebuild)));
    }
    const head = copy(mv, mvhd);
    setDuration(head, 16, 24, movieDur);
    const rest = kids(mv, moov).filter((k) => !['mvhd', 'trak', 'mvex'].includes(k.type)).map((k) => copy(mv, k));
    return box('moov', head, ...traks, ...rest);
  };

  const size = build(0).length; // same size whatever the positions are
  const index = build(ftyp.length + size + mdatHdr);
  const hdr = new Uint8Array(mdatHdr);
  const hd = new DataView(hdr.buffer);
  hdr.set(te.encode('mdat'), 4);
  if (mdatHdr === 16) { hd.setUint32(0, 1); hd.setBigUint64(8, BigInt(mediaBytes + 16)); }
  else hd.setUint32(0, mediaBytes + 8);
  return new Blob([ftyp, index, hdr, ...chunks.map((c) => src.slice(c.at, c.at + c.bytes))], { type: 'video/mp4' });
}
