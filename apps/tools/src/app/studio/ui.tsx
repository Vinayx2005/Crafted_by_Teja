'use client';

// Shared look of the Content Studio (light theme). Colours come from the st-*
// tokens in tailwind.config.js: ink #222, mute #777, line #EEE, surface #FAFAFA,
// accent #F37335.

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

export const field =
  'w-full bg-white border border-st-line rounded-lg px-3 py-2.5 min-h-[40px] text-sm text-st-ink placeholder:text-st-mute/70 hover:border-[#DDDDDD] focus:outline-none focus:border-18-orange focus:ring-2 focus:ring-18-orange/20 transition';
export const btn = `inline-flex items-center justify-center gap-2 bg-18-orange hover:bg-[#E5601F] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg px-4 py-2.5 min-h-[40px] transition ${focusRing}`;
export const btnGhost = `inline-flex items-center justify-center gap-2 border border-st-line bg-white hover:bg-st-surface hover:border-[#DDDDDD] disabled:opacity-50 disabled:cursor-not-allowed text-st-ink text-sm font-medium rounded-lg px-3.5 py-2 min-h-[40px] transition ${focusRing}`;
export const card = 'bg-white border border-st-line rounded-xl';
export const panel = 'bg-st-surface rounded-xl';
export const label = 'block text-xs font-medium text-st-mute mb-1.5';

export const Spinner = () => <Loader2 size={16} className="animate-spin" aria-hidden />;

export const ErrorNote = ({ text }: { text: string }) =>
  text ? (
    <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      {text}
    </p>
  ) : null;

export const compact = (n: number | null | undefined) =>
  n == null ? '–' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const ago = (iso: string | null) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

// A titled bullet list; renders nothing when there are no items.
export const List = ({ title, items }: { title: string; items?: string[] }) =>
  items?.length ? (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-st-mute mb-1.5">{title}</h4>
      <ul className="list-disc pl-4 space-y-1 text-sm text-st-ink/80">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
    </div>
  ) : null;

// A small popover menu: closes on outside click and Escape. Used for the brand
// selector and the profile menu.
export function Popover({ trigger, children, align = 'left' }: { trigger: (p: { open: boolean; toggle: () => void }) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`absolute z-40 mt-1.5 min-w-[14rem] max-w-[calc(100vw-2rem)] bg-white border border-st-line rounded-xl shadow-lg p-1.5 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export const menuItem = 'w-full flex items-center gap-2 text-left text-sm text-st-ink rounded-lg px-3 py-2.5 min-h-[40px] hover:bg-st-surface focus-visible:outline-none focus-visible:bg-st-surface';

// In-app replacement for the browser's confirm(): `const [ask, dialog] = useConfirm();`
// render {dialog} once, then `if (await ask('Remove it?', 'Remove')) ...`.
export function useConfirm() {
  const [req, setReq] = useState<{ message: string; ok: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (message: string, ok = 'Confirm', danger = true) => new Promise<boolean>((resolve) => setReq({ message, ok, danger, resolve }));
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  useEffect(() => {
    if (!req) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { req.resolve(false); setReq(null); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [req]);
  const dialog = req ? (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div role="alertdialog" aria-modal="true" aria-label="Please confirm" className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-st-line p-5">
        <p className="text-sm text-st-ink leading-relaxed">{req.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus onClick={() => done(false)} className={btnGhost}>Cancel</button>
          <button onClick={() => done(true)} className={req.danger ? `${btn} !bg-red-600 hover:!bg-red-700` : btn}>{req.ok}</button>
        </div>
      </div>
    </div>
  ) : null;
  return [ask, dialog] as const;
}
