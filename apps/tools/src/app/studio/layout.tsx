import type { Metadata } from 'next';
import { Suspense } from 'react';
import Shell from './shell';

// A private team tool (Content Studio, production): keep it out of search results.
export const metadata: Metadata = {
  title: 'Content Studio · Crafted by Teja',
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  // The shell reads the URL (current brand and section), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
