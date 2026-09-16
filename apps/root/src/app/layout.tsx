import type { Metadata } from 'next';
import Link from 'next/link';
import { Twitter, Linkedin, Instagram } from 'lucide-react';

const WHATSAPP = 'https://wa.me/918886956636';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crafted by Teja',
  description: 'Builder, writer, explorer. Ideas, tools and thoughts for a more intentional life.',
  metadataBase: new URL('https://craftedbyteja.com'),
  openGraph: {
    // Preview image auto-picked from src/app/opengraph-image.jpg (teja.jpg).
    title: 'Crafted by Teja',
    description: 'Builder, writer, explorer. Ideas, tools and thoughts for a more intentional life.',
    url: 'https://craftedbyteja.com',
    siteName: 'Crafted by Teja',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Crafted by Teja',
    description: 'Builder, writer, explorer. Ideas, tools and thoughts for a more intentional life.',
  },
};

const NAV = [
  { label: 'Home',    href: '/' },
  { label: 'About',   href: '/#about' },   // "A little about me"
  { label: 'Work',    href: '/#build' },   // "What I do today"
  { label: 'Writing', href: '/#writing' },
  { label: 'Tools',   href: '/#work' },    // the tech projects grid
  { label: 'Contact', href: '/#contact' },
];

const SOCIALS = [
  { label: 'X', href: 'https://x.com/tejasurishetti', icon: Twitter },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/surishettiteja/', icon: Linkedin },
  { label: 'Instagram', href: 'https://www.instagram.com/tejasurishetti/', icon: Instagram },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Caveat:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="sticky top-0 z-30 bg-paper/85 backdrop-blur-md">
            <nav className="max-w-6xl mx-auto px-5 md:px-8 h-[72px] flex items-center justify-between">
              <Link href="/" className="text-xl font-black tracking-tight py-2">ST</Link>

              <div className="hidden md:flex items-center gap-8 text-[13px] text-ink2">
                {NAV.map((n) => (
                  <Link key={n.label} href={n.href} className="hover:text-ink transition-colors">
                    {n.label}
                  </Link>
                ))}
              </div>

              <a
                href={WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-ink text-white text-[13px] font-medium px-5 py-2.5 hover:bg-ink2 transition-colors whitespace-nowrap"
              >
                Let&apos;s Connect →
              </a>
            </nav>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="border-t border-line">
            <div className="max-w-6xl mx-auto px-5 md:px-8 py-7 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-xl font-black tracking-tight">ST</span>
                <a
                  href="mailto:hello@craftedbyteja.com"
                  className="py-2 text-[13px] text-muted hover:text-ink transition-colors"
                >
                  hello@craftedbyteja.com
                </a>
              </div>
              <div className="flex items-center gap-5 text-ink">
                {SOCIALS.map((s) => (
                  <a key={s.label} href={s.href} aria-label={s.label} className="p-2 -m-2 text-ink/70 hover:text-ink transition-colors">
                    <s.icon size={17} />
                  </a>
                ))}
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
