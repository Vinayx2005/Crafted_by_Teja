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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Gauge, ZoomIn, ZoomOut, CheckCircle2, Clapperboard, Clock, Flag, Keyboard, Magnet, MousePointer2, Trash2, Download, LayoutGrid, PenLine, Wand2, Eye, EyeOff, ExternalLink, FileText, Film, FolderPlus, Image as ImageIcon, Lock, LogIn, Maximize2,
  MessageSquare, MessageSquarePlus, Minus, Music, Play, Plug, Paperclip, Plus, RefreshCw, ScanSearch, Scissors, Send, Sparkles, Square, Unlock, Upload, Volume2, VolumeX, X,
} from 'lucide-react';
import { btn, btnGhost, card, ErrorNote, field, label, Spinner, useConfirm } from '../ui';
import type { SilenceFileKind } from './silence';
import SilenceHome, { type SilenceLink } from './silence-home';
import { warmSpeech } from '@/lib/studio/transcribe';
import type { Word } from '@/lib/studio/unwanted';
import type { Rec } from '@/lib/studio/silence-projects';

// The Silence remover's volume readings travel to the project folder as text.
const toB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

// "All changes saved" (with the time on hover), "Saving…", or why the last change was not saved.
function SaveStatus({ save }: { save: { state: 'idle' | 'saving' | 'saved' | 'error'; at?: number; error?: string } }) {
  if (save.state === 'saving') return <span className="inline-flex items-center gap-1.5 text-xs text-st-mute" role="status"><Spinner /> Saving…</span>;
  if (save.state === 'error') return <span className="inline-flex items-center gap-1.5 text-xs text-red-700 max-w-[16rem] truncate" role="status" title={save.error}><X size={13} aria-hidden /> Not saved: {save.error}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-st-mute" role="status"
      title={save.at ? `Last saved at ${new Date(save.at).toLocaleTimeString()}. Every change is saved to the project on this PC as you make it.` : 'Every change is saved to the project on this PC as you make it.'}>
      <CheckCircle2 size={13} className="text-emerald-600" aria-hidden /> All changes saved
    </span>
  );
}

const BRIDGE = 'http://127.0.0.1:4317';
const TOKEN_KEY = 'studio-editor-token';

type Step = { key: string; label: string; done: boolean };
type FileInfo = { name: string; path: string; size: number; modified: number; kind: 'video' | 'image' | 'audio' | 'text' | 'other' };
type SheetFrame = { path: string; t: number; modified: number };
type TextFile = { name: string; path: string; modified: number };
type Project = {
  id: string; name: string; group: string | null; updated: number;
  dir: string; linked: boolean; footage: number; final: boolean; preview: boolean; edit: boolean;
};
type Detail = {
  id: string; name: string; dir: string; steps: Step[]; raw: FileInfo[]; out: FileInfo[]; workImages: FileInfo[]; workText: TextFile[];
  frames?: SheetFrame[]; // the storyboard's single frames, in play order
  brief: string | null; plan: string | null; session: string | null;
  captionReview?: { text: string; modified: number } | null; // work/caption_review.md, the per-cue before/after table
  running: boolean; busyElsewhere: string | null;
};
type Ev = { at: number; kind: 'user' | 'assistant' | 'tool' | 'done' | 'error' | 'note' | 'state'; text?: string; name?: string; ok?: boolean; cost?: number | null; seconds?: number; running?: boolean };
type Conn = 'checking' | 'offline' | 'token' | 'ok';

// ---------- bridge client ----------
function useBridge() {
  const [token, setTokenState] = useState('');
  const [conn, setConn] = useState<Conn>('checking');
  const [error, setError] = useState('');

  // Connects by itself: the bridge hands its token to Studio pages (GET /api/pair), and this
  // browser keeps it. Nothing to copy or paste.
  const check = useCallback(async (saved: string) => {
    setConn('checking');
    try {
      await fetch(`${BRIDGE}/api/ping`).then((r) => { if (!r.ok) throw new Error(); });
    } catch {
      return setConn('offline');
    }
    const works = async (t: string) => !!t && !!(await fetch(`${BRIDGE}/api/health`, { headers: { 'X-Editor-Token': t } }).catch(() => null))?.ok;
    let t = saved;
    if (!(await works(t))) {
      const r = await fetch(`${BRIDGE}/api/pair`).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      t = j?.token ?? '';
      if (!(await works(t))) { setError('This page could not connect to the editor on this PC. Restart the editor and try again.'); return setConn('token'); }
      try { localStorage.setItem(TOKEN_KEY, t); } catch {}
    }
    setTokenState(t);
    setError('');
    setConn('ok');
  }, []);

  useEffect(() => {
    let t = '';
    try { t = localStorage.getItem(TOKEN_KEY) ?? ''; } catch {}
    check(t);
  }, [check]);

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

  return { token, conn, error, check: () => check(token), call, fileUrl };
}
type Bridge = ReturnType<typeof useBridge>;

// ---------- page ----------
// `onProjectOpen`: told whether a project is open, so the page can hide its own title then.
export default function VideoEditor({ actions, onProjectOpen }: { actions?: HTMLElement | null; onProjectOpen?: (open: boolean) => void }) {
  const bridge = useBridge();
  if (bridge.conn === 'checking') return <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Looking for the editor on this PC…</p>;
  if (bridge.conn === 'offline') return <Offline onRetry={bridge.check} />;
  if (bridge.conn === 'token') return <NoConnect error={bridge.error} onRetry={bridge.check} />;
  return <Editor bridge={bridge} actions={actions ?? null} onProjectOpen={onProjectOpen} />;
}

function NoConnect({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <section className={`${card} p-6 max-w-xl space-y-3`}>
      <h2 className="font-semibold">Could not connect</h2>
      <p className="text-sm text-st-mute leading-relaxed">{error} Close the Video Editor window on your PC, start it again, then press Try again.</p>
      <button onClick={onRetry} className={btn}><RefreshCw size={15} aria-hidden /> Try again</button>
    </section>
  );
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={`${card} p-6 max-w-2xl`}>
      <div className="flex items-center gap-2"><Plug size={18} className="text-18-orange" aria-hidden /><h2 className="font-semibold">Start the editor on your PC</h2></div>
      <p className="text-sm text-st-mute mt-2 leading-relaxed">
        The Video Editor edits on your own PC, so a small helper has to be running there. Open this page on that PC.
      </p>
      <ol className="mt-4 space-y-2 text-sm text-st-ink list-decimal pl-5">
        <li>Double-click <b>start.cmd</b> in <code>D:\Editing\editor-bridge</code>.</li>
        <li>Leave the window that opens running, then press <b>Try again</b>. The page connects by itself.</li>
      </ol>
      <button onClick={onRetry} className={`${btn} mt-5`}><RefreshCw size={15} aria-hidden /> Try again</button>
    </section>
  );
}

// ---------- editor frame: the projects page, or one project open ----------
// Like the Silence remover: the Video Editor opens on the list of projects. "Create new project"
// asks for a folder on this PC (the normal Windows "Select folder" window, which can also make a
// new folder); the whole edit then happens in that folder.
function Editor({ bridge, actions, onProjectOpen }: { bridge: Bridge; actions: HTMLElement | null; onProjectOpen?: (open: boolean) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A reload keeps the open project (this tab only: coming to the Video Editor again starts on the projects page).
  const [selected, setSelected] = useState(() => { try { return sessionStorage.getItem('studio-editor-open') ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (selected) sessionStorage.setItem('studio-editor-open', selected); else sessionStorage.removeItem('studio-editor-open'); } catch {} }, [selected]);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await bridge.call<{ projects: Project[]; busy: string | null }>('/api/projects');
      setProjects(r.projects);
      setBusy(r.busy);
      setSelected((s) => (s && r.projects.some((p) => p.id === s) ? s : ''));
    } catch (e) { setError((e as Error).message); }
  }, [bridge]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    setError('');
    setPicking(true);
    try {
      const r = await bridge.call<{ id?: string; cancelled?: boolean }>('/api/open-folder', { title: 'Choose the folder for this video project' });
      if (r.id) { await load(); setSelected(r.id); }
    } catch (e) { setError((e as Error).message); }
    finally { setPicking(false); }
  }, [bridge, load]);

  const open = selected && projects?.some((p) => p.id === selected) ? selected : '';
  useEffect(() => { onProjectOpen?.(!!open); }, [open, onProjectOpen]);
  useEffect(() => () => onProjectOpen?.(false), [onProjectOpen]);
  useEffect(() => {
    const home = () => { setSelected(''); load(); };
    window.addEventListener('studio-video-home', home);
    return () => window.removeEventListener('studio-video-home', home);
  }, [load]);
  const createButton = (
    <button onClick={create} disabled={picking} className={`${btn} !py-2 !min-h-[38px] !px-3`}>
      {picking ? <Spinner /> : <Plus size={14} aria-hidden />} {picking ? 'Choose a folder…' : 'Create new project'}
    </button>
  );

  return (
    <div className="space-y-3">
      {!open && actions && createPortal(createButton, actions)}
      {/* The Claude sign-in lives on the projects page. In a project it only shows when signed out. */}
      <Account bridge={bridge} quiet={!!open} />
      <ErrorNote text={error} />
      {picking && (
        <p className={`${card} p-3 text-sm flex items-center gap-2`} role="status">
          <Spinner /> Pick the folder for this project in the window that opened, or make a new one there with <b>New folder</b>. If you don&apos;t see the window, check the taskbar.
        </p>
      )}
      {open
        ? <Workspace key={open} id={open} bridge={bridge} project={projects!.find((p) => p.id === open)!} onBack={() => { setSelected(''); load(); }} onChanged={load} />
        : <ProjectsHome projects={projects} busy={busy} bridge={bridge} createButton={createButton} onOpen={setSelected} onChanged={load} />}
    </div>
  );
}

