'use client';

// Video Editor: the front end for the editing set-up in D:\Editing.
//
// The editing itself is not done here. A small local server on the editing PC
// (D:\Editing\editor-bridge\server.mjs) runs Claude Code in D:\Editing with the same
// CLAUDE.md and skills as editing in chat (long-form-whiteboard-animation first,
// plus telugu-captions, resolve-handoff and the remotion-* skills).
//
// Layout (an editor-style screen):
//   Media files | Preview player            | Volume meter (dB, full height)
//   AI features bar                         |
//   Timeline: V1 footage, V2 graphics, CC captions, A1 audio, each with eye / lock (/ mute)
// The timeline is read from the props that drive the Remotion render (work/edit.json or
// work/promo.json), so it shows the real edit: cuts, whiteboards, cards, captions, SFX.
// It only works in a browser on that PC: the bridge listens on 127.0.0.1 only.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Clock, Keyboard, Download, LayoutGrid, PenLine, Wand2, Eye, EyeOff, ExternalLink, FileText, Film, FolderPlus, Image as ImageIcon, Lock, LogIn, Maximize2,
  MessageSquare, MessageSquarePlus, Minus, Music, Play, Plug, Plus, RefreshCw, Scissors, Send, Sparkles, Square, Unlock, Upload, Volume2, VolumeX, X,
} from 'lucide-react';
import { btn, btnGhost, card, ErrorNote, field, label, Spinner, useConfirm } from '../ui';
import type { SilenceFileKind } from './silence';
import SilenceHome, { type SilenceLink } from './silence-home';

const BRIDGE = 'http://127.0.0.1:4317';
const TOKEN_KEY = 'studio-editor-token';

type Step = { key: string; label: string; done: boolean };
type FileInfo = { name: string; path: string; size: number; modified: number; kind: 'video' | 'image' | 'audio' | 'text' | 'other' };
type TextFile = { name: string; path: string; modified: number };
type Project = { id: string; name: string; group: string | null; updated: number };
type Detail = {
  id: string; name: string; dir: string; steps: Step[]; raw: FileInfo[]; out: FileInfo[]; workImages: FileInfo[]; workText: TextFile[];
  brief: string | null; plan: string | null; session: string | null; running: boolean; busyElsewhere: string | null;
};
type Ev = { at: number; kind: 'user' | 'assistant' | 'tool' | 'done' | 'error' | 'note' | 'state'; text?: string; name?: string; ok?: boolean; cost?: number | null; seconds?: number; running?: boolean };
type Conn = 'checking' | 'offline' | 'token' | 'ok';

// ---------- bridge client ----------
function useBridge() {
  const [token, setTokenState] = useState('');
  const [conn, setConn] = useState<Conn>('checking');
  const [error, setError] = useState('');

  const check = useCallback(async (t: string) => {
    setConn('checking');
    try {
      await fetch(`${BRIDGE}/api/ping`).then((r) => { if (!r.ok) throw new Error(); });
    } catch {
      return setConn('offline');
    }
    if (!t) return setConn('token');
    const r = await fetch(`${BRIDGE}/api/health`, { headers: { 'X-Editor-Token': t } }).catch(() => null);
    if (r?.ok) { setError(''); setConn('ok'); } else { setError(r?.status === 401 ? 'That token does not match. Copy it again from the bridge window.' : ''); setConn('token'); }
  }, []);

  useEffect(() => {
    let t = '';
    try { t = localStorage.getItem(TOKEN_KEY) ?? ''; } catch {}
    setTokenState(t);
    check(t);
  }, [check]);

  const setToken = (t: string) => {
    try { localStorage.setItem(TOKEN_KEY, t); } catch {}
    setTokenState(t);
    check(t);
  };

  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${BRIDGE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Editor-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => { throw new Error('The editor on this PC is not reachable. Is the bridge window still open?'); });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `The editor answered ${r.status}.`);
    return data as T;
  }, [token]);

  const fileUrl = useCallback((id: string, path: string, download = false) =>
    `${BRIDGE}/api/p/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}&t=${encodeURIComponent(token)}${download ? '&download=1' : ''}`, [token]);

  return { token, conn, error, check: () => check(token), setToken, call, fileUrl };
}
type Bridge = ReturnType<typeof useBridge>;

// ---------- page ----------
export default function VideoEditor() {
  const bridge = useBridge();
  if (bridge.conn === 'checking') return <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Looking for the editor on this PC…</p>;
  if (bridge.conn === 'offline') return <Offline onRetry={bridge.check} />;
  if (bridge.conn === 'token') return <TokenForm error={bridge.error} onSave={bridge.setToken} />;
  return <Editor bridge={bridge} />;
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={`${card} p-6 max-w-2xl`}>
      <div className="flex items-center gap-2"><Plug size={18} className="text-18-orange" aria-hidden /><h2 className="font-semibold">Start the editor on your PC</h2></div>
      <p className="text-sm text-st-mute mt-2 leading-relaxed">
        The Video Editor drives the editing set-up in <code className="text-st-ink">D:\Editing</code> (Remotion, FFmpeg, Whisper and your editing skills). It needs the small editor bridge running on that PC, and this page open in a browser on the same PC.
      </p>
      <ol className="mt-4 space-y-2 text-sm text-st-ink list-decimal pl-5">
        <li>Double-click <code>D:\Editing\editor-bridge\start.cmd</code>, or run <code className="bg-st-surface px-1.5 py-0.5 rounded">node D:\Editing\editor-bridge\server.mjs</code>.</li>
        <li>Keep that window open while you edit.</li>
      </ol>
      <button onClick={onRetry} className={`${btn} mt-5`}><RefreshCw size={15} aria-hidden /> Try again</button>
    </section>
  );
}

function TokenForm({ error, onSave }: { error: string; onSave: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (t.trim()) onSave(t.trim()); }} className={`${card} p-6 max-w-xl space-y-3`}>
      <h2 className="font-semibold">Connect to the editor</h2>
      <p className="text-sm text-st-mute leading-relaxed">The editor is running. Paste its token once: it is shown in the bridge window, and saved in <code className="text-st-ink">D:\Editing\editor-bridge\token.txt</code>. This browser remembers it.</p>
      <div>
        <label className={label} htmlFor="editor-token">Editor token</label>
        <input id="editor-token" value={t} onChange={(e) => setT(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
      </div>
      <ErrorNote text={error} />
      <button className={btn} disabled={!t.trim()}>Connect</button>
    </form>
  );
}

// ---------- editor frame: toolbar + workspace ----------
function Editor({ bridge }: { bridge: Bridge }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await bridge.call<{ projects: Project[]; busy: string | null }>('/api/projects');
      setProjects(r.projects);
      setBusy(r.busy);
      // Keep the open video; else the one this browser had open last; else the newest. A video that
      // no longer exists falls back the same way.
      const has = (x: string | null | undefined) => !!x && r.projects.some((p) => p.id === x);
      setSelected((s) => {
        if (has(s)) return s;
        let last = '';
        try { last = localStorage.getItem('studio-editor-project') ?? ''; } catch {}
        return has(last) ? last : r.projects[0]?.id ?? '';
      });
    } catch (e) { setError((e as Error).message); }
  }, [bridge]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected) try { localStorage.setItem('studio-editor-project', selected); } catch {} }, [selected]);

  return (
    <div className="space-y-3">
      <Account bridge={bridge} />
      <ErrorNote text={error} />
      {selected && projects.some((p) => p.id === selected)
        ? <Workspace key={selected} id={selected} bridge={bridge} projects={projects} busy={busy} onSelect={setSelected} onChanged={load} />
        : !error && <NewProject projects={projects} bridge={bridge} onCreated={(id) => { load(); setSelected(id); }} open />}
    </div>
  );
}

