'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Minus, Plus, RotateCcw, SkipForward, Trophy } from 'lucide-react';
import { GameHeader, buzzer, shuffle } from '../GameShell';
import { CARDS, SIMPLE_ICONS, type TabooCard } from './cards';

// All teams race on the same card at the same time; the admin (host) awards the point.
type Phase = 'setup' | 'playing' | 'over';
type Played = { card: TabooCard; winner: number | null }; // null = skipped / nobody

const HOW_TO_PLAY = [
  'Pick an admin to run the screen. Everyone else splits into teams.',
  'Each card is a puzzle: logo colour + core job + taboo word = the company.',
  'All teams see the same card and race against the same clock. Shout the answer!',
  'The admin taps Reveal (or the timer runs out), then gives the point to the team that got it first.',
  'After the last card, the team with the most points wins.',
];

const RULES = [
  'First correct answer wins the card — the admin decides who was first.',
  'One answer per shout. No rattling off a list of names.',
  'Nobody says the taboo word out loud — it’s a hint for your eyes only.',
  'The admin’s call is final. Points can be adjusted with + / − at any time.',
];

// Light brand colours (e.g. Snapchat yellow) need a dark tile behind the logo to stay visible.
function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 180;
}

// "Disney+ Hotstar" → "DH", "Flipkart" → "F"
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.match(/[A-Za-z0-9]/)?.[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex-1 min-w-0 rounded-2xl border border-18-border bg-18-bg p-2 md:p-3 min-h-[4.5rem] md:min-h-[9.5rem] flex flex-col items-center justify-center gap-1 md:gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</span>
      {children}
    </div>
  );
}

const Sign = ({ children }: { children: string }) => (
  <span className="text-xl md:text-3xl leading-none font-black text-white/40 text-center shrink-0" aria-hidden>
    {children}
  </span>
);

