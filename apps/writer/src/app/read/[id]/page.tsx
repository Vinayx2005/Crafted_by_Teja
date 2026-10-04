import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import Reader from './Reader';

// always read the current published copy (the author can update or unpublish it)
export const dynamic = 'force-dynamic';

// Server-side read of the published book, only for the link preview
// (title / tagline / author when the link is shared). The page itself
// loads the book in the browser.
async function getEbook(id: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nqgflcoqfrqzelzduuhs.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZ2ZsY29xZnJxemVsemR1dWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNjU0MzcsImV4cCI6MjA5OTg0MTQzN30.Ud7l_jg_uNMrf_IROo6SAByPY6E1m3O0obcXlL4O9hk',
    { db: { schema: 'writer' }, auth: { persistSession: false } },
  );
  const { data } = await sb.from('ebooks').select('title, book->tagline, book->settings->author').eq('id', id).maybeSingle();
  return data as { title: string; tagline: string | null; author: string | null } | null;
}

const plain = (html: string | null) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const eb = await getEbook(params.id).catch(() => null);
  if (!eb) return { title: 'Book not found · Writers Book Studio' };
  const title = eb.author ? `${eb.title} by ${eb.author}` : eb.title;
  const description = plain(eb.tagline) || 'Read this book free on Writers Book Studio.';
  return {
    title: `${eb.title} · Writers Book Studio`,
    description,
    openGraph: { title, description, url: `/read/${params.id}`, type: 'book', siteName: 'Writers Book Studio' },
    twitter: { card: 'summary', title, description },
  };
}

export default function Page({ params }: { params: { id: string } }) {
  return <Reader id={params.id} />;
}
