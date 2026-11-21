'use client';

// Silence remover. Step 1: the saved projects, and "New project" (a name and a video).
// Step 2: choose the part of the video to work on. Step 3: the editor, for that part only.
// Projects live in this browser only; nothing is uploaded.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, Plus, Scissors, Trash2, Upload } from 'lucide-react';
import { clock, hms, type Span } from '@/lib/studio/silence';
import { deleteProject, getProject, getVideo, listProjects, putProject, saveVideo, type Rec } from '@/lib/studio/silence-projects';
import { btn, btnGhost, card, ErrorNote, field, label, Spinner, useConfirm } from '../ui';
import { Editor, type SilenceFileKind } from './silence';
import { Trim } from './silence-trim';

// When the Silence remover is opened from the Video Editor it is linked to one edit project
// in D:\Editing: its videos come from that project (read through the editor bridge, not copied
// into the browser), and what it exports is saved back into that project.
export type SilenceLink = {
  editorId: string; // the edit project, e.g. "How to build a startup"
  files: { path: string; name: string; size: number }[]; // the project's videos to choose from
  load: (path: string, onPct: (pct: number) => void) => Promise<Blob>;
  onFile: (name: string, blob: Blob, kind: SilenceFileKind) => void;
  // Timeline mode: work on this one video (the footage on the editor's timeline) straight away,
  // with no project list. One saved session per video, so reopening carries on where you left off.
  source?: { path: string; name: string };
  onClose?: () => void;
};

