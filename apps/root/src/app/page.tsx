import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, ArrowDown, Laptop, PenLine, BookOpen, Send,
} from 'lucide-react';
import { dilse, DILSE_URL, DilseStory, DilseBook } from '@/lib/supabase';
import { getAuthor, AUTHOR_URL } from '@/lib/author';

// Dilse content is read on every request, so a newly published book or story
// shows up here immediately.
export const revalidate = 0;
export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------- content
   Everything below is placeholder copy/imagery. Swap the strings and
   drop real files into /public, then point the <img> at them.        */

const PILLARS = [
  { icon: Laptop,   title: 'Build',   text: 'I build companies and figure out how to make difficult things work.' },
  { icon: PenLine,  title: 'Write',   text: 'I write stories inspired by people, emotions, and the situations that reveal who we really are.' },
  { icon: BookOpen, title: 'Learn',   text: 'Failures have taught me more than success ever could. I’m always learning along the way.' },
  { icon: Send,     title: 'Explore', text: 'New ideas, difficult challenges, unfamiliar places — and everything life has to offer.' },
];

const PROJECTS = [
  {
    title: 'Personal Finance Tracker',
    text: 'Everyday money tracked in seconds — you talk, it files it where it belongs.',
    href: 'https://pft.craftedbyteja.com',
    img: '/work-personal-finance.svg',
    tint: 'from-emerald-50 via-teal-50 to-sky-50',
  },
  {
    title: 'Writers Book Studio',
    text: 'Write a book chapter by chapter and watch it take shape in a live, page-turning preview.',
    href: 'https://writer.craftedbyteja.com',
    img: '/work-writer.svg',
    tint: 'from-amber-50 via-orange-50 to-yellow-50',
  },
  {
    title: 'Icebreaker Games',
    text: 'Quick, free games for founders — play in the room or over a call, straight in the browser.',
    href: 'https://games.craftedbyteja.com',
    img: '/work-games.svg',
    tint: 'from-indigo-50 via-purple-50 to-pink-50',
  },
  {
    title: '18startup App',
    text: 'A community for startup founders — connect, learn, share, compete, and get a shot at raising funds.',
    href: 'https://platform.18startup.com',
    img: '/work-18startup.svg',
    tint: 'from-violet-50 via-fuchsia-50 to-rose-50',
  },
  {
    title: 'CRM',
    text: 'Contacts, pipelines and follow-ups in one place — built so nothing quietly falls through.',
    href: null,
    img: '/work-crm.svg',
    tint: 'from-rose-50 via-orange-50 to-amber-50',
  },
  {
    title: 'Company Finance Tracker',
    text: 'Where the money actually goes: spends, invoices and runway, without the spreadsheet ritual.',
    href: null,
    img: '/work-company-finance.svg',
    tint: 'from-sky-50 via-slate-50 to-indigo-50',
  },
];

const WHATSAPP = 'https://wa.me/918886956636';

/* Story, work, author and belief copy — drawn from the brand foundation
   and profile documents. */

const CHAPTERS = [
  {
    year: '2020',
    title: 'A camera and no audience',
    body:
      'On 19 March 2020 I started a YouTube channel. Two years and 200+ videos later it still had barely any traction, and I moved on. It left me one thing worth more than views: I stopped being afraid of talking to people. That skill is what pulled me into rooms full of ideas.',
  },
  {
    year: '2021',
    title: 'Paying my own way',
    body:
      'Somewhere in the middle of engineering I became financially independent from my family — my own fees, my own dues, my own mistakes. It was the hardest stretch of my life so far, and the first time I learned that surviving a situation is a skill of its own.',
  },
  {
    year: '2021 — 2023',
    title: 'Three ventures, three endings',
    body:
      'Truscript started in a park near my house as ten-minute medicine delivery, pivoted for a year, and closed because we did not understand the domain deeply enough. Designity, a video agency, made real money and paid our bills — I left because it stopped being interesting. Echo actually paid students for gig work, but the unit economics never worked.',
  },
  {
    year: '2023',
    title: 'Build3',
    body:
      'Echo failed, and failing at it is what got me into Build3 — five rounds of selection, nineteen people from across India, and a few months in Goa that rearranged my life. I met a co-founder, walked into an ecosystem I had only read about, and left with funding.',
  },
  {
    year: 'Today',
    title: '18startup',
    body:
      'We started on 19 October 2023. It is my fourth venture, and the first where the hard part is not survival but scale. I run operations and marketing, and I spend most of my time on problems that do not have obvious answers.',
  },
];

