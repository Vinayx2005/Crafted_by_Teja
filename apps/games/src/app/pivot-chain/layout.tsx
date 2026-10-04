import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pivot Chain · Founder Games',
  description: 'Pivot a real company, one player at a time, against the clock. A mentor picks the best idea in the chain.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
