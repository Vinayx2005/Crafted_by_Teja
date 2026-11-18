'use client';

import { useState } from 'react';
import { PAGE_LANGUAGES } from '@/lib/studio/shared';
import { btn, field, label, Spinner } from './ui';

export type PageValues = { name: string; niche: string; audience: string; voice: string; languages: string[] };

// One form for creating a page and for editing its settings.
export default function PageForm({
  initial,
  submitLabel,
  busy,
  mode = 'create',
  onSubmit,
}: {
  mode?: 'create' | 'edit';
  initial?: Partial<PageValues>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: PageValues) => void;
}) {
  const [v, setV] = useState<PageValues>({
    name: initial?.name ?? '',
    niche: initial?.niche ?? '',
    audience: initial?.audience ?? '',
    voice: initial?.voice ?? '',
    languages: initial?.languages ?? ['English'],
  });
  const set = (k: keyof PageValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const toggle = (l: string) =>
    setV({ ...v, languages: v.languages.includes(l) ? v.languages.filter((x) => x !== l) : [...v.languages, l] });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="space-y-3"
    >
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="pf-name">Brand name</label>
          <input id="pf-name" required maxLength={80} value={v.name} onChange={set('name')} placeholder="Money Telugu" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="pf-niche">Niche (a few words)</label>
          <input id="pf-niche" required minLength={3} maxLength={300} value={v.niche} onChange={set('niche')} placeholder="Personal finance and investing" className={field} />
        </div>
      </div>
      {mode === 'create' && (
        <>
          <div>
            <label className={label} htmlFor="pf-audience">Who watches it (optional)</label>
            <input id="pf-audience" value={v.audience} onChange={set('audience')} placeholder="Young salaried people, 22 to 32, first job" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="pf-voice">Voice and style (optional)</label>
            <textarea id="pf-voice" rows={2} value={v.voice} onChange={set('voice')} placeholder="Friendly elder-brother tone, no jargon, one example per idea" className={field} />
          </div>
          <fieldset>
            <legend className={label}>Languages the brand posts in</legend>
            <div className="flex flex-wrap gap-2">
              {PAGE_LANGUAGES.map((l) => (
                <label key={l} className="cursor-pointer">
                  <input type="checkbox" checked={v.languages.includes(l)} onChange={() => toggle(l)} className="sr-only peer" />
                  <span className="block text-sm rounded-full border border-st-line text-st-ink/70 px-3.5 py-1.5 peer-checked:bg-18-orange peer-checked:border-18-orange peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-18-orange/60">
                    {l}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <button disabled={busy || !v.languages.length} className={btn}>
        {busy ? <Spinner /> : null} {submitLabel}
      </button>
    </form>
  );
}