const STATS = [
  { stat: '₹10 Cr',    label: 'company built with my co-founders' },
  { stat: '100+',      label: 'founders funded or incubated across India' },
  { stat: 'Pan-India', label: 'one of the country’s growing startup communities' },
];

const FAILURES = [
  { name: 'Truscript',          line: 'A year of pivots, and everything I did not know about a domain.' },
  { name: 'Designity Services', line: 'Profitable enough to survive. Not interesting enough to continue.' },
  { name: 'Echo',               line: 'Real revenue, real payouts, unit economics that never worked.' },
];

const BELIEFS = [
  { title: 'Keep trying.',                        body: 'Stopping guarantees failure. Trying again only creates another possibility.' },
  { title: 'Take the risk.',                      body: 'I don’t calculate every risk. Uncertainty is usually where the interesting things begin.' },
  { title: 'Stay curious.',                       body: 'I rarely know where I’m going. Exploring has taken me further than having it figured out ever did.' },
  { title: 'Feel deeply.',                        body: 'Five years ago I would have picked practicality over emotion. I think emotion has made me a better person.' },
  { title: 'Build a life, not only a career.',    body: 'Success should give you a better life — not take your life away from you.' },
];

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Dilse stores relative cover paths (e.g. /aksharaala-nuvve.jpg) — those files
// live in the Dilse app, not here.
const coverUrl = (u: string | null) =>
  !u ? null : u.startsWith('http') ? u : `${DILSE_URL}${u}`;

// Short stories have no cover art of their own, so fall back to a drawing
// picked off the genre.
function storyArt(genre: string | null) {
  const g = (genre || '').toLowerCase();
  if (/love|romance|heart/.test(g)) return '/story-love.svg';
  if (/suspense|thriller|mystery|crime|horror/.test(g)) return '/story-suspense.svg';
  return '/story-default.svg';
}

type WritingCard = {
  key: string;
  kind: 'Book' | 'Story';
  title: string;
  href: string;
  img: string;
  meta: string;
};

// Books first (newest first), then every published short story. Capped at 24
// each so the row can't balloon if the archive grows.
async function getWriting(): Promise<WritingCard[]> {
  const [booksRes, storiesRes] = await Promise.all([
    dilse
      .from('books')
      .select('id, slug, title, description, cover_url, published_at, date_display, genre')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(24),
    dilse
      .from('stories')
      .select('id, slug, title, excerpt, cover_url, published_at, read_time, genre')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(24),
  ]);

  const books = (booksRes.data || []) as DilseBook[];
  const stories = (storiesRes.data || []) as DilseStory[];

  const cards: WritingCard[] = books.map((b) => ({
    key: `book-${b.id}`,
    kind: 'Book',
    title: b.title,
    href: `${DILSE_URL}/books`,
    img: '/book.svg',
    meta: ['Book', b.genre, b.date_display || (b.published_at && fmt(b.published_at))]
      .filter(Boolean)
      .join(' · '),
  }));

  for (const s of stories) {
    cards.push({
      key: `story-${s.id}`,
      kind: 'Story',
      title: s.title,
      href: `${DILSE_URL}/story/${s.slug}`,
      img: coverUrl(s.cover_url) || storyArt(s.genre),
      meta: [s.genre, s.published_at && fmt(s.published_at), s.read_time].filter(Boolean).join(' · '),
    });
  }

  return cards;
}

