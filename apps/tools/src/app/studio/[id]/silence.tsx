'use client';

// Silence remover: pick a video, press Start, tune three sliders, and the quiet parts are
// marked on the waveform. The preview plays the edited version live: hidden parts are skipped.
// Click a part to select it, then Remove (closed eye) or Keep (open eye) it, or Cut at the playhead.
// Everything runs in the browser; the video is never uploaded.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Crop, Download, Maximize2, Pause, Volume2, VolumeX, Eye, EyeOff, Film, FolderOpen, Play, Save, Scissors, ScanSearch, SlidersHorizontal, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { putProject, saveVideo, type Rec } from '@/lib/studio/silence-projects';
import { flattenMp4 } from '@/lib/studio/mp4-flatten';
import { streamLevels } from '@/lib/studio/audio-levels';
import { api, errorText } from '@/lib/studio/client';
import { transcribe } from '@/lib/studio/transcribe';
import { KIND_LABEL, localFlags, mergeFlags, reviewFlags, snapFlags, type Flag, type ReviewItem, type Word } from '@/lib/studio/unwanted';

// Files read whole (not MP4 or MOV) must stay under this, or the browser runs out of memory.
const WHOLE_FILE_LIMIT = 400 * 1048576;
import { clock, cutSpans, editedTime, findSilences, hopTarget, keepSpans, levels, parseProject, segments, type Override, type Project, type Span } from '@/lib/studio/silence';
import { btn, btnGhost, card, ErrorNote, Popover, Spinner } from '../ui';

// MP4 (H.264 and AAC) when this browser can record it, otherwise WebM.
const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const recorderMime = () => (typeof MediaRecorder === 'undefined' ? undefined : MIMES.find((m) => MediaRecorder.isTypeSupported(m)));
const recorderExt = () => (recorderMime()?.startsWith('video/mp4') ? 'mp4' : 'webm');

// Jumps over a removed part. Never while a jump is still running: setting the time again restarts the
// seek, and a video that is asked again every frame never gets anywhere.
function hop(v: HTMLVideoElement, cuts: Span[], off: number) {
  if (v.seeking) return;
  const to = hopTarget(cuts, v.currentTime - off);
  if (to != null) v.currentTime = to + off;
}

// "2 min 5 sec", for times people read.
const span = (s: number) => (s < 60 ? `${Math.ceil(s)} sec` : `${Math.floor(Math.round(s) / 60)} min ${Math.round(s) % 60} sec`);

