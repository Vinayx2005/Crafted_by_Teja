import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE = 'https://pft.craftedbyteja.com';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .schema('blog')
    .from('posts')
    .select('slug, published_at')
    .eq('site', 'pft')
    .not('published_at', 'is', null);
  return [
    ...['', '/blogs', '/contact', '/privacy', '/terms'].map((p) => ({ url: `${BASE}${p}` })),
    ...(data || []).map((p) => ({ url: `${BASE}/blogs/${p.slug}`, lastModified: p.published_at })),
  ];
}
