'use client';

// Silence remover: pick a video, press Start, tune three sliders, and the quiet parts are
// marked on the waveform. The preview plays the edited version live: hidden parts are skipped.
// Click a part to select it, then Remove (closed eye) or Keep (open eye) it, or Cut at the playhead.
// Everything runs in the browser; the video is never uploaded.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, Eye, EyeOff, Film, FolderOpen, Save, Scissors, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { putProject, saveVideo, type Rec } from '@/lib/studio/silence-projects';
import { flattenMp4 } from '@/lib/studio/mp4-flatten';
import { streamLevels } from '@/lib/studio/audio-levels';

// Files read whole (not MP4 or MOV) must stay under this, or the browser runs out of memory.
const WHOLE_FILE_LIMIT = 400 * 1048576;
import { clock, cutSpans, editedTime, findSilences, hopTarget, keepSpans, levels, parseProject, segments, type Override, type Project, type Span } from '@/lib/studio/silence';
import { btn, btnGhost, card, ErrorNote, Spinner } from '../ui';

// MP4 (H.264 and AAC) when this browser can record it, otherwise WebM.
const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const recorderMime = () => (typeof MediaRecorder === 'undefined' ? undefined : MIMES.find((m) => MediaRecorder.isTypeSupported(m)));
const recorderExt = () => (recorderMime()?.startsWith('video/mp4') ? 'mp4' : 'webm');

