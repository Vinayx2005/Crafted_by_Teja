import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pitch Taboo · Founder Games',
  description: 'Logo colour + core job + taboo word = ? Guess the company from three clues before the clock runs out.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
