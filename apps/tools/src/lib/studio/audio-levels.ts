// Reads the sound of a long video piece by piece, so a 1-hour, multi-GB file works: only the audio is
// taken out of the MP4 or MOV file, it is decoded a little at a time by the browser's AudioDecoder, and
// each piece is measured and thrown away. The whole file is never loaded into memory.

import { body, kid, kids, readHeader, topBoxes, view, type Box } from './mp4-flatten';
import { toLevels, WINDOW, type Span } from './silence';

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export type AudioTrack = {
  codec: string;
  sampleRate: number;
  channels: number;
  config?: Uint8Array; // AAC "AudioSpecificConfig"
  sizes: number[];
  times: Float64Array; // seconds, per sample
  chunks: { at: number; size: number; first: number; count: number }[];
};

/** The AAC settings inside an esds box: object type, then the decoder config bytes. */
function esds(d: DataView, start: number, end: number): { oti: number; cfg?: Uint8Array } {
  let p = start + 4; // version and flags
  const len = () => {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = d.getUint8(p++);
      n = (n << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return n;
  };
  let oti = 0;
  while (p < end) {
    const tag = d.getUint8(p++);
    const n = len();
    if (tag === 0x03) { // ES descriptor: skip its own fields, then read the descriptors inside
      p += 2;
      const f = d.getUint8(p++);
      if (f & 0x80) p += 2;
      if (f & 0x40) p += 1 + d.getUint8(p);
      if (f & 0x20) p += 2;
    } else if (tag === 0x04) { // decoder config: object type, then 12 bytes of rates and buffer size
      oti = d.getUint8(p);
      p += 13;
    } else if (tag === 0x05) {
      return { oti, cfg: new Uint8Array(d.buffer.slice(d.byteOffset + p, d.byteOffset + p + n)) };
    } else p += n;
  }
  return { oti };
}

/** AAC config bits: object type, sample rate, channels. */
export function parseAsc(c: Uint8Array) {
  let bit = 0;
  const read = (k: number) => {
    let v = 0;
    for (let i = 0; i < k; i++, bit++) v = (v << 1) | ((c[bit >> 3] >> (7 - (bit & 7))) & 1);
    return v;
  };
  let aot = read(5);
  if (aot === 31) aot = 32 + read(6);
  const fi = read(4);
  const rate = fi === 15 ? read(24) : RATES[fi];
  return { aot, rate, channels: read(4) };
}

/** Finds the sound track of a normal (not fragmented) MP4 or MOV and where each sound sample is. */
export async function audioTrack(src: Blob): Promise<AudioTrack> {
  const moovAt = (await topBoxes(src)).find((b) => b.type === 'moov');
  if (!moovAt) throw new Error('Not an MP4 or MOV file.');
  const mv = await view(src, moovAt.start, moovAt.start + moovAt.size);
  const moov: Box = { ...moovAt, start: 0 };
  for (const trak of kids(mv, moov).filter((b) => b.type === 'trak')) {
    const mdia = kid(mv, trak, 'mdia');
    const hdlr = mdia && kid(mv, mdia, 'hdlr');
    if (!mdia || !hdlr || new TextDecoder().decode(new Uint8Array(mv.buffer, body(hdlr) + 8, 4)) !== 'soun') continue;
    const mdhd = kid(mv, mdia, 'mdhd')!;
    const scale = mv.getUint32(body(mdhd) + (mv.getUint8(body(mdhd)) ? 20 : 12));
    const stbl = kid(mv, kid(mv, mdia, 'minf')!, 'stbl')!;

    // Sample description: the codec and its settings.
    const stsd = kid(mv, stbl, 'stsd')!;
    const entry = readHeader(mv, body(stsd) + 8, stsd.start + stsd.size);
    if (!entry || entry.type !== 'mp4a') throw new Error(`This video's sound (${entry?.type ?? 'unknown'}) cannot be read in pieces yet.`);
    const entryChannels = mv.getUint16(body(entry) + 16);
    const entryRate = mv.getUint32(body(entry) + 24) >>> 16;
    // The esds box sits inside the entry, or inside a QuickTime "wave" box within it: look for it by name.
    let es: { oti: number; cfg?: Uint8Array } = { oti: 0 };
    for (let p = body(entry); p + 8 < entry.start + entry.size; p++) {
      if (mv.getUint32(p + 4) === 0x65736473 /* 'esds' */) { es = esds(mv, p + 8, p + mv.getUint32(p)); break; }
    }
    let codec: string, sampleRate = entryRate, channels = entryChannels;
    if (es.cfg && [0x40, 0x66, 0x67, 0x68].includes(es.oti)) {
      const a = parseAsc(es.cfg);
      codec = `mp4a.40.${a.aot}`;
      sampleRate = a.rate || entryRate;
      channels = a.channels || entryChannels;
    } else if (es.oti === 0x69 || es.oti === 0x6b) codec = 'mp3';
    else throw new Error('This video uses a sound format that cannot be read in pieces yet.');

    // Where every sample is: sizes (stsz), how many per chunk (stsc), where chunks start (stco/co64).
    const stsz = kid(mv, stbl, 'stsz')!;
    const fixed = mv.getUint32(body(stsz) + 4);
    const count = mv.getUint32(body(stsz) + 8);
    const sizes = Array.from({ length: count }, (_, i) => (fixed ? fixed : mv.getUint32(body(stsz) + 12 + i * 4)));
    const stsc = kid(mv, stbl, 'stsc')!;
    const runs = Array.from({ length: mv.getUint32(body(stsc) + 4) }, (_, i) => ({ chunk: mv.getUint32(body(stsc) + 8 + i * 12), per: mv.getUint32(body(stsc) + 12 + i * 12) }));
    const co = kid(mv, stbl, 'stco') ?? kid(mv, stbl, 'co64');
    if (!co || !runs.length) throw new Error('This video has no sound index.');
    const wide = co.type === 'co64';
    const offsets = Array.from({ length: mv.getUint32(body(co) + 4) }, (_, i) => (wide ? Number(mv.getBigUint64(body(co) + 8 + i * 8)) : mv.getUint32(body(co) + 8 + i * 4)));
    const chunks: AudioTrack['chunks'] = [];
    let s = 0;
    offsets.forEach((at, i) => {
      let per = runs[0].per;
      for (const r of runs) if (r.chunk <= i + 1) per = r.per;
      const n = Math.min(per, count - s);
      if (n <= 0) return;
      let size = 0;
      for (let k = s; k < s + n; k++) size += sizes[k];
      chunks.push({ at, size, first: s, count: n });
      s += n;
    });

    // When each sample plays (stts), in seconds.
    const stts = kid(mv, stbl, 'stts')!;
    const times = new Float64Array(count);
    let t = 0;
    for (let e = 0, i = 0, n = mv.getUint32(body(stts) + 4); e < n; e++) {
      const reps = mv.getUint32(body(stts) + 8 + e * 8);
      const delta = mv.getUint32(body(stts) + 12 + e * 8);
      for (let k = 0; k < reps && i < count; k++, i++) { times[i] = t / scale; t += delta; }
    }
    return { codec, sampleRate, channels, config: codec === 'mp3' ? undefined : es.cfg, sizes, times, chunks };
  }
  throw new Error('This video has no sound.');
}

/**
 * Decodes the sound of the chosen part piece by piece and hands each piece over as mono samples.
 * Throws when this file or browser cannot do it (the caller then falls back to reading the file whole).
 */
export async function eachSound(src: Blob, range: Span | null | undefined, onMono: (mono: Float32Array, rate: number) => void, onProgress?: (done: number) => void) {
  if (typeof AudioDecoder === 'undefined') throw new Error('This browser cannot decode sound in pieces. Use Chrome or Edge.');
  const t = await audioTrack(src);
  const config: AudioDecoderConfig = { codec: t.codec, sampleRate: t.sampleRate, numberOfChannels: t.channels, ...(t.config ? { description: t.config } : {}) };
  if (!(await AudioDecoder.isConfigSupported(config)).supported) throw new Error('This browser cannot decode the sound of this video.');

  let failed: unknown = null;
  let plane = new Float32Array(0);
  const dec = new AudioDecoder({
    output: (a) => {
      const n = a.numberOfFrames;
      const ch = a.numberOfChannels;
      if (plane.length < n) plane = new Float32Array(n);
      const mono = new Float32Array(n);
      for (let c = 0; c < ch; c++) {
        a.copyTo(plane.subarray(0, n), { planeIndex: c, format: 'f32-planar' });
        for (let i = 0; i < n; i++) mono[i] += plane[i] / ch;
      }
      const rate = a.sampleRate;
      a.close();
      onMono(mono, rate);
    },
    error: (e) => { failed = e; },
  });
  dec.configure(config);

  // Only the chosen part is read: samples before `from` or from `to` on are skipped.
  const from = range?.start ?? 0;
  const to = range?.end ?? Infinity;
  const inside = (i: number) => t.times[i] >= from && t.times[i] < to;
  const wanted = t.chunks.filter((c) => t.times[c.first + c.count - 1] >= from && t.times[c.first] < to);
  const total = wanted.reduce((n, c) => n + c.count, 0);
  let done = 0;
  for (const c of wanted) {
    if (failed) break;
    const bytes = new Uint8Array(await src.slice(c.at, c.at + c.size).arrayBuffer());
    for (let i = c.first, p = 0; i < c.first + c.count; p += t.sizes[i], i++) {
      if (inside(i)) dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(t.times[i] * 1e6), data: bytes.subarray(p, p + t.sizes[i]) }));
    }
    done += c.count;
    onProgress?.(done / total);
    // Keep only a little sound waiting, so memory stays small however long the video is.
    while (dec.decodeQueueSize > 64 && !failed) await new Promise((r) => dec.addEventListener('dequeue', r, { once: true }));
  }
  if (!failed) await dec.flush().catch((e) => { failed = e; });
  dec.close();
  if (failed) throw failed instanceof Error ? failed : new Error('The sound could not be decoded.');
}

