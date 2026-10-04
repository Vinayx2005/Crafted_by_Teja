'use client';

// Author profile — one row, read by both blogs. Everything here becomes the
// craftedbyteja.com home page, the byline under every post, and the Person / BlogPosting
// structured data. The evidence links become `sameAs`, which is how search
// engines connect scattered profiles into one identity.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2, ExternalLink } from 'lucide-react';

interface Link { label: string; url: string }
interface Profile {
  name: string; role: string; bio: string; image_url: string; location: string;
  email: string; credentials: string; disclosure: string; links: Link[];
}

const EMPTY: Profile = {
  name: '', role: '', bio: '', image_url: '', location: '',
  email: '', credentials: '', disclosure: '', links: [],
};

// Label a pasted URL by where it points, so you don't have to type it.
const labelFor = (url: string) => {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const known: Record<string, string> = {
    'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'linkedin.com': 'LinkedIn',
    'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X', 'github.com': 'GitHub',
    'amazon.in': 'Amazon author page', 'amazon.com': 'Amazon author page',
    'goodreads.com': 'Goodreads', 'medium.com': 'Medium', 'substack.com': 'Newsletter',
    'spotify.com': 'Podcast', 'crunchbase.com': 'Crunchbase',
  };
  const hit = Object.keys(known).find((k) => host.endsWith(k));
  return hit ? known[hit] : host;
};

export default function AuthorProfile() {
  const [p, setP] = useState<Profile>(EMPTY);
  const [saved, setSaved] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [bulk, setBulk] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.schema('blog').from('author_profile').select('*').eq('id', 1).maybeSingle();
    if (error) setErr(error.message);
    const row = { ...EMPTY, ...(data || {}) } as any;
    Object.keys(EMPTY).forEach((k) => { if (row[k] === null) row[k] = (EMPTY as any)[k]; });
    row.links = Array.isArray(row.links) ? row.links : [];
    setP(row); setSaved(row); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = JSON.stringify(p) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.schema('blog').from('author_profile')
      .upsert({ id: 1, ...p, links: p.links.filter((l) => l.url.trim()) });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk(true); setTimeout(() => setOk(false), 2500);
    load();
  };

  // Paste a pile of URLs (one per line) and they become labelled evidence links.
  const addBulk = () => {
    const found = bulk.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    const have = new Set(p.links.map((l) => l.url));
    setP({ ...p, links: [...p.links, ...found.filter((u) => !have.has(u)).map((url) => ({ url, label: labelFor(url) }))] });
    setBulk('');
  };

  if (loading) return <p className="text-white/50 text-sm">Loading…</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-white">Author profile</h1>
          <p className="text-xs text-white/50 mt-0.5">
            Used on the about page, the byline under every post, and the structured data both blogs publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ok && <span className="text-[11px] text-emerald-400">Saved — live within 5 minutes</span>}
          <a href="https://www.craftedbyteja.com" target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white">
            View page <ExternalLink size={11} />
          </a>
          <button onClick={save} disabled={busy || !dirty}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-18-orange rounded-full px-4 py-2 hover:brightness-110 disabled:opacity-40">
            {busy && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

      <p className="text-xs text-white/50 bg-18-surface border border-18-border rounded-xl p-3 mb-4">
        Google&apos;s quality criteria ask whether someone researching you would conclude you&apos;re a trusted source — it matters most
        on money topics. Specifics beat adjectives: name the books, link the channel, give real numbers. Only claims you can back up.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name — exactly as it appears everywhere else">
            <input className="cms-input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </Field>
          <Field label="Role — e.g. Founder of Personal FT · Author">
            <input className="cms-input" value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} />
          </Field>
        </div>

        <Field label="Photo URL — the same photo you use on LinkedIn and YouTube">
          <input className="cms-input" placeholder="https://www.craftedbyteja.com/teja.jpg" value={p.image_url} onChange={(e) => setP({ ...p, image_url: e.target.value })} />
        </Field>

        <Field label="Bio — specifics, not adjectives. Books by name, channel, products, numbers, years.">
          <textarea rows={4} className="cms-input" value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} />
        </Field>

        <Field label="Credentials — structured data only, not shown on the page">
          <textarea rows={3} className="cms-input"
            placeholder="e.g. I'm not a financial adviser or a CA. I build a money-tracking app and write from managing my own money and from aggregate patterns in the app's data."
            value={p.credentials} onChange={(e) => setP({ ...p, credentials: e.target.value })} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact email — structured data only, not shown on the page">
            <input className="cms-input" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} />
          </Field>
          <Field label="Location — structured data only, e.g. Hyderabad, India">
            <input className="cms-input" value={p.location} onChange={(e) => setP({ ...p, location: e.target.value })} />
          </Field>
        </div>

        <Field label="How these posts are written — structured data only, not shown on the page">
          <textarea rows={3} className="cms-input"
            placeholder="e.g. Research and first drafts are AI-assisted. Every post is edited and fact-checked by me before it goes live, and the data comes from my own app."
            value={p.disclosure} onChange={(e) => setP({ ...p, disclosure: e.target.value })} />
        </Field>

        {/* Evidence links → sameAs */}
        <div className="bg-18-surface border border-18-border rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">Evidence links</p>
          <p className="text-[11px] text-white/40 mb-3">
            Every profile that proves you exist: YouTube, LinkedIn, Amazon author page, Goodreads, X, GitHub, podcasts, press.
            These are published as <code className="text-white/60">sameAs</code>, which is how search engines merge scattered mentions into one identity.
          </p>

          <div className="flex gap-2 mb-3">
            <textarea rows={2} className="cms-input text-xs" placeholder="Paste links here, one per line — labels are filled in automatically"
              value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <button onClick={addBulk} disabled={!bulk.trim()}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-white/80 bg-white/5 border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/10 disabled:opacity-40">
              <Plus size={12} /> Add
            </button>
          </div>

          <ul className="space-y-2">
            {p.links.map((l, k) => (
              <li key={k} className="flex gap-2">
                <input className="cms-input text-xs !w-40 shrink-0" value={l.label}
                  onChange={(e) => setP({ ...p, links: p.links.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)) })} />
                <input className="cms-input text-xs flex-1 min-w-0" value={l.url}
                  onChange={(e) => setP({ ...p, links: p.links.map((x, i) => (i === k ? { ...x, url: e.target.value } : x)) })} />
                <button onClick={() => setP({ ...p, links: p.links.filter((_, i) => i !== k) })}
                  className="shrink-0 text-white/40 hover:text-red-400 px-1" title="Remove">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            {!p.links.length && <li className="text-xs text-white/30">No links yet — paste some above.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1 block">{label}</span>
      {children}
    </label>
  );
}
