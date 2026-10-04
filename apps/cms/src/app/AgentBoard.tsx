'use client';

// Blog agent — one post at a time, in four steps:
//   1. Topic      what it's about + the keywords it should target
//   2. Material   your notes, numbers and screenshots
//   3. Outline    title, description and the sections, in plain English
//   4. Preview    the finished post, then publish
//
// The page only moves rows between stages; /api/agent/tick does the AI work
// (pinged here and by pg_cron). The writing rule lives in the prompts: your
// material is the spine of the post, elaborated and explained but never
// invented around.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/md';
import {
  Loader2, Check, X, RotateCcw, ExternalLink, Play, Sparkles, ArrowRight, ArrowLeft, Plus,
} from 'lucide-react';

type Site = 'root' | 'pft';
interface AuthorInputs { text?: string | null; images?: { url: string; name?: string }[] }
interface Seed {
  id: number; site: Site; keyword: string; country: string; ideas_wanted: number;
  cluster: boolean; notes: string | null; inputs: AuthorInputs | null;
  status: 'queued' | 'done' | 'failed'; error: string | null; attempts: number;
  locked_at: string | null; created_at: string;
}
interface Plan {
  title: string; slug: string; meta_description: string; category: string;
  target_words: number; primary_keyword: string; secondary_keywords: string[];
  top_results_miss: string;
}
interface Item {
  id: number; seed_id: number; site: Site; stage: string; note: string | null; error: string | null;
  attempts: number; locked_at: string | null; outline_md: string | null; post_id: number | null;
  inputs: AuthorInputs | null;
  idea: { title: string; primary_keyword: string; angle: string };
  plan: Plan | null;
  seo: { words: number; checks: { label: string; ok: boolean }[]; phrases?: { phrase: string; url: string | null }[] } | null;
  post: { id: number; slug: string; title: string; body_md: string; cover_url: string | null; published_at: string | null } | null;
}

const siteLabel = (s: Site) => (s === 'pft' ? 'pft blog' : 'craftedbyteja.com');

// A run owns one post now, but runs made by the old bulk pipeline also carry
// leftover `idea` rows. The real post is whichever row got past that stage.
const itemFor = (items: Item[], seedId: number | null) =>
  items.find((i) => i.seed_id === seedId && i.stage !== 'idea')
  || items.find((i) => i.seed_id === seedId)
  || null;
const isWorking = (r: { locked_at: string | null }) =>
  !!r.locked_at && Date.now() - new Date(r.locked_at).getTime() < 10 * 60_000;

// A run is finished once its post is published or it was thrown away.
const LIVE_STAGES = ['outline_queued', 'outline_review', 'draft_queued', 'draft_review', 'failed'];

export default function AgentBoard() {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);   // seed being worked on
  const [kickedAt, setKickedAt] = useState(0);

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([
      supabase.schema('blog').from('agent_seeds').select('*').order('id', { ascending: false }).limit(30),
      supabase.schema('blog').from('agent_items')
        .select('*, post:posts(id, slug, title, body_md, cover_url, published_at)')
        .neq('stage', 'discarded').order('id', { ascending: false }).limit(60),
    ]);
    if (s.error || i.error) setErr((s.error || i.error)!.message);
    setSeeds((s.data || []) as Seed[]);
    setItems((i.data || []) as Item[]);
    setLoading(false);
  }, []);

  const kick = useCallback(async () => {
    setKickedAt(Date.now());
    const { data: { session } } = await supabase.auth.getSession();
    fetch('/api/agent/tick', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } })
      .then(async (r) => { if (!r.ok) setErr((await r.json().catch(() => ({}))).error || `Worker error ${r.status}`); load(); })
      .catch(() => {});
  }, [load]);

  const run = seeds.find((s) => s.id === runId) || null;
  const item = itemFor(items, runId);
  const busy = (!!run && run.status === 'queued' && !item)
    || ['outline_queued', 'draft_queued'].includes(item?.stage || '');

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      load();
      if (Date.now() - kickedAt > 60_000) kick();   // backup for when pg_cron isn't set up
    }, 6000);
    return () => clearInterval(t);
  }, [busy, kickedAt, load, kick]);

  // Runs you haven't finished yet — the only thing worth resuming into.
  const unfinished = seeds.filter((s) => {
    const it = itemFor(items, s.id);
    return it ? LIVE_STAGES.includes(it.stage) : s.status !== 'failed';
  });

  if (loading) return <p className="text-white/50 text-sm">Loading…</p>;

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-white">Blog agent</h1>
          <p className="text-xs text-white/50 mt-0.5">
            One post at a time, written from what you give it. It elaborates and explains your material —
            it doesn&apos;t invent experiences, numbers or opinions for you.
          </p>
        </div>
        {runId !== null && (
          <button onClick={() => setRunId(null)} className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1">
            <ArrowLeft size={12} /> All posts
          </button>
        )}
      </div>

      {err && <p className="text-xs text-red-400 mb-3">{err} <button onClick={() => setErr(null)} className="underline ml-1">dismiss</button></p>}

      {runId === null
        ? <Start seeds={unfinished} items={items} onOpen={setRunId} onStarted={(id) => { setRunId(id); kick(); }} reload={load} setErr={setErr} />
        : <Run run={run} item={item} busy={busy} reload={load} kick={kick} setErr={setErr} onDone={() => setRunId(null)} />}
    </div>
  );
}

