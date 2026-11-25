'use client';

// Content Calendar: the topics a brand plans to post, on a month (default) or week view.
// Every day has a small + that offers: add a topic, add a repeating topic, or create one with
// AI. "Create with AI" runs the same Create flow (platforms -> topic -> script) in a popup, and
// each script it writes lands on that day. A repeating topic is one row with a repeat rule;
// the dates it falls on are worked out here. Stored in studio_calendar (Viewer reads, Editor
// changes), created by migrations/studio_calendar.sql.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, PenLine, Plus, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import { errorText, supabase } from '@/lib/studio/client';
import { PLATFORM_OPTIONS, type Page, type Script } from '@/lib/studio/shared';
import { btn, btnGhost, ErrorNote, field, label, menuItem, Popover, Spinner, useConfirm } from '../ui';
import Work from './work';

type RepeatRule = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
type Entry = { id: string; brand_id: string; day: string; topic: string; notes: string | null; platforms: string[]; repeat: RepeatRule; repeat_until: string | null; script_id: string | null; done_days?: string[] | null };
type Shown = { entry: Entry; day: string };
type Draft = { id?: string; day: string; topic: string; notes: string; platforms: string[]; repeat: RepeatRule; until: string; script_id?: string | null; occ?: string; done?: boolean }; // occ: the date that was clicked

