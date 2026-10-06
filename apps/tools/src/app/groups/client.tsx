'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Megaphone, Search, Users } from 'lucide-react';

export type Group = {
  id: number;
  url: string;
  kind: 'group' | 'channel';
  name: string;
  about: string | null;
  topics: string[];
  cities: string[];
  works: number;
  last_works: string | null;
};

const post = (body: object) =>
  fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const chip = 'text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border';

export function GroupCard({ group: g, topicLabels }: { group: Group; topicLabels: Record<string, string> }) {
  const [state, setState] = useState<'idle' | 'ask' | 'done'>('idle');
  const vote = (v: 'works' | 'broken' | 'scam') => {
    post({ action: 'vote', id: g.id, vote: v });
    setState('done');
  };
  const Icon = g.kind === 'channel' ? Megaphone : Users;

  return (
    <div className="bg-18-surface border border-18-border rounded-2xl p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
          <Icon size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-white break-words">{g.name}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className={`${chip} text-white/60 border-18-border`}>{g.kind}</span>
            {g.topics.map((t) => (
              <span key={t} className={`${chip} text-18-orange border-18-orange/30 bg-18-orange/10`}>{topicLabels[t] ?? 'Other'}</span>
            ))}
            {g.cities.map((c) => (
              <span key={c} className={`${chip} text-white/60 border-18-border`}>{c === 'Online' ? 'Online · any city' : c}</span>
            ))}
          </div>
          {g.about && <p className="text-xs text-white/55 mt-2 leading-relaxed break-words">{g.about}</p>}
          <p className="text-[11px] text-white/35 mt-2">
            {g.last_works ? `Confirmed working ${ago(g.last_works)}` : 'Not confirmed yet'}
          </p>
        </div>
        <a
          href={g.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={() => setState('ask')}
          className="shrink-0 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl px-3.5 py-2"
        >
          Join <ExternalLink size={14} aria-hidden />
        </a>
      </div>

      {state === 'ask' && (
        <div className="mt-3 pt-3 border-t border-18-border flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/70 mr-1">Did the link work?</span>
          <button onClick={() => vote('works')} className="rounded-lg border border-emerald-500/40 text-emerald-400 px-3 py-1 hover:bg-emerald-500/10">Yes</button>
          <button onClick={() => vote('broken')} className="rounded-lg border border-18-border text-white/70 px-3 py-1 hover:bg-white/5">No, it&apos;s dead</button>
          <button onClick={() => vote('scam')} className="rounded-lg border border-red-500/40 text-red-400 px-3 py-1 hover:bg-red-500/10">It&apos;s spam or a scam</button>
        </div>
      )}
      {state === 'done' && <p className="mt-3 pt-3 border-t border-18-border text-xs text-white/50">Thanks, that helps everyone else.</p>}
    </div>
  );
}

const field = 'w-full bg-18-bg border border-18-border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-18-orange/60';


type Option = { key: string; label: string };

export function SubmitForm({ topics, cities }: { topics: Option[]; cities: string[] }) {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const fd = new FormData(form);
    const res = await post({
      action: 'submit',
      link: fd.get('link'), name: fd.get('name'), about: fd.get('about'),
      topics: fd.getAll('topics'), cities: fd.getAll('cities'),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok) {
      form.reset();
      setResetKey((k) => k + 1); // clears the dropdowns too
      setStatus({ ok: true, msg: 'Added. It shows up in search right away.' });
    } else {
      setStatus({ ok: false, msg: data?.error ?? 'Something went wrong. Try again.' });
    }
  }

  return (
    <section id="add" className="mt-14 bg-18-surface border border-18-border rounded-2xl p-5">
      <h2 className="text-lg font-bold text-white">Add your group or channel</h2>
      <p className="text-xs text-white/50 mt-1 mb-4">Free. It goes live straight away. Trading tips, earning schemes, betting and adult groups are filtered out.</p>
      <form onSubmit={submit} className="space-y-3">
        <input name="link" required placeholder="https://chat.whatsapp.com/… or whatsapp.com/channel/…" aria-label="Invite link" className={field} />
        <input name="name" required minLength={3} maxLength={100} placeholder="Group name" aria-label="Group name" className={field} />
        <textarea name="about" maxLength={500} rows={2} placeholder="What's it about? Who should join? (optional)" aria-label="Description" className={field} />
        <div className="grid md:grid-cols-2 gap-3" key={resetKey}>
          <MultiSelect name="topics" label="Topics" placeholder="Pick 1 to 3 topics" max={3} options={[...topics, { key: 'other', label: 'Other' }]} />
          <MultiSelect
            name="cities"
            label="Cities"
            placeholder="Optional, up to 5"
            max={5}
            options={cities.map((c) => ({ key: c, label: c === 'Online' ? 'Online · any city' : c }))}
          />
        </div>
        <button disabled={busy} className="bg-18-orange hover:brightness-110 disabled:opacity-50 text-white font-semibold text-sm rounded-xl px-5 py-2.5">
          {busy ? 'Adding…' : 'Add group'}
        </button>
        {status && <p role="status" className={`text-sm ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</p>}
      </form>
    </section>
  );
}

// Dropdown with a search box and a checkbox list. Picks are posted as hidden
// inputs, so the form reads them with FormData like any other field.
function MultiSelect({ name, label, placeholder, max, options }: { name: string; label: string; placeholder: string; max: number; options: Option[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < max ? [...p, key] : p));
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const summary = picked.map((k) => options.find((o) => o.key === k)?.label).join(', ');

  return (
    <div ref={ref} className="relative">
      <span className="block text-xs text-white/60 mb-1.5">{label}</span>
      {picked.map((k) => <input key={k} type="hidden" name={name} value={k} />)}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${field} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${picked.length ? 'text-white' : 'text-white/40'}`}>{summary || placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full bg-18-surface-2 border border-18-border rounded-xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-18-border">
            <Search size={14} className="text-white/40 shrink-0" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="w-full bg-transparent py-2.5 text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto py-1">
            {shown.map((o) => {
              const on = picked.includes(o.key);
              const full = !on && picked.length >= max;
              return (
                <li key={o.key}>
                  <label className={`flex items-center gap-2.5 px-3 py-2 text-sm ${full ? 'text-white/30 cursor-not-allowed' : 'text-white/85 cursor-pointer hover:bg-white/5'}`}>
                    <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(o.key)} className="sr-only peer" />
                    <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-18-orange/60 ${on ? 'bg-18-orange border-18-orange' : 'border-white/30'}`}>
                      {on && <Check size={12} className="text-white" aria-hidden />}
                    </span>
                    {o.label}
                  </label>
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-2 text-sm text-white/40">No match</li>}
          </ul>
          <div className="flex items-center justify-between px-3 py-2 border-t border-18-border text-xs text-white/45">
            <span>{picked.length}/{max} picked</span>
            <button type="button" onClick={() => setOpen(false)} className="text-18-orange font-semibold">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
