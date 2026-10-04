'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, BlogPost } from '@/lib/supabase';

// Where each site serves its posts, so a published row can link to the real page.
const LIVE_URL: Record<BlogPost['site'], (slug: string) => string> = {
  root: (slug) => `https://www.craftedbyteja.com/blog/${slug}`,
  pft: (slug) => `https://pft.craftedbyteja.com/blogs/${slug}`,
};
import { Plus, PenLine, ExternalLink } from 'lucide-react';

export default function BlogList() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [site, setSite] = useState<'all' | 'root' | 'pft'>('all');

  useEffect(() => {
    (async () => {
      let q = supabase.schema('blog').from('posts').select('*').order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) console.error(error);
      setPosts((data || []) as BlogPost[]);
      setLoading(false);
    })();
  }, []);

  const filtered = site === 'all' ? posts : posts.filter((p) => p.site === site);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-white">Blog posts</h1>
          <p className="text-xs text-white/50 mt-0.5">Root site + PFT blog. One editor, two audiences.</p>
        </div>
        <Link
          href="/blog/new"
          className="inline-flex items-center gap-2 text-sm font-bold text-white bg-18-orange rounded-full px-4 py-2 hover:brightness-110"
        >
          <Plus size={14} /> New post
        </Link>
      </div>

      <div className="flex gap-1 mb-4 bg-18-surface border border-18-border rounded-full p-1 w-fit">
        {(['all', 'root', 'pft'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSite(k)}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
              site === k ? 'bg-18-orange text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            {k === 'all' ? 'All' : k === 'root' ? 'craftedbyteja.com' : 'pft blog'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-18-surface border border-18-border rounded-2xl p-8 text-center">
          <PenLine size={20} className="text-white/40 mx-auto mb-2" />
          <p className="text-white/60 text-sm">No posts yet. Hit &ldquo;New post&rdquo; up top.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => {
            const published = !!p.published_at;
            const scheduled = published && new Date(p.published_at!).getTime() > Date.now();
            return (
              <li key={p.id} className="relative">
                {published && !scheduled && p.slug && (
                  <a
                    href={LIVE_URL[p.site](p.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 text-[11px] font-bold text-white/60 hover:text-18-orange"
                    title="Open the live post"
                  >
                    View <ExternalLink size={11} />
                  </a>
                )}
                <Link
                  href={`/blog/${p.id}`}
                  className="block bg-18-surface border border-18-border rounded-xl p-3 pr-20 hover:border-18-orange/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/60 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                      {p.site}
                    </span>
                    {p.category && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-18-orange bg-18-orange/10 border border-18-orange/30 rounded-full px-2 py-0.5">
                        {p.category}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                        scheduled
                          ? 'text-amber-300 bg-amber-300/10 border-amber-300/30'
                          : published
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : 'text-white/50 bg-white/5 border-white/10'
                      }`}
                    >
                      {scheduled ? 'Scheduled' : published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white mt-1.5 truncate">
                    {p.title || <span className="text-white/40 italic">Untitled</span>}
                  </p>
                  <p className="text-[11px] text-white/50 mt-0.5">
                    /{p.slug || <span className="text-white/40 italic">no-slug</span>}
                    {' · '}
                    {p.published_at
                      ? new Date(p.published_at).toLocaleDateString('en-IN')
                      : `edited ${new Date(p.updated_at).toLocaleDateString('en-IN')}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
