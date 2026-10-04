import type { Metadata } from 'next';
import './common.css';

const TITLE = 'Writers Book Studio';
const DESCRIPTION = 'Write your book chapter by chapter and watch it take shape in a live A5 preview with real page turns. Covers, page numbers, running headers, Indian-language translation and PDF / Word export.';

export const metadata: Metadata = {
  metadataBase: new URL('https://writer.craftedbyteja.com'),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  // link previews (WhatsApp, LinkedIn, X, iMessage…)
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/', siteName: TITLE, type: 'website' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

// Applies the cached theme before first paint so there's no light/dark flash;
// src/lib/common.js takes over once the account's choice has loaded.
const THEME_SCRIPT = `document.documentElement.dataset.theme = (() => { try { return localStorage.getItem('writer_theme'); } catch {} })() || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