export default async function HomePage() {
  const [writing, a] = await Promise.all([getWriting(), getAuthor()]);

  // This page IS the author profile — the Person node lives here, and every
  // byline across the blogs points at AUTHOR_URL (this URL). Credentials,
  // email, location and the writing disclosure are carried in the markup
  // only; they are deliberately not rendered anywhere on the page.
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: a.name,
    jobTitle: a.role || undefined,
    description: a.bio || undefined,
    image: a.image_url || undefined,
    url: AUTHOR_URL,
    email: a.email || undefined,
    address: a.location || undefined,
    disambiguatingDescription: a.credentials || undefined,
    publishingPrinciples: a.disclosure
      ? { '@type': 'CreativeWork', name: 'How these posts are written', text: a.disclosure }
      : undefined,
    // Every link pasted in the CMS becomes an identity signal here.
    sameAs: a.links.map((l) => l.url),
    knowsAbout: ['personal finance', 'entrepreneurship', 'software products', 'writing'],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(person) }} />
      {/* ------------------------------------------------------------ hero */}
      <section className="border-b border-line">
        <div className="max-w-6xl mx-auto px-5 md:px-8 pt-12 md:pt-16 pb-16 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink2 mb-6">
              <span className="h-2 w-2 rounded-full bg-amber" />
              Hey, I&apos;m Teja
            </p>
            <h1 className="text-[40px] sm:text-5xl md:text-[62px] font-black tracking-[-0.035em] leading-[1.05] mb-6">
              Entrepreneur. Writer.
              <br />
              Explorer.
            </h1>
            <p className="text-[17px] text-ink2 leading-relaxed max-w-md mb-9">
              I solve difficult problems, and write stories inspired by people,
              emotions, and everything I explore along the way.
            </p>

            <div className="flex flex-wrap items-center gap-6">
              <a
                href="#work"
                className="inline-flex items-center gap-2 rounded-full bg-ink text-white text-sm font-semibold px-6 py-3.5 hover:bg-ink2 transition-colors"
              >
                Explore My Work <ArrowRight size={15} />
              </a>
              <a href="#about" className="inline-flex items-center gap-1.5 py-2 -my-2 text-sm font-semibold hover:text-ink2 transition-colors">
                Know Me Better <ArrowDown size={15} />
              </a>
            </div>
          </div>

          {/* portrait + handwritten annotations */}
          <div className="relative md:pl-10 md:pr-10">
            <p className="hidden lg:block handwritten absolute left-0 top-8 w-36 text-[19px] leading-tight text-ink2 -rotate-6">
              Curious enough to explore. Bold enough to build.
            </p>

            {/* hand-drawn arrow pointing at the portrait */}
            <svg
              viewBox="0 0 60 40"
              aria-hidden="true"
              className="hidden lg:block absolute left-20 top-[124px] w-14 text-ink2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6c9-5 17 1 14 9-2 6-9 6-10 1-1-6 7-9 15-7 9 2 17 8 24 15" />
              <path d="M38.5 24.5 47 24M44 16.5 47 24" />
            </svg>

            {/* photo + note travel together: centred on mobile, right-aligned from md */}
            <div className="relative mx-auto md:mr-0 w-full max-w-[290px]">
              <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-neutral-200 via-neutral-300 to-neutral-400 grid place-items-center">
                <img src="/teja.jpg" alt="Teja" className="h-full w-full object-cover" />
              </div>

              <div className="absolute -bottom-6 right-0 md:-right-14 w-[118px] rotate-[7deg] bg-note shadow-sm px-4 py-4">
                <p className="handwritten text-[17px] leading-[1.35] text-ink2">
                  Hey, I&apos;m from
                  <br />
                  Hyderabad
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- about */}
      <section id="about" className="border-b border-line scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20 grid md:grid-cols-2 gap-14">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">About</p>
            <h2 className="text-4xl font-black tracking-[-0.03em] mb-6">A little about me.</h2>
            <p className="text-[15px] text-ink2 leading-relaxed max-w-md mb-8">
              I&apos;m Teja — an entrepreneur, author, and someone who has learned
              most things by trying, failing, and trying again. From creating 200+
              YouTube videos to building multiple startups and writing stories,
              curiosity has taken me places I never planned to go.
            </p>
            <a
              href="#build"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-card text-sm font-medium px-5 py-3 hover:border-ink/40 transition-colors"
            >
              Know what I do today <ArrowRight size={15} />
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 sm:gap-y-10 md:pt-2">
            {PILLARS.map((p) => (
              <div key={p.title}>
                <p.icon size={22} strokeWidth={1.6} className="mb-4" />
                <p className="font-bold mb-1.5">{p.title}</p>
                <p className="text-[14px] text-ink2 leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- story */}
      <section id="story" className="border-b border-line bg-paper2 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">My story</p>
          <h2 className="text-4xl md:text-5xl font-black tracking-[-0.03em] leading-[1.08] max-w-2xl mb-6">
            My life is a story about exploration.
          </h2>
          <p className="text-[17px] text-ink2 leading-relaxed max-w-xl mb-14">
            I never planned to become an entrepreneur. I was just curious — and every
            exploration kept leading somewhere I didn&apos;t expect.
          </p>

          <div className="border-t border-line max-w-4xl">
            {CHAPTERS.map((c) => (
              <div key={c.year} className="grid md:grid-cols-[130px_1fr] gap-2 md:gap-10 border-b border-line py-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted md:pt-1.5">
                  {c.year}
                </p>
                <div className="max-w-2xl">
                  <p className="text-xl font-bold tracking-[-0.02em] mb-2">{c.title}</p>
                  <p className="text-[15px] text-ink2 leading-[1.75]">{c.body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xl md:text-2xl font-bold tracking-[-0.02em] max-w-2xl mt-12">
            I kept exploring, and every exploration led me somewhere unexpected.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- 18startup */}
      <section id="build" className="border-b border-line scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">What I do today</p>
          <h2 className="text-4xl font-black tracking-[-0.03em] mb-10">I make things work.</h2>

          <div className="grid md:grid-cols-2 gap-10 md:gap-16 max-w-4xl">
            <div>
              <p className="text-[15px] text-ink2 leading-[1.75] mb-4">
                I&apos;m the Co-Founder and COO of <strong className="font-bold text-ink">18startup</strong>,
                where we help early-stage founders — mostly first-time founders — become
                better executors and get themselves investor-ready.
              </p>
              <p className="text-[15px] text-ink2 leading-[1.75]">
                Most early founders don&apos;t lack ambition. They lack execution: how to
                move fast, avoid expensive mistakes, and spend limited resources wisely.
                That&apos;s the part I work on.
              </p>
            </div>
            <div>
              <p className="text-[15px] text-ink2 leading-[1.75] mb-4">
                My strength was never coming up with ideas. It&apos;s taking something
                complicated, uncertain and messy and figuring out how to keep it moving —
                operations, marketing, execution, resourcing, and some technology.
              </p>
              <p className="text-lg font-bold tracking-[-0.02em] leading-snug">
                &ldquo;Startups don&apos;t survive because they have the best ideas. They
                survive because someone figures out how to keep going when things get
                difficult.&rdquo;
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-8 border-t border-line mt-14 pt-10 max-w-4xl">
            {STATS.map((s) => (
              <div key={s.stat}>
                <p className="text-4xl font-black tracking-[-0.03em] mb-2">{s.stat}</p>
                <p className="text-[13px] text-muted leading-relaxed">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-line mt-12 pt-10 max-w-4xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-7">
              Things that didn&apos;t work
            </p>
            <div className="grid sm:grid-cols-3 gap-8">
              {FAILURES.map((f) => (
                <div key={f.name}>
                  <p className="font-bold mb-1.5">{f.name}</p>
                  <p className="text-[14px] text-ink2 leading-relaxed">{f.line}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ work */}
      <section id="work" className="border-b border-line bg-paper2 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">My other work</p>
          <div className="flex flex-wrap items-end justify-between gap-4 mb-9">
            <h2 className="text-4xl font-black tracking-[-0.03em] max-w-xl">
              I&apos;m curious about building tech projects.
            </h2>
            <a href="#contact" className="inline-flex items-center gap-1.5 py-2 -my-2 text-sm font-medium text-ink2 hover:text-ink transition-colors">
              Talk about one <ArrowRight size={15} />
            </a>
          </div>

          {/* one sliding row: native scroll + snap, full-bleed while scrolling */}
          <div className="slide-row flex gap-5 overflow-x-auto snap-x snap-mandatory pb-3 -mx-5 px-5 scroll-pl-5 md:-mx-8 md:px-8 md:scroll-pl-8">
            {PROJECTS.map((p) => (
              // Only the live project is a link; the rest are inert cards.
              <a
                key={p.title}
                href={p.href ?? undefined}
                className={`group snap-start shrink-0 w-[262px] sm:w-[280px] rounded-xl border border-line bg-card overflow-hidden transition-colors ${
                  p.href ? 'hover:border-ink/30' : 'cursor-default'
                }`}
              >
                <div className={`aspect-[4/3] bg-gradient-to-br ${p.tint} p-5`}>
                  <img src={p.img} alt="" className="h-full w-full object-contain" />
                </div>
                <div className="p-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold mb-1">{p.title}</p>
                    <p className="text-[13px] text-ink2 leading-relaxed">{p.text}</p>
                  </div>
                  {p.href && (
                    <ArrowUpRight size={15} className="shrink-0 mt-1 text-muted group-hover:text-ink transition-colors" />
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- other side */}
      <section id="other" className="border-b border-line scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">The other side</p>
          <h2 className="text-4xl font-black tracking-[-0.03em] max-w-2xl mb-14">
            I also write. And I go looking for things.
          </h2>

          <div className="grid md:grid-cols-2 gap-12 md:gap-16 max-w-4xl">
            <div>
              <p className="text-2xl font-black tracking-[-0.02em] mb-4">The author</p>
              <p className="text-[15px] text-ink2 leading-[1.75] mb-4">
                My first book, <em className="italic">Aksharala Nuvve</em>, is a Telugu love
                story about two people, the sacrifices between them, and where those
                sacrifices lead. I wrote it as a gift. Somewhere in the middle of writing
                it, I realised I&apos;d found another world I wanted to explore.
              </p>
              <p className="text-[15px] text-ink2 leading-[1.75]">
                Since then: short stories, and a slow drift from love stories toward
                suspense and thrillers. Entrepreneurship taught me how people behave when
                things get difficult. Writing taught me to pay attention to those moments.
                I&apos;m working on the next book now.
              </p>
            </div>

            <div>
              <p className="text-2xl font-black tracking-[-0.02em] mb-4">The explorer</p>
              <p className="text-[15px] text-ink2 leading-[1.75] mb-4">
                Outside work: music, writing, travel, riding, treks, beaches, mountains,
                and a fairly persistent habit of going somewhere I haven&apos;t been.
                Adventure isn&apos;t a weekend hobby for me — it&apos;s most of how I&apos;m built.
              </p>
              <p className="text-[15px] text-ink2 leading-[1.75]">
                It shows up at work too. The problems I want are the ones that are
                genuinely hard, genuinely urgent, and that most people quietly avoid.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- writing */}
      <section id="writing" className="border-b border-line scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">Dilse writings</p>
          <div className="flex flex-wrap items-end justify-between gap-4 mb-9">
            <h2 className="text-4xl font-black tracking-[-0.03em] max-w-xl">
              Recent books &amp; short stories.
            </h2>
            <a
              href={`${DILSE_URL}/short-stories`}
              className="inline-flex items-center gap-1.5 py-2 -my-2 text-sm font-medium text-ink2 hover:text-ink transition-colors"
            >
              Read all stories <ArrowRight size={15} />
            </a>
          </div>

          {writing.length === 0 ? (
            <p className="text-[15px] text-ink2">
              My books and stories live on{' '}
              <a href={DILSE_URL} className="font-semibold text-ink underline underline-offset-4">Dilse</a>{' '}
              — the latest ones show up here as they go out.
            </p>
          ) : (
            <div className="slide-row flex gap-5 overflow-x-auto snap-x snap-mandatory pb-3 -mx-5 px-5 scroll-pl-5 md:-mx-8 md:px-8 md:scroll-pl-8">
              {writing.map((w) => (
                <a
                  key={w.key}
                  href={w.href}
                  className="group snap-start shrink-0 w-[262px] sm:w-[280px] rounded-xl border border-line bg-card overflow-hidden hover:border-ink/30 transition-colors"
                >
                  <img src={w.img} alt="" className="aspect-[16/9] w-full object-cover" />
                  <div className="p-4">
                    <p className="font-semibold leading-snug mb-2 group-hover:underline underline-offset-4">
                      {w.title}
                    </p>
                    <p className="text-[12px] text-muted">{w.meta}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- beliefs */}
      <section id="beliefs" className="border-b border-line bg-paper2 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-4">What I believe</p>
          <h2 className="text-4xl font-black tracking-[-0.03em] mb-12">Five things I keep coming back to.</h2>

          <div className="border-t border-line max-w-3xl">
            {BELIEFS.map((b, i) => (
              <div key={b.title} className="grid grid-cols-[36px_1fr] gap-4 border-b border-line py-7">
                <span className="text-[12px] font-semibold text-muted pt-1.5">0{i + 1}</span>
                <div>
                  <p className="text-xl font-bold tracking-[-0.02em] mb-1.5">{b.title}</p>
                  <p className="text-[15px] text-ink2 leading-[1.75]">{b.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- contact */}
      <section id="contact" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-14">
          <div className="rounded-2xl bg-sage px-7 md:px-10 py-9 flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink2 mb-3">
                Let&apos;s connect
              </p>
              <h2 className="text-2xl md:text-[28px] font-black tracking-[-0.03em]">
                Have an idea, opportunity or just want to say hi?
              </h2>
            </div>
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-ink text-white text-sm font-semibold px-6 py-3.5 hover:bg-ink2 transition-colors"
            >
              Get in touch <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