const ago = (t: number) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function ProjectsHome({ projects, busy, bridge, createButton, onOpen, onChanged }: {
  projects: Project[] | null; busy: string | null; bridge: Bridge; createButton: React.ReactNode; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState('');
  async function remove(p: Project) {
    const ok = await ask(`Remove "${p.name}" from the list? Only the link is removed: the folder ${p.dir} and everything in it stay on your PC, and you can add it again with Create new project.`, 'Remove from list', false);
    if (!ok) return;
    try { await bridge.call('/api/projects/remove', { id: p.id }); onChanged(); } catch (e) { setError((e as Error).message); }
  }
  if (projects === null) return <p className="flex items-center gap-2 text-sm text-st-mute"><Spinner /> Loading your projects…</p>;
  if (projects.length === 0)
    return (
      <div className={`${card} grid place-items-center gap-3 p-10 text-center`}>
        <Clapperboard size={28} className="text-st-mute" aria-hidden />
        <h2 className="font-semibold">No projects yet</h2>
        <p className="max-w-sm text-sm text-st-mute">Create a project, choose the folder on your PC where this video&apos;s edit should live, add the footage, and start editing. Nothing is uploaded.</p>
        {createButton}
      </div>
    );
  const status = (p: Project) => p.final ? 'Final ready' : p.preview ? 'Preview ready' : p.edit ? 'Being edited' : p.footage ? 'Footage added' : 'No footage yet';
  return (
    <>
      {dialog}
      <ErrorNote text={error} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {projects.map((p) => (
          <li key={p.id} className={`${card} flex flex-col justify-between gap-4 p-4`}>
            <button onClick={() => onOpen(p.id)} className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40">
              <h3 className="truncate font-semibold">{p.name}</h3>
              <p className="mt-0.5 truncate text-xs text-st-mute" title={p.dir}>{p.group ? `${p.group} · ` : ''}{p.dir}</p>
              <p className="mt-2 text-sm">
                {status(p)}{busy === p.id && <span className="ml-1.5 rounded-full bg-18-orange/10 text-18-orange px-2 py-0.5 text-[11px] font-medium">working now</span>}
              </p>
              <p className="mt-1 text-xs text-st-mute">{p.footage} {p.footage === 1 ? 'video' : 'videos'} of footage · Edited {ago(p.updated)}</p>
            </button>
            <div className="flex items-center justify-between">
              <button onClick={() => onOpen(p.id)} className={`${btnGhost} !min-h-[38px] !px-3`}>Open</button>
              {p.linked && (
                <button onClick={() => remove(p)} aria-label={`Remove ${p.name} from the list`} title="Remove from the list (keeps the folder)" className={`${btnGhost} !min-h-[38px] !px-2.5`}><Trash2 size={15} aria-hidden /></button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="pt-1">{createButton}</div>
    </>
  );
}

// ---------- one project: the editor screen ----------
// timeline: the player is playing the timeline (the footage cuts in order), not the whole file.
type View = { kind: 'video' | 'image' | 'audio'; path: string; name: string; play?: boolean; start?: number; timeline?: boolean } | { kind: 'doc'; path: string; name: string; text?: string | null };

// The timeline's clock, shared with the player's own controls without re-rendering the whole page.
type TlClock = { t: number; duration: number };
function makeClock() {
  let state: TlClock = { t: 0, duration: 0 };
  const subs = new Set<() => void>();
  let seekFn: ((t: number) => void) | null = null;
  return {
    get: () => state,
    set: (n: TlClock) => { if (n.t === state.t && n.duration === state.duration) return; state = n; subs.forEach((f) => f()); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    seek: (t: number) => seekFn?.(t),
    setSeek: (f: (t: number) => void) => { seekFn = f; },
  };
}
type Clock = ReturnType<typeof makeClock>;

// The live preview (the real Edit composition in a Remotion Player, served by the bridge in an
// iframe): its state, and the commands sent to it. Commands sent before it is ready wait.
type LiveState = { t: number; playing: boolean; duration: number; ready: boolean; error: string | null };
function makeLive() {
  let state: LiveState = { t: 0, playing: false, duration: 0, ready: false, error: null };
  const subs = new Set<() => void>();
  let win: Window | null = null;
  let waiting: Record<string, unknown>[] = [];
  const set = (n: Partial<LiveState>) => { state = { ...state, ...n }; subs.forEach((f) => f()); };
  const post = (m: Record<string, unknown>) => {
    if (win && state.ready) win.postMessage(m, BRIDGE);
    else if (m.type === 'seek') waiting = [...waiting.filter((x) => x.type !== 'seek'), m];
    else if (m.type !== 'props') waiting.push(m);
  };
  return {
    get: () => state,
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    set,
    // The iframe loaded (or went away). Ready comes from the page itself.
    attach: (w: Window | null) => { win = w; set({ ready: false, playing: false }); },
    ready: (w: Window, props: unknown) => {
      win = w;
      set({ ready: true, error: null });
      win?.postMessage({ type: 'props', props }, BRIDGE);
      const q = waiting; waiting = [];
      q.forEach((m) => win?.postMessage(m, BRIDGE));
    },
    post,
    seek: (t: number) => { set({ t }); post({ type: 'seek', t }); },
    toggle: () => post({ type: 'toggle' }),
    pause: () => post({ type: 'pause' }),
  };
}
type Live = ReturnType<typeof makeLive>;
const LIVE_KEY = 'studio-editor-live';

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
// Skills that are tools of the edit, not a look: everything else in ~/.claude/skills is offered as a Style.
const NOT_STYLE = (n: string) => n === 'long-form-whiteboard-animation' || n === 'telugu-captions' || n === 'resolve-handoff' || n.startsWith('remotion-');
const BRIEF_DEFAULT: Brief = Object.fromEntries(BRIEF_QUESTIONS.map((q) => [q.key, q.options[0]]));

function draftPrompt(id: string, b: Brief, savedBrief: boolean) {
  const lines = BRIEF_QUESTIONS.map((q) => `- ${q.label}: ${b[q.key]}`);
  if (b.length) lines.push(`- Target length: ${b.length}`);
  if (/ skill$/.test(b.style ?? '')) lines.push(`- Load the ${b.style.replace(/ skill$/, '')} skill (C:/Users/vinay/.claude/skills) and use it as the style, together with the long-form-whiteboard-animation rules.`);
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
// "Save this for future videos too": after fixing this video, write the change into the skill as
// a general rule (not this video's times or words), rebuild Skills.docx as D:\Editing\CLAUDE.md
// says, and say exactly what was written.
const SKILL_NOTE = `\n\nAlso save this for future videos: once this video is changed, update the long-form-whiteboard-animation skill (or the skill this change belongs to) so every future video follows it. Write it as a general rule in the right place of the skill, not as this video's times, words or file names, and don't duplicate or contradict a rule that is already there; if it conflicts with one, change that rule instead. Rebuild Skills.docx as CLAUDE.md says. Then tell me, in a short separate part of your reply, the exact rule you added or changed and in which skill file.`;

// A storyboard exists, however it was asked for (the 1st draft button or Ask AI): its single
// frames, or a storyboard sheet in out/ or work/.
const hasBoard = (d: Detail) => (d.frames?.length ?? 0) > 0 || [...d.out, ...d.workImages].some((f) => f.kind === 'image' && /storyboard/i.test(f.name));
// Storyboard sheets: images in out/ (and work/) named like the skill's sheets.
const isSheet = (f: FileInfo) => f.kind === 'image' && /storyboard|scenes|finished|frames|transition|sheet/i.test(f.name);

function Workspace({ id, bridge, project, onBack, onChanged }: { id: string; bridge: Bridge; project: Project; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<{ file: string | null; composition?: string; modified?: number; data: Record<string, unknown> | null; silence?: SilenceSource | null; unwanted?: SilenceSource | null } | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [tlNote, setTlNote] = useState<{ text: string; error?: boolean; undo?: boolean } | null>(null);
  // Magnetic timeline: a per-browser preference, on unless turned off.
  const [magnetic, setMagnetic] = useState(true);
  useEffect(() => { try { setMagnetic(localStorage.getItem('studio-editor-magnetic') !== '0'); } catch {} }, []);
  const toggleMagnetic = () => setMagnetic((m) => { try { localStorage.setItem('studio-editor-magnetic', m ? '0' : '1'); } catch {} return !m; });
  // Markers on the timeline, kept with the project (work/editor/state.json).
  const [markers, setMarkers] = useState<number[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [silenceOpen, setSilenceOpen] = useState<false | 'silence' | 'unwanted'>(false);
  // Closing the popup only hides it: work in progress (reading the sound, listening to the words) goes
  // on, and opening it again shows it as it was (playhead, zoom, selection). One per mode, kept while it
  // still points at the same video and part; otherwise a fresh one opens (and loads the saved session).
  const [silenceKept, setSilenceKept] = useState<{ mode: 'silence' | 'unwanted'; sig: string }[]>([]);
  const [firstDraft, setFirstDraft] = useState<FirstDraft | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  // Saving: every change is written to the project on this PC straight away (edit.json, markers, the
  // Silence remover's sessions…). This shows that it happened, or that it could not.
  const [save, setSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: number; error?: string }>({ state: 'idle' });
  const saving = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    setSave({ state: 'saving' });
    try { const r = await p; setSave({ state: 'saved', at: Date.now() }); return r; }
    catch (e) { setSave({ state: 'error', error: (e as Error).message }); throw e; }
  }, []);

  // Where you were (the file in the player, the playhead), kept with the project so it reopens there.
  type Ui = { view?: { path: string; name: string; timeline?: boolean }; t?: number };
  const [ui, setUi] = useState<Ui | null | undefined>(undefined); // undefined: still loading

  // Where the 1st draft stands, the markers and where you were, kept by the bridge in work/editor/state.json.
  useEffect(() => {
    bridge.call<{ firstDraft?: FirstDraft; markers?: number[]; ui?: Ui }>(`/api/p/state?id=${encodeURIComponent(id)}`)
      .then((s) => { setFirstDraft(s.firstDraft ?? null); setMarkers(Array.isArray(s.markers) ? s.markers : []); setUi(s.ui ?? null); })
      .catch(() => setUi(null));
  }, [bridge, id]);
  const saveDraft = useCallback((fd: FirstDraft | null) => {
    setFirstDraft(fd);
    saving(bridge.call(`/api/p/state?id=${encodeURIComponent(id)}`, { firstDraft: fd })).catch(() => {});
  }, [bridge, id, saving]);

  // Edit tab: changes show at once (the timeline data, so the live preview too) and are saved
  // 0.6 s after the last one, as one Undo step. Changes not saved yet survive a reload of the files.
  const pendingRef = useRef<{ pick: Pick; sets: Map<string, SetOp> } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pick, setPick] = useState<Picked | null>(null);
  // Color tab "Before": the preview shows the footage with no grade (nothing is changed or saved).
  const [before, setBefore] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [detail, tl] = await Promise.all([
        bridge.call<Detail>(`/api/p/detail?id=${encodeURIComponent(id)}`),
        bridge.call<{ file: string | null; data: Record<string, unknown> | null }>(`/api/p/timeline?id=${encodeURIComponent(id)}`).catch(() => ({ file: null, data: null })),
      ]);
      setD(detail);
      const wait = pendingRef.current;
      setTimeline(wait && tl.data ? { ...tl, data: applySets(tl.data, wait.pick, [...wait.sets.values()]) } : tl);
    } catch (e) { setError((e as Error).message); }
  }, [bridge, id]);

  const flushEdits = useCallback(async () => {
    clearTimeout(flushTimer.current);
    const w = pendingRef.current;
    if (!w) return;
    pendingRef.current = null;
    try {
      await saving(bridge.call(`/api/p/timeline-edit?id=${encodeURIComponent(id)}`, { op: 'set', key: w.pick.key, index: w.pick.index, sets: [...w.sets.values()] }));
      setTlNote({ text: 'Change saved.', undo: true }); // Undo here puts back how it was before this change
    } catch (e) { setTlNote({ text: `Not saved: ${(e as Error).message}`, error: true }); void refresh(); }
  }, [bridge, id, saving, refresh]);
  const flushRef = useRef(flushEdits);
  flushRef.current = flushEdits;
  useEffect(() => () => { void flushRef.current(); }, []);
  const patch = useCallback((at: Pick, sets: SetOp[]) => {
    setTimeline((t) => (t?.data ? { ...t, data: applySets(t.data, at, sets) } : t));
    const w = pendingRef.current;
    if (w && (w.pick.key !== at.key || w.pick.index !== at.index)) void flushRef.current();
    const cur = pendingRef.current ?? (pendingRef.current = { pick: at, sets: new Map() });
    sets.forEach((x) => cur.sets.set(JSON.stringify(x.path), x));
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flushRef.current(), 600);
  }, []);

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
  // There is no Refresh button: coming back to this tab (or window) reads the files again, so files
  // added to the folder outside the app show up.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, [refresh]);

  // The rendered video the timeline belongs to: the newest final, else the newest preview.
  const program = useMemo(() => {
    const vids = d?.out.filter((f) => f.kind === 'video') ?? [];
    return vids.find((f) => !/preview|phone/i.test(f.name)) ?? vids.find((f) => /preview/i.test(f.name)) ?? vids[0] ?? null;
  }, [d]);

  // The timeline opens files in the player at a given moment (the cut under a click, the next cut).
  const openAt = useCallback((path: string, start: number, play: boolean) =>
    setView({ kind: 'video', path, name: path.split('/').pop() || path, start, play, timeline: true }), []);
  const clock = useMemo(makeClock, []);
  const live = useMemo(makeLive, []);
  // Graphics on: the timeline plays in the live preview (with whiteboards, cards, captions).
  // Off: the footage cuts only (lighter, and the volume meter follows it).
  const [graphics, setGraphics] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(LIVE_KEY) === 'off') setGraphics(false); } catch { /* default on */ } }, []);
  const toggleGraphics = () => setGraphics((g) => { try { localStorage.setItem(LIVE_KEY, g ? 'off' : 'on'); } catch { /* ignore */ } return !g; });

  // The first footage cut, to play the timeline from the start.
  const firstCut = useMemo(() => {
    const segs = Array.isArray(timeline?.data?.segments) ? (timeline!.data!.segments as unknown[]).filter(isObj) : [];
    const s = segs[0];
    const prefix = `projects/${id}/`;
    const src = s && typeof s.src === 'string' ? s.src.replace(/\\/g, '/') : '';
    return src.startsWith(prefix) ? { path: src.slice(prefix.length), from: num(s.from) ?? 0 } : null;
  }, [timeline, id]);
  const programFresh = !!program && !!timeline?.modified && program.modified >= timeline.modified - 2000;
  const tlView = view?.kind === 'video' && !!view.timeline;
  // The live preview draws the Edit composition (edit.json) and the Testimonial one (testimonial.json).
  const isTestimonial = timeline?.composition === 'Testimonial' || timeline?.file === 'work/testimonial.json';
  const canLive = !!timeline?.data && Number(timeline.data.durationInFrames) > 0
    && ((timeline.file === 'work/edit.json' && Array.isArray(timeline.data.segments)) || (isTestimonial && typeof timeline.data.src === 'string'));
  const liveOn = tlView && canLive && graphics;
  useEffect(() => { if (liveOn) video?.pause(); else live.pause(); }, [liveOn, video, live]);
  useEffect(() => { live.post({ type: 'mute', muted }); }, [live, muted]);
  // Graphics on / off keeps the playhead where it was.
  const lastLive = useRef(liveOn);
  useEffect(() => {
    if (lastLive.current === liveOn) return;
    lastLive.current = liveOn;
    const t = clock.get().t;
    const h = setTimeout(() => clock.seek(t), 300);
    return () => clearTimeout(h);
  }, [liveOn, clock]);
  const playTimeline = useCallback(() => { if (firstCut) openAt(firstCut.path, firstCut.from, false); }, [firstCut, openAt]);

  // Open something in the player on first load: an up-to-date render of the edit, else the
  // timeline itself (its footage cuts), else the render, else the first raw video.
  const restoreT = useRef<number | null>(null);
  useEffect(() => {
    if (!d || view || !timeline || ui === undefined) return;
    // Reopen where you left off, if that file is still there.
    const v = ui?.view;
    const exists = (p: string) => d.raw.some((f) => f.path === p) || d.out.some((f) => f.path === p);
    if (v && exists(v.path)) {
      if (v.timeline) { restoreT.current = ui?.t ?? 0; return setView({ kind: 'video', path: v.path, name: v.name, timeline: true }); }
      return setView({ kind: 'video', path: v.path, name: v.name, start: ui?.t ?? 0 });
    }
    if (program && programFresh) return setView({ kind: 'video', path: program.path, name: program.name });
    if (firstCut) return playTimeline();
    const first = program ?? d.raw.find((f) => f.kind === 'video');
    if (first) setView({ kind: 'video', path: first.path, name: first.name });
  }, [d, view, timeline, program, programFresh, firstCut, playTimeline, ui]);
  // Timeline preview reopened: put the playhead back once the timeline is ready.
  useEffect(() => {
    if (restoreT.current == null || !view || view.kind !== 'video' || !view.timeline || !timeline?.data) return;
    const t = restoreT.current;
    restoreT.current = null;
    const h = setTimeout(() => clock.seek(t), 400);
    return () => clearTimeout(h);
  }, [view, timeline, clock]);
  // Keep where you are: every couple of seconds if it changed, and when leaving the project.
  const uiNow = useRef<() => Ui>(() => ({}));
  uiNow.current = () => ({
    view: view && view.kind === 'video' ? { path: view.path, name: view.name, timeline: !!view.timeline } : undefined,
    t: Math.round((view && view.kind === 'video' && view.timeline ? clock.get().t : video?.currentTime ?? 0) * 10) / 10,
  });
  useEffect(() => {
    if (ui === undefined) return;
    let last = JSON.stringify(ui ?? {});
    const put = () => {
      const now = JSON.stringify(uiNow.current());
      if (now === last) return;
      last = now;
      bridge.call(`/api/p/state?id=${encodeURIComponent(id)}`, { ui: JSON.parse(now) }).catch(() => {});
    };
    const h = setInterval(put, 2000);
    return () => { clearInterval(h); put(); };
  }, [ui === undefined, bridge, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (video) video.muted = muted; }, [video, muted]);

  // What the Silence remover works on: only what is on the timeline. One continuous piece of one
  // file -> that file, limited to that part (range). Several cuts -> the bridge first joins the
  // timeline's footage into one video (build). No timeline yet -> the preview video, else raw footage.
  const freshSource = useMemo<SilenceSource | null>(() => {
    const data = timeline?.data;
    const prefix = `projects/${id}/`;
    const segs = (Array.isArray(data?.segments) ? (data!.segments as unknown[]) : []).filter(isObj).map((x) => {
      const src = typeof x.src === 'string' ? x.src.replace(/\\/g, '/') : '';
      return { rel: src.startsWith(prefix) ? src.slice(prefix.length) : null, from: num(x.from) ?? 0, to: num(x.to) ?? 0 };
    });
    if (segs.length && segs.every((x) => x.rel)) {
      const tlStart = num(data?.introPreroll) ?? 0;
      const oneRun = segs.every((x, i) => i === 0 || (x.rel === segs[i - 1].rel && Math.abs(x.from - segs[i - 1].to) < 0.05));
      const p = segs[0].rel!;
      if (oneRun) return { path: p, name: p.split('/').pop() ?? p, from: 'timeline', range: { start: segs[0].from, end: segs[segs.length - 1].to }, tlStart };
      // Where each stretch of the joined video comes from, so words heard before can be reused.
      let at = 0;
      const cuts = segs.map((x) => { const c = { path: x.rel!, from: x.from, to: x.to, at }; at += x.to - x.from; return c; });
      return { path: '', name: 'the timeline footage', from: 'timeline', build: true, tlStart, cuts };
    }
    // One continuous source and no cuts (the Testimonial layout): that file is the timeline footage.
    const one = typeof data?.src === 'string' ? data.src.replace(/\\/g, '/') : '';
    if (!segs.length && one.startsWith(prefix)) {
      const p = one.slice(prefix.length);
      return { path: p, name: p.split('/').pop() ?? p, from: 'timeline', tlStart: 0 };
    }
    if (view && view.kind === 'video') return { path: view.path, name: view.name, from: 'preview' as const };
    const raw = d?.raw.find((f) => f.kind === 'video');
    return raw ? { path: raw.path, name: raw.name, from: 'footage' as const } : null;
  }, [timeline, view, d, id]);
  // The timeline is exactly what the last "Apply to timeline" of that tool made: reopen that session, with its work.
  // Remove pauses & fillers and Find unwanted parts each remember their own.
  const timelineSource = useMemo<SilenceSource | null>(() => (timeline?.silence?.path ? { ...timeline.silence, from: 'timeline', build: false, applied: true } : freshSource), [timeline, freshSource]);
  const sourceSig = (x: SilenceSource | null) => (x ? `${x.path}|${x.range?.start ?? ''}|${x.range?.end ?? ''}|${x.build ? 'build' : ''}` : '');
  const openSilence = (mode: 'silence' | 'unwanted') => {
    const sig = sourceSig(mode === 'unwanted' ? unwantedSource : timelineSource);
    setSilenceKept((k) => (k.some((x) => x.mode === mode && x.sig === sig) ? k : [...k.filter((x) => x.mode !== mode), { mode, sig }]));
    setSilenceOpen(mode);
  };
  const unwantedSource = useMemo<SilenceSource | null>(() => (timeline?.unwanted?.path ? { ...timeline.unwanted, from: 'timeline', build: false, applied: true } : freshSource), [timeline, freshSource]);

  // The player panel is exactly as wide as its frame (1920×1080 scaled to the row height),
  // so there is no empty space beside the video; the media panel takes the rest of the width.
  const vertical = timeline?.data?.format === '9:16' || timeline?.composition === 'Testimonial' || timeline?.file === 'work/testimonial.json';
  const gridRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLElement>(null);
  const [playerW, setPlayerW] = useState<number | null>(null);
  useEffect(() => {
    const g = gridRef.current, m = mediaRef.current;
    if (!g || !m) return;
    const [fw, fh] = [16, 9]; // the box is always 16:9; a vertical (9:16) edit sits in it with black at the sides
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
    // "export it", "export the preview"…: export is not the AI's job, so open Export (and start it) here.
    const ex = exportAsk(text);
    if (ex) { setExportAsk({ mode: ex, n: Date.now() }); return; }
    try { await bridge.call('/api/p/message?id=' + encodeURIComponent(id), { text }); setRunning(true); onChanged(); }
    catch (e) { setError((e as Error).message); }
  }
  const [exportReq, setExportAsk] = useState<{ mode: 'final' | 'preview'; n: number } | null>(null);
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
  function sendChanges(text: string, forFuture = false) {
    setChangesOpen(false);
    setBoardOpen(false);
    const st = firstDraft?.stage;
    if (st === 'storyboard' || st === 'storyboard-working') saveDraft({ ...firstDraft!, stage: 'storyboard-working', startedAt: Date.now() });
    else if (st === 'draft' || st === 'draft-working') saveDraft({ ...firstDraft!, stage: 'draft-working', draftStartedAt: Date.now() });
    say(changesPrompt(st, text) + (forFuture ? SKILL_NOTE : ''));
  }

  if (!d) return error ? <ErrorNote text={error} /> : <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Opening…</p>;

  const onProgram = !!program && view?.kind === 'video' && view.path === program.path;
  const askAboutClip = (c: Clip) => {
    setDraft(`About the ${c.kind.toLowerCase()} at ${fmtTime(c.start)}–${fmtTime(c.end)}${c.text ? ` ("${c.text.slice(0, 80)}")` : ''}: `);
    setChatOpen(true);
  };

  return (
    <div className="space-y-3 -mt-3 md:-mt-5"> {/* up into the page's top padding: less empty space above the title */}
      {/* Title row: the project's name (its folder on hover), then save status and Export on the right.
          Back to the projects: the Video Editor icon in the left rail. */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 min-w-0 text-xl font-semibold tracking-tight truncate" title={project.dir}>{project.name}</h1>
        <SaveStatus save={save} />
        <ExportButton id={id} bridge={bridge} onDone={refresh} ask={exportReq}
          onPlay={(p) => setView({ kind: 'video', path: p, name: p.split('/').pop() || p, play: true })} />
      </div>
      <ErrorNote text={error} />

      {/* Editor grid, as sketched: media | player | meter, then AI features, then the timeline. */}
      <div ref={gridRef} className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(240px,1fr)_auto_64px] lg:grid-rows-[minmax(300px,1fr)_auto_auto] lg:h-[calc(100vh-12.25rem)] lg:min-h-[640px]">
        <MediaPanel boxRef={mediaRef} d={d} bridge={bridge} view={view} onOpen={setView} onChanged={refresh}
          pickKey={pick ? `${pick.key}:${pick.index}` : ''}
          editPanel={<EditPanel data={timeline?.data ?? null} pick={pick} onSet={(sets) => pick && patch(pick, sets)} />}
          colorPanel={<ColorPanel data={timeline?.data ?? null} pick={pick} onSet={(at, sets) => { setBefore(false); patch(at, sets); }}
            before={before} onBefore={() => setBefore((b) => !b)} canCompare={liveOn} />} />
        <Viewer width={playerW} d={d} bridge={bridge} view={view} onVideo={setVideo} program={program} vertical={vertical}
          onProgram={() => program && setView({ kind: 'video', path: program.path, name: program.name })}
          clock={clock} canPlayTimeline={!!firstCut} onPlayTimeline={playTimeline}
          live={liveOn ? live : null} liveProps={liveOn ? (before && timeline?.data ? ungraded(timeline.data) : timeline?.data ?? null) : null} badge={before && liveOn ? 'Before: no colour grade' : null} canLive={tlView && canLive} liveAvailable={canLive} graphics={graphics} onGraphics={toggleGraphics} />
        <div className="hidden lg:block lg:row-span-3 lg:col-start-3 lg:row-start-1"><Meter video={video} muted={muted} onMute={() => setMuted((m) => !m)} /></div>
        <AiBar running={running} busyElsewhere={d.busyElsewhere} draft={firstDraft} chatOpen={chatOpen} unread={!chatOpen && events.length > 0 && events[events.length - 1].kind === 'assistant'}
          captionChanges={d.captionReview ? parseCaptionReview(d.captionReview.text).reduce((n, x) => n + x.rows.length, 0) : null}
          onFeature={(f) => (f.key === 'cut' ? openSilence('silence') : f.key === 'unwanted' ? openSilence('unwanted') : f.key === 'captions' && d.captionReview ? setCaptionsOpen(true) : say(f.text(id)))} onDraft={() => setBriefOpen(true)} onStoryboard={() => setBoardOpen(true)} hasBoard={hasBoard(d)}
          onChanges={() => setChangesOpen(true)} onChat={() => setChatOpen((o) => !o)} onStop={stop} />
        <Timeline data={timeline?.data ?? null} file={timeline?.file ?? null} srcPrefix={`projects/${id}/`} video={video} player={video}
          viewPath={view?.kind === 'video' ? view.path : null} programPath={program?.path ?? null} programName={program?.name ?? null}
          programFresh={programFresh} clock={clock} timelineMode={view?.kind === 'video' && !!view.timeline} live={liveOn ? live : null}
          onOpen={openAt} muted={muted} onMute={() => setMuted((m) => !m)} onAsk={askAboutClip}
          notice={tlNote} onDismiss={() => setTlNote(null)}
          magnetic={magnetic} onMagnetic={toggleMagnetic}
          markers={markers} onMarkers={(m) => { setMarkers(m); saving(bridge.call(`/api/p/state?id=${encodeURIComponent(id)}`, { markers: m })).catch(() => {}); }}
          onPick={setPick}
          onEdit={async (ed) => {
            setPick(null);
            try {
              const r = await saving(bridge.call<{ message: string }>(`/api/p/timeline-edit?id=${encodeURIComponent(id)}`, { ...ed, magnetic }));
              setTlNote({ text: r.message, undo: true });
              await refresh();
            } catch (e) { setTlNote({ text: (e as Error).message, error: true }); }
          }}
          onDropMedia={async (m, track, at) => {
            try {
              const r = await saving(bridge.call<{ message: string }>(`/api/p/timeline-add?id=${encodeURIComponent(id)}`, { path: m.path, track, at, magnetic }));
              setTlNote({ text: r.message, undo: true });
              await refresh();
            } catch (e) { setTlNote({ text: (e as Error).message, error: true }); }
          }}
          onUndo={async () => {
            try {
              await saving(bridge.call(`/api/p/timeline-undo?id=${encodeURIComponent(id)}`, {}));
              setTlNote({ text: 'Undone: the timeline is back to how it was.' });
              await refresh();
            } catch (e) { setTlNote({ text: (e as Error).message, error: true }); }
          }} />
      </div>

      {briefOpen && <BriefDialog bridge={bridge} name={d.name} savedBrief={!!d.brief} onClose={() => setBriefOpen(false)} onStart={startDraft} />}
      {captionsOpen && d.captionReview && <CaptionsDialog d={d} bridge={bridge} review={d.captionReview} blocked={running || !!d.busyElsewhere}
        onClose={() => setCaptionsOpen(false)}
        onRemake={() => { setCaptionsOpen(false); say(AI_FEATURES.find((f) => f.key === 'captions')!.text(id)); }}
        onJump={(t) => { setCaptionsOpen(false); if (firstCut && !(view?.kind === 'video' && view.timeline)) playTimeline(); setTimeout(() => clock.seek(t), 400); }} />}
      {boardOpen && <StoryboardDialog d={d} bridge={bridge} draft={firstDraft} running={running} onClose={() => setBoardOpen(false)}
        onApprove={approveStoryboard} onChanges={() => setChangesOpen(true)} />}
      {changesOpen && <ChangesDialog stage={firstDraft?.stage} at={video && view?.kind === 'video' ? video.currentTime : null} atName={view?.name ?? ''}
        onClose={() => setChangesOpen(false)} onSend={sendChanges} />}

      {silenceKept.map(({ mode: m, sig }) => <SilencePopup key={`${m}:${sig}`} mode={m} visible={silenceOpen === m} d={d} bridge={bridge} source={m === 'unwanted' ? unwantedSource : timelineSource} magnetic={magnetic} onClose={() => setSilenceOpen(false)} onSaved={refresh}
        onApplied={(text) => { setSilenceOpen(false); setTlNote({ text, undo: true }); setSave({ state: 'saved', at: Date.now() }); refresh(); }} onSaving={saving}
        onUse={(text) => { setSilenceOpen(false); say(text); }} onOpenFile={(f) => setView({ kind: 'video', path: f, name: f.split('/').pop() ?? f, play: true })} />)}

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
type SilenceSource = {
  path: string; name: string; from: 'timeline' | 'preview' | 'footage';
  range?: { start: number; end: number } | null; // the part of the file the timeline uses (file seconds)
  tlStart?: number; // where that footage starts on the timeline
  cuts?: { path: string; from: number; to: number; at: number }[]; // joined footage: where each stretch comes from
  build?: boolean; // several cuts: join the timeline's footage into one video first
  applied?: boolean; // the timeline is what this session's last Apply made
};
function SilencePopup({ mode, visible, d, bridge, source, magnetic, onClose, onSaved, onApplied, onSaving, onUse, onOpenFile }: {
  mode: 'silence' | 'unwanted'; visible: boolean; d: Detail; bridge: Bridge; source: SilenceSource | null; magnetic: boolean;
  onClose: () => void; onSaved: () => void; onApplied: (text: string) => void; onSaving: <T>(p: Promise<T>) => Promise<T>; onUse: (text: string) => void; onOpenFile: (path: string) => void;
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  // The video is fixed for as long as the popup is open. Several cuts: wait for the joined footage.
  const [src, setSrc] = useState<SilenceSource | null>(source?.build ? null : source);
  const [building, setBuilding] = useState<{ pct: number; error?: string } | null>(source?.build ? { pct: 0 } : null);
  // Load the speech model now, so "Find unwanted parts" does not wait for it later.
  useEffect(() => { warmSpeech(); }, []);
  useEffect(() => {
    if (!source?.build) return;
    let stop = false;
    const url = `/api/p/timeline-footage?id=${encodeURIComponent(d.id)}`;
    (async () => {
      try {
        let st = await bridge.call<{ state: string; pct: number; path: string; error?: string }>(url, {});
        while (!stop && st.state === 'running') {
          setBuilding({ pct: st.pct });
          await new Promise((r) => setTimeout(r, 1000));
          st = await bridge.call(url);
        }
        if (stop) return;
        if (st.state !== 'done') throw new Error(st.error || 'Could not join the timeline footage.');
        setBuilding(null);
        setSrc({ ...source, path: st.path, name: 'Timeline footage', build: false, range: null });
      } catch (e) { if (!stop) setBuilding({ pct: 0, error: (e as Error).message }); }
    })();
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const link = useMemo<SilenceLink>(() => ({
    editorId: d.id,
    mode: mode === 'unwanted' ? 'unwanted' : undefined,
    source: src ? { path: src.path, name: src.name, range: src.range ?? null, cuts: src.cuts } : undefined,
    // Whisper on this PC's graphics card, through the bridge (falls back to the browser if missing).
    transcribe: async (path, range, onStage) => {
      const id = encodeURIComponent(d.id);
      let st = await bridge.call<{ key: string; state: string; stage: string; pct: number; words: Word[] | null; error: string | null }>(
        `/api/p/transcribe?id=${id}`, { path, start: range?.start ?? 0, end: range?.end ?? 0 });
      while (st.state === 'running') {
        onStage(st.stage, st.pct);
        await new Promise((r) => setTimeout(r, 700));
        st = { ...(await bridge.call<typeof st>(`/api/p/transcribe?id=${id}&key=${encodeURIComponent(st.key)}`)), key: st.key };
      }
      if (st.state !== 'done' || !st.words) throw new Error(st.error || 'The speech engine did not finish.');
      return st.words;
    },
    // Every auto-save of the session also goes into the project folder (work/editor/silence/).
    saveSession: (rec) => { onSaving(bridge.call(`/api/p/silence-session?id=${encodeURIComponent(d.id)}`, { rec: { ...rec, vol: rec.vol ? toB64(rec.vol) : null } })).catch(() => {}); },
    loadSessions: async () => (await bridge.call<{ sessions: (Omit<Rec, 'vol'> & { vol: string | null })[] }>(`/api/p/silence-sessions?id=${encodeURIComponent(d.id)}`)).sessions
      .map((r) => ({ ...r, vol: r.vol ? fromB64(r.vol) : null }) as Rec),
    // ffmpeg on this PC reads the sound for Whisper in seconds (the browser takes minutes).
    sound16k: async (path, range) => {
      const q = `id=${encodeURIComponent(d.id)}&path=${encodeURIComponent(path)}${range ? `&start=${range.start}&end=${range.end}` : ''}&t=${encodeURIComponent(bridge.token)}`;
      const r = await fetch(`${BRIDGE}/api/p/sound16k?${q}`);
      if (!r.ok) throw new Error(`Could not read the sound (${r.status}).`);
      return new Float32Array(await r.arrayBuffer());
    },
    onClose,
    // The parts to keep (file seconds) become timeline seconds, and the bridge trims the cuts to them.
    onApply: src?.from === 'timeline' ? async (keeps) => {
      const shift = (src.tlStart ?? 0) - (src.range?.start ?? 0);
      const r = await bridge.call<{ message: string }>(`/api/p/timeline-keep?id=${encodeURIComponent(d.id)}`, {
        keeps: keeps.map((k) => [k.start + shift, k.end + shift]), magnetic, kind: mode,
        // Remembered with the result, so opening this again shows this session and its work.
        source: { path: src.path, name: src.name, range: src.range ?? null, tlStart: src.tlStart ?? 0 },
      });
      onApplied(r.message);
      return r.message;
    } : src && !src.build && src.path && (src.from === 'preview' || src.from === 'footage') && !src.path.startsWith('out/') ? async (keeps) => {
      // No timeline yet: the parts kept become the first timeline (the whole file is its starting point).
      const r = await bridge.call<{ message: string }>(`/api/p/timeline-create?id=${encodeURIComponent(d.id)}`, {
        path: src.path, keeps: keeps.map((k) => [k.start, k.end]), kind: mode,
      });
      onApplied(r.message);
      return r.message;
    } : undefined,
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
  }), [d.id, d.raw, d.out, bridge, onSaved, src, onClose, magnetic, onApplied, onSaving, mode]);

  useEffect(() => {
    if (!visible) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, visible]);
  // Hidden: stop its video, so nothing plays behind the editor.
  const popRoot = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!visible) popRoot.current?.querySelectorAll('video').forEach((v) => v.pause()); }, [visible]);

  const cut = saved.filter((s) => s.kind === 'video' && s.state === 'saved').pop();
  const list = saved.filter((s) => s.kind === 'cut-list' && s.state === 'saved').pop();

  return (
    <div ref={popRoot} className={`fixed inset-0 z-[66] bg-black/40 p-2 sm:p-4 ${visible ? 'flex' : 'hidden'}`} role="dialog" aria-hidden={!visible} aria-label={mode === 'unwanted' ? 'Find unwanted parts' : 'Silence remover'}>
      <div className="mx-auto w-full max-w-[1800px] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-st-line shrink-0">
          {mode === 'unwanted' ? <ScanSearch size={17} className="text-18-orange" aria-hidden /> : <Scissors size={17} className="text-18-orange" aria-hidden />}
          <div className="mr-2 min-w-0 max-w-[45%]" title={src?.path}>
            <h2 className="font-semibold text-sm leading-tight">{mode === 'unwanted' ? 'Find unwanted parts' : <>Remove pauses &amp; fillers</>}</h2>
            <p className="text-[11px] text-st-mute truncate">
              {source?.from === 'timeline'
                ? source.applied
                  ? <>Your last result is on the timeline: <b className="text-st-ink">{source.range ? `${source.path} ${fmtTime(source.range.start)}–${fmtTime(source.range.end)}` : 'the timeline footage'}</b> · change anything and <b className="text-st-ink">Apply to timeline</b> again</>
                  : <>Works on the timeline only: <b className="text-st-ink">{source.build ? 'its footage cuts, joined' : `${source.path} ${source.range ? `${fmtTime(source.range.start)}–${fmtTime(source.range.end)}` : ''}`}</b> · <b className="text-st-ink">Apply to timeline</b> puts the result back on it</>
                : <>{src ? <>Silence remover on <b className="text-st-ink">{src.path}</b> {src.from === 'preview' ? '(the video in the preview)' : '(the raw footage)'}</> : 'Silence remover'} · exports are saved into <b className="text-st-ink">{d.name}</b></>}
            </p>
          </div>
          {/* The Silence remover puts its own buttons (Projects, Start, Settings, Export…) here. */}
          <div ref={setSlot} className="flex flex-1 flex-wrap items-center justify-start gap-2" />
          <button onClick={onClose} className="p-2 rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Close the Silence remover"><X size={18} /></button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {building ? (
            <div className={`${card} p-4 max-w-xl`} role="status">
              {building.error ? <ErrorNote text={building.error} /> : <>
                <p className="text-sm flex items-center gap-2"><Spinner /> Joining the timeline&apos;s footage cuts into one video, so only what is on the timeline is checked… {building.pct}%</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-st-surface"><div className="h-full bg-18-orange transition-[width]" style={{ width: `${building.pct}%` }} /></div>
              </>}
            </div>
          ) : src ? <SilenceHome actions={slot} link={link} />
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

function MediaPanel({ boxRef, d, bridge, view, onOpen, onChanged, pickKey, editPanel, colorPanel }: { boxRef: React.RefObject<HTMLElement>; d: Detail; bridge: Bridge; view: View | null; onOpen: (v: View) => void; onChanged: () => void; pickKey: string; editPanel: React.ReactNode; colorPanel: React.ReactNode }) {
  const [tab, setTab] = useState<'footage' | 'outputs' | 'images' | 'docs'>(d.out.length ? 'outputs' : 'footage');
  // Two tabs: the project's files, and Edit (the clip selected on the timeline). Selecting a clip opens Edit.
  const [mode, setMode] = useState<'media' | 'edit' | 'color'>('media');
  useEffect(() => { if (pickKey) setMode((m) => (m === 'color' ? 'color' : 'edit')); }, [pickKey]);
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
        <div className="flex items-center rounded-lg bg-st-surface p-0.5 mr-1 shrink-0" role="tablist" aria-label="Media files or Edit">
          {([['media', 'Media files'], ['edit', 'Edit'], ['color', 'Color']] as const).map(([k, text]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === k ? 'bg-white text-st-ink shadow-sm' : 'text-st-mute hover:text-st-ink'}`}>{text}</button>
          ))}
        </div>
        {mode === 'media' && ([['footage', `Footage ${d.raw.length}`], ['outputs', `Outputs ${d.out.length}`], ['images', `Images ${d.workImages.length}`], ['docs', `Docs ${docs.length}`]] as const).map(([k, text]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`shrink-0 rounded-md px-2 py-1 text-xs ${tab === k ? 'bg-18-orange/10 text-18-orange font-semibold' : 'text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>{text}</button>
        ))}
      </header>

      {mode === 'edit' ? <div className="flex-1 overflow-y-auto">{editPanel}</div> : mode === 'color' ? <div className="flex-1 overflow-y-auto">{colorPanel}</div> : <div className="flex-1 overflow-y-auto p-2">
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
              <li key={f.path}><MediaCard f={f} url={`${bridge.fileUrl(d.id, f.path)}&v=${Math.round(f.modified)}`}active={view?.path === f.path} onOpen={() => open(f)} /></li>
            ))}
          </ul>
        ) : tab !== 'footage' && <p className="text-xs text-st-mute p-2">{tab === 'outputs' ? 'Storyboards, style frames, previews, finals and captions appear here as the editor makes them.' : 'Contact sheets and working stills from work/ appear here.'}</p>}
      </div>}
    </section>
  );
}

