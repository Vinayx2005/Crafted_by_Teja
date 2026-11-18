'use client';

// Brand Settings ("Your direction") and Research ("What works"): the team's own direction for the page, and what the most
// viral Shorts of every competitor have in common. The server puts both into
// every script, rewrite and topic-idea prompt; the team's own words win.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, errorText, supabase } from '@/lib/studio/client';
import { PAGE_LANGUAGES, type Page, type Playbook } from '@/lib/studio/shared';
import { ago, btn, btnGhost, card, ErrorNote, field, label, List, Spinner } from '../ui';

export type PB = { playbook: Playbook | null; at: string | null };

// Lives in the page screen, so "Analyse all" in the Competition tab can refresh it.
export function usePlaybook(pageId: string) {
  const [pb, setPb] = useState<PB | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<PB>('playbook', { pageId }).then(setPb).catch((e) => setError(errorText(e)));
  }, [pageId]);

  // Reads every competitor's most viral Shorts together and rewrites the playbook.
  const update = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      setPb(await api<PB>('consolidate', { pageId }));
      setBusy(false);
      return true;
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return false;
    }
  }, [pageId]);

  return { pb, busy, error, update };
}

// The combined learnings: what the most viral Shorts of ALL competitors have in
// common. The script writer is given these same instructions.
export function PlaybookBox({ pb, busy, error, onUpdate }: { pb: PB | null; busy: boolean; error: string; onUpdate: () => void }) {
  const p = pb?.playbook;
  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-st-ink">What works across your competitors</h2>
          <p className="text-sm text-st-mute mt-1">
            The patterns shared by the most viral Shorts of every competitor. The script writer follows these instructions.
          </p>
        </div>
        <button onClick={onUpdate} disabled={busy} className={btnGhost}>
          {busy ? <Spinner /> : <RefreshCw size={14} aria-hidden />} Update learnings
        </button>
      </div>
      <div className="mt-3"><ErrorNote text={error} /></div>

      {!pb ? (
        !error && <p className="text-sm text-st-mute flex items-center gap-2 mt-4"><Spinner /> Loading…</p>
      ) : !p ? (
        <p className="text-sm text-st-mute mt-4">
          Nothing yet. In <strong>Research</strong>, add creators and press <strong>Analyse all</strong>. Their viral Shorts are then combined here into instructions for hooks, body, conclusion and CTA.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {p.summary && <p className="text-sm text-st-ink leading-relaxed">{p.summary}</p>}
          <p className="text-[11px] text-st-mute">
            {p.based_on ? `Based on ${p.based_on.videos} viral Shorts from ${p.based_on.creators} creators` : 'Based on your competitors'}
            {pb.at ? ` · updated ${ago(pb.at)}` : ''}
          </p>

          {p.content_types?.length ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-2">Content types that win</h3>
              <ul className="grid md:grid-cols-2 gap-2">
                {p.content_types.map((t, i) => (
                  <li key={i} className="border border-st-line rounded-xl p-3 text-sm">
                    <strong className="text-st-ink">{t.type}</strong>
                    <p className="text-st-ink/70 mt-1">{t.why}</p>
                    {t.topics?.length ? <p className="text-[11px] text-st-mute mt-1.5">e.g. {t.topics.join(' · ')}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-st-line rounded-xl p-4 space-y-3 md:col-span-2">
              <h3 className="text-sm font-bold text-st-ink">Hooks</h3>
              <List title="Rules" items={p.hooks?.rules} />
              {p.hooks?.patterns?.length ? (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-st-mute mb-1.5">Hook patterns to reuse</h4>
                  <ul className="grid md:grid-cols-2 gap-2">
                    {p.hooks.patterns.map((h, i) => (
                      <li key={i} className="text-sm border border-st-line rounded-lg p-3">
                        <strong className="text-st-ink">{h.name}</strong>
                        {h.seen && <span className="text-[11px] text-st-mute"> · {h.seen}</span>}
                        <p className="text-18-orange mt-1">{h.template}</p>
                        <p className="text-st-mute italic mt-1">&ldquo;{h.example}&rdquo;</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="border border-st-line rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-st-ink">Body</h3>
              {p.body?.structure && <p className="text-sm text-st-ink">{p.body.structure}</p>}
              <List title="Rules" items={p.body?.rules} />
            </div>

            <div className="border border-st-line rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-st-ink">Conclusion</h3>
              <List title="Rules" items={p.conclusion?.rules} />
              <List title="Real closing lines" items={p.conclusion?.examples} />
            </div>

            <div className="border border-st-line rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-st-ink">CTA</h3>
              <List title="Rules" items={p.cta?.rules} />
              <List title="Real CTAs" items={p.cta?.examples} />
            </div>

            <div className="border border-st-line rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-st-ink">Style and what to avoid</h3>
              <List title="Style" items={p.style} />
              <List title="Avoid" items={p.avoid} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// The team's own instructions for the page. Saved on the page and put into
// every prompt as binding, ahead of whatever the competitors do.
export function Direction({ page, onPageChange }: { page: Page; onPageChange: (p: Page) => void }) {
  const [audience, setAudience] = useState(page.audience ?? '');
  const [voice, setVoice] = useState(page.voice ?? '');
  const [languages, setLanguages] = useState<string[]>(page.languages);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = audience.trim() !== (page.audience ?? '') || voice.trim() !== (page.voice ?? '') || languages.join() !== page.languages.join();
  // Always in the same order, so the first one is a stable "main" language for trend research.
  const toggle = (l: string) =>
    setLanguages(PAGE_LANGUAGES.filter((x) => (x === l ? !languages.includes(x) : languages.includes(x))));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const f = { audience: audience.trim() || null, voice: voice.trim() || null, languages };
    try {
      await api('brand.update', { brandId: page.id, ...f });
    } catch (err) {
      setBusy(false);
      return setMsg({ ok: false, text: errorText(err) });
    }
    setBusy(false);
    onPageChange({ ...page, ...f });
    setMsg({ ok: true, text: 'Saved. Every new script, rewrite and topic idea now follows this.' });
  }

  return (
    <section className={`${card} p-5`}>
      <h2 className="font-bold text-st-ink">Your direction</h2>
      <p className="text-sm text-st-mute mt-1">
        Your own instructions for this brand. The script writer, the topic ideas and the rewrites follow them. When they disagree with what works for your competitors, <strong>yours win</strong>.
      </p>
      <form onSubmit={save} className="space-y-3 mt-4">
        <div>
          <label className={label} htmlFor="dir-audience">Who watches it</label>
          <input id="dir-audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Young salaried people, 22 to 32, first job" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="dir-voice">Voice, style and your own instructions</label>
          <textarea
            id="dir-voice"
            rows={4}
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            placeholder={'Friendly elder-brother tone, no jargon, one example per idea.\nAlways end with a question. Never start with a greeting.\nAny rule you write here is followed in every script.'}
            className={field}
          />
        </div>
        <fieldset>
          <legend className={label}>Languages the brand posts in</legend>
          <div className="flex flex-wrap gap-2">
            {PAGE_LANGUAGES.map((l) => (
              <label key={l} className="cursor-pointer">
                <input type="checkbox" checked={languages.includes(l)} onChange={() => toggle(l)} className="sr-only peer" />
                <span className="block text-sm rounded-full border border-st-line text-st-ink/70 px-3.5 py-1.5 peer-checked:bg-18-orange peer-checked:border-18-orange peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-18-orange/60">
                  {l}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-st-mute mt-2">These are the script languages offered in Create. The first one selected here is the main language for trend research.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy || !dirty || !languages.length} className={btn}>{busy ? <Spinner /> : null} Save direction</button>
          {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        </div>
      </form>
    </section>
  );
}
