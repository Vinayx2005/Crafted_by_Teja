'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, RotateCcw, Shuffle, Trophy, X } from 'lucide-react';
import { GameHeader, buzzer, randInt } from '../GameShell';

type Phase = 'setup' | 'playing' | 'eliminated' | 'winner';

const CATEGORIES = ['Company names', 'Founder names', 'Startup terms'] as const;
type Category = (typeof CATEGORIES)[number];

const EXAMPLES: Record<Category, string> = {
  'Company names': 'Z → Zepto, Zerodha, Zomato',
  'Founder names': 'S → Steve Jobs, Sam Altman, Sachin Bansal',
  'Startup terms': 'B → Burn rate, Bootstrapping, Bridge round',
};

// Q and X are left out: too few company/founder/term options to be fair.
const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWYZ';

function newLetter(prev?: string) {
  let l;
  do l = LETTERS[randInt(LETTERS.length)];
  while (l === prev);
  return l;
}

const HOW_TO_PLAY = [
  'One admin runs the screen. Everyone else is one big team, standing in order.',
  'The screen shows a letter and a category, e.g. Z + Company names.',
  'Going in order, each player says a word from that category starting with the letter — Zepto, Zerodha, Zomato…',
  'The admin taps “Said it” to pass to the next player. Freeze until the buzzer (or say a wrong or repeated word) and you’re out.',
  'After each knock-out the letter changes, and the admin can switch the category or the time. Last one standing wins.',
];

