// The chosen part's speech as words with times, using Whisper in a background worker (speech.worker.ts).
// Everything stays in the browser.

import { partAudio16k } from './audio-levels';
import type { Span } from './silence';
import type { Word } from './unwanted';

const RATE = 16000;
const WIN = 30; // Whisper listens to 30 s at a time
const STEP = 25; // so pieces overlap by 5 s, and a word at an edge is heard whole in one of them

/** Where each 30 s piece starts, for a part `total` seconds long. */
export function pieces(total: number): number[] {
  const out: number[] = [];
  for (let a = 0; ; a += STEP) {
    out.push(a);
    if (a + WIN >= total) return out;
  }
}

/** Which words of piece `k` to keep: the overlaps are split down the middle, so each word is kept once. */
export function keepRange(k: number, count: number): [number, number] {
  const half = (WIN - STEP) / 2;
  return [k === 0 ? -Infinity : k * STEP + half, k === count - 1 ? Infinity : k * STEP + STEP + half];
}

async function partAudio(file: Blob, range: Span | null | undefined, onPct: (pct: number) => void): Promise<Float32Array> {
  try {
    return await partAudio16k(file, range, (x) => onPct(x * 100));
  } catch (e) {
    // Not MP4 or MOV: read the whole file instead, which only works while it is not too big.
    if (file.size > 400 * 1048576) throw e;
    const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) audio.getChannelData(c).forEach((s, i) => (mono[i] += s / audio.numberOfChannels));
    return range ? mono.slice(Math.round(range.start * RATE), Math.round(range.end * RATE)) : mono;
  }
}

// One worker for the whole visit: starting the speech model takes up to half a minute, so later runs reuse it.
let shared: Worker | null = null;
let seq = 0;

// Starts the speech model ahead of time (e.g. when the Silence remover opens), so "Find unwanted
// parts" does not wait the half minute it takes. A second of silence is enough to load it.
export function warmSpeech() {
  shared ??= new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
  shared.postMessage({ id: ++seq, audio: new Float32Array(RATE), offset: 0 });
}

// `sound` (optional): gives the part's sound ready-made (16 kHz mono), e.g. from the Video Editor's
// bridge, where ffmpeg reads it in seconds; otherwise the browser decodes it from the file.
export async function transcribe(file: Blob, range: Span | null | undefined, onStage: (stage: string, pct: number) => void, sound?: () => Promise<Float32Array>): Promise<Word[]> {
  onStage('Reading the sound', 0);
  const audio = (sound ? await sound().catch(() => null) : null) ?? (await partAudio(file, range, (pct) => onStage('Reading the sound', pct)));
  const starts = pieces(audio.length / RATE);
  onStage('Listening to the words', 0);
  const worker = (shared ??= new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' }));
  try {
    const words: Word[] = [];
    for (const [k, a] of starts.entries()) {
      const piece = audio.slice(Math.floor(a * RATE), Math.min(audio.length, Math.floor((a + WIN) * RATE)));
      const id = ++seq;
      const heard = await new Promise<Word[]>((resolve, reject) => {
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.id !== id) return;
          if (m.type === 'loading') onStage('Starting the speech model', 0);
          else if (m.type === 'download') {
            if (m.pct < 100) onStage('Downloading the speech model (only the first time)', m.pct);
            else onStage('Starting the speech model (can take half a minute)', 100);
          }
          else if (m.type === 'done') resolve(m.words);
          else reject(new Error(`Whisper could not listen: ${m.message}`));
        };
        worker.onerror = (e) => reject(new Error(e.message || 'Whisper stopped unexpectedly.'));
        worker.postMessage({ id, audio: piece, offset: a }, [piece.buffer]);
      });
      const [lo, hi] = keepRange(k, starts.length);
      for (const x of heard) {
        const mid = (x.s + x.e) / 2;
        if (x.w.trim() && mid >= lo && mid < hi) words.push(x);
      }
      onStage('Listening to the words', ((k + 1) / starts.length) * 100);
    }
    return words;
  } catch (e) {
    // A worker that failed is not trusted again: the next run starts a fresh one.
    worker.terminate();
    shared = null;
    throw e;
  }
}
