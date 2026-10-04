'use client';

import { useState } from 'react';
import { ArrowRight, Clock, Search, Users } from 'lucide-react';
import { GAMES } from './games';

export default function GamesPage() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const games = GAMES.filter((g) =>
    [g.title, g.tagline, ...g.modes].join(' ').toLowerCase().includes(needle),
  );

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16 md:py-24">
      <section className="mb-14">
        <p className="text-xs font-bold uppercase tracking-widest text-18-orange mb-4">Icebreakers for founders</p>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white leading-[1.05] mb-6">
          Break the ice,{' '}
          <span className="text-18-orange">and melt.</span>
        </h1>
        <p className="text-lg text-white/70 leading-relaxed max-w-2xl">
          Quick browser games built for entrepreneurs. Play at a meetup or virtually over a video call. No sign-up.
        </p>
      </section>

      <label className="relative block mb-4">
        <span className="sr-only">Search games</span>
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search games — try “pitch” or “Virtual”"
          className="w-full bg-18-surface border border-18-border rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-18-orange/60 transition-colors"
        />
      </label>

      {games.length === 0 && (
        <p className="text-sm text-white/50 text-center py-12">No games match “{q}”.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {games.map((g) => {
          const Icon = g.icon;
          const card = (
            <div className="flex flex-col h-full">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${g.accent} flex items-center justify-center shrink-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]`}>
                  <Icon size={22} className="text-white" />
                </div>
                {g.live ? (
                  <ArrowRight size={16} className="text-white/30 group-hover:text-18-orange group-hover:translate-x-0.5 transition-all mt-1" />
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 bg-white/5 border border-18-border rounded-full px-2 py-0.5">
                    Coming soon
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white">{g.title}</h2>
              <p className="text-sm text-white/60 mt-1 leading-relaxed flex-1">{g.tagline}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs text-white/50">
                <span className="flex items-center gap-1"><Users size={13} /> {g.players}</span>
                <span className="flex items-center gap-1"><Clock size={13} /> {g.minutes} min</span>
                <span className="flex flex-wrap gap-1">
                  {g.modes.map((m) => (
                    <span key={m} className="rounded-full border border-18-border px-2 py-0.5">{m}</span>
                  ))}
                </span>
              </div>
            </div>
          );
          const cls = 'group block bg-18-surface border border-18-border rounded-2xl p-5 transition-all';
          return g.live ? (
            <a key={g.slug} href={`/${g.slug}`} className={`${cls} hover:border-18-orange/40 hover:-translate-y-0.5`}>
              {card}
            </a>
          ) : (
            <div key={g.slug} className={`${cls} opacity-70`}>{card}</div>
          );
        })}
      </div>

      <p className="text-xs text-white/40 mt-12 text-center">
        New games drop regularly. Follow along at{' '}
        <a href="https://craftedbyteja.com" className="text-18-orange hover:underline">craftedbyteja.com</a>.
      </p>
    </div>
  );
}
