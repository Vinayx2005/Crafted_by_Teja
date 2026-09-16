import type { Metadata } from 'next';
import { Navbar } from './Navbar';
import './globals.css';

export const metadata: Metadata = {
  title: 'DILSe · Stories by Teja Surishetti',
  description: 'Short stories, essays, and books by Teja Surishetti — written from the heart, in Telugu and English.',
  metadataBase: new URL('https://dilse.craftedbyteja.com'),
  openGraph: {
    // Preview image auto-picked from src/app/opengraph-image.png.
    title: 'DILSe · Stories by Teja Surishetti',
    description: 'The essence of my memories and beliefs.',
    url: 'https://dilse.craftedbyteja.com',
    siteName: 'DILSe',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DILSe · Stories by Teja Surishetti',
    description: 'The essence of my memories and beliefs.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col bg-white text-black">
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="bg-black text-white py-16">
            <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8 max-w-7xl">
              <div className="text-center md:text-left">
                <a href="/" className="text-3xl font-bold tracking-tight inline-block mb-4">DILSe</a>
                <p className="text-gray-400">
                  Handcrafted with love! © {new Date().getFullYear()} dilsestories.in | All rights reserved
                </p>
              </div>
              <div className="text-center md:text-right text-gray-400">
                <a href="mailto:hello@dilse.craftedbyteja.com" className="hover:text-white transition-colors">
                  hello@dilse.craftedbyteja.com
                </a>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