// The edit with no colour grade anywhere (Color tab "Before"): neutral for the edit and every cut.
const NEUTRAL = { contrast: 1, saturate: 1, brightness: 1 };
function ungraded(data: Obj): Obj {
  return { ...data, grade: NEUTRAL, segments: Array.isArray(data.segments) ? data.segments.map((sg) => (isObj(sg) ? { ...sg, grade: NEUTRAL } : sg)) : data.segments };
}

// ---------- Edit tab: the clip selected on the timeline ----------
type Pick = { key: string; index: number }; // where the element is in edit.json (index -1: a single object)
type Picked = Pick & { kind: string; track: TrackKey; start: number; end: number };
type SetOp = { path: (string | number)[]; value: unknown };
// Elements the render draws through its adjustable layer (move / scale / opacity).
const FX_KEYS = new Set(['segments', 'splitIntro', 'broll', 'splitScreens', 'screenshots', 'columnFocus', 'whiteboards', 'slides', 'titles', 'cards', 'listCards', 'defCards', 'tamBoard', 'tamSummary', 'badgeCards', 'statCards', 'highlights', 'lowerThirds', 'captions']);
// Sound: which number is the volume, and what it is when not set.
const SOUND: Record<string, { field: string; label: string; dflt: number }[]> = {
  segments: [{ field: 'volume', label: 'Volume', dflt: 1 }],
  sfx: [{ field: 'volume', label: 'Volume', dflt: 0.6 }],
  music: [{ field: 'volume', label: 'Volume', dflt: 0.25 }, { field: 'duckVolume', label: 'Volume while someone speaks', dflt: 0.08 }],
};
const TEXT_KEYS = new Set(['text', 'name', 'role', 'title', 'sub', 'label', 'heading', 'caption']);

function itemAt(data: Obj | null, at: Pick): Obj | null {
  if (!data) return null;
  const v = data[at.key];
  const it = at.index >= 0 ? (Array.isArray(v) ? v[at.index] : null) : v;
  return isObj(it) ? it : null;
}
function applySets(data: Obj, at: Pick, sets: SetOp[]): Obj {
  const copy = structuredClone(data) as Obj;
  if (at.index < 0 && at.key === 'grade' && !isObj(copy.grade)) copy.grade = {};
  if (at.key === 'segments' && at.index === -2) { // every footage cut (Color tab: all clips)
    const segs = Array.isArray(copy.segments) ? copy.segments.filter(isObj) : [];
    segs.forEach((sg) => setOn(sg, sets));
    return copy;
  }
  const it = itemAt(copy, at);
  if (!it) return data;
  setOn(it, sets);
  return copy;
}
function setOn(it: Obj, sets: SetOp[]) {
  for (const { path, value } of sets) {
    if (path[0] === 'fx') { it.fx = isObj(it.fx) ? it.fx : {}; (it.fx as Obj)[String(path[1])] = value; continue; }
    let o: unknown = it;
    for (const k of path.slice(0, -1)) {
      const r = o as Record<string | number, unknown> | null;
      if (r && typeof k === 'string' && r[k] == null) r[k] = {}; // e.g. the grade's curve, set for the first time
      o = r?.[k];
    }
    if (o && typeof o === 'object') (o as Record<string | number, unknown>)[path[path.length - 1]] = value;
  }
}
// Every piece of text in an element (its own text, a card's lines, a whiteboard's words…).
function textPaths(it: Obj): { path: (string | number)[]; label: string; value: string }[] {
  const out: { path: (string | number)[]; label: string; value: string }[] = [];
  // "Text 3" for the 3rd word group of a whiteboard, "Item 2" for a list row, "Lines 1" for an opener line…
  const name = (path: (string | number)[]) => {
    const n = path.length >= 2 && typeof path[path.length - 2] === 'number' ? (path[path.length - 2] as number) + 1 : null;
    const parent = String(path[path.length - 3] ?? '');
    if (n != null) return `${parent === 'items' ? 'Item' : parent === 'sub' ? 'Subtitle' : 'Text'} ${n}`;
    const last = path[path.length - 1];
    if (typeof last === 'number') return `Line ${last + 1}`;
    return last.charAt(0).toUpperCase() + last.slice(1);
  };
  const walk = (o: unknown, path: (string | number)[], depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(o)) {
      o.forEach((v, i) => {
        if (typeof v === 'string' && path[path.length - 1] === 'lines') out.push({ path: [...path, i], label: name([...path, i]), value: v });
        else walk(v, [...path, i], depth + 1);
      });
      return;
    }
    if (!isObj(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'fx') continue;
      if (typeof v === 'string' && TEXT_KEYS.has(k)) out.push({ path: [...path, k], label: name([...path, k]), value: v });
      else if (v && typeof v === 'object') walk(v, [...path, k], depth + 1);
    }
  };
  walk(it, [], 0);
  return out;
}