function Card({ c, revealed }: { c: TabooCard; revealed: boolean }) {
  const icon = `url(${SIMPLE_ICONS}/${c.slug}.svg)`;
  return (
    <div className="w-full flex flex-col md:flex-row items-stretch md:items-center gap-2">
      <Box label="Logo colour">
        <div className="h-10 w-24 md:h-16 md:w-16 rounded-xl border border-white/15" style={{ background: c.hex }} />
      </Box>
      <Sign>+</Sign>
      <Box label="Core job">
        <span className="text-base md:text-lg font-bold leading-tight">{c.job}</span>
      </Box>
      <Sign>+</Sign>
      <Box label="Taboo word">
        <span className="text-base md:text-lg font-bold leading-tight text-red-300">{c.word}</span>
      </Box>
      <Sign>=</Sign>
      <Box label={revealed ? 'It’s' : 'Company?'}>
        {revealed && !c.slug ? (
          // No logo available: initials on the brand colour.
          <div
            className={`h-14 w-14 md:h-20 md:w-20 rounded-xl flex items-center justify-center text-xl md:text-2xl font-black border border-white/15 ${
              isLight(c.hex) ? 'text-black' : 'text-white'
            }`}
            style={{ background: c.hex }}
          >
            {initials(c.company)}
          </div>
        ) : (
          <div
            className={`relative h-14 w-14 md:h-20 md:w-20 rounded-xl flex items-center justify-center ${
              !revealed || isLight(c.hex) ? 'bg-18-surface-2' : 'bg-white'
            }`}
          >
            {!revealed && (
              <span className="absolute inset-0 flex items-center justify-center text-3xl md:text-4xl font-black text-white/40">
                ?
              </span>
            )}
            {/* Kept in the page while hidden (invisible, not removed) so the logo is already loaded at reveal. */}
            {c.slug && (
              <div
                role="img"
                aria-label={revealed ? `${c.company} logo` : 'Hidden logo'}
                className={`h-10 w-10 md:h-12 md:w-12 ${revealed ? '' : 'invisible'}`}
                style={{
                  background: c.hex,
                  WebkitMaskImage: icon,
                  maskImage: icon,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            )}
          </div>
        )}
        {revealed && <span className="text-base md:text-lg font-black leading-tight text-18-orange">{c.company}</span>}
      </Box>
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function PitchTaboo() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [teams, setTeams] = useState(['Team A', 'Team B']);
  const [scores, setScores] = useState([0, 0]);
  const [seconds, setSeconds] = useState(30);
  const [cardsPerGame, setCardsPerGame] = useState(15);
  const [deck, setDeck] = useState<TabooCard[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(30);
  const [played, setPlayed] = useState<Played[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const endsAt = useRef(0);
  const pausedMs = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const card = deck[pos];

  // Per-card countdown, shared by all teams. Time's up = buzzer + reveal. Paused while the help popup is open.
  useEffect(() => {
    if (phase !== 'playing' || revealed) return;
    const id = setInterval(() => {
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
        setRevealed(true);
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, revealed, pos]);

  function startCard() {
    endsAt.current = Date.now() + seconds * 1000;
    setLeft(seconds);
    setRevealed(false);
  }

  function start() {
    const names = teams.map((t) => t.trim()).filter(Boolean);
    if (names.length < 2) return;
    audio.current ??= new AudioContext(); // unlocked by this tap so the buzzer can play later
    audio.current.resume();
    const s = clamp(seconds, 5, 300);
    setSeconds(s);
    setTeams(names);
    setScores(names.map(() => 0));
    setDeck(shuffle(CARDS));
    setPos(0);
    setPlayed([]);
    endsAt.current = Date.now() + s * 1000;
    setLeft(s);
    setRevealed(false);
    setPhase('playing');
  }

  // Admin's call for this card: a team index, or null for skipped / nobody.
  function award(winner: number | null) {
    if (!card) return;
    if (winner !== null) setScores((sc) => sc.map((v, i) => (i === winner ? v + 1 : v)));
    setPlayed((p) => [...p, { card, winner }]);
    if (played.length + 1 >= Math.min(cardsPerGame, CARDS.length)) {
      setPhase('over');
      return;
    }
    setPos(pos + 1);
    startCard();
  }

  // Keyboard for the admin: → reveal, ← skip, then 1–9 awards that team, 0 = nobody.
  useEffect(() => {
    if (phase !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog.current?.open || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (!revealed && e.key === 'ArrowRight') setRevealed(true);
      else if (!revealed && e.key === 'ArrowLeft') award(null);
      else if (revealed && e.key === '0') award(null);
      else if (revealed && /^[1-9]$/.test(e.key) && Number(e.key) <= teams.length) award(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const field = 'bg-18-bg border border-18-border rounded-xl px-3 py-2 text-white outline-none focus:border-18-orange/60';
  const chip = (on: boolean) =>
    `px-3 py-2 rounded-xl border text-sm ${on ? 'border-18-orange text-18-orange' : 'border-18-border text-white/70'}`;
  const best = Math.max(...scores);
  const leaders = teams.filter((_, i) => scores[i] === best);

  const scoreboard = (
    <div className={`grid gap-2 mb-4 ${teams.length === 2 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
      {teams.map((t, i) => (
        <div key={i} className="bg-18-surface border border-18-border rounded-2xl px-3 py-2">
          <p className="text-xs text-white/50 truncate">{t}</p>
          <div className="flex items-center justify-between">
            <button
              aria-label={`Take a point from ${t}`}
              onClick={() => setScores((s) => s.map((v, j) => (j === i ? v - 1 : v)))}
              className="h-7 w-7 rounded-full border border-18-border text-white/60 hover:text-white flex items-center justify-center"
            >
              <Minus size={12} />
            </button>
            <span className="text-2xl md:text-3xl font-black tabular-nums">{scores[i]}</span>
            <button
              aria-label={`Give a point to ${t}`}
              onClick={() => setScores((s) => s.map((v, j) => (j === i ? v + 1 : v)))}
              className="h-7 w-7 rounded-full border border-18-border text-white/60 hover:text-white flex items-center justify-center"
            >
              <Plus size={12} />
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
        title="Pitch Taboo"
        howToPlay={HOW_TO_PLAY}
        rules={RULES}
        dialog={dialog}
        onOpen={() => {
          if (phase === 'playing' && !revealed) pausedMs.current = endsAt.current - Date.now();
        }}
      />

      {phase === 'setup' && (
        <>
          <p className="text-white/60 mb-8 leading-relaxed">
            Logo colour + core job + taboo word = ? Every team races on the same card. The admin reveals the answer and
            gives the point to whoever got it first.
          </p>
          <div className="space-y-5 bg-18-surface border border-18-border rounded-2xl p-5">
            <div>
              <span className="text-xs text-white/50">Teams</span>
              <div className="mt-1 space-y-2">
                {teams.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={t}
                      onChange={(e) => setTeams((ts) => ts.map((v, j) => (j === i ? e.target.value : v)))}
                      aria-label={`Team ${i + 1} name`}
                      className={`${field} flex-1`}
                    />
                    <button
                      aria-label={`Remove ${t}`}
                      disabled={teams.length <= 2}
                      onClick={() => setTeams((ts) => ts.filter((_, j) => j !== i))}
                      className="h-10 w-10 rounded-xl border border-18-border text-white/60 hover:text-white disabled:opacity-30 flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                ))}
                {teams.length < 8 && (
                  <button
                    onClick={() => setTeams((ts) => [...ts, `Team ${String.fromCharCode(65 + ts.length)}`])}
                    className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"
                  >
                    <Plus size={14} /> Add team
                  </button>
                )}
              </div>
            </div>
            <div>
              <span className="text-xs text-white/50">Seconds per card</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {[15, 30, 45, 60].map((s) => (
                  <button key={s} onClick={() => setSeconds(s)} className={chip(seconds === s)}>
                    {s}s
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value) || 0)}
                  onBlur={() => setSeconds((s) => clamp(s, 5, 300))}
                  aria-label="Custom seconds per card"
                  className={`${field} w-24`}
                />
              </div>
            </div>
            <div>
              <span className="text-xs text-white/50">Cards per game</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {[10, 15, 20, 30].map((n) => (
                  <button key={n} onClick={() => setCardsPerGame(n)} className={chip(cardsPerGame === n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={start}
            disabled={teams.filter((t) => t.trim()).length < 2}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 disabled:opacity-40 text-white font-bold rounded-2xl py-4 transition-colors"
          >
            Start game
          </button>
        </>
      )}

      {phase === 'playing' && card && (
        <>
          {scoreboard}
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-white/50">
              Card {played.length + 1} of {Math.min(cardsPerGame, CARDS.length)}
            </span>
            <span className={`text-2xl font-black tabular-nums ${!revealed && left <= 5 ? 'text-red-400' : 'text-white'}`}>
              {revealed ? '—' : `${left}s`}
            </span>
          </div>
          <div
            key={pos}
            className="min-h-64 md:min-h-80 rounded-3xl border-2 border-18-border bg-18-surface flex items-center justify-center p-4 md:p-6 text-center"
          >
            <Card c={card} revealed={revealed} />
          </div>
          {/* Next card rendered hidden so its logo is already loaded when it comes up. */}
          {deck[pos + 1] && (
            <div hidden>
              <Card c={deck[pos + 1]} revealed={false} />
            </div>
          )}

          {!revealed ? (
            <>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => award(null)}
                  className="flex items-center justify-center gap-2 rounded-2xl py-4 border border-18-border text-white/70 hover:text-white"
                >
                  <SkipForward size={18} /> Skip
                </button>
                <button
                  onClick={() => setRevealed(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl py-4 bg-18-orange hover:bg-orange-600 text-white font-bold"
                >
                  Reveal <ArrowRight size={18} />
                </button>
              </div>
              <p className="text-xs text-white/40 text-center mt-3">All teams guess at once. Admin: Reveal when someone gets it (or use → / ←).</p>
            </>
          ) : (
            <>
              <p className="text-center text-sm text-white/60 mt-5 mb-2">Admin: who got it first?</p>
              <div className={`grid gap-2 ${teams.length === 2 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
                {teams.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => award(i)}
                    className="rounded-2xl py-4 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 font-bold truncate px-2"
                  >
                    +1 {t}
                  </button>
                ))}
              </div>
              <button
                onClick={() => award(null)}
                className="mt-2 w-full rounded-2xl py-3 border border-18-border text-white/60 hover:text-white"
              >
                Nobody got it
              </button>
              <p className="text-xs text-white/40 text-center mt-3">Keys: 1–{teams.length} to award a team, 0 for nobody.</p>
            </>
          )}
        </>
      )}

      {phase === 'over' && (
        <div className="bg-18-surface border border-18-orange/40 rounded-2xl p-6 md:p-8">
          <div className="text-center">
            <Trophy size={40} className="mx-auto text-18-orange" />
            <p className="text-white/60 mt-4">{leaders.length > 1 ? 'It’s a tie between' : 'And the winner is'}</p>
            <p className="text-3xl font-black text-18-orange mt-1">{leaders.join(' & ')}</p>
            <p className="text-white/50 mt-1">with {best} point{best === 1 ? '' : 's'}</p>
          </div>
          <div className="mt-6">{scoreboard}</div>
          <ol className="mt-2 space-y-1 text-sm max-h-64 overflow-y-auto">
            {played.map((p, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-white/80">{p.card.company}</span>
                <span className={p.winner === null ? 'text-white/30' : 'text-emerald-300'}>
                  {p.winner === null ? '—' : teams[p.winner]}
                </span>
              </li>
            ))}
          </ol>
          <button
            onClick={() => setPhase('setup')}
            className="mt-6 w-full bg-18-orange hover:bg-orange-600 text-white font-bold rounded-2xl py-4 transition-colors inline-flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} /> Play again
          </button>
        </div>
      )}
    </div>
  );
}
