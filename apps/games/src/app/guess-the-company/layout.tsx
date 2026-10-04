import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guess The Company · Founder Games',
  description: 'Dumb charades for founders: one player guesses the company from their team’s clues while the other team heckles. Swipe right if guessed, left to skip.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
