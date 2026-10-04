import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Icebreaker Games for Founders · Crafted by Teja',
  description: 'Quick, free icebreaker games for entrepreneurs. Play in person or virtually — right in the browser.',
  metadataBase: new URL('https://games.craftedbyteja.com'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-18-border/60 bg-18-bg/80 backdrop-blur-sm sticky top-0 z-20">
            <nav className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
              <a href="/" className="flex items-center gap-2 group">
                <div className="bg-18-orange h-7 w-7 rounded-full flex items-center justify-center shadow-[0_0_18px_-4px_rgba(243,115,53,0.6)]">
                  <span className="text-white font-bold text-[10px]">CBT</span>
                </div>
                <span className="font-bold text-sm">Games · Crafted by Teja</span>
              </a>
              <a href="https://craftedbyteja.com" className="text-sm text-white/70 hover:text-white transition-colors">
                ← Home
              </a>
            </nav>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="border-t border-18-border/60 mt-16">
            <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 text-xs text-white/40 text-center">
              © {new Date().getFullYear()} Teja Surishetti · <a href="https://craftedbyteja.com" className="hover:text-white">craftedbyteja.com</a>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