const REPEATS: [RepeatRule, string][] = [['daily', 'Every day'], ['weekdays', 'Every weekday (Mon to Fri)'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NO_DONE = 'Marking topics completed needs one more database step: run migrations/studio_calendar_done.sql in Supabase, then reload this page.';
const MISSING = 'The calendar needs a one-time database step first: run migrations/studio_calendar.sql in Supabase, then reload this page.';

// Dates as 'YYYY-MM-DD' in local time. Date objects are made at noon, so a clock change never moves a day.
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s: string, n: number) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (s: string) => addDays(s, -((at(s).getDay() + 6) % 7));
const today = () => iso(new Date());
const nice = (s: string, o: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) => at(s).toLocaleDateString(undefined, o);

// The dates in [from, to] that an entry falls on.
function datesOf(e: Entry, from: string, to: string): string[] {
  if (e.repeat === 'none') return e.day >= from && e.day <= to ? [e.day] : [];
  const end = e.repeat_until && e.repeat_until < to ? e.repeat_until : to;
  const out: string[] = [];
  if (e.repeat === 'monthly') {
    const first = at(e.day);
    for (let k = 0; k < 600; k++) {
      const d = new Date(first.getFullYear(), first.getMonth() + k, 1, 12);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
      d.setDate(Math.min(first.getDate(), last)); // the 31st falls on the last day of shorter months
      const s = iso(d);
      if (s > end) break;
      if (s >= from) out.push(s);
    }
    return out;
  }
  const step = e.repeat === 'weekly' ? 7 : e.repeat === 'biweekly' ? 14 : 1;
  let s = e.day;
  if (s < from) { const gap = Math.round((at(from).getTime() - at(s).getTime()) / 864e5); s = addDays(s, Math.floor(gap / step) * step); }
  for (; s <= end; s = addDays(s, step)) {
    if (s < from) continue;
    if (e.repeat === 'weekdays' && at(s).getDay() % 6 === 0) continue;
    out.push(s);
  }
  return out;
}

const repeatText = (e: { repeat: RepeatRule; repeat_until?: string | null; until?: string }) => {
  const r = REPEATS.find(([k]) => k === e.repeat)?.[1] ?? '';
  const u = e.repeat_until ?? e.until;
  return r && u ? `${r}, until ${nice(u, { day: 'numeric', month: 'short', year: 'numeric' })}` : r;
};

export default function Calendar({ page }: { page: Page }) {
  const [view, setView] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(today()); // any day in the month or week on screen
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null); // the topic form
  const [aiDay, setAiDay] = useState<string | null>(null); // the Create with AI popup
  const [ask, dialog] = useConfirm();
  // The grid fills the rest of the window, so the whole month fits without scrolling the page.
  const body = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = body.current;
      if (!el) return;
      const main = document.getElementById('studio-main');
      const top = el.getBoundingClientRect().top + (main?.scrollTop ?? 0);
      setFit(Math.floor(Math.max(300, window.innerHeight - top - 62))); // room for the key and the page padding below
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [entries === null, missing, error, view]);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from('studio_calendar').select('*').eq('brand_id', page.id).order('day');
    if (error) {
      if (/studio_calendar|relation|does not exist|PGRST205/i.test(error.message)) setMissing(true);
      else setError(errorText(error));
      setEntries([]);
      return;
    }
    setMissing(false);
    setEntries((data ?? []) as Entry[]);
  }, [page.id]);
  useEffect(() => { load(); }, [load]);

  // The days on screen: whole weeks, Monday first.
  const days = useMemo(() => {
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cursor), i));
    const c = at(cursor);
    const first = iso(new Date(c.getFullYear(), c.getMonth(), 1, 12));
    const last = iso(new Date(c.getFullYear(), c.getMonth() + 1, 0, 12));
    const start = mondayOf(first);
    const out: string[] = [];
    for (let s = start; s <= last || out.length % 7; s = addDays(s, 1)) out.push(s);
    return out;
  }, [view, cursor]);

  const byDay = useMemo(() => {
    const m = new Map<string, Shown[]>();
    if (!entries || !days.length) return m;
    for (const e of entries) for (const d of datesOf(e, days[0], days[days.length - 1])) m.set(d, [...(m.get(d) ?? []), { entry: e, day: d }]);
    return m;
  }, [entries, days]);

  const move = (n: number) => {
    if (view === 'week') return setCursor(addDays(cursor, 7 * n));
    const c = at(cursor);
    setCursor(iso(new Date(c.getFullYear(), c.getMonth() + n, 1, 12)));
  };
  const month = at(cursor).getMonth();
  const title = view === 'month'
    ? at(cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `${nice(days[0], { day: 'numeric', month: 'short' })} – ${nice(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const blank = (day: string, repeat: RepeatRule = 'none'): Draft => ({ day, topic: '', notes: '', platforms: [], repeat, until: '' });
  const edit = (e: Entry, occ: string) => setDraft({ id: e.id, day: e.day, topic: e.topic, notes: e.notes ?? '', platforms: e.platforms ?? [], repeat: e.repeat, until: e.repeat_until ?? '', script_id: e.script_id, occ, done: !!e.done_days?.includes(occ) });

  const save = async (d: Draft) => {
    const row = { brand_id: page.id, day: d.day, topic: d.topic.trim(), notes: d.notes.trim() || null, platforms: d.platforms, repeat: d.repeat, repeat_until: d.repeat !== 'none' && d.until ? d.until : null };
    const sb = supabase().from('studio_calendar');
    const { error } = d.id ? await sb.update(row).eq('id', d.id) : await sb.insert(row);
    if (error) throw new Error(/studio_calendar|relation|PGRST205/i.test(error.message) ? MISSING : /row-level security|permission/i.test(error.message) ? 'Only an Editor or Admin of this brand can change the calendar.' : errorText(error));
    await load();
  };
  const remove = async (d: Draft) => {
    if (!d.id) return;
    if (!(await ask(d.repeat !== 'none' ? `Remove "${d.topic}" from every date it repeats on?` : `Remove "${d.topic}" from the calendar?`, 'Remove'))) return;
    const { error } = await supabase().from('studio_calendar').delete().eq('id', d.id);
    if (error) throw new Error(errorText(error));
    setDraft(null);
    await load();
  };

  // Completed is kept per date, so each date a repeating topic falls on is ticked off on its own.
  const setDone = async (d: Draft, done: boolean) => {
    const e = entries?.find((x) => x.id === d.id);
    if (!e || !d.occ) return;
    const have = e.done_days ?? [];
    const next = done ? [...new Set([...have, d.occ])].sort() : have.filter((x) => x !== d.occ);
    const { error } = await supabase().from('studio_calendar').update({ done_days: next }).eq('id', e.id);
    if (!error) setEntries((all) => all?.map((x) => (x.id === e.id ? { ...x, done_days: next } : x)) ?? all);
    if (error) throw new Error(/done_days/i.test(error.message) ? NO_DONE : /row-level security|permission/i.test(error.message) ? 'Only an Editor or Admin of this brand can change the calendar.' : errorText(error));
  };

  const isToday = today();
  return (
    <div className="space-y-4">
      {dialog}
      {missing && <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">{MISSING}</p>}
      <ErrorNote text={error} />

      {/* Toolbar: arrows, the period, Today, and the Month / Week drop-down. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <button onClick={() => move(-1)} aria-label={view === 'month' ? 'Previous month' : 'Previous week'} className="h-9 w-9 grid place-items-center rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface"><ChevronLeft size={18} /></button>
          <button onClick={() => move(1)} aria-label={view === 'month' ? 'Next month' : 'Next week'} className="h-9 w-9 grid place-items-center rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface"><ChevronRight size={18} /></button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight mr-1" aria-live="polite">{title}</h2>
        <button onClick={() => setCursor(today())} className="text-sm rounded-lg border border-st-line px-3 h-8 hover:bg-st-surface">Today</button>
        <div className="ml-auto">
          <Popover align="right" trigger={({ open, toggle }) => (
            <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-st-line px-3 h-8 hover:bg-st-surface">
              <CalendarDays size={14} className="text-st-mute" aria-hidden /> {view === 'month' ? 'Month' : 'Week'} <ChevronDown size={14} className="text-st-mute" aria-hidden />
            </button>
          )}>
            {(close) => (['month', 'week'] as const).map((v) => (
              <button key={v} role="menuitemradio" aria-checked={view === v} onClick={() => { setView(v); close(); }} className={`${menuItem} justify-between`}>
                {v === 'month' ? 'Month view' : 'Week view'} {view === v && <Check size={14} className="text-18-orange" aria-hidden />}
              </button>
            ))}
          </Popover>
        </div>
      </div>

      {entries === null ? (
        <p className="text-sm text-st-mute flex items-center gap-2"><Spinner /> Loading…</p>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <div className="min-w-[760px] border border-st-line rounded-xl overflow-hidden">
            <div className="grid grid-cols-7 bg-st-surface border-b border-st-line">
              {days.slice(0, 7).map((d, i) => (
                <div key={d} className="px-3 py-2 text-xs font-medium text-st-mute">
                  {WEEKDAYS[i]}{view === 'week' && <span className={`ml-1.5 ${d === isToday ? 'text-18-orange font-semibold' : 'text-st-ink'}`}>{at(d).getDate()}</span>}
                </div>
              ))}
            </div>
            <div ref={body} className="grid grid-cols-7" style={fit ? { height: fit, gridAutoRows: '1fr' } : undefined}>
              {days.map((d, i) => {
                const items = byDay.get(d) ?? [];
                const out = view === 'month' && at(d).getMonth() !== month;
                // As many as fit in the cell (about 26px each under the date), the rest as "+N more".
                const rowH = fit ? fit / (days.length / 7) : 132;
                const room = view === 'month' ? Math.max(1, Math.floor((rowH - 36) / 26)) : 50;
                const max = items.length > room ? Math.max(0, room - 1) : room;
                return (
                  <div key={d} className={`group relative flex flex-col gap-1 p-2 min-h-0 overflow-hidden ${fit ? '' : view === 'month' ? 'min-h-[132px]' : 'min-h-[460px]'} ${view === 'week' ? 'overflow-y-auto' : ''} ${i % 7 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} border-st-line ${out ? 'bg-st-surface/60' : 'bg-white'}`}>
                    <div className="flex items-center justify-between">
                      {view === 'month' ? (
                        <span className={`text-xs h-6 min-w-6 px-1.5 grid place-items-center rounded-full ${d === isToday ? 'bg-18-orange text-white font-semibold' : out ? 'text-st-mute/70' : 'text-st-ink font-medium'}`}>{at(d).getDate()}</span>
                      ) : <span />}
                      <AddMenu day={d}
                        onTopic={() => setDraft(blank(d))}
                        onRepeat={() => setDraft(blank(d, 'weekly'))}
                        onAi={() => setAiDay(d)} />
                    </div>
                    {items.slice(0, max).map((s) => <Chip key={s.entry.id + s.day} shown={s} big={view === 'week'} onOpen={() => edit(s.entry, s.day)} />)}
                    {items.length > max && (
                      <button onClick={() => { setView('week'); setCursor(d); }} className="text-left text-[11px] text-st-mute hover:text-st-ink px-1">+{items.length - max} more</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-xs text-st-mute flex flex-wrap gap-x-4 gap-y-1">
            {([[TONE.topic, PenLine, 'Topic'], [TONE.repeat, Repeat, 'Repeats'], [TONE.ai, Sparkles, 'Script written with AI'], [TONE.done, Check, 'Completed']] as const).map(([tone, Icon, text]) => (
              <span key={text} className="inline-flex items-center gap-1.5"><span className={`h-4 w-4 rounded grid place-items-center text-white ${tone}`}><Icon size={10} aria-hidden /></span> {text}</span>
            ))}
          </p>
        </div>
      )}

      {draft && <TopicForm page={page} draft={draft} onClose={() => setDraft(null)} onSave={save} onRemove={remove} onDone={setDone} />}
      {aiDay && <AiPopup page={page} day={aiDay} onClose={() => setAiDay(null)} onAdded={load} />}
    </div>
  );
}

// The small + on each day: the three ways to add something.
// The menu is placed on the window (position: fixed), not inside the day: a day box clips
// whatever spills out of it, which hid the menu.
function AddMenu({ day, onTopic, onRepeat, onAi }: { day: string; onTopic: () => void; onRepeat: () => void; onAi: () => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const W = 224, H = 190; // menu size, to keep it on screen
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btnRef.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    const top = r.bottom + 6 + H > window.innerHeight ? Math.max(8, r.top - 6 - H) : r.bottom + 6;
    setPos({ top, left });
  };
  useEffect(() => {
    if (!pos) return;
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    const gone = () => setPos(null);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', gone);
    document.getElementById('studio-main')?.addEventListener('scroll', gone);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', gone);
      document.getElementById('studio-main')?.removeEventListener('scroll', gone);
    };
  }, [pos]);
  const pick = (fn: () => void) => () => { setPos(null); fn(); };
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-haspopup="menu" aria-expanded={!!pos} aria-label={`Add to ${nice(day)}`}
        className={`h-6 w-6 grid place-items-center rounded-md text-st-mute hover:text-18-orange hover:bg-18-orange/10 transition ${pos ? 'text-18-orange bg-18-orange/10' : 'opacity-60 group-hover:opacity-100 focus-visible:opacity-100'}`}>
        <Plus size={15} />
      </button>
      {pos && (
        <div ref={menu} role="menu" aria-label={`Add to ${nice(day)}`} style={{ top: pos.top, left: pos.left, width: W }}
          className="fixed z-[60] bg-white border border-st-line rounded-xl shadow-lg p-1.5">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-st-mute">{nice(day)}</p>
          <button autoFocus role="menuitem" onClick={pick(onTopic)} className={menuItem}><PenLine size={15} className="text-st-mute" aria-hidden /> Add a topic</button>
          <button role="menuitem" onClick={pick(onRepeat)} className={menuItem}><Repeat size={15} className="text-st-mute" aria-hidden /> Repeating topic</button>
          <div className="my-1 h-px bg-st-line" />
          <button role="menuitem" onClick={pick(onAi)} className={menuItem}><Sparkles size={15} className="text-18-orange" aria-hidden /> Create with AI</button>
        </div>
      )}
    </>
  );
}

// Solid, bright colours so a topic stands out on the white grid: violet for a topic, blue for
// a repeating one, orange for one with an AI script. White text on all three.
const TONE = { ai: 'bg-18-orange hover:bg-[#E5601F]', repeat: 'bg-sky-500 hover:bg-sky-600', topic: 'bg-violet-500 hover:bg-violet-600', done: 'bg-emerald-500 hover:bg-emerald-600' };
const toneOf = (e: Entry, done: boolean) => (done ? TONE.done : e.script_id ? TONE.ai : e.repeat !== 'none' ? TONE.repeat : TONE.topic);

function Chip({ shown, big, onOpen }: { shown: Shown; big: boolean; onOpen: () => void }) {
  const e = shown.entry;
  const done = !!e.done_days?.includes(shown.day);
  const Icon = done ? Check : e.script_id ? Sparkles : e.repeat !== 'none' ? Repeat : PenLine;
  return (
    <button onClick={onOpen} title={done ? `${e.topic} (completed)` : e.topic}
      className={`w-full text-left rounded-md px-2 ${big ? 'py-2' : 'py-1'} text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-st-ink/40 ${toneOf(e, done)}`}>
      <span className="flex items-start gap-1.5">
        <Icon size={12} className="mt-[3px] shrink-0 text-white/90" aria-hidden />
        <span className={`min-w-0 text-xs font-medium leading-snug ${big ? 'line-clamp-3' : 'truncate'}`}>{e.topic}</span>
      </span>
      {big && e.platforms?.length > 0 && <span className="mt-1 block text-[11px] text-white/85 truncate pl-[18px]">{e.platforms.join(' · ')}</span>}
    </button>
  );
}

function Shell({ title, sub, wide, onClose, children, footer }: { title: string; sub?: React.ReactNode; wide?: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[68] bg-black/40 p-3 sm:p-6 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-5xl h-full' : 'max-w-lg max-h-full'} flex flex-col overflow-hidden`}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-st-line shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">{title}</h2>
            {sub && <p className="text-xs text-st-mute mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-st-mute hover:text-st-ink hover:bg-st-surface" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-st-line bg-st-surface shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}

