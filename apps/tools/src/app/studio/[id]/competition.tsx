'use client';

// The Competition tab: find creators, add them to the list, then study their
// videos. What is learned here feeds the topic and script ideas in Work.

import { safeUrl } from '@/lib/studio/safety';
import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { api, errorText, supabase } from '@/lib/studio/client';
import { VIRAL, type Competitor, type Page, type Summary, type Video } from '@/lib/studio/shared';
import { ago, btn, btnGhost, card, compact, ErrorNote, field, label, List, Spinner, useConfirm } from '../ui';

type Channel = { id: string; name: string; handle: string; url: string; thumb: string; followers: number; videos: number };

export default function Competition({ page, onUpdateLearnings }: { page: Page; onUpdateLearnings: () => Promise<boolean> }) {
  const [list, setList] = useState<Competitor[] | null>(null);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Channel[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [all, setAll] = useState({ running: false, bad: false, text: '' });
  const [ask, dialog] = useConfirm();
  const load = () =>
    supabase()
      .from('studio_competitors')
      .select('*')
      .eq('page_id', page.id)
      .order('created_at')
      .then(({ data, error }) => (error ? setError(errorText(error)) : setList(data as Competitor[])));
  useEffect(() => {
    load();
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy('search');
    setError('');
    try {
      setResults((await api<{ channels: Channel[] }>('search', { term, pageId: page.id })).channels);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy('');
  }

  async function add(row: Partial<Competitor>) {
    const { error } = await supabase().from('studio_competitors').insert({ ...row, page_id: page.id });
    if (error) return setError(error.code === '23505' ? 'Already on your list.' : errorText(error));
    setError('');
    load();
  }
  const addChannel = (c: Channel) =>
    add({ platform: 'youtube', ext_id: c.id, name: c.name, handle: c.handle, url: c.url, thumb: c.thumb, followers: c.followers });

  async function remove(c: Competitor) {
    if (!(await ask(`Remove ${c.name} and everything learned from them?`, 'Remove'))) return;
    const { data, error } = await supabase().from('studio_competitors').delete().eq('id', c.id).select('id');
    if (error || !data?.length) return setError('Only an Admin or Owner can remove a competitor.');
    setError('');
    if (open === c.id) setOpen(null);
    load();
  }

  // Fetch the videos, watch the best and latest shorts three at a time, then
  // find the patterns across all of it. Returns the error text, or null.
  async function analyse(c: Competitor, quiet = false): Promise<string | null> {
    const say = (m: string) => setProgress((p) => ({ ...p, [c.id]: m }));
    if (!quiet) setError('');
    try {
      say('Fetching their latest videos…');
      await api('fetchVideos', { competitorId: c.id });
      let first = 0;
      for (let i = 0; i < 6; i++) {
        const r = await api<{ total: number; remaining: number }>('deepVideos', { competitorId: c.id });
        first ||= r.total;
        say(`Watching their best shorts… ${Math.max(0, first - r.remaining)} of ${first}`);
        if (!r.remaining) break;
      }
      say('Finding their patterns…');
      await api('summarise', { competitorId: c.id });
      await load();
      if (!quiet) setOpen(c.id);
      return null;
    } catch (e) {
      if (!quiet) setError(errorText(e));
      return errorText(e);
    } finally {
      say('');
    }
  }

  // One by one, so the free Gemini and YouTube limits are not hit all at once.
  // Stops at the first failure (usually a daily limit) and says where.
  async function analyseAll() {
    const todo = (list ?? []).filter((c) => c.platform === 'youtube');
    setError('');
    for (let i = 0; i < todo.length; i++) {
      setAll({ running: true, bad: false, text: `Analysing ${todo[i].name} (${i + 1} of ${todo.length})…` });
      const err = await analyse(todo[i], true);
      if (err) return setAll({ running: false, bad: true, text: `Stopped at ${todo[i].name}: ${err}` });
    }
    setAll({ running: true, bad: false, text: 'Combining what they all do into your learnings…' });
    const ok = await onUpdateLearnings();
    const done = `${todo.length} ${todo.length === 1 ? 'creator' : 'creators'} analysed`;
    setAll({ running: false, bad: !ok, text: ok ? `Done. ${done} and the Playbook updated.` : `${done}, but the playbook could not be updated. See the error under What works.` });
  }

  const added = new Set((list ?? []).map((c) => `${c.platform}:${c.ext_id}`));

  return (
    <div className="space-y-6">
      {dialog}
      <section className={`${card} p-5`}>
        <h2 className="font-bold text-st-ink">Find creators</h2>
        <p className="text-sm text-st-mute mt-1 mb-4">Search a topic or a creator&apos;s name, or paste a YouTube channel link or @handle.</p>
        <form onSubmit={search} className="flex gap-2">
          <input value={term} onChange={(e) => setTerm(e.target.value)} required minLength={2} placeholder="e.g. telugu stock market, or @handle" aria-label="Search creators" className={field} />
          <button disabled={busy === 'search'} className={btn}>{busy === 'search' ? <Spinner /> : <Search size={16} aria-hidden />} Search</button>
        </form>
        <ErrorNote text={error} />
        {results && (
          <ul className="mt-4 divide-y divide-st-line">
            {results.length === 0 && <li className="text-sm text-st-mute py-2">No channels found.</li>}
            {results.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.thumb ? <img src={c.thumb} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full shrink-0" /> : <div className="h-10 w-10 rounded-full bg-st-line shrink-0" />}
                <div className="min-w-0 flex-1">
                  <a href={safeUrl(c.url)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-st-ink hover:text-18-orange truncate block">{c.name}</a>
                  <p className="text-xs text-st-mute">{c.handle} · {compact(c.followers)} subscribers · {compact(c.videos)} videos</p>
                </div>
                {added.has(`youtube:${c.id}`) ? (
                  <span className="text-xs text-emerald-700 shrink-0">On your list</span>
                ) : (
                  <button onClick={() => addChannel(c)} className={btnGhost}><Plus size={14} aria-hidden /> Add to competition</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <InstagramAdd onAdd={add} />
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-bold text-st-ink">Competition list</h2>
            <p className="text-xs text-st-mute mt-0.5">YouTube creators are re-analysed automatically once a day.</p>
          </div>
          {list?.some((c) => c.platform === 'youtube') && (
            <button onClick={analyseAll} disabled={all.running} className={btn}>
              {all.running ? <Spinner /> : <Sparkles size={15} aria-hidden />} Analyse all
            </button>
          )}
        </div>
        {all.text && (
          <p role="status" className={`text-sm mb-3 ${all.bad ? 'text-red-600' : 'text-st-ink/70'}`}>{all.text}</p>
        )}
        {list === null ? (
          <p className="text-sm text-st-mute flex items-center gap-2"><Spinner /> Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-st-mute">No one yet. Search above and add the creators you want to learn from.</p>
        ) : (
          <div className="space-y-3">
            {list.map((c) => (
              <CompetitorCard key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)}
                progress={progress[c.id]} onAnalyse={() => { analyse(c); }} onRemove={() => remove(c)} onChanged={load} setError={setError} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InstagramAdd({ onAdd }: { onAdd: (c: Partial<Competitor>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5 pt-4 border-t border-st-line">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-sm text-st-ink/70 hover:text-st-ink inline-flex items-center gap-1.5">
        <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden /> Add an Instagram creator
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const user = String(f.get('user')).trim().replace(/^@/, '').replace(/^.*instagram\.com\//, '').replace(/\/.*$/, '').toLowerCase();
            if (!user) return;
            await onAdd({ platform: 'instagram', ext_id: user, name: String(f.get('name')).trim() || `@${user}`, handle: `@${user}`, url: `https://www.instagram.com/${user}/` });
            e.currentTarget.reset();
          }}
          className="mt-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2"
        >
          <input name="user" required placeholder="@username or profile link" aria-label="Instagram username" className={field} />
          <input name="name" placeholder="Display name (optional)" aria-label="Display name" className={field} />
          <button className={btnGhost}>Add</button>
          <p className="sm:col-span-3 text-xs text-st-mute">
            Instagram has no free official way to read other people&apos;s reels, so after adding, you paste each reel&apos;s caption and what&apos;s said and the studio analyses it.
          </p>
        </form>
      )}
    </div>
  );
}

function CompetitorCard({ c, open, onToggle, progress, onAnalyse, onRemove, onChanged, setError }: {
  c: Competitor; open: boolean; onToggle: () => void; progress?: string; onAnalyse: () => void; onRemove: () => void; onChanged: () => void; setError: (m: string) => void;
}) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [busy, setBusy] = useState(false);

  const youtube = c.platform === 'youtube';
  const windowDays = c.summary?.stats?.window_days ?? VIRAL.days;
  const loadVideos = () => {
    let q = supabase().from('studio_videos').select('*').eq('competitor_id', c.id);
    if (youtube)
      q = q
        .eq('is_short', true)
        .gte('published_at', new Date(Date.now() - windowDays * 864e5).toISOString())
        .gte('views', VIRAL.minViews);
    return q
      .order('views', { ascending: false, nullsFirst: false })
      .limit(youtube ? VIRAL.top : 40)
      .then(({ data }) => setVideos((data ?? []) as Video[]));
  };
  useEffect(() => {
    if (open) loadVideos();
  }, [open, c.analyzed_at]); // eslint-disable-line react-hooks/exhaustive-deps

  async function learn() {
    setBusy(true);
    setError('');
    try {
      await api('summarise', { competitorId: c.id });
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  }

  const working = !!progress;
  return (
    <article className={`${card} p-4`}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.thumb ? <img src={c.thumb} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-full shrink-0" /> : <div className="h-11 w-11 rounded-full bg-st-line shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-st-ink truncate">{c.name}</h3>
            <span className="text-[10px] font-bold uppercase tracking-wider text-st-mute border border-st-line rounded-full px-2 py-0.5">{c.platform}</span>
          </div>
          <p className="text-xs text-st-mute">
            {c.handle}{c.followers ? ` · ${compact(c.followers)} followers` : ''} · {c.analyzed_at ? `Analysed ${ago(c.analyzed_at)}` : 'Not analysed yet'}
          </p>
        </div>
        {c.platform === 'youtube' && (
          <button onClick={onAnalyse} disabled={working} className={btnGhost}>{working ? <Spinner /> : <Sparkles size={15} aria-hidden />} {c.analyzed_at ? 'Re-analyse' : 'Analyse'}</button>
        )}
        <button onClick={onToggle} aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} className="p-2 text-st-mute hover:text-st-ink">
          <ChevronDown size={18} className={open ? 'rotate-180' : ''} />
        </button>
        <button onClick={onRemove} aria-label={`Remove ${c.name}`} className="p-2 text-st-mute hover:text-red-600"><Trash2 size={16} /></button>
      </div>
      {progress && <p className="text-xs text-18-orange mt-3 flex items-center gap-2"><Spinner /> {progress}</p>}

      {open && (
        <div className="mt-4 pt-4 border-t border-st-line space-y-5">
          {c.platform === 'instagram' && <ReelForm competitorId={c.id} onDone={() => { loadVideos(); }} setError={setError} />}
          {c.platform === 'instagram' && videos.length > 0 && (
            <button onClick={learn} disabled={busy} className={btn}>{busy ? <Spinner /> : <Sparkles size={15} aria-hidden />} Learn from these reels</button>
          )}
          {c.summary ? <SummaryView s={c.summary} /> : c.platform === 'youtube' && <p className="text-sm text-st-mute">Press Analyse to study this channel.</p>}
          {videos.length > 0 && <VideoList videos={videos} title={youtube ? `Top Shorts: last ${windowDays} days, ${compact(VIRAL.minViews)}+ views` : 'Reels, most viewed first'} />}
        </div>
      )}
    </article>
  );
}

function ReelForm({ competitorId, onDone, setError }: { competitorId: string; onDone: () => void; setError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form));
        setBusy(true);
        setError('');
        try {
          await api('addReel', { competitorId, ...f });
          form.reset();
          onDone();
        } catch (err) {
          setError(errorText(err));
        }
        setBusy(false);
      }}
      className="space-y-2"
    >
      <h4 className="text-sm font-bold text-st-ink">Add a reel</h4>
      <input name="url" placeholder="Reel link" aria-label="Reel link" className={field} />
      <textarea name="caption" rows={2} placeholder="Caption" aria-label="Caption" className={field} />
      <textarea name="transcript" rows={3} placeholder="What is said in the reel (the more exact, the better the hook analysis)" aria-label="What is said" className={field} />
      <div className="grid grid-cols-2 gap-2">
        <input name="views" inputMode="numeric" placeholder="Views (optional)" aria-label="Views" className={field} />
        <input name="likes" inputMode="numeric" placeholder="Likes (optional)" aria-label="Likes" className={field} />
      </div>
      <button disabled={busy} className={btnGhost}>{busy ? <Spinner /> : <Plus size={14} aria-hidden />} Analyse this reel</button>
    </form>
  );
}


function SummaryView({ s }: { s: Summary }) {
  return (
    <div className="space-y-4">
      {s.note && <p className="text-sm text-st-ink/70 border border-st-line rounded-xl p-3">{s.note}</p>}
      {s.about && <p className="text-sm text-st-ink">{s.about}</p>}
      {s.stats && (
        <div className="flex flex-wrap gap-2 text-xs">
          {(s.stats.window_days
            ? [
                [`Shorts, last ${s.stats.window_days} days`, s.stats.shorts_in_window],
                [`Over ${compact(s.stats.min_views)} views`, s.stats.qualified],
                ['Avg views (all Shorts)', compact(s.stats.avg_views)],
                ['Median', compact(s.stats.median_views)],
                ['Best', compact(s.stats.best_views)],
                ['Shorts / week', s.stats.per_week],
              ]
            : [
                ['Videos studied', s.stats.videos],
                ['Shorts', s.stats.shorts],
                ['Avg views', compact(s.stats.avg_views)],
                ['Median views', compact(s.stats.median_views)],
                ['Best', compact(s.stats.best_views)],
                ['Posts / week', s.stats.per_week],
              ]
          ).map(([k, v]) => (
            <span key={String(k)} className="border border-st-line rounded-lg px-2.5 py-1 text-st-ink/70">{k}: <strong className="text-st-ink">{v}</strong></span>
          ))}
        </div>
      )}
      {s.hook_patterns?.length ? (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">Popular hooks</h4>
          <ul className="space-y-2">
            {s.hook_patterns.map((h, i) => (
              <li key={i} className="text-sm border border-st-line rounded-xl p-3">
                <strong className="text-st-ink">{h.pattern}</strong>
                <p className="text-st-mute italic mt-0.5">&ldquo;{h.example}&rdquo;</p>
                <p className="text-st-ink/70 mt-1">{h.use_it}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {s.topics?.length ? <List title="Topics they cover" items={s.topics.map((t) => `${t.topic}: ${t.evidence}`)} /> : null}
      {s.script_structure && <div><h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">How their videos are built</h4><p className="text-sm text-st-ink">{s.script_structure}</p></div>}
      <div className="grid sm:grid-cols-2 gap-4">
        {s.cta_style && <div><h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">CTA style</h4><p className="text-sm text-st-ink">{s.cta_style}</p></div>}
        {s.caption_style && <div><h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">Caption style</h4><p className="text-sm text-st-ink">{s.caption_style}</p></div>}
      </div>
      <List title="Recent trending topics" items={s.recent_trends} />
      <div className="grid sm:grid-cols-2 gap-4">
        <List title="What works" items={s.what_works} />
        <List title="What to avoid" items={s.what_to_avoid} />
      </div>
    </div>
  );
}

function VideoList({ videos, title }: { videos: Video[]; title: string }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">{title}</h4>
      <ul className="divide-y divide-st-line">
        {videos.map((v) => (
          <li key={v.id} className="py-2.5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-st-ink break-words">{(v.title || v.caption || 'Untitled').slice(0, 140)}</p>
              <div className="flex items-center gap-2 shrink-0 text-xs text-st-mute">
                {v.is_short && <span className="border border-st-line rounded-full px-1.5">short</span>}
                <span>{compact(v.views)} views</span>
                {v.url && <a href={safeUrl(v.url)} target="_blank" rel="noopener noreferrer" aria-label="Open video" className="hover:text-st-ink"><ExternalLink size={13} /></a>}
              </div>
            </div>
            {v.hook && (
              <p className="text-xs text-st-mute mt-1">
                <span className="text-18-orange">Hook{v.structure?.hook_type ? ` (${v.structure.hook_type})` : ''}:</span> {v.hook}
              </p>
            )}
            {v.structure?.error && <p className="text-xs text-st-mute mt-1">Could not watch this one: {v.structure.error.slice(0, 100)}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