const RULES = [
  'The word must fit the category and start with the letter on screen.',
  'No repeats within the same letter.',
  'Spelling doesn’t matter — the sound of the first letter does. The admin’s call is final.',
  'No help from other players. Prompting gets the prompter knocked out.',
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function LetterRush() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [players, setPlayers] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [out, setOut] = useState<boolean[]>([]);
  const [cur, setCur] = useState(0); // whose turn
  const [lastOut, setLastOut] = useState<number | null>(null);
  const [category, setCategory] = useState<Category>('Company names');
  const [seconds, setSeconds] = useState(5);
  const [letter, setLetter] = useState('Z');
  const [said, setSaid] = useState(0); // words said on the current letter
  const [left, setLeft] = useState(5);
  const dialog = useRef<HTMLDialogElement>(null);
  const endsAt = useRef(0);
  const pausedMs = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);

  // Next player still in the game after index `from` (wraps around).
  const nextActive = (from: number, o = out) => {
    for (let k = 1; k <= players.length; k++) {
      const i = (from + k) % players.length;
      if (!o[i]) return i;
    }
    return from;
  };

  function resetClock(s = seconds) {
    endsAt.current = Date.now() + s * 1000;
    setLeft(s);
  }

  function saidIt() {
    if (phase !== 'playing') return;
    setSaid((n) => n + 1);
    setCur(nextActive(cur));
    resetClock();
  }

  function knockOut() {
    if (phase !== 'playing') return;
    endsAt.current = Infinity; // stop the clock so a late tick can't knock out a second player
    const o = out.map((v, i) => v || i === cur);
    setOut(o);
    setLastOut(cur);
    if (o.filter((v) => !v).length <= 1) {
      setCur(o.findIndex((v) => !v));
      setPhase('winner');
      return;
    }
    setCur(nextActive(cur, o));
    setLetter((l) => newLetter(l));
    setPhase('eliminated');
  }

  // Countdown for the current player; buzzer + knock-out at zero. Paused while the help popup is open.
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => {
      if (dialog.current?.open) return;
      if (pausedMs.current !== null) {
        endsAt.current = Date.now() + pausedMs.current;
        pausedMs.current = null;
      }
      const s = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        buzzer(audio.current);
        knockOut();
      }
    }, 150);
    return () => clearInterval(id);
  });

  // Admin keys: → or Space = said it, ← = out.
  useEffect(() => {
    if (phase !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog.current?.open || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        saidIt();
      } else if (e.key === 'ArrowLeft') knockOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function start() {
    const names = players.map((p) => p.trim()).filter(Boolean);
    if (names.length < 2) return;
    audio.current ??= new AudioContext(); // unlocked by this tap so the buzzer can play later
    audio.current.resume();
    const s = clamp(seconds, 2, 60);
    setSeconds(s);
    setPlayers(names);
    setOut(names.map(() => false));
    setCur(0);
    setLastOut(null);
    setLetter(newLetter());
    setSaid(0);
    resetClock(s);
    setPhase('playing');
  }

  function resume() {
    const s = clamp(seconds, 2, 60);
    setSeconds(s);
    setSaid(0);
    resetClock(s);
    setPhase('playing');
  }

  const field = 'bg-18-bg border border-18-border rounded-xl px-3 py-2 text-white outline-none focus:border-18-orange/60';
  const chip = (on: boolean) =>
    `px-3 py-2 rounded-xl border text-sm ${on ? 'border-18-orange text-18-orange' : 'border-18-border text-white/70'}`;
  const remaining = out.filter((v) => !v).length;

  // Category + seconds pickers: on the setup screen, and again after every knock-out.
  const settings = (
    <>
      <div>
        <span className="text-xs text-white/50">Category</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={chip(category === c)}>
              {c}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/40 mt-1">e.g. {EXAMPLES[category]}</p>
      </div>
      <div>
        <span className="text-xs text-white/50">Seconds per person</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {[3, 5, 8, 10].map((s) => (
            <button key={s} onClick={() => setSeconds(s)} className={chip(seconds === s)}>
              {s}s
            </button>
          ))}
          <input
            type="number"
            min={2}
            max={60}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value) || 0)}
            onBlur={() => setSeconds((s) => clamp(s, 2, 60))}
            aria-label="Custom seconds per person"
            className={`${field} w-24`}
          />
        </div>
      </div>
    </>
  );

  const roster = (
    <ul className="flex flex-wrap gap-2 mt-6 justify-center">
      {players.map((p, i) => (
        <li
          key={i}
          className={`text-xs rounded-full px-3 py-1 border ${
            out[i]
              ? 'border-18-border text-white/30 line-through'
              : i === cur && phase === 'playing'
                ? 'border-18-orange text-18-orange'
                : 'border-18-border text-white/70'
          }`}
        >
          {p}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="max-w-[748px] mx-auto px-4 md:px-6 py-10 md:py-16">
      {/* 748px = 700px content + 2×24px padding */}
      <GameHeader
        title="Startup Letter Rush"
        howToPlay={HOW_TO_PLAY}
        rules={RULES}
        dialog={dialog}
        onOpen={() => {
          if (phase === 'playing') pausedMs.current = endsAt.current - Date.now();
        }}
      />

      {phase === 'setup' && (
        <>
          <p className="text-white/60 mb-8 leading-relaxed">
            One letter, one category, one big team. Take turns naming something that starts with the letter — freeze
            before the buzzer and you&apos;re out. Last one standing wins.
          </p>
          <div className="space-y-5 bg-18-surface border border-18-border rounded-2xl p-5">
            <div>
              <span className="text-xs text-white/50">Players (in turn order)</span>
              <div className="mt-1 space-y-2">
                {players.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={p}
                      onChange={(e) => setPlayers((ps) => ps.map((v, j) => (j === i ? e.target.value : v)))}
                      aria-label={`Player ${i + 1} name`}
                      className={`${field} flex-1`}
                    />
                    <button
                      aria-label={`Remove ${p}`}
                      disabled={players.length <= 2}
                      onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}
                      className="h-10 w-10 rounded-xl border border-18-border text-white/60 hover:text-white disabled:opacity-30 flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setPlayers((ps) => [...ps, `Player ${ps.length + 1}`])}
                  className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"
                >
                  <Plus size={14} /> Add player
                </button>
              </div>
            </div>
            {settings}
          </div>
          <button
            onClick={start}
            disabled={players.filter((p) => p.trim()).length < 2}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 disabled:opacity-40 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Start game
          </button>
        </>
      )}

      {phase === 'playing' && (
        <>
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="rounded-full border border-18-orange/50 text-18-orange px-3 py-1 text-xs font-bold">{category}</span>
            <span className="text-white/50">
              {remaining} left · {said} said
            </span>
          </div>
          <div className="rounded-3xl border-2 border-18-border bg-18-surface p-6 md:p-8 text-center">
            <p className="text-xs uppercase tracking-widest text-white/40">Starts with</p>
            <p className="text-[120px] md:text-[160px] leading-none font-black text-18-orange">{letter}</p>
            <p className="mt-4 text-xl md:text-2xl">
              <span className="font-black">{players[cur]}</span>
              <span className="text-white/50">, go!</span>
            </p>
            <p className={`text-4xl md:text-5xl font-black tabular-nums mt-2 ${left <= 2 ? 'text-red-400' : 'text-white'}`}>{left}s</p>
            <p className="text-xs text-white/40 mt-2">Next up: {players[nextActive(cur)]}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              onClick={knockOut}
              className="flex items-center justify-center gap-2 rounded-2xl py-4 border border-red-400/40 text-red-300 hover:bg-red-500/10"
            >
              <X size={18} /> Out
            </button>
            <button
              onClick={saidIt}
              className="flex items-center justify-center gap-2 rounded-2xl py-4 bg-emerald-500/90 hover:bg-emerald-500 text-white font-bold"
            >
              <Check size={18} /> Said it
            </button>
          </div>
          <p className="text-xs text-white/40 text-center mt-3">Admin: Said it (→ / Space) passes the turn. Out (←) for a wrong or repeated word.</p>
          {roster}
        </>
      )}

      {phase === 'eliminated' && lastOut !== null && (
        <div className="bg-18-surface border border-18-border rounded-2xl p-6">
          <p className="text-center text-red-300 font-bold">Knocked out</p>
          <p className="text-center text-3xl font-black mt-1 line-through decoration-red-400/70">{players[lastOut]}</p>
          <p className="text-center text-white/50 text-sm mt-1">{remaining} players left</p>

          <div className="mt-6 space-y-5 border-t border-18-border pt-5">
            <p className="text-xs text-white/50 -mb-2">Admin: change anything for the next round</p>
            <div>
              <span className="text-xs text-white/50">New letter</span>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-5xl font-black text-18-orange w-14 text-center">{letter}</span>
                <button
                  onClick={() => setLetter((l) => newLetter(l))}
                  className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white border border-18-border rounded-xl px-3 py-2"
                >
                  <Shuffle size={14} /> Another letter
                </button>
              </div>
            </div>
            {settings}
          </div>

          <button
            onClick={resume}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Continue — {players[cur]} starts with {letter}
          </button>
          {roster}
        </div>
      )}

      {phase === 'winner' && (
        <div className="text-center bg-18-surface border border-18-orange/40 rounded-2xl p-8">
          <Trophy size={40} className="mx-auto text-18-orange" />
          <p className="text-white/60 mt-4">Last one standing</p>
          <p className="text-3xl md:text-4xl font-black text-18-orange mt-1">{players[cur]}</p>
          <button
            onClick={() => setPhase('setup')}
            className="mt-8 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors inline-flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} /> Play again
          </button>
          {roster}
        </div>
      )}
    </div>
  );
}
