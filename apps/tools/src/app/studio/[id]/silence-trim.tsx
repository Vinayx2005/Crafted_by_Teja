'use client';

// Step 2 of a project: choose the part of the video to work on (for example the first 10 minutes of a
// 1-hour recording). Only that part is listened to, edited and exported.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Play, Upload } from 'lucide-react';
import { hms, parseClock, type Span } from '@/lib/studio/silence';
import { btn, btnGhost, card, field, label } from '../ui';

const MIN_PART = 1; // seconds

function TimeField({ id, text, value, onChange }: { id: string; text: string; value: number; onChange: (t: number) => void }) {
  const [draft, setDraft] = useState(hms(value));
  useEffect(() => setDraft(hms(value)), [value]);
  const commit = () => {
    const t = parseClock(draft);
    if (t == null) setDraft(hms(value));
    else onChange(t);
  };
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <input id={id} value={draft} inputMode="numeric" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className={`${field} tabular-nums`} placeholder="m:ss" />
    </div>
  );
}

export function Trim({ actions, name, blob, initial, onBack, onNext, onPick }: {
  actions: HTMLElement | null;
  name: string;
  blob: Blob | null;
  initial: Span | null;
  onBack: () => void;
  onNext: (part: Span) => void;
  onPick: (f: File) => void;
}) {
  const [url, setUrl] = useState('');
  const [dur, setDur] = useState(0);
  const [part, setPart] = useState<Span | null>(initial);
  const [now, setNow] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);
  const playingPart = useRef(false);

  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  function known(d: number) {
    setDur(d);
    setPart((p) => (p && p.end <= d + 0.5 ? p : { start: 0, end: d }));
  }
  function loaded(v: HTMLVideoElement) {
    if (Number.isFinite(v.duration)) return known(v.duration);
    // Browser recordings may not say their length: jump to the end once to find it.
    v.addEventListener('timeupdate', () => { const d = Number.isFinite(v.duration) ? v.duration : v.currentTime; v.currentTime = 0; known(d); }, { once: true });
    v.currentTime = 1e9;
  }

  const set = (p: Span) => setPart({ start: Math.max(0, Math.min(p.start, dur - MIN_PART)), end: Math.min(dur, Math.max(p.end, p.start + MIN_PART)) });
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur));
  };
  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (!part || !dur) return;
    const t = at(e.clientX);
    drag.current = Math.abs(t - part.start) <= Math.abs(t - part.end) ? 'start' : 'end';
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !part) return;
    const t = at(e.clientX);
    set(drag.current === 'start' ? { start: t, end: part.end } : { start: part.start, end: t });
    if (video.current) video.current.currentTime = t;
  }
  function key(which: 'start' | 'end', e: React.KeyboardEvent) {
    if (!part || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
    set(which === 'start' ? { start: part.start + step, end: part.end } : { start: part.start, end: part.end + step });
  }
  function playPart() {
    const v = video.current;
    if (!v || !part) return;
    v.currentTime = part.start;
    playingPart.current = true;
    v.play().catch(() => {});
  }

  const pct = (t: number) => `${dur ? (t / dur) * 100 : 0}%`;
  const ok = !!part && dur > 0 && part.end - part.start >= MIN_PART;

  return (
    <div className="space-y-4">
      {actions && createPortal(<>
        <button onClick={onBack} className={`${btnGhost} !min-h-[36px] !px-3`}><ArrowLeft size={14} aria-hidden /> Projects</button>
        <button onClick={() => part && onNext(part)} disabled={!ok} className={`${btn} !min-h-[36px] !px-3`}>Next: Remove silences <ArrowRight size={14} aria-hidden /></button>
      </>, actions)}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-st-mute">Step 2 of 3 · {name}</p>
        <h2 className="mt-1 text-lg font-semibold">Choose the part to work on</h2>
        <p className="text-sm text-st-mute">Only this part is checked for silences, edited and exported. Drag the two handles, type the times, or use the buttons below.</p>
      </div>

      {!blob ? (
        <div className={`${card} grid place-items-center gap-3 p-10 text-center`}>
          <p className="text-sm text-st-mute">This project&apos;s video is not stored in this browser. Choose it again to continue.</p>
          <label className={`${btn} cursor-pointer`}>
            <Upload size={15} aria-hidden /> Choose the video
            <input type="file" accept="video/*,audio/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
          </label>
        </div>
      ) : (
        <section className={`${card} p-4 space-y-4`}>
          <video
            ref={video}
            src={url}
            controls
            onLoadedMetadata={(e) => loaded(e.currentTarget)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setNow(v.currentTime);
              if (playingPart.current && part && v.currentTime >= part.end) { v.pause(); playingPart.current = false; }
            }}
            onPause={() => (playingPart.current = false)}
            className="w-full max-h-[45vh] rounded-lg bg-black"
          />

          {/* The whole video as a bar; the chosen part is highlighted between two handles. */}
          <div
            ref={track}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            className="relative h-12 cursor-pointer touch-none select-none rounded-lg bg-st-surface"
          >
            {part && (
              <>
                <div className="absolute inset-y-0 rounded-lg bg-18-orange/20 ring-2 ring-inset ring-18-orange" style={{ left: pct(part.start), width: pct(part.end - part.start) }} />
                {(['start', 'end'] as const).map((w) => (
                  <div
                    key={w}
                    role="slider"
                    tabIndex={0}
                    aria-label={w === 'start' ? 'Start of the part' : 'End of the part'}
                    aria-valuemin={0}
                    aria-valuemax={Math.round(dur)}
                    aria-valuenow={Math.round(part[w])}
                    aria-valuetext={hms(part[w])}
                    onKeyDown={(e) => key(w, e)}
                    className="absolute inset-y-0 -ml-2 w-4 rounded-md bg-18-orange shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 focus-visible:ring-offset-2"
                    style={{ left: pct(part[w]) }}
                  />
                ))}
              </>
            )}
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500" style={{ left: pct(now) }} />
          </div>
          <div className="flex justify-between text-xs text-st-mute tabular-nums"><span>0:00</span><span>{hms(dur)}</span></div>

          {part && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <TimeField id="part-start" text="Start" value={part.start} onChange={(t) => set({ start: t, end: part.end })} />
              <TimeField id="part-end" text="End" value={part.end} onChange={(t) => set({ start: part.start, end: t })} />
              <p className="pb-2.5 text-sm">Selected <b className="tabular-nums">{hms(part.end - part.start)}</b> <span className="text-st-mute">of {hms(dur)}</span></p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => part && set({ start: video.current?.currentTime ?? 0, end: part.end })} disabled={!part} className={btnGhost}>Start here</button>
            <button onClick={() => part && set({ start: part.start, end: video.current?.currentTime ?? dur })} disabled={!part} className={btnGhost}>End here</button>
            <button onClick={() => set({ start: 0, end: dur })} disabled={!dur} className={btnGhost}>Whole video</button>
            <button onClick={playPart} disabled={!part} className={btnGhost}><Play size={14} aria-hidden /> Play the part</button>
          </div>
          <p className="text-xs text-st-mute">"Start here" and "End here" use the red line, which follows the video. Arrow keys move a selected handle by 1 second (Shift: 10).</p>
        </section>
      )}
    </div>
  );
}