/** 0-100 volume readings, one per 20 ms, read piece by piece. Throws when this file or browser cannot do it. */
export async function streamLevels(src: Blob, onProgress?: (done: number) => void, range?: Span | null): Promise<number[]> {
  const rms: number[] = [];
  let win = 0, acc = 0, cnt = 0;
  await eachSound(src, range, (mono, rate) => {
    win ||= Math.max(1, Math.round(rate * WINDOW));
    for (let i = 0; i < mono.length; i++) {
      acc += mono[i] * mono[i];
      if (++cnt === win) { rms.push(Math.sqrt(acc / cnt)); acc = 0; cnt = 0; }
    }
  }, onProgress);
  if (cnt) rms.push(Math.sqrt(acc / cnt));
  if (!rms.length) throw new Error('No sound was found in this video.');
  // Exactly one reading per 20 ms of the part, so the timeline matches the video.
  if (range) rms.length = Math.min(rms.length, Math.round((range.end - range.start) / WINDOW));
  return toLevels(rms);
}

/**
 * Turns sound at any rate into sound at `out` samples a second, piece by piece. Each output sample is the
 * average of the input samples it covers, which also keeps high pitches from turning into noise.
 */
export class Resampler {
  private acc = 0;
  private n = 0;
  private pos = 0;
  private buf: Float32Array;
  length = 0;
  constructor(private out: number, expected = 0) {
    this.buf = new Float32Array(Math.max(1024, expected));
  }
  push(mono: Float32Array, rate: number) {
    const step = rate / this.out; // input samples per output sample
    for (let i = 0; i < mono.length; i++) {
      this.acc += mono[i];
      this.n++;
      if (++this.pos >= step) {
        if (this.length === this.buf.length) { const b = new Float32Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
        this.buf[this.length++] = this.acc / this.n;
        this.acc = 0;
        this.n = 0;
        this.pos -= step;
      }
    }
  }
  result() {
    return this.buf.subarray(0, this.length);
  }
}

/** The chosen part's sound as 16,000 mono samples a second, which is what Whisper listens to. */
export async function partAudio16k(src: Blob, range: Span | null | undefined, onProgress?: (done: number) => void): Promise<Float32Array> {
  // ponytail: holds the whole part in memory (about 230 MB for an hour); feed Whisper while decoding if parts get longer.
  const r = new Resampler(16000, range ? Math.ceil((range.end - range.start) * 16000) + 16000 : 0);
  await eachSound(src, range, (mono, rate) => r.push(mono, rate), onProgress);
  return r.result();
}