function ProjectPicker({ projects, selected, busy, onSelect }: { projects: Project[]; selected: string; busy: string | null; onSelect: (id: string) => void }) {
  const loose = projects.filter((p) => !p.group);
  const groups = Array.from(new Set(projects.map((p) => p.group).filter(Boolean))) as string[];
  return (
    <select value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="Video"
      className="bg-white border border-st-line rounded-lg px-3 py-2 min-h-[38px] text-sm font-medium text-st-ink max-w-[16rem] focus:outline-none focus:border-18-orange">
      {loose.map((p) => <option key={p.id} value={p.id}>{p.name}{busy === p.id ? ' • editing' : ''}</option>)}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {projects.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.name}{busy === p.id ? ' • editing' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function NewProject({ projects, bridge, onCreated, open: startOpen = false }: { projects: Project[]; bridge: Bridge; onCreated: (id: string) => void; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [error, setError] = useState('');
  const groups = useMemo(() => Array.from(new Set(projects.map((p) => p.group).filter(Boolean))) as string[], [projects]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { id } = await bridge.call<{ id: string }>('/api/projects', { name: name.trim(), group: group || undefined });
      setOpen(startOpen); setName(''); setGroup('');
      onCreated(id);
    } catch (err) { setError((err as Error).message); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className={btnGhost} title="New video project"><FolderPlus size={15} aria-hidden /> New video</button>;
  return (
    <form onSubmit={create} className={`${card} p-3 flex flex-wrap items-center gap-2`}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Video name" className={`${field} !w-56`} aria-label="Video name" />
      {groups.length > 0 && (
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${field} !w-56`} aria-label="Folder">
          <option value="">No folder</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      )}
      <button disabled={!name.trim()} className={btn}>Create</button>
      {!startOpen && <button type="button" onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>}
      <div className="w-full"><ErrorNote text={error} /></div>
    </form>
  );
}

// ---------- one project: the editor screen ----------
type View = { kind: 'video' | 'image' | 'audio'; path: string; name: string; play?: boolean } | { kind: 'doc'; path: string; name: string; text?: string | null };

const KICKOFF = (id: string) =>
  `Edit this video. Project folder: projects/${id} (raw footage in raw/). Follow the long-form-whiteboard-animation skill from Part 1: look at what is already in the folder, then ask me the intake questions.`;

// The AI features bar. Each one asks the editor for a step of the skill's pipeline;
// the skill keeps its own approval gates (plan, storyboard, preview before any export).
const AI_FEATURES: { key: string; label: string; text: (id: string) => string }[] = [
  { key: 'cut', label: 'Remove pauses & fillers', text: () => 'Do the raw cut (Part 2 of the skill): transcribe, then remove pauses, fillers, false starts and retakes. Tell me what you cut before going further.' },
  { key: 'unwanted', label: 'Find unwanted parts', text: () => 'Find the unwanted parts of this video: go through the transcript and list retakes, mistakes, repeated lines, off-topic tangents and anything else that should go, each with its start and end time and the words spoken. Do not cut anything yet; wait for me to pick which ones to remove.' },
  { key: 'captions', label: 'Auto captions & .srt file', text: () => 'Make the captions as a real .srt file (the skill\'s caption order: the .srt first, then the before/after table and the spelling check) and save it in out/. If the video is in Telugu or Tenglish, use the telugu-captions skill and ask me for the script first.' },
];

// ---------- 1st draft ----------
// Create 1st draft -> brief (the intake questions) -> the AI editor runs the pipeline up to the
// storyboard and stops -> Storyboard unlocks and opens -> Approve -> the AI edits the 1st draft
// (the preview render) -> it opens in the player. Changes can be asked for at any point.
// Where it stands is kept in work/editor/state.json, so it survives a reload.
type FirstDraft = {
  stage: 'storyboard-working' | 'storyboard' | 'draft-working' | 'draft';
  startedAt: number; // when the current storyboard round was asked for
  draftStartedAt?: number; // when the current draft render was asked for
  draftPath?: string;
};

type Brief = Record<string, string>;
const BRIEF_QUESTIONS: { key: string; label: string; options: string[]; note?: string }[] = [
  { key: 'cleanup', label: 'Cleanup', options: ['Cut pauses, fillers and retakes', 'Already clean (only verify)'] },
  { key: 'grade', label: 'Colour grade', options: ['Already graded, leave it', '18s Canvas grade', 'my-style base', 'New look (show me a before/after)'] },
  { key: 'captions', label: 'Subtitles / captions', options: ['Yes, burned in + .srt', 'Only an .srt file', 'No captions'] },
  { key: 'format', label: 'Format', options: ['16:9 long-form', '9:16 Short', 'Both'] },
  { key: 'language', label: 'Language', options: ['English', 'Tenglish', 'Telugu'] },
  { key: 'style', label: 'Style', options: ['18startup brand, white elements, whiteboard scenes', 'my-style (Ankur Warikoo reference)', 'Other (say below)'] },
  { key: 'audio', label: 'Audio', options: ['Original voice, untouched', 'Voice at 1.1x speed', 'Add a music bed under the voice'] },
  { key: 'broll', label: 'B-roll', options: ['None', 'Sparse', 'Heavy'] },
  { key: 'fx', label: 'Transitions & SFX', options: ['Minimal', 'A few more', 'None'] },
];
const BRIEF_DEFAULT: Brief = Object.fromEntries(BRIEF_QUESTIONS.map((q) => [q.key, q.options[0]]));

function draftPrompt(id: string, b: Brief, savedBrief: boolean) {
  const lines = BRIEF_QUESTIONS.map((q) => `- ${q.label}: ${b[q.key]}`);
  if (b.length) lines.push(`- Target length: ${b.length}`);
  if (b.lowerThird) lines.push(`- Lower third (name, role): ${b.lowerThird}`);
  return [
    `Create the 1st draft of this video (projects/${id}), editing it the way we do in chat: follow D:\\Editing\\CLAUDE.md and the long-form-whiteboard-animation skill.`,
    '',
    `My intake answers${savedBrief ? ' (they replace what is in work/brief.md where they differ)' : ''}. Save them to work/brief.md and do not ask these again:`,
    ...lines,
    ...(b.script ? ['', 'Script (use it as the caption text):', b.script] : []),
    ...(b.notes ? ['', 'What I want in this video:', b.notes] : []),
    '',
    'For this 1st draft, the storyboard is my approval step: analyse the footage, convert HDR if needed, do the raw cut if the cleanup is not done, transcribe, write the graphics plan in work/plan.md, build work/edit.json, then make the storyboard sheets in out/ (the 5-second storyboard and the finished-frames sheet). Check the sheets yourself first. Do not wait for plan approval, and do not render the preview yet: stop after the storyboard and tell me it is ready. If something blocks you (a missing asset, a question only I can answer), ask in the chat and stop.',
  ].join('\n');
}
const APPROVE_PROMPT = (name: string) =>
  `The storyboard is approved. Now edit the 1st draft: render the preview as the skill says, run the QA checks (smoothness, length, audio), and save it in out/ as "${name} - 1st draft.mp4". Tell me when it is ready.`;
const changesPrompt = (stage: FirstDraft['stage'] | undefined, text: string) =>
  stage === 'storyboard' || stage === 'storyboard-working'
    ? `Changes to the storyboard:\n${text}\n\nMake these changes in the edit, then remake the storyboard sheets in out/ and stop for my approval again. Do not render the preview yet.`
    : stage === 'draft' || stage === 'draft-working'
      ? `Changes to the 1st draft:\n${text}\n\nMake these changes, then render the 1st draft again (same file name in out/) and run the QA checks. Tell me when it is ready.`
      : `Changes to this video:\n${text}`;

// Storyboard sheets: images in out/ (and work/) named like the skill's sheets.
const isSheet = (f: FileInfo) => f.kind === 'image' && /storyboard|scenes|finished|frames|transition|sheet/i.test(f.name);

function Workspace({ id, bridge, projects, busy, onSelect, onChanged }: { id: string; bridge: Bridge; projects: Project[]; busy: string | null; onSelect: (id: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<{ file: string | null; data: Record<string, unknown> | null } | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [firstDraft, setFirstDraft] = useState<FirstDraft | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  // Where the 1st draft stands, kept by the bridge in work/editor/state.json.
  useEffect(() => {
    bridge.call<{ firstDraft?: FirstDraft }>(`/api/p/state?id=${encodeURIComponent(id)}`).then((s) => setFirstDraft(s.firstDraft ?? null)).catch(() => {});
  }, [bridge, id]);
  const saveDraft = useCallback((fd: FirstDraft | null) => {
    setFirstDraft(fd);
    bridge.call(`/api/p/state?id=${encodeURIComponent(id)}`, { firstDraft: fd }).catch(() => {});
  }, [bridge, id]);

  const refresh = useCallback(async () => {
    try {
      const [detail, tl] = await Promise.all([
        bridge.call<Detail>(`/api/p/detail?id=${encodeURIComponent(id)}`),
        bridge.call<{ file: string | null; data: Record<string, unknown> | null }>(`/api/p/timeline?id=${encodeURIComponent(id)}`).catch(() => ({ file: null, data: null })),
      ]);
      setD(detail);
      setTimeline(tl);
    } catch (e) { setError((e as Error).message); }
  }, [bridge, id]);

  // Chat history, then live updates from the bridge.
  useEffect(() => {
    let live = true;
    bridge.call<{ events: Ev[]; running: boolean }>(`/api/p/chat?id=${encodeURIComponent(id)}`).then((r) => { if (live) { setEvents(r.events); setRunning(r.running); } }).catch((e) => setError(e.message));
    refresh();
    const es = new EventSource(`${BRIDGE}/api/p/stream?id=${encodeURIComponent(id)}&t=${encodeURIComponent(bridge.token)}`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Ev;
      if (ev.kind === 'state') {
        setRunning(!!ev.running);
        if (!ev.running) { refresh(); onChanged(); }
        return;
      }
      setEvents((list) => [...list, ev]);
      if (ev.kind === 'done') refresh();
    };
    return () => { live = false; es.close(); };
  }, [bridge, id, refresh, onChanged]);

  // While it works, files appear in out/ and the edit changes: keep everything fresh.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [running, refresh]);

  // The rendered video the timeline belongs to: the newest final, else the newest preview.
  const program = useMemo(() => {
    const vids = d?.out.filter((f) => f.kind === 'video') ?? [];
    return vids.find((f) => !/preview|phone/i.test(f.name)) ?? vids.find((f) => /preview/i.test(f.name)) ?? vids[0] ?? null;
  }, [d]);

  // Open something in the player on first load: the program video, else the first raw video.
  useEffect(() => {
    if (!d || view) return;
    const first = program ?? d.raw.find((f) => f.kind === 'video');
    if (first) setView({ kind: 'video', path: first.path, name: first.name });
  }, [d, view, program]);

  useEffect(() => { if (video) video.muted = muted; }, [video, muted]);

  // The video the Silence remover works on: the footage on the timeline (V1, the source the
  // edit is built from), else the video in the preview, else the first raw video.
  const timelineSource = useMemo(() => {
    const data = timeline?.data;
    const segs = Array.isArray(data?.segments) ? (data!.segments as unknown[]) : [];
    const first = segs.find(isObj);
    const src = first && typeof first.src === 'string' ? first.src : typeof data?.src === 'string' ? data.src : null;
    if (src) {
      const rel = src.replace(/\\/g, '/');
      const prefix = `projects/${id}/`;
      if (rel.startsWith(prefix)) { const p = rel.slice(prefix.length); return { path: p, name: p.split('/').pop() ?? p, from: 'timeline' as const }; }
    }
    if (view && view.kind === 'video') return { path: view.path, name: view.name, from: 'preview' as const };
    const raw = d?.raw.find((f) => f.kind === 'video');
    return raw ? { path: raw.path, name: raw.name, from: 'footage' as const } : null;
  }, [timeline, view, d, id]);

  // The player panel is exactly as wide as its frame (1920×1080 scaled to the row height),
  // so there is no empty space beside the video; the media panel takes the rest of the width.
  const vertical = timeline?.data?.format === '9:16';
  const gridRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLElement>(null);
  const [playerW, setPlayerW] = useState<number | null>(null);
  useEffect(() => {
    const g = gridRef.current, m = mediaRef.current;
    if (!g || !m) return;
    const [fw, fh] = vertical ? [9, 16] : [16, 9];
    const calc = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return setPlayerW(null);
      const frameH = m.clientHeight - 45; // the row height minus the player's 45 px header
      const want = Math.ceil((frameH * fw) / fh) + 2; // + the card's left/right border (round up: the frame fills the full height)
      const max = g.clientWidth - 240 - 64 - 24; // keep the media panel ≥ 240 px and the meter
      setPlayerW(Math.max(200, Math.min(want, max)));
    };
    const ro = new ResizeObserver(calc);
    ro.observe(g);
    ro.observe(m);
    calc();
    return () => ro.disconnect();
  }, [vertical, !!d]); // eslint-disable-line react-hooks/exhaustive-deps

  async function say(text: string) {
    setError('');
    setChatOpen(true);
    try { await bridge.call('/api/p/message?id=' + encodeURIComponent(id), { text }); setRunning(true); onChanged(); }
    catch (e) { setError((e as Error).message); }
  }
  const stop = () => bridge.call(`/api/p/stop?id=${encodeURIComponent(id)}`, {}).catch(() => {});

  // When the editor finishes a round, move the 1st draft on: new storyboard sheets -> open the
  // storyboard for approval; a new video in out/ -> the draft is ready, play it.
  useEffect(() => {
    if (running || !d || !firstDraft) return;
    if (firstDraft.stage === 'storyboard-working') {
      const fresh = [...d.out, ...d.workImages].filter((f) => isSheet(f) && f.modified >= firstDraft.startedAt - 2000);
      if (fresh.length) { saveDraft({ ...firstDraft, stage: 'storyboard' }); setBoardOpen(true); }
    } else if (firstDraft.stage === 'draft-working' && firstDraft.draftStartedAt) {
      const vid = d.out.filter((f) => f.kind === 'video' && f.modified >= firstDraft.draftStartedAt! - 2000).sort((a, b) => b.modified - a.modified)[0];
      if (vid) {
        saveDraft({ ...firstDraft, stage: 'draft', draftPath: vid.path });
        setView({ kind: 'video', path: vid.path, name: vid.name, play: true });
      }
    }
  }, [running, d, firstDraft, saveDraft]);

  function startDraft(b: Brief) {
    setBriefOpen(false);
    saveDraft({ stage: 'storyboard-working', startedAt: Date.now() });
    say(draftPrompt(id, b, !!d?.brief));
  }
  function approveStoryboard() {
    if (!firstDraft) return;
    setBoardOpen(false);
    saveDraft({ ...firstDraft, stage: 'draft-working', draftStartedAt: Date.now() });
    say(APPROVE_PROMPT(d?.name ?? id));
  }
  function sendChanges(text: string) {
    setChangesOpen(false);
    setBoardOpen(false);
    const st = firstDraft?.stage;
    if (st === 'storyboard' || st === 'storyboard-working') saveDraft({ ...firstDraft!, stage: 'storyboard-working', startedAt: Date.now() });
    else if (st === 'draft' || st === 'draft-working') saveDraft({ ...firstDraft!, stage: 'draft-working', draftStartedAt: Date.now() });
    say(changesPrompt(st, text));
  }

  if (!d) return error ? <ErrorNote text={error} /> : <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Opening…</p>;

  const onProgram = !!program && view?.kind === 'video' && view.path === program.path;
  const askAboutClip = (c: Clip) => {
    setDraft(`About the ${c.kind.toLowerCase()} at ${fmtTime(c.start)}–${fmtTime(c.end)}${c.text ? ` ("${c.text.slice(0, 80)}")` : ''}: `);
    setChatOpen(true);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <ProjectPicker projects={projects} selected={id} busy={busy} onSelect={onSelect} />
        <NewProject projects={projects} bridge={bridge} onCreated={(nid) => { onChanged(); onSelect(nid); }} />
        <ExportButton id={id} bridge={bridge} onDone={refresh}
          onPlay={(p) => setView({ kind: 'video', path: p, name: p.split('/').pop() || p, play: true })} />
        <div className="flex-1" />
        <button onClick={refresh} className={btnGhost} aria-label="Refresh files" title="Refresh"><RefreshCw size={15} aria-hidden /></button>
      </div>
      <ErrorNote text={error} />

      {/* Editor grid, as sketched: media | player | meter, then AI features, then the timeline. */}
      <div ref={gridRef} className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(240px,1fr)_auto_64px] lg:grid-rows-[minmax(300px,1fr)_auto_auto] lg:h-[calc(100vh-13.5rem)] lg:min-h-[640px]">
        <MediaPanel boxRef={mediaRef} d={d} bridge={bridge} view={view} onOpen={setView} onChanged={refresh} />
        <Viewer width={playerW} d={d} bridge={bridge} view={view} onVideo={setVideo} program={program} vertical={vertical}
          onProgram={() => program && setView({ kind: 'video', path: program.path, name: program.name })} />
        <div className="hidden lg:block lg:row-span-3 lg:col-start-3 lg:row-start-1"><Meter video={video} muted={muted} onMute={() => setMuted((m) => !m)} /></div>
        <AiBar running={running} busyElsewhere={d.busyElsewhere} draft={firstDraft} chatOpen={chatOpen} unread={!chatOpen && events.length > 0 && events[events.length - 1].kind === 'assistant'}
          onFeature={(f) => (f.key === 'cut' ? setSilenceOpen(true) : say(f.text(id)))} onDraft={() => setBriefOpen(true)} onStoryboard={() => setBoardOpen(true)}
          onChanges={() => setChangesOpen(true)} onChat={() => setChatOpen((o) => !o)} onStop={stop} />
        <Timeline data={timeline?.data ?? null} file={timeline?.file ?? null} video={onProgram ? video : null} player={video} programName={program?.name ?? null}
          onNeedProgram={() => program && setView({ kind: 'video', path: program.path, name: program.name })} muted={muted} onMute={() => setMuted((m) => !m)} onAsk={askAboutClip} />
      </div>

      {briefOpen && <BriefDialog name={d.name} savedBrief={!!d.brief} onClose={() => setBriefOpen(false)} onStart={startDraft} />}
      {boardOpen && <StoryboardDialog d={d} bridge={bridge} draft={firstDraft} running={running} onClose={() => setBoardOpen(false)}
        onApprove={approveStoryboard} onChanges={() => setChangesOpen(true)} />}
      {changesOpen && <ChangesDialog stage={firstDraft?.stage} at={video && view?.kind === 'video' ? video.currentTime : null} atName={view?.name ?? ''}
        onClose={() => setChangesOpen(false)} onSend={sendChanges} />}

      {silenceOpen && <SilencePopup d={d} bridge={bridge} source={timelineSource} onClose={() => setSilenceOpen(false)} onSaved={refresh}
        onUse={(text) => { setSilenceOpen(false); say(text); }} onOpenFile={(f) => setView({ kind: 'video', path: f, name: f.split('/').pop() ?? f, play: true })} />}

      {chatOpen && <Chat events={events} running={running} busyElsewhere={d.busyElsewhere} error={error} onSay={say} bridge={bridge} id={id} draft={draft} onDraftUsed={() => setDraft('')} onClose={() => setChatOpen(false)} onStop={stop} />}
    </div>
  );
}

// ---------- Silence remover, in a popup, linked to this edit ----------
// "Remove pauses & fillers" opens the whole Silence remover here. It works on this edit's own
// videos (read through the bridge), and what it exports is saved back into the edit:
// the edited video into raw/, the cut list and project file into work/. Then one click
// tells the AI editor to use the new cut.
type Saved = { kind: SilenceFileKind; path: string; state: 'saving' | 'saved' | 'failed'; error?: string };
function SilencePopup({ d, bridge, source, onClose, onSaved, onUse, onOpenFile }: {
  d: Detail; bridge: Bridge; source: { path: string; name: string; from: 'timeline' | 'preview' | 'footage' } | null;
  onClose: () => void; onSaved: () => void; onUse: (text: string) => void; onOpenFile: (path: string) => void;
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  // The video is fixed for as long as the popup is open.
  const [src] = useState(source);

  const link = useMemo<SilenceLink>(() => ({
    editorId: d.id,
    source: src ? { path: src.path, name: src.name } : undefined,
    onClose,
    files: [...d.raw, ...d.out].filter((f) => f.kind === 'video' || f.kind === 'audio').map((f) => ({ path: f.path, name: f.name, size: f.size })),
    // Streams the file from D:\Editing with progress (large raw files can be over a gigabyte).
    load: async (path, onPct) => {
      const r = await fetch(bridge.fileUrl(d.id, path));
      if (!r.ok || !r.body) throw new Error(`the editor answered ${r.status}`);
      const total = Number(r.headers.get('Content-Length')) || 0;
      const reader = r.body.getReader();
      const parts: BlobPart[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) onPct(Math.round((got / total) * 100));
      }
      return new Blob(parts, { type: r.headers.get('Content-Type') || 'video/mp4' });
    },
    onFile: (name, blob, kind) => {
      const sub = kind === 'video' ? 'raw' : 'work';
      const path = `${sub}/${name}`;
      setSaved((s) => [...s.filter((x) => x.path !== path), { kind, path, state: 'saving' }]);
      fetch(`${BRIDGE}/api/p/upload?id=${encodeURIComponent(d.id)}&dir=${sub}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-Editor-Token': bridge.token }, body: blob })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`); })
        .then(() => { setSaved((s) => s.map((x) => (x.path === path ? { ...x, state: 'saved' } : x))); onSaved(); })
        .catch((e) => setSaved((s) => s.map((x) => (x.path === path ? { ...x, state: 'failed', error: (e as Error).message } : x))));
    },
  }), [d.id, d.raw, d.out, bridge, onSaved, src, onClose]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const cut = saved.filter((s) => s.kind === 'video' && s.state === 'saved').pop();
  const list = saved.filter((s) => s.kind === 'cut-list' && s.state === 'saved').pop();

  return (
    <div className="fixed inset-0 z-[66] bg-black/40 p-2 sm:p-4 flex" role="dialog" aria-label="Silence remover">
      <div className="mx-auto w-full max-w-[1800px] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-st-line shrink-0">
          <Scissors size={17} className="text-18-orange" aria-hidden />
          <div className="mr-2 min-w-0">
            <h2 className="font-semibold text-sm leading-tight">Remove pauses &amp; fillers</h2>
            <p className="text-[11px] text-st-mute truncate">
              {src ? <>Silence remover on <b className="text-st-ink">{src.path}</b> {src.from === 'timeline' ? 'from the timeline' : src.from === 'preview' ? '(the video in the preview)' : '(the raw footage)'}</> : 'Silence remover'} · exports are saved into <b className="text-st-ink">{d.name}</b>
            </p>
          </div>
          {/* The Silence remover puts its own buttons (Projects, Start, Settings, Export…) here. */}
          <div ref={setSlot} className="flex flex-1 flex-wrap items-center justify-end gap-2" />
          <button onClick={onClose} className="p-2 rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Close the Silence remover"><X size={18} /></button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {src ? <SilenceHome actions={slot} link={link} />
            : <p className="text-sm text-st-mute">This video has nothing on its timeline yet. Add footage under Media files → Footage, then open this again.</p>}
        </div>

        {saved.length > 0 && (
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-t border-st-line bg-st-surface text-xs shrink-0">
            {saved.map((s) => (
              <span key={s.path} className="inline-flex items-center gap-1.5">
                {s.state === 'saving' ? <Spinner /> : s.state === 'saved' ? <CheckCircle2 size={14} className="text-emerald-600" aria-hidden /> : <X size={14} className="text-red-600" aria-hidden />}
                {s.state === 'saving' ? 'Saving' : s.state === 'saved' ? 'Saved to the edit:' : 'Could not save'} <b>{s.path}</b>{s.error ? ` (${s.error})` : ''}
                {s.state === 'saved' && s.kind === 'video' && <button onClick={() => { onOpenFile(s.path); onClose(); }} className="text-18-orange hover:underline ml-1">Play</button>}
              </span>
            ))}
            <div className="flex-1" />
            {cut && (
              <button onClick={() => onUse(`I removed the pauses and fillers with the Silence remover. The cut version is ${cut.path}${list ? ` and the cut list is ${list.path}` : ''}. Use ${cut.path} as the source for this edit from now on (make the frame-accurate CFR source from it), and tell me if anything in the edit needs to move.`)}
                className={`${btn} !min-h-[34px] !py-1.5 text-xs`}><Sparkles size={13} aria-hidden /> Use it in the edit</button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

// ---------- media files ----------
const size = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function MediaPanel({ boxRef, d, bridge, view, onOpen, onChanged }: { boxRef: React.RefObject<HTMLElement>; d: Detail; bridge: Bridge; view: View | null; onOpen: (v: View) => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'footage' | 'outputs' | 'images' | 'docs'>(d.out.length ? 'outputs' : 'footage');
  const docs: (TextFile & { text?: string | null })[] = [
    ...(d.plan ? [{ name: 'Graphics plan', path: 'work/plan.md', modified: 0, text: d.plan }] : []),
    ...(d.brief ? [{ name: 'Brief (intake answers)', path: 'work/brief.md', modified: 0, text: d.brief }] : []),
    ...d.out.filter((f) => f.kind === 'text').map((f) => ({ name: f.name, path: f.path, modified: f.modified })),
    ...d.workText.filter((f) => !['plan.md', 'brief.md'].includes(f.name) && /\.(md|srt|txt)$/i.test(f.name)),
  ];
  const open = (f: FileInfo) => {
    if (f.kind === 'video' || f.kind === 'image' || f.kind === 'audio') onOpen({ kind: f.kind, path: f.path, name: f.name, play: f.kind !== 'image' });
    else onOpen({ kind: 'doc', path: f.path, name: f.name });
  };
  const list = tab === 'footage' ? d.raw : tab === 'outputs' ? d.out : d.workImages;

  return (
    <section ref={boxRef} className={`${card} flex flex-col min-h-[280px] lg:min-h-0 overflow-hidden`} aria-label="Media files">
      <header className="flex items-center gap-1 px-2 h-11 border-b border-st-line shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-st-mute px-1.5 mr-1 shrink-0">Media files</h2>
        {([['footage', `Footage ${d.raw.length}`], ['outputs', `Outputs ${d.out.length}`], ['images', `Images ${d.workImages.length}`], ['docs', `Docs ${docs.length}`]] as const).map(([k, text]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`shrink-0 rounded-md px-2 py-1 text-xs ${tab === k ? 'bg-18-orange/10 text-18-orange font-semibold' : 'text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>{text}</button>
        ))}
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'footage' && <AddFootage d={d} bridge={bridge} onChange={onChanged} />}
        {tab === 'docs' ? (
          docs.length ? (
            <ul className="space-y-0.5">
              {docs.map((f) => (
                <li key={f.path}>
                  <button onClick={() => onOpen({ kind: 'doc', path: f.path, name: f.name, text: f.text })}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${view?.path === f.path ? 'bg-18-orange/10 text-18-orange' : 'hover:bg-st-surface'}`}>
                    <FileText size={15} className="shrink-0" aria-hidden /> <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-st-mute p-2">The brief, the graphics plan and caption files appear here as the editor writes them.</p>
        ) : list.length ? (
          <ul className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {list.map((f) => (
              <li key={f.path}><MediaCard f={f} url={bridge.fileUrl(d.id, f.path)} active={view?.path === f.path} onOpen={() => open(f)} /></li>
            ))}
          </ul>
        ) : tab !== 'footage' && <p className="text-xs text-st-mute p-2">{tab === 'outputs' ? 'Storyboards, style frames, previews, finals and captions appear here as the editor makes them.' : 'Contact sheets and working stills from work/ appear here.'}</p>}
      </div>
    </section>
  );
}

// One file as a card: a frame from the video (or the image itself, or an icon), the
// length, name and size. Clicking opens it in the preview, and videos start playing.
const fmtLen = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
function MediaCard({ f, url, active, onOpen }: { f: FileInfo; url: string; active: boolean; onOpen: () => void }) {
  const [len, setLen] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const Icon = f.kind === 'video' ? Film : f.kind === 'audio' ? Music : f.kind === 'image' ? ImageIcon : FileText;
  return (
    <button onClick={onOpen} title={`${f.name} · ${size(f.size)} · ${when(f.modified)}`}
      className={`group w-full text-left rounded-lg overflow-hidden border bg-white transition ${active ? 'border-18-orange ring-2 ring-18-orange/30' : 'border-st-line hover:border-[#D4D4D4] hover:shadow-sm'}`}>
      <div className="relative aspect-video bg-[#1b1b1b] flex items-center justify-center overflow-hidden">
        {f.kind === 'video' && !broken && (
          // A frame from 1 s in, loaded with only the file's metadata (a small range request).
          <video src={`${url}#t=1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden
            onLoadedMetadata={(e) => setLen(e.currentTarget.duration)} onError={() => setBroken(true)}
            className="w-full h-full object-cover pointer-events-none" />
        )}
        {f.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
        {(f.kind === 'audio' || f.kind === 'text' || f.kind === 'other' || broken) && <Icon size={26} className="text-white/50" aria-hidden />}
        {(f.kind === 'video' || f.kind === 'audio') && (
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/25">
            <span className="h-9 w-9 rounded-full bg-white/90 flex items-center justify-center shadow"><Play size={16} className="text-st-ink ml-0.5" fill="currentColor" aria-hidden /></span>
          </span>
        )}
        {len != null && Number.isFinite(len) && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white tabular-nums">{fmtLen(len)}</span>}
        {active && <span className="absolute top-1 left-1 rounded bg-18-orange px-1.5 py-0.5 text-[10px] font-semibold text-white">In preview</span>}
      </div>
      <div className="px-2 py-1.5">
        <p className={`text-xs font-medium truncate ${active ? 'text-18-orange' : 'text-st-ink'}`}>{f.name}</p>
        <p className="text-[10px] text-st-mute">{size(f.size)}</p>
      </div>
    </button>
  );
}

function AddFootage({ d, bridge, onChange }: { d: Detail; bridge: Bridge; onChange: () => void }) {
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [local, setLocal] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    for (const file of Array.from(files)) {
      try {
        await new Promise<void>((ok, bad) => {
          const x = new XMLHttpRequest();
          x.open('POST', `${BRIDGE}/api/p/upload?id=${encodeURIComponent(d.id)}&name=${encodeURIComponent(file.name)}`);
          x.setRequestHeader('X-Editor-Token', bridge.token);
          x.upload.onprogress = (e) => e.lengthComputable && setProgress({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
          x.onload = () => (x.status < 300 ? ok() : bad(new Error(JSON.parse(x.responseText || '{}').error || `Upload failed (${x.status}).`)));
          x.onerror = () => bad(new Error('Upload failed. Is the bridge still running?'));
          x.send(file);
        });
      } catch (e) { setError((e as Error).message); break; }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    onChange();
  }

  async function addLocal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try { await bridge.call(`/api/p/add-local?id=${encodeURIComponent(d.id)}`, { path: local.trim() }); setLocal(''); onChange(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="mb-2 space-y-2 rounded-lg bg-st-surface p-2">
      <div className="flex items-center gap-2">
        <input ref={input} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => upload(e.target.files)} />
        <button onClick={() => input.current?.click()} disabled={!!progress} className={`${btnGhost} !min-h-[34px] !py-1.5 text-xs`}><Upload size={14} aria-hidden /> Upload</button>
        {progress && <span className="text-xs text-st-mute flex items-center gap-1.5 truncate"><Spinner /> {progress.pct}% {progress.name}</span>}
      </div>
      <form onSubmit={addLocal} className="flex gap-1.5">
        <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Add from this PC: D:\Footage\clip.mov" className={`${field} !min-h-[34px] !py-1.5 text-xs`} aria-label="File path on this PC" spellCheck={false} />
        <button disabled={!local.trim()} className={`${btnGhost} !min-h-[34px] !py-1.5 text-xs shrink-0`}>Add</button>
      </form>
      <ErrorNote text={error} />
    </div>
  );
}

// ---------- preview player ----------
function Viewer({ width, d, bridge, view, onVideo, program, onProgram, vertical }: { width: number | null; d: Detail; bridge: Bridge; view: View | null; onVideo: (v: HTMLVideoElement | null) => void; program: FileInfo | null; onProgram: () => void; vertical: boolean }) {
  // The frame is always the delivery size: 1920 × 1080 (16:9), or 1080 × 1920 for 9:16 Shorts.
  const [fw, fh] = vertical ? [1080, 1920] : [1920, 1080];
  const [doc, setDoc] = useState<string | null>(null);
  const url = view ? bridge.fileUrl(d.id, view.path) : '';

  // Text files that are not already in the detail (srt, notes) are fetched when opened.
  useEffect(() => {
    setDoc(null);
    if (view?.kind !== 'doc') return;
    if (view.text != null) return setDoc(view.text);
    fetch(bridge.fileUrl(d.id, view.path)).then((r) => r.text()).then(setDoc).catch(() => setDoc('Could not open this file.'));
  }, [view, bridge, d.id]);

  const isVideo = view?.kind === 'video' || view?.kind === 'audio';

  // A card click opens the file and plays it (also when that file is already open).
  const vid = useRef<HTMLVideoElement | null>(null);
  const setVid = useCallback((el: HTMLVideoElement | null) => { vid.current = el; onVideo(el); }, [onVideo]);
  useEffect(() => {
    if (view && view.kind !== 'doc' && view.play && vid.current) vid.current.play().catch(() => {});
  }, [view]);
  return (
    <section className={`${card} flex flex-col min-h-[260px] lg:min-h-0 overflow-hidden`} style={width ? { width } : undefined} aria-label="Preview">
      <header className="flex items-center gap-2 px-3 h-11 border-b border-st-line shrink-0">
        <span className="text-sm font-medium truncate flex-1" title={view?.name}>{view?.name ?? 'Preview'}</span>
        <span className="text-[11px] text-st-mute tabular-nums shrink-0" title="Frame size">{fw} × {fh}</span>
        {program && view?.path !== program.path && <button onClick={onProgram} className="text-xs text-18-orange hover:underline shrink-0">Show the edit</button>}
        {view && <a href={url} target="_blank" rel="noreferrer" className="p-1 text-st-mute hover:text-st-ink" aria-label="Open in a new tab"><Maximize2 size={15} /></a>}
        {view && <a href={bridge.fileUrl(d.id, view.path, true)} className="p-1 text-st-mute hover:text-st-ink" aria-label="Download"><Download size={15} /></a>}
      </header>
      {/* The available space is a size container; the frame inside is the largest box with the
          delivery aspect ratio that fits it (min of full width, or full height × ratio). */}
      <div className={`flex-1 min-h-0 bg-black relative flex items-center justify-center ${vertical ? 'aspect-[9/16] max-h-[70vh] lg:max-h-none' : 'aspect-video'} lg:aspect-auto`} style={{ containerType: 'size' }}>
        <div className="relative bg-black flex items-center justify-center overflow-hidden"
          style={{ aspectRatio: `${fw} / ${fh}`, width: `min(100cqw, calc(100cqh * ${fw} / ${fh}))` }}>
          {/* One video element for the whole session: the meter's audio graph stays attached to it. */}
          <video ref={setVid} src={isVideo ? url : undefined} controls crossOrigin="anonymous" preload="metadata" playsInline
            className={`w-full h-full object-contain ${isVideo ? '' : 'hidden'}`} />
          {view?.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={view.name} className="w-full h-full object-contain" />
          )}
          {!view && <p className="text-sm text-white/60 p-6 text-center">Add footage, or pick a file in Media files to play it here.</p>}
        </div>
        {view?.kind === 'doc' && <div className="absolute inset-0 overflow-y-auto bg-white p-5">{doc == null ? <Spinner /> : /\.srt$/i.test(view.path) ? <pre className="text-xs whitespace-pre-wrap font-mono">{doc}</pre> : <Md text={doc} />}</div>}
      </div>
    </section>
  );
}

// ---------- volume meter (dB), fed by the player through the Web Audio API ----------
const DB_MIN = -60;
const DB_MARKS = [0, -6, -12, -18, -24, -36, -48, -60];
function Meter({ video, muted, onMute }: { video: HTMLVideoElement | null; muted: boolean; onMute: () => void }) {
  const bars = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const peaks = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!video) return;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined; // ~30 updates a second
    let analysers: AnalyserNode[] = [];
    const buf = new Float32Array(2048);
    const peak = [DB_MIN, DB_MIN];
    const level = (db: number) => ((Math.max(DB_MIN, Math.min(0, db)) - DB_MIN) / -DB_MIN) * 100;
    const pct = (db: number) => `${level(db)}%`;
    const loop = () => {
      const lv = analysers.map((a) => {
        a.getFloatTimeDomainData(buf);
        let s = 0;
        for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
        return Math.sqrt(s / buf.length);
      });
      if (lv.length === 2 && lv[1] === 0) lv[1] = lv[0]; // mono source: mirror
      lv.forEach((rms, i) => {
        const db = rms > 0 ? 20 * Math.log10(rms) : DB_MIN;
        peak[i] = Math.max(db, peak[i] - 0.35);
        if (bars[i].current) bars[i].current.style.height = `${100 - level(db)}%`;
        if (peaks[i].current) peaks[i].current.style.bottom = pct(peak[i]);
      });
      if (readout.current) readout.current.textContent = Math.max(...peak) <= DB_MIN + 0.5 ? '−∞' : Math.max(...peak).toFixed(1);
    };
    const start = () => {
      if (ctx) { ctx.resume(); return; }
      try {
        ctx = new AudioContext();
        const src = ctx.createMediaElementSource(video);
        const split = ctx.createChannelSplitter(2);
        src.connect(ctx.destination);
        src.connect(split);
        analysers = [0, 1].map((ch) => { const a = ctx!.createAnalyser(); a.fftSize = 2048; split.connect(a, ch); return a; });
        timer = setInterval(loop, 33);
      } catch { /* already attached, or no Web Audio: the meter stays empty */ }
    };
    video.addEventListener('play', start);
    return () => { video.removeEventListener('play', start); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  return (
    <section className={`${card} h-full flex flex-col items-center py-2 select-none`} aria-label="Volume meter">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-st-mute">dB</span>
      <span ref={readout} className="text-[11px] tabular-nums text-st-ink mt-0.5">−∞</span>
      <div className="flex-1 min-h-0 w-full flex justify-center gap-1 mt-2 relative">
        <div className="flex flex-col justify-between text-[9px] text-st-mute tabular-nums pr-0.5 text-right">
          {DB_MARKS.map((m) => <span key={m} style={{ position: 'absolute', bottom: `${((m - DB_MIN) / -DB_MIN) * 100}%`, left: 2, transform: 'translateY(50%)' }}>{m}</span>)}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="relative w-3 h-full rounded-sm overflow-hidden ml-4 first:ml-5"
            style={{ background: 'linear-gradient(to top, #22c55e 0%, #22c55e 70%, #facc15 85%, #ef4444 100%)' }}>
            {/* dark cover from the top; the level shows as the gradient below it */}
            <div ref={bars[i]} className="absolute top-0 left-0 right-0 bg-[#1b1b1b] transition-[height] duration-75" style={{ height: '100%' }} />
            <div ref={peaks[i]} className="absolute left-0 right-0 h-0.5 bg-white/90" style={{ bottom: '0%' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-3 text-[9px] text-st-mute mt-1 ml-5"><span>L</span><span>R</span></div>
      <button onClick={onMute} className="mt-2 p-1.5 rounded-md text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </section>
  );
}

// ---------- dialogs: 1st draft brief, storyboard review, request changes ----------
function Modal({ title, sub, wide, onClose, children, footer }: { title: string; sub?: React.ReactNode; wide?: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[68] bg-black/40 p-3 sm:p-6 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-[1400px] h-full' : 'max-w-2xl max-h-full'} flex flex-col overflow-hidden`}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-st-line shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">{title}</h2>
            {sub && <p className="text-xs text-st-mute mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-st-line bg-st-surface shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- Export ----------
// Renders the edit straight from work/edit.json (no AI turn), with the skill's settings:
// preview = 720p copy under 30 MB for phone review, final = 1080p high quality.
type ExportFile = { path: string; size: number; modified: number } | null;
type ExportJob = { mode: 'preview' | 'final'; state: 'running' | 'done' | 'failed' | 'cancelled'; stage: string; pct: number; file: string | null; size: number | null; error: string | null; started: number; ended?: number };
type ExportInfo = { ready: boolean; props: string | null; propsModified: number | null; final: ExportFile; preview: ExportFile; job: ExportJob | null; busy: { id: string; kind: string } | null };

const EXPORTS = [
  { mode: 'preview' as const, title: 'Preview', tag: 'Low quality · under 30 MB', text: '720p copy for checking on the phone and sharing for review. Quick when the final is already up to date; otherwise it renders the edit first.' },
  { mode: 'final' as const, title: 'Final output', tag: 'High quality · 1080p', text: 'The full-quality render to publish (crf 14, slow preset, sharpest frames). Takes a while: often 10–30 minutes for a few minutes of video.' },
];

function ExportButton({ id, bridge, onDone, onPlay }: { id: string; bridge: Bridge; onDone: () => void; onPlay: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [error, setError] = useState('');
  const job = info?.job ?? null;
  const running = job?.state === 'running';
  const url = `/api/p/export?id=${encodeURIComponent(id)}`;

  const load = useCallback(async () => {
    try { setInfo(await bridge.call<ExportInfo>(url)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [bridge, url]);

  useEffect(() => { setInfo(null); void load(); }, [load]);
  // Poll while the dialog is open or an export is running (so the button shows progress when closed).
  useEffect(() => {
    if (!open && !running) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [open, running, load]);
  // Refresh the media list once an export finishes.
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    const s = job ? `${job.started}:${job.state}` : null;
    if (lastState.current && s !== lastState.current && job?.state === 'done') onDone();
    lastState.current = s;
  }, [job, onDone]);

  const start = async (mode: 'preview' | 'final' | 'cancel') => {
    setError('');
    try { setInfo(await bridge.call<ExportInfo>(url, { mode })); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const elapsed = (j: ExportJob) => fmtTime(Math.round(((j.ended ?? Date.now()) - j.started) / 1000)).replace(/\.0$/, '');
  const busyOther = info?.busy && !(info.busy.kind === 'export' && info.busy.id === id) ? info.busy : null;

  return (
    <>
      <button onClick={() => setOpen(true)} className={btnGhost} title="Export the video">
        {running ? <Spinner /> : <Download size={15} aria-hidden />} {running ? `Exporting ${Math.round(job!.pct)}%` : 'Export'}
      </button>
      {open && (
        <Modal title="Export" sub={info?.props ? `Rendered from ${info.props}. Files go into out/ and show under Outputs.` : undefined} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            {info && !info.ready && <p className="text-sm text-st-mute">Nothing to export yet: the edit (work/edit.json) is built during the 1st draft. Use <b>Create 1st draft</b> first.</p>}
            {busyOther && <p className="text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2">{busyOther.kind === 'export' ? `An export of "${busyOther.id}" is running.` : busyOther.id === id ? 'The AI editor is working on this video.' : `The AI editor is busy with "${busyOther.id}".`} One job runs at a time; export once it has finished.</p>}
            <ErrorNote text={error} />
            {EXPORTS.map((x) => {
              const have = info?.[x.mode] ?? null;
              const stale = !!(have && info?.propsModified && have.modified < info.propsModified);
              const mine = job && job.mode === x.mode ? job : null;
              return (
                <section key={x.mode} className="rounded-xl border border-st-line p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-[14rem]">
                      <h3 className="font-semibold text-sm">{x.title} <span className="ml-1 rounded-full bg-st-surface px-2 py-0.5 text-[11px] font-medium text-st-mute">{x.tag}</span></h3>
                      <p className="text-xs text-st-mute mt-1">{x.text}</p>
                    </div>
                    {mine?.state === 'running' ? (
                      <button onClick={() => start('cancel')} className={btnGhost}><X size={15} aria-hidden /> Cancel</button>
                    ) : (
                      <button onClick={() => start(x.mode)} disabled={!info?.ready || running || !!busyOther} className={x.mode === 'final' ? btn : btnGhost}>
                        <Download size={15} aria-hidden /> {have ? 'Export again' : `Export ${x.mode === 'final' ? 'final' : 'preview'}`}
                      </button>
                    )}
                  </div>

                  {mine?.state === 'running' && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-st-mute mb-1"><span>{mine.stage}…</span><span className="tabular-nums">{Math.round(mine.pct)}% · {elapsed(mine)}</span></div>
                      <div className="h-2 rounded-full bg-st-surface overflow-hidden"><div className="h-full bg-18-orange transition-[width]" style={{ width: `${Math.max(2, mine.pct)}%` }} /></div>
                    </div>
                  )}
                  {mine?.state === 'failed' && <p className="mt-3 text-xs text-red-700 break-words">Export failed: {mine.error}</p>}
                  {mine?.state === 'cancelled' && <p className="mt-3 text-xs text-st-mute">Export cancelled. The previous file, if any, is unchanged.</p>}

                  {have && mine?.state !== 'running' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-st-ink"><Film size={13} aria-hidden /> {have.path.replace(/^out\//, '')}</span>
                      <span className="text-st-mute">{size(have.size)} · {new Date(have.modified).toLocaleString()}</span>
                      {stale && <span className="rounded-full bg-amber-50 text-amber-900 px-2 py-0.5">older than the edit: export again</span>}
                      {x.mode === 'preview' && have.size > 30e6 && <span className="rounded-full bg-amber-50 text-amber-900 px-2 py-0.5">over 30 MB</span>}
                      <div className="flex-1" />
                      <button onClick={() => { onPlay(have.path); setOpen(false); }} className="inline-flex items-center gap-1 rounded-full border border-st-line px-2.5 py-1 hover:bg-st-surface"><Play size={12} aria-hidden /> Play</button>
                      <a href={bridge.fileUrl(id, have.path, true)} className="inline-flex items-center gap-1 rounded-full border border-st-line px-2.5 py-1 hover:bg-st-surface"><Download size={12} aria-hidden /> Download</a>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

// Create 1st draft: the intake questions from the skill (Part 1, Step 0), with the usual
// defaults picked, plus a free box for anything else, like a message in chat.
function BriefDialog({ name, savedBrief, onClose, onStart }: { name: string; savedBrief: boolean; onClose: () => void; onStart: (b: Brief) => void }) {
  const [b, setB] = useState<Brief>(BRIEF_DEFAULT);
  const set = (k: string, v: string) => setB((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Create the 1st draft" onClose={onClose}
      sub={<>The AI editor edits <b className="text-st-ink">{name}</b> the way you edit in chat, makes the storyboard, and stops for your approval before it edits the draft.{savedBrief ? ' The saved brief (work/brief.md) is used too; your answers here win where they differ.' : ''}</>}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={() => onStart(b)} className={btn}><Wand2 size={15} aria-hidden /> Create 1st draft</button>
      </>}>
      <div className="space-y-4">
        {BRIEF_QUESTIONS.map((q) => (
          <fieldset key={q.key}>
            <legend className={label}>{q.label}</legend>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <button key={o} type="button" onClick={() => set(q.key, o)} aria-pressed={b[q.key] === o}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${b[q.key] === o ? 'border-18-orange bg-18-orange/10 text-18-orange font-semibold' : 'border-st-line text-st-ink hover:border-[#D4D4D4]'}`}>{o}</button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="brief-length">Target length (optional)</label>
            <input id="brief-length" value={b.length ?? ''} onChange={(e) => set('length', e.target.value)} placeholder="e.g. about 3 minutes" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="brief-lt">Lower third: name, role (optional)</label>
            <input id="brief-lt" value={b.lowerThird ?? ''} onChange={(e) => set('lowerThird', e.target.value)} placeholder="e.g. Teja Surishetti, Co-founder & COO, 18startup" className={field} />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="brief-notes">What do you want in this video?</label>
          <textarea id="brief-notes" rows={5} value={b.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className={`${field} resize-y`}
            placeholder={'Tell the editor what you want, like you would in chat. e.g.\n• Open on the speaker big, title "How do you find a good startup idea?"\n• Whiteboard scenes for the 24-hour exercise and the list of problems\n• Use the screenshots in raw/ when I talk about the app'} />
        </div>
        <details>
          <summary className="text-xs text-st-mute cursor-pointer select-none">Add a script (caption text)</summary>
          <textarea rows={5} value={b.script ?? ''} onChange={(e) => set('script', e.target.value)} className={`${field} resize-y mt-2`} aria-label="Script" placeholder="Paste the script; it is used as the caption text." />
        </details>
      </div>
    </Modal>
  );
}

// The storyboard sheets the 1st draft made, with Approve (edit the draft) and Request changes.
function StoryboardDialog({ d, bridge, draft, running, onClose, onApprove, onChanges }: {
  d: Detail; bridge: Bridge; draft: FirstDraft | null; running: boolean; onClose: () => void; onApprove: () => void; onChanges: () => void;
}) {
  const all = [...d.out, ...d.workImages].filter(isSheet).sort((a, b) => b.modified - a.modified);
  const fresh = draft ? all.filter((f) => f.modified >= draft.startedAt - 2000) : [];
  const sheets = fresh.length ? fresh : all;
  const pending = draft?.stage === 'storyboard';
  return (
    <Modal wide title="Storyboard" onClose={onClose}
      sub={pending ? 'One frame every 5 seconds, and every scene fully drawn. Approve it to edit the 1st draft, or ask for changes.' : draft?.stage === 'draft-working' ? 'Approved. The AI editor is editing the 1st draft.' : draft?.stage === 'draft' ? 'Approved. The 1st draft is ready in the player.' : 'The storyboard sheets for this video.'}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Close</button>
        {pending && <button onClick={onChanges} disabled={running} className={btnGhost}><PenLine size={15} aria-hidden /> Request changes</button>}
        {pending && <button onClick={onApprove} disabled={running} className={btn}><CheckCircle2 size={15} aria-hidden /> Approve and edit the 1st draft</button>}
      </>}>
      {sheets.length ? (
        <div className="space-y-6">
          {sheets.map((f) => (
            <figure key={f.path}>
              <figcaption className="flex items-center gap-2 text-sm mb-2">
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-st-mute">{when(f.modified)}</span>
                <a href={bridge.fileUrl(d.id, f.path)} target="_blank" rel="noreferrer" className="ml-auto p-1 text-st-mute hover:text-st-ink" aria-label={`Open ${f.name} full size`}><Maximize2 size={15} /></a>
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bridge.fileUrl(d.id, f.path)} alt={f.name} className="w-full rounded-lg border border-st-line" />
            </figure>
          ))}
        </div>
      ) : <p className="text-sm text-st-mute">No storyboard sheets yet. They appear here once the 1st draft has made them.</p>}
    </Modal>
  );
}

// Request changes: plain words, like a message to Claude. "Insert time" adds the player's
// current time, so changes can point at a moment ("at 0:24 move the card left").
function ChangesDialog({ stage, at, atName, onClose, onSend }: { stage: FirstDraft['stage'] | undefined; at: number | null; atName: string; onClose: () => void; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const stamp = at == null ? '' : `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
  const insert = () => {
    const el = box.current;
    const add = `At ${stamp}${atName ? ` (${atName})` : ''}: `;
    const pos = el?.selectionStart ?? text.length;
    const next = text.slice(0, pos) + (pos && text[pos - 1] !== '\n' ? '\n' : '') + add + text.slice(pos);
    setText(next);
    setTimeout(() => { el?.focus(); const c = pos + add.length + (pos && text[pos - 1] !== '\n' ? 1 : 0); el?.setSelectionRange(c, c); }, 0);
  };
  const what = stage === 'storyboard' || stage === 'storyboard-working' ? 'the storyboard' : stage === 'draft' || stage === 'draft-working' ? 'the 1st draft' : 'this video';
  return (
    <Modal title={`Request changes to ${what}`} onClose={onClose}
      sub={stage === 'storyboard' || stage === 'storyboard-working' ? 'The AI editor makes the changes and remakes the storyboard for your approval.' : stage === 'draft' || stage === 'draft-working' ? 'The AI editor makes the changes and renders the 1st draft again.' : 'Sent to the AI editor as a message.'}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={() => text.trim() && onSend(text.trim())} disabled={!text.trim()} className={btn}><Send size={15} aria-hidden /> Send changes</button>
      </>}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className={`${label} !mb-0`} htmlFor="changes-text">What should change?</label>
          {at != null && <button type="button" onClick={insert} className="inline-flex items-center gap-1 text-xs text-18-orange hover:underline"><Clock size={12} aria-hidden /> Insert time {stamp}</button>}
        </div>
        <textarea id="changes-text" ref={box} rows={9} value={text} onChange={(e) => setText(e.target.value)} className={`${field} resize-y`}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) onSend(text.trim()); }}
          placeholder={'Write it the way you would tell Claude. e.g.\n• At 0:24 move the card to the left, it covers the face\n• The whiteboard at 1:11 should finish drawing before the cut\n• Remove the zoom at the start\n• Spell it 18startup, not 18 Startup'} />
        <p className="text-[11px] text-st-mute">Ctrl+Enter sends.</p>
      </div>
    </Modal>
  );
}

// ---------- AI features bar ----------
const pill = 'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed';
function AiBar({ running, busyElsewhere, draft, chatOpen, unread, onFeature, onDraft, onStoryboard, onChanges, onChat, onStop }: {
  running: boolean; busyElsewhere: string | null; draft: FirstDraft | null; chatOpen: boolean; unread: boolean;
  onFeature: (f: (typeof AI_FEATURES)[number]) => void; onDraft: () => void; onStoryboard: () => void; onChanges: () => void; onChat: () => void; onStop: () => void;
}) {
  const blocked = running || !!busyElsewhere;
  const st = draft?.stage;
  // The storyboard opens only once the 1st draft has made one.
  const storyboardOpen = st === 'storyboard' || st === 'draft-working' || st === 'draft';
  const draftLabel = !st ? 'Create 1st draft'
    : st === 'storyboard-working' ? (running ? 'Making the storyboard…' : '1st draft: waiting for you')
    : st === 'storyboard' ? 'Storyboard ready: review it'
    : st === 'draft-working' ? (running ? 'Editing the 1st draft…' : '1st draft: waiting for you')
    : '1st draft ready';
  return (
    <section className={`${card} lg:col-span-2 px-2 py-2 flex items-center gap-2 min-w-0`} aria-label="AI features">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-st-ink px-2 shrink-0"><Sparkles size={15} className="text-18-orange" aria-hidden /> AI features</span>
      <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:thin]">
        <button onClick={st === 'storyboard' ? onStoryboard : st === 'draft' ? onChanges : st ? onChat : onDraft} disabled={!st && blocked}
          className={`${pill} border-18-orange bg-18-orange text-white font-semibold hover:bg-[#E5601F]`}>
          {(st === 'storyboard-working' || st === 'draft-working') && running ? <Spinner /> : <Wand2 size={13} aria-hidden />} {draftLabel}
        </button>
        {AI_FEATURES.map((f) => (
          <button key={f.key} onClick={() => onFeature(f)} disabled={blocked} className={`${pill} border-st-line text-st-ink hover:border-18-orange/50 hover:text-18-orange`}>
            {f.label}
          </button>
        ))}
        <button onClick={onStoryboard} disabled={!storyboardOpen} title={storyboardOpen ? 'Open the storyboard' : 'Unlocks when the 1st draft has made its storyboard'}
          className={`${pill} border-st-line text-st-ink hover:border-18-orange/50 hover:text-18-orange`}>
          {storyboardOpen ? <LayoutGrid size={13} aria-hidden /> : <Lock size={12} aria-hidden />} Storyboard
        </button>
        <button onClick={onChanges} disabled={blocked} className={`${pill} border-st-line text-st-ink hover:border-18-orange/50 hover:text-18-orange`}>
          <PenLine size={13} aria-hidden /> Request changes
        </button>
      </div>
      {running && <button onClick={onStop} className={`${btnGhost} !min-h-[34px] !py-1.5 text-xs shrink-0`}><Square size={13} aria-hidden /> Stop</button>}
      <button onClick={onChat} aria-pressed={chatOpen}
        className={`relative shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-semibold ${chatOpen ? 'bg-st-ink text-white' : 'bg-st-surface text-st-ink hover:bg-[#F0F0F0]'}`}>
        {running ? <Spinner /> : <MessageSquare size={14} aria-hidden />} {running ? 'AI working…' : 'Ask AI'}
        {unread && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-18-orange" aria-label="New reply" />}
      </button>
    </section>
  );
}

// ---------- timeline ----------
type Clip = { id: string; track: TrackKey; kind: string; text: string; start: number; end: number };
type TrackKey = 'V1' | 'V2' | 'CC' | 'A1';
const TRACKS: { key: TrackKey; name: string; color: string; audio?: boolean }[] = [
  { key: 'V2', name: 'Graphics', color: 'bg-18-orange/85 border-[#D9601F]' },
  { key: 'V1', name: 'Footage', color: 'bg-sky-500/80 border-sky-700' },
  { key: 'CC', name: 'Captions', color: 'bg-yellow-200 border-yellow-500 text-st-ink' },
  { key: 'A1', name: 'Audio', color: 'bg-emerald-500/80 border-emerald-700', audio: true },
];
const KIND: Record<string, string> = {
  segments: 'Footage', broll: 'B-roll', splitScreens: 'Split screen', whiteboards: 'Whiteboard', slides: 'Slide', scenes: 'Scene', cards: 'Card',
  listCards: 'List', statCards: 'Stat', defCards: 'Definition', badgeCards: 'Badge', titles: 'Title', highlights: 'Highlight', lowerThirds: 'Lower third',
  zooms: 'Zoom', screenshots: 'Screenshot', tamBoard: 'Market board', tamSummary: 'Market recap', columnFocus: 'Column focus', captions: 'Caption',
  sfx: 'SFX', splitIntro: 'Opener', pip: 'Speaker PiP', timer: 'Timer',
};
const V1_KEYS = new Set(['segments', 'broll', 'splitScreens']);
type Obj = { [k: string]: unknown };
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).pop() ?? p : '');
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function describe(it: Obj): string {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : '');
  const lines = Array.isArray(it.lines) ? it.lines.map((l) => (typeof l === 'string' ? l : isObj(l) ? s(l.text) : '')).filter(Boolean).join(' / ') : '';
  const texts = Array.isArray(it.texts) ? it.texts.map((l) => (isObj(l) ? s(l.text) : '')).filter(Boolean).slice(0, 3).join(' / ') : '';
  const items = Array.isArray(it.items) ? it.items.map((l) => (isObj(l) ? s(l.text) : '')).filter(Boolean).join(', ') : '';
  const stat = it.value != null ? `${String(it.value)}${s(it.suffix)} ${s(it.label)}`.trim() : '';
  return s(it.text) || s(it.name) || s(it.title) || lines || texts || items || stat || (it.src ? base(it.src) : '') || (num(it.scale) ? `${it.scale}×` : '');
}

// Turn the render props into clips on four tracks. Everything with start/end (seconds on
// the output timeline) is placed; source cuts are laid end to end.
function buildClips(data: Obj): { clips: Clip[]; duration: number } {
  const fps = num(data.fps) ?? 30;
  let duration = num(data.durationInFrames) ? (data.durationInFrames as number) / fps : 0;
  const clips: Clip[] = [];
  const add = (track: TrackKey, kind: string, text: string, start: number, end: number) => clips.push({ id: `${track}-${clips.length}`, track, kind, text, start, end: Math.max(end, start + 0.05) });

  const segs = Array.isArray(data.segments) ? data.segments.filter(isObj) : [];
  let pos = num(data.introPreroll) ?? 0;
  for (const sg of segs) {
    const from = num(sg.from) ?? 0, to = num(sg.to) ?? from;
    add('V1', 'Footage', `${base(sg.src)} ${fmtTime(from)}–${fmtTime(to)}`, pos, pos + (to - from));
    add('A1', 'Voice', base(sg.src), pos, pos + (to - from));
    pos += to - from;
  }
  if (!segs.length && typeof data.src === 'string') add('V1', 'Footage', base(data.src), 0, duration);

  for (const [key, v] of Object.entries(data)) {
    if (key === 'segments' || key === 'sfx' || key === 'music') continue;
    const list = Array.isArray(v) ? v : isObj(v) ? [v] : [];
    for (const it of list) {
      if (!isObj(it)) continue;
      const start = num(it.start), end = num(it.end);
      if (start == null || end == null) continue;
      const kind = isObj(it) && key === 'scenes' && typeof it.kind === 'string' ? `Scene (${it.kind})` : KIND[key] ?? key;
      add(key === 'captions' ? 'CC' : V1_KEYS.has(key) ? 'V1' : 'V2', kind, describe(it), start, end);
    }
  }

  if (typeof data.audio === 'string') add('A1', 'Voice', base(data.audio), 0, duration);
  const music = isObj(data.music) ? data.music : null;
  if (music?.src) add('A1', 'Music', base(music.src), 0, duration);
  if (Array.isArray(data.sfx)) for (const fx of data.sfx) if (isObj(fx) && num(fx.at) != null) add('A1', 'SFX', base(fx.src), fx.at as number, (fx.at as number) + 0.6);

  for (const c of clips) duration = Math.max(duration, c.end);
  return { clips, duration };
}

// Stack overlapping clips of a track into lanes.
function lanes(clips: Clip[]): Clip[][] {
  const out: { end: number; items: Clip[] }[] = [];
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    const lane = out.find((l) => l.end <= c.start + 0.001);
    if (lane) { lane.items.push(c); lane.end = c.end; } else out.push({ end: c.end, items: [c] });
  }
  return out.map((l) => l.items);
}

const LANE_H = 20;
const HEAD_W = 164;

// Keyboard shortcuts stay out of the way while typing or while a dialog / the Silence popup is open.
function typingOrDialog(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO'].includes(el.tagName))) return true;
  return !!document.querySelector('[role="dialog"]');
}

function Timeline({ data, file, video, player, programName, onNeedProgram, muted, onMute, onAsk }: {
  data: Obj | null; file: string | null; video: HTMLVideoElement | null; player: HTMLVideoElement | null; programName: string | null;
  onNeedProgram: () => void; muted: boolean; onMute: () => void; onAsk: (c: Clip) => void;
}) {
  const { clips, duration } = useMemo(() => (data ? buildClips(data) : { clips: [], duration: 0 }), [data]);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<Clip | null>(null);
  const [zoom, setZoom] = useState(0); // px per second; 0 = fit
  const [width, setWidth] = useState(800);
  const [t, setT] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - HEAD_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the player (only when it shows the rendered edit the timeline describes).
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const tick = () => { setT(video.currentTime); if (!video.paused) raf = requestAnimationFrame(tick); };
    const onPlay = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const onSeek = () => setT(video.currentTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', onSeek);
    video.addEventListener('timeupdate', onSeek);
    setT(video.currentTime);
    return () => { cancelAnimationFrame(raf); video.removeEventListener('play', onPlay); video.removeEventListener('seeked', onSeek); video.removeEventListener('timeupdate', onSeek); };
  }, [video]);

  const pps = zoom || (duration ? Math.max(2, width / duration) : 10);
  const total = Math.max(width, duration * pps);
  const seek = (sec: number) => {
    const s = Math.max(0, Math.min(duration, sec));
    setT(s);
    if (video) video.currentTime = s;
    else onNeedProgram();
  };
  const xToSec = (e: React.MouseEvent<HTMLElement>) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return (e.clientX - r.left) / pps;
  };

  // Edit points for ← / →: every clip start and end on the visible picture and audio tracks
  // (captions are left out, there is one every second or two).
  const cuts = useMemo(() => {
    const set = new Set<number>([0, Math.round(duration * 100) / 100]);
    for (const c of clips) if (c.track !== 'CC' && !hidden[c.track]) { set.add(Math.round(c.start * 100) / 100); set.add(Math.round(c.end * 100) / 100); }
    return [...set].filter((s) => s <= duration).sort((a, b) => a - b);
  }, [clips, hidden, duration]);

  // Latest values for the window listeners, so they are bound once.
  const live = useRef({ t, pps, cuts, player, seek, zoom });
  live.current = { t, pps, cuts, player, seek, zoom };

  // Keep the playhead in view after a jump.
  const reveal = (sec: number) => {
    const el = scroller.current;
    if (!el) return;
    const x = sec * live.current.pps, view = el.clientWidth - HEAD_W;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + view - 20) el.scrollLeft = Math.max(0, x - view / 2);
  };

  // Space = play / pause, ← / → = previous / next cut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingOrDialog(e)) return;
      const L = live.current;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat || !L.player) return;
        if (L.player.paused) void L.player.play().catch(() => {}); else L.player.pause();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!L.cuts.length) return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? L.cuts.find((s) => s > L.t + 0.05) : [...L.cuts].reverse().find((s) => s < L.t - 0.05);
        if (next == null) return;
        L.seek(next);
        reveal(next);
      }
    };
    // A focused button would also "click" on the Space key-up.
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space' && !typingOrDialog(e)) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // Alt + scroll = zoom around the mouse, Shift + scroll = move left / right.
  // A native listener, because React's wheel handler cannot cancel the page scroll.
  const anchor = useRef<{ sec: number; x: number } | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaY || e.deltaX;
      if (e.altKey) {
        e.preventDefault();
        if (!d) return;
        const L = live.current;
        const x = Math.max(0, e.clientX - el.getBoundingClientRect().left - HEAD_W);
        anchor.current = { sec: (el.scrollLeft + x) / L.pps, x };
        const nz = Math.min(400, Math.max(1, L.pps * (d < 0 ? 1.25 : 0.8)));
        setZoom(nz);
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += d;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [data]);
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, a.sec * pps - a.x);
  }, [pps]);

  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 64) ?? 600;
  const ticks = useMemo(() => Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step), [duration, step]);

  const byTrack = useMemo(() => Object.fromEntries(TRACKS.map((tr) => [tr.key, lanes(clips.filter((c) => c.track === tr.key))])) as Record<TrackKey, Clip[][]>, [clips]);

  // The clip blocks are memoised so the moving playhead does not re-render hundreds of clips.
  const body = useMemo(() => TRACKS.map((tr) => {
    const ls = byTrack[tr.key];
    const shown = ls.length ? ls.slice(0, tr.key === 'CC' ? 1 : 5) : [[]];
    return (
      <div key={tr.key} className={`relative border-b border-st-line ${hidden[tr.key] ? 'opacity-30' : ''}`} style={{ height: shown.length * LANE_H + 8 }}>
        {shown.map((lane, li) => lane.map((c) => (
          <button key={c.id} type="button" title={`${c.kind} · ${fmtTime(c.start)}–${fmtTime(c.end)}${c.text ? `\n${c.text}` : ''}`}
            onClick={(e) => { e.stopPropagation(); if (!locked[tr.key]) { setSel(c); seek(c.start); } }}
            className={`absolute rounded-[4px] border text-[10px] leading-[16px] px-1 truncate text-left text-white ${tr.color} ${sel?.id === c.id ? 'ring-2 ring-st-ink ring-offset-1' : ''} ${locked[tr.key] ? 'cursor-not-allowed' : 'hover:brightness-110'}`}
            style={{ left: c.start * pps, width: Math.max(2, (c.end - c.start) * pps - 1), top: 4 + li * LANE_H, height: LANE_H - 3 }}>
            {(c.end - c.start) * pps > 36 ? (tr.key === 'CC' ? c.text : `${c.kind}${c.text ? ` · ${c.text}` : ''}`) : ''}
          </button>
        )))}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [byTrack, pps, hidden, locked, sel]);

  return (
    <section className={`${card} lg:col-span-2 flex flex-col min-h-[200px] max-h-[340px] overflow-hidden`} aria-label="Timeline">
      <header className="flex items-center gap-2 px-3 h-10 border-b border-st-line shrink-0 text-xs">
        <span className="font-semibold text-st-ink">Timeline</span>
        <span className="text-st-mute tabular-nums">{fmtTime(t)} / {fmtTime(duration)}</span>
        {file && <span className="text-st-mute truncate hidden sm:inline">· from {file}{programName ? ` · plays ${programName}` : ''}</span>}
        <div className="flex-1" />
        <span className="hidden md:inline-flex items-center gap-1 text-st-mute cursor-help" title={'Space: play / pause\n← / →: previous / next cut\nAlt + scroll: zoom in / out\nShift + scroll: move left / right'}>
          <Keyboard size={14} aria-hidden /> Shortcuts
        </span>
        <button onClick={() => setZoom((z) => Math.max(1, (z || pps) / 1.6))} className="p-1 rounded text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Zoom out"><Minus size={14} /></button>
        <button onClick={() => setZoom(0)} className="px-1.5 py-0.5 rounded text-st-mute hover:text-st-ink hover:bg-st-surface">Fit</button>
        <button onClick={() => setZoom((z) => Math.min(400, (z || pps) * 1.6))} className="p-1 rounded text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Zoom in"><Plus size={14} /></button>
      </header>

      {!data ? (
        <p className="p-4 text-sm text-st-mute">The timeline fills in once the editor builds the edit (work/edit.json): cuts, whiteboard scenes, cards, captions, music and SFX, at their real times.</p>
      ) : (
        <div ref={scroller} className="flex-1 overflow-auto relative">
          <div className="flex" style={{ width: HEAD_W + total }}>
            {/* Track headers: name, eye (show/hide), lock, mute on audio */}
            <div className="sticky left-0 z-20 bg-white border-r border-st-line shrink-0" style={{ width: HEAD_W }}>
              <div className="h-6 border-b border-st-line" />
              {TRACKS.map((tr) => {
                const n = byTrack[tr.key].length ? Math.min(byTrack[tr.key].length, tr.key === 'CC' ? 1 : 5) : 1;
                return (
                  <div key={tr.key} className="flex items-center gap-1 px-2 border-b border-st-line text-xs" style={{ height: n * LANE_H + 8 }}>
                    <span className="font-semibold w-6">{tr.key}</span>
                    <span className="text-st-mute truncate flex-1 text-[11px]">{tr.name}</span>
                    <button onClick={() => setHidden((h) => ({ ...h, [tr.key]: !h[tr.key] }))} className="p-0.5 text-st-mute hover:text-st-ink" aria-label={hidden[tr.key] ? `Show ${tr.name}` : `Hide ${tr.name}`} title={hidden[tr.key] ? 'Show track' : 'Hide track'}>
                      {hidden[tr.key] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button onClick={() => setLocked((l) => ({ ...l, [tr.key]: !l[tr.key] }))} className={`p-0.5 hover:text-st-ink ${locked[tr.key] ? 'text-18-orange' : 'text-st-mute'}`} aria-label={locked[tr.key] ? `Unlock ${tr.name}` : `Lock ${tr.name}`} title={locked[tr.key] ? 'Unlock track' : 'Lock track'}>
                      {locked[tr.key] ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    {tr.audio && (
                      <button onClick={onMute} className={`p-0.5 hover:text-st-ink ${muted ? 'text-18-orange' : 'text-st-mute'}`} aria-label={muted ? 'Unmute audio' : 'Mute audio'} title={muted ? 'Unmute' : 'Mute'}>
                        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Ruler + lanes */}
            <div className="relative" style={{ width: total }} onClick={(e) => seek(xToSec(e))}>
              <div className="h-6 border-b border-st-line relative text-[10px] text-st-mute cursor-pointer bg-st-surface">
                {ticks.map((s) => (
                  <span key={s} className="absolute top-0 h-full border-l border-st-line/80 pl-1 tabular-nums" style={{ left: s * pps }}>{fmtTime(s).replace(/\.0$/, '')}</span>
                ))}
              </div>
              {body}
              <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-10" style={{ left: t * pps }}>
                <span className="absolute -top-0 -left-[5px] h-2.5 w-2.5 bg-red-500 rotate-45" />
              </div>
            </div>
          </div>
        </div>
      )}

      {sel && (
        <footer className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-st-line text-xs shrink-0 bg-st-surface">
          <span className="font-semibold">{sel.kind}</span>
          <span className="text-st-mute tabular-nums">{fmtTime(sel.start)}–{fmtTime(sel.end)}</span>
          <span className="truncate flex-1 min-w-[8rem]" title={sel.text}>{sel.text}</span>
          <button onClick={() => onAsk(sel)} className="inline-flex items-center gap-1 rounded-full bg-18-orange text-white px-2.5 py-1 font-medium hover:bg-[#E5601F]"><Sparkles size={12} aria-hidden /> Ask AI to change this</button>
          <button onClick={() => setSel(null)} className="p-1 text-st-mute hover:text-st-ink" aria-label="Clear selection"><X size={14} /></button>
        </footer>
      )}
    </section>
  );
}

// ---------- Claude sign-in for the editor ----------
// The editor runs Claude Code on this PC, and that copy needs its own sign-in.
// The bridge drives `claude auth login`: it opens the sign-in page in the browser
// and finishes by itself; if the page shows a code instead, it is pasted here.
type AuthStatus = { loggedIn: boolean; method: string | null; email: string | null; error?: string };
type LoginView = { state: 'idle' | 'waiting' | 'done' | 'failed'; url: string | null; message: string };

function Account({ bridge }: { bridge: Bridge }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [login, setLogin] = useState<LoginView>({ state: 'idle', url: null, message: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(() => bridge.call<AuthStatus>('/api/auth/status').then(setStatus).catch((e) => setError(e.message)), [bridge]);
  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    if (login.state !== 'waiting') return;
    const t = setInterval(async () => {
      const v = await bridge.call<LoginView>('/api/auth/login').catch(() => null);
      if (!v) return;
      setLogin(v);
      if (v.state === 'done') { setCode(''); check(); }
    }, 2000);
    return () => clearInterval(t);
  }, [login.state, bridge, check]);

  async function start(kind: 'claudeai' | 'console') {
    setBusy(true); setError('');
    try {
      const v = await bridge.call<LoginView>('/api/auth/login', { kind });
      setLogin(v);
      if (v.url) window.open(v.url, '_blank', 'noopener');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try { setLogin(await bridge.call<LoginView>('/api/auth/code', { code: code.trim() })); } catch (err) { setError((err as Error).message); }
  }
  async function cancel() { setLogin(await bridge.call<LoginView>('/api/auth/cancel', {}).catch(() => ({ state: 'idle', url: null, message: '' } as LoginView))); }
  async function signOut() {
    setBusy(true); setError('');
    try { setStatus(await bridge.call<AuthStatus>('/api/auth/logout', {})); setLogin({ state: 'idle', url: null, message: '' }); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (!status) return <p className="text-xs text-st-mute flex items-center gap-2"><Spinner /> Checking the editor&apos;s Claude sign-in…</p>;

  if (status.loggedIn)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 px-3 py-1 text-xs font-medium"><CheckCircle2 size={13} aria-hidden /> Editor signed in to Claude{status.email ? ` as ${status.email}` : ''}</span>
        <button onClick={signOut} disabled={busy} className="text-xs text-st-mute hover:text-st-ink underline-offset-2 hover:underline">Sign out</button>
        <ErrorNote text={error} />
      </div>
    );

  return (
    <section className={`${card} p-5 border-18-orange/40`}>
      <div className="flex items-center gap-2"><LogIn size={17} className="text-18-orange" aria-hidden /><h2 className="font-semibold">Sign the editor in to Claude</h2></div>
      <p className="text-sm text-st-mute mt-1.5 leading-relaxed">The editor runs Claude Code on this PC with your editing skills, and it needs its own sign-in once. Use the Claude account you edit with.</p>

      {login.state !== 'waiting' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => start('claudeai')} disabled={busy} className={btn}>{busy ? <Spinner /> : <LogIn size={15} aria-hidden />} Sign in with Claude</button>
          <button onClick={() => start('console')} disabled={busy} className={btnGhost}>Use an Anthropic Console account</button>
          {login.state === 'failed' && login.message && <p className="text-sm text-red-700 w-full">{login.message}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm flex items-center gap-2"><Spinner /> A Claude sign-in page has opened in a new tab. Finish signing in there; this updates by itself.</p>
          {login.url && <a href={login.url} target="_blank" rel="noreferrer" className={`${btnGhost} w-fit`}><ExternalLink size={15} aria-hidden /> Open the sign-in page again</a>}
          <form onSubmit={sendCode} className="flex flex-col sm:flex-row gap-2 max-w-xl">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="If the page shows a code, paste it here" className={field} aria-label="Sign-in code" autoComplete="off" spellCheck={false} />
            <button disabled={!code.trim()} className={`${btn} shrink-0`}>Submit code</button>
          </form>
          <button onClick={cancel} className="text-xs text-st-mute hover:text-st-ink">Cancel sign-in</button>
        </div>
      )}
      {status.error && <p className="text-xs text-st-mute mt-3">{status.error}</p>}
      <div className="mt-3"><ErrorNote text={error} /></div>
    </section>
  );
}

// ---------- chat with the editor (slides in from the right) ----------
function Chat({ events, running, busyElsewhere, error, onSay, bridge, id, draft, onDraftUsed, onClose, onStop }: {
  events: Ev[]; running: boolean; busyElsewhere: string | null; error: string; onSay: (t: string) => void; bridge: Bridge; id: string;
  draft: string; onDraftUsed: () => void; onClose: () => void; onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [ask, dialog] = useConfirm();
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [events.length, running]);
  useEffect(() => { if (draft) { setText(draft); onDraftUsed(); setTimeout(() => box.current?.focus(), 0); } }, [draft, onDraftUsed]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  // Collapse runs of tool calls into one "worked through" line each.
  const shown = useMemo(() => {
    const out: (Ev & { tools?: Ev[] })[] = [];
    for (const e of events) {
      const last = out[out.length - 1];
      if (e.kind === 'tool' && last?.kind === 'tool') last.tools!.push(e);
      else out.push(e.kind === 'tool' ? { ...e, tools: [e] } : e);
    }
    return out;
  }, [events]);

  const submit = () => { const t = text.trim(); if (!t || running) return; onSay(t); setText(''); };

  async function newChat() {
    if (!(await ask('Start a new conversation with the editor? It forgets this chat, but every file in the project stays.', 'New conversation', false))) return;
    await bridge.call(`/api/p/new-chat?id=${encodeURIComponent(id)}`, {}).catch(() => {});
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-[65] w-full sm:w-[440px] bg-white border-l border-st-line shadow-2xl flex flex-col" aria-label="Chat with the editor">
      {dialog}
      <header className="flex items-center gap-2 px-4 h-14 border-b border-st-line shrink-0">
        <Sparkles size={16} className="text-18-orange" aria-hidden />
        <h2 className="text-sm font-semibold flex-1">AI editor</h2>
        <span className={`h-2 w-2 rounded-full ${running ? 'bg-18-orange animate-pulse' : 'bg-emerald-500'}`} aria-hidden />
        <span className="text-xs text-st-mute">{running ? 'Working…' : 'Ready'}</span>
        <button onClick={newChat} disabled={running} className="p-1.5 rounded-md text-st-mute hover:text-st-ink hover:bg-st-surface disabled:opacity-40" aria-label="New conversation" title="New conversation"><MessageSquarePlus size={16} /></button>
        <button onClick={onClose} className="p-1.5 rounded-md text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Close chat"><X size={16} /></button>
      </header>

      <div ref={list} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm">
        {!shown.length && <p className="text-st-mute">The editor works the same way as editing in chat: it asks the intake questions, shows a plan, then a storyboard, then a preview, and exports the final only after you approve each step.</p>}
        {shown.map((e, i) => {
          if (e.kind === 'user') return <div key={i} className="ml-8 rounded-xl bg-18-orange/10 px-3.5 py-2.5 whitespace-pre-wrap">{e.text}</div>;
          if (e.kind === 'assistant') return <div key={i} className="mr-4"><Md text={e.text ?? ''} /></div>;
          if (e.kind === 'tool') return (
            <details key={i} className="text-xs text-st-mute">
              <summary className="cursor-pointer select-none">{e.tools!.length === 1 ? `${e.name}: ${e.text || ''}` : `Worked through ${e.tools!.length} steps`}</summary>
              <ul className="mt-1.5 space-y-1 pl-3 border-l border-st-line">{e.tools!.map((t, k) => <li key={k} className="break-words"><span className="font-medium">{t.name}</span> {t.text}</li>)}</ul>
            </details>
          );
          if (e.kind === 'error') return <ErrorNote key={i} text={e.text ?? ''} />;
          if (e.kind === 'note') return <p key={i} className="text-xs text-st-mute text-center">{e.text}</p>;
          if (e.kind === 'done') return <p key={i} className="text-[11px] text-st-mute/80">{e.ok ? 'Done' : 'Finished with an error'}{e.seconds ? ` in ${e.seconds >= 60 ? `${Math.round(e.seconds / 60)} min` : `${e.seconds} s`}` : ''}</p>;
          return null;
        })}
        {running && <p className="text-st-mute flex items-center gap-2"><Spinner /> Working…</p>}
      </div>

      <footer className="border-t border-st-line p-3 space-y-2 shrink-0">
        {busyElsewhere && !running && <p className="text-xs text-amber-700">The editor is busy with “{busyElsewhere}”. One edit runs at a time.</p>}
        <ErrorNote text={error} />
        <div className="flex gap-2 items-end">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={running ? 'The editor is working…' : 'Answer, approve, or ask for changes (e.g. “at 0:24 move the card to the left”)'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className={`${field} resize-none max-h-40`} aria-label="Message to the editor" />
          {running
            ? <button onClick={onStop} className={`${btnGhost} shrink-0`} aria-label="Stop"><Square size={15} aria-hidden /> Stop</button>
            : <button onClick={submit} disabled={!text.trim()} className={`${btn} shrink-0`} aria-label="Send"><Send size={15} aria-hidden /></button>}
        </div>
      </footer>
    </aside>
  );
}

// ---------- tiny markdown (plans are two-column tables) ----------
function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i} className="bg-st-surface rounded px-1 text-[0.9em]">{p.slice(1, -1)}</code> : <span key={i}>{p.replace(/<br\s*\/?>/gi, '\n')}</span>);
}

function Md({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="w-full text-sm border-collapse">
            <thead><tr>{head.map((c, k) => <th key={k} className="text-left font-semibold border-b border-st-line px-2 py-1.5 align-bottom">{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k} className="border-b border-st-line/60">{r.map((c, j) => <td key={j} className={`px-2 py-1.5 align-top whitespace-pre-wrap ${j === 0 ? 'whitespace-nowrap text-st-mute' : ''}`}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (/^#{1,4}\s/.test(l)) out.push(<p key={i} className="font-semibold mt-3 mb-1">{inline(l.replace(/^#+\s*/, ''))}</p>);
    else if (/^\s*([-*]|\d+\.)\s/.test(l)) out.push(<p key={i} className="pl-4 -indent-3 my-0.5 leading-relaxed">{/^\s*\d/.test(l) ? l.match(/^\s*\d+\./)![0] + ' ' : '• '}{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</p>);
    else if (l.trim()) out.push(<p key={i} className="my-1 leading-relaxed whitespace-pre-wrap">{inline(l)}</p>);
    else out.push(<div key={i} className="h-1.5" />);
  }
  return <div className="text-sm text-st-ink">{out}</div>;
}
