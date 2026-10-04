'use client';

// Blog editor — used both for New (id === 'new') and Edit (numeric id).
// Fields: site, category, slug, title, excerpt, cover_url, body_md,
// og_title, og_description, og_image_url. Publish/unpublish toggles
// published_at between now and null.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, BlogPost } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/md';
import { ArrowLeft, Trash2, Save, Send, EyeOff } from 'lucide-react';

interface Props { id: string }

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

export default function BlogEditor({ id }: Props) {
  const router = useRouter();
  const isNew = id === 'new';
  const [loading, setLoading]     = useState(!isNew);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const [row, setRow] = useState<Partial<BlogPost>>({
    site: 'root',
    category: null,
    slug: '',
    title: '',
    excerpt: '',
    body_md: '',
    cover_url: '',
    og_title: '',
    og_description: '',
    og_image_url: '',
    published_at: null,
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data, error } = await supabase.schema('blog').from('posts').select('*').eq('id', Number(id)).maybeSingle();
      if (error) { setErr(error.message); return; }
      if (data) setRow(data as BlogPost);
      setLoading(false);
    })();
  }, [id, isNew]);

  const previewHtml = useMemo(() => renderMarkdown(row.body_md || ''), [row.body_md]);

  const save = async (publish?: 'now' | 'draft') => {
    if (!row.title?.trim()) { setErr('Title is required.'); return; }
    if (!row.slug?.trim())  { setErr('Slug is required.'); return; }
    setBusy(true); setErr(null);

    const payload: Partial<BlogPost> = {
      site: row.site,
      category: row.category || null,
      slug: row.slug!.trim(),
      title: row.title!.trim(),
      excerpt: row.excerpt || null,
      body_md: row.body_md || '',
      cover_url: row.cover_url || null,
      og_title: row.og_title || null,
      og_description: row.og_description || null,
      og_image_url: row.og_image_url || null,
    };
    if (publish === 'now')   payload.published_at = new Date().toISOString();
    if (publish === 'draft') payload.published_at = null;

    try {
      if (isNew) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .schema('blog').from('posts')
          .insert({ ...payload, author_email: user?.email })
          .select()
          .single();
        if (error) throw error;
        router.replace(`/blog/${(data as BlogPost).id}`);
      } else {
        const { error } = await supabase.schema('blog').from('posts').update(payload).eq('id', Number(id));
        if (error) throw error;
        setRow((r) => ({ ...r, ...payload }));
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm('Delete this post permanently?')) return;
    const { error } = await supabase.schema('blog').from('posts').delete().eq('id', Number(id));
    if (error) { alert(error.message); return; }
    router.push('/blog');
  };

  if (loading) return <p className="text-white/50 text-sm">Loading…</p>;

  const published = !!row.published_at;
  const scheduled = published && new Date(row.published_at!).getTime() > Date.now();

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => router.push('/blog')} className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white">
          <ArrowLeft size={12} /> Back to posts
        </button>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              onClick={del}
              className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
          <button
            onClick={() => save()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-white/80 bg-white/5 border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/10 disabled:opacity-50"
          >
            <Save size={12} /> Save
          </button>
          {published ? (
            <button
              onClick={() => save('draft')}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-bold text-white/80 bg-white/5 border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/10 disabled:opacity-50"
            >
              <EyeOff size={12} /> Unpublish
            </button>
          ) : (
            <button
              onClick={() => save('now')}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-bold text-white bg-18-orange border border-18-orange rounded-full px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
            >
              <Send size={12} /> Publish
            </button>
          )}
        </div>
      </div>

      {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: fields */}
        <div className="space-y-3">
          {/* Site + category + slug */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Site">
              <select
                className="cms-input"
                value={row.site}
                onChange={(e) => setRow({ ...row, site: e.target.value as any })}
              >
                <option value="root">craftedbyteja.com</option>
                <option value="pft">pft blog</option>
              </select>
            </Field>
            <Field label="Category">
              <select
                className="cms-input"
                value={row.category || ''}
                onChange={(e) => setRow({ ...row, category: (e.target.value || null) as any })}
              >
                <option value="">—</option>
                <option value="release">Release</option>
                <option value="tip">Tip</option>
                <option value="insight">Insight</option>
              </select>
            </Field>
            <Field label="Status">
              <div className="cms-input flex items-center">
                <span className={`text-xs font-bold uppercase tracking-wider ${scheduled ? 'text-amber-300' : published ? 'text-emerald-400' : 'text-white/50'}`}>
                  {scheduled ? `Scheduled ${new Date(row.published_at!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : published ? 'Published' : 'Draft'}
                </span>
              </div>
            </Field>
          </div>

          <Field label="Title *">
            <input
              type="text"
              className="cms-input"
              value={row.title || ''}
              onChange={(e) => setRow((r) => ({
                ...r,
                title: e.target.value,
                slug: r.slug ? r.slug : slugify(e.target.value),
              }))}
            />
          </Field>

          <Field label={`Slug * (URL: /${row.site === 'pft' ? 'blogs' : 'blog'}/${row.slug || '…'})`}>
            <input
              type="text"
              className="cms-input"
              value={row.slug || ''}
              onChange={(e) => setRow({ ...row, slug: slugify(e.target.value) })}
            />
          </Field>

          <Field label="Excerpt (for cards + OG fallback)">
            <textarea
              rows={2}
              className="cms-input"
              value={row.excerpt || ''}
              onChange={(e) => setRow({ ...row, excerpt: e.target.value })}
            />
          </Field>

          <Field label="Cover image URL">
            <input
              type="text"
              placeholder="https://…"
              className="cms-input"
              value={row.cover_url || ''}
              onChange={(e) => setRow({ ...row, cover_url: e.target.value })}
            />
          </Field>

          <details className="bg-18-surface border border-18-border rounded-lg px-3 py-2 text-sm">
            <summary className="cursor-pointer text-white/70 select-none">SEO / OG overrides (optional)</summary>
            <div className="space-y-2 mt-3">
              <Field label="OG title">
                <input type="text" className="cms-input" value={row.og_title || ''} onChange={(e) => setRow({ ...row, og_title: e.target.value })} />
              </Field>
              <Field label="OG description">
                <textarea rows={2} className="cms-input" value={row.og_description || ''} onChange={(e) => setRow({ ...row, og_description: e.target.value })} />
              </Field>
              <Field label="OG image URL">
                <input type="text" placeholder="https://…" className="cms-input" value={row.og_image_url || ''} onChange={(e) => setRow({ ...row, og_image_url: e.target.value })} />
              </Field>
            </div>
          </details>

          <Field label="Body (Markdown)">
            <textarea
              rows={20}
              className="cms-input font-mono text-sm leading-relaxed"
              placeholder="# Heading&#10;&#10;Body paragraph.&#10;&#10;- list item&#10;- list item"
              value={row.body_md || ''}
              onChange={(e) => setRow({ ...row, body_md: e.target.value })}
            />
          </Field>

          <button
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs text-18-orange hover:underline lg:hidden"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>

        {/* Right: preview */}
        <div className={`${showPreview ? '' : 'hidden lg:block'} bg-18-surface border border-18-border rounded-2xl p-5 max-h-[85vh] overflow-y-auto sticky top-4`}>
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">Live preview</p>
          {row.cover_url && <img src={row.cover_url} alt="" className="rounded-xl w-full mb-4" />}
          <h1 className="text-2xl font-black text-white mb-1">{row.title || <span className="text-white/30 italic">Untitled</span>}</h1>
          {row.excerpt && <p className="text-sm text-white/60 mb-4">{row.excerpt}</p>}
          <div className="prose-crafted" dangerouslySetInnerHTML={{ __html: previewHtml }} />
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
