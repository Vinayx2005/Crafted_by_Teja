'use client';

// Create and Library.
//   Create: platforms -> topic -> ideas (from relevant sources only) -> script, with a
//   feedback box under the script. Feedback is saved, and the server puts it into every
//   later prompt (the learning loop).
//   Library: every script the brand has written.
// `view` says which of the two the sidebar is showing; both stay mounted.

import { safeUrl } from '@/lib/studio/safety';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Lightbulb, Sparkles, Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, errorText, supabase } from '@/lib/studio/client';
import { LONG_LENGTHS, PLATFORM_HINTS, PLATFORM_OPTIONS, REDDIT_REPLY, SHORT_LENGTHS, kindOf, lengthLabel, scriptLanguages, type Page, type Script, type Source, type Topic } from '@/lib/studio/shared';
import { ago, btn, btnGhost, ErrorNote, field, label, Spinner } from '../ui';

const STEPS = ['Platforms', 'Topic', 'Script'];
// The model cites its sources as [n7]; those markers mean nothing on screen.
const plain = (t?: string) => (t ?? '').replace(/\s*\[[a-z]{1,3}\d+\]/gi, '');

// One script per platform, each with its versions and its own feedback box.
type Draft = { platform: string; versions: Script[]; active: number; thumb: 'up' | 'down' | null; note: string; rating: number };
const newDraft = (platform: string, versions: Script[]): Draft => ({ platform, versions, active: versions.length - 1, thumb: null, note: '', rating: versions[versions.length - 1]?.rating ?? 0 });
type Learned = { count: number; up: number; down: number; notes: { section: string; sentiment: 'up' | 'down' | null; note: string }[] };

