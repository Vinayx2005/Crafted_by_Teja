import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE = 'https://dilse.craftedbyteja.com';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from('stories')
    .select('slug, published_at')
    .not('published_at', 'is', null);
  return [
    ...['', '/short-stories', '/books', '/author'].map((p) => ({ url: `${BASE}${p}` })),
    ...(data || []).map((s) => ({ url: `${BASE}/story/${s.slug}`, lastModified: s.published_at })),
  ];
}