// The Color tab: one grade for all the footage on the timeline (graphics keep their own colours).
// Shown as simple sliders; stored in edit.json "grade" (and its tone curve), which the render uses.
const COLOR_ROWS: { label: string; path: (string)[]; min: number; max: number; step: number; dflt: number; shown: (v: number) => string }[] = [
  { label: 'Exposure', path: ['exposure'], min: -2, max: 2, step: 0.05, dflt: 0, shown: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` },
  { label: 'Brightness', path: ['curve', 'mids'], min: -0.6, max: 0.6, step: 0.01, dflt: 0, shown: (v) => `${v > 0 ? '+' : ''}${Math.round((v / 0.6) * 100)}` },
  { label: 'Contrast', path: ['contrast'], min: 0.5, max: 1.6, step: 0.01, dflt: 1.05, shown: (v) => `${Math.round(v * 100)}%` },
  { label: 'Highlights', path: ['curve', 'highlights'], min: -0.3, max: 0.3, step: 0.005, dflt: 0, shown: (v) => `${v > 0 ? '+' : ''}${Math.round((v / 0.3) * 100)}` },
  { label: 'Whites', path: ['curve', 'whites'], min: -0.3, max: 0.3, step: 0.005, dflt: 0, shown: (v) => `${v > 0 ? '+' : ''}${Math.round((v / 0.3) * 100)}` },
  { label: 'Blacks', path: ['curve', 'blacks'], min: -0.3, max: 0.3, step: 0.005, dflt: 0, shown: (v) => `${v > 0 ? '+' : ''}${Math.round((v / 0.3) * 100)}` },
  { label: 'Saturation', path: ['saturate'], min: 0, max: 2, step: 0.01, dflt: 1.05, shown: (v) => `${Math.round(v * 100)}%` },
  { label: 'Vignette', path: ['vignette'], min: 0, max: 1, step: 0.01, dflt: 0, shown: (v) => `${Math.round(v * 100)}%` },
];
// Grades a footage cut: the one selected on the timeline, or every cut when none is selected.
// A cut without its own grade shows the edit's grade; the first change gives it its own (all values).
function ColorPanel({ data, pick, onSet, before, onBefore, canCompare }: { data: Obj | null; pick: Picked | null; onSet: (at: Pick, sets: SetOp[]) => void; before: boolean; onBefore: () => void; canCompare: boolean }) {
  const segs = data && Array.isArray(data.segments) ? data.segments.filter(isObj) : [];
  if (!data || !segs.length) return <p className="p-4 text-sm text-st-mute">Color grading works on the footage on the timeline. Put footage on the timeline first.</p>;
  const one = pick?.key === 'segments' && pick.index >= 0 && pick.index < segs.length ? pick.index : null;
  const target: Pick = { key: 'segments', index: one ?? -2 };
  const seg = segs[one ?? 0];
  const g = isObj(seg.grade) ? seg.grade : isObj(data.grade) ? data.grade : {};
  const at = (path: string[]) => num(path.length === 1 ? g[path[0]] : isObj(g[path[0]]) ? (g[path[0]] as Obj)[path[1]] : null);
  const values = (change?: { path: string[]; value: number }) => COLOR_ROWS.map((r) => ({
    path: ['grade', ...r.path], value: change && change.path.join('.') === r.path.join('.') ? change.value : at(r.path) ?? r.dflt,
  }));
  const changed = COLOR_ROWS.some((r) => (at(r.path) ?? r.dflt) !== r.dflt);
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-st-mute">
          {one != null
            ? <><b className="text-st-ink">Footage clip {one + 1} of {segs.length}</b>{pick ? ` (${fmtTime(pick.start)}–${fmtTime(pick.end)})` : ''}. <b className="text-st-ink">Apply to all clips</b> gives every footage clip this grade.</>
            : <><b className="text-st-ink">All {segs.length} footage {segs.length === 1 ? 'clip' : 'clips'}</b>: no clip is selected, so changes go to all of them. Click a footage clip on the timeline to grade just that one.</>}
          {' '}Graphics keep their colours; changes save by themselves (Undo is under the timeline).
        </p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {/* Before / After: the preview without the grade, then with it again. Only shows, never saves. */}
          <button onClick={onBefore} disabled={!canCompare} aria-pressed={before}
            title={canCompare ? (before ? 'Showing the footage before grading. Click to see the grade again.' : 'Show the footage before grading') : 'Play the timeline with Graphics on to compare'}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-40 ${before ? 'border-18-orange bg-18-orange text-white' : 'border-st-line text-st-ink hover:border-18-orange/50'}`}>
            {before ? 'Before' : 'After'}
          </button>
          {one != null && segs.length > 1 && (
            <button onClick={() => onSet({ key: 'segments', index: -2 }, values())} title="Give every footage clip this clip's grade"
              className="rounded-full border border-st-line px-2.5 py-0.5 text-xs font-medium text-st-ink hover:border-18-orange/50">Apply to all clips</button>
          )}
          {changed && <button onClick={() => onSet(target, COLOR_ROWS.map((r) => ({ path: ['grade', ...r.path], value: r.dflt })))} className="text-xs text-18-orange hover:underline">Reset</button>}
        </div>
      </div>
      {COLOR_ROWS.map((r) => (
        <EditRow key={r.label} label={r.label} value={at(r.path) ?? r.dflt} min={r.min} max={r.max} step={r.step} shown={r.shown} onChange={(v) => onSet(target, values({ path: r.path, value: v }))} />
      ))}
    </div>
  );
}

function EditRow({ label, value, min, max, step, shown, onChange }: { label: string; value: number; min: number; max: number; step: number; shown: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs"><span className="font-medium">{label}</span><span className="tabular-nums text-st-mute">{shown(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[#F37335] cursor-pointer" />
    </label>
  );
}

function EditPanel({ data, pick, onSet }: { data: Obj | null; pick: Picked | null; onSet: (sets: SetOp[]) => void }) {
  if (!pick) return <p className="p-4 text-sm text-st-mute">Click a clip on the timeline to edit it here: its position, size, opacity, text and volume.</p>;
  const it = itemAt(data, pick);
  if (!it) return <p className="p-4 text-sm text-st-mute">That clip is no longer in the edit. Click another clip on the timeline.</p>;
  const fx = isObj(it.fx) ? it.fx : {};
  const f = (k: string, dflt: number) => num(fx[k]) ?? dflt;
  const visual = FX_KEYS.has(pick.key) && pick.track !== 'A1';
  const sound = SOUND[pick.key] && (pick.key !== 'segments' || pick.track === 'A1' || pick.track === 'V1') ? SOUND[pick.key] : null;
  const texts = pick.track === 'A1' ? [] : textPaths(it);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const px = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} px`;
  const changed = f('x', 0) !== 0 || f('y', 0) !== 0 || f('scale', 1) !== 1 || f('opacity', 1) !== 1;
  return (
    <div className="p-3 space-y-4">
      <div>
        <p className="text-sm font-semibold">{pick.track === 'A1' && pick.key === 'segments' ? 'Voice' : pick.kind}</p>
        <p className="text-xs text-st-mute tabular-nums">{fmtTime(pick.start)} – {fmtTime(pick.end)} · changes show in the preview at once and are saved by themselves (Undo on the timeline reverses them)</p>
      </div>
      {visual && (
        <section className="space-y-3" aria-label="Position, size and opacity">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-st-mute">Position &amp; size</h3>
            {changed && <button onClick={() => onSet([{ path: ['fx', 'x'], value: 0 }, { path: ['fx', 'y'], value: 0 }, { path: ['fx', 'scale'], value: 1 }, { path: ['fx', 'opacity'], value: 1 }])} className="text-xs text-18-orange hover:underline">Reset</button>}
          </div>
          <EditRow label="Move left / right" value={f('x', 0)} min={-1920} max={1920} step={1} shown={px} onChange={(v) => onSet([{ path: ['fx', 'x'], value: v }])} />
          <EditRow label="Move up / down" value={f('y', 0)} min={-1080} max={1080} step={1} shown={px} onChange={(v) => onSet([{ path: ['fx', 'y'], value: v }])} />
          <EditRow label="Scale" value={f('scale', 1)} min={0.1} max={3} step={0.01} shown={pct} onChange={(v) => onSet([{ path: ['fx', 'scale'], value: v }])} />
          <EditRow label="Opacity" value={f('opacity', 1)} min={0} max={1} step={0.01} shown={pct} onChange={(v) => onSet([{ path: ['fx', 'opacity'], value: v }])} />
        </section>
      )}
      {pick.key === 'whiteboards' && !it.noPip && (() => {
        // The round speaker picture: which part of the footage shows in it (the circle itself stays
        // bottom right). Shown as moves of the speaker, so right means the person moves right.
        const cx = num(it.pipCx) ?? 960, cy = num(it.pipCy) ?? 560, zoom = num(it.pipScale) ?? 0.42;
        const changedPip = it.pipCx != null || it.pipCy != null || it.pipScale != null;
        return (
          <section className="space-y-3" aria-label="Speaker circle">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-st-mute">Speaker circle</h3>
              {changedPip && <button onClick={() => onSet([{ path: ['pipCx'], value: 960 }, { path: ['pipCy'], value: 560 }, { path: ['pipScale'], value: 0.42 }])} className="text-xs text-18-orange hover:underline">Reset</button>}
            </div>
            <EditRow label="Move speaker left / right (+ is right)" value={Math.round(960 - cx)} min={-600} max={600} step={1} shown={px} onChange={(v) => onSet([{ path: ['pipCx'], value: 960 - v }])} />
            <EditRow label="Move speaker up / down (+ is down)" value={Math.round(560 - cy)} min={-500} max={500} step={1} shown={px} onChange={(v) => onSet([{ path: ['pipCy'], value: 560 - v }])} />
            <EditRow label="Zoom" value={zoom} min={0.2} max={1.2} step={0.01} shown={(v) => `${Math.round((v / 0.42) * 100)}%`} onChange={(v) => onSet([{ path: ['pipScale'], value: v }])} />
          </section>
        );
      })()}
      {texts.length > 0 && (
        <section className="space-y-2" aria-label="Text">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-st-mute">Text</h3>
          {texts.map((x) => (
            <label key={JSON.stringify(x.path)} className="block">
              {texts.length > 1 && <span className="text-[11px] text-st-mute">{x.label}</span>}
              <textarea value={x.value} rows={Math.min(4, Math.max(1, Math.ceil(x.value.length / 38)))} onChange={(e) => onSet([{ path: x.path, value: e.target.value }])}
                className={`${field} !min-h-0 !py-1.5 text-sm resize-y`} />
            </label>
          ))}
        </section>
      )}
      {sound && (
        <section className="space-y-3" aria-label="Sound">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-st-mute">Sound</h3>
          {sound.map((x) => (
            <EditRow key={x.field} label={x.label} value={num(it[x.field]) ?? x.dflt} min={0} max={2} step={0.01} shown={pct} onChange={(v) => onSet([{ path: [x.field], value: v }])} />
          ))}
        </section>
      )}
      {!visual && !texts.length && !sound && <p className="text-sm text-st-mute">This kind of clip has nothing to adjust here. Ask the AI editor to change it.</p>}
    </div>
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
    <button onClick={onOpen} title={`${f.name} · ${size(f.size)} · ${when(f.modified)}${f.kind === 'video' || f.kind === 'image' || f.kind === 'audio' ? '\nDrag it onto the timeline to add it to the edit' : ''}`}
      draggable={f.kind === 'video' || f.kind === 'image' || f.kind === 'audio'}
      onDragStart={(e) => {
        if (f.kind !== 'video' && f.kind !== 'image' && f.kind !== 'audio') return e.preventDefault();
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ path: f.path, name: f.name, kind: f.kind }));
        e.dataTransfer.setData(dragKindType(f.kind), '1');
        e.dataTransfer.effectAllowed = 'copy';
      }}
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
// Play / pause and a scrub bar over the timeline (the edit's length), used while the player plays the timeline.
// The player's control bar. While playing it fades out 1 second after the mouse last moved over the
// player (and the pointer hides too, handy in full screen); moving the mouse brings it back. It stays
// while the mouse is on the bar itself, and always while paused.
function ControlBar({ playing, children }: { playing: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    let h: ReturnType<typeof setTimeout> | undefined;
    const show = (on: boolean) => { setShown(on); host.style.cursor = on ? '' : 'none'; };
    const poke = () => {
      show(true);
      clearTimeout(h);
      if (playing) h = setTimeout(function hide() { if (ref.current?.matches(':hover')) h = setTimeout(hide, 1000); else show(false); }, 1000);
    };
    poke();
    host.addEventListener('mousemove', poke);
    host.addEventListener('pointerdown', poke);
    return () => { clearTimeout(h); host.removeEventListener('mousemove', poke); host.removeEventListener('pointerdown', poke); host.style.cursor = ''; };
  }, [playing]);
  return (
    <div ref={ref} className={`absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent text-white text-xs transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {children}
    </div>
  );
}

function TimelineControls({ clock, video }: { clock: Clock; video: HTMLVideoElement | null }) {
  const { t, duration } = useSyncExternalStore(clock.sub, clock.get, clock.get);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!video) return;
    const on = () => setPlaying(!video.paused);
    on();
    video.addEventListener('play', on);
    video.addEventListener('pause', on);
    return () => { video.removeEventListener('play', on); video.removeEventListener('pause', on); };
  }, [video]);
  const toggle = () => {
    if (!video) return;
    if (!video.paused) return video.pause();
    if (duration && t >= duration - 0.05) clock.seek(0); // at the end: start over
    void video.play().catch(() => {});
  };
  return (
    <ControlBar playing={playing}>
      <button onClick={toggle} className="p-1 rounded hover:bg-white/15" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Square size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
      </button>
      <span className="tabular-nums shrink-0">{fmtTime(t)} / {fmtTime(duration)}</span>
      <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(t, duration || 0)} aria-label="Timeline position"
        onChange={(e) => clock.seek(Number(e.target.value))} className="flex-1 accent-[#F37335] cursor-pointer" />
    </ControlBar>
  );
}

// The live preview page from the bridge. It says "ready", gets the edit's props (again after
// every change), and reports its time; the timeline drives it through `live`.
function LivePreview({ bridge, live, props }: { bridge: Bridge; live: Live; props: Record<string, unknown> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const st = useSyncExternalStore(live.sub, live.get, live.get);
  const propsRef = useRef(props);
  propsRef.current = props;
  // The preview's code can change (a Remotion update, new effects). Check every few seconds and when
  // the page comes back into view; when it changed, load the preview again at the same moment.
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let seen: number | null = null;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`${BRIDGE}/api/live/${encodeURIComponent(bridge.token)}/version`, { cache: 'no-store' });
        const { v } = (await r.json()) as { v: number };
        if (stop) return;
        if (seen != null && v !== seen) { const t = live.get().t; live.attach(null); setGen((g) => g + 1); live.seek(t); }
        seen = v;
      } catch { /* the bridge is restarting: try again next time */ }
    };
    void check();
    const h = setInterval(check, 4000);
    const vis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(h); document.removeEventListener('visibilitychange', vis); };
  }, [bridge, live]);
  // After a drawing error, the next change to the edit loads the preview again (at the same moment).
  const failed = useRef(false);
  failed.current = !!st.error;
  useEffect(() => {
    if (!failed.current) return;
    const t = live.get().t;
    live.attach(null);
    setGen((g) => g + 1);
    live.seek(t);
  }, [props, live]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== BRIDGE || e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return;
      const m = e.data as { type: string; t?: number; playing?: boolean; duration?: number; message?: string };
      if (m.type === 'ready') live.ready(e.source as Window, propsRef.current);
      else if (m.type === 'state') live.set({ t: Number(m.t) || 0, playing: !!m.playing, duration: Number(m.duration) || 0 });
      else if (m.type === 'error') live.set({ error: String(m.message || 'The live preview failed.') });
    };
    window.addEventListener('message', on);
    return () => { window.removeEventListener('message', on); live.attach(null); };
  }, [live]);
  useEffect(() => { if (st.ready) live.post({ type: 'props', props }); }, [props, st.ready, live]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <iframe key={gen} ref={frame} title="Live preview with graphics" src={`${BRIDGE}/api/live/${encodeURIComponent(bridge.token)}/`} allow="autoplay; fullscreen"
        className="absolute inset-0 w-full h-full border-0 bg-black pointer-events-none" />
      {!st.ready && !st.error && <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70 pointer-events-none"><Spinner /> Loading the live preview…</p>}
      {st.error && <p role="alert" className="absolute top-2 inset-x-2 text-xs bg-red-600/90 text-white rounded-md px-3 py-2">{st.error} Turn Graphics off to play the footage cuts.</p>}
    </>
  );
}
function LiveControls({ clock, live }: { clock: Clock; live: Live }) {
  const { t, duration } = useSyncExternalStore(clock.sub, clock.get, clock.get);
  const { playing } = useSyncExternalStore(live.sub, live.get, live.get);
  const toggle = () => {
    if (!playing && duration && t >= duration - 0.05) clock.seek(0); // at the end: start over
    live.toggle();
  };
  return (
    <ControlBar playing={playing}>
      <button onClick={toggle} className="p-1 rounded hover:bg-white/15" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Square size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
      </button>
      <span className="tabular-nums shrink-0">{fmtTime(t)} / {fmtTime(duration)}</span>
      <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(t, duration || 0)} aria-label="Timeline position"
        onChange={(e) => clock.seek(Number(e.target.value))} className="flex-1 accent-[#F37335] cursor-pointer" />
    </ControlBar>
  );
}

