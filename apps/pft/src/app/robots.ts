import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard'] },
    sitemap: 'https://pft.craftedbyteja.com/sitemap.xml',
  };
}
