'use client';

// Blog agent board. Three steps, in order:
//   1. Research   — site, audience, keywords + the topics in your head
//   2. Write      — add your own material, pick the ideas you want
//   3. Review     — approve the outline, approve the draft, schedule it
// Every gate is a bulk action, so a 20-post run is a handful of clicks.
// The page only flips `stage` on rows; /api/agent/tick does the AI work
// (pinged here and by pg_cron). Scheduling just sets posts.published_at in
// the future — RLS keeps it hidden until then.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Loader2, Check, X, RotateCcw, ExternalLink, Play, CalendarClock, Sparkles } from 'lucide-react';

type Site = 'root' | 'pft';
interface AuthorInputs { text?: string | null; images?: { url: string; name?: string }[] }
interface Seed {
  id: number; site: Site; keyword: string; country: string; ideas_wanted: number;
  cluster: boolean; notes: string | null;
  inputs: AuthorInputs | null;
  status: 'queued' | 'done' | 'failed'; error: string | null; attempts: number; locked_at: string | null; created_at: string;
}
interface Item {
  id: number; seed_id: number; site: Site; stage: string; note: string | null; error: string | null;
  attempts: number; locked_at: string | null; outline_md: string | null; post_id: number | null;
  inputs: AuthorInputs | null;
  idea: { title: string; primary_keyword: string; secondary_keywords: string[]; intent: string; demand: string; competition: string; score: number; angle: string; evidence: string; role?: 'pillar' | 'supporting' };
  plan: { title: string; meta_description: string; target_words: number; primary_keyword: string; secondary_keywords: string[]; top_results_miss: string } | null;
  seo: { words: number; checks: { label: string; ok: boolean }[]; phrases?: { phrase: string; url: string | null }[] } | null;
  post: { id: number; slug: string; title: string; cover_url: string | null; published_at: string | null } | null;
}

const TABS = [
  { key: 'research', label: '1 · Research' },
  { key: 'write',    label: '2 · Write',            stages: ['idea'] },
  { key: 'review',   label: '3 · Review & publish', stages: ['outline_review', 'draft_review', 'approved'] },
] as const;

// Every idea comes from one research run, so 10 is plenty and nobody has to
// think about it. Change it here if a run should produce more or fewer.
const IDEAS_PER_RUN = 10;
type TabKey = typeof TABS[number]['key'];

const QUEUED = ['outline_queued', 'draft_queued'];
const siteLabel = (s: Site) => (s === 'pft' ? 'pft blog' : 'craftedbyteja.com');
// A seed holds every keyword from one run, newline-separated.
const keywordLabel = (s: Seed) =>
  s.keyword.split('\n').filter(Boolean).join(' · ')
  || (s.status === 'queued' ? 'finding keywords from your topics…' : s.notes || 'no keywords');

