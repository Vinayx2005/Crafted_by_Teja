import { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

// One source of truth for <head>. Manual <title>/<meta> tags in the
// JSX below caused link previews (WhatsApp, Slack, etc.) to show a
// mashup of both titles — everything from the first <title> tag to
// the last </title> tag ended up in the OG title. Keep this file the
// only place title/meta live.
export const metadata: Metadata = {
  metadataBase: new URL('https://pft.craftedbyteja.com'),
  title: 'Personal FT — Know where your money goes',
  description: 'A finance tracker that finds your leaks and helps you feel calm about money.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Personal FT',
  },
  openGraph: {
    // Preview image is auto-picked up from src/app/opengraph-image.tsx
    // (a dynamic 1200×630 orange PFT card). Do NOT set images here or
    // Next.js will render both, and the wrong one may win the scrape.
    title: 'Personal FT — Know where your money goes',
    description: 'A finance tracker that finds your leaks and helps you feel calm about money.',
    url: 'https://pft.craftedbyteja.com',
    siteName: 'Personal FT',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Personal FT — Know where your money goes',
    description: 'A finance tracker that finds your leaks and helps you feel calm about money.',
  },
};

export const viewport = {
  themeColor: '#F37335',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-lato bg-18-bg">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