// Add or change a topic. A repeating topic is the same form with "Repeat" switched on.
function TopicForm({ page, draft, onClose, onSave, onRemove, onDone }: { page: Page; draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void>; onRemove: (d: Draft) => Promise<void>; onDone: (d: Draft, done: boolean) => Promise<void> }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [script, setScript] = useState<Script | null>(null);
  const [done, setDoneHere] = useState(!!draft.done);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const repeating = d.repeat !== 'none';
  useEffect(() => {
    if (!draft.script_id) return;
    supabase().from('studio_scripts').select('*').eq('id', draft.script_id).maybeSingle().then(({ data }) => setScript((data as Script) ?? null));
  }, [draft.script_id]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const ok = d.topic.trim().length > 0 && (!repeating || !d.until || d.until >= d.day);
  const text = script ? [script.hook, script.body, script.conclusion, script.cta].map((t) => (t ?? '').trim()).filter(Boolean).join('\n') : '';

  return (
    <Shell title={d.id ? 'Topic' : repeating ? 'Repeating topic' : 'Add a topic'} sub={repeating ? repeatText(d) || 'Repeats' : nice(d.day)} onClose={onClose}
      footer={<>
        {d.id && <button onClick={() => run(() => onRemove(d))} disabled={busy} className={`${btnGhost} !text-red-600`}><Trash2 size={14} aria-hidden /> Remove</button>}
        {/* One button: marks the date completed, and pressed again undoes it. Stays open so a slip is easy to undo. */}
        {d.id && d.occ && (
          <button onClick={() => run(async () => { await onDone(draft, !done); setDoneHere(!done); })} disabled={busy} aria-pressed={done}
            title={done ? 'Completed. Click to undo' : 'Mark as completed'}
            className={done ? 'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 min-h-[40px] text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 transition' : `${btnGhost} !text-emerald-700`}>
            {busy ? <Spinner /> : <Check size={14} aria-hidden />}
            {done ? 'Completed' : repeating ? `Mark completed (${nice(draft.occ!, { day: 'numeric', month: 'short' })})` : 'Mark completed'}
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={() => run(async () => { await onSave(d); onClose(); })} disabled={!ok || busy} className={btn}>{busy ? <Spinner /> : null} {d.id ? 'Save' : 'Add to calendar'}</button>
      </>}>
      {error && <div className="mb-4"><ErrorNote text={error} /></div>}
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) run(async () => { await onSave(d); onClose(); }); }}>
        <div>
          <label className={label} htmlFor="cal-topic">Topic</label>
          <input id="cal-topic" autoFocus value={d.topic} maxLength={300} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. 3 mistakes first-time founders make with pricing" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="cal-day">{repeating ? 'Starts on' : 'Date'}</label>
            <input id="cal-day" type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value })} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="cal-repeat">Repeat</label>
            <select id="cal-repeat" value={d.repeat} onChange={(e) => set({ repeat: e.target.value as RepeatRule })} className={field}>
              <option value="none">Does not repeat</option>
              {REPEATS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </div>
        </div>
        {repeating && (
          <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
            <label className={label} htmlFor="cal-until">Ends on <span className="font-normal">(optional, leave empty to keep repeating)</span></label>
            <input id="cal-until" type="date" min={d.day} value={d.until} onChange={(e) => set({ until: e.target.value })} className={`${field} bg-white`} />
            {d.id && <p className="text-xs text-st-mute mt-2">Changes apply to every date this topic repeats on.</p>}
          </div>
        )}
        <div>
          <span className={label}>Platforms <span className="font-normal">(optional)</span></span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
            {(page.supported_platforms?.length ? PLATFORM_OPTIONS.filter((p) => page.supported_platforms!.includes(p)) : PLATFORM_OPTIONS).concat(d.platforms.filter((p) => !PLATFORM_OPTIONS.includes(p))).map((p) => {
              const on = d.platforms.includes(p);
              return (
                <button key={p} type="button" aria-pressed={on} onClick={() => set({ platforms: on ? d.platforms.filter((x) => x !== p) : [...d.platforms, p] })}
                  className={`text-xs rounded-full border px-3 py-1.5 min-h-[32px] transition ${on ? 'border-18-orange bg-18-orange/10 text-st-ink font-medium' : 'border-st-line text-st-mute hover:text-st-ink'}`}>
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={label} htmlFor="cal-notes">Notes <span className="font-normal">(optional)</span></label>
          <textarea id="cal-notes" rows={3} value={d.notes} maxLength={3000} onChange={(e) => set({ notes: e.target.value })} placeholder="Angle, references, who is filming it…" className={field} />
        </div>
        {text && (
          <div className="rounded-xl bg-st-surface p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-st-mute inline-flex items-center gap-1.5"><Sparkles size={12} className="text-18-orange" aria-hidden /> Script written with AI</span>
              <CopyText text={text} />
            </div>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{text}</div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Shell>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })} className="inline-flex items-center gap-1 text-xs text-st-mute hover:text-st-ink">
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// Create with AI: the Create flow (platforms -> topic -> script) in a popup. Each script it
// writes is put on this day of the calendar.
function AiPopup({ page, day, onClose, onAdded }: { page: Page; day: string; onClose: () => void; onAdded: () => void }) {
  const [added, setAdded] = useState('');
  const [error, setError] = useState('');
  return (
    <Shell wide title="Create with AI" sub={<>Pick the platforms, give a topic and the AI writes the script. It is added to the calendar on <span className="text-st-ink font-medium">{nice(day)}</span>.</>} onClose={onClose}>
      {added && <p role="status" className="mb-4 text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 inline-flex items-center gap-2"><Check size={14} aria-hidden /> Added &ldquo;{added}&rdquo; to {nice(day, { day: 'numeric', month: 'long' })}.</p>}
      <ErrorNote text={error} />
      <Work page={page} view="create" onOpened={() => {}} embed={{
        onWritten: async (w) => {
          const { error } = await supabase().from('studio_calendar').insert({ brand_id: page.id, day, topic: w.topic.slice(0, 300), platforms: w.platforms, script_id: w.scriptId });
          if (error) setError(`The script was written and saved in the Library, but it could not be added to the calendar: ${errorText(error)}`);
          else { setAdded(w.topic); onAdded(); }
        },
      }} />
    </Shell>
  );
}
