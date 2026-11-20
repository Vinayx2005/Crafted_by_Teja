'use client';

// Silence remover, first screen: the saved projects. Opening one (or making a new one from a video)
// shows the editor. Projects live in this browser only; nothing is uploaded.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Scissors, Trash2 } from 'lucide-react';
import { clock } from '@/lib/studio/silence';
import { deleteProject, getVideo, listProjects, putProject, saveVideo, type Rec } from '@/lib/studio/silence-projects';
import { btn, btnGhost, card, ErrorNote, Spinner, useConfirm } from '../ui';
import { Editor } from './silence';

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default function SilenceHome({ actions }: { actions: HTMLElement | null }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [open, setOpen] = useState<{ rec: Rec; blob: Blob | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [space, setSpace] = useState('');
  const [ask, dialog] = useConfirm();

  // The list is read again every time we come back to it.
  useEffect(() => {
    if (open) return;
    listProjects().then(setRecs, () => {
      setRecs([]);
      setError('This browser blocked its project storage (private windows often do). You can still edit, but projects will not be kept.');
    });
    navigator.storage?.estimate?.().then((e) => setSpace(e.usage != null && e.quota ? `${mb(e.usage)} used of ${(e.quota / 1073741824).toFixed(0)} GB available in this browser` : ''), () => {});
  }, [open]);

  async function create(f: File | undefined) {
    if (!f || busy) return;
    setBusy(true);
    setError('');
    const rec: Rec = { id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, size: f.size, total: 0, removed: 0, threshold: 25, minSilence: 0.5, buffer: 0.1, splits: [], overrides: [], vol: null, hasVideo: false, updatedAt: Date.now() };
    try {
      await saveVideo(rec.id, f);
      rec.hasVideo = true;
    } catch {
      setError('There is not enough room in this browser to keep this video. You can edit it now, but you will need to choose it again when you reopen the project.');
    }
    await putProject(rec).catch(() => {});
    setOpen({ rec, blob: f });
    setBusy(false);
  }

  async function openRec(rec: Rec) {
    if (busy) return;
    setBusy(true);
    setError('');
    const blob = rec.hasVideo ? await getVideo(rec.id).catch(() => null) : null;
    setOpen({ rec, blob });
    setBusy(false);
  }

  async function remove(rec: Rec) {
    if (!(await ask(`Delete "${rec.name}"? The saved video and all its edits are removed from this browser. This cannot be undone.`, 'Delete'))) return;
    await deleteProject(rec.id).catch(() => setError('Could not delete that project.'));
    setRecs((r) => r && r.filter((x) => x.id !== rec.id));
  }

  if (open) return <Editor key={open.rec.id} actions={actions} rec={open.rec} blob={open.blob} onBack={() => setOpen(null)} />;

  const pick = (
    <label className={`${btn} !min-h-[36px] !px-3 cursor-pointer`}>
      {busy ? <Spinner /> : <Plus size={14} aria-hidden />} New project
      <input type="file" accept="video/*,audio/*" className="sr-only" onChange={(e) => { create(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );

  return (
    <div className="space-y-4">
      {dialog}
      {actions && createPortal(pick, actions)}
      <ErrorNote text={error} />
      {recs === null ? (
        <p className="flex items-center gap-2 text-sm text-st-mute"><Spinner /> Loading your projects…</p>
      ) : recs.length === 0 ? (
        <div className={`${card} grid place-items-center gap-3 p-10 text-center`}>
          <Scissors size={28} className="text-st-mute" aria-hidden />
          <h2 className="font-semibold">No projects yet</h2>
          <p className="max-w-sm text-sm text-st-mute">Choose a video to remove its silent parts. Your work is saved here automatically, so you can come back to it any time.</p>
          {pick}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map((r) => (
              <li key={r.id} className={`${card} flex flex-col justify-between gap-4 p-4`}>
                <button onClick={() => openRec(r)} disabled={busy} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 rounded-md">
                  <h3 className="truncate font-semibold">{r.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-st-mute">{r.fileName} · {mb(r.size)}{r.hasVideo ? '' : ' · video not kept'}</p>
                  <p className="mt-3 text-sm tabular-nums">{r.vol ? <>{clock(r.total)} <span className="text-st-mute">becomes</span> <b>{clock(Math.max(0, r.total - r.removed))}</b></> : <span className="text-st-mute">Not analysed yet</span>}</p>
                  <p className="mt-1 text-xs text-st-mute">Edited {when(r.updatedAt)}</p>
                </button>
                <div className="flex items-center justify-between">
                  <button onClick={() => openRec(r)} disabled={busy} className={`${btnGhost} !min-h-[34px] !px-3`}>Open</button>
                  <button onClick={() => remove(r)} aria-label={`Delete ${r.name}`} title="Delete project" className={`${btnGhost} !min-h-[34px] !px-2.5`}><Trash2 size={15} aria-hidden /></button>
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