// ─── Start: new post, or carry on with one ─────────────────────────────
function Start({ seeds, items, onOpen, onStarted, reload, setErr }: {
  seeds: Seed[]; items: Item[]; onOpen: (id: number) => void; onStarted: (id: number) => void;
  reload: () => void; setErr: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stageLabel = (s: Seed) => {
    const it = itemFor(items, s.id);
    if (!it) return s.status === 'failed' ? 'Research failed' : 'Researching…';
    return ({
      outline_queued: 'Rewriting the outline…',
      outline_review: 'Outline ready for you',
      draft_queued: 'Writing the post…',
      draft_review: 'Draft ready to read',
      failed: 'Something failed',
    } as Record<string, string>)[it.stage] || it.stage;
  };

  if (open) return <NewPost onCancel={() => setOpen(false)} onStarted={onStarted} reload={reload} setErr={setErr} />;

  return (
    <div className="space-y-5">
      <button onClick={() => setOpen(true)}
        className="w-full bg-18-surface border border-dashed border-18-border hover:border-18-orange/50 rounded-2xl p-6 text-left transition-colors group">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-lg bg-18-orange/10 border border-18-orange/30 grid place-items-center shrink-0">
            <Plus size={18} className="text-18-orange" />
          </span>
          <span>
            <span className="block text-base font-bold text-white">Write a new post</span>
            <span className="block text-xs text-white/50 mt-0.5">Start with the topic you have in mind.</span>
          </span>
          <ArrowRight size={16} className="ml-auto text-white/30 group-hover:text-18-orange transition-colors" />
        </div>
      </button>

      {seeds.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Carry on with</p>
          <ul className="space-y-1.5">
            {seeds.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpen(s.id)}
                  className="w-full flex items-center gap-3 bg-18-surface border border-18-border rounded-xl px-3 py-2.5 text-left hover:border-18-orange/40 transition-colors">
                  <Pill>{s.site}</Pill>
                  <span className="text-sm text-white flex-1 truncate">
                    {itemFor(items, s.id)?.plan?.title || s.notes || s.keyword.split('\n')[0] || 'Untitled'}
                  </span>
                  <span className="text-[11px] text-white/50 shrink-0">{stageLabel(s)}</span>
                  <ArrowRight size={13} className="text-white/30 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Steps 1 & 2: topic, keywords, your material ───────────────────────
function NewPost({ onCancel, onStarted, reload, setErr }: {
  onCancel: () => void; onStarted: (id: number) => void; reload: () => void; setErr: (e: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [site, setSite] = useState<Site>('pft');
  const [country, setCountry] = useState('IN');
  const [topics, setTopics] = useState('');
  const [keywords, setKeywords] = useState('');
  const [inputs, setInputs] = useState<AuthorInputs>({ text: '', images: [] });
  const [genning, setGenning] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = Array.from(new Set(keywords.split('\n').map((k) => k.trim()).filter(Boolean)));

  const generate = async () => {
    setGenning(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const r = await fetch('/api/agent/keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ site, country, notes: topics }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || `Keyword lookup failed (${r.status})`);
      else setKeywords((prev) => Array.from(new Set([
        ...prev.split('\n').map((k) => k.trim()).filter(Boolean),
        ...(j.keywords || []),
      ])).join('\n'));
    } catch (e: any) { setErr(e.message || String(e)); }
    setGenning(false);
  };

  // Everything the editor gave goes in as one row; the worker plans the post.
  const research = async () => {
    setBusy(true);
    const { data, error } = await supabase.schema('blog').from('agent_seeds').insert({
      site, keyword: list.join('\n'), country, ideas_wanted: 1, cluster: false,
      notes: topics.trim() || null,
      inputs: (inputs.text?.trim() || inputs.images?.length) ? inputs : null,
    }).select('id').single();
    setBusy(false);
    if (error) return setErr(error.message);
    reload();
    onStarted(data!.id);
  };

  return (
    <div className="space-y-4">
      <Steps current={step === 1 ? 1 : 2} />

      {step === 1 ? (
        <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
          <TopicFields
            site={site} setSite={setSite} country={country} setCountry={setCountry}
            topics={topics} setTopics={setTopics} keywords={keywords} setKeywords={setKeywords}
            genning={genning} generate={generate} />

          <div className="flex items-center justify-between gap-3 pt-1">
            <button onClick={onCancel} className="text-xs text-white/50 hover:text-white">Cancel</button>
            <Btn primary disabled={!topics.trim() && !list.length} onClick={() => setStep(2)}>
              Next <ArrowRight size={12} />
            </Btn>
          </div>
        </div>
      ) : (
        <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
          <p className="text-xs text-white/60">
            This is what the post gets built from. Rough notes, your numbers, what you got wrong, a strong
            opinion, screenshots — paste it however it comes. It won&apos;t be tidied into something you
            didn&apos;t say: the post elaborates and explains this material, it doesn&apos;t invent around it.
          </p>
          <InputBox label="Your material for this post" value={inputs} onChange={setInputs} setErr={setErr} />
          <div className="flex items-center justify-between gap-3 pt-1">
            <button onClick={() => setStep(1)} className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1">
              <ArrowLeft size={12} /> Back
            </button>
            <Btn primary disabled={busy} onClick={research}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Research &amp; plan the post
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Steps 3 & 4: outline, then the finished post ──────────────────────
// The step-1 fields, shared by a brand-new post and by going back to edit one.
function TopicFields({ site, setSite, country, setCountry, topics, setTopics, keywords, setKeywords, genning, generate }: {
  site: Site; setSite: (v: Site) => void; country: string; setCountry: (v: string) => void;
  topics: string; setTopics: (v: string) => void; keywords: string; setKeywords: (v: string) => void;
  genning: boolean; generate: () => void;
}) {
  return (
    <>
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
            <option value="GLOBAL">Global</option>
          </select>
        </Field>
      </div>

      <Field label="What is this post about — write it however it comes out">
        <textarea rows={4} className="cms-input"
          placeholder={'how I rebuilt my emergency fund after a layoff\nwhy I keep it in a sweep-in FD and not a savings account'}
          value={topics} onChange={(e) => setTopics(e.target.value)} />
      </Field>

      <div className="flex items-center gap-2">
        <Btn primary disabled={genning || !topics.trim()} onClick={generate}>
          {genning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {genning ? 'Searching…' : 'Generate keywords'}
        </Btn>
        <p className="text-[11px] text-white/40">
          {genning ? 'Looking up how people actually search for this.' : 'Edit them freely — these are what the post will target.'}
        </p>
      </div>

      <Field label="Keywords the post will target — one per line">
        <textarea rows={4} className="cms-input" placeholder={'emergency fund\nsweep in fd'}
          value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </Field>
    </>
  );
}

// Asks the server to turn topics into search terms and merges them in.
function useKeywordGen(setErr: (e: string) => void) {
  const [genning, setGenning] = useState(false);
  const run = async (
    body: { site: Site; country: string; notes: string },
    merge: (fn: (prev: string) => string) => void,
  ) => {
    setGenning(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const r = await fetch('/api/agent/keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || `Keyword lookup failed (${r.status})`);
      else merge((prev) => Array.from(new Set([
        ...prev.split('\n').map((k) => k.trim()).filter(Boolean),
        ...(j.keywords || []),
      ])).join('\n'));
    } catch (e: any) { setErr(e.message || String(e)); }
    setGenning(false);
  };
  return { genning, run };
}

function Run({ run, item, busy, reload, kick, setErr, onDone }: {
  run: Seed | null; item: Item | null; busy: boolean;
  reload: () => void; kick: () => void; setErr: (e: string) => void; onDone: () => void;
}) {
  const reached = item?.stage === 'draft_review' || item?.post_id ? 4 : 3;
  const [view, setView] = useState<number | null>(null);
  const step = view ?? reached;

  if (!run) return <Empty>That post is gone.</Empty>;

  const update = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.schema('blog').from('agent_items').update(patch).eq('id', item!.id);
    if (error) setErr(error.message); else await reload();
  };

  return (
    <div className="space-y-4">
      <Steps current={step} reached={reached} onSelect={setView} />

      {step === 1 && <EditTopic run={run} reload={reload} setErr={setErr} onDone={() => setView(null)} />}
      {step === 2 && <EditMaterial run={run} reload={reload} setErr={setErr} onDone={() => setView(null)} />}

      {step >= 3 && run.status === 'failed' && !item && (
        <Failed label="The research step failed." error={run.error} onRetry={async () => {
          await supabase.schema('blog').from('agent_seeds').update({ status: 'queued', attempts: 0, error: null }).eq('id', run.id);
          reload(); kick();
        }} />
      )}

      {step >= 3 && busy && (
        <div className="bg-18-surface border border-18-border rounded-2xl p-8 text-center">
          <Loader2 size={20} className="animate-spin text-18-orange mx-auto mb-3" />
          <p className="text-sm text-white/70">
            {item?.stage === 'draft_queued' ? 'Writing the post from your material…' : 'Reading your material and planning the post…'}
          </p>
          <p className="text-[11px] text-white/40 mt-1">This takes a minute or two. You can leave and come back.</p>
        </div>
      )}

      {step >= 3 && item?.stage === 'failed' && (
        <Failed label="That step failed." error={item.error} onRetry={() =>
          update({ stage: item.outline_md ? 'draft_queued' : 'outline_queued', attempts: 0, error: null, locked_at: null }).then(kick)} />
      )}

      {step === 3 && !busy && item?.stage === 'outline_review' && (
        <Outline item={item} onSave={update}
          onGenerate={async () => { await update({ stage: 'draft_queued', attempts: 0, error: null, locked_at: null, note: null }); kick(); }}
          onRedo={async (note) => { await update({ stage: 'outline_queued', note, attempts: 0, error: null, locked_at: null }); kick(); }}
          onRegenerate={async () => {
            if (!confirm('Plan this outline again from scratch? Your edits to it are lost.')) return;
            await update({ stage: 'outline_queued', note: null, attempts: 0, error: null, locked_at: null });
            kick();
          }}
          setErr={setErr} />
      )}

      {!busy && step === 4 && item && (
        <Preview item={item} reload={reload} setErr={setErr} onDone={onDone}
          onRedo={async (note) => { await update({ stage: 'draft_queued', note, attempts: 0, error: null, locked_at: null }); kick(); }}
          onReplan={async () => {
            if (!confirm('Plan the outline again from scratch and rewrite the post from it? The current draft is replaced.')) return;
            await update({ stage: 'outline_queued', note: null, attempts: 0, error: null, locked_at: null });
            kick();
          }} />
      )}
    </div>
  );
}

// The outline, in plain language: a heading per section and one line on what
// it covers. Edited as text because that is what the writer actually reads.
// Going back to step 1 on a run that already exists. Saving updates the run;
// the outline only picks the change up when you replan it.
function EditTopic({ run, reload, setErr, onDone }: {
  run: Seed; reload: () => void; setErr: (e: string) => void; onDone: () => void;
}) {
  const [site, setSite] = useState<Site>(run.site);
  const [country, setCountry] = useState(run.country);
  const [topics, setTopics] = useState(run.notes || '');
  const [keywords, setKeywords] = useState(run.keyword || '');
  const [saving, setSaving] = useState(false);
  const { genning, run: genKeywords } = useKeywordGen(setErr);
  const list = Array.from(new Set(keywords.split('\n').map((k) => k.trim()).filter(Boolean)));
  const dirty = site !== run.site || country !== run.country
    || topics !== (run.notes || '') || keywords !== (run.keyword || '');

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.schema('blog').from('agent_seeds').update({
      site, country, notes: topics.trim() || null, keyword: list.join('\n'),
    }).eq('id', run.id);
    setSaving(false);
    if (error) return setErr(error.message);
    await reload();
    onDone();
  };

  return (
    <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
      <TopicFields
        site={site} setSite={setSite} country={country} setCountry={setCountry}
        topics={topics} setTopics={setTopics} keywords={keywords} setKeywords={setKeywords}
        genning={genning}
        generate={() => genKeywords({ site, country, notes: topics }, setKeywords)} />
      <SaveBar dirty={dirty} saving={saving} onSave={save} onCancel={onDone} />
    </div>
  );
}

// Going back to step 2 on a run that already exists.
function EditMaterial({ run, reload, setErr, onDone }: {
  run: Seed; reload: () => void; setErr: (e: string) => void; onDone: () => void;
}) {
  const [inputs, setInputs] = useState<AuthorInputs>(run.inputs || { text: '', images: [] });
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(inputs) !== JSON.stringify(run.inputs || { text: '', images: [] });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.schema('blog').from('agent_seeds').update({
      inputs: (inputs.text?.trim() || inputs.images?.length) ? inputs : null,
    }).eq('id', run.id);
    setSaving(false);
    if (error) return setErr(error.message);
    await reload();
    onDone();
  };

  return (
    <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
      <p className="text-xs text-white/60">
        This is what the post gets built from. Add or change anything — the post elaborates and explains
        this material, it doesn&apos;t invent around it.
      </p>
      <InputBox label="Your material for this post" value={inputs} onChange={setInputs} setErr={setErr} />
      <SaveBar dirty={dirty} saving={saving} onSave={save} onCancel={onDone} />
    </div>
  );
}

function SaveBar({ dirty, saving, onSave, onCancel }: {
  dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[11px] text-white/40">
        {dirty
          ? 'Save, then regenerate the outline on step 3 for the change to reach the post.'
          : 'Nothing changed yet.'}
      </p>
      <span className="flex items-center gap-2">
        <button onClick={onCancel} className="text-xs text-white/50 hover:text-white">Back</button>
        <Btn primary disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
        </Btn>
      </span>
    </div>
  );
}

function Outline({ item, onSave, onGenerate, onRedo, onRegenerate, setErr }: {
  item: Item; onSave: (patch: Record<string, unknown>) => Promise<void>;
  onGenerate: () => void; onRedo: (note: string) => void; onRegenerate: () => void;
  setErr: (e: string) => void;
}) {
  const plan = item.plan!;
  const [title, setTitle] = useState(plan.title || '');
  const [desc, setDesc] = useState(plan.meta_description || '');
  const [md, setMd] = useState(item.outline_md || '');
  const [saving, setSaving] = useState(false);
  const dirty = title !== plan.title || desc !== plan.meta_description || md !== (item.outline_md || '');

  const sections = useMemo(() => parseOutline(md), [md]);

  const save = async () => {
    setSaving(true);
    await onSave({ plan: { ...plan, title, meta_description: desc }, outline_md: md });
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-18-surface border border-18-border rounded-2xl p-4 space-y-3">
        <Field label="Title">
          <input className="cms-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description — the line that shows under the title in Google">
          <textarea rows={2} className="cms-input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <p className="text-[11px] text-white/40">
          Targets <span className="text-white/70 font-semibold">{plan.primary_keyword}</span>
          {plan.secondary_keywords?.length ? ` · also ${plan.secondary_keywords.slice(0, 4).join(', ')}` : ''}
          {plan.target_words ? ` · about ${plan.target_words} words` : ''}
        </p>
      </div>

      <div className="bg-18-surface border border-18-border rounded-2xl p-4">
        <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">What the post will cover</p>
        <p className="text-[11px] text-white/40 mb-3">{sections.length} sections, in this order. Edit anything that isn&apos;t right before generating.</p>
        <ol className="space-y-2 mb-3">
          {sections.map((s, k) => (
            <li key={k} className="flex gap-3">
              <span className="text-[11px] font-bold text-white/30 pt-0.5 w-5 shrink-0">{k + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{s.heading}</p>
                {s.note && <p className="text-xs text-white/55 mt-0.5">{s.note}</p>}
              </div>
            </li>
          ))}
          {!sections.length && <li className="text-xs text-white/40">No sections yet — edit the outline below.</li>}
        </ol>
        <details>
          <summary className="text-[11px] text-18-orange cursor-pointer select-none">Edit the outline</summary>
          <textarea rows={14} className="cms-input text-xs mt-2 leading-relaxed" value={md} onChange={(e) => setMd(e.target.value)} />
          <p className="text-[10px] text-white/30 mt-1">## Section heading, then a single - line under it saying what that section covers.</p>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn primary disabled={saving} onClick={async () => { if (dirty) await save(); onGenerate(); }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Generate the post
        </Btn>
        {dirty && <Btn disabled={saving} onClick={save}>Save changes</Btn>}
        <Btn disabled={saving} onClick={onRegenerate}><RotateCcw size={12} /> Regenerate outline</Btn>
        <div className="ml-auto w-full sm:w-auto">
          <Redo onRedo={onRedo} placeholder="or say what to change: lead with the mistake I made" />
        </div>
      </div>
    </div>
  );
}

// The finished post, read here rather than in another tab.
function Preview({ item, reload, setErr, onRedo, onReplan, onDone }: {
  item: Item; reload: () => void; setErr: (e: string) => void;
  onRedo: (note: string) => void; onReplan: () => void; onDone: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const body = item.post?.body_md || '';
  const html = useMemo(() => renderMarkdown(body), [body]);
  const failed = item.seo?.checks.filter((c) => !c.ok) || [];
  const copied = (item.seo?.phrases || []).filter((p) => p.url);
  const live = !!item.post?.published_at && new Date(item.post.published_at) <= new Date();

  const publish = async () => {
    if (!confirm(`Publish "${item.post?.title}" to ${siteLabel(item.site)} now?`)) return;
    setPublishing(true);
    const a = await supabase.schema('blog').from('posts').update({ published_at: new Date().toISOString() }).eq('id', item.post_id!);
    const b = await supabase.schema('blog').from('agent_items').update({ stage: 'approved' }).eq('id', item.id);
    setPublishing(false);
    if (a.error || b.error) return setErr((a.error || b.error)!.message);
    await reload();
    onDone();
  };

  return (
    <div className="space-y-4">
      <div className="bg-18-surface border border-18-border rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Pill>{siteLabel(item.site)}</Pill>
          {live && <Pill strong>Published</Pill>}
          <span className="text-[11px] text-white/50">
            {item.seo?.words} words · SEO {(item.seo?.checks.length || 0) - failed.length}/{item.seo?.checks.length}
          </span>
          <Link href={`/blog/${item.post_id}`} target="_blank" className="text-[11px] text-18-orange hover:underline inline-flex items-center gap-1 ml-auto">
            Open in the editor <ExternalLink size={10} />
          </Link>
        </div>
        {(failed.length > 0 || copied.length > 0) && (
          <details className="mb-2">
            <summary className="text-[11px] text-amber-400 cursor-pointer select-none">
              {failed.length ? `${failed.length} SEO warning${failed.length > 1 ? 's' : ''}` : ''}
              {failed.length && copied.length ? ' · ' : ''}
              {copied.length ? `${copied.length} phrase${copied.length > 1 ? 's' : ''} found on other sites` : ''}
            </summary>
            <ul className="mt-2 space-y-0.5">
              {item.seo?.checks.map((c) => (
                <li key={c.label} className={`text-xs ${c.ok ? 'text-emerald-400/80' : 'text-amber-400'}`}>{c.ok ? '✓' : '!'} {c.label}</li>
              ))}
              {copied.map((p) => (
                <li key={p.phrase} className="text-[11px] text-white/70">
                  “{p.phrase}” <a href={p.url!} target="_blank" rel="noopener noreferrer" className="text-18-orange hover:underline break-all">{new URL(p.url!).hostname}</a>
                </li>
              ))}
            </ul>
          </details>
        )}
        {/* No fixed height: the live post renders the cover at its own ratio,
            so cropping it here would preview something that never ships. */}
        {item.post?.cover_url && <img src={item.post.cover_url} alt="" className="w-full rounded-xl mb-4" />}
        <h2 className="text-xl font-black text-white mb-3">{item.post?.title}</h2>
        <div className="prose-crafted max-h-[32rem] overflow-y-auto pr-2" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn primary disabled={publishing || live} onClick={publish}>
          {publishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {live ? 'Published' : 'Approve & publish'}
        </Btn>
        <Link href={`/blog/${item.post_id}`} target="_blank"
          className="inline-flex items-center gap-1 text-xs font-bold rounded-full px-3 py-1.5 text-white/80 bg-white/5 border border-white/15 hover:bg-white/10">
          Make changes <ExternalLink size={11} />
        </Link>
        <Btn onClick={onReplan}><ArrowLeft size={12} /> Replan the outline</Btn>
        <div className="ml-auto w-full sm:w-auto">
          <Redo onRedo={onRedo} placeholder="e.g. shorter intro, cut the section on taxes" />
        </div>
      </div>
    </div>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────
// "## Heading" + an optional "- what it covers" line underneath.
function parseOutline(md: string) {
  const out: { heading: string; note: string }[] = [];
  for (const raw of (md || '').split('\n')) {
    const line = raw.trim();
    const h = /^#{2,3}\s+(.+)$/.exec(line);
    if (h) { out.push({ heading: h[1].trim(), note: '' }); continue; }
    const b = /^[-*]\s+(.+)$/.exec(line);
    if (b && out.length) out[out.length - 1].note = [out[out.length - 1].note, b[1].trim()].filter(Boolean).join(' ');
  }
  return out;
}

const STEP_LABELS = ['Topic', 'Your material', 'Outline', 'The post'];

// Clickable once a run exists, so you can go back and change the topic or your
// material without starting over. `reached` says how far this run has actually got.
function Steps({ current, reached, onSelect }: {
  current: number; reached?: number; onSelect?: (n: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
      {STEP_LABELS.map((label, k) => {
        const n = k + 1;
        const state = n === current ? 'now' : n < current ? 'done' : 'todo';
        const go = onSelect && n <= (reached ?? current);
        const className = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors ${
          state === 'now' ? 'bg-18-orange text-white border-18-orange'
            : state === 'done' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
            : 'text-white/35 border-white/10'}${go && state !== 'now' ? ' hover:border-18-orange/60 hover:text-white cursor-pointer' : ''}`;
        return (
          <li key={label}>
            {go
              ? <button type="button" onClick={() => onSelect!(n)} className={className}>
                  {state === 'done' ? <Check size={10} /> : <span>{n}</span>} {label}
                </button>
              : <span className={className}>
                  {state === 'done' ? <Check size={10} /> : <span>{n}</span>} {label}
                </span>}
          </li>
        );
      })}
    </ol>
  );
}

function Failed({ label, error, onRetry }: { label: string; error: string | null; onRetry: () => void }) {
  return (
    <div className="bg-18-surface border border-red-500/30 rounded-2xl p-4">
      <p className="text-sm text-red-400 font-semibold">{label}</p>
      {error && <p className="text-[11px] text-white/60 mt-1 break-words">{error}</p>}
      <div className="mt-3"><Btn onClick={onRetry}><RotateCcw size={12} /> Try again</Btn></div>
    </div>
  );
}

function InputBox({ label, value, onChange, setErr }: {
  label: string; value: AuthorInputs; onChange: (v: AuthorInputs) => void; setErr: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const images = value.images || [];

  const upload = async (files: File[]) => {
    setBusy(true);
    const added: { url: string; name?: string }[] = [];
    for (const file of files.slice(0, 6)) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${(file.name || 'pasted.png').replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
      const { error } = await supabase.storage.from('blog-inputs').upload(path, file, { contentType: file.type });
      if (error) { setErr(`Image upload failed: ${error.message}`); break; }
      const { data } = supabase.storage.from('blog-inputs').getPublicUrl(path);
      added.push({ url: data.publicUrl, name: file.name || 'pasted image' });
    }
    onChange({ ...value, images: [...images, ...added] });
    setBusy(false);
  };

  return (
    <div className="bg-18-surface-2 border border-18-border rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">{label}</p>
      <textarea
        rows={8}
        className="cms-input text-sm"
        placeholder={[
          'Paste anything — rough notes, numbers from your app, a strong opinion, what you got wrong, a reader question…',
          'Screenshots: copy and press Ctrl+V right here.',
        ].join('\n')}
        value={value.text || ''}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
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
              onClick={() => onChange({ ...value, images: images.filter((p) => p.url !== img.url) })}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full h-4 w-4 text-[10px] leading-none opacity-0 group-hover:opacity-100"
              title="Remove"
            >×</button>
          </span>
        ))}
        <label className="text-[11px] text-white/50 hover:text-white cursor-pointer border border-dashed border-white/20 rounded-md px-2 py-1">
          + image
          <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(Array.from(e.target.files || []))} />
        </label>
        {busy && <Loader2 size={12} className="animate-spin text-18-orange" />}
      </div>
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
