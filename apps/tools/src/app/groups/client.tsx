'use client';

import { useState } from 'react';
import { ExternalLink, Megaphone, Users } from 'lucide-react';

export type Group = {
  id: number;
  url: string;
  kind: 'group' | 'channel';
  name: string;
  about: string | null;
  topic: string;
  city: string | null;
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

export function GroupCard({ group: g, topicLabel }: { group: Group; topicLabel: string }) {
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
            <span className={`${chip} text-18-orange border-18-orange/30 bg-18-orange/10`}>{topicLabel}</span>
            {g.city && <span className={`${chip} text-white/60 border-18-border`}>{g.city}</span>}
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

export function SubmitForm({ topics, cities }: { topics: { key: string; label: string }[]; cities: string[] }) {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const res = await post({ action: 'submit', ...Object.fromEntries(new FormData(form)) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok) {
      form.reset();
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
        <div className="grid grid-cols-2 gap-2">
          <select name="topic" required defaultValue="" aria-label="Topic" className={field}>
            <option value="" disabled>Topic</option>
            {topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            <option value="other">Other</option>
          </select>
          <select name="city" defaultValue="" aria-label="City" className={field}>
            <option value="">City (optional)</option>
            {cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button disabled={busy} className="bg-18-orange hover:brightness-110 disabled:opacity-50 text-white font-semibold text-sm rounded-xl px-5 py-2.5">
          {busy ? 'Adding…' : 'Add group'}
        </button>
        {status && <p role="status" className={`text-sm ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</p>}
      </form>
    </section>
  );
}