export default function Work({ page, view, onOpened }: { page: Page; view: 'create' | 'library'; onOpened: () => void }) {
  const [step, setStep] = useState(1);
  const [platforms, setPlatforms] = useState<string[]>((page.supported_platforms ?? []).filter((p) => PLATFORM_OPTIONS.includes(p)));
  const [brief, setBrief] = useState('');
  const [redditMode, setRedditMode] = useState<'post' | 'reply' | null>(null); // asked once Reddit is picked
  const [replyTo, setReplyTo] = useState(''); // the Reddit comment a reply answers
  const [opinion, setOpinion] = useState(''); // the team's own view; the script is written from it
  const [language, setLanguage] = useState(page.languages[0] ?? 'English');
  const [lengthShort, setLengthShort] = useState(45); // Shorts / Reels, seconds
  const [lengthLong, setLengthLong] = useState(180); // YouTube long format, seconds
  const [thin, setThin] = useState(false); // the script was written without solid sources
  const [stage, setStage] = useState(''); // what the AI is doing right now
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tab, setTab] = useState(0);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<Script[] | null>(null);
  const [learned, setLearned] = useState<Learned>({ count: 0, up: 0, down: 0, notes: [] });

  const cur = drafts[tab];
  const script = cur?.versions[cur.active];
  // The languages set for the brand (Brand Settings); keep the pick valid if they change.
  const languageOptions = scriptLanguages(page.languages);
  useEffect(() => {
    if (!languageOptions.includes(language)) setLanguage(languageOptions[0]);
  }, [page.languages]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const patch = (i: number, p: Partial<Draft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...p } : d)));

  // A new step starts at the top of the page.
  useEffect(() => {
    document.getElementById('studio-main')?.scrollTo({ top: 0 });
  }, [step]);

  const refreshSide = async () => {
    const sb = supabase();
    const count = (s?: string) => {
      const q = sb.from('studio_feedback').select('id', { count: 'exact', head: true }).eq('page_id', page.id);
      return s ? q.eq('sentiment', s) : q;
    };
    const [h, f, n, up, down] = await Promise.all([
      sb.from('studio_scripts').select('*').eq('page_id', page.id).order('created_at', { ascending: false }).limit(40),
      sb.from('studio_feedback').select('section, note, sentiment').eq('page_id', page.id).not('note', 'is', null).order('created_at', { ascending: false }).limit(8),
      count(),
      count('up'),
      count('down'),
    ]);
    const latest = new Map<string, Script>();
    for (const s of (h.data ?? []) as Script[]) if (!latest.has(s.root_id)) latest.set(s.root_id, s);
    setHistory([...latest.values()]);
    setLearned({ count: n.count ?? 0, up: up.count ?? 0, down: down.count ?? 0, notes: (f.data ?? []).filter((x) => x.note) });
  };
  useEffect(() => {
    refreshSide();
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // What is really being written: the Reddit card becomes a post or a reply. A reply with no other
  // text is about the comment itself.
  const chosen = platforms.map((p) => (p === 'Reddit post' && redditMode === 'reply' ? REDDIT_REPLY : p));
  const effBrief = brief.trim() || replyTo.trim();

  // Topic -> script in one go. The AI finds sources for the topic, weighs the candidate ideas,
  // picks the strongest (or combines the best of them) and writes one script per platform from
  // that single plan. Nobody has to choose an idea. With `trending`, the candidates come from what
  // is trending for the brand instead of a typed topic.
  const make = (trending = false) =>
    run('script', async () => {
      setStage('Finding sources and the strongest angle…');
      const r = await api<{ plan: Topic | null; reason: string; thin?: boolean }>('ideas', { pageId: page.id, brief: trending ? '' : effBrief, trending, platforms: chosen, language, opinion });
      if (!r.plan) throw new Error(r.reason || 'No reliable sources were found for this. Try other words, or paste an article or notes.');
      const plan = r.plan;

      const targets = chosen.length ? chosen : [''];
      setStage(`Writing ${targets.length > 1 ? `${targets.length} versions` : 'your script'}…`);
      const ideaSources = plan.sources ?? [];
      const ownSource: Source[] = !trending && effBrief.length >= 200 ? [{ id: 'b1', kind: 'own', title: effBrief.split('\n')[0].slice(0, 80), snippet: effBrief.slice(0, 6000) }] : [];
      const extra = await api<{ sources: Source[] }>('sources', { pageId: page.id, topic: plan.title, query: plan.search_query ?? '', language })
        .then((x) => x.sources)
        .catch(() => [] as Source[]);
      const have = new Set([...ideaSources, ...ownSource].map((s) => s.id));
      const used = [...ideaSources, ...ownSource.filter((s) => !ideaSources.some((i) => i.id === s.id)), ...extra.filter((s) => !have.has(s.id) && !ideaSources.some((i) => (i.url || i.title) === (s.url || s.title))).slice(0, 4)];
      const instruction = [plan.angle && `Angle to take: ${plain(plan.angle)}`, plan.hook_idea && `A possible opening: ${plain(plan.hook_idea)}`].filter(Boolean).join('. ').slice(0, 400);

      const results = await Promise.allSettled(
        targets.map((platform) => {
          const kind = kindOf(platform);
          const lengthS = kind === 'long' ? lengthLong : kind === 'short' ? lengthShort : 0;
          return api<{ script: Script }>('script', { pageId: page.id, topic: plan.title, language, lengthS, instruction, sources: used, platform, opinion, replyTo: kind === 'redditReply' ? replyTo : undefined });
        }),
      );
      const made = results.flatMap((x, i) => (x.status === 'fulfilled' ? [newDraft(targets[i], [x.value.script])] : []));
      if (!made.length) throw (results[0] as PromiseRejectedResult).reason;
      const failed = results.length - made.length;
      setThin(!!r.thin);
      setTopic(plan.title);
      setDrafts(made);
      setTab(0);
      setStep(3);
      if (failed) setError(`${failed} of ${results.length} platform versions could not be written. Press "New script" and try again for those.`);
      refreshSide();
    });

  // Feedback on the script on screen: a thumb, a note and a star rating, all about the whole script.
  const saveFeedback = async (d: Draft): Promise<number> => {
    const sb = supabase();
    const s = d.versions[d.active];
    const sentiment = d.thumb ?? (d.rating >= 4 ? 'up' : d.rating > 0 && d.rating <= 2 ? 'down' : null);
    const note = d.note.trim();
    let saved = 0;
    if (d.rating) {
      await sb.from('studio_scripts').update({ rating: d.rating }).eq('id', s.id);
      setDrafts((all) => all.map((x, k) => (k === tab ? { ...x, versions: x.versions.map((v, i) => (i === x.active ? { ...v, rating: d.rating } : v)) } : x)));
      saved++;
    }
    if (sentiment || note) {
      const { error } = await sb.from('studio_feedback').insert({ script_id: s.id, page_id: page.id, section: 'overall', sentiment, note: note || null });
      if (error) throw error;
      saved++;
    }
    return saved;
  };
  const save = () =>
    run('save', async () => {
      if (!(await saveFeedback(cur))) throw new Error('Give a thumbs up or down, a note, or a rating first.');
      patch(tab, { thumb: null, note: '' });
      setNotice('Feedback saved. The writer will use it from the next script.');
      refreshSide();
    });
  const revise = () =>
    run('revise', async () => {
      const d = cur;
      const sentiment = d.thumb ?? (d.rating >= 4 ? 'up' : d.rating > 0 && d.rating <= 2 ? 'down' : null);
      const feedback = sentiment || d.note.trim() ? [{ section: 'overall', sentiment, note: d.note.trim() }] : [];
      await saveFeedback(d);
      const r = await api<{ script: Script }>('script', { pageId: page.id, reviseOf: script.id, feedback, instruction: '', platform: d.platform, opinion, replyTo: d.platform === REDDIT_REPLY ? replyTo : undefined });
      setDrafts((all) => all.map((x, i) => (i === tab ? { ...x, versions: [...x.versions, r.script], active: x.versions.length, thumb: null, note: '', rating: 0 } : x)));
      refreshSide();
    });

  const open = (s: Script) =>
    run('open', async () => {
      const { data, error } = await supabase().from('studio_scripts').select('*').eq('root_id', s.root_id).order('version');
      if (error) throw error;
      setDrafts([newDraft('', data as Script[])]);
      setTab(0);
      setTopic(s.topic);
      setStep(3);
      onOpened();
    });

  const startOver = () => {
    setStep(1);
    setDrafts([]);
    setThin(false);
    setOpinion('');
    setReplyTo('');
    setNotice('');
    setError('');
  };
  const canGo = (n: number) => n === 1 || (n === 2 && platforms.length > 0) || (n === 3 && drafts.length > 0);
  const h2 = 'text-2xl font-semibold tracking-tight';
  const togglePlatform = (p: string) => setPlatforms((all) => PLATFORM_OPTIONS.filter((x) => (x === p ? !all.includes(x) : all.includes(x))));

  return (
    <div>
      <ErrorNote text={error} />

      {/* ── Library: every script this brand has written ── */}
      <div hidden={view !== 'library'}>
        <p className="text-sm text-st-mute mb-4">Open a script to read it, give feedback or write a new version.</p>
        {history === null ? (
          <p className="text-sm text-st-mute flex items-center gap-2"><Spinner /> Loading…</p>
        ) : history.length === 0 ? (
          <div className="rounded-xl bg-st-surface px-5 py-10 text-center">
            <p className="font-medium">No scripts yet</p>
            <p className="text-sm text-st-mute mt-1">Scripts you create are saved here automatically.</p>
          </div>
        ) : (
          <ul className="divide-y divide-st-line border border-st-line rounded-xl overflow-hidden">
            {history.map((h) => (
              <li key={h.id}>
                <button onClick={() => open(h)} disabled={!!busy} className="w-full flex items-center justify-between gap-4 px-4 py-3.5 min-h-[56px] text-left hover:bg-st-surface disabled:opacity-60 transition">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{h.topic}</span>
                    <span className="block text-xs text-st-mute mt-0.5">{[h.language, lengthLabel(h.length_s)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-xs text-st-mute shrink-0 text-right">v{h.version}{h.rating ? ` · ${h.rating}★` : ''}<br />{ago(h.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Create ── */}
      <div hidden={view !== 'create'} className="space-y-8">
        <ol className="flex items-center" aria-label="Steps">
          {STEPS.map((name, i) => {
            const n = i + 1;
            const state = step === n ? 'active' : n < step ? 'done' : 'todo';
            return (
              <li key={name} className={`flex items-center min-w-0 ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
                <button
                  disabled={!canGo(n) || !!busy}
                  onClick={() => setStep(n)}
                  aria-current={state === 'active' ? 'step' : undefined}
                  className="flex items-center gap-2 min-h-[40px] rounded-lg pr-1 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40"
                >
                  <span className={`h-6 w-6 shrink-0 rounded-full text-xs font-semibold flex items-center justify-center transition ${state === 'active' ? 'bg-18-orange text-white' : state === 'done' ? 'bg-18-orange/15 text-18-orange' : 'bg-st-surface border border-st-line text-st-mute'}`}>
                    {state === 'done' ? <Check size={13} aria-hidden /> : n}
                  </span>
                  <span className={`text-sm whitespace-nowrap hidden sm:inline ${state === 'active' ? 'font-semibold text-st-ink' : ''} ${state === 'done' ? 'text-st-ink/80' : ''} ${state === 'todo' ? 'text-st-mute' : ''}`}>{name}</span>
                </button>
                {i < STEPS.length - 1 && <span aria-hidden className={`flex-1 h-px mx-2 sm:mx-3 ${n < step ? 'bg-18-orange/40' : 'bg-st-line'}`} />}
              </li>
            );
          })}
        </ol>
        <p className="sm:hidden -mt-5 text-xs text-st-mute" aria-hidden>Step {step} of {STEPS.length} · <span className="text-st-ink font-medium">{STEPS[step - 1]}</span></p>

        {/* 1. Where it will be posted */}
        {step === 1 && (
          <section>
            <h2 className={h2}>Where will this be posted?</h2>
            <p className="text-st-mute mt-1.5">Pick one or more. We write a version for each platform.</p>
            <div className="mt-6 grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Platforms">
              {PLATFORM_OPTIONS.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    aria-pressed={on}
                    className={`relative text-left rounded-xl border px-4 py-4 min-h-[84px] text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 ${on ? 'border-18-orange bg-18-orange/10 text-st-ink' : 'border-st-line hover:border-[#DDDDDD] hover:bg-st-surface'}`}
                  >
                    <span className="block pr-5">{p}</span>
                    <span className="block text-xs font-normal text-st-mute mt-1">{PLATFORM_HINTS[p]}</span>
                    {on && <Check size={15} className="absolute top-3 right-3 text-18-orange" aria-hidden />}
                  </button>
                );
              })}
            </div>
            {platforms.includes('Reddit post') && (
              <div className="mt-5 rounded-xl bg-st-surface p-4 md:p-5">
                <p className="text-sm font-medium" id="reddit-q">On Reddit, is this a new post or a reply to a comment?</p>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="reddit-q">
                  {([['post', 'A new post'], ['reply', 'A reply to a comment']] as const).map(([k, text]) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={redditMode === k}
                      onClick={() => setRedditMode(k)}
                      className={`rounded-lg border px-4 py-2 min-h-[40px] text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 ${redditMode === k ? 'border-18-orange bg-18-orange/10 font-medium' : 'border-st-line bg-white hover:bg-st-surface'}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => setStep(2)} disabled={!platforms.length || (platforms.includes('Reddit post') && !redditMode)} className={btn}>Continue</button>
              <span className="text-sm text-st-mute">{!platforms.length ? 'Pick at least one' : platforms.includes('Reddit post') && !redditMode ? 'Choose post or reply' : `${platforms.length} selected`}</span>
            </div>
          </section>
        )}

        {/* 2. What it is about */}
        {step === 2 && (
          <section className="max-w-2xl">
            <h2 className={h2}>What is it about?</h2>
            <p className="text-st-mute mt-1.5">Type a topic, or paste a description, an article or your notes. We find the sources, choose the strongest angle and write the script.</p>
            {chosen.includes(REDDIT_REPLY) && (
              <div className="mt-5">
                <label className={label} htmlFor="reply-to">The Reddit comment you are replying to</label>
                <textarea id="reply-to" rows={4} value={replyTo} maxLength={3000} onChange={(e) => setReplyTo(e.target.value)} placeholder="Paste the comment here" className={field} />
                <p className="text-xs text-st-mute mt-1.5">The reply answers this comment. Below, add what you want to say or the topic (optional).</p>
              </div>
            )}
            <label className="sr-only" htmlFor="brief">Topic or description</label>
            <textarea
              id="brief"
              rows={5}
              value={brief}
              maxLength={3000}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Why Swiggy still loses money on every order"
              className={`${field} mt-5`}
            />

            <div className="mt-4 rounded-xl bg-st-surface p-4 md:p-5">
              <label htmlFor="opinion" className="text-sm font-medium">Share your opinion on this topic <span className="font-normal text-st-mute">(optional)</span></label>
              <p className="text-xs text-st-mute mt-0.5">Your view, your experience or the stance you want to take. The script is written from your point of view.</p>
              <textarea
                id="opinion"
                rows={3}
                value={opinion}
                maxLength={1500}
                onChange={(e) => setOpinion(e.target.value)}
                placeholder="e.g. I think most founders waste money on ads before talking to even ten customers"
                className={`${field} mt-3 bg-white`}
              />
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="lang">Language</label>
                <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                  {languageOptions.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              {platforms.some((p) => kindOf(p) === 'short') && (
                <div>
                  <label className={label} htmlFor="len-short">Shorts / Reels length</label>
                  <select id="len-short" value={lengthShort} onChange={(e) => setLengthShort(Number(e.target.value))} className={field}>
                    {SHORT_LENGTHS.map((n) => <option key={n} value={n}>{lengthLabel(n)}</option>)}
                  </select>
                </div>
              )}
              {platforms.some((p) => kindOf(p) === 'long') && (
                <div>
                  <label className={label} htmlFor="len-long">YouTube video length</label>
                  <select id="len-long" value={lengthLong} onChange={(e) => setLengthLong(Number(e.target.value))} className={field}>
                    {LONG_LENGTHS.map((n) => <option key={n} value={n}>{lengthLabel(n)}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button onClick={() => setStep(1)} disabled={!!busy} className={btnGhost}><ArrowLeft size={14} aria-hidden /> Back</button>
              <button onClick={() => make(false)} disabled={effBrief.length < 3 || (chosen.includes(REDDIT_REPLY) && replyTo.trim().length < 3) || !!busy} className={btn}>
                {busy === 'script' ? <Spinner /> : <Sparkles size={16} aria-hidden />} {busy === 'script' ? 'Working…' : 'Write script'}
              </button>
            </div>

            {busy === 'script' && (
              <div className="mt-5 rounded-xl bg-st-surface px-5 py-4 flex items-center gap-3" aria-live="polite">
                <Spinner />
                <p className="text-sm">{stage} <span className="text-st-mute">This takes up to a minute.</span></p>
              </div>
            )}

            <p className="mt-6 text-sm text-st-mute">
              No topic in mind?{' '}
              <button onClick={() => make(true)} disabled={!!busy} className="text-18-orange font-medium hover:underline disabled:opacity-50">Let the AI pick a trending topic</button>
              {' '}for this brand.
            </p>
          </section>
        )}

        {/* 3. The script, then feedback */}
        {step === 3 && cur && script && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight">{topic || script.topic}</h2>
                <p className="text-xs text-st-mute mt-1">{script.language}{script.length_s > 0 ? ` · about ${lengthLabel(script.length_s)}` : ''}</p>
              </div>
              <button onClick={startOver} disabled={!!busy} className={btnGhost}>New script</button>
            </div>

            {thin && (
              <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
                No solid sources were found for this topic, so the script sticks to general points and your own view. Check any facts before you post it.
              </p>
            )}

            {drafts.length > 1 && (
              <div role="tablist" aria-label="Platforms" className="inline-flex flex-wrap rounded-lg bg-st-surface p-1 gap-1">
                {drafts.map((d, i) => (
                  <button key={d.platform || i} role="tab" aria-selected={i === tab} onClick={() => { setTab(i); setNotice(''); }}
                    className={`px-4 py-1.5 min-h-[36px] text-sm rounded-md transition ${i === tab ? 'bg-white text-st-ink font-medium shadow-sm' : 'text-st-mute hover:text-st-ink'}`}>
                    {d.platform || 'Script'}
                  </button>
                ))}
              </div>
            )}
            {drafts.length === 1 && cur.platform && <p className="text-sm font-medium">{cur.platform}</p>}

            {cur.versions.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
                {cur.versions.map((v, i) => (
                  <button key={v.id} role="tab" aria-selected={i === cur.active} onClick={() => patch(tab, { active: i, thumb: null, note: '', rating: v.rating ?? 0 })}
                    className={`text-xs rounded-full px-3 py-1.5 min-h-[32px] border transition ${i === cur.active ? 'border-18-orange bg-18-orange/10 text-st-ink font-medium' : 'border-st-line text-st-mute hover:text-st-ink'}`}>
                    v{v.version}{v.rating ? ` · ${v.rating}★` : ''}
                  </button>
                ))}
              </div>
            )}

            <ScriptView script={script} />

            {Array.isArray(script.sources) && script.sources.length > 0 && <SourceList sources={script.sources as Source[]} title="Sources used" />}

            {/* Feedback */}
            <div className="border border-st-line rounded-xl p-5 space-y-4">
              <div>
                <h3 className="font-semibold">How is this script?</h3>
                <p className="text-sm text-st-mute mt-0.5">Your feedback improves this script and every later one for this brand.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex gap-1.5" role="group" aria-label="Overall reaction">
                  {(['up', 'down'] as const).map((d) => (
                    <button key={d} aria-pressed={cur.thumb === d} aria-label={d === 'up' ? 'Good script' : 'Needs work'}
                      onClick={() => patch(tab, { thumb: cur.thumb === d ? null : d })}
                      className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border text-sm transition ${cur.thumb === d ? (d === 'up' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-red-300 text-red-600 bg-red-50') : 'border-st-line text-st-mute hover:text-st-ink hover:bg-st-surface'}`}>
                      {d === 'up' ? <ThumbsUp size={15} aria-hidden /> : <ThumbsDown size={15} aria-hidden />} {d === 'up' ? 'Good' : 'Needs work'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={cur.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => patch(tab, { rating: cur.rating === n ? 0 : n })} className="p-1">
                      <Star size={22} className={n <= cur.rating ? 'fill-amber-500 text-amber-500' : 'text-[#D4D4D4]'} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={label} htmlFor="fb-note">What should change? (optional)</label>
                <textarea id="fb-note" rows={3} value={cur.note} onChange={(e) => patch(tab, { note: e.target.value })}
                  placeholder="e.g. open with a number, shorter lines, simpler words, add a real example" className={field} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={revise} disabled={!!busy} className={btn}>
                  {busy === 'revise' ? <Spinner /> : <Sparkles size={16} aria-hidden />} {busy === 'revise' ? 'Rewriting…' : 'Improve with my feedback'}
                </button>
                <button onClick={save} disabled={!!busy} className={btnGhost}>{busy === 'save' ? <Spinner /> : null} Save feedback only</button>
              </div>
              {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            </div>
          </section>
        )}

        <Insights learned={learned} />
      </div>
    </div>
  );
}

// The whole script as one piece, the way it is spoken: no labels for hook, body or
// ending. Each spoken line sits on its own line.
function ScriptView({ script }: { script: Script }) {
  const full = [script.hook, script.body, script.conclusion, script.cta].map((t) => (t ?? '').trim()).filter(Boolean).join('\n');
  const words = full.split(/\s+/).filter(Boolean).length;
  return (
    <div className="rounded-xl bg-st-surface p-5 md:p-8">
      <div className="max-w-prose whitespace-pre-wrap text-[16px] leading-8 text-st-ink">{full}</div>
      <div className="mt-5 pt-4 border-t border-st-line flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-st-mute">{words} words</span>
        <CopyButton text={full} label="Copy script" />
      </div>
    </div>
  );
}

function SourceList({ sources, title }: { sources: Source[]; title?: string }) {
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer list-none text-xs font-medium text-st-mute hover:text-st-ink inline-flex items-center gap-1 min-h-[32px]">
        <ChevronDown size={13} className="transition group-open:rotate-180" aria-hidden /> {title ?? 'Supporting sources'} ({sources.length})
      </summary>
      <ul className="mt-1.5 space-y-1.5">
        {sources.map((s, i) => (
          <li key={s.id || i} className="text-xs text-st-mute break-words">
            <span>{s.kind === 'own' ? 'Your text' : s.competitor ? 'Competitor video' : s.kind === 'video' ? 'YouTube' : s.kind === 'wiki' ? 'Wikipedia' : s.kind === 'discussion' ? 'Discussion' : 'News'}:</span>{' '}
            {s.url ? <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" className="text-st-ink/80 hover:text-18-orange underline underline-offset-2">{s.title}</a> : s.title}
            {s.publisher && <span> · {s.publisher}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// What the writer has learned from feedback, collapsed by default: the raw notes
// are only a click away.
function Insights({ learned }: { learned: Learned }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-st-line rounded-xl">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] text-left rounded-xl hover:bg-st-surface transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40">
        <span className="flex items-center gap-3 min-w-0">
          <Lightbulb size={17} className="text-18-orange shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-medium">AI writing insights</span>
            <span className="block text-xs text-st-mute">Your feedback teaches the writer this brand&apos;s style.</span>
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {learned.count > 0 && <span className="text-xs text-st-mute bg-st-surface rounded-full px-2.5 py-0.5">{learned.count} saved</span>}
          <ChevronDown size={16} className={`text-st-mute transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-st-line space-y-4">
          <p className="text-sm text-st-mute leading-relaxed">
            Every thumbs up, note and star rating you save is added to the instructions for the next ideas, scripts and rewrites of this brand. Ratings of 4–5 stars show what to repeat, 1–2 stars what to avoid.
          </p>
          {learned.count === 0 ? (
            <p className="text-sm rounded-lg bg-st-surface px-4 py-3">No feedback yet. Rate your first script and the writer starts learning.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-emerald-700"><ThumbsUp size={14} aria-hidden /> {learned.up} liked</span>
                <span className="inline-flex items-center gap-1.5 text-red-600"><ThumbsDown size={14} aria-hidden /> {learned.down} disliked</span>
              </div>
              {learned.notes.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-st-mute mb-2">Latest notes</h3>
                  <ul className="space-y-2">
                    {learned.notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 shrink-0 text-[11px] font-medium capitalize rounded-md bg-st-surface border border-st-line px-2 py-0.5 text-st-ink/70">{n.section}</span>
                        <span className="min-w-0 break-words text-st-ink/80">
                          {n.sentiment === 'up' && <ThumbsUp size={12} className="inline mr-1 text-emerald-700" aria-label="liked" />}
                          {n.sentiment === 'down' && <ThumbsDown size={12} className="inline mr-1 text-red-600" aria-label="disliked" />}
                          {n.note}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CopyButton({ text, label: text2 }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      aria-label={text2 ?? 'Copy'}
      className={text2 ? btnGhost : 'h-9 w-9 flex items-center justify-center rounded-lg border border-st-line text-st-mute hover:text-st-ink hover:bg-st-surface transition'}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {text2 ? (done ? 'Copied' : text2) : null}
    </button>
  );
}
