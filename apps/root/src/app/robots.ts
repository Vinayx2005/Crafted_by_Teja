import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    // Subdomain sitemaps listed here too; fine for Google since the craftedbyteja.com Domain property covers them.
    sitemap: ['https://www.craftedbyteja.com/sitemap.xml', 'https://games.craftedbyteja.com/sitemap.xml'],
  };
}
