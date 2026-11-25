'use client';

// One brand. The sidebar picks the section (?section=): Create and Library are the
// Work flow, Research is Competition plus "What works", Brand Settings is the
// profile, "Your direction" and Archive. All sections stay mounted, so switching
// never loses work in progress.

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { api, errorText, supabase } from '@/lib/studio/client';
import type { Page } from '@/lib/studio/shared';
import PageForm, { type PageValues } from '../page-form';
import { btnGhost, card, ErrorNote, Spinner, useConfirm } from '../ui';
import Calendar from './calendar';
import Competition from './competition';
import { Direction, PlaybookBox, usePlaybook } from './learnings';
import Knowledge from './knowledge';
import VideoEditor from './video-editor';
import Work from './work';

const TITLES: Record<string, string> = { create: 'Create', calendar: 'Content Calendar', library: 'Library', knowledge: 'Knowledge', video: 'Video Editor', research: 'Research', settings: 'Brand Settings' };

export default function BrandScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  // ?section=silence (the old Silence remover) opens the Video Editor, which has it as Remove pauses & fillers.
  const asked = params.get('section') ?? 'calendar';
  const raw = asked === 'silence' ? 'video' : asked;
  const section = raw in TITLES ? raw : 'calendar';
  const [page, setPage] = useState<Page | null>(null);
  const [videoActions, setVideoActions] = useState<HTMLElement | null>(null); // header spot for the Video Editor's buttons
  const [videoOpen, setVideoOpen] = useState(false); // a Video Editor project is open: no page title
  const [research, setResearch] = useState<'competitors' | 'works'>('competitors');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [ask, dialog] = useConfirm();
  const playbook = usePlaybook(id);

  useEffect(() => {
    supabase()
      .from('studio_brands')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => (error ? setError(errorText(error)) : data ? setPage(data as Page) : setError('Brand not found, or you do not have access to it.')));
  }, [id]);

  async function save(v: PageValues) {
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const f = { name: v.name.trim(), niche: v.niche.trim() };
      await api('brand.update', { brandId: id, ...f });
      setPage({ ...page!, ...f });
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  }

  async function archive() {
    if (!page || busy) return;
    if (!(await ask(`Archive "${page.name}"? It disappears from the list and becomes read-only. Nothing is deleted, and an Admin can restore it.`, 'Archive'))) return;
    setBusy(true);
    try {
      await api('brand.archive', { brandId: id });
      router.push('/studio');
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (!page) return error ? <ErrorNote text={error} /> : <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Loading…</p>;

  return (
    <div>
      {dialog}
      {/* Inside a Video Editor project the project's own bar is the title, so this one is hidden. The
          Content Calendar's month name is its title, which leaves the whole screen for the month. */}
      <header className={`mb-6 flex flex-wrap items-end justify-between gap-3 ${(section === 'video' && videoOpen) || section === 'calendar' ? 'hidden' : ''}`}>
        <div>
          <p className="text-xs text-st-mute">{page.name} <span aria-hidden>/</span> {TITLES[section]}</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">{TITLES[section]}</h1>
        </div>
        <div ref={setVideoActions} className={section === 'video' ? 'flex flex-wrap items-center justify-end gap-2' : 'hidden'} />
      </header>
      {section !== 'create' && section !== 'library' && error && <div className="mb-4"><ErrorNote text={error} /></div>}

      <div hidden={section !== 'create' && section !== 'library'}>
        <Work page={page} view={section === 'library' ? 'library' : 'create'} onOpened={() => router.replace(`/studio/${id}?section=create`)} />
      </div>

      <div hidden={section !== 'calendar'}><Calendar page={page} /></div>

      <div hidden={section !== 'knowledge'}><Knowledge page={page} /></div>

      {/* Mounted only when open: it talks to the editor bridge on this PC. */}
      {section === 'video' && <VideoEditor actions={videoActions} onProjectOpen={setVideoOpen} />}

      <div hidden={section !== 'research'} className="space-y-5">
        <div role="tablist" aria-label="Research" className="inline-flex rounded-lg bg-st-surface p-1">
          {([['competitors', 'Competitors'], ['works', 'What works']] as const).map(([k, text]) => (
            <button key={k} role="tab" aria-selected={research === k} onClick={() => setResearch(k)}
              className={`px-4 py-1.5 min-h-[36px] text-sm rounded-md transition ${research === k ? 'bg-white text-st-ink font-medium shadow-sm' : 'text-st-mute hover:text-st-ink'}`}>
              {text}
            </button>
          ))}
        </div>
        <div hidden={research !== 'competitors'}><Competition page={page} onUpdateLearnings={playbook.update} /></div>
        <div hidden={research !== 'works'}><PlaybookBox pb={playbook.pb} busy={playbook.busy} error={playbook.error} onUpdate={playbook.update} /></div>
      </div>

      <div hidden={section !== 'settings'} className="space-y-6">
        <section className={`${card} p-5`}>
          <h2 className="font-semibold">Brand profile</h2>
          <p className="text-sm text-st-mute mt-1 mb-4">The name and niche the research and the writer start from.</p>
          <PageForm mode="edit" initial={{ ...page, audience: page.audience ?? '', voice: page.voice ?? '' }} submitLabel="Save profile" busy={busy} onSubmit={save} />
          {saved && <p role="status" className="text-sm text-emerald-700 mt-3">Saved.</p>}
        </section>
        <Direction page={page} onPageChange={setPage} />
        <section className={`${card} p-5`}>
          <h2 className="font-semibold">Archive this brand</h2>
          <p className="text-sm text-st-mute mt-1 mb-3">Hides it from the list and makes it read-only. Nothing is deleted, and an Admin can restore it.</p>
          <button onClick={archive} disabled={busy} className={btnGhost}><Archive size={15} aria-hidden /> Archive brand</button>
        </section>
      </div>
    </div>
  );
}
