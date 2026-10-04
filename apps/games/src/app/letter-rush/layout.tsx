import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Startup Letter Rush · Founder Games',
  description: 'One letter, one category, one big team. Name a company, founder or startup term before the buzzer — or you’re out.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