// Zoom goes up to about 60 page pixels per second of video (at least 20 times), so long videos can be cut finely.
const zoomLimit = (total: number, viewW: number) => Math.max(20, Math.ceil((total * 60) / Math.max(1, viewW)));
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (n: number) => void }) {
  const id = `sl-${label.replace(/\s/g, '')}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="mt-2 flex items-center gap-3">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={(e) => e.currentTarget.blur()} className="flex-1 accent-[#F37335]" />
        <span className="w-20 text-right text-sm tabular-nums rounded-md bg-st-surface px-2 py-1">{value} {unit}</span>
      </div>
    </div>
  );
}

type Edits = { splits: number[]; overrides: Override[] };
const NO_EDITS: Edits = { splits: [], overrides: [] };

// One project open in the editor. `actions` is the spot in the page header (same line as the title)
// where the buttons are shown. Edits are saved to the project a second after every change.
// `onFile` (optional): when opened from the Video Editor, every file this makes (the exported
// video, the cut list, the project file) is also handed over, so it can be saved into the edit.
export type SilenceFileKind = 'video' | 'cut-list' | 'project';
// `onApply` (optional, Video Editor timeline): puts the parts to keep back on the editor's timeline.
// Without `onChangePart` the part is fixed (it comes from the timeline) and "Change part" is hidden.
// `sound16k` (optional, Video Editor): the part's sound ready for Whisper, read by ffmpeg on this PC.
// `transcribeNative` (optional, Video Editor): the part's words from Whisper on this PC's graphics card
// (much faster); if it is not available or fails, Whisper in the browser is used as before.
// `onPersist` (optional, Video Editor): every auto-save is also handed over, to be kept in the project folder.
// `onlyUnwanted` (Video Editor's Find unwanted parts): silences are never marked (no Settings), and the
// unwanted parts are looked for as soon as the sound has been read. Only what you remove is cut.
export function Editor({ actions, rec, blob, onBack, backLabel, onChangePart, onFile, onApply, sound16k, transcribeNative, onPersist, onlyUnwanted }: { actions: HTMLElement | null; rec: Rec; blob: Blob | null; onBack: () => void; backLabel?: string; onlyUnwanted?: boolean; onChangePart?: () => void; onFile?: (name: string, blob: Blob, kind: SilenceFileKind) => void; onApply?: (keeps: Span[]) => Promise<string>; sound16k?: () => Promise<Float32Array>; transcribeNative?: (onStage: (stage: string, pct: number) => void) => Promise<Word[]>; onPersist?: (rec: Rec) => void }) {
  // Everything here is measured from the start of the chosen part ("part time"); `off` turns it into video time.
  const off = rec.range?.start ?? 0;
  const partLen = rec.range ? rec.range.end - rec.range.start : 0;
  const [file, setFile] = useState<File | null>(() => (blob ? new File([blob], rec.fileName, { type: blob.type }) : null));
  const [url, setUrl] = useState('');
  const [vol, setVol] = useState<number[] | null>(() => (rec.vol ? Array.from(rec.vol) : null));
  const [busy, setBusy] = useState(false);
  const [listened, setListened] = useState(0); // % of the sound read so far
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState(rec.threshold);
  const [minSilence, setMinSilence] = useState(rec.minSilence);
  const [buffer, setBuffer] = useState(rec.buffer);
  const [edited, setEdited] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [edits, setEdits] = useState<Edits>({ splits: rec.splits, overrides: rec.overrides });
  const meta = useRef({ hasVideo: rec.hasVideo });
  const autoStarted = useRef(false);
  const [history, setHistory] = useState<Edits[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // a moment inside the chosen part
  const [duration, setDuration] = useState(0);
  const [notice, setNotice] = useState('');
  const [autosaved, setAutosaved] = useState(false);
  // Unwanted parts: what was said (Whisper) and the highlighted bits (fillers, fumbles, repeats).
  const { id: brandId } = useParams<{ id: string }>();
  const [words, setWords] = useState<Word[] | null>(rec.words ?? null);
  const [flags, setFlags] = useState<Flag[]>(rec.flags ?? []);
  const [finding, setFinding] = useState<{ stage: string; pct: number } | null>(null);
  const [findNote, setFindNote] = useState('');
  const stopAt = useRef<number | null>(null); // "Play" on a highlight stops shortly after it
  const [exp, setExp] = useState<{ pct: number; elapsed: number; left: number } | null>(null); // export progress
  const [dlg, setDlg] = useState<'closed' | 'confirm' | 'running' | 'done' | 'failed'>('closed');
  const [why, setWhy] = useState('');
  const [result, setResult] = useState<{ name: string; blob: Blob } | null>(null);
  const stopExport = useRef(false);
  const dlgOpen = useRef(false);
  dlgOpen.current = dlg !== 'closed';
  const pending = useRef<Project | null>(null); // a project waiting for its video
  const [viewW, setViewW] = useState(800);
  // Two players of the same video take turns, so jumping over a removed part never waits for a seek:
  // while one plays, the other already waits (paused) at the start of the next kept part, and at the
  // cut they swap. `video` always points at the one showing; the other is the "spare".
  const video = useRef<HTMLVideoElement | null>(null);
  const vidA = useRef<HTMLVideoElement | null>(null);
  const vidB = useRef<HTMLVideoElement | null>(null);
  const [front, setFront] = useState<0 | 1>(0); // which one is showing
  const [rate, setRate] = useState(1); // playback speed
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const clockText = useRef<HTMLSpanElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) return setUrl('');
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // A project opened without its sound readings (just created) listens once, straight away.
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (file && !vol) start(file);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // A hidden page measures 0 wide; keep the last real width instead (0 drew the whole timeline at 0 px).
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setViewW(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function applyProject(p: Project) {
    setThreshold(p.threshold);
    setMinSilence(p.minSilence);
    setBuffer(p.buffer);
    setEdits({ splits: p.splits, overrides: p.overrides });
    setHistory([]);
    setSelected(null);
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setVol(null);
    setError('');
    setNotice('');
    setAutosaved(false);
    const p = pending.current;
    pending.current = null;
    if (p) {
      applyProject(p);
    } else {
      setEdits(NO_EDITS);
      setHistory([]);
      setSelected(null);
    }
    saveVideo(rec.id, f).then(
      () => { meta.current.hasVideo = true; },
      () => { meta.current.hasVideo = false; setNotice('This browser has no room to keep the video, so you will need to choose it again when you reopen this project.'); },
    );
    start(f);
  }

  async function openProject(f: File | undefined) {
    if (!f) return;
    const p = parseProject(await f.text());
    if (!p) return setError('That is not a Silence remover project file.');
    setError('');
    if (file && file.name === p.video.name && file.size === p.video.size) {
      applyProject(p);
      setNotice('');
      start(file);
    } else {
      pending.current = p;
      setNotice(`Project opened. Now choose its video: ${p.video.name}`);
    }
  }

  function save(name: string, blob: Blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const base = () => (file?.name ?? 'video').replace(/\.[^.]+$/, '');
  // Downloads the file, and hands it to the Video Editor when opened from there.
  function deliver(name: string, blob: Blob, kind: SilenceFileKind) {
    save(name, blob);
    onFile?.(name, blob, kind);
  }

  function saveProject() {
    if (!file) return;
    const p: Project = { v: 1, video: { name: file.name, size: file.size }, threshold, minSilence, buffer, splits: edits.splits, overrides: edits.overrides };
    deliver(`${base()}.silence.json`, new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), 'project');
    setNotice('Project saved. Open it later with "Open project", then choose the same video.');
  }

  // Export plays the edited version once and records it, so it takes as long as the edited video.
  function openExport() {
    const v = video.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
    if (!v || !vol || exp !== null) return;
    if (!v.captureStream || typeof MediaRecorder === 'undefined') return setError('This browser cannot record the preview. Use Chrome or Edge, or download the cut list.');
    if (!keepSpans(cuts, total).length) return setError('Nothing is left to export. Keep at least one part.');
    setError('');
    setNotice('');
    setResult(null);
    setDlg('confirm');
  }

  async function exportVideo() {
    const v = video.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
    if (!v || !vol || exp !== null) return;
    const keep = keepSpans(cuts, total);
    const kept = total - removed;
    stopExport.current = false;
    const began = Date.now();
    setExp({ pct: 0, elapsed: 0, left: kept });
    setDlg('running');
    let why = '';
    const chunks: Blob[] = [];
    let rec: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    // Silent on the speakers while it plays for the recording; the recording still gets the sound.
    const wasMuted = v.muted;
    v.muted = true;
    try {
      v.pause();
      if (Math.abs(v.currentTime - off - keep[0].start) > 0.01) await new Promise<void>((r) => { v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = keep[0].start + off; });
      stream = v.captureStream!();
      // High bitrate, so the recording keeps as much of the picture as a re-encode can: 1.5 times the
      // original file's, and never below 8 Mbps.
      // The original bitrate is the whole file over the whole video's length (not the chosen part's).
      const fullLength = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Math.max(1, total);
      const bits = Math.min(40e6, Math.max(8e6, file ? ((file.size * 8) / fullLength) * 1.5 : 0));
      rec = new MediaRecorder(stream, { ...(recorderMime() ? { mimeType: recorderMime() } : {}), videoBitsPerSecond: bits, audioBitsPerSecond: 192000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onerror = (e) => { why ||= `The browser could not record this video (${(e as any).error?.message ?? 'recording error'}).`; };
      rec.start(1000);
      await v.play();
      const last = keep[keep.length - 1].end;
      let shown = -1;
      let lastT = -1;
      let movedAt = Date.now();
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          const t = v.currentTime - off;
          hop(v, cuts, off);
          const done = Math.max(0, editedTime(t, cuts));
          // A video that stops moving for 5 seconds (a stuck seek) must not hang the export.
          if (Math.abs(t - lastT) > 0.01) { lastT = t; movedAt = Date.now(); }
          else if (Date.now() - movedAt > 5000) why ||= kept - done < 1 ? '' : `The video stopped responding at ${clock(t)}. Try again, or try a shorter clip.`;
          const finished = kept - done < 0.25 || (Date.now() - movedAt > 5000 && !why);
          const sec = Math.floor((Date.now() - began) / 1000);
          if (sec !== shown) {
            shown = sec;
            setExp({ pct: Math.min(99, Math.round((done / kept) * 100)), elapsed: sec, left: Math.max(0, kept - done) });
          }
          if (stopExport.current) why ||= 'You stopped the export.';
          else if (v.paused && !v.ended) why ||= 'The video was paused while exporting (for example by pressing Space).';
          if (why || finished || v.ended || t >= last - 0.05) { clearInterval(iv); resolve(); }
        }, 50);
      });
    } catch (e) {
      why ||= `The export could not start (${e instanceof Error ? e.message : 'unknown error'}).`;
    }
    v.pause();
    v.muted = wasMuted;
    if (rec && rec.state !== 'inactive') {
      const stopped = new Promise<void>((r) => { rec!.onstop = () => r(); });
      rec.stop();
      await stopped;
    }
    stream?.getTracks().forEach((t) => t.stop());
    setExp(null);
    v.currentTime = off;
    if (!why && !chunks.length) why = 'The browser recorded nothing from this video. Try a shorter clip, or download the cut list instead.';
    if (why) {
      setWhy(why);
      setDlg('failed');
      return;
    }
    const name = `${base()}-edited.${recorderExt()}`;
    const raw = new Blob(chunks, { type: rec?.mimeType || 'video/webm' });
    // Chrome writes MP4 like a live stream (no length, no seeking); rewrite it as a normal MP4.
    const blob = raw.type.startsWith('video/mp4') ? await flattenMp4(raw).catch(() => raw) : raw;
    setResult({ name, blob });
    deliver(name, blob, 'video');
    setDlg('done');
  }

  async function start(f: File | null = file) {
    if (!f || busy) return;
    setBusy(true);
    setError('');
    setListened(0);
    let shown = 0;
    try {
      // MP4 and MOV: read the sound piece by piece, so any length works.
      setVol(await streamLevels(f, (x) => { const pct = Math.floor(x * 100); if (pct !== shown) setListened((shown = pct)); }, rec.range));
    } catch (e) {
      // Other files (WebM, for example) are read whole, which only works while they are not too big.
      if (f.size > WHOLE_FILE_LIMIT) setError(`${e instanceof Error ? e.message : 'This video could not be read.'} Videos over ${WHOLE_FILE_LIMIT / 1048576} MB need to be MP4 or MOV.`);
      else {
        try {
          // 8 kHz mono is plenty for finding pauses.
          const ctx = new OfflineAudioContext(1, 1, 8000);
          const audio = await ctx.decodeAudioData(await f.arrayBuffer());
          const mono = new Float32Array(audio.length);
          for (let c = 0; c < audio.numberOfChannels; c++) audio.getChannelData(c).forEach((s, i) => (mono[i] += s / audio.numberOfChannels));
          const all = levels(mono, audio.sampleRate);
          setVol(rec.range ? all.slice(Math.round(rec.range.start / 0.02), Math.round(rec.range.end / 0.02)) : all);
        } catch {
          setError('Could not read the sound of this video. It may have no audio, or a format this browser cannot read.');
        }
      }
    }
    setBusy(false);
  }

  const total = vol ? vol.length * 0.02 : partLen || duration;
  const silences = useMemo(() => (vol && !onlyUnwanted ? findSilences(vol, threshold, minSilence, buffer) : []), [vol, threshold, minSilence, buffer, onlyUnwanted]);
  const segs = useMemo(() => (vol ? segments(silences, edits.splits, edits.overrides, total) : []), [vol, silences, edits, total]);
  const cuts = useMemo(() => cutSpans(segs), [segs]);
  const removed = cuts.reduce((n, c) => n + c.end - c.start, 0);
  const keeps = useMemo(() => keepSpans(cuts, total), [cuts, total]);
  const current = selected == null ? null : segs.find((s) => selected >= s.start && selected < s.end) ?? null;

  // Saves the project: a second after every change, and again when leaving the editor.
  const persist = () => {
    if (!file || !vol) return;
    const saved: Rec = { id: rec.id, name: rec.name, fileName: file.name, size: file.size, range: rec.range ?? null, total: vol.length * 0.02, removed, threshold, minSilence, buffer, splits: edits.splits, overrides: edits.overrides, vol: Uint8Array.from(vol, (x) => Math.round(x)), words: words ?? undefined, flags, hasVideo: meta.current.hasVideo, updatedAt: Date.now(), link: rec.link };
    putProject(saved).then(() => setAutosaved(true), () => {});
    onPersist?.(saved);
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (!file || !vol) return;
    const id = setTimeout(() => persistRef.current(), 1000);
    return () => clearTimeout(id);
  }, [file, vol, threshold, minSilence, buffer, edits, words, flags]);
  useEffect(() => () => persistRef.current(), []);

  const maxZoom = zoomLimit(total, viewW);
  const innerW = Math.round(viewW * zoom);
  const perSec = total ? innerW / total : 0;

  function change(next: Edits) {
    setHistory((h) => [...h.slice(-49), edits]);
    setEdits(next);
  }
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setEdits(prev);
  };
  const choose = (hide: boolean) => current && change({ ...edits, overrides: [...edits.overrides, { start: current.start, end: current.end, hide }] });
  // Finds unwanted parts: Whisper writes down every word with its time (in this browser), simple checks
  // catch fillers and doubled words, and Gemini points at repeated takes and fumbles. Nothing is cut.
  async function findUnwanted() {
    if (!file || !vol || finding) return;
    setFindNote('');
    try {
      const onStage = (stage: string, pct: number) => setFinding({ stage, pct: Math.round(pct) });
      const native = words ? null : transcribeNative ? await transcribeNative(onStage).catch(() => null) : null;
      const ws = words ?? native ?? (await transcribe(file, rec.range, onStage, sound16k));
      setWords(ws);
      setFinding({ stage: 'Checking for repeats and fumbles', pct: 100 });
      let ai: Flag[] = [];
      if (ws.length) {
        try {
          ai = reviewFlags((await api<{ items: ReviewItem[] }>('unwanted', { brandId, words: ws.map((x) => x.w.trim()) })).items, ws);
        } catch (e) {
          setFindNote(`Repeats and fumbles were not checked: ${errorText(e)} Fillers and doubled words are still shown.`);
        }
      }
      const found = snapFlags(mergeFlags([...localFlags(ws, vol, threshold), ...ai]), vol);
      // Parts you chose to ignore stay ignored when you look again.
      const was = (f: Flag) => flags.find((o) => o.ignored && Math.abs(o.start - f.start) < 0.15 && Math.abs(o.end - f.end) < 0.15);
      setFlags(found.map((f) => (was(f) ? { ...f, ignored: true } : f)));
      if (!ws.length) setFindNote('No speech was heard in this part.');
    } catch (e) {
      setFindNote(errorText(e));
    }
    setFinding(null);
  }
  // Find unwanted parts mode: look as soon as the sound is read, once, unless it was done before.
  const autoFound = useRef(false);
  useEffect(() => {
    if (!onlyUnwanted || autoFound.current || !vol || !file || busy || finding || flags.length) return;
    autoFound.current = true;
    void findUnwanted();
  }, [onlyUnwanted, vol, file, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // A highlight counts as removed once (nearly) all of it is cut, not when its middle happens to sit in a silence.
  const isCut = (f: Flag) => cuts.reduce((n, c) => n + Math.max(0, Math.min(f.end, c.end) - Math.max(f.start, c.start)), 0) >= 0.9 * (f.end - f.start);
  const setFlagsHidden = (list: Flag[], hide: boolean) => list.length && change({
    splits: [...edits.splits, ...list.flatMap((f) => [f.start, f.end])],
    overrides: [...edits.overrides, ...list.map((f) => ({ start: f.start, end: f.end, hide }))],
  });
  const removeFlags = (list: Flag[]) => setFlagsHidden(list, true);
  const ignoreFlag = (f: Flag) => setFlags((all) => all.map((x) => (x === f ? { ...x, ignored: true } : x)));
  function playFlag(f: Flag) {
    const v = video.current;
    if (!v) return;
    setEdited(false); // so the highlight itself is heard, even if it is already removed
    v.currentTime = off + Math.max(0, f.start - 0.5);
    stopAt.current = off + f.end + 0.5;
    v.play().catch(() => {});
  }
  const shown = flags.filter((f) => !f.ignored);
  const open = shown.filter((f) => !isCut(f));

  function cutHere() {
    const t = (video.current?.currentTime ?? off) - off;
    if (!vol || t <= 0.05 || t >= total - 0.05 || segs.some((s) => Math.abs(s.start - t) < 0.05)) return;
    change({ ...edits, splits: [...edits.splits, t] });
    setSelected(t);
  }

  // Waveform: only the part on screen is drawn, so it stays sharp at any zoom on a long video.
  // (The shading and the cut lines are page elements on top.)
  const draw = () => {
    const c = canvas.current;
    const el = scroller.current;
    if (!c || !el || !vol) return;
    const x0 = el.scrollLeft;
    const w = el.clientWidth;
    c.style.left = `${x0}px`;
    c.style.width = `${w}px`;
    const dpr = devicePixelRatio;
    const W = Math.round(w * dpr);
    const H = c.clientHeight * dpr;
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#F37335';
    const per = vol.length / innerW; // readings per page pixel
    for (let x = 0; x < W; x++) {
      const from = Math.floor((x0 + x / dpr) * per);
      const to = Math.max(Math.floor((x0 + (x + 1) / dpr) * per), from + 1);
      let m = 0;
      for (let i = from; i < to && i < vol.length; i++) if (vol[i] > m) m = vol[i];
      const bar = (m / 100) * H;
      g.fillRect(x, (H - bar) / 2, 1, Math.max(1, bar));
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => { draw(); }, [vol, innerW, viewW]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => drawRef.current()); };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  // While the video plays: move the playhead, show the edited time, and jump over hidden parts.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v && total) {
        if (rec.range && !v.seeking) {
          if (v.currentTime < off - 0.05) v.currentTime = off;
          else if (!v.paused && v.currentTime >= off + total) { v.pause(); v.currentTime = off + total; }
        }
        const t = v.currentTime - off;
        if (head.current) head.current.style.left = `${t * perSec}px`;
        if (clockText.current) clockText.current.textContent = `${clock(editedTime(t, cuts))} / ${clock(total - removed)}`;
        // Our controls: the edited length once checked (that is what ends up on the timeline), else the part.
        const showEdited = edited && !!vol;
        const now = showEdited ? editedTime(t, cuts) : t;
        const len = showEdited ? total - removed : total;
        if (ctlTime.current) ctlTime.current.textContent = `${clock(Math.max(0, Math.min(len, now)))} / ${clock(len)}`;
        if (ctlBar.current && document.activeElement !== ctlBar.current) { ctlBar.current.max = String(len); ctlBar.current.value = String(Math.max(0, Math.min(len, now))); }
        const el = scroller.current;
        if (el && !v.paused && (t * perSec < el.scrollLeft || t * perSec > el.scrollLeft + el.clientWidth)) el.scrollLeft = t * perSec - 40;
        if (stopAt.current != null && !v.paused && v.currentTime >= stopAt.current) { v.pause(); stopAt.current = null; }
        if (edited && !v.paused && !dlgOpen.current) {
          // Gapless: the spare waits at the next kept part; at the end of this one, swap to it.
          const spare = v === vidA.current ? vidB.current : vidA.current;
          const k = keeps.findIndex((x) => t >= x.start - 0.05 && t < x.end);
          const next = k >= 0 ? keeps[k + 1] : undefined;
          if (spare && next) {
            if (spare.dataset.target !== String(next.start)) {
              if (!spare.paused) spare.pause();
              spare.currentTime = next.start + off;
              spare.dataset.target = String(next.start);
            }
            const ready = spare.readyState >= 2 && !spare.seeking;
            if (t >= keeps[k].end - 0.035 && ready) {
              spare.muted = v.muted;
              spare.volume = v.volume;
              spare.playbackRate = v.playbackRate;
              void spare.play().catch(() => {});
              v.pause();
              delete spare.dataset.target;
              video.current = spare;
              setFront(spare === vidA.current ? 0 : 1);
              raf = requestAnimationFrame(tick);
              return;
            }
          }
          hop(v, cuts, off); // inside a removed part (or the spare was not ready): jump the old way
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cuts, edited, total, removed, perSec, keeps]);

  // ---- the player's own controls (the browser's would show the whole file's length) ----
  const ctlTime = useRef<HTMLSpanElement>(null);
  const ctlBar = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  // From the scrub bar: edited time (once checked) back to part time.
  function scrubTo(x: number) {
    const v = video.current;
    if (!v) return;
    let t = x;
    if (edited && vol) {
      let acc = 0;
      t = total;
      for (const k of keepSpans(cuts, total)) {
        const len = k.end - k.start;
        if (x <= acc + len) { t = k.start + (x - acc); break; }
        acc += len;
      }
    }
    t = Math.max(0, Math.min(total, t));
    setSelected(t);
    v.currentTime = t + off;
  }
  useEffect(() => { for (const el of [vidA.current, vidB.current]) if (el) el.playbackRate = rate; }, [rate, url]);

  function togglePlay() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    if (v.currentTime >= off + total - 0.05) v.currentTime = off; // at the end: start over
    void v.play().catch(() => {});
  }

  // Repaint the time readouts as soon as the cuts change (Remove all, settings, keep/remove), not only
  // on the next animation frame: those pause in background tabs, which left a stale length showing.
  useEffect(() => {
    const v = video.current;
    if (!v || !total) return;
    const t = v.currentTime - off;
    const showEdited = edited && !!vol;
    const now = showEdited ? editedTime(t, cuts) : t;
    const len = showEdited ? total - removed : total;
    if (clockText.current) clockText.current.textContent = `${clock(editedTime(t, cuts))} / ${clock(total - removed)}`;
    if (ctlTime.current) ctlTime.current.textContent = `${clock(Math.max(0, Math.min(len, now)))} / ${clock(len)}`;
    if (ctlBar.current) { ctlBar.current.max = String(len); ctlBar.current.value = String(Math.max(0, Math.min(len, now))); }
  }, [cuts, removed, total, edited, vol, off, duration]); // duration: once the video has loaded

  // Dragging an end of a removed part: the new end is shown while you drag and saved (one undo step)
  // when you let go. Making it longer removes more; shorter gives that bit back.
  const lane = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ cut: Span; edge: 'start' | 'end'; t: number } | null>(null);
  const dragAt = (clientX: number, cut: Span, edge: 'start' | 'end') => {
    const left = lane.current?.getBoundingClientRect().left ?? 0;
    const t = (clientX - left) / perSec;
    const MIN = 0.05; // a removed part never shrinks below 50 ms by dragging
    return edge === 'start' ? Math.max(0, Math.min(cut.end - MIN, t)) : Math.max(cut.start + MIN, Math.min(total, t));
  };
  function resizeCut(cut: Span, edge: 'start' | 'end', t: number) {
    const was = cut[edge];
    if (Math.abs(t - was) < 0.005) return;
    const grow = edge === 'end' ? t > was : t < was;
    const o = { start: Math.min(t, was), end: Math.max(t, was), hide: grow };
    change({ splits: [...edits.splits, t], overrides: [...edits.overrides, o] });
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const t = Math.max(0, Math.min(total, (e.clientX - e.currentTarget.getBoundingClientRect().left) / perSec));
    setSelected(t);
    if (video.current) video.current.currentTime = t + off;
  }

  function zoomBy(f: number, anchorX?: number) {
    const el = scroller.current;
    if (!el) return;
    const x = anchorX ?? el.clientWidth / 2;
    const at = (el.scrollLeft + x) / innerW;
    const z = Math.max(1, Math.min(maxZoom, zoom * f));
    setZoom(z);
    requestAnimationFrame(() => { el.scrollLeft = at * viewW * z - x; });
  }

  // Keyboard and mouse shortcuts. They only work while this section is on screen.
  const live = useRef({ zoomBy, segs, total });
  live.current = { zoomBy, segs, total };
  useEffect(() => {
    // The browser's own video controls also answer to Space and the arrows when the video is
    // focused, which made play and pause cancel out. So these run first (capture) and stop the
    // event from reaching the player.
    const mine = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const input = el.tagName === 'INPUT' ? (el as HTMLInputElement).type : '';
      if (!root.current?.offsetParent || dlgOpen.current || e.altKey || e.ctrlKey || e.metaKey || !video.current) return false;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (input && input !== 'range' && input !== 'checkbox')) return false;
      return e.key === ' ' || ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && input !== 'range');
    };
    const onKey = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      const v = video.current!;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === ' ') {
        if (v.paused) v.play().catch(() => {});
        else v.pause();
        return;
      }
      const kept = live.current.segs.filter((s) => !s.hidden);
      const t = v.currentTime - off;
      const to = e.key === 'ArrowRight' ? kept.find((s) => s.start > t + 0.05) : [...kept].reverse().find((s) => s.start < t - 0.3);
      if (!to) return;
      v.currentTime = to.start + off;
      setSelected(to.start + 1e-6);
    };
    // A focused button or checkbox would otherwise be pressed again when Space is released.
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && mine(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      live.current.zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX - el.getBoundingClientRect().left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Timeline mode: the parts to keep, in video seconds, go back onto the editor's timeline.
  const [applying, setApplying] = useState(false);
  async function applyToTimeline() {
    if (!onApply || !vol) return;
    setApplying(true);
    setError('');
    try {
      persistRef.current();
      setNotice(await onApply(keepSpans(cuts, total).map((k) => ({ start: k.start + off, end: k.end + off }))));
    } catch (e) { setError((e as Error).message); }
    finally { setApplying(false); }
  }

  function download() {
    const text = ['Parts to keep (start, end in seconds)', ...keepSpans(cuts, total).map((k) => `${k.start.toFixed(2)}, ${k.end.toFixed(2)}`), '', 'Parts removed', ...cuts.map((s) => `${s.start.toFixed(2)}, ${s.end.toFixed(2)}`)].join('\n');
    deliver(`${(file?.name ?? 'video').replace(/\.[^.]+$/, '')}-cut-list.txt`, new Blob([text], { type: 'text/plain' }), 'cut-list');
  }

  const step = STEPS.find((s) => s * perSec >= 70) ?? STEPS[STEPS.length - 1];
  const ticks = total && Number.isFinite(total) ? Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step) : [];
  const tool = (_disabled: boolean) => `${btnGhost} !min-h-[38px] !px-3`; // one size for every button, as in the header

  return (
    <div ref={root} className="space-y-4">
      <ErrorNote text={error} />
      {actions && createPortal(<>
        <button onClick={() => { persistRef.current(); onBack(); }} className={`${btnGhost} !min-h-[38px] !px-3`}><ArrowLeft size={14} aria-hidden /> {backLabel ?? 'Projects'}</button>
        {file ? (
          onChangePart && <button onClick={() => { persistRef.current(); onChangePart(); }} disabled={busy} className={`${btnGhost} !min-h-[38px] !px-3`}><Crop size={14} aria-hidden /> Change part</button>
        ) : (
          <label className={`${btnGhost} !min-h-[38px] !px-3 cursor-pointer`}>
            <Upload size={14} aria-hidden /> Choose video
            <input type="file" accept="video/*,audio/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
        <button onClick={() => start()} disabled={!file || busy} className={`${btn} !py-2 !min-h-[38px] !px-3`}>
          {busy ? <Spinner /> : <Scissors size={14} aria-hidden />} {busy ? `Listening… ${listened}%` : vol ? 'Restart' : 'Start'}
        </button>
        <label className={`${btnGhost} !min-h-[38px] !px-3 cursor-pointer`}>
          <FolderOpen size={14} aria-hidden /> Open project
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { openProject(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {/* The three silence settings, in a pop-up: it stays open while you drag, so the timeline updates as you watch. */}
        {!onlyUnwanted && <Popover
          align="right"
          trigger={({ open: isOpen, toggle }) => (
            <button onClick={toggle} aria-haspopup="dialog" aria-expanded={isOpen} className={`${btnGhost} !min-h-[38px] !px-3`}><SlidersHorizontal size={14} aria-hidden /> Settings</button>
          )}
        >
          {() => (
            <div role="dialog" aria-label="Silence settings" className="w-80 space-y-5 p-3.5">
              <div>
                <h3 className="font-semibold">Settings</h3>
                {file && <p className="truncate text-xs text-st-mute">{file.name}</p>}
              </div>
              <Slider label="Threshold" value={threshold} min={1} max={60} step={1} unit="%" onChange={setThreshold} />
              <Slider label="Minimum Silence" value={minSilence} min={0.1} max={3} step={0.1} unit="s" onChange={(n) => setMinSilence(Math.round(n * 10) / 10)} />
              <Slider label="Increase Buffer" value={buffer} min={0} max={0.5} step={0.05} unit="s" onChange={(n) => setBuffer(Math.round(n * 100) / 100)} />
              <p className="text-xs text-st-mute">Threshold: anything quieter than this counts as silence. Minimum Silence: a pause must last this long. Buffer: a little sound kept on both sides so words are not clipped.</p>
            </div>
          )}
        </Popover>}
        <button onClick={saveProject} disabled={!file} className={`${btnGhost} !min-h-[38px] !px-3`}><Save size={14} aria-hidden /> Save project</button>
        {onApply && (
          <button onClick={applyToTimeline} disabled={!vol || applying} title="Remove these parts from the editor's timeline (you can undo it there)"
            className={`${btn} !py-2 !min-h-[38px] !px-3`}>
            {applying ? <Spinner /> : <Check size={14} aria-hidden />} {applying ? 'Applying…' : 'Apply to timeline'}
          </button>
        )}
        <button onClick={openExport} disabled={!vol || exp !== null} className={`${btn} !py-2 !min-h-[38px] !px-3 !bg-st-ink hover:!bg-black`}>
          {exp === null ? <Film size={14} aria-hidden /> : <Spinner />} {exp === null ? 'Export' : `Exporting ${exp.pct}%`}
        </button>
      </>, actions)}
      {notice && <p role="status" className="text-sm text-st-mute text-right">{notice}</p>}

      {/* Unwanted parts on the left (stretching, taking the video's height and scrolling), the video on the right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(340px,1fr)_auto]">
        <section className={`${card} p-4 lg:max-w-[60vw]`} aria-label="Video">
          {url ? (
            <div ref={frame} className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-black">
              {/* Player A sets the frame's size; player B sits exactly on top. Only the front one is visible. */}
              {([0, 1] as const).map((i) => (
                <video key={i} src={url} onClick={togglePlay} preload="auto"
                  ref={(el) => { (i === 0 ? vidA : vidB).current = el; if (i === front || !video.current) video.current = el ?? video.current; }}
                  onPlay={(e) => { if (e.currentTarget === video.current) setPlaying(true); }}
                  onPause={(e) => { if (e.currentTarget === video.current) setPlaying(false); }}
                  onVolumeChange={(e) => { if (e.currentTarget === video.current) setMuted(e.currentTarget.muted); }}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget;
                    el.playbackRate = rate;
                    if (i === 0) setDuration(Number.isFinite(el.duration) ? el.duration : 0);
                    if (off && el === video.current) el.currentTime = off;
                  }}
                  className={`${i === 0 ? 'block max-h-[55vh] w-auto max-w-full' : 'absolute inset-0 h-full w-full object-contain'} bg-black cursor-pointer ${i === front ? '' : 'opacity-0 pointer-events-none'}`} />
              ))}
              {/* Own controls: time and scrub bar cover only this part (or the edited length), never the whole file. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent text-white text-xs">
                <button onClick={togglePlay} className="p-1 rounded hover:bg-white/15" aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
                </button>
                <span ref={ctlTime} className="tabular-nums shrink-0">0:00 / 0:00</span>
                <input ref={ctlBar} type="range" min={0} max={0} step={0.01} defaultValue={0} aria-label="Position"
                  onInput={(e) => scrubTo(Number(e.currentTarget.value))} onMouseUp={(e) => e.currentTarget.blur()}
                  className="flex-1 min-w-[6rem] accent-[#F37335] cursor-pointer" />
                <button onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} className="p-1 rounded hover:bg-white/15" aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
                </button>
                <button onClick={() => { const f = frame.current; if (!f) return; if (document.fullscreenElement) void document.exitFullscreen(); else void f.requestFullscreen().catch(() => {}); }}
                  className="p-1 rounded hover:bg-white/15" aria-label="Full screen"><Maximize2 size={14} aria-hidden /></button>
              </div>
            </div>
          ) : (
            <div className="aspect-video grid place-items-center rounded-lg bg-st-surface text-sm text-st-mute">Choose a video to begin</div>
          )}
          {vol && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>Edited video: <b><span ref={clockText} className="tabular-nums" /></b></span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={edited} onChange={(e) => setEdited(e.target.checked)} className="accent-[#F37335]" /> Preview the edited version
              </label>
            </div>
          )}
        </section>

        <section className={`${card} relative min-h-[18rem] lg:order-first`} aria-label="Unwanted parts">
          <div className="flex h-full flex-col p-4 lg:absolute lg:inset-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate font-semibold">Unwanted parts</h2>
              <button onClick={findUnwanted} disabled={!vol || !file || !!finding} className={`${btnGhost} shrink-0 !min-h-[38px] !px-3 !border-red-200 !text-red-700 hover:!bg-red-50`} title="Highlight fillers, fumbles and repeated takes in red (nothing is removed)">
                {finding ? <Spinner /> : <ScanSearch size={14} aria-hidden />} {finding ? 'Working…' : words ? 'Find again' : 'Find unwanted parts'}
              </button>
            </div>
            {finding && (
              <div className="mt-3" aria-live="polite">
                <p className="text-sm">{finding.stage}… <span className="tabular-nums text-st-mute">{finding.pct}%</span></p>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-st-surface"><div className="h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${finding.pct}%` }} /></div>
              </div>
            )}
            {findNote && <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{findNote}</p>}
            {/* Everything at once: every highlighted part (fillers, repeats, fumbles), or only the fillers; and back. */}
            {(open.length > 0 || shown.length > open.length) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {open.length > 0 && (
                  <button onClick={() => removeFlags(open)} className={`${btn} !min-h-[38px] !px-3 !py-2`} title="Remove every highlighted part from the video (you can restore them)">
                    <EyeOff size={14} aria-hidden /> Remove all ({open.length})
                  </button>
                )}
                {open.some((f) => f.kind === 'filler') && open.some((f) => f.kind !== 'filler') && (
                  <button onClick={() => removeFlags(open.filter((f) => f.kind === 'filler'))} className={`${btnGhost} !min-h-[38px] !px-3`}><EyeOff size={14} aria-hidden /> Only fillers</button>
                )}
                {shown.length > open.length && (
                  <button onClick={() => setFlagsHidden(shown.filter(isCut), false)} className={`${btnGhost} !min-h-[38px] !px-3`} title="Put every removed highlighted part back">
                    <Undo2 size={14} aria-hidden /> Restore all ({shown.length - open.length})
                  </button>
                )}
              </div>
            )}
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {shown.length > 0 ? (
                <ul className="divide-y divide-st-line">
                  {shown.map((f) => {
                    const gone = isCut(f);
                    return (
                      <li key={`${f.start}-${f.end}`} className="py-2.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${gone ? 'bg-st-surface text-st-mute' : 'bg-red-100 text-red-800'}`}>{KIND_LABEL[f.kind]}</span>
                          <span className="tabular-nums text-st-mute">{clock(f.start)}</span>
                          <span className="ml-auto flex gap-1.5">
                            <button onClick={() => playFlag(f)} className={`${btnGhost} !min-h-[38px] !px-3`} aria-label={`Play the ${KIND_LABEL[f.kind].toLowerCase()} at ${clock(f.start)}`} title="Play it"><Play size={14} aria-hidden /></button>
                            {gone ? <button onClick={() => setFlagsHidden([f], false)} className={`${btnGhost} !min-h-[38px] !px-3`} title="Put this part back in the video"><Undo2 size={14} aria-hidden /> Restore</button> : <>
                              <button onClick={() => removeFlags([f])} className={`${btnGhost} !min-h-[38px] !px-3`}><EyeOff size={14} aria-hidden /> Remove</button>
                              <button onClick={() => ignoreFlag(f)} className={`${btnGhost} !min-h-[38px] !px-3`} aria-label={`Ignore the ${KIND_LABEL[f.kind].toLowerCase()} at ${clock(f.start)}`}><X size={14} aria-hidden /> Ignore</button>
                            </>}
                          </span>
                        </div>
                        <p className={`mt-1 ${gone ? 'text-st-mute line-through decoration-st-mute/50' : ''}`}>{f.text && <span className="italic">“{f.text}”</span>} <span className="text-st-mute">{f.why}</span></p>
                      </li>
                    );
                  })}
                </ul>
              ) : !finding && (
                <p className="pt-2 text-sm text-st-mute">{words ? 'Nothing is highlighted.' : 'Press "Find unwanted parts": Whisper listens to this part in your browser and Gemini points at repeats and fumbles. They are highlighted in red; nothing is removed until you choose.'}</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className={`${card} p-4`} aria-label="Timeline">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={undo} disabled={!history.length} className={tool(!history.length)} aria-label="Undo" title="Undo"><Undo2 size={14} aria-hidden /></button>
          <button onClick={cutHere} disabled={!vol} className={tool(!vol)} title="Cut the video into two parts at the playhead"><Scissors size={14} aria-hidden /> Cut</button>
          <button onClick={() => choose(true)} disabled={!current || current.hidden} className={tool(!current)} title="Remove the selected part from the preview (closed eye)"><EyeOff size={14} aria-hidden /> Remove</button>
          <button onClick={() => choose(false)} disabled={!current || !current.hidden} className={tool(!current)} title="Keep the selected part in the preview (open eye)"><Eye size={14} aria-hidden /> Keep</button>
          {/* Playback speed (the sound keeps its pitch). Only for watching: the export is always at normal speed. */}
          <div className="flex items-center rounded-lg border border-st-line bg-white p-0.5" role="group" aria-label="Playback speed">
            {[1, 1.5, 2, 2.5, 3].map((r) => (
              <button key={r} onClick={() => setRate(r)} aria-pressed={rate === r} title={`Play at ${r}x`}
                className={`rounded-md px-2 py-1.5 text-xs tabular-nums ${rate === r ? 'bg-18-orange text-white font-semibold' : 'text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>{r}x</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => zoomBy(1 / 1.5)} disabled={!vol || zoom <= 1} className={tool(!vol)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={14} aria-hidden /></button>
            <input type="range" min={1} max={maxZoom} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} onPointerUp={(e) => e.currentTarget.blur()} disabled={!vol} aria-label="Zoom" className="w-28 accent-[#F37335]" />
            <button onClick={() => zoomBy(1.5)} disabled={!vol || zoom >= maxZoom} className={tool(!vol)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={14} aria-hidden /></button>
            <button onClick={download} disabled={!vol} className={tool(!vol)}><Download size={14} aria-hidden /> Cut list</button>
          </div>
        </div>
        <p className="text-sm mb-2" aria-live="polite">
          {vol ? (
            <><b>{cuts.length}</b> {cuts.length === 1 ? "part" : "parts"} removed · <b>{clock(removed)}</b> gone · {clock(total)} becomes <b>{clock(Math.max(0, total - removed))}</b>{current && <span className="text-st-mute"> · selected part: {clock(current.start)} to {clock(current.end)}, {current.hidden ? 'removed' : 'kept'}</span>}{autosaved && <span className="text-st-mute"> · auto-saved</span>}</>
          ) : (
            <span className="text-st-mute">{onlyUnwanted ? (busy ? 'Reading the sound…' : 'Press Start to read the sound.') : 'Press Start to find the silent parts.'}</span>
          )}
        </p>
        <div ref={scroller} className="overflow-x-auto rounded-lg bg-st-surface">
          {vol ? (
            <div ref={lane} className={`relative h-36 select-none ${drag ? 'cursor-ew-resize' : 'cursor-pointer'}`} style={{ width: innerW }} onClick={seek}>
              <div className="absolute inset-x-0 top-0 h-5 border-b border-st-line text-[10px] text-st-mute pointer-events-none">
                {ticks.map((t) => <span key={t} className="absolute top-1 pl-1 border-l border-st-line" style={{ left: t * perSec }}>{clock(t)}</span>)}
              </div>
              <canvas ref={canvas} className="absolute left-0 top-5 h-[calc(100%-1.25rem)] pointer-events-none" />
              {segs.map((s) => {
                const wide = (s.end - s.start) * perSec >= 26;
                return (
                  <div key={s.start} className={`absolute top-5 bottom-0 pointer-events-none border-l border-white/60 ${s.hidden ? 'bg-st-ink/60' : ''} ${current?.start === s.start ? 'ring-2 ring-inset ring-18-orange bg-18-orange/10' : ''}`} style={{ left: s.start * perSec, width: (s.end - s.start) * perSec }}>
                    {wide && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelected(s.start + 1e-6); change({ ...edits, overrides: [...edits.overrides, { start: s.start, end: s.end, hide: !s.hidden }] }); }}
                        aria-label={s.hidden ? `Keep ${clock(s.start)} to ${clock(s.end)}` : `Remove ${clock(s.start)} to ${clock(s.end)}`}
                        title={s.hidden ? 'Removed: click to keep' : 'Kept: click to remove'}
                        className="pointer-events-auto absolute left-1/2 top-1.5 -translate-x-1/2 grid h-6 w-6 place-items-center rounded-full bg-white/95 text-st-ink shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange"
                      >
                        {s.hidden ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                      </button>
                    )}
                  </div>
                );
              })}
              {open.map((f) => (
                <button
                  key={`${f.start}-${f.end}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); playFlag(f); }}
                  title={`${KIND_LABEL[f.kind]}${f.text ? `: "${f.text}"` : ''}. ${f.why}. Click to hear it.`}
                  aria-label={`${KIND_LABEL[f.kind]} at ${clock(f.start)}. Play it.`}
                  className="absolute top-5 bottom-0 overflow-hidden border-x-2 border-red-600 bg-red-500/35 text-left text-[10px] font-semibold leading-tight text-red-900 hover:bg-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                  style={{ left: f.start * perSec, width: Math.max(3, (f.end - f.start) * perSec) }}
                >
                  {(f.end - f.start) * perSec > 44 && <span className="block truncate px-1 pt-1">{KIND_LABEL[f.kind]}</span>}
                </button>
              ))}
              {drag && (() => {
                const was = drag.cut[drag.edge];
                const a = Math.min(was, drag.t), b = Math.max(was, drag.t);
                const grow = drag.edge === 'end' ? drag.t > was : drag.t < was;
                return (
                  <>
                    {/* What the drag changes: darker when more is removed, light when a bit is given back. */}
                    <div className={`absolute top-5 bottom-0 pointer-events-none ${grow ? 'bg-st-ink/60' : 'bg-white/70'} outline-dashed outline-1 outline-18-orange`} style={{ left: a * perSec, width: (b - a) * perSec }} />
                    <div className="absolute top-5 bottom-0 w-0.5 bg-18-orange pointer-events-none" style={{ left: drag.t * perSec - 1 }} />
                    <span className="absolute top-0.5 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-st-ink px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white pointer-events-none" style={{ left: drag.t * perSec }}>
                      {clock(drag.t)} · {grow ? '+' : '−'}{(b - a).toFixed(2)} s
                    </span>
                  </>
                );
              })()}
              {cuts.flatMap((c) => (['start', 'end'] as const).map((edge) => (
                <div
                  key={`${edge}-${c.start}-${c.end}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${edge === 'start' ? 'Start' : 'End'} of the removed part ${clock(c.start)} to ${clock(c.end)}. Drag to change it.`}
                  title="Drag to make the removed part longer or shorter"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag({ cut: c, edge, t: c[edge] });
                  }}
                  onPointerMove={(e) => { if (drag && drag.cut === c && drag.edge === edge) setDrag({ ...drag, t: dragAt(e.clientX, c, edge) }); }}
                  onPointerUp={() => { if (drag && drag.cut === c && drag.edge === edge) { resizeCut(c, edge, drag.t); setDrag(null); } }}
                  onPointerCancel={() => setDrag(null)}
                  className="group absolute top-5 bottom-0 z-[5] w-3 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: c[edge] * perSec }}
                >
                  <span className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full transition-colors ${drag?.cut === c && drag.edge === edge ? 'bg-18-orange opacity-0' : 'bg-white/80 group-hover:bg-18-orange'}`} />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-2 rounded-sm border border-st-line bg-white shadow-sm opacity-0 group-hover:opacity-100" />
                </div>
              )))}
              <div ref={head} className="absolute top-0 bottom-0 w-0.5 bg-sky-600 pointer-events-none" style={{ left: 0 }} />
            </div>
          ) : (
            <div className="grid h-36 place-items-center text-sm text-st-mute">The waveform appears here</div>
          )}
        </div>
        <p className="text-xs text-st-mute mt-2">Dark parts are removed from the preview. Click the waveform to select a part and jump there, then press Remove or Keep. Cut splits a part at the blue line. Drag either end of a dark part to make it longer or shorter. Red boxes are unwanted parts found for you: click one to hear it. Shortcuts: Space plays or pauses, the left and right arrows jump to the previous or next kept clip, and Alt + scroll zooms the timeline. Your video stays on your computer.</p>
      </section>

      {dlg !== 'closed' && (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === 'Escape' && dlg !== 'running' && setDlg('closed')}>
          <div role="dialog" aria-modal="true" aria-labelledby="export-title" className={`${card} w-full max-w-md p-6 shadow-xl`}>
            <h2 id="export-title" className="text-lg font-semibold">
              {dlg === 'confirm' ? 'Export edited video' : dlg === 'running' ? 'Exporting…' : dlg === 'done' ? 'Export finished' : 'Export did not finish'}
            </h2>

            {dlg === 'confirm' && (
              <>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-st-mute">{rec.range ? 'Chosen part' : 'Original length'}</dt><dd className="text-right tabular-nums">{span(total)}</dd>
                  <dt className="text-st-mute">Removed</dt><dd className="text-right tabular-nums">{span(removed)}</dd>
                  <dt className="text-st-mute">Final length</dt><dd className="text-right tabular-nums font-medium">{span(total - removed)}</dd>
                  <dt className="text-st-mute">Estimated time</dt><dd className="text-right tabular-nums font-medium">about {span(total - removed + 3)}</dd>
                  <dt className="text-st-mute">File</dt><dd className="text-right">{base()}-edited.{recorderExt()}</dd>
                </dl>
                <p className="mt-4 text-sm text-st-mute">The edited video is recorded as it plays, so the export takes as long as the final video. Keep this tab open and in front. The file is saved to your Downloads when it finishes.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setDlg('closed')} className={`${btnGhost} !min-h-[38px] !px-3`}>Cancel</button>
                  <button onClick={exportVideo} autoFocus className={`${btn} !py-2 !min-h-[38px] !px-3`}><Film size={14} aria-hidden /> Start export</button>
                </div>
              </>
            )}

            {dlg === 'running' && exp && (
              <>
                <div className="mt-5 flex items-baseline justify-between text-sm">
                  <span className="text-2xl font-semibold tabular-nums">{exp.pct}%</span>
                  <span className="text-st-mute tabular-nums">about {span(exp.left)} left</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-st-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exp.pct} aria-label="Export progress">
                  <div className="h-full rounded-full bg-18-orange transition-[width] duration-300" style={{ width: `${exp.pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-st-mute tabular-nums">Elapsed {span(exp.elapsed)} · final length {span(total - removed)}</p>
                <p className="mt-4 text-sm text-st-mute">Keep this tab open and in front until it reaches 100%. Do not press Space or pause the video.</p>
                <div className="mt-5 flex justify-end">
                  <button onClick={() => (stopExport.current = true)} className={`${btnGhost} !min-h-[38px] !px-3`}>Stop export</button>
                </div>
              </>
            )}

            {dlg === 'done' && result && (
              <>
                <p className="mt-3 text-sm">Saved to your Downloads: <b>{result.name}</b> ({(result.blob.size / 1048576).toFixed(1)} MB).</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => save(result.name, result.blob)} className={`${btnGhost} !min-h-[38px] !px-3`}><Download size={14} aria-hidden /> Download again</button>
                  <button onClick={() => setDlg('closed')} autoFocus className={`${btn} !py-2 !min-h-[38px] !px-3`}>Close</button>
                </div>
              </>
            )}

            {dlg === 'failed' && (
              <>
                <p className="mt-3 text-sm text-red-700">{why}</p>
                <p className="mt-1 text-sm text-st-mute">Nothing was saved.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setDlg('closed')} className={`${btnGhost} !min-h-[38px] !px-3`}>Close</button>
                  <button onClick={() => setDlg('confirm')} autoFocus className={`${btn} !py-2 !min-h-[38px] !px-3`}>Try again</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
