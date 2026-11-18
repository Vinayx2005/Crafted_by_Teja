'use client';

// Knowledge: documents and notes the writer may rely on for this brand.
// Only the text is stored (a PDF is read once and the file is not kept). The server picks the
// passages that fit each topic and puts them into every script and rewrite.

import { useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, errorText } from '@/lib/studio/client';
import { docxText } from '@/lib/studio/docx';
import type { Page } from '@/lib/studio/shared';
import { ago, btn, btnGhost, card, ErrorNote, field, label, Spinner, useConfirm } from '../ui';

type Item = { id: string; title: string; kind: 'text' | 'file'; fileName: string | null; updatedAt: string; words: number; preview: string };
const MAX_BYTES = 2.5 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,.txt,.md,.csv';
const PDF_STEP = 10; // pages read per request
const PART_CHARS = 55_000; // a saved resource holds at most 60,000 characters

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    r.readAsDataURL(f);
  });

export default function Knowledge({ page }: { page: Page }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [ready, setReady] = useState(false); // the database table exists
  const [max, setMax] = useState(50);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string; content: string } | null>(null);
  const [ask, dialog] = useConfirm();
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    api<{ items: Item[]; max: number }>('knowledge.list', { pageId: page.id })
      .then((d) => { setItems(d.items); setMax(d.max); setReady(true); })
      .catch((e) => { setItems([]); setError(errorText(e)); });
  useEffect(() => { load(); }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (what: string, fn: () => Promise<void>) => {
    if (busy) return; // no double submits
    setBusy(what);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy('');
  };

  // One file. Word and text files are read here. A PDF is read by the server a few pages at a
  // time (a book cannot be retyped inside one request); long ones are saved as several parts,
  // because one resource holds up to 60,000 characters.
  async function ingest(f: File, say: (m: string) => void): Promise<number> {
    if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 2.5 MB. Split it, or paste the important parts as text.`);
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 100);
    if (ext !== 'pdf') {
      if (!['docx', 'txt', 'md', 'csv'].includes(ext)) throw new Error(`${f.name}: use a PDF, Word (.docx), .txt, .md or .csv file.`);
      const text = ext === 'docx' ? await docxText(f) : await f.text();
      await api('knowledge.add', { pageId: page.id, title: name, fileName: f.name, content: text });
      return 1;
    }

    const data = await toBase64(f);
    // Dense pages can take longer than one request allows: when that happens, the range is
    // split in half and each half read on its own.
    const read = (from: number, to: number) => api<{ text: string; total: number }>('knowledge.readPdf', { pageId: page.id, fileName: f.name, data, from, to });
    const readRange = async (from: number, to: number): Promise<{ text: string; total: number }> => {
      try {
        return await read(from, to);
      } catch (e) {
        if (to - from >= 2 && /took too long/i.test(errorText(e))) {
          const mid = Math.floor((from + to) / 2);
          const a = await readRange(from, mid);
          const b = await readRange(mid + 1, to);
          return { text: [a.text, b.text].filter(Boolean).join('\n\n'), total: a.total || b.total };
        }
        return read(from, to); // any other hiccup: one more plain try
      }
    };
    const parts: string[] = [];
    let buf = '';
    let total = 0;
    for (let from = 1; from <= 3000; from += PDF_STEP) {
      say(`Reading ${f.name}: pages ${from}–${total ? Math.min(from + PDF_STEP - 1, total) : from + PDF_STEP - 1}${total ? ` of ${total}` : ''}…`);
      const r = await readRange(from, from + PDF_STEP - 1);
      total ||= r.total;
      if (r.text) {
        if (buf && buf.length + r.text.length > PART_CHARS) { parts.push(buf); buf = ''; }
        buf += (buf ? '\n\n' : '') + r.text;
      }
      if ((total && from + PDF_STEP > total) || (!total && !r.text)) break;
    }
    if (buf.trim()) parts.push(buf);
    if (!parts.length) throw new Error(`No readable text was found in ${f.name}.`);
    for (let i = 0; i < parts.length; i++) {
      say(`Saving ${f.name}…`);
      await api('knowledge.add', { pageId: page.id, title: parts.length > 1 ? `${name} (part ${i + 1} of ${parts.length})` : name, fileName: f.name, content: parts[i] });
    }
    return parts.length;
  }
  const upload = (files: FileList | File[]) =>
    run('upload', async () => {
      if (!ready) throw new Error('Run migrations/studio_knowledge.sql in Supabase first, then reload this page.');
      const list = [...files];
      let done = 0;
      const problems: string[] = [];
      for (const f of list) {
        // The same file twice would put every passage in the writer's prompt twice.
        if ((items ?? []).some((i) => i.fileName === f.name) && !(await ask(`"${f.name}" is already in your knowledge. Add it again?`, 'Add again', false))) continue;
        const say = (m: string) => setNotice(list.length > 1 ? `${m} (file ${done + problems.length + 1} of ${list.length})` : m);
        try {
          say(`Reading ${f.name}…`);
          await ingest(f, say);
          done++;
        } catch (e) {
          problems.push(errorText(e));
        }
      }
      setNotice(done ? `Added ${done} ${done === 1 ? 'file' : 'files'}. The writer will use ${done === 1 ? 'it' : 'them'} from the next script.` : '');
      if (problems.length) setError(problems.join(' '));
      if (input.current) input.current.value = '';
      await load();
    });

  const addText = (e: React.FormEvent) => {
    e.preventDefault();
    return run('add', async () => {
      await api('knowledge.add', { pageId: page.id, title, content });
      setTitle('');
      setContent('');
      setNotice('Saved. The writer will use it from the next script.');
      await load();
    });
  };
  const startEdit = (id: string) =>
    run('open', async () => {
      const { item } = await api<{ item: { id: string; title: string; content: string } }>('knowledge.get', { pageId: page.id, id });
      setEditing({ id: item.id, title: item.title, content: item.content });
    });
  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    return run('save', async () => {
      await api('knowledge.update', { pageId: page.id, ...editing });
      setEditing(null);
      setNotice('Updated.');
      await load();
    });
  };
  const remove = async (it: Item) => {
    if (!(await ask(`Delete "${it.title}"? The writer will stop using it. This cannot be undone.`, 'Delete'))) return;
    run('del', async () => {
      await api('knowledge.delete', { pageId: page.id, id: it.id });
      setNotice('Deleted.');
      await load();
    });
  };

  const kindLabel = (it: Item) => (it.kind === 'text' ? 'Note' : (it.fileName?.split('.').pop() ?? 'file').toUpperCase());

  return (
    <div className="space-y-8">
      {dialog}
      <p className="text-sm text-st-mute max-w-2xl">
        Give the writer material about this brand: product details, past articles, FAQs, policies, research. When it fits a topic, the writer uses it as fact in scripts and rewrites. Only the text is kept; uploaded files are not stored.
      </p>
      <ErrorNote text={error} />
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}

      {/* Upload */}
      <section>
        <h2 className="font-semibold">Upload documents</h2>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length && !busy) upload(e.dataTransfer.files); }}
          className={`mt-3 rounded-xl border border-dashed px-5 py-8 text-center transition ${drag ? 'border-18-orange bg-18-orange/10' : 'border-[#D4D4D4] bg-st-surface'}`}
        >
          <Upload size={20} className="mx-auto text-st-mute" aria-hidden />
          <p className="text-sm mt-2">Drop files here, or</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="kn-files" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          <button onClick={() => input.current?.click()} disabled={!!busy} className={`${btn} mt-3`}>
            {busy === 'upload' ? <Spinner /> : null} {busy === 'upload' ? 'Reading…' : 'Choose files'}
          </button>
          <p className="text-xs text-st-mute mt-3">PDF, Word (.docx), .txt, .md or .csv · up to 2.5 MB each. A long PDF is read in sections and can take a few minutes.</p>
        </div>
      </section>

      {/* Free text */}
      <section>
        <h2 className="font-semibold">Or add text</h2>
        <form onSubmit={addText} className="mt-3 space-y-3 max-w-2xl">
          <div>
            <label className={label} htmlFor="kn-title">Title</label>
            <input id="kn-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Refund policy" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="kn-text">Text</label>
            <textarea id="kn-text" rows={6} value={content} maxLength={60000} onChange={(e) => setContent(e.target.value)} placeholder="Paste or type anything the writer should know" className={field} />
          </div>
          <button disabled={!title.trim() || !content.trim() || !!busy} className={btn}>
            {busy === 'add' ? <Spinner /> : <Plus size={15} aria-hidden />} Save text
          </button>
        </form>
      </section>

      {/* The list */}
      <section>
        <h2 className="font-semibold">Your resources {items ? <span className="font-normal text-st-mute">({items.length} of {max})</span> : null}</h2>
        {items === null ? (
          <p className="text-sm text-st-mute flex items-center gap-2 mt-3"><Spinner /> Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-3 rounded-xl bg-st-surface px-5 py-8 text-center">
            <p className="font-medium">Nothing here yet</p>
            <p className="text-sm text-st-mute mt-1">Upload a document or add some text above.</p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-st-line border border-st-line rounded-xl overflow-hidden">
            {items.map((it) =>
              editing?.id === it.id ? (
                <li key={it.id} className="p-4 bg-st-surface">
                  <form onSubmit={saveEdit} className="space-y-3">
                    <div>
                      <label className={label} htmlFor="kn-edit-title">Title</label>
                      <input id="kn-edit-title" value={editing.title} maxLength={120} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={`${field} bg-white`} />
                    </div>
                    <div>
                      <label className={label} htmlFor="kn-edit-text">Text</label>
                      <textarea id="kn-edit-text" rows={10} value={editing.content} maxLength={60000} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className={`${field} bg-white`} />
                    </div>
                    <div className="flex gap-2">
                      <button disabled={!editing.title.trim() || !editing.content.trim() || !!busy} className={btn}>{busy === 'save' ? <Spinner /> : null} Save changes</button>
                      <button type="button" onClick={() => setEditing(null)} disabled={!!busy} className={btnGhost}>Cancel</button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={it.id} className="flex items-start gap-3 px-4 py-3.5">
                  <FileText size={18} className="text-st-mute mt-0.5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{it.title}</p>
                    <p className="text-xs text-st-mute mt-0.5">{kindLabel(it)} · {it.words.toLocaleString('en-IN')} words · {ago(it.updatedAt)}</p>
                    <p className="text-xs text-st-mute mt-1.5 line-clamp-2 break-words">{it.preview}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(it.id)} disabled={!!busy} aria-label={`Edit ${it.title}`} className="h-9 w-9 flex items-center justify-center rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface disabled:opacity-50"><Pencil size={15} /></button>
                    <button onClick={() => remove(it)} disabled={!!busy} aria-label={`Delete ${it.title}`} className="h-9 w-9 flex items-center justify-center rounded-lg text-st-mute hover:text-red-600 hover:bg-st-surface disabled:opacity-50"><Trash2 size={15} /></button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