// "New project" when linked: a name, and one of the edit project's videos.
function LinkedNew({ link, busy, onCancel, onCreate }: { link: SilenceLink; busy: boolean; onCancel: () => void; onCreate: (name: string, path: string) => void }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState(link.files[0]?.path ?? '');
  useEffect(() => { if (!name && path) setName(link.files.find((f) => f.path === path)?.name.replace(/\.[^.]+$/, '') ?? ''); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = name.trim().length > 0 && !!path && !busy;
  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-linked-title" className={`${card} w-full max-w-lg p-6 shadow-xl`} onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(name.trim(), path); }}>
        <p className="text-xs font-medium uppercase tracking-wide text-st-mute">Step 1 of 3</p>
        <h2 id="new-linked-title" className="mt-1 text-lg font-semibold">New project</h2>
        <p className={`${label} mt-4`}>Video from this edit</p>
        {link.files.length ? (
          <div className="max-h-64 overflow-y-auto space-y-1.5" role="radiogroup" aria-label="Video">
            {link.files.map((f) => (
              <label key={f.path} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer text-sm ${path === f.path ? 'border-18-orange bg-18-orange/5' : 'border-st-line hover:border-[#D4D4D4]'}`}>
                <input type="radio" name="linked-video" checked={path === f.path} onChange={() => setPath(f.path)} className="accent-[#F37335]" />
                <Film size={15} className="text-st-mute shrink-0" aria-hidden />
                <span className="truncate flex-1">{f.path}</span>
                <span className="text-xs text-st-mute shrink-0">{mb(f.size)}</span>
              </label>
            ))}
          </div>
        ) : <p className="text-sm text-st-mute">This edit has no videos yet. Add footage in the Video Editor first.</p>}
        <label htmlFor="linked-name" className={`${label} mt-4`}>Project name</label>
        <input id="linked-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={field} />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={!ok} className={btn}>{busy ? <Spinner /> : null} Create and continue</button>
        </div>
      </form>
    </div>
  );
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const same = (a?: Span | null, b?: Span | null) => !!a && !!b && Math.abs(a.start - b.start) < 0.01 && Math.abs(a.end - b.end) < 0.01;

// Step 1: "New project" asks for a name and the video.
function NewProject({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (name: string, f: File) => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const ok = name.trim().length > 0 && !!file && !busy;
  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-title" className={`${card} w-full max-w-md p-6 shadow-xl`} onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(name.trim(), file!); }}>
        <p className="text-xs font-medium uppercase tracking-wide text-st-mute">Step 1 of 3</p>
        <h2 id="new-title" className="mt-1 text-lg font-semibold">New project</h2>
        <label htmlFor="proj-name" className={`${label} mt-4`}>Project name</label>
        <input id="proj-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Founder interview, part 1" className={field} />
        <p className={`${label} mt-4`}>Video</p>
        <label className={`${btnGhost} w-full cursor-pointer justify-start`}>
          <Upload size={15} aria-hidden /> <span className="truncate">{file ? `${file.name} · ${mb(file.size)}` : 'Choose a video'}</span>
          <input type="file" accept="video/*,audio/*" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
          }} />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={!ok} className={btn}>{busy ? <Spinner /> : null} {busy ? 'Saving the video…' : 'Create and continue'}</button>
        </div>
      </form>
    </div>
  );
}

export default function SilenceHome({ actions, link }: { actions: HTMLElement | null; link?: SilenceLink }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [open, setOpen] = useState<{ rec: Rec; blob: Blob | null; step: 'trim' | 'edit' } | null>(null);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState<{ name: string; pct: number } | null>(null); // reading a linked video
  const [error, setError] = useState('');
  const [space, setSpace] = useState('');
  const [ask, dialog] = useConfirm();

  // A linked project's video is read from the edit project each time it opens.
  async function loadLinked(path: string): Promise<Blob | null> {
    if (!link) return null;
    setLoading({ name: path, pct: 0 });
    try { return await link.load(path, (pct) => setLoading({ name: path, pct })); }
    catch (e) { setError(`Could not read ${path} from the edit: ${(e as Error).message}`); return null; }
    finally { setLoading(null); }
  }

  // Timeline mode: open (or start) the session for the timeline's video and go straight to the editor.
  const started = useRef(false);
  useEffect(() => {
    const src = link?.source;
    if (!link || !src || started.current) return;
    started.current = true;
    (async () => {
      const all = await listProjects().catch(() => [] as Rec[]);
      let rec = all.find((r) => r.link?.editorId === link.editorId && r.link.path === src.path) ?? null;
      const blob = await loadLinked(src.path);
      if (!blob) return;
      if (!rec) {
        rec = { id: crypto.randomUUID(), name: link.editorId.split('/').pop() ?? link.editorId, fileName: src.name, size: blob.size, range: null, total: 0, removed: 0, threshold: 25, minSilence: 0.5, buffer: 0.1, splits: [], overrides: [], vol: null, hasVideo: false, updatedAt: Date.now(), link: { editorId: link.editorId, path: src.path } };
        await putProject(rec).catch(() => {});
      }
      setOpen({ rec, blob, step: 'edit' });
    })();
  }, [link]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list is read again every time we come back to it. Linked: only this edit's projects.
  useEffect(() => {
    if (open || link?.source) return;
    listProjects().then((all) => setRecs(link ? all.filter((r) => r.link?.editorId === link.editorId) : all), () => {
      setRecs([]);
      setError('This browser blocked its project storage (private windows often do). You can still edit, but projects will not be kept.');
    });
    navigator.storage?.estimate?.().then((e) => setSpace(e.usage != null && e.quota ? `${mb(e.usage)} used of ${(e.quota / 1073741824).toFixed(0)} GB available in this browser` : ''), () => {});
  }, [open]);

  async function keepVideo(rec: Rec, f: File) {
    try {
      await saveVideo(rec.id, f);
      rec.hasVideo = true;
    } catch {
      rec.hasVideo = false;
      setError('There is not enough room in this browser to keep this video. You can work on it now, but you will need to choose it again when you reopen the project.');
    }
  }

  async function create(name: string, f: File) {
    setBusy(true);
    setError('');
    const rec: Rec = { id: crypto.randomUUID(), name, fileName: f.name, size: f.size, range: null, total: 0, removed: 0, threshold: 25, minSilence: 0.5, buffer: 0.1, splits: [], overrides: [], vol: null, hasVideo: false, updatedAt: Date.now() };
    await keepVideo(rec, f);
    await putProject(rec).catch(() => {});
    setNaming(false);
    setBusy(false);
    setOpen({ rec, blob: f, step: 'trim' });
  }

  async function createLinked(name: string, path: string) {
    if (!link) return;
    setBusy(true);
    setError('');
    const f = link.files.find((x) => x.path === path);
    const blob = await loadLinked(path);
    if (!blob) return setBusy(false);
    const rec: Rec = { id: crypto.randomUUID(), name, fileName: f?.name ?? path.split('/').pop() ?? path, size: blob.size, range: null, total: 0, removed: 0, threshold: 25, minSilence: 0.5, buffer: 0.1, splits: [], overrides: [], vol: null, hasVideo: false, updatedAt: Date.now(), link: { editorId: link.editorId, path } };
    await putProject(rec).catch(() => {});
    setNaming(false);
    setBusy(false);
    setOpen({ rec, blob, step: 'trim' });
  }

  async function openRec(rec: Rec) {
    if (busy) return;
    setBusy(true);
    setError('');
    const blob = rec.link && link ? await loadLinked(rec.link.path) : rec.hasVideo ? await getVideo(rec.id).catch(() => null) : null;
    setOpen({ rec, blob, step: rec.vol ? 'edit' : 'trim' });
    setBusy(false);
  }

  // Step 2 done. The same part keeps the analysis and the edits; a new part starts the silence check again.
  async function chosen(part: Span) {
    if (!open) return;
    const rec = same(part, open.rec.range) && open.rec.vol ? open.rec : { ...open.rec, range: part, vol: null, total: 0, removed: 0, splits: [], overrides: [], words: undefined, flags: undefined, updatedAt: Date.now() };
    await putProject(rec).catch(() => {});
    setOpen({ ...open, rec, step: 'edit' });
  }

  // From the editor back to step 2, with the edits the editor has saved since.
  async function changePart() {
    if (!open) return;
    const rec = (await getProject(open.rec.id).catch(() => null)) ?? open.rec;
    setOpen({ ...open, rec, step: 'trim' });
  }

  async function pickVideo(f: File) {
    if (!open) return;
    const rec = { ...open.rec, fileName: f.name, size: f.size };
    await keepVideo(rec, f);
    await putProject(rec).catch(() => {});
    setOpen({ ...open, rec, blob: f });
  }

  async function remove(rec: Rec) {
    if (!(await ask(`Delete "${rec.name}"? The saved video and all its edits are removed from this browser. This cannot be undone.`, 'Delete'))) return;
    await deleteProject(rec.id).catch(() => setError('Could not delete that project.'));
    setRecs((r) => r && r.filter((x) => x.id !== rec.id));
  }

  const timeline = !!link?.source;
  if (open?.step === 'trim') return <Trim key={open.rec.id} actions={actions} name={open.rec.name} blob={open.blob} initial={open.rec.range ?? null} onBack={() => (timeline ? setOpen({ ...open, step: 'edit' }) : setOpen(null))} onNext={chosen} onPick={pickVideo} />;
  if (open) return <Editor key={`${open.rec.id}:${open.rec.range?.start}:${open.rec.range?.end}`} actions={actions} rec={open.rec} blob={open.blob}
    onBack={() => (timeline ? link?.onClose?.() : setOpen(null))} backLabel={timeline ? 'Back to the editor' : undefined} onChangePart={changePart} onFile={link?.onFile} />;

  // Timeline mode never shows the project list: only the loading bar, or what went wrong.
  if (timeline)
    return (
      <div className="space-y-4">
        {loading && (
          <div className={`${card} p-4`} role="status">
            <p className="text-sm flex items-center gap-2"><Spinner /> Reading {loading.name} from the timeline… {loading.pct}%</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-st-surface"><div className="h-full bg-18-orange transition-[width]" style={{ width: `${loading.pct}%` }} /></div>
          </div>
        )}
        <ErrorNote text={error} />
      </div>
    );

  const newButton = (
    <button onClick={() => setNaming(true)} className={`${btn} !py-2 !min-h-[38px] !px-3`}><Plus size={14} aria-hidden /> New project</button>
  );

  return (
    <div className="space-y-4">
      {dialog}
      {naming && (link
        ? <LinkedNew link={link} busy={busy} onCancel={() => setNaming(false)} onCreate={createLinked} />
        : <NewProject busy={busy} onCancel={() => setNaming(false)} onCreate={create} />)}
      {actions && createPortal(newButton, actions)}
      {loading && (
        <div className={`${card} p-4`} role="status">
          <p className="text-sm flex items-center gap-2"><Spinner /> Reading {loading.name} from the edit… {loading.pct}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-st-surface"><div className="h-full bg-18-orange transition-[width]" style={{ width: `${loading.pct}%` }} /></div>
        </div>
      )}
      <ErrorNote text={error} />
      {recs === null ? (
        <p className="flex items-center gap-2 text-sm text-st-mute"><Spinner /> Loading your projects…</p>
      ) : recs.length === 0 ? (
        <div className={`${card} grid place-items-center gap-3 p-10 text-center`}>
          <Scissors size={28} className="text-st-mute" aria-hidden />
          <h2 className="font-semibold">No projects yet</h2>
          <p className="max-w-sm text-sm text-st-mute">Start a project, choose the part of the video you want, and remove its silent parts. Your work is saved here automatically.</p>
          {newButton}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {recs.map((r) => (
              <li key={r.id} className={`${card} flex flex-col justify-between gap-4 p-4`}>
                <button onClick={() => openRec(r)} disabled={busy} className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40">
                  <h3 className="truncate font-semibold">{r.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-st-mute">{r.fileName} · {mb(r.size)}{r.link ? ` · from the Video Editor (${r.link.editorId})` : r.hasVideo ? '' : ' · video not kept'}</p>
                  {r.range && <p className="mt-2 text-xs text-st-mute tabular-nums">Part {hms(r.range.start)} to {hms(r.range.end)}</p>}
                  <p className="mt-1 text-sm tabular-nums">{r.vol ? <>{clock(r.total)} <span className="text-st-mute">becomes</span> <b>{clock(Math.max(0, r.total - r.removed))}</b></> : <span className="text-st-mute">{r.range ? 'Not checked for silences yet' : 'Part not chosen yet'}</span>}</p>
                  <p className="mt-1 text-xs text-st-mute">Edited {when(r.updatedAt)}</p>
                </button>
                <div className="flex items-center justify-between">
                  <button onClick={() => openRec(r)} disabled={busy} className={`${btnGhost} !min-h-[38px] !px-3`}>Open</button>
                  <button onClick={() => remove(r)} aria-label={`Delete ${r.name}`} title="Delete project" className={`${btnGhost} !min-h-[38px] !px-2.5`}><Trash2 size={15} aria-hidden /></button>
                </div>
              </li>
            ))}
          </ul>
          {space && <p className="text-xs text-st-mute">{space}.</p>}
        </>
      )}
    </div>
  );
}