export default function AgentBoard() {
  const [tab, setTab] = useState<TabKey>('research');
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [kickedAt, setKickedAt] = useState(0);

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([
      supabase.schema('blog').from('agent_seeds').select('*').order('id', { ascending: false }),
      supabase.schema('blog').from('agent_items')
        .select('*, post:posts(id, slug, title, cover_url, published_at)')
        .neq('stage', 'discarded').order('id'),
    ]);
    if (s.error || i.error) setErr((s.error || i.error)!.message);
    setSeeds((s.data || []) as Seed[]);
    setItems((i.data || []) as Item[]);
    setLoading(false);
  }, []);

  // Starts the worker now instead of waiting for the next pg_cron minute.
  const kick = useCallback(async () => {
    setKickedAt(Date.now());
    const { data: { session } } = await supabase.auth.getSession();
    fetch('/api/agent/tick', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } })
      .then(async (r) => { if (!r.ok) setErr((await r.json().catch(() => ({}))).error || `Worker error ${r.status}`); load(); })
      .catch(() => {});
  }, [load]);

  const busy = seeds.some((s) => s.status === 'queued') || items.some((i) => QUEUED.includes(i.stage));

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      load();
      if (Date.now() - kickedAt > 60_000) kick(); // backup for when pg_cron isn't set up
    }, 8000);
    return () => clearInterval(t);
  }, [busy, kickedAt, load, kick]);

  const update = async (ids: number[], patch: Record<string, unknown>) => {
    if (!ids.length) return;
    const { error } = await supabase.schema('blog').from('agent_items').update(patch).in('id', ids);
    if (error) setErr(error.message);
    await load();
  };
  const queue = async (ids: number[], stage: 'outline_queued' | 'draft_queued', note?: string) => {
    await update(ids, { stage, attempts: 0, error: null, locked_at: null, ...(note !== undefined ? { note } : {}) });
    kick();
  };
  const discard = async (list: Item[]) => {
    if (!list.length) return;
    const drafts = list.filter((i) => i.post_id && !i.post?.published_at).map((i) => i.post_id!);
    if (drafts.length && !confirm(`Discard ${list.length} and delete ${drafts.length} unpublished draft post(s)?`)) return;
    if (drafts.length) await supabase.schema('blog').from('posts').delete().in('id', drafts);
    // Discarding something already being written settles that run the same way
    // approving it does, so its leftover ideas go too. Discarding an idea in
    // step 2 is not that — it must not take its siblings with it.
    const runs = new Set(list.filter((i) => i.stage !== 'idea').map((i) => i.seed_id));
    const leftovers = runs.size
      ? items.filter((i) => i.stage === 'idea' && runs.has(i.seed_id) && !list.some((l) => l.id === i.id))
      : [];
    await update([...list, ...leftovers].map((i) => i.id), { stage: 'discarded' });
  };

  const byStage = (stages: readonly string[]) => items.filter((i) => stages.includes(i.stage));

  // Picking the ideas worth writing is also a decision about the ones that
  // aren't: the leftovers from the same research run are cleared out so the
  // list doesn't accumulate suggestions you already said no to.
  const writeChosen = async (ids: number[]) => {
    const chosen = new Set(ids);
    const pool = byStage(['idea']);
    const runs = new Set(pool.filter((i) => chosen.has(i.id)).map((i) => i.seed_id));
    const rest = pool.filter((i) => !chosen.has(i.id) && runs.has(i.seed_id));
    if (rest.length && !confirm(
      `Write ${ids.length} post${ids.length === 1 ? '' : 's'} and discard the other ${rest.length} idea${rest.length === 1 ? '' : 's'} from the same research run?`,
    )) return;
    await queue(ids, 'outline_queued');
    if (rest.length) await update(rest.map((i) => i.id), { stage: 'discarded' });
  };

  // Approving an outline settles what that research run is for. Anything from
  // the same run still sitting in step 2 is a leftover — clear it, so Write
  // only ever shows ideas you haven't decided on. No prompt: you already chose
  // once when you sent these to be written.
  const approveOutlines = async (ids: number[]) => {
    const runs = new Set(items.filter((i) => ids.includes(i.id)).map((i) => i.seed_id));
    const rest = byStage(['idea']).filter((i) => runs.has(i.seed_id));
    await queue(ids, 'draft_queued', '');
    if (rest.length) await update(rest.map((i) => i.id), { stage: 'discarded' });
  };
  const counts = Object.fromEntries(TABS.map((t) => [t.key, 'stages' in t ? byStage(t.stages).length : 0]));
  counts.queue += seeds.filter((s) => s.status !== 'done').length;

  if (loading) return <p className="text-white/50 text-sm">Loading…</p>;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-white">Blog agent</h1>
          <p className="text-xs text-white/50 mt-0.5">Research what people search → pick the ideas worth writing → approve the outline and the draft. Nothing goes live without you, and posts are always in English.</p>
        </div>
        {busy && (
          <button onClick={kick} className="inline-flex items-center gap-1.5 text-xs text-white/70 bg-white/5 border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/10">
            <Loader2 size={12} className="animate-spin" /> Working… nudge
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-4 bg-18-surface border border-18-border rounded-full p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${tab === t.key ? 'bg-18-orange text-white' : 'text-white/60 hover:text-white'}`}
          >
            {t.label}{counts[t.key] ? ` · ${counts[t.key]}` : ''}
          </button>
        ))}
      </div>

      {err && <p className="text-xs text-red-400 mb-3">{err} <button onClick={() => setErr(null)} className="underline ml-1">dismiss</button></p>}

      {tab === 'research' && <Research seeds={seeds} onCreated={() => { load(); kick(); setTab('write'); }} setErr={setErr} />}

      {tab === 'write' && (
        <Write
          seeds={seeds} items={items} ideas={byStage(['idea'])}
          onOutline={writeChosen}
          onDiscard={discard} reload={load} setErr={setErr} />
      )}

      {tab === 'review' && (
        <Review
          seeds={seeds.filter((s) => s.status !== 'done')}
          working={byStage(['outline_queued', 'draft_queued', 'failed'])}
          outlines={byStage(['outline_review'])}
          drafts={byStage(['draft_review'])}
          scheduleItems={byStage(['approved', 'scheduled'])}
          onApproveOutline={approveOutlines}
          onRedoOutline={(id, note) => queue([id], 'outline_queued', note)}
          onSaveOutline={(id, outline_md) => update([id], { outline_md })}
          onApproveDraft={(ids) => update(ids, { stage: 'approved' })}
          onRedoDraft={(id, note) => queue([id], 'draft_queued', note)}
          onRetry={(list) => Promise.all(list.map((i) => queue([i.id], i.outline_md ? 'draft_queued' : 'outline_queued')))}
          onRetrySeed={async (id) => { await supabase.schema('blog').from('agent_seeds').update({ status: 'queued', attempts: 0, error: null }).eq('id', id); load(); kick(); }}
          onDiscard={discard} reload={load} setErr={setErr} />
      )}
    </div>
  );
}

// ─── Research ──────────────────────────────────────────────────────────
function Research({ seeds, onCreated, setErr }: { seeds: Seed[]; onCreated: () => void; setErr: (e: string) => void }) {
  const [site, setSite] = useState<Site>('pft');
  const [country, setCountry] = useState('IN');
  const [cluster, setCluster] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const list = Array.from(new Set(keywords.split('\n').map((k) => k.trim()).filter(Boolean)));

  // One row per research run, not per keyword: the agent reads every keyword
  // and your topics as a single brief and returns one ranked set of ideas.
  const [genning, setGenning] = useState(false);
  const ready = list.length > 0 || notes.trim().length > 0;

  // Fills the keywords box from the topics so you can see and edit what the
  // posts will target before committing to a run. Skipping it is fine — the
  // worker derives them the same way.
  const generate = async () => {
    setGenning(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const r = await fetch('/api/agent/keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ site, country, notes }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || `Keyword lookup failed (${r.status})`);
      else setKeywords((prev) => Array.from(new Set([
        ...prev.split('\n').map((k) => k.trim()).filter(Boolean),
        ...(j.keywords || []),
      ])).join('\n'));
    } catch (e: any) {
      setErr(e.message || String(e));
    }
    setGenning(false);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const { error } = await supabase.schema('blog').from('agent_seeds').insert({
      site, keyword: list.join('\n'), country,
      ideas_wanted: IDEAS_PER_RUN, cluster, notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setKeywords(''); setNotes('');
    onCreated();
  };

  return (
    <div className="space-y-4">
      <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Site">
            <select className="cms-input" value={site} onChange={(e) => setSite(e.target.value as Site)}>
              <option value="pft">pft blog</option>
              <option value="root">craftedbyteja.com</option>
            </select>
          </Field>
          <Field label="Audience country">
            <select className="cms-input" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="IN">India</option>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="GLOBAL">Global (English)</option>
            </select>
          </Field>
        </div>
        <Field label="Topics you have in mind — write them however they come out">
          <textarea rows={4} className="cms-input"
            placeholder={'why most people pick the wrong SIP date\nthe ₹50k mistake I made in 2023\nfor people in their first job — avoid crypto'}
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex items-center gap-2">
          <Btn primary disabled={genning || !notes.trim()} onClick={generate}>
            {genning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {genning ? 'Searching…' : 'Generate keywords'}
          </Btn>
          <p className="text-[11px] text-white/40">
            {genning
              ? 'Looking up how people actually search for these topics.'
              : 'Reads your topics and fills in the search terms below. Edit them freely — they are what the posts will target.'}
          </p>
        </div>

        <Field label="Keywords the posts will target — one per line, generated or your own">
          <textarea rows={4} className="cms-input" placeholder={'sip calculator\nemergency fund\ncredit card debt'} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 cursor-pointer bg-18-surface-2 border border-18-border rounded-lg p-3">
          <input type="checkbox" className="mt-0.5 accent-[#F37335]" checked={cluster} onChange={(e) => setCluster(e.target.checked)} />
          <span className="text-xs text-white/80">
            <b className="text-white">Build a topic cluster</b> — one broad pillar post plus {IDEAS_PER_RUN - 1} supporting posts on its subtopics, all linking to each other.
            <span className="block text-white/40 mt-0.5">Beats unrelated one-offs: Google&apos;s AI Mode fans a question out into related sub-queries, so covering a topic fully gets you pulled into answers you didn&apos;t target. Schedule the pillar first.</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-white/40">
            Everything above is read as one brief: {IDEAS_PER_RUN} ideas covering all your topics and keywords together.
            Demand comes from real Google autocomplete queries; competition is judged from who ranks today. Both are estimates, not exact volumes.
            Posts are always written in English.
          </p>
          <button onClick={submit} disabled={busy || !ready}
            className="shrink-0 inline-flex items-center gap-1.5 text-sm font-bold text-white bg-18-orange rounded-full px-4 py-2 hover:brightness-110 disabled:opacity-50">
            <Play size={13} /> Research
          </button>
        </div>
      </div>

      {seeds.length > 0 && (
        <ul className="space-y-1">
          {seeds.slice(0, 50).map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm bg-18-surface border border-18-border rounded-lg px-3 py-2">
              <Pill>{s.site}</Pill>
              <span className="text-white flex-1 truncate">{keywordLabel(s)}</span>
              <span className="text-[11px] text-white/40">{s.country} · {s.ideas_wanted} ideas{s.cluster ? ' · cluster' : ''}</span>
              <Status status={s.status} working={isWorking(s)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Step 2: Write ─────────────────────────────────────────────────────
// Your own material and the ideas it will be used in, on one screen — you
// read an idea, remember something worth saying about it, and add it without
// losing your place.
function Write({ seeds, items, ideas, onOutline, onDiscard, reload, setErr }: {
  seeds: Seed[]; items: Item[]; ideas: Item[];
  onOutline: (ids: number[]) => void; onDiscard: (list: Item[]) => void;
  reload: () => void; setErr: (e: string) => void;
}) {
  if (!seeds.length) return <Empty>Nothing researched yet — start in step 1.</Empty>;
  return (
    <Ideas
      seeds={seeds} items={ideas} onOutline={onOutline} onDiscard={onDiscard}
      aside={(seed) => <SeedInputs seed={seed} items={items} reload={reload} setErr={setErr} />} />
  );
}

// ─── Step 3: Review & publish ──────────────────────────────────────────
// Outline approval, draft approval and scheduling are the same job — looking
// at what the agent produced and deciding — so they share one screen in the
// order work flows through them.
function Review({
  seeds, working, outlines, drafts, scheduleItems,
  onApproveOutline, onRedoOutline, onSaveOutline, onApproveDraft, onRedoDraft,
  onRetry, onRetrySeed, onDiscard, reload, setErr,
}: {
  seeds: Seed[]; working: Item[]; outlines: Item[]; drafts: Item[]; scheduleItems: Item[];
  onApproveOutline: (ids: number[]) => void; onRedoOutline: (id: number, note: string) => void;
  onSaveOutline: (id: number, md: string) => Promise<void>;
  onApproveDraft: (ids: number[]) => void; onRedoDraft: (id: number, note: string) => void;
  onRetry: (list: Item[]) => void; onRetrySeed: (id: number) => void;
  onDiscard: (list: Item[]) => void; reload: () => void; setErr: (e: string) => void;
}) {
  const nothing = !seeds.length && !working.length && !outlines.length && !drafts.length && !scheduleItems.length;
  if (nothing) return <Empty>Nothing to review yet. Pick some ideas in step 2.</Empty>;

  return (
    <div className="space-y-8">
      {(seeds.length > 0 || working.length > 0) && (
        <div>
          <Head>In progress</Head>
          <Queue seeds={seeds} items={working} onRetry={onRetry} onRetrySeed={onRetrySeed} onDiscard={onDiscard} />
        </div>
      )}
      {outlines.length > 0 && (
        <div>
          <Head>Outlines to approve — {outlines.length}</Head>
          <Outlines items={outlines} onApprove={onApproveOutline} onRedo={onRedoOutline}
            onSave={onSaveOutline} onDiscard={onDiscard} />
        </div>
      )}
      {drafts.length > 0 && (
        <div>
          <Head>Drafts to approve — {drafts.length}</Head>
          <Drafts items={drafts} onApprove={onApproveDraft} onRedo={onRedoDraft} onDiscard={onDiscard} />
        </div>
      )}
      {scheduleItems.length > 0 && (
        <div>
          <Head>Schedule</Head>
          <Schedule items={scheduleItems} reload={reload} setErr={setErr} />
        </div>
      )}
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">{children}</p>;
}

// ─── Your inputs ───────────────────────────────────────────────────────
// Optional stage. Paste your own raw material — notes, numbers, opinions,
// screenshots (Ctrl+V works) — for a whole topic or one post. The agent
// treats it as authoritative and builds sections around it. This is the one
// part of a post nobody else can write.
function SeedInputs({ seed, items, reload, setErr }: {
  seed: Seed; items: Item[]; reload: () => void; setErr: (e: string) => void;
}) {
  const mine = items.filter((i) => i.seed_id === seed.id && !['discarded', 'scheduled'].includes(i.stage));
  return (
          <details className="mb-2">
            <summary className="text-[11px] text-18-orange cursor-pointer select-none mb-2">
              Your own material for this run{seed.inputs?.text || seed.inputs?.images?.length ? ' · added' : ''}
            </summary>
            <p className="text-[11px] text-white/40 mb-2">
              Notes, numbers, a strong opinion, screenshots (Ctrl+V). Treated as first-hand and authoritative —
              it&apos;s the only part of a post a competitor can&apos;t copy. It doesn&apos;t need to be organised.
            </p>
            <InputBox
              label="Applies to every post from this research run"
              value={seed.inputs}
              onSave={async (inputs) => {
                const { error } = await supabase.schema('blog').from('agent_seeds').update({ inputs }).eq('id', seed.id);
                if (error) setErr(error.message); else reload();
              }}
              setErr={setErr}
            />
            {mine.length > 0 && (
              <details className="mt-2">
                <summary className="text-[11px] text-18-orange cursor-pointer select-none">Add material for one specific post ({mine.length})</summary>
                <div className="space-y-3 mt-2 pl-3 border-l border-18-border">
                  {mine.map((i) => (
                    <InputBox
                      key={i.id}
                      label={`${i.plan?.title || i.idea.title}${i.inputs?.text || i.inputs?.images?.length ? ' · has material' : ''}`}
                      value={i.inputs}
                      onSave={async (inputs) => {
                        const { error } = await supabase.schema('blog').from('agent_items').update({ inputs }).eq('id', i.id);
                        if (error) setErr(error.message); else reload();
                      }}
                      setErr={setErr}
                    />
                  ))}
                </div>
              </details>
            )}
          </details>
  );
}

function InputBox({ label, value, onSave, setErr }: {
  label: string; value: AuthorInputs | null; onSave: (v: AuthorInputs) => Promise<void>; setErr: (e: string) => void;
}) {
  const [text, setText] = useState(value?.text || '');
  const [images, setImages] = useState(value?.images || []);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Compare by value: a fresh [] each render would otherwise always look dirty.
  const dirty = text !== (value?.text || '') || JSON.stringify(images) !== JSON.stringify(value?.images || []);

  const upload = async (files: File[]) => {
    setBusy(true);
    for (const file of files.slice(0, 6)) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${(file.name || 'pasted.png').replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
      const { error } = await supabase.storage.from('blog-inputs').upload(path, file, { contentType: file.type });
      if (error) { setErr(`Image upload failed: ${error.message}`); break; }
      const { data } = supabase.storage.from('blog-inputs').getPublicUrl(path);
      setImages((prev) => [...prev, { url: data.publicUrl, name: file.name || 'pasted image' }]);
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    await onSave({ text: text.trim() || null, images });
    setBusy(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-18-surface border border-18-border rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">{label}</p>
      <textarea
        rows={5}
        className="cms-input text-sm"
        placeholder={[
          'Paste anything — rough notes, numbers from your app, a strong opinion, what you got wrong, a reader question…',
          'Screenshots: copy and press Ctrl+V right here.',
        ].join('\n')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
          if (files.length) { e.preventDefault(); upload(files); }
        }}
      />
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {images.map((img) => (
          <span key={img.url} className="relative group">
            <img src={img.url} alt={img.name} className="h-14 w-20 object-cover rounded-md border border-18-border" />
            <button
              onClick={() => setImages((prev) => prev.filter((p) => p.url !== img.url))}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full h-4 w-4 text-[10px] leading-none opacity-0 group-hover:opacity-100"
              title="Remove"
            >×</button>
          </span>
        ))}
        <label className="text-[11px] text-white/50 hover:text-white cursor-pointer border border-dashed border-white/20 rounded-md px-2 py-1">
          + image
          <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(Array.from(e.target.files || []))} />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {busy && <Loader2 size={12} className="animate-spin text-18-orange" />}
          {saved && <span className="text-[11px] text-emerald-400">Saved</span>}
          <Btn primary disabled={busy || !dirty} onClick={save}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Ideas ─────────────────────────────────────────────────────────────
function Ideas({ seeds, items, onOutline, onDiscard, aside }: {
  seeds: Seed[]; items: Item[]; onOutline: (ids: number[]) => void; onDiscard: (list: Item[]) => void;
  aside?: (seed: Seed) => React.ReactNode;
}) {
  const sel = useSelection();
  if (!items.length) return <Empty>No ideas waiting — research something in step 1.</Empty>;
  const groups = seeds.map((s) => ({ seed: s, list: items.filter((i) => i.seed_id === s.id) })).filter((g) => g.list.length);
  const chosen = items.filter((i) => sel.has(i.id));

  return (
    <div>
      <Bar count={chosen.length} total={items.length} onAll={() => sel.set(items.map((i) => i.id))} onNone={sel.clear}>
        <Btn primary disabled={!chosen.length} onClick={() => { onOutline(chosen.map((i) => i.id)); sel.clear(); }}>
          <Check size={12} /> Write {chosen.length || ''} post{chosen.length === 1 ? '' : 's'}
        </Btn>
        <Btn disabled={!chosen.length} onClick={() => { onDiscard(chosen); sel.clear(); }}><X size={12} /> Discard</Btn>
      </Bar>
      {groups.map(({ seed, list }) => (
        <div key={seed.id} className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Pill>{seed.site}</Pill>
            <p className="text-sm font-bold text-white truncate">{keywordLabel(seed)}</p>
            <button onClick={() => sel.add(list.map((i) => i.id))} className="shrink-0 text-[11px] text-18-orange hover:underline">select all</button>
          </div>
          {aside?.(seed)}
          <ul className="space-y-1.5">
            {list.map((i) => (
              <li key={i.id}>
                <label className="flex gap-3 bg-18-surface border border-18-border rounded-xl p-3 cursor-pointer hover:border-18-orange/40">
                  <input type="checkbox" className="mt-1 accent-[#F37335]" checked={sel.has(i.id)} onChange={() => sel.toggle(i.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-sm font-bold text-white mr-1">{i.idea.title}</span>
                      {i.idea.role === 'pillar' && <Pill strong>pillar</Pill>}
                      <Level label="demand" value={i.idea.demand} good="high" />
                      <Level label="competition" value={i.idea.competition} good="low" />
                      <span className="text-[10px] font-bold text-white/60">score {i.idea.score}/10</span>
                    </div>
                    <p className="text-xs text-white/60"><span className="text-white/80 font-semibold">{i.idea.primary_keyword}</span> · {i.idea.intent} · {i.idea.secondary_keywords?.join(', ')}</p>
                    <p className="text-xs text-white/50 mt-1">{i.idea.angle}</p>
                    <p className="text-[11px] text-white/35 mt-0.5">{i.idea.evidence}</p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Outlines ──────────────────────────────────────────────────────────
function Outlines({ items, onApprove, onRedo, onSave, onDiscard }: {
  items: Item[]; onApprove: (ids: number[]) => void; onRedo: (id: number, note: string) => void;
  onSave: (id: number, md: string) => Promise<void>; onDiscard: (list: Item[]) => void;
}) {
  const sel = useSelection();
  if (!items.length) return <Empty>No outlines to review.</Empty>;
  const chosen = items.filter((i) => sel.has(i.id));
  return (
    <div>
      <Bar count={chosen.length} total={items.length} onAll={() => sel.set(items.map((i) => i.id))} onNone={sel.clear}>
        <Btn primary disabled={!chosen.length} onClick={() => { onApprove(chosen.map((i) => i.id)); sel.clear(); }}>
          <Check size={12} /> Approve & write {chosen.length}
        </Btn>
        <Btn disabled={!chosen.length} onClick={() => { onDiscard(chosen); sel.clear(); }}><X size={12} /> Discard</Btn>
      </Bar>
      <ul className="space-y-2">
        {items.map((i) => (
          <OutlineCard key={i.id} item={i} checked={sel.has(i.id)} onCheck={() => sel.toggle(i.id)}
            onApprove={() => onApprove([i.id])} onRedo={(n) => onRedo(i.id, n)} onSave={(md) => onSave(i.id, md)} onDiscard={() => onDiscard([i])} />
        ))}
      </ul>
    </div>
  );
}

function OutlineCard({ item, checked, onCheck, onApprove, onRedo, onSave, onDiscard }: {
  item: Item; checked: boolean; onCheck: () => void; onApprove: () => void;
  onRedo: (note: string) => void; onSave: (md: string) => Promise<void>; onDiscard: () => void;
}) {
  const [md, setMd] = useState(item.outline_md || '');
  const p = item.plan!;
  return (
    <li className="bg-18-surface border border-18-border rounded-xl">
      <div className="flex gap-3 p-3">
        <input type="checkbox" className="mt-1 accent-[#F37335]" checked={checked} onChange={onCheck} />
        <details className="flex-1 min-w-0">
          <summary className="cursor-pointer select-none">
            <span className="text-sm font-bold text-white">{p.title}</span>
            <span className="text-xs text-white/40 ml-2">{siteLabel(item.site)} · ~{p.target_words} words</span>
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1">
              <Pill strong>{p.primary_keyword}</Pill>
              {p.secondary_keywords.map((k) => <Pill key={k}>{k}</Pill>)}
            </div>
            <p className="text-xs text-white/60"><b className="text-white/80">Meta:</b> {p.meta_description}</p>
            <p className="text-xs text-white/60"><b className="text-white/80">Our edge:</b> {p.top_results_miss}</p>
            <textarea rows={14} className="cms-input font-mono text-xs leading-relaxed" value={md} onChange={(e) => setMd(e.target.value)} />
            {md !== item.outline_md && <Btn onClick={() => onSave(md)}>Save outline edits</Btn>}
            <Redo onRedo={onRedo} placeholder="e.g. add a section on step-up SIPs, drop the history part" />
          </div>
        </details>
        <div className="flex flex-col gap-1 shrink-0">
          <Btn primary onClick={async () => { if (md !== item.outline_md) await onSave(md); onApprove(); }}><Check size={12} /> Approve</Btn>
          <Btn onClick={onDiscard}><X size={12} /> Discard</Btn>
        </div>
      </div>
    </li>
  );
}

// ─── Drafts ────────────────────────────────────────────────────────────
function Drafts({ items, onApprove, onRedo, onDiscard }: {
  items: Item[]; onApprove: (ids: number[]) => void; onRedo: (id: number, note: string) => void; onDiscard: (list: Item[]) => void;
}) {
  const sel = useSelection();
  if (!items.length) return <Empty>No drafts to review.</Empty>;
  const chosen = items.filter((i) => sel.has(i.id));
  return (
    <div>
      <Bar count={chosen.length} total={items.length} onAll={() => sel.set(items.map((i) => i.id))} onNone={sel.clear}>
        <Btn primary disabled={!chosen.length} onClick={() => { onApprove(chosen.map((i) => i.id)); sel.clear(); }}>
          <Check size={12} /> Approve {chosen.length}
        </Btn>
        <Btn disabled={!chosen.length} onClick={() => { onDiscard(chosen); sel.clear(); }}><X size={12} /> Discard</Btn>
      </Bar>
      <ul className="space-y-2">
        {items.map((i) => {
          const failed = i.seo?.checks.filter((c) => !c.ok) || [];
          const phrases = i.seo?.phrases || [];
          const copied = phrases.filter((p) => p.url);
          return (
            <li key={i.id} className="flex gap-3 bg-18-surface border border-18-border rounded-xl p-3">
              <input type="checkbox" className="mt-1 accent-[#F37335]" checked={sel.has(i.id)} onChange={() => sel.toggle(i.id)} />
              {i.post?.cover_url && <img src={i.post.cover_url} alt="" className="w-24 h-16 object-cover rounded-lg shrink-0" />}
              <div className="flex-1 min-w-0">
                <Link href={`/blog/${i.post_id}`} target="_blank" className="text-sm font-bold text-white hover:text-18-orange inline-flex items-center gap-1">
                  {i.post?.title || i.plan?.title} <ExternalLink size={11} />
                </Link>
                <p className="text-xs text-white/50">
                  {siteLabel(i.site)} · {i.seo?.words} words · SEO {(i.seo?.checks.length || 0) - failed.length}/{i.seo?.checks.length}
                  {' · '}
                  <span className={copied.length ? 'text-amber-400 font-semibold' : phrases.length ? 'text-emerald-400/80' : 'text-white/40'}>
                    {copied.length
                      ? `${copied.length} copied phrase${copied.length > 1 ? 's' : ''}`
                      : phrases.length ? `${phrases.length} phrases original` : 'phrases not checked'}
                  </span>
                </p>
                <details className="mt-1">
                  <summary className="text-[11px] text-white/50 cursor-pointer select-none">
                    {failed.length ? `${failed.length} SEO warning${failed.length > 1 ? 's' : ''}` : 'All SEO checks pass'} · edit or redo
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {i.seo?.checks.map((c) => (
                      <li key={c.label} className={`text-xs ${c.ok ? 'text-emerald-400/80' : 'text-amber-400'}`}>{c.ok ? '✓' : '!'} {c.label}</li>
                    ))}
                  </ul>
                  {copied.length > 0 && (
                    <div className="mt-2 border border-amber-400/30 bg-amber-400/5 rounded-lg p-2">
                      <p className="text-[11px] font-bold text-amber-400 mb-1">Found on other sites — reword, quote properly, or ignore:</p>
                      <ul className="space-y-1">
                        {copied.map((p) => (
                          <li key={p.phrase} className="text-[11px] text-white/70">
                            “{p.phrase}”{' '}
                            <a href={p.url!} target="_blank" rel="noopener noreferrer" className="text-18-orange hover:underline break-all">{new URL(p.url!).hostname}</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-2"><Redo onRedo={(n) => onRedo(i.id, n)} placeholder="e.g. shorter intro, add a worked ₹10,000/month example" /></div>
                </details>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Btn primary onClick={() => onApprove([i.id])}><Check size={12} /> Approve</Btn>
                <Btn onClick={() => onDiscard([i])}><X size={12} /> Discard</Btn>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Schedule ──────────────────────────────────────────────────────────
function Schedule({ items, reload, setErr }: { items: Item[]; reload: () => void; setErr: (e: string) => void }) {
  const sel = useSelection();
  // Pillar first: supporting posts should point at a pillar that is already live.
  const approved = items.filter((i) => i.stage === 'approved').sort((a, b) =>
    (a.idea.role === 'pillar' ? -1 : 0) - (b.idea.role === 'pillar' ? -1 : 0) || b.idea.score - a.idea.score);
  const scheduled = items.filter((i) => i.stage === 'scheduled')
    .sort((a, b) => (a.post?.published_at || '').localeCompare(b.post?.published_at || ''));

  // Default start: after the last scheduled post, but never before tomorrow 9am.
  const [gap, setGap] = useState(24);
  const defaultStart = useMemo(() => {
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    const last = scheduled.at(-1)?.post?.published_at;
    const after = last ? new Date(new Date(last).getTime() + 24 * 3600_000) : t;
    const d = after > t ? after : t;
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, [scheduled]);
  const [start, setStart] = useState('');
  const startAt = start || defaultStart;

  const chosen = approved.filter((i) => sel.has(i.id));
  const schedule = async () => {
    const t0 = new Date(startAt).getTime();
    for (const [k, i] of chosen.entries()) {
      const at = new Date(t0 + k * gap * 3600_000).toISOString();
      const a = await supabase.schema('blog').from('posts').update({ published_at: at }).eq('id', i.post_id!);
      const b = await supabase.schema('blog').from('agent_items').update({ stage: 'scheduled' }).eq('id', i.id);
      if (a.error || b.error) { setErr((a.error || b.error)!.message); break; }
    }
    sel.clear(); setStart(''); reload();
  };
  const unschedule = async (i: Item) => {
    await supabase.schema('blog').from('posts').update({ published_at: null }).eq('id', i.post_id!);
    await supabase.schema('blog').from('agent_items').update({ stage: 'approved' }).eq('id', i.id);
    reload();
  };

  return (
    <div className="space-y-6">
      {approved.length === 0 ? <Empty>Nothing approved yet.</Empty> : (
        <div>
          <div className="bg-18-surface border border-18-border rounded-2xl p-4 mb-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <Field label="First post goes live at">
              <input type="datetime-local" className="cms-input" value={startAt} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Then one post every (hours)">
              <input type="number" min={1} className="cms-input" value={gap} onChange={(e) => setGap(Math.max(1, Number(e.target.value) || 24))} />
            </Field>
            <Btn primary disabled={!chosen.length} onClick={schedule}><CalendarClock size={12} /> Schedule {chosen.length}</Btn>
          </div>
          <Bar count={chosen.length} total={approved.length} onAll={() => sel.set(approved.map((i) => i.id))} onNone={sel.clear} />
          <ul className="space-y-1">
            {approved.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-3 bg-18-surface border border-18-border rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" className="accent-[#F37335]" checked={sel.has(i.id)} onChange={() => sel.toggle(i.id)} />
                  <Pill>{i.site}</Pill>
                  {i.idea.role === 'pillar' && <Pill strong>pillar</Pill>}
                  <span className="text-sm text-white flex-1 truncate">{i.post?.title}</span>
                  <Link href={`/blog/${i.post_id}`} target="_blank" className="text-white/40 hover:text-white"><ExternalLink size={12} /></Link>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scheduled.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Scheduled</p>
          <ul className="space-y-1">
            {scheduled.map((i) => {
              const at = new Date(i.post?.published_at || 0);
              const live = at.getTime() <= Date.now();
              return (
                <li key={i.id} className="flex items-center gap-3 bg-18-surface border border-18-border rounded-lg px-3 py-2">
                  <span className={`text-[11px] font-bold w-36 shrink-0 ${live ? 'text-emerald-400' : 'text-white/70'}`}>
                    {live ? 'Live' : at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  <Pill>{i.site}</Pill>
                  <span className="text-sm text-white flex-1 truncate">{i.post?.title}</span>
                  {!live && <button onClick={() => unschedule(i)} className="text-[11px] text-white/50 hover:text-white">Unschedule</button>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Working / failed ──────────────────────────────────────────────────
function Queue({ seeds, items, onRetry, onRetrySeed, onDiscard }: {
  seeds: Seed[]; items: Item[]; onRetry: (list: Item[]) => void; onRetrySeed: (id: number) => void; onDiscard: (list: Item[]) => void;
}) {
  if (!seeds.length && !items.length) return <Empty>Nothing in progress.</Empty>;
  const failed = items.filter((i) => i.stage === 'failed');
  return (
    <div className="space-y-1">
      {failed.length > 1 && <div className="mb-2"><Btn onClick={() => onRetry(failed)}><RotateCcw size={12} /> Retry all {failed.length} failed</Btn></div>}
      {seeds.map((s) => (
        <Row key={`s${s.id}`} label={`Research: ${keywordLabel(s)}`} site={s.site} error={s.error}
          status={<Status status={s.status} working={isWorking(s)} />}
          action={s.status === 'failed' && <button onClick={() => onRetrySeed(s.id)} className="text-[11px] text-18-orange hover:underline">Retry</button>} />
      ))}
      {items.map((i) => (
        <Row key={i.id} label={`${i.outline_md ? 'Draft' : 'Outline'}: ${i.plan?.title || i.idea.title}`} site={i.site} error={i.error}
          status={<Status status={i.stage === 'failed' ? 'failed' : 'queued'} working={isWorking(i)} />}
          action={i.stage === 'failed' && (
            <span className="flex gap-2">
              <button onClick={() => onRetry([i])} className="text-[11px] text-18-orange hover:underline">Retry</button>
              <button onClick={() => onDiscard([i])} className="text-[11px] text-white/50 hover:underline">Discard</button>
            </span>
          )} />
      ))}
    </div>
  );
}

function Row({ label, site, status, error, action }: { label: string; site: Site; status: React.ReactNode; error: string | null; action?: React.ReactNode }) {
  return (
    <div className="bg-18-surface border border-18-border rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Pill>{site}</Pill>
        <span className="text-white flex-1 truncate">{label}</span>
        {action}
        {status}
      </div>
      {error && <p className="text-[11px] text-red-400/80 mt-1 break-words">{error}</p>}
    </div>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────
const isWorking = (r: { locked_at: string | null }) =>
  !!r.locked_at && Date.now() - new Date(r.locked_at).getTime() < 10 * 60_000;

function useSelection() {
  const [s, setS] = useState<Set<number>>(new Set());
  return {
    has: (id: number) => s.has(id),
    toggle: (id: number) => setS((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    add: (ids: number[]) => setS((p) => new Set([...Array.from(p), ...ids])),
    set: (ids: number[]) => setS(new Set(ids)),
    clear: () => setS(new Set()),
  };
}

function Bar({ count, total, onAll, onNone, children }: { count: number; total: number; onAll: () => void; onNone: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 sticky top-0 z-10 bg-18-bg/90 backdrop-blur py-2">
      <span className="text-xs text-white/50">{count} of {total} selected</span>
      <button onClick={onAll} className="text-[11px] text-18-orange hover:underline">all</button>
      <button onClick={onNone} className="text-[11px] text-white/50 hover:underline">none</button>
      <div className="flex gap-2 ml-auto">{children}</div>
    </div>
  );
}

function Redo({ onRedo, placeholder }: { onRedo: (note: string) => void; placeholder: string }) {
  const [note, setNote] = useState('');
  return (
    <div className="flex gap-2">
      <input className="cms-input text-xs" placeholder={placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
      <Btn disabled={!note.trim()} onClick={() => { onRedo(note.trim()); setNote(''); }}><RotateCcw size={12} /> Redo</Btn>
    </div>
  );
}

function Btn({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs font-bold rounded-full px-3 py-1.5 disabled:opacity-40 ${
        primary ? 'text-white bg-18-orange hover:brightness-110' : 'text-white/80 bg-white/5 border border-white/15 hover:bg-white/10'}`}>
      {children}
    </button>
  );
}

function Level({ label, value, good }: { label: string; value: string; good: string }) {
  const v = (value || '').toLowerCase();
  const tone = v === good ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
    : v === 'medium' ? 'text-amber-300 border-amber-300/30 bg-amber-300/10'
    : 'text-red-400 border-red-400/30 bg-red-400/10';
  return <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${tone}`}>{v} {label}</span>;
}

function Status({ status, working }: { status: 'queued' | 'done' | 'failed'; working: boolean }) {
  if (status === 'failed') return <span className="text-[11px] font-bold text-red-400">Failed</span>;
  if (status === 'done') return <span className="text-[11px] font-bold text-emerald-400">Done</span>;
  return working
    ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-18-orange"><Loader2 size={11} className="animate-spin" /> Working</span>
    : <span className="text-[11px] font-bold text-white/50">Queued</span>;
}

function Pill({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
      strong ? 'text-18-orange bg-18-orange/10 border-18-orange/30' : 'text-white/60 bg-white/5 border-white/10'}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-18-surface border border-18-border rounded-2xl p-8 text-center text-sm text-white/60">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1 block">{label}</span>
      {children}
    </label>
  );
}
