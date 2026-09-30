import { ArrowRight, Dices, IndianRupee } from 'lucide-react';

// Static list. Add new tools here as they ship — no CMS needed until
// the roster grows past ~5 or the descriptions start needing edits
// separate from the code.
const TOOLS = [
  {
    href: 'https://pft.craftedbyteja.com',
    title: 'Personal FT',
    tagline: 'A finance tracker that finds your leaks.',
    body: 'Voice-log an expense in seconds. Budgets, loans, receivables, recurring debits — no bank linking, all free.',
    accent: 'from-18-orange to-orange-600',
    icon: IndianRupee,
    live: true,
  },
  {
    href: '/name-picker',
    title: 'Name Picker',
    tagline: 'Spin a wheel, pick a name.',
    body: 'Paste a list of names and spin for a random winner. Shuffle, sort, remove winners as you go — nothing leaves your browser.',
    accent: 'from-indigo-500 to-violet-600',
    icon: Dices,
    live: true,
  },
];

export default function ToolsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 md:py-24">
      <section className="mb-14">
        <p className="text-xs font-bold uppercase tracking-widest text-18-orange mb-4">Tools</p>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white leading-[1.05] mb-6">
          Small tools I built{' '}
          <span className="text-18-orange italic">for myself.</span>
        </h1>
        <p className="text-lg text-white/70 leading-relaxed max-w-2xl">
          Every one of these started as a private itch. If they help you too, great — they&apos;re free.
        </p>
      </section>

      <div className="space-y-3">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <a
              key={t.href}
              href={t.href}
              className="group block bg-18-surface border border-18-border rounded-2xl p-5 hover:border-18-orange/40 hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start gap-4">
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${t.accent} flex items-center justify-center shrink-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]`}>
                  <Icon size={22} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-white">{t.title}</h2>
                    {t.live && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                        Live
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/80 mt-1">{t.tagline}</p>
                  <p className="text-xs text-white/50 mt-2 leading-relaxed">{t.body}</p>
                </div>
                <ArrowRight
                  size={16}
                  className="text-white/30 group-hover:text-18-orange group-hover:translate-x-0.5 transition-all shrink-0 mt-1"
                />
              </div>
            </a>
          );
        })}
      </div>

      <p className="text-xs text-white/40 mt-12 text-center">
        More tools when they&apos;re ready. Follow along at{' '}
        <a href="https://craftedbyteja.com" className="text-18-orange hover:underline">craftedbyteja.com</a>.
      </p>
    </div>
  );
}
