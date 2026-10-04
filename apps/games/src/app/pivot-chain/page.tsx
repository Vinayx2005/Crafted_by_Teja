'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Shuffle, Trophy } from 'lucide-react';
import { GameHeader, buzzer, randInt } from '../GameShell';
import { COMPANIES } from '../guess-the-company/companies';

type Phase = 'setup' | 'playing' | 'mentor' | 'winner';
type Link = { player: string; idea: string; froze: boolean };

const HOW_TO_PLAY = [
  'Pick a mentor (judge) and line up the players.',
  'The game starts from a real company. The first player pivots it into a new idea before the timer runs out.',
  'The host types each pivot and locks it in. The next player pivots that idea, and so on down the line.',
  'Freeze until the buzzer and you miss your turn — the chain carries on from the last idea.',
  'At the end the mentor reviews the whole chain and picks the best idea. That player wins.',
];

const RULES = [
  'Each pivot must build on the idea right before it, not the original company.',
  'One idea per turn — say it out loud, the host types it.',
  'No repeating an idea already in the chain.',
  'The mentor’s pick is final.',
];

const pick = () => COMPANIES[randInt(COMPANIES.length)];

export default function PivotChain() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [players, setPlayers] = useState(['Player 1', 'Player 2', 'Player 3']);
  const [seconds, setSeconds] = useState(20);
  const [rounds, setRounds] = useState(1);
  const [seed, setSeed] = useState('Uber'); // replaced with a random company after mount (avoids hydration mismatch)
  const [chain, setChain] = useState<Link[]>([]);
  const [draft, setDraft] = useState('');
  const [left, setLeft] = useState(20);
  const [winner, setWinner] = useState<Link | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const endsAt = useRef(0);
  const pausedMs = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setSeed(pick()), []);

  const total = players.length * rounds;
  const step = chain.length; // pivots done so far
  const current = players[step % players.length];
  const lastIdea = [...chain].reverse().find((l) => !l.froze)?.idea ?? seed;

  function advance(link: Link) {
    const next = [...chain, link];
    setChain(next);
    setDraft('');
    if (next.length >= total) {
      endsAt.current = Infinity; // stop the clock so a late tick can't log another "froze"
      setPhase('mentor');
    } else {
      endsAt.current = Date.now() + seconds * 1000;
      setLeft(seconds);
      input.current?.focus();
    }
  }

  // Countdown for the current player; buzzer + "froze" when it hits zero. Paused while the help popup is open.
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
        advance({ player: current, idea: '', froze: true });
      }
    }, 200);
    return () => clearInterval(id);
  });

  function start() {
    const names = players.map((p) => p.trim()).filter(Boolean);
    if (names.length < 2 || !seed.trim()) return;
    audio.current ??= new AudioContext(); // unlocked by this tap so the buzzer can play later
    audio.current.resume();
    setPlayers(names);
    setSeconds((s) => Math.max(5, Math.min(300, s)));
    setChain([]);
    setDraft('');
    setWinner(null);
    endsAt.current = Date.now() + Math.max(5, Math.min(300, seconds)) * 1000;
    setLeft(seconds);
    setPhase('playing');
  }

  const btn = 'w-full bg-18-orange hover:bg-orange-600 disabled:opacity-40 text-white font-bold rounded-2xl py-4 transition-colors';
  const field = 'bg-18-bg border border-18-border rounded-xl px-3 py-2 text-white outline-none focus:border-18-orange/60';

  return (
    <div className="max-w-[748px] mx-auto px-4 md:px-6 py-10 md:py-16">
      {/* 748px = 700px content + 2×24px padding */}
      <GameHeader
        title="Pivot Chain"
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
            Start from a real company and pivot it, one player at a time, against the clock. At the end a mentor picks
            the best idea in the chain — that player wins.
          </p>
          <div className="space-y-5 bg-18-surface border border-18-border rounded-2xl p-5">
            <div>
              <span className="text-xs text-white/50">Players (in order)</span>
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

            <label className="block">
              <span className="text-xs text-white/50">Starting company</span>
              <div className="mt-1 flex gap-2">
                <input value={seed} onChange={(e) => setSeed(e.target.value)} className={`${field} flex-1`} />
                <button
                  onClick={() => setSeed(pick())}
                  aria-label="Random company"
                  className="h-10 w-10 rounded-xl border border-18-border text-white/60 hover:text-white flex items-center justify-center"
                >
                  <Shuffle size={14} />
                </button>
              </div>
            </label>

            <div>
              <span className="text-xs text-white/50">Seconds per pivot</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {[10, 20, 30].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeconds(s)}
                    className={`px-3 py-2 rounded-xl border text-sm ${seconds === s ? 'border-18-orange text-18-orange' : 'border-18-border text-white/70'}`}
                  >
                    {s}s
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value) || 0)}
                  onBlur={() => setSeconds((s) => Math.max(5, Math.min(300, s)))}
                  aria-label="Custom seconds per pivot"
                  className={`${field} w-24`}
                />
              </div>
            </div>

            <div>
              <span className="text-xs text-white/50">Rounds (pivots per player)</span>
              <div className="mt-1 flex gap-2">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRounds(r)}
                    className={`px-4 py-2 rounded-xl border text-sm ${rounds === r ? 'border-18-orange text-18-orange' : 'border-18-border text-white/70'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button onClick={start} disabled={players.filter((p) => p.trim()).length < 2 || !seed.trim()} className={`${btn} mt-6`}>
            Start the chain
          </button>
        </>
      )}

      {phase === 'playing' && (
        <>
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-white/50">
              Pivot {step + 1} of {total}
            </span>
            <span className={`text-2xl font-black tabular-nums ${left <= 5 ? 'text-red-400' : 'text-white'}`}>{left}s</span>
          </div>
          <div className="rounded-3xl border-2 border-18-border bg-18-surface p-6 md:p-8 text-center">
            <p className="text-xs uppercase tracking-widest text-white/40">{step === 0 ? 'Starting company' : 'Pivot this'}</p>
            <p className="text-3xl md:text-5xl font-black tracking-tight mt-2 break-words">{lastIdea}</p>
            <p className="mt-6 text-white/60">
              <span className="text-18-orange font-bold">{current}</span>, your pivot?
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) advance({ player: current, idea: draft.trim(), froze: false });
            }}
            className="mt-4 flex gap-2"
          >
            <input
              ref={input}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type their pivot, e.g. “Uber for dog walkers”"
              aria-label={`${current}'s pivot`}
              className={`${field} flex-1 py-3`}
            />
            <button disabled={!draft.trim()} className="bg-18-orange hover:bg-orange-600 disabled:opacity-40 text-white font-bold rounded-xl px-5">
              Lock in
            </button>
          </form>
          {chain.length > 0 && (
            <ol className="mt-6 space-y-1 text-sm text-white/50">
              {chain.map((l, i) => (
                <li key={i}>
                  <span className="text-white/70">{l.player}:</span> {l.froze ? <i className="text-red-400/70">froze</i> : l.idea}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {phase === 'mentor' && (
        <div className="bg-18-surface border border-18-border rounded-2xl p-6">
          <p className="text-center text-white/60">The chain is done</p>
          <p className="text-center text-2xl font-black mt-1">Mentor, pick the best idea</p>
          <ol className="mt-6 space-y-2">
            <li className="text-sm text-white/40 px-4">
              Started from <span className="text-white/70 font-semibold">{seed}</span>
            </li>
            {chain.map((l, i) =>
              l.froze ? (
                <li key={i} className="text-sm text-white/30 px-4">
                  {l.player} froze
                </li>
              ) : (
                <li key={i}>
                  <button
                    onClick={() => {
                      setWinner(l);
                      setPhase('winner');
                    }}
                    className="w-full text-left rounded-xl border border-18-border hover:border-18-orange/60 hover:bg-18-orange/5 px-4 py-3 transition-colors"
                  >
                    <span className="block text-xs text-white/50">{l.player}</span>
                    <span className="text-white font-semibold">{l.idea}</span>
                  </button>
                </li>
              ),
            )}
          </ol>
          {chain.every((l) => l.froze) && (
            <p className="text-center text-sm text-white/50 mt-4">Everyone froze — no winner this time.</p>
          )}
          <button onClick={() => setPhase('setup')} className="mt-6 w-full text-xs text-white/40 hover:text-white inline-flex items-center justify-center gap-1">
            <RotateCcw size={12} /> New game
          </button>
        </div>
      )}

      {phase === 'winner' && winner && (
        <div className="text-center bg-18-surface border border-18-orange/40 rounded-2xl p-8">
          <Trophy size={40} className="mx-auto text-18-orange" />
          <p className="text-white/60 mt-4">The mentor picked</p>
          <p className="text-2xl md:text-3xl font-black mt-1 break-words">“{winner.idea}”</p>
          <p className="mt-4 text-lg">
            <span className="text-18-orange font-black">{winner.player}</span> wins!
          </p>
          <button
            onClick={() => {
              setSeed(pick());
              setPhase('setup');
            }}
            className={`${btn} mt-8`}
          >
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
