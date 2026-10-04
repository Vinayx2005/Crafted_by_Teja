'use client';

// Bits every game page shares: header with How to play / Rules popup, buzzer, shuffle.

import { useEffect, useState, type RefObject } from 'react';
import { BookOpen, Info } from 'lucide-react';

// Uniform random int in [0, n) from the crypto RNG (modulo bias is ~n/2^32 — negligible for deck sizes).
export function randInt(n: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

// Fisher–Yates: every order equally likely. If `last` is given (the card just shown before a reshuffle),
// it won't come up first again.
export function shuffle<T>(a: T[], last?: T): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  if (last !== undefined && b.length > 1 && b[0] === last) [b[0], b[1]] = [b[1], b[0]];
  return b;
}

// Game-show "time's up" buzzer: three quick low square-wave blasts, no audio file needed.
// Pass an AudioContext created during a tap (browsers block audio that wasn't unlocked by the user).
export function buzzer(ctx: AudioContext | null) {
  navigator.vibrate?.([200, 100, 200, 100, 400]);
  if (!ctx) return;
  [0, 0.25, 0.5].forEach((at, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 180;
    const t = ctx.currentTime + at;
    const len = i === 2 ? 0.5 : 0.18;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len);
  });
}

type Help = 'all' | 'how' | 'rules';

// Back link, title, How to play / Rules buttons and their popup. The popup opens once per page load.
// Games pause their clock while `dialog.current.open` is true; `onOpen` lets them snapshot the time left.
export function GameHeader({
  title,
  howToPlay,
  rules,
  dialog,
  onOpen,
}: {
  title: string;
  howToPlay: string[];
  rules: string[];
  dialog: RefObject<HTMLDialogElement>;
  onOpen?: () => void;
}) {
  const [help, setHelp] = useState<Help>('all');

  function openHelp(h: Help) {
    setHelp(h);
    if (dialog.current?.open) return;
    onOpen?.();
    dialog.current?.showModal();
  }

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [dialog]);

  return (
    <>
      <a href="/" className="text-xs text-white/50 hover:text-white">← All games</a>
      <h1 className="text-3xl md:text-5xl font-black tracking-tight mt-3 mb-2">{title}</h1>
      <div className="flex gap-2 mb-4">
        {(
          [
            ['how', 'How to play', Info],
            ['rules', 'Rules', BookOpen],
          ] as const
        ).map(([h, text, Icon]) => (
          <button
            key={h}
            onClick={() => openHelp(h)}
            className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white border border-18-border hover:border-18-orange/50 rounded-full px-3 py-1.5 transition-colors"
          >
            <Icon size={13} /> {text}
          </button>
        ))}
      </div>

      <dialog
        ref={dialog}
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()} // click on backdrop closes
        className="bg-18-surface text-white border border-18-border rounded-2xl p-0 w-[calc(100%-32px)] max-w-md backdrop:bg-black/70"
      >
        <div className="p-6 space-y-6">
          {help !== 'rules' && (
            <section>
              <h2 className="text-lg font-black mb-3">How to play</h2>
              <ol className="space-y-2 text-sm text-white/75 list-decimal pl-5">
                {howToPlay.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </section>
          )}
          {help !== 'how' && (
            <section>
              <h2 className="text-lg font-black mb-3">Rules</h2>
              <ol className="space-y-2 text-sm text-white/75 list-decimal pl-5">
                {rules.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </section>
          )}
          <form method="dialog">
            <button className="w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-xl py-3 transition-colors">
              Got it
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
