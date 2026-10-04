import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Who Am I? · Founder Games',
  description: 'You are the famous founder on screen — your team describes you, the other team heckles. Guess who you are before the buzzer.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