// Jumps over a removed part. Never while a jump is still running: setting the time again restarts the
// seek, and a video that is asked again every frame never gets anywhere.
function hop(v: HTMLVideoElement, cuts: Span[]) {
  if (v.seeking) return;
  const to = hopTarget(cuts, v.currentTime);
  if (to != null) v.currentTime = to;
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
export function Editor({ actions, rec, blob, onBack }: { actions: HTMLElement | null; rec: Rec; blob: Blob | null; onBack: () => void }) {
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
  const [exp, setExp] = useState<{ pct: number; elapsed: number; left: number } | null>(null); // export progress
  const [dlg, setDlg] = useState<'closed' | 'confirm' | 'running' | 'done' | 'failed'>('closed');
  const [why, setWhy] = useState('');
  const [result, setResult] = useState<{ name: string; blob: Blob } | null>(null);
  const stopExport = useRef(false);
  const dlgOpen = useRef(false);
  dlgOpen.current = dlg !== 'closed';
  const pending = useRef<Project | null>(null); // a project waiting for its video
  const [viewW, setViewW] = useState(800);
  const video = useRef<HTMLVideoElement>(null);
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
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
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

  function saveProject() {
    if (!file) return;
    const p: Project = { v: 1, video: { name: file.name, size: file.size }, threshold, minSilence, buffer, splits: edits.splits, overrides: edits.overrides };
    save(`${base()}.silence.json`, new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
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
      if (Math.abs(v.currentTime - keep[0].start) > 0.01) await new Promise<void>((r) => { v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = keep[0].start; });
      stream = v.captureStream!();
      // High bitrate, so the recording keeps as much of the picture as a re-encode can: 1.5 times the
      // original file's, and never below 8 Mbps.
      const bits = Math.min(40e6, Math.max(8e6, file ? ((file.size * 8) / Math.max(1, total)) * 1.5 : 0));
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
          const t = v.currentTime;
          hop(v, cuts);
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
    v.currentTime = 0;
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
    save(name, blob);
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
      setVol(await streamLevels(f, (x) => { const pct = Math.floor(x * 100); if (pct !== shown) setListened((shown = pct)); }));
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
          setVol(levels(mono, audio.sampleRate));
        } catch {
          setError('Could not read the sound of this video. It may have no audio, or a format this browser cannot read.');
        }
      }
    }
    setBusy(false);
  }

  const total = vol ? vol.length * 0.02 : duration;
  const silences = useMemo(() => (vol ? findSilences(vol, threshold, minSilence, buffer) : []), [vol, threshold, minSilence, buffer]);
  const segs = useMemo(() => (vol ? segments(silences, edits.splits, edits.overrides, total) : []), [vol, silences, edits, total]);
  const cuts = useMemo(() => cutSpans(segs), [segs]);
  const removed = cuts.reduce((n, c) => n + c.end - c.start, 0);
  const current = selected == null ? null : segs.find((s) => selected >= s.start && selected < s.end) ?? null;

  // Saves the project: a second after every change, and again when leaving the editor.
  const persist = () => {
    if (!file || !vol) return;
    putProject({ id: rec.id, name: rec.name, fileName: file.name, size: file.size, total: vol.length * 0.02, removed, threshold, minSilence, buffer, splits: edits.splits, overrides: edits.overrides, vol: Uint8Array.from(vol, (x) => Math.round(x)), hasVideo: meta.current.hasVideo, updatedAt: Date.now() }).then(() => setAutosaved(true), () => {});
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (!file || !vol) return;
    const id = setTimeout(() => persistRef.current(), 1000);
    return () => clearTimeout(id);
  }, [file, vol, threshold, minSilence, buffer, edits]);
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
  function cutHere() {
    const t = video.current?.currentTime ?? 0;
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
        const t = v.currentTime;
        if (head.current) head.current.style.left = `${t * perSec}px`;
        if (clockText.current) clockText.current.textContent = `${clock(editedTime(t, cuts))} / ${clock(total - removed)}`;
        const el = scroller.current;
        if (el && !v.paused && (t * perSec < el.scrollLeft || t * perSec > el.scrollLeft + el.clientWidth)) el.scrollLeft = t * perSec - 40;
        if (edited && !v.paused) hop(v, cuts);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cuts, edited, total, removed, perSec]);

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const t = Math.max(0, Math.min(total, (e.clientX - e.currentTarget.getBoundingClientRect().left) / perSec));
    setSelected(t);
    if (video.current) video.current.currentTime = t;
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
      const t = v.currentTime;
      const to = e.key === 'ArrowRight' ? kept.find((s) => s.start > t + 0.05) : [...kept].reverse().find((s) => s.start < t - 0.3);
      if (!to) return;
      v.currentTime = to.start;
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

  function download() {
    const text = ['Parts to keep (start, end in seconds)', ...keepSpans(cuts, total).map((k) => `${k.start.toFixed(2)}, ${k.end.toFixed(2)}`), '', 'Parts removed', ...cuts.map((s) => `${s.start.toFixed(2)}, ${s.end.toFixed(2)}`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `${(file?.name ?? 'video').replace(/\.[^.]+$/, '')}-cut-list.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const step = STEPS.find((s) => s * perSec >= 70) ?? STEPS[STEPS.length - 1];
  const ticks = total && Number.isFinite(total) ? Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step) : [];
  const tool = (_disabled: boolean) => `${btnGhost} !px-3`;

  return (
    <div ref={root} className="space-y-4">
      <ErrorNote text={error} />
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <section className={`${card} p-5 space-y-5`} aria-label="Settings">
          <h2 className="font-semibold">Settings</h2>
          {file && <p className="text-xs text-st-mute truncate">{file.name}</p>}
          <Slider label="Threshold" value={threshold} min={1} max={60} step={1} unit="%" onChange={setThreshold} />
          <Slider label="Minimum Silence" value={minSilence} min={0.1} max={3} step={0.1} unit="s" onChange={(n) => setMinSilence(Math.round(n * 10) / 10)} />
          <Slider label="Increase Buffer" value={buffer} min={0} max={0.5} step={0.05} unit="s" onChange={(n) => setBuffer(Math.round(n * 100) / 100)} />
          <p className="truncate text-xs text-st-mute" title="Threshold: anything quieter than this counts as silence. Minimum Silence: a pause must last this long. Buffer: a little sound kept on both sides so words are not clipped.">Below Threshold for Minimum Silence = cut.</p>
        </section>

        <div className="space-y-3">
          {actions && createPortal(<>
            <button onClick={() => { persistRef.current(); onBack(); }} className={`${btnGhost} !min-h-[36px] !px-3`}><ArrowLeft size={14} aria-hidden /> Projects</button>
            <label className={`${btnGhost} !min-h-[36px] !px-3 cursor-pointer`}>
              <Upload size={14} aria-hidden /> {file ? 'Change video' : 'Choose video'}
              <input type="file" accept="video/*,audio/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <button onClick={() => start()} disabled={!file || busy} className={`${btn} !min-h-[36px] !px-3`}>
              {busy ? <Spinner /> : <Scissors size={14} aria-hidden />} {busy ? `Listening… ${listened}%` : vol ? 'Restart' : 'Start'}
            </button>
            <label className={`${btnGhost} !min-h-[36px] !px-3 cursor-pointer`}>
              <FolderOpen size={14} aria-hidden /> Open project
              <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { openProject(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button onClick={saveProject} disabled={!file} className={`${btnGhost} !min-h-[36px] !px-3`}><Save size={14} aria-hidden /> Save project</button>
            <button onClick={openExport} disabled={!vol || exp !== null} className={`${btn} !min-h-[36px] !px-3 !bg-st-ink hover:!bg-black`}>
              {exp === null ? <Film size={14} aria-hidden /> : <Spinner />} {exp === null ? 'Export' : `Exporting ${exp.pct}%`}
            </button>
          </>, actions)}
          {notice && <p role="status" className="text-sm text-st-mute text-right">{notice}</p>}
        <section className={`${card} p-4`}>
          {url ? (
            <video ref={video} src={url} controls onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} className="w-full max-h-[50vh] rounded-lg bg-black" />
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
        </div>
      </div>

      <section className={`${card} p-4`} aria-label="Timeline">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={undo} disabled={!history.length} className={tool(!history.length)} aria-label="Undo" title="Undo"><Undo2 size={15} aria-hidden /></button>
          <button onClick={cutHere} disabled={!vol} className={tool(!vol)} title="Cut the video into two parts at the playhead"><Scissors size={15} aria-hidden /> Cut</button>
          <button onClick={() => choose(true)} disabled={!current || current.hidden} className={tool(!current)} title="Remove the selected part from the preview (closed eye)"><EyeOff size={15} aria-hidden /> Remove</button>
          <button onClick={() => choose(false)} disabled={!current || !current.hidden} className={tool(!current)} title="Keep the selected part in the preview (open eye)"><Eye size={15} aria-hidden /> Keep</button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => zoomBy(1 / 1.5)} disabled={!vol || zoom <= 1} className={tool(!vol)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={15} aria-hidden /></button>
            <input type="range" min={1} max={maxZoom} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} onPointerUp={(e) => e.currentTarget.blur()} disabled={!vol} aria-label="Zoom" className="w-28 accent-[#F37335]" />
            <button onClick={() => zoomBy(1.5)} disabled={!vol || zoom >= maxZoom} className={tool(!vol)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={15} aria-hidden /></button>
            <button onClick={download} disabled={!vol} className={btnGhost}><Download size={15} aria-hidden /> Cut list</button>
          </div>
        </div>
        <p className="text-sm mb-2" aria-live="polite">
          {vol ? (
            <><b>{cuts.length}</b> {cuts.length === 1 ? "part" : "parts"} removed · <b>{clock(removed)}</b> gone · {clock(total)} becomes <b>{clock(Math.max(0, total - removed))}</b>{current && <span className="text-st-mute"> · selected part: {clock(current.start)} to {clock(current.end)}, {current.hidden ? 'removed' : 'kept'}</span>}{autosaved && <span className="text-st-mute"> · auto-saved</span>}</>
          ) : (
            <span className="text-st-mute">Press Start to find the silent parts.</span>
          )}
        </p>
        <div ref={scroller} className="overflow-x-auto rounded-lg bg-st-surface">
          {vol ? (
            <div className="relative h-36 cursor-pointer select-none" style={{ width: innerW }} onClick={seek}>
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
              <div ref={head} className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none" style={{ left: 0 }} />
            </div>
          ) : (
            <div className="grid h-36 place-items-center text-sm text-st-mute">The waveform appears here</div>
          )}
        </div>
        <p className="text-xs text-st-mute mt-2">Dark parts are removed from the preview. Click the waveform to select a part and jump there, then press Remove or Keep. Cut splits a part at the red line. Shortcuts: Space plays or pauses, the left and right arrows jump to the previous or next kept clip, and Alt + scroll zooms the timeline. Your video stays on your computer.</p>
      </section>

      {dlg !== 'closed' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === 'Escape' && dlg !== 'running' && setDlg('closed')}>
          <div role="dialog" aria-modal="true" aria-labelledby="export-title" className={`${card} w-full max-w-md p-6 shadow-xl`}>
            <h2 id="export-title" className="text-lg font-semibold">
              {dlg === 'confirm' ? 'Export edited video' : dlg === 'running' ? 'Exporting…' : dlg === 'done' ? 'Export finished' : 'Export did not finish'}
            </h2>

            {dlg === 'confirm' && (
              <>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-st-mute">Original length</dt><dd className="text-right tabular-nums">{span(total)}</dd>
                  <dt className="text-st-mute">Removed</dt><dd className="text-right tabular-nums">{span(removed)}</dd>
                  <dt className="text-st-mute">Final length</dt><dd className="text-right tabular-nums font-medium">{span(total - removed)}</dd>
                  <dt className="text-st-mute">Estimated time</dt><dd className="text-right tabular-nums font-medium">about {span(total - removed + 3)}</dd>
                  <dt className="text-st-mute">File</dt><dd className="text-right">{base()}-edited.{recorderExt()}</dd>
                </dl>
                <p className="mt-4 text-sm text-st-mute">The edited video is recorded as it plays, so the export takes as long as the final video. Keep this tab open and in front. The file is saved to your Downloads when it finishes.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setDlg('closed')} className={btnGhost}>Cancel</button>
                  <button onClick={exportVideo} autoFocus className={btn}><Film size={15} aria-hidden /> Start export</button>
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
                  <button onClick={() => (stopExport.current = true)} className={btnGhost}>Stop export</button>
                </div>
              </>
            )}

            {dlg === 'done' && result && (
              <>
                <p className="mt-3 text-sm">Saved to your Downloads: <b>{result.name}</b> ({(result.blob.size / 1048576).toFixed(1)} MB).</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => save(result.name, result.blob)} className={btnGhost}><Download size={15} aria-hidden /> Download again</button>
                  <button onClick={() => setDlg('closed')} autoFocus className={btn}>Close</button>
                </div>
              </>
            )}

            {dlg === 'failed' && (
              <>
                <p className="mt-3 text-sm text-red-700">{why}</p>
                <p className="mt-1 text-sm text-st-mute">Nothing was saved.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setDlg('closed')} className={btnGhost}>Close</button>
                  <button onClick={() => setDlg('confirm')} autoFocus className={btn}>Try again</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