function Viewer({ width, d, bridge, view, onVideo, program, onProgram, vertical, clock, canPlayTimeline, onPlayTimeline, live, liveProps, canLive, liveAvailable, graphics, onGraphics, badge }: {
  width: number | null; d: Detail; bridge: Bridge; view: View | null; onVideo: (v: HTMLVideoElement | null) => void; program: FileInfo | null; onProgram: () => void; vertical: boolean;
  clock: Clock; canPlayTimeline: boolean; onPlayTimeline: () => void;
  live: Live | null; liveProps: Record<string, unknown> | null; canLive: boolean; liveAvailable: boolean; graphics: boolean; onGraphics: () => void;
  badge?: string | null; // a small label on the picture, e.g. while showing the footage before its grade
}) {
  // Full screen shows the edit: it switches to the timeline (with graphics, when the edit has them)
  // and makes the player frame fill the screen, with its play / time / scrub controls. Esc leaves.
  const frameRef = useRef<HTMLDivElement>(null);
  function fullScreen() {
    const el = frameRef.current;
    if (!el) return;
    if (canPlayTimeline && !(view?.kind === 'video' && view.timeline)) onPlayTimeline();
    if (canPlayTimeline && liveAvailable && !graphics) onGraphics();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  }
  const tlMode = view?.kind === 'video' && !!view.timeline;
  // The frame is always the delivery size: 1920 × 1080 (16:9), or 1080 × 1920 for 9:16 Shorts.
  const [fw, fh] = vertical ? [1080, 1920] : [1920, 1080];
  const [doc, setDoc] = useState<string | null>(null);
  // With the file's time on the address, a file the AI re-renders shows its new version, not the cached one.
  const vMod = view ? [...d.out, ...d.workImages].find((f) => f.path === view.path)?.modified : undefined;
  const url = view ? `${bridge.fileUrl(d.id, view.path)}${vMod ? `&v=${Math.round(vMod)}` : ''}` : '';

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
  // The timeline can also open a file at a given time (start), e.g. the next footage cut.
  useEffect(() => {
    const v = vid.current;
    if (!view || view.kind === 'doc' || !v) return;
    const go = () => {
      if (view.start != null) v.currentTime = view.start;
      if (view.play && !live) v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else { v.addEventListener('loadedmetadata', go, { once: true }); return () => v.removeEventListener('loadedmetadata', go); }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={`${card} flex flex-col min-h-[260px] lg:min-h-0 overflow-hidden`} style={width ? { width } : undefined} aria-label="Preview">
      <header className="flex items-center gap-2 px-3 h-11 border-b border-st-line shrink-0">
        <span className="text-sm font-medium truncate flex-1" title={view?.name}>
          {tlMode ? <>Timeline <span className="text-st-mute font-normal">· {live ? 'live preview with graphics' : 'the edit as cut, without graphics'}</span></> : view?.name ?? 'Preview'}
        </span>
        {canLive && (
          <button onClick={onGraphics} aria-pressed={graphics} className={`shrink-0 inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 ${graphics ? 'border-18-orange/40 text-18-orange bg-orange-50' : 'border-st-line text-st-mute hover:text-st-ink'}`}
            title={graphics ? 'Graphics on: plays the edit with its whiteboards, cards and captions, live from the timeline. Click to play the footage cuts only (lighter; the volume meter follows it).' : 'Graphics off: the footage cuts only. Click to play the edit with its graphics, live from the timeline.'}>
            <Sparkles size={12} aria-hidden /> Graphics {graphics ? 'on' : 'off'}
          </button>
        )}
        {!tlMode && canPlayTimeline && <button onClick={onPlayTimeline} className="text-xs text-18-orange hover:underline shrink-0">Play timeline</button>}
        <span className="text-[11px] text-st-mute tabular-nums shrink-0" title="Frame size">{fw} × {fh}</span>
        {program && view?.path !== program.path && <button onClick={onProgram} className="text-xs text-18-orange hover:underline shrink-0">Show the edit</button>}
        {(view || canPlayTimeline) && (
          <button onClick={fullScreen} className="p-1 text-st-mute hover:text-st-ink" aria-label="Full screen: the edited version"
            title={canPlayTimeline ? 'Full screen: plays the edited version (the timeline, with its graphics). Esc to leave.' : 'Full screen (Esc to leave)'}><Maximize2 size={15} /></button>
        )}
      </header>
      {/* The available space is a size container; the frame inside is the largest box with the
          delivery aspect ratio that fits it (min of full width, or full height × ratio). */}
      {/* The 16:9 box: the frame sits in it (black around a vertical edit); the timeline controls and
          full screen belong to the whole box, so they span its full width. */}
      <div ref={frameRef} className={`flex-1 min-h-0 bg-black relative flex items-center justify-center aspect-video lg:aspect-auto`} style={{ containerType: 'size' }}>
        <div className="relative bg-black flex items-center justify-center overflow-hidden"
          style={{ aspectRatio: `${fw} / ${fh}`, width: `min(100cqw, calc(100cqh * ${fw} / ${fh}))` }}>
          {/* One video element for the whole session: the meter's audio graph stays attached to it. */}
          {/* Playing the timeline: our own controls show timeline time, not the source file's. */}
          <video ref={setVid} src={isVideo ? url : undefined} controls={!tlMode} crossOrigin="anonymous" preload="metadata" playsInline
            className={`w-full h-full object-contain ${isVideo && !live ? '' : 'hidden'}`} />
          {live && liveProps && <LivePreview bridge={bridge} live={live} props={liveProps} />}
          {badge && <span className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white pointer-events-none">{badge}</span>}
          {view?.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={view.name} className="w-full h-full object-contain" />
          )}
          {!view && <p className="text-sm text-white/60 p-6 text-center">Add footage, or pick a file in Media files to play it here.</p>}
        </div>
        {tlMode && (live ? <LiveControls clock={clock} live={live} /> : <TimelineControls clock={clock} video={vid.current} />)}
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
type ExportJob = { mode: 'preview' | 'final'; state: 'running' | 'done' | 'failed' | 'cancelled'; stage: string; pct: number; file: string | null; size: number | null; error: string | null; note?: string; started: number; ended?: number };
type ExportInfo = { ready: boolean; props: string | null; propsModified: number | null; final: ExportFile; preview: ExportFile; job: ExportJob | null; busy: { id: string; kind: string } | null };

const EXPORTS = [
  { mode: 'preview' as const, title: 'Preview', tag: 'Low quality · under 30 MB', text: '720p copy for checking on the phone and sharing for review. Quick when the final is already up to date; otherwise it renders the edit first.' },
  { mode: 'final' as const, title: 'Final output', tag: 'High quality · 1080p', text: 'The full-quality render to publish (crf 14, slow preset, sharpest frames). Takes a while: often 10–30 minutes for a few minutes of video.' },
];

// A chat message that only asks to export ("export it", "export the preview", "render the final video").
// Longer messages, or ones that also ask for changes, still go to the AI editor.
function exportAsk(text: string): 'final' | 'preview' | null {
  const t = text.trim().toLowerCase();
  if (t.length > 80 || !/\b(export|render)\b/.test(t) || /\b(don'?t|do not|not yet|after|before|then|and (change|fix|move|add|remove))\b/.test(t) || /^(why|what|how|when|where|is|did|does)\b|\b(fail|failed|error|wrong|stuck)\b/.test(t)) return null;
  return /\b(preview|phone|small|720p?|review copy)\b/.test(t) ? 'preview' : 'final';
}

function ExportButton({ id, bridge, onDone, onPlay, ask }: { id: string; bridge: Bridge; onDone: () => void; onPlay: (path: string) => void; ask?: { mode: 'final' | 'preview'; n: number } | null }) {
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

  // Asked from the chat: open the dialog, and start that export unless it is already running or up to date.
  const asked = useRef(0);
  const [askNote, setAskNote] = useState('');
  useEffect(() => {
    if (!ask || ask.n === asked.current) return;
    asked.current = ask.n;
    setOpen(true);
    setAskNote('');
    void (async () => {
      let i: ExportInfo;
      try { i = await bridge.call<ExportInfo>(url); setInfo(i); } catch (e) { return setError(e instanceof Error ? e.message : String(e)); }
      const have = i[ask.mode];
      const fresh = !!(have && i.propsModified && have.modified >= i.propsModified);
      if (fresh && i.job?.state !== 'running') setAskNote(`The ${ask.mode === 'final' ? 'final output' : 'preview'} is already up to date with the edit, so nothing was rendered again. Use Export again to make it anyway.`);
      if (!i.ready || i.job?.state === 'running' || i.busy || fresh) return;
      await start(ask.mode);
    })();
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

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
            {askNote && <p className="text-sm rounded-lg bg-st-surface text-st-ink px-3 py-2">{askNote}</p>}
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
                  {mine?.state === 'done' && mine.note && <p className="mt-3 text-xs text-amber-900 break-words">{mine.note}</p>}
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
function BriefDialog({ bridge, name, savedBrief, onClose, onStart }: { bridge: Bridge; name: string; savedBrief: boolean; onClose: () => void; onStart: (b: Brief) => void }) {
  const [b, setB] = useState<Brief>(BRIEF_DEFAULT);
  // Style skills on this PC, read each time the dialog opens: a skill made in the AI editor chat
  // (or added to ~/.claude/skills by hand) is a Style choice straight away.
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    bridge.call<{ skills: { name: string; description: string }[] }>('/api/skills').then((r) => setSkills(r.skills.filter((k) => !NOT_STYLE(k.name)))).catch(() => {});
  }, [bridge]);
  const optionsOf = (q: (typeof BRIEF_QUESTIONS)[number]) =>
    q.key !== 'style' ? q.options : [...q.options.slice(0, -1), ...skills.map((k) => `${k.name} skill`), q.options[q.options.length - 1]];
  const hint = (o: string) => skills.find((k) => `${k.name} skill` === o)?.description;
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
              {optionsOf(q).map((o) => (
                <button key={o} type="button" onClick={() => set(q.key, o)} aria-pressed={b[q.key] === o} title={hint(o)}
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
  // Start to end: storyboard_1, storyboard_2 … in number order (they are written at almost the
  // same moment, so file times can't order them), then the other sheets (opening transition,
  // scenes) by name.
  const isBoard = (f: FileInfo) => /storyboard/i.test(f.name);
  const byName = (a: FileInfo, b: FileInfo) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const all = [...d.out, ...d.workImages].filter(isSheet);
  const fresh = draft ? all.filter((f) => f.modified >= draft.startedAt - 2000) : [];
  const sheets = (fresh.length ? fresh : all).sort((a, b) => Number(isBoard(b)) - Number(isBoard(a)) || byName(a, b));
  // The single frames behind the storyboard sheets: shown one by one (in order, with their time),
  // so any frame can be opened, zoomed and stepped through. The storyboard_N sheets are then just
  // these frames tiled, so they are left out; without the frames, the sheets themselves are shown.
  const frames = d.frames ?? [];
  const shownSheets = frames.length ? sheets.filter((f) => !isBoard(f)) : sheets;
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const items: ViewItem[] = [
    // &v= is the file's time: a re-rendered frame gets a new address, so the browser loads it fresh.
    ...frames.map((f, k) => ({ src: `${bridge.fileUrl(d.id, f.path)}&v=${Math.round(f.modified)}`, title: clock(f.t), sub: `Frame ${k + 1} of ${frames.length}` })),
    ...shownSheets.map((f) => ({ src: `${bridge.fileUrl(d.id, f.path)}&v=${Math.round(f.modified)}`, title: f.name, sub: when(f.modified) })),
  ];
  const [view, setView] = useState<number | null>(null);
  const pending = draft?.stage === 'storyboard';
  return (
    <Modal wide title="Storyboard" onClose={onClose}
      sub={pending ? 'One frame every 5 seconds, and every scene fully drawn. Approve it to edit the 1st draft, or ask for changes.' : draft?.stage === 'draft-working' ? 'Approved. The AI editor is editing the 1st draft.' : draft?.stage === 'draft' ? 'Approved. The 1st draft is ready in the player.' : 'The storyboard sheets for this video.'}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Close</button>
        {pending && <button onClick={onChanges} disabled={running} className={btnGhost}><PenLine size={15} aria-hidden /> Request changes</button>}
        {pending && <button onClick={onApprove} disabled={running} className={btn}><CheckCircle2 size={15} aria-hidden /> Approve and edit the 1st draft</button>}
      </>}>
      {items.length ? (
        <div className="space-y-8">
          {frames.length > 0 && (
            <section aria-label="Storyboard frames">
              <p className="text-xs text-st-mute mb-3">{frames.length} frames, start to end. Click a frame to view it large, zoom in, and step through with ← →.</p>
              <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-5">
                {frames.map((f, k) => (
                  <li key={f.path}>
                    <button onClick={() => setView(k)} className="group block w-full text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-18-orange"
                      aria-label={`View frame at ${clock(f.t)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={items[k].src} alt="" loading="lazy" className="w-full aspect-video object-contain bg-st-surface rounded-md border-2 border-st-ink group-hover:border-18-orange transition-colors" />
                      <span className="block mt-1.5 text-sm font-semibold tabular-nums">{clock(f.t)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {shownSheets.map((f, j) => (
            <figure key={f.path}>
              <figcaption className="flex items-center gap-2 text-sm mb-2">
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-st-mute">{when(f.modified)}</span>
              </figcaption>
              <button onClick={() => setView(frames.length + j)} className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-18-orange" aria-label={`View ${f.name} large`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={items[frames.length + j].src} alt={f.name} loading="lazy" className="w-full rounded-lg border border-st-line hover:border-18-orange transition-colors" />
              </button>
            </figure>
          ))}
        </div>
      ) : <p className="text-sm text-st-mute">No storyboard sheets yet. They appear here once the 1st draft has made them.</p>}
      {view !== null && items[view] && <ImageViewer items={items} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </Modal>
  );
}

// ---------- captions review ----------
// work/caption_review.md (written by the skill's caption_review.py after the .srt): one table per
// srt checked, `| # | Before (speech-to-text) | After (caption) | Change | Note |`, each Before / After
// cell = "00:05:15,580 --> 00:05:17,200<br>text". Shown as a table with the words that changed marked.
type CueRow = { n: string; t0: number | null; t1: number | null; time: string; afterTime: string; before: string; after: string; change: string; note: string };
type CueSection = { title: string; finalTimeline: boolean; rows: CueRow[]; notes: string };
const srtSec = (s: string) => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null; };
function splitCell(c: string) {
  const [head, ...rest] = c.split(/<br\s*\/?>/i);
  return /-->/.test(head) ? { time: head.trim(), text: rest.join(' ').trim() } : { time: '', text: c.trim() };
}
function parseCaptionReview(md: string): CueSection[] {
  const out: CueSection[] = [];
  const start = (title: string): CueSection => { const x = { title, finalTimeline: !/raw/i.test(title), rows: [] as CueRow[], notes: '' }; out.push(x); return x; };
  for (const line of md.replace(/\r/g, '').split('\n')) {
    if (/^#{1,4}\s/.test(line)) { start(line.replace(/^#+\s*/, '').trim()); continue; }
    const sec: CueSection = out[out.length - 1] ?? start('Captions');
    if (/^\s*\|/.test(line)) {
      const c = line.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
      if (/^:?-{2,}/.test(c[0]) || c[0] === '#' || c.length < 3) continue;
      const b = splitCell(c[1] ?? ''), a = splitCell(c[2] ?? '');
      const [from, to] = (b.time || a.time).split('-->').map((x) => x.trim());
      sec.rows.push({ n: c[0], t0: from ? srtSec(from) : null, t1: to ? srtSec(to) : null, time: b.time || a.time, afterTime: a.time && a.time !== b.time ? a.time : '',
        before: b.text, after: a.text, change: c[3] ?? '', note: c[4] ?? '' });
    } else if (line.trim()) sec.notes += line + '\n';
  }
  return out.filter((x) => x.rows.length || x.notes.trim());
}
// Word-level difference (longest common subsequence): the words only in `a` are marked.
function diffWords(a: string, b: string): { w: string; changed: boolean }[] {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = norm(A[i]) === norm(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const res: { w: string; changed: boolean }[] = [];
  let i = 0, j = 0;
  while (i < A.length) {
    if (j < B.length && norm(A[i]) === norm(B[j])) { res.push({ w: A[i], changed: A[i] !== B[j] }); i++; j++; }
    else if (j < B.length && L[i][j + 1] >= L[i + 1][j]) j++;
    else { res.push({ w: A[i], changed: true }); i++; }
  }
  return res;
}
const CHANGE_STYLE: Record<string, string> = {
  corrected: 'bg-amber-50 text-amber-800 border-amber-200',
  added: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  removed: 'bg-red-50 text-red-700 border-red-200',
};
function CaptionsDialog({ d, bridge, review, blocked, onClose, onRemake, onJump }: {
  d: Detail; bridge: Bridge; review: { text: string; modified: number }; blocked: boolean; onClose: () => void; onRemake: () => void; onJump: (t: number) => void;
}) {
  const sections = useMemo(() => parseCaptionReview(review.text), [review.text]);
  const kinds = useMemo(() => {
    const k = new Map<string, number>();
    for (const s of sections) for (const r of s.rows) for (const c of r.change.split(/[,/]/).map((x) => x.trim().toLowerCase()).filter(Boolean)) k.set(c, (k.get(c) ?? 0) + 1);
    return [...k.entries()];
  }, [sections]);
  const [only, setOnly] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const srts = d.out.filter((f) => /\.srt$/i.test(f.name));
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const match = (r: CueRow) => (!only || r.change.toLowerCase().includes(only)) && (!q.trim() || `${r.before} ${r.after} ${r.note}`.toLowerCase().includes(q.trim().toLowerCase()));
  const chip = (c: string) => <span key={c} className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${CHANGE_STYLE[c.toLowerCase()] ?? 'bg-st-surface text-st-ink border-st-line'}`}>{c}</span>;
  const mark = (parts: { w: string; changed: boolean }[], cls: string) => parts.map((p, k) => <span key={k}>{k ? ' ' : ''}{p.changed ? <mark className={cls}>{p.w}</mark> : p.w}</span>);
  return (
    <Modal wide title="Captions review" onClose={onClose}
      sub={<>Every caption that differs from the speech-to-text: {total} {total === 1 ? 'change' : 'changes'}. Words marked red were taken out or changed, green is what the caption says now. Updated {when(review.modified)}.</>}
      footer={<>
        {srts.map((f) => <a key={f.path} href={bridge.fileUrl(d.id, f.path, true)} className={btnGhost}><Download size={15} aria-hidden /> {f.name}</a>)}
        <button onClick={onRemake} disabled={blocked} className={btnGhost} title={blocked ? 'Wait until the AI editor has finished' : 'Ask the AI editor to make the captions and this review again'}><RefreshCw size={15} aria-hidden /> Make captions again</button>
        <button onClick={onClose} className={btn}>Done</button>
      </>}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div role="group" aria-label="Show changes of type" className="flex flex-wrap gap-1.5">
          <button onClick={() => setOnly(null)} aria-pressed={!only} className={`${pill} ${!only ? 'bg-st-ink text-white border-st-ink' : 'border-st-line text-st-ink hover:border-st-ink/40'}`}>All {total}</button>
          {kinds.map(([k, n]) => (
            <button key={k} onClick={() => setOnly(only === k ? null : k)} aria-pressed={only === k}
              className={`${pill} capitalize ${only === k ? 'bg-st-ink text-white border-st-ink' : 'border-st-line text-st-ink hover:border-st-ink/40'}`}>{k} {n}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words…" aria-label="Search the captions" className={`${field} !min-h-[34px] !py-1.5 ml-auto max-w-[14rem]`} />
      </div>
      <div className="space-y-6">
        {sections.map((s, si) => {
          const rows = s.rows.filter(match);
          return (
            <section key={si} aria-label={s.title}>
              {(sections.length > 1 || s.title !== 'Captions') && <h3 className="text-sm font-semibold mb-2">{s.title}</h3>}
              {s.rows.length > 0 && (rows.length ? (
                <div className="overflow-x-auto rounded-lg border border-st-line">
                  <table className="w-full text-sm border-collapse min-w-[760px]">
                    <thead className="bg-st-surface text-xs text-st-mute">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2 w-10">#</th>
                        <th className="text-left font-semibold px-3 py-2 w-[9.5rem]">Time</th>
                        <th className="text-left font-semibold px-3 py-2">Before (speech-to-text)</th>
                        <th className="text-left font-semibold px-3 py-2">After (caption)</th>
                        <th className="text-left font-semibold px-3 py-2 w-28">Change</th>
                        <th className="text-left font-semibold px-3 py-2 w-48">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.n + r.time} className="border-t border-st-line align-top">
                          <td className="px-3 py-2.5 text-st-mute tabular-nums">{r.n}</td>
                          <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap">
                            {s.finalTimeline && r.t0 != null ? (
                              <button onClick={() => onJump(r.t0!)} className="inline-flex items-center gap-1 text-18-orange hover:underline" title="Play this moment on the timeline">
                                <Play size={11} fill="currentColor" aria-hidden /> {r.time.split('-->')[0].trim()}
                              </button>
                            ) : <span>{r.time.split('-->')[0].trim()}</span>}
                            <span className="block text-st-mute">to {r.time.split('-->')[1]?.trim()}</span>
                            {r.afterTime && <span className="block text-st-mute mt-1" title="The caption's own time">caption: {r.afterTime}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-st-mute leading-relaxed">{mark(diffWords(r.before, r.after), 'bg-red-100 text-red-800 line-through decoration-red-400 rounded px-0.5')}</td>
                          <td className="px-3 py-2.5 leading-relaxed">{mark(diffWords(r.after, r.before), 'bg-emerald-100 text-emerald-900 rounded px-0.5')}</td>
                          <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">{r.change.split(/,\s*/).filter(Boolean).map(chip)}</span></td>
                          <td className="px-3 py-2.5 text-xs text-st-mute">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-st-mute">No changes match.</p>)}
              {s.notes.trim() && <div className="mt-3"><Md text={s.notes} /></div>}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

// A full-screen picture viewer: previous / next (buttons or ← →), zoom (buttons, + − 0, the
// mouse wheel at the pointer, or double-click), and drag to move around a zoomed picture.
// Esc closes only the viewer, not the dialog under it.
type ViewItem = { src: string; title: string; sub?: string };
function ImageViewer({ items, index, onIndex, onClose }: { items: ViewItem[]; index: number; onIndex: (k: number) => void; onClose: () => void }) {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const item = items[index];
  const go = useCallback((k: number) => { if (k >= 0 && k < items.length) onIndex(k); }, [items.length, onIndex]);
  useEffect(() => setZ({ s: 1, x: 0, y: 0 }), [index]);
  // Zoom to scale s, keeping the point (px, py) (from the stage centre) where it is.
  const zoomAt = useCallback((s: number, px = 0, py = 0) => setZ((o) => {
    const n = Math.min(8, Math.max(1, s));
    if (n === 1) return { s: 1, x: 0, y: 0 };
    return { s: n, x: px - ((px - o.x) * n) / o.s, y: py - ((py - o.y) * n) / o.s };
  }), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Escape') onClose();
      else if (k === 'ArrowLeft') go(index - 1);
      else if (k === 'ArrowRight') go(index + 1);
      else if (k === '+' || k === '=') setZ((o) => ({ ...o, s: Math.min(8, o.s * 1.5) }));
      else if (k === '-' || k === '_') zoomAt(z.s / 1.5);
      else if (k === '0') zoomAt(1);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [go, index, onClose, z.s, zoomAt]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(z.s * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [z.s, zoomAt]);
  // Load the neighbours too, so stepping is instant.
  useEffect(() => { for (const k of [index - 1, index + 1]) if (items[k]) new Image().src = items[k].src; }, [index, items]);
  const arrow = 'absolute top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 text-white hover:bg-black/75 disabled:opacity-25 disabled:cursor-default';
  const tool = 'p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30';
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${item.title}${item.sub ? `, ${item.sub}` : ''}`} className="fixed inset-0 z-[90] bg-black/90 flex flex-col select-none">
      <header className="flex items-center gap-2 px-4 py-2.5 text-white shrink-0">
        <div className="min-w-0 flex-1">
          <p className="font-semibold tabular-nums truncate">{item.title}</p>
          {item.sub && <p className="text-xs text-white/60">{item.sub}</p>}
        </div>
        <button onClick={() => zoomAt(z.s / 1.5)} disabled={z.s <= 1} className={tool} aria-label="Zoom out (−)" title="Zoom out (−)"><ZoomOut size={18} /></button>
        <button onClick={() => zoomAt(1)} className="px-2 py-1 rounded-lg text-xs tabular-nums text-white/80 hover:bg-white/10 w-14" title="Fit to screen (0)">{Math.round(z.s * 100)}%</button>
        <button onClick={() => setZ((o) => ({ ...o, s: Math.min(8, o.s * 1.5) }))} disabled={z.s >= 8} className={tool} aria-label="Zoom in (+)" title="Zoom in (+)"><ZoomIn size={18} /></button>
        <a href={item.src} target="_blank" rel="noreferrer" className={tool} aria-label="Open full size in a new tab" title="Open full size in a new tab"><Maximize2 size={17} /></a>
        <button onClick={onClose} className={tool} aria-label="Close viewer (Esc)" title="Close (Esc)"><X size={20} /></button>
      </header>
      <div ref={stage} className={`relative flex-1 min-h-0 overflow-hidden flex items-center justify-center ${z.s > 1 ? (drag.current ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
        onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoomAt(z.s > 1 ? 1 : 2.5, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2); }}
        onPointerDown={(e) => { if (z.s <= 1 || (e.target as HTMLElement).closest('button')) return; drag.current = { px: e.clientX, py: e.clientY, x: z.x, y: z.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const g = drag.current; if (g) setZ((o) => ({ ...o, x: g.x + e.clientX - g.px, y: g.y + e.clientY - g.py })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <button onClick={() => go(index - 1)} disabled={index === 0} className={`${arrow} left-4`} aria-label="Previous frame (←)" title="Previous (←)"><ChevronLeft size={26} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={item.src} src={item.src} alt={item.title} draggable={false} className="max-w-[calc(100%-8rem)] max-h-full object-contain"
          style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`, transition: drag.current ? 'none' : 'transform 120ms ease-out' }} />
        <button onClick={() => go(index + 1)} disabled={index === items.length - 1} className={`${arrow} right-4`} aria-label="Next frame (→)" title="Next (→)"><ChevronRight size={26} /></button>
      </div>
      <p className="text-center text-xs text-white/50 py-2 shrink-0" aria-hidden>{index + 1} / {items.length} · ← → to step · scroll or double-click to zoom · drag to move</p>
    </div>,
    document.body,
  );
}

// Request changes: plain words, like a message to Claude. "Insert time" adds the player's
// current time, so changes can point at a moment ("at 0:24 move the card left").
function ChangesDialog({ stage, at, atName, onClose, onSend }: { stage: FirstDraft['stage'] | undefined; at: number | null; atName: string; onClose: () => void; onSend: (t: string, forFuture: boolean) => void }) {
  const [text, setText] = useState('');
  const [future, setFuture] = useState(false);
  const send = () => { if (text.trim()) onSend(text.trim(), future); };
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
        <button onClick={send} disabled={!text.trim()} className={btn}><Send size={15} aria-hidden /> Send changes</button>
      </>}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className={`${label} !mb-0`} htmlFor="changes-text">What should change?</label>
          {at != null && <button type="button" onClick={insert} className="inline-flex items-center gap-1 text-xs text-18-orange hover:underline"><Clock size={12} aria-hidden /> Insert time {stamp}</button>}
        </div>
        <textarea id="changes-text" ref={box} rows={9} value={text} onChange={(e) => setText(e.target.value)} className={`${field} resize-y`}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
          placeholder={'Write it the way you would tell Claude. e.g.\n• At 0:24 move the card to the left, it covers the face\n• The whiteboard at 1:11 should finish drawing before the cut\n• Remove the zoom at the start\n• Spell it 18startup, not 18 Startup'} />
        <p className="text-[11px] text-st-mute">Ctrl+Enter sends.</p>
        <label className="flex items-start gap-2.5 mt-3 p-3 rounded-lg border border-st-line hover:bg-st-surface cursor-pointer">
          <input type="checkbox" checked={future} onChange={(e) => setFuture(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F37335] shrink-0" aria-describedby="changes-future-help" />
          <span>
            <span className="block text-sm font-medium">Save this for future videos too</span>
            <span id="changes-future-help" className="block text-xs text-st-mute mt-0.5">
              Also writes this change into the editing skill as a rule, so every new video follows it. The AI editor tells you the exact rule it added. Leave it off for fixes that only fit this video.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

// ---------- AI features bar ----------
const pill = 'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed';
function AiBar({ running, busyElsewhere, draft, chatOpen, unread, captionChanges, hasBoard, onFeature, onDraft, onStoryboard, onChanges, onChat, onStop }: {
  running: boolean; busyElsewhere: string | null; draft: FirstDraft | null; chatOpen: boolean; unread: boolean; captionChanges: number | null;
  hasBoard: boolean; onFeature: (f: (typeof AI_FEATURES)[number]) => void; onDraft: () => void; onStoryboard: () => void; onChanges: () => void; onChat: () => void; onStop: () => void;
}) {
  const blocked = running || !!busyElsewhere;
  const st = draft?.stage;
  // The storyboard opens once one has been made, by the 1st draft or from Ask AI.
  const storyboardOpen = hasBoard || st === 'storyboard' || st === 'draft-working' || st === 'draft';
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
          // Once the captions are made, this opens their before/after review (also while the AI works).
          f.key === 'captions' && captionChanges != null ? (
            <button key={f.key} onClick={() => onFeature(f)} title="Open the captions review: every caption that differs from the speech-to-text, before and after"
              className={`${pill} border-st-line text-st-ink hover:border-18-orange/50 hover:text-18-orange`}>
              <CheckCircle2 size={13} className="text-emerald-600" aria-hidden /> Captions review
              <span className="rounded-full bg-st-surface border border-st-line px-1.5 text-[10px] tabular-nums">{captionChanges}</span>
            </button>
          ) : (
            <button key={f.key} onClick={() => onFeature(f)} disabled={blocked} className={`${pill} border-st-line text-st-ink hover:border-18-orange/50 hover:text-18-orange`}>
              {f.label}
            </button>
          )
        ))}
        <button onClick={onStoryboard} disabled={!storyboardOpen} title={storyboardOpen ? 'Open the storyboard' : 'Unlocks once a storyboard has been made (1st draft, or ask for one in Ask AI)'}
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
type Clip = { id: string; track: TrackKey; kind: string; text: string; start: number; end: number; ref: { key: string; index: number } };
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
  shots: 'Shot', panels: 'Whiteboard panel', brolls: 'B-roll', // the Testimonial layout (testimonial.json)
};
const V1_KEYS = new Set(['segments', 'splitScreens', 'shots']); // B-roll cutaways sit on V2, over the footage

// Drag and drop from Media files onto the timeline.
const DRAG_TYPE = 'application/x-studio-media';
const dragKindType = (k: string) => `application/x-studio-kind-${k}`;
type DropMedia = { path: string; name: string; kind: 'video' | 'image' | 'audio' };
const DROP_TRACK: Record<DropMedia['kind'], TrackKey[]> = { video: ['V1', 'V2'], image: ['V2'], audio: ['A1'] };
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
  const add = (track: TrackKey, kind: string, text: string, start: number, end: number, key: string, index: number) => clips.push({ id: `${track}-${clips.length}`, track, kind, text, start, end: Math.max(end, start + 0.05), ref: { key, index } });

  const segs = Array.isArray(data.segments) ? data.segments.filter(isObj) : [];
  let pos = num(data.introPreroll) ?? 0;
  segs.forEach((sg, i) => {
    const from = num(sg.from) ?? 0, to = num(sg.to) ?? from;
    add('V1', 'Footage', `${base(sg.src)} ${fmtTime(from)}–${fmtTime(to)}`, pos, pos + (to - from), 'segments', i);
    add('A1', 'Voice', base(sg.src), pos, pos + (to - from), 'segments', i);
    pos += to - from;
  });
  // One continuous source; with shots (the Testimonial layout's framings) those are the V1 clips.
  if (!segs.length && typeof data.src === 'string' && !Array.isArray(data.shots)) add('V1', 'Footage', base(data.src), 0, duration, 'src', -1);
  if (!segs.length && typeof data.src === 'string') add('A1', 'Voice', base(data.src), 0, duration, 'src', -1);

  for (const [key, v] of Object.entries(data)) {
    if (key === 'segments' || key === 'sfx' || key === 'music') continue;
    const list = Array.isArray(v) ? v : isObj(v) ? [v] : [];
    list.forEach((it, index) => {
      if (!isObj(it)) return;
      const start = num(it.start), end = num(it.end);
      if (start == null || end == null) return;
      const kind = isObj(it) && key === 'scenes' && typeof it.kind === 'string' ? `Scene (${it.kind})` : KIND[key] ?? key;
      const shot = key === 'shots' ? (it.kind === 'both' ? 'Both speakers' : typeof it.kind === 'string' ? `Speaker ${it.kind.toUpperCase()}` : '') : '';
      add(key === 'captions' ? 'CC' : V1_KEYS.has(key) ? 'V1' : 'V2', kind, shot || describe(it), start, end, key, Array.isArray(v) ? index : -1);
    });
  }

  if (typeof data.audio === 'string') add('A1', 'Voice', base(data.audio), 0, duration, 'audio', -1);
  const music = isObj(data.music) ? data.music : null;
  if (music?.src) add('A1', 'Music', base(music.src), 0, duration, 'music', -1);
  if (Array.isArray(data.sfx)) data.sfx.forEach((fx, i) => { if (isObj(fx) && num(fx.at) != null) add('A1', 'SFX', base(fx.src), fx.at as number, (fx.at as number) + 0.6, 'sfx', i); });

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

// How the timeline and the player stay in step:
//  - player shows the rendered edit ("program") -> its time IS the timeline time
//  - player shows a source file the footage cuts use (e.g. raw/raw.mp4) -> source time is mapped
//    through the cuts (segments) to timeline time, and playing runs cut to cut like a real edit
//  - player shows something else -> clicking the timeline opens the up-to-date render, else the
//    footage cut under the click, at the matching moment
type Seg = { rel: string | null; from: number; to: number; start: number; end: number };

type TimelineEdit = { op: 'split' | 'delete'; key: string; index: number; at?: number } | { op: 'delete-many'; items: { key: string; index: number }[] }
  | { op: 'trim'; key: string; index: number; edge: 'start' | 'end'; to: number };
// Clips whose edges can be dragged: footage cuts and anything else with its own start / end in the edit.
const trimmable = (c: Clip) => c.ref.index >= 0 && !['music', 'sfx', 'src', 'audio', 'shots'].includes(c.ref.key);

// A small tooltip under a toolbar button: its name and its shortcut, shown on hover or keyboard focus.
function Tip({ label, keys, children, wide }: { label: string; keys?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span role="tooltip" className={`pointer-events-none absolute top-full z-40 mt-1.5 rounded-md bg-st-ink px-2 py-1 text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity delay-150 group-hover:opacity-100 group-focus-within:opacity-100 ${wide ? 'right-0 w-72 whitespace-pre-line' : 'left-1/2 -translate-x-1/2 whitespace-nowrap'}`}>
        {label}{keys && <kbd className="ml-1.5 rounded bg-white/20 px-1 font-sans">{keys}</kbd>}
      </span>
    </span>
  );
}

const SPEEDS = [1, 1.5, 2, 2.5, 3];

function Timeline({ data, file, srcPrefix, video, player, viewPath, programPath, programFresh, programName, clock, timelineMode, live: liveCtl, onOpen, muted, onMute, onAsk, onDropMedia, notice, onUndo, onDismiss, magnetic, onMagnetic, markers, onMarkers, onEdit, onPick }: {
  data: Obj | null; file: string | null; srcPrefix: string; video: HTMLVideoElement | null; player: HTMLVideoElement | null;
  viewPath: string | null; programPath: string | null; programFresh: boolean; programName: string | null; clock: Clock; timelineMode: boolean; live: Live | null;
  onOpen: (path: string, start: number, play: boolean) => void; muted: boolean; onMute: () => void; onAsk: (c: Clip) => void;
  onDropMedia: (m: DropMedia, track: TrackKey, at: number) => void;
  notice: { text: string; error?: boolean; undo?: boolean } | null; onUndo: () => void; onDismiss: () => void;
  magnetic: boolean; onMagnetic: () => void; markers: number[]; onMarkers: (m: number[]) => void; onEdit: (e: TimelineEdit) => void;
  onPick?: (p: Picked | null) => void; // one clip selected: it opens in the Edit tab
}) {
  const { clips, duration } = useMemo(() => (data ? buildClips(data) : { clips: [], duration: 0 }), [data]);
  // Playback speed: each click goes 1x → 1.5x → 2x → 2.5x → 3x → 1x. It applies to both players and the
  // live preview. defaultPlaybackRate too, so it stays when the player moves on to another file.
  const [rate, setRate] = useState(1);
  const nextRate = () => setRate((r) => SPEEDS[(SPEEDS.indexOf(r) + 1) % SPEEDS.length]);
  useEffect(() => {
    for (const v of [video, player]) if (v) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
  }, [rate, video, player]);
  useEffect(() => {
    if (!liveCtl) return;
    liveCtl.post({ type: 'rate', r: rate });
    let was = liveCtl.get().ready;
    // The preview page loads again after some changes: tell it the speed again.
    return liveCtl.sub(() => { const now = liveCtl.get().ready; if (now && !was) liveCtl.post({ type: 'rate', r: rate }); was = now; });
  }, [liveCtl, rate]);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  // Selected clips (by id). One clip shows its details below the timeline; several can be deleted together.
  const [selIds, setSelIds] = useState<string[]>([]);
  const selClips = useMemo(() => clips.filter((c) => selIds.includes(c.id)), [clips, selIds]);
  const one = selClips.length === 1 ? selClips[0] : null;
  const oneKey = one ? `${one.ref.key}:${one.ref.index}:${one.track}` : '';
  useEffect(() => {
    onPick?.(one ? { key: one.ref.key, index: one.ref.index, kind: one.kind, track: one.track, start: one.start, end: one.end } : null);
  }, [oneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = selClips.length === 1 ? selClips[0] : null;
  const setSel = (c: Clip | null) => setSelIds(c ? [c.id] : []);
  // Clips are renumbered when they are added, removed or moved: the selection is cleared then. Not for
  // a reload of the same clips or an Edit-tab change (text, position, volume), so the clip stays selected.
  const clipSig = useMemo(() => clips.map((c) => `${c.id}|${c.ref.key}|${c.ref.index}|${c.start.toFixed(3)}|${c.end.toFixed(3)}`).join(','), [clips]);
  useEffect(() => { setSelIds([]); }, [clipSig]);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // drag-select rectangle (page px)
  const dragged = useRef(false);
  const [tool, setTool] = useState<'select' | 'cut'>('select');
  const [hoverCut, setHoverCut] = useState<number | null>(null); // cut tool: where a click would cut
  const lanesRef = useRef<HTMLDivElement>(null);
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
  }, [data == null]); // the scroller only exists once there is a timeline

  // The footage cuts in timeline order, with the source file each one plays (relative path).
  const segs = useMemo<Seg[]>(() => {
    if (!data) return [];
    let pos = num(data.introPreroll) ?? 0;
    return (Array.isArray(data.segments) ? data.segments.filter(isObj) : []).map((s) => {
      const from = num(s.from) ?? 0, to = num(s.to) ?? from;
      const src = typeof s.src === 'string' ? s.src.replace(/\\/g, '/') : '';
      const seg = { rel: src.startsWith(srcPrefix) ? src.slice(srcPrefix.length) : null, from, to, start: pos, end: pos + (to - from) };
      pos = seg.end;
      return seg;
    });
  }, [data, srcPrefix]);
  const mode: 'live' | 'program' | 'source' | 'none' = liveCtl ? 'live'
    : viewPath && viewPath === programPath ? 'program' : viewPath && segs.some((s) => s.rel === viewPath) ? 'source' : 'none';
  // Live preview: the playhead follows its time.
  useEffect(() => {
    if (!liveCtl) return;
    setOutside(false);
    const f = () => setT(liveCtl.get().t);
    f();
    return liveCtl.sub(f);
  }, [liveCtl]);
  const curSeg = useRef(0); // the cut the player is in (source mode)
  const [outside, setOutside] = useState(false); // source mode: the player is on a part that is cut out

  // Follow the player, and in source mode play cut to cut.
  useEffect(() => {
    if (!video || mode === 'none' || mode === 'live') return;
    const map = (): number | null => {
      const ts = video.currentTime;
      if (mode === 'program') return ts;
      const inSeg = (s: Seg | undefined) => !!s && s.rel === viewPath && ts >= s.from - 0.05 && ts <= s.to + 0.05;
      if (!inSeg(segs[curSeg.current])) {
        const i = segs.findIndex(inSeg);
        if (i < 0) return null;
        curSeg.current = i;
      }
      const s = segs[curSeg.current];
      return s.start + Math.min(ts, s.to) - s.from;
    };
    const update = () => {
      const m = map();
      setOutside(m == null);
      if (m != null) setT(m);
      // Playing the timeline and the player is on a part that is cut out: go to the next cut.
      if (mode === 'source' && timelineMode && m == null) {
        const ts = video.currentTime;
        const i = segs.findIndex((x) => x.rel === viewPath && x.from >= ts - 0.05);
        const n = i >= 0 ? segs[i] : segs[curSeg.current + 1];
        if (!n || !n.rel) { video.pause(); return; }
        curSeg.current = i >= 0 ? i : curSeg.current + 1;
        if (n.rel === viewPath) video.currentTime = n.from;
        else onOpen(n.rel, n.from, !video.paused);
        return;
      }
      // End of this cut while playing: go on to the next one, in this file or the next.
      if (mode === 'source' && timelineMode && !video.paused && m != null) {
        const s = segs[curSeg.current];
        if (video.currentTime >= s.to - 0.04) {
          const n = segs[curSeg.current + 1];
          if (!n) { video.pause(); return; }
          curSeg.current += 1;
          if (n.rel === viewPath) video.currentTime = n.from;
          else if (n.rel) onOpen(n.rel, n.from, true);
          else video.pause();
        }
      }
    };
    // A short interval while playing (requestAnimationFrame stalls in background tabs).
    let timer: ReturnType<typeof setInterval> | null = null;
    const onPlay = () => { if (!timer) timer = setInterval(update, 40); };
    const onPause = () => { if (timer) { clearInterval(timer); timer = null; } update(); };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', update);
    video.addEventListener('timeupdate', update);
    video.addEventListener('loadedmetadata', update);
    update();
    if (!video.paused) onPlay();
    return () => {
      if (timer) clearInterval(timer);
      video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', update); video.removeEventListener('timeupdate', update); video.removeEventListener('loadedmetadata', update);
    };
  }, [video, mode, segs, viewPath, onOpen, timelineMode]);

  const pps = zoom || (duration ? Math.max(2, width / duration) : 10);
  const total = Math.max(width, duration * pps);
  const seek = (sec: number) => {
    const s = Math.max(0, Math.min(duration, sec));
    setT(s);
    if (mode === 'live' && liveCtl) { liveCtl.seek(s); return; }
    if (mode === 'program' && video) { video.currentTime = s; return; }
    if (mode === 'none' && programFresh && programPath) { onOpen(programPath, s, false); return; }
    // The footage cut under this point (before the first cut: the first; past the last: the last).
    if (!segs.length) { if (programPath) onOpen(programPath, s, false); return; }
    let i = segs.findIndex((x) => s >= x.start && s < x.end);
    if (i < 0) i = s < segs[0].start ? 0 : segs.length - 1;
    const g = segs[i];
    curSeg.current = i;
    const ts = Math.max(g.from, Math.min(g.to, g.from + (s - g.start)));
    if (g.rel && g.rel === viewPath && video && timelineMode) video.currentTime = ts;
    else if (g.rel) onOpen(g.rel, ts, !!video && !video.paused);
  };

  // Share the clock with the player's timeline controls.
  useEffect(() => { clock.set({ t, duration }); }, [clock, t, duration]);
  useEffect(() => { clock.setSeek(seek); });
  // After a cut, delete or drop, put the player back on the timeline at the same moment.
  const lastSegs = useRef(segs);
  useEffect(() => {
    if (lastSegs.current === segs) return;
    lastSegs.current = segs;
    if (timelineMode && segs.length) seek(Math.min(t, segs[segs.length - 1].end - 0.01));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs]);
  const xToSec = (e: React.MouseEvent<HTMLElement>) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return (e.clientX - r.left) / pps;
  };

  // ---- drag and drop from Media files ----
  // Where a dropped video lands on V1: the cut points between footage cuts (it is inserted there).
  const segBounds = useMemo(() => {
    if (!data) return [0];
    let pos = num(data.introPreroll) ?? 0;
    const b = [pos];
    for (const s of Array.isArray(data.segments) ? data.segments.filter(isObj) : []) { pos += (num(s.to) ?? 0) - (num(s.from) ?? 0); b.push(pos); }
    return b;
  }, [data]);
  const [drop, setDrop] = useState<{ track: TrackKey; at: number; ok: boolean; label: string } | null>(null);
  const dragKind = (e: React.DragEvent): DropMedia['kind'] | null => {
    for (const k of ['video', 'image', 'audio'] as const) if (e.dataTransfer.types.includes(dragKindType(k))) return k;
    return null;
  };
  const target = (e: React.DragEvent<HTMLElement>) => {
    const kind = dragKind(e);
    if (!kind) return null;
    const r = e.currentTarget.getBoundingClientRect();
    let at = Math.max(0, Math.min(duration || Infinity, (e.clientX - r.left) / pps));
    const row = (e.target as HTMLElement).closest('[data-track]') as HTMLElement | null;
    const track = (row?.dataset.track as TrackKey | undefined) ?? 'V1';
    const name = TRACKS.find((x) => x.key === track)?.name ?? track;
    if (locked[track]) return { track, at, ok: false, label: `${track} is locked` };
    if (!DROP_TRACK[kind].includes(track))
      return { track, at, ok: false, label: kind === 'image' ? 'Images go on V2' : kind === 'audio' ? 'Audio goes on A1' : `Videos go on V1 or V2, not ${name}` };
    if (track === 'V1') {
      at = segBounds.reduce((best, b) => (Math.abs(b - at) < Math.abs(best - at) ? b : best), segBounds[0]);
      return { track, at, ok: true, label: `Insert footage at ${fmtTime(at)}` };
    }
    if (track === 'V2') return { track, at, ok: true, label: `B-roll at ${fmtTime(at)}` };
    return { track, at, ok: true, label: `Sound at ${fmtTime(at)} (long audio = music)` };
  };
  const dragOver = (e: React.DragEvent<HTMLElement>) => {
    const d = target(e);
    if (!d) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = d.ok ? 'copy' : 'none';
    setDrop((p) => (p && p.track === d.track && Math.abs(p.at - d.at) < 0.05 && p.ok === d.ok ? p : d));
  };
  const dragLeave = (e: React.DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); };
  const dropIt = (e: React.DragEvent<HTMLElement>) => {
    const d = target(e);
    setDrop(null);
    if (!d?.ok) return;
    e.preventDefault();
    try { onDropMedia(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DropMedia, d.track, d.at); } catch {}
  };

  // Edit points for ← / →: every clip start and end on the visible picture and audio tracks
  // (captions are left out, there is one every second or two).
  const cuts = useMemo(() => {
    const set = new Set<number>([0, Math.round(duration * 100) / 100]);
    for (const c of clips) if (c.track !== 'CC' && !hidden[c.track]) { set.add(Math.round(c.start * 100) / 100); set.add(Math.round(c.end * 100) / 100); }
    for (const m of markers) set.add(Math.round(m * 100) / 100);
    return [...set].filter((s) => s <= duration).sort((a, b) => a - b);
  }, [clips, hidden, duration, markers]);

  // ---- tools ----
  const fps = (data && num(data.fps)) || 30;
  const snapFrame = (x: number) => Math.round(x * fps) / fps;
  const canDelete = (c: Clip) => c.ref.index >= 0 || c.ref.key === 'music';
  const deleteClip = (c: Clip) => { if (!canDelete(c) || locked[c.track]) return; setSel(null); onEdit({ op: 'delete', key: c.ref.key, index: c.ref.index }); };
  // Delete everything selected in one go (one Undo). A footage cut and its sound are the same clip.
  const deleteSelected = (list: Clip[]) => {
    const ok = list.filter((c) => canDelete(c) && !locked[c.track]);
    if (!ok.length) return;
    if (ok.length === 1) return deleteClip(ok[0]);
    const seen = new Set<string>();
    const items = ok.map((c) => c.ref).filter((r) => { const k = `${r.key}:${r.index}`; if (seen.has(k)) return false; seen.add(k); return true; });
    setSelIds([]);
    onEdit({ op: 'delete-many', items });
  };
  // Shift+A: every clip from the playhead on. Shift+Ctrl+A: every clip before it. Hidden or locked tracks are left out.
  const selectFrom = (at: number, forward: boolean) => {
    // A clip that only touches the playhead (ends or starts within ~1 frame of it) belongs to the other side.
    const pick = clips.filter((c) => !hidden[c.track] && !locked[c.track] && (forward ? c.end > at + 0.04 : c.start < at - 0.04));
    setSelIds(pick.map((c) => c.id));
  };
  const toggleMarker = (at: number) => {
    const near = markers.find((m) => Math.abs(m - at) < 0.15);
    onMarkers(near != null ? markers.filter((m) => m !== near) : [...markers, Math.round(at * 100) / 100].sort((a, b) => a - b));
  };
  const lanesSec = (clientX: number) => {
    const r = lanesRef.current?.getBoundingClientRect();
    return r ? Math.max(0, Math.min(duration, (clientX - r.left) / pps)) : 0;
  };

  // Drag a clip's edge to make it longer or shorter. While dragging, an outline shows the new size and the
  // clip is dimmed; on release the new edge is saved, and Undo reverses it. The clip block itself is never
  // moved by hand: React would not put it back where a later change leaves its props the same.
  const trimmedAt = useRef(0); // the click that ends a drag must not also select / seek
  const onEditRef = useRef(onEdit); // the clip blocks are memoised: always save with the latest settings (magnetic)
  onEditRef.current = onEdit;
  const startTrim = (e: React.PointerEvent<HTMLSpanElement>, c: Clip, edge: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget.parentElement as HTMLElement;
    const ghost = document.createElement('div');
    ghost.className = 'absolute pointer-events-none rounded-[4px] border-2 border-st-ink bg-white/40';
    ghost.style.top = el.style.top;
    ghost.style.height = el.style.height;
    ghost.style.left = el.style.left;
    ghost.style.width = el.style.width;
    el.parentElement?.appendChild(ghost);
    el.style.opacity = '0.35';
    const x0 = e.clientX;
    let to = edge === 'start' ? c.start : c.end;
    const tip = document.createElement('div');
    tip.className = 'fixed z-[80] pointer-events-none rounded bg-st-ink px-1.5 py-0.5 text-[11px] text-white tabular-nums';
    document.body.appendChild(tip);
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pps;
      to = snapFrame(edge === 'start' ? Math.max(0, Math.min(c.end - 0.1, c.start + d)) : Math.max(c.start + 0.1, c.end + d));
      const a = edge === 'start' ? to : c.start, b = edge === 'end' ? to : c.end;
      ghost.style.left = `${a * pps}px`;
      ghost.style.width = `${Math.max(2, (b - a) * pps - 1)}px`;
      tip.textContent = `${edge === 'start' ? 'Start' : 'End'} ${fmtTime(to)} · ${(b - a).toFixed(1)}s`;
      tip.style.left = `${ev.clientX + 10}px`;
      tip.style.top = `${ev.clientY - 28}px`;
    };
    const done = (ev: PointerEvent | KeyboardEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('keydown', esc);
      tip.remove();
      ghost.remove();
      el.style.opacity = '';
      trimmedAt.current = Date.now();
      const cancel = 'key' in ev || Math.abs(to - (edge === 'start' ? c.start : c.end)) < 1 / fps / 2;
      if (cancel) return;
      onEditRef.current({ op: 'trim', key: c.ref.key, index: c.ref.index, edge, to });
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') done(ev); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('keydown', esc);
  };

  // Latest values for the window listeners, so they are bound once.
  const selectAll = () => setSelIds(clips.filter((c) => !hidden[c.track] && !locked[c.track]).map((c) => c.id));
  const live = useRef({ t, pps, cuts, player, liveCtl, seek, zoom, selClips, deleteSelected, toggleMarker, selectFrom, selectAll });
  live.current = { t, pps, cuts, player, liveCtl, seek, zoom, selClips, deleteSelected, toggleMarker, selectFrom, selectAll };

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
      // Shift+A / Shift+Ctrl+A: select all clips forward / backward from the playhead.
      if (e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'a' || e.key === 'A') && !typingOrDialog(e)) {
        e.preventDefault();
        live.current.selectFrom(live.current.t, !e.ctrlKey);
        return;
      }
      // Ctrl+A: every clip on the timeline (instead of selecting the page's text).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A') && !typingOrDialog(e)) {
        e.preventDefault();
        live.current.selectAll();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typingOrDialog(e)) return;
      const L = live.current;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        if (L.liveCtl) { L.liveCtl.toggle(); return; }
        if (!L.player) return;
        if (L.player.paused) void L.player.play().catch(() => {}); else L.player.pause();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!L.cuts.length) return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? L.cuts.find((s) => s > L.t + 0.05) : [...L.cuts].reverse().find((s) => s < L.t - 0.05);
        if (next == null) return;
        L.seek(next);
        reveal(next);
      } else if (e.key === 'v' || e.key === 'V') { setTool('select'); setHoverCut(null); }
      else if (e.key === 'c' || e.key === 'C') setTool('cut');
      else if (e.key === 'm' || e.key === 'M') { if (!e.repeat) L.toggleMarker(L.t); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && L.selClips.length) { e.preventDefault(); L.deleteSelected(L.selClips); }
      else if (e.key === 'Escape' && L.selClips.length) setSelIds([]);
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

  const dropRow = drop ? (drop.ok ? drop.track : `!${drop.track}`) : null; // the row being dropped on, tinted

  // The clip blocks are memoised so the moving playhead does not re-render hundreds of clips.
  const body = useMemo(() => TRACKS.map((tr) => {
    const ls = byTrack[tr.key];
    const shown = ls.length ? ls.slice(0, tr.key === 'CC' ? 1 : 5) : [[]];
    return (
      <div key={tr.key} data-track={tr.key} className={`relative border-b border-st-line ${hidden[tr.key] ? 'opacity-30' : ''} ${dropRow === tr.key ? 'bg-emerald-50' : dropRow === `!${tr.key}` ? 'bg-red-50' : ''}`} style={{ height: shown.length * LANE_H + 8 }}>
        {shown.map((lane, li) => lane.map((c) => (
          <button key={c.id} type="button" title={`${c.kind} · ${fmtTime(c.start)}–${fmtTime(c.end)}${c.text ? `\n${c.text}` : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (locked[tr.key] || Date.now() - trimmedAt.current < 300) return;
              if (tool === 'cut') { setSel(null); onEdit({ op: 'split', key: c.ref.key, index: c.ref.index, at: snapFrame(lanesSec(e.clientX)) }); return; }
              if (e.shiftKey) { setSelIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id])); return; }
              setSel(c); seek(c.start);
            }}
            data-clip={c.id}
            className={`absolute rounded-[4px] border text-[10px] leading-[16px] px-1 truncate text-left text-white ${tr.color} ${selIds.includes(c.id) ? 'ring-2 ring-st-ink ring-offset-1' : ''} ${locked[tr.key] ? 'cursor-not-allowed' : tool === 'cut' ? 'cursor-crosshair' : 'hover:brightness-110'}`}
            style={{ left: c.start * pps, width: Math.max(2, (c.end - c.start) * pps - 1), top: 4 + li * LANE_H, height: LANE_H - 3 }}>
            {(c.end - c.start) * pps > 36 ? (tr.key === 'CC' ? c.text : `${c.kind}${c.text ? ` · ${c.text}` : ''}`) : ''}
            {tool === 'select' && !locked[tr.key] && trimmable(c) && (c.end - c.start) * pps >= 14 && (['start', 'end'] as const).map((edge) => (
              <span key={edge} aria-hidden onPointerDown={(e) => startTrim(e, c, edge)} onClick={(e) => e.stopPropagation()}
                title={edge === 'start' ? 'Drag to change where it starts' : 'Drag to change where it ends'}
                className={`absolute top-0 bottom-0 w-[6px] cursor-ew-resize ${edge === 'start' ? 'left-0 rounded-l-[3px]' : 'right-0 rounded-r-[3px]'} hover:bg-white/60`} />
            ))}
          </button>
        )))}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [byTrack, pps, hidden, locked, selIds, dropRow, tool]);

  return (
    <section className={`${card} lg:col-span-2 flex flex-col min-h-[200px] max-h-[340px] overflow-hidden`} aria-label="Timeline">
      <header className="flex items-center gap-2 px-3 h-10 border-b border-st-line shrink-0 text-xs">
        <span className="font-semibold text-st-ink">Timeline</span>
        <span className="text-st-mute tabular-nums">{fmtTime(t)} / {fmtTime(duration)}</span>
        {data && (
          <div className="flex items-center gap-1 ml-1" role="toolbar" aria-label="Timeline tools">
            <div className="flex items-center rounded-lg bg-st-surface p-0.5">
              {([['select', 'Select tool', MousePointer2, 'V'], ['cut', 'Cut tool', Scissors, 'C']] as const).map(([k, name, Icon, key]) => (
                <Tip key={k} label={name} keys={key}>
                  <button onClick={() => { setTool(k); setHoverCut(null); }} aria-pressed={tool === k} aria-label={`${name} (${key})`}
                    className={`inline-flex items-center rounded-md p-1.5 ${tool === k ? 'bg-white text-st-ink shadow-sm' : 'text-st-mute hover:text-st-ink'}`}>
                    <Icon size={14} aria-hidden />
                  </button>
                </Tip>
              ))}
            </div>
            <Tip label={magnetic ? 'Magnetic timeline: on' : 'Magnetic timeline: off'}>
              <button onClick={onMagnetic} aria-pressed={magnetic} aria-label={magnetic ? 'Magnetic timeline: on' : 'Magnetic timeline: off'}
                className={`inline-flex items-center rounded-md p-1.5 ${magnetic ? 'bg-18-orange/10 text-18-orange' : 'text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>
                <Magnet size={14} aria-hidden />
              </button>
            </Tip>
            <Tip label="Add marker" keys="M">
              <button onClick={() => toggleMarker(t)} aria-label="Add marker (M)" className="inline-flex items-center rounded-md p-1.5 text-st-mute hover:text-st-ink hover:bg-st-surface">
                <Flag size={14} aria-hidden />
              </button>
            </Tip>
            <Tip label="Playback speed (click to change)">
              <button onClick={nextRate} aria-label={`Playback speed ${rate}x. Click for ${SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]}x`}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums ${rate !== 1 ? 'bg-18-orange/10 text-18-orange' : 'text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>
                <Gauge size={14} aria-hidden /> {rate}x
              </button>
            </Tip>
          </div>
        )}
        <div className="flex-1" />
        <Tip wide label={'Shortcuts\nV  Select tool · C  Cut tool · M  Marker\nDrag  select clips (Shift adds)\nCtrl+A  select all clips\nShift+A  select all clips forward\nShift+Ctrl+A  select all clips backward\nDelete  remove the selected clips · Esc  clear\nSpace  play / pause · ← / →  previous / next cut\nAlt+scroll  zoom · Shift+scroll  move'}>
          <span tabIndex={0} className="hidden md:inline-flex items-center rounded-md p-1.5 text-st-mute hover:text-st-ink cursor-help" aria-label="Keyboard shortcuts">
            <Keyboard size={14} aria-hidden />
          </span>
        </Tip>
        <button onClick={() => setZoom((z) => Math.max(1, (z || pps) / 1.6))} className="p-1 rounded text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Zoom out"><Minus size={14} /></button>
        <button onClick={() => setZoom(0)} className="px-1.5 py-0.5 rounded text-st-mute hover:text-st-ink hover:bg-st-surface">Fit</button>
        <button onClick={() => setZoom((z) => Math.min(400, (z || pps) * 1.6))} className="p-1 rounded text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Zoom in"><Plus size={14} /></button>
      </header>

      {notice && (
        <div className={`flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-st-line text-xs shrink-0 ${notice.error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`} role="status">
          <span className="flex-1 min-w-[12rem]">{notice.text}</span>
          {notice.undo && <button onClick={onUndo} className="rounded-full border border-current/30 px-2.5 py-0.5 font-medium hover:bg-white/60">Undo</button>}
          <button onClick={onDismiss} className="p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
      {!data ? (
        // No edit yet: the whole area takes a first video as the opening footage.
        <div className="flex-1 m-3 rounded-lg border-2 border-dashed grid place-items-center p-4 text-center text-sm transition-colors"
          style={{ borderColor: drop ? (drop.ok ? '#10b981' : '#ef4444') : undefined }}
          onDragOver={(e) => {
            const k = dragKind(e);
            if (!k) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = k === 'video' ? 'copy' : 'none';
            setDrop({ track: 'V1', at: 0, ok: k === 'video', label: k === 'video' ? 'Start the edit with this footage' : 'Start with a video; add images and audio after' });
          }}
          onDragLeave={dragLeave}
          onDrop={(e) => {
            const k = dragKind(e);
            setDrop(null);
            if (k !== 'video') return;
            e.preventDefault();
            try { onDropMedia(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DropMedia, 'V1', 0); } catch {}
          }}>
          <p className={drop ? (drop.ok ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium') : 'text-st-mute'}>
            {drop ? drop.label : 'Drag footage here from Media files to start the edit, or use Create 1st draft and the AI editor builds it.'}
          </p>
        </div>
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
            <div ref={lanesRef} className="relative select-none" style={{ width: total, cursor: tool === 'cut' ? 'crosshair' : undefined }}
              onClick={(e) => { if (dragged.current) { dragged.current = false; return; } seek(xToSec(e)); }}
              onMouseDown={(e) => {
                // Select tool: drag from an empty spot to draw a box; every clip it touches is selected (Shift adds).
                if (tool !== 'select' || e.button !== 0 || (e.target as HTMLElement).closest('[data-clip]')) return;
                const x0 = e.clientX, y0 = e.clientY, add = e.shiftKey, base = add ? selIds : [];
                let moved = false;
                const move = (ev: MouseEvent) => {
                  if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
                  moved = true;
                  const r = { x0, y0, x1: ev.clientX, y1: ev.clientY };
                  setBox(r);
                  const L = Math.min(r.x0, r.x1), R = Math.max(r.x0, r.x1), T = Math.min(r.y0, r.y1), B = Math.max(r.y0, r.y1);
                  const hits = [...(lanesRef.current?.querySelectorAll<HTMLElement>('[data-clip]') ?? [])].filter((el) => {
                    const b = el.getBoundingClientRect();
                    return b.right >= L && b.left <= R && b.bottom >= T && b.top <= B;
                  }).map((el) => el.dataset.clip!).filter((id) => { const c = clips.find((x) => x.id === id); return !!c && !locked[c.track] && !hidden[c.track]; });
                  setSelIds([...new Set([...base, ...hits])]);
                };
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                  setBox(null);
                  if (moved) dragged.current = true; // the click that follows is not a seek
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }}
              onMouseMove={tool === 'cut' ? (e) => setHoverCut(snapFrame(lanesSec(e.clientX))) : undefined} onMouseLeave={() => setHoverCut(null)}
              onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropIt}>
              <div className="h-6 border-b border-st-line relative text-[10px] text-st-mute cursor-pointer bg-st-surface">
                {ticks.map((s) => (
                  <span key={s} className="absolute top-0 h-full border-l border-st-line/80 pl-1 tabular-nums" style={{ left: s * pps }}>{fmtTime(s).replace(/\.0$/, '')}</span>
                ))}
                {markers.map((m, i) => (
                  <button key={m} type="button" onClick={(e) => { e.stopPropagation(); seek(m); }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMarkers(markers.filter((x) => x !== m)); }}
                    title={`Marker ${i + 1} · ${fmtTime(m)}\nClick: jump here · Right-click: remove`} aria-label={`Marker ${i + 1} at ${fmtTime(m)}`}
                    className="absolute top-0 z-20 -translate-x-1/2 flex flex-col items-center text-[9px] font-bold text-white" style={{ left: m * pps }}>
                    <span className="rounded-sm bg-amber-500 px-1 leading-[14px]">{i + 1}</span>
                    <span className="h-0 w-0 border-x-[4px] border-x-transparent border-t-[5px] border-t-amber-500" />
                  </button>
                ))}
              </div>
              {body}
              {markers.map((m) => <div key={`l${m}`} className="absolute top-6 bottom-0 w-px bg-amber-400/70 pointer-events-none z-[5]" style={{ left: m * pps }} />)}
              {box && lanesRef.current && (() => {
                const r = lanesRef.current.getBoundingClientRect();
                return <div className="absolute z-30 pointer-events-none border border-18-orange bg-18-orange/10 rounded-sm"
                  style={{ left: Math.min(box.x0, box.x1) - r.left, top: Math.min(box.y0, box.y1) - r.top, width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />;
              })()}
              {tool === 'cut' && hoverCut != null && (
                <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-st-ink pointer-events-none z-20" style={{ left: hoverCut * pps }}>
                  <span className={`absolute top-0.5 whitespace-nowrap rounded bg-st-ink px-1.5 py-0.5 text-[10px] font-semibold text-white ${hoverCut * pps > total - 90 ? 'right-1' : 'left-1'}`}>Cut {fmtTime(hoverCut)}</span>
                </div>
              )}
              {drop && (
                // Where the drop lands (green) or why it can't (red).
                <div className={`absolute top-0 bottom-0 w-0.5 pointer-events-none z-20 ${drop.ok ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ left: drop.at * pps }}>
                  <span className={`absolute top-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow ${drop.ok ? 'bg-emerald-600' : 'bg-red-600'} ${drop.at * pps > total - 180 ? 'right-1' : 'left-1'}`}>{drop.label}</span>
                </div>
              )}
              <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-10" style={{ left: t * pps }}>
                <span className="absolute -top-0 -left-[5px] h-2.5 w-2.5 bg-red-500 rotate-45" />
              </div>
            </div>
          </div>
        </div>
      )}

      {selClips.length > 1 && (
        <footer className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-st-line text-xs shrink-0 bg-st-surface">
          <span className="font-semibold">{selClips.length} clips selected</span>
          <span className="text-st-mute tabular-nums">{fmtTime(Math.min(...selClips.map((c) => c.start)))}–{fmtTime(Math.max(...selClips.map((c) => c.end)))}</span>
          <span className="flex-1" />
          <button onClick={() => deleteSelected(selClips)} title={magnetic ? 'Remove them all; footage after them moves earlier (Delete key)' : 'Remove them all (Delete key)'}
            className="inline-flex items-center gap-1 rounded-full border border-st-line bg-white px-2.5 py-1 font-medium hover:border-red-300 hover:text-red-700"><Trash2 size={12} aria-hidden /> Delete all</button>
          <button onClick={() => setSelIds([])} className="p-1 text-st-mute hover:text-st-ink" aria-label="Clear selection"><X size={14} /></button>
        </footer>
      )}
      {sel && (
        <footer className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-st-line text-xs shrink-0 bg-st-surface">
          <span className="font-semibold">{sel.kind}</span>
          <span className="text-st-mute tabular-nums">{fmtTime(sel.start)}–{fmtTime(sel.end)}</span>
          <span className="truncate flex-1 min-w-[8rem]" title={sel.text}>{sel.text}</span>
          {canDelete(sel) && (
            <button onClick={() => deleteClip(sel)} title={sel.ref.key === 'segments' ? (magnetic ? 'Remove this footage; everything after it moves earlier (Delete key)' : 'Remove this footage; graphics keep their times (Delete key)') : 'Remove this clip (Delete key)'}
              className="inline-flex items-center gap-1 rounded-full border border-st-line bg-white px-2.5 py-1 font-medium hover:border-red-300 hover:text-red-700"><Trash2 size={12} aria-hidden /> Delete</button>
          )}
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

function Account({ bridge, quiet }: { bridge: Bridge; quiet?: boolean }) {
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

  if (quiet && (!status || status.loggedIn)) return null;
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
  // Files attached to the next message: saved in the project's work/attachments, named in the message.
  const [files, setFiles] = useState<{ name: string; path: string; state: 'saving' | 'saved' | 'failed'; error?: string }[]>([]);
  async function attach(list: FileList | null) {
    for (const f of Array.from(list ?? [])) {
      const name = f.name.replace(/[^\w.\- ()]+/g, '_');
      const path = `work/attachments/${name}`;
      setFiles((all) => [...all.filter((x) => x.path !== path), { name, path, state: 'saving' }]);
      try {
        const r = await fetch(`${BRIDGE}/api/p/upload?id=${encodeURIComponent(id)}&dir=attach&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-Editor-Token': bridge.token }, body: f });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
        setFiles((all) => all.map((x) => (x.path === path ? { ...x, state: 'saved' } : x)));
      } catch (e) {
        setFiles((all) => all.map((x) => (x.path === path ? { ...x, state: 'failed', error: (e as Error).message } : x)));
      }
    }
  }
  const prefill = (t: string) => { setText(t); setTimeout(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(t.length, t.length); } }, 0); };
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

  const ready = files.filter((f) => f.state === 'saved');
  const saving = files.some((f) => f.state === 'saving');
  const submit = () => {
    const t = text.trim();
    if ((!t && !ready.length) || running || saving) return;
    const note = ready.length ? `\n\nAttached files (in this project): ${ready.map((f) => f.path).join(', ')}` : '';
    onSay((t || 'Have a look at the attached files.') + note);
    setText('');
    setFiles([]);
  };

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
        {/* Skills are shared by every video: these start a message that changes the skill itself. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-st-mute">Skills:</span>
          <button onClick={() => prefill('Update the long-form-whiteboard-animation skill itself (not only this project), so every future video follows this: ')} disabled={running}
            className="rounded-full border border-st-line px-2.5 py-1 hover:border-18-orange/50 hover:text-18-orange disabled:opacity-40" title="Add a learning or a change to the editing skill, for all future videos">Update the skill</button>
          <button onClick={() => prefill('Create a new skill called "" that does this, and use it when: ')} disabled={running}
            className="rounded-full border border-st-line px-2.5 py-1 hover:border-18-orange/50 hover:text-18-orange disabled:opacity-40" title="Make a new skill from your description or an attached file (SKILL.md, notes, a .zip)">New skill</button>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
            {files.map((f) => (
              <li key={f.path} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${f.state === 'failed' ? 'border-red-200 text-red-700' : 'border-st-line'}`} title={f.error ?? f.path}>
                {f.state === 'saving' ? <Spinner /> : <Paperclip size={12} aria-hidden />}
                <span className="max-w-[180px] truncate">{f.name}</span>{f.state === 'failed' && ' (not saved)'}
                <button onClick={() => setFiles((all) => all.filter((x) => x.path !== f.path))} className="text-st-mute hover:text-st-ink" aria-label={`Remove ${f.name}`}><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 items-end">
          <label className={`p-2 rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface shrink-0 cursor-pointer ${running ? 'opacity-40 pointer-events-none' : ''}`} title="Attach files: notes, a SKILL.md, a .docx or .zip, images…">
            <Paperclip size={17} aria-hidden /><span className="sr-only">Attach files</span>
            <input type="file" multiple className="sr-only" disabled={running} onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          </label>
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={running ? 'The editor is working…' : 'Answer, approve, or ask for changes (e.g. “at 0:24 move the card to the left”)'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className={`${field} resize-none max-h-40`} aria-label="Message to the editor" />
          {running
            ? <button onClick={onStop} className={`${btnGhost} shrink-0`} aria-label="Stop"><Square size={15} aria-hidden /> Stop</button>
            : <button onClick={submit} disabled={(!text.trim() && !ready.length) || saving} className={`${btn} shrink-0`} aria-label="Send"><Send size={15} aria-hidden /></button>}
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
