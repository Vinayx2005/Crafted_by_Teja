import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE = 'https://www.craftedbyteja.com';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from('posts')
    .select('slug, published_at')
    .eq('site', 'root')
    .not('published_at', 'is', null);
  return [
    { url: BASE },
    { url: `${BASE}/blog` },
    ...(data || []).map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastModified: p.published_at })),
  ];
}
