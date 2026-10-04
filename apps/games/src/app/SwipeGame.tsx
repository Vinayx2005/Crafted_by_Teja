'use client';

// Shared engine for the team charades games (Guess The Company, Who Am I?):
// two teams, timed turns, swipe right = guessed / left = skip, buzzer, scoreboard, how-to/rules popup.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { GameHeader, buzzer, shuffle } from './GameShell';

type Phase = 'setup' | 'ready' | 'playing' | 'turnover';

const SWIPE_PX = 100;

type Props<T> = {
  title: string;
  intro: ReactNode;
  howToPlay: string[];
  rules: string[];
  items: T[];
  label: (item: T) => string; // shown in the end-of-turn results list
  renderCard: (item: T) => ReactNode;
};

export default function SwipeGame<T>({ title, intro, howToPlay, rules, items, label, renderCard }: Props<T>) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [teams, setTeams] = useState(['Team A', 'Team B']);
  const [scores, setScores] = useState([0, 0]);
  const [turn, setTurn] = useState(0); // index of the team currently guessing
  const [seconds, setSeconds] = useState(60);
  const [left, setLeft] = useState(60);
  const [deck, setDeck] = useState<T[]>([]);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<{ item: T; ok: boolean }[]>([]);
  const [dx, setDx] = useState(0);
  const [played, setPlayed] = useState(false); // scoreboard shows only once a turn has finished
  const startX = useRef<number | null>(null);
  const endsAt = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pausedMs = useRef<number | null>(null); // time left on the clock while the popup is open mid-turn

  const card = deck[pos];

  // Countdown
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => {
      // Popup open = clock paused. Checked here rather than via the dialog's 'close' event, which isn't fired reliably.
      if (dialog.current?.open) return;
      if (pausedMs.current !== null) {
        endsAt.current = Date.now() + pausedMs.current;
        pausedMs.current = null;
      }
      const s = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(id);
        buzzer(audio.current);
        setPhase('turnover');
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  function next(ok: boolean) {
    if (phase !== 'playing' || card === undefined) return;
    setResults((r) => [...r, { item: card, ok }]);
    if (ok) setScores((s) => s.map((v, i) => (i === turn ? v + 1 : v)));
    if (pos + 1 >= deck.length) {
      // Deck exhausted: reshuffle (never starting with the card just shown) and keep going.
      setDeck(shuffle(items, card));
      setPos(0);
    } else {
      setPos(pos + 1);
    }
    setDx(0);
  }

  // Keyboard: → guessed, ← skip (handy when screen-sharing on a video call)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog.current?.open) return;
      if (e.key === 'ArrowRight') next(true);
      if (e.key === 'ArrowLeft') next(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function startGame() {
    setSeconds((s) => Math.max(5, Math.min(600, s)));
    setScores([0, 0]);
    setPlayed(false);
    setTurn(0);
    setDeck(shuffle(items));
    setPos(0);
    setPhase('ready');
  }

  function startTurn() {
    // Browsers only allow audio that was unlocked by a tap, so create/resume it here.
    audio.current ??= new AudioContext();
    audio.current.resume();
    setResults([]);
    setLeft(seconds);
    endsAt.current = Date.now() + seconds * 1000;
    setPhase('playing');
  }

  function nextTeam() {
    setPlayed(true);
    setTurn((t) => 1 - t);
    setPhase('ready');
  }

  const scoreboard = (
    <div className="grid grid-cols-2 gap-3 mb-6">
      {teams.map((t, i) => (
        <div
          key={i}
          className={`bg-18-surface border rounded-2xl p-4 ${i === turn && phase !== 'setup' ? 'border-18-orange/60' : 'border-18-border'}`}
        >
          <p className="text-xs text-white/50 truncate">
            {t} {i === turn && phase !== 'setup' && <span className="text-18-orange">· guessing</span>}
          </p>
          <div className="flex items-center justify-between mt-1">
            <button
              aria-label={`Take a point from ${t}`}
              onClick={() => setScores((s) => s.map((v, j) => (j === i ? v - 1 : v)))}
              className="h-8 w-8 rounded-full border border-18-border text-white/60 hover:text-white flex items-center justify-center"
            >
              <Minus size={14} />
            </button>
            <span className="text-4xl font-black tabular-nums">{scores[i]}</span>
            <button
              aria-label={`Give a point to ${t}`}
              onClick={() => setScores((s) => s.map((v, j) => (j === i ? v + 1 : v)))}
              className="h-8 w-8 rounded-full border border-18-border text-white/60 hover:text-white flex items-center justify-center"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-[748px] mx-auto px-4 md:px-6 py-10 md:py-16">
      {/* 748px = 700px content + 2×24px padding */}
      <GameHeader
        title={title}
        howToPlay={howToPlay}
        rules={rules}
        dialog={dialog}
        onOpen={() => {
          if (phase === 'playing') pausedMs.current = endsAt.current - Date.now();
        }}
      />

      {phase === 'setup' && (
        <>
          <p className="text-white/60 mb-8 leading-relaxed">{intro}</p>
          <div className="space-y-4 bg-18-surface border border-18-border rounded-2xl p-5">
            {teams.map((t, i) => (
              <label key={i} className="block">
                <span className="text-xs text-white/50">Team {i + 1} name</span>
                <input
                  value={t}
                  onChange={(e) => setTeams((ts) => ts.map((v, j) => (j === i ? e.target.value : v)))}
                  className="mt-1 w-full bg-18-bg border border-18-border rounded-xl px-3 py-2 text-white outline-none focus:border-18-orange/60"
                />
              </label>
            ))}
            <div>
              <span className="text-xs text-white/50">Seconds per turn</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {[30, 60, 90, 120].map((s) => (
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
                  max={600}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value) || 0)}
                  onBlur={() => setSeconds((s) => Math.max(5, Math.min(600, s)))}
                  aria-label="Custom seconds per turn"
                  className="w-24 bg-18-bg border border-18-border rounded-xl px-3 py-2 text-white outline-none focus:border-18-orange/60"
                />
              </div>
            </div>
          </div>
          <button
            onClick={startGame}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Start game
          </button>
        </>
      )}

      {(phase === 'turnover' || (phase === 'ready' && played)) && <div className="mt-6">{scoreboard}</div>}

      {phase === 'ready' && (
        <div className="text-center bg-18-surface border border-18-border rounded-2xl p-8">
          <p className="text-white/60">Up next</p>
          <p className="text-3xl font-black text-18-orange mt-1">{teams[turn]}</p>
          <p className="text-sm text-white/50 mt-3">
            Pick a guesser and turn them away from the screen. Everyone else can see the card.
          </p>
          <button
            onClick={startTurn}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Start {seconds}s turn
          </button>
          <button onClick={() => setPhase('setup')} className="mt-4 text-xs text-white/40 hover:text-white inline-flex items-center gap-1">
            <RotateCcw size={12} /> New game
          </button>
        </div>
      )}

      {phase === 'playing' && card !== undefined && (
        <>
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-white/50">
              {results.filter((r) => r.ok).length} guessed · {results.filter((r) => !r.ok).length} skipped
            </span>
            <span className={`text-2xl font-black tabular-nums ${left <= 10 ? 'text-red-400' : 'text-white'}`}>{left}s</span>
          </div>
          <div
            key={`${pos}-${label(card)}`} // fresh element per card so it doesn't animate in from the last swipe
            onPointerDown={(e) => {
              startX.current = e.clientX;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => startX.current !== null && setDx(e.clientX - startX.current)}
            onPointerUp={(e) => {
              if (startX.current === null) return;
              // Read the offset from the event, not state — a fast flick can release before the last move re-renders.
              const d = e.clientX - startX.current;
              startX.current = null;
              if (d > SWIPE_PX) next(true);
              else if (d < -SWIPE_PX) next(false);
              else setDx(0);
            }}
            onPointerCancel={() => {
              startX.current = null;
              setDx(0);
            }}
            style={{
              transform: `translateX(${dx}px) rotate(${dx / 20}deg)`,
              transition: startX.current === null ? 'transform 0.2s' : 'none',
              touchAction: 'none',
            }}
            className={`select-none cursor-grab active:cursor-grabbing min-h-64 md:min-h-80 rounded-3xl border-2 flex items-center justify-center p-6 text-center ${
              dx > SWIPE_PX / 2
                ? 'border-emerald-400 bg-emerald-500/10'
                : dx < -SWIPE_PX / 2
                  ? 'border-red-400 bg-red-500/10'
                  : 'border-18-border bg-18-surface'
            }`}
          >
            {renderCard(card)}
          </div>
          {/* Render the next card hidden so its image (if any) is already loaded when it's swiped in. */}
          {deck[pos + 1] !== undefined && <div hidden>{renderCard(deck[pos + 1])}</div>}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              onClick={() => next(false)}
              className="flex items-center justify-center gap-2 rounded-2xl py-4 border border-red-400/40 text-red-300 hover:bg-red-500/10"
            >
              <X size={18} /> Skip
            </button>
            <button
              onClick={() => next(true)}
              className="flex items-center justify-center gap-2 rounded-2xl py-4 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10"
            >
              <Check size={18} /> Guessed
            </button>
          </div>
          <p className="text-xs text-white/40 text-center mt-3">Swipe the card, tap the buttons, or use ← → keys.</p>
        </>
      )}

      {phase === 'turnover' && (
        <div className="bg-18-surface border border-18-border rounded-2xl p-6">
          <p className="text-center text-white/60">Time&apos;s up!</p>
          <p className="text-center text-2xl font-black mt-1">
            {teams[turn]} got <span className="text-18-orange">{results.filter((r) => r.ok).length}</span>
          </p>
          {results.length > 0 && (
            <ul className="mt-5 space-y-1 text-sm max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  {r.ok ? <Check size={14} className="text-emerald-400" /> : <X size={14} className="text-red-400" />}
                  <span className={r.ok ? 'text-white' : 'text-white/40 line-through'}>{label(r.item)}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={nextTeam}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Next: {teams[1 - turn]}
          </button>
        </div>
      )}
    </div>
  );
}
