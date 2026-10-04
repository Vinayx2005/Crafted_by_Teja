import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabase, BlogPost } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/md';
import { getAuthor, AUTHOR_URL, Author } from '@/lib/author';

export const revalidate = 60;

async function getPost(slug: string): Promise<BlogPost | null> {
  const { data } = await supabase
    .from('posts')
    .select('*')
    .eq('site', 'root')
    .eq('slug', slug)
    .not('published_at', 'is', null)
    .maybeSingle();
  return (data as BlogPost | null) ?? null;
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const p = await getPost(params.slug);
  if (!p) return { title: 'Not found · Crafted by Teja' };
  return {
    title: `${p.og_title || p.title} · Crafted by Teja`,
    description: p.og_description || p.excerpt || undefined,
    authors: [{ name: (await getAuthor()).name, url: AUTHOR_URL }],
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: {
      type: 'article',
      title: p.og_title || p.title,
      description: p.og_description || p.excerpt || undefined,
      url: `/blog/${p.slug}`,
      publishedTime: p.published_at || undefined,
      modifiedTime: p.updated_at || p.published_at || undefined,
      authors: [AUTHOR_URL],
      images: p.og_image_url ? [{ url: p.og_image_url }] : undefined,
    },
  };
}

// Article markup: ties the post to a named author and carries the dates
// Google uses for freshness. Mirrors what is visible on the page — required.
function articleLd(author: Author, post: { title: string; slug: string; excerpt: string | null; cover_url: string | null; published_at: string | null; updated_at?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || undefined,
    image: post.cover_url || undefined,
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at || post.published_at || undefined,
    mainEntityOfPage: `https://www.craftedbyteja.com/blog/${post.slug}`,
    author: { '@type': 'Person', name: author.name, url: AUTHOR_URL },
    publisher: { '@type': 'Organization', name: 'Crafted by Teja', url: 'https://www.craftedbyteja.com' },
  };
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  if (!post) notFound();
  const author = await getAuthor();
  const updated = !!post.updated_at && !!post.published_at
    && new Date(post.updated_at).getTime() - new Date(post.published_at).getTime() > 86_400_000;
  return (
    <article className="max-w-2xl mx-auto px-5 md:px-8 py-16">
      <Link href="/blog" className="text-[13px] text-muted hover:text-ink transition-colors">
        ← Back to writing
      </Link>
      <h1 className="text-3xl md:text-5xl font-black tracking-[-0.03em] mt-5 mb-3 leading-[1.1]">
        {post.title}
      </h1>
      <div className="flex items-center gap-3 mb-9">
        <img src={author.image_url || ''} alt="" className="h-9 w-9 rounded-full object-cover" />
        <p className="text-[12px] text-muted">
          <a href={AUTHOR_URL} className="text-ink hover:underline font-semibold">{author.name}</a>
          {post.published_at && (
            <>
              {' · '}
              <time dateTime={post.published_at}>
                {new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </time>
            </>
          )}
          {updated && (
            <>
              {' · Updated '}
              <time dateTime={post.updated_at!}>
                {new Date(post.updated_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </time>
            </>
          )}
        </p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd(author, post)) }} />
      {post.cover_url && <img src={post.cover_url} alt="" className="rounded-xl w-full mb-9" />}
      <div className="prose-crafted" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }} />
    </article>
  );
}
