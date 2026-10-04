import { Ban, Building2, Shuffle, Type, UserRound, type LucideIcon } from 'lucide-react';

export type Mode = 'In person' | 'Virtual' | 'Solo';

export type Game = {
  slug: string; // served at /<slug> from src/app/<slug>/page.tsx
  title: string;
  tagline: string;
  players: string;
  minutes: number;
  modes: Mode[];
  icon: LucideIcon;
  accent: string;
  live: boolean; // false = "Coming soon" card, not clickable
};

// Add a game: one entry here + one folder at src/app/<slug>/, then flip live.
export const GAMES: Game[] = [
  {
    slug: 'guess-the-company',
    title: 'Guess The Company',
    tagline: 'Dumb charades for founders. Your team gives clues, the other team heckles. Swipe right if guessed.',
    players: '4+',
    minutes: 15,
    modes: ['In person'],
    icon: Building2,
    accent: 'from-cyan-500 to-blue-600',
    live: true,
  },
  {
    slug: 'who-am-i',
    title: 'Who Am I?',
    tagline: 'You’re the famous founder on screen. Your team describes you, the other team heckles. Guess who you are.',
    players: '4+',
    minutes: 15,
    modes: ['In person'],
    icon: UserRound,
    accent: 'from-fuchsia-500 to-pink-600',
    live: true,
  },
  {
    slug: 'pitch-taboo',
    title: 'Pitch Taboo',
    tagline: 'Logo colour + core job + taboo word = ? Every team races on the same card. First to crack it scores.',
    players: '3+',
    minutes: 10,
    modes: ['In person', 'Virtual'],
    icon: Ban,
    accent: 'from-red-500 to-rose-600',
    live: true,
  },
  {
    slug: 'letter-rush',
    title: 'Startup Letter Rush',
    tagline: 'One letter, one category, one big team. Name a company, founder or startup term before the buzzer — or you’re out.',
    players: '3+',
    minutes: 10,
    modes: ['In person', 'Virtual'],
    icon: Type,
    accent: 'from-amber-500 to-orange-600',
    live: true,
  },
  {
    slug: 'pivot-chain',
    title: 'Pivot Chain',
    tagline: 'Pivot a real company, one player at a time, against the clock. A mentor picks the winning idea.',
    players: '2+',
    minutes: 10,
    modes: ['In person', 'Virtual'],
    icon: Shuffle,
    accent: 'from-violet-500 to-indigo-600',
    live: false,
  },
];
