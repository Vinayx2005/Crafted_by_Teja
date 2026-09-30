import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://tools.craftedbyteja.com' },
    { url: 'https://tools.craftedbyteja.com/name-picker' },
  ];
}
