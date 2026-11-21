/// <reference lib="webworker" />
// Whisper (speech to text) runs here, off the page, so the editor stays smooth while it listens.
// The model downloads once from Hugging Face and the browser keeps it; nothing is uploaded.

// Transformers.js, loaded as one self-contained file at this exact version (jsDelivr serves a version
// unchanged forever). It is not part of the app's build: that build cannot compress its speech engine.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

// English-only, small enough to download quickly, and exported with word timings.
const MODEL = 'onnx-community/whisper-base.en_timestamped';

// The model files are kept in this browser's database (IndexedDB). The usual download cache (Cache
// Storage) does not work in every browser, for example the browser inside the Claude app, and without a
// working cache the model (about 200 MB) would be downloaded again every time.
const files = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('studio-speech-models', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const modelCache = {
  async match(key: string | Request) {
    const db = await files();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const q = db.transaction('files').objectStore('files').get(typeof key === 'string' ? key : key.url);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    db.close();
    return blob ? new Response(blob) : undefined;
  },
  async put(key: string | Request, response: Response) {
    const blob = await response.blob();
    const db = await files();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').put(blob, typeof key === 'string' ? key : key.url);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  },
};

type Chunk = { text: string; timestamp: [number, number | null] };
type Asr = (audio: Float32Array, o: object) => Promise<{ chunks?: Chunk[] }>;
let asr: Promise<Asr> | null = null;

async function load(report: (pct: number) => void): Promise<Asr> {
  let shown = -1;
  const { env, pipeline } = await import(/* webpackIgnore: true */ LIB);
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = modelCache;
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const webgpu = !!gpu && !!(await gpu.requestAdapter().catch(() => null));
  const t = await pipeline('automatic-speech-recognition', MODEL, {
    // The graphics card when the browser offers it (much faster), otherwise the processor.
    device: webgpu ? 'webgpu' : 'wasm',
    dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: { status: string; progress?: number }) => {
      // Only when the whole number changes: a 200 MB download reports thousands of times.
      if (p.status !== 'progress_total' || p.progress == null || Math.floor(p.progress) === shown) return;
      shown = Math.floor(p.progress);
      report(shown);
    },
  });
  return t as unknown as Asr;
}

// One message is one piece of sound (up to 30 s, 16,000 samples a second); `offset` is where it starts.
self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array; offset: number }>) => {
  const { id, audio, offset } = e.data;
  try {
    if (!asr) self.postMessage({ id, type: 'loading' });
    asr ??= load((pct) => self.postMessage({ id, type: 'download', pct }));
    const out = await (await asr)(audio, { return_timestamps: 'word' });
    const words = (out.chunks ?? []).map((c) => ({ w: c.text, s: c.timestamp[0] + offset, e: (c.timestamp[1] ?? c.timestamp[0]) + offset }));
    self.postMessage({ id, type: 'done', words });
  } catch (err) {
    asr = null; // a failed load may be tried again
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
