import type { MetadataRoute } from 'next';
import { GAMES } from './games';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://games.craftedbyteja.com' },
    ...GAMES.filter((g) => g.live).map((g) => ({ url: `https://games.craftedbyteja.com/${g.slug}` })),
  ];
}
