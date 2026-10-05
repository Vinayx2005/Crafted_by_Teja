import type { Metadata } from 'next';
import { CITIES, TOPICS, db } from '@/lib/wa.mjs';
import { GroupCard, SubmitForm, type Group } from './client';

export const metadata: Metadata = {
  title: 'WhatsApp Group Finder · Crafted by Teja',
  description: 'Find WhatsApp groups and channels by topic and city: startups, tech, books, jobs, fitness and more. Free, no sign-up.',
};

export const dynamic = 'force-dynamic';

type Params = { q?: string; topic?: string; city?: string; kind?: string };

async function search({ q, topic, city, kind }: Params): Promise<Group[] | null> {
  const qs = new URLSearchParams({
    select: 'id,url,kind,name,about,topic,city,works,last_works',
    order: 'last_works.desc.nullslast,created_at.desc',
    limit: '60',
  });
  // Every word as a prefix, so "start" finds "startup" and "found" finds "founders".
  const words = q?.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 8);
  if (words?.length) qs.set('fts', `fts(english).${words.map((w) => `${w}:*`).join(' & ')}`);
  if (topic) qs.set('topic', `eq.${topic}`);
  if (city) qs.set('city', `eq.${city}`);
  if (kind === 'group' || kind === 'channel') qs.set('kind', `eq.${kind}`);
  try {
    return await (await db(`wa_groups_live?${qs}`)).json();
  } catch (e) {
    console.error('groups search failed:', e);
    return null;
  }
}

const field = 'bg-18-surface border border-18-border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-18-orange/60';

export default async function GroupsPage({ searchParams }: { searchParams: Params }) {
  const groups = await search(searchParams);
  const topicLabel = Object.fromEntries(TOPICS.map((t) => [t.key, t.label]));

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12 md:py-16">
      <section className="mb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-18-orange mb-3">WhatsApp Group Finder</p>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white leading-[1.05] mb-4">
          Find a WhatsApp group <span className="text-18-orange">for anything.</span>
        </h1>
        <p className="text-white/70 leading-relaxed">
          Groups and channels collected from public pages and added by their admins. Search by what you&apos;re into, filter by city.
        </p>
      </section>

      <form className="grid grid-cols-2 md:grid-cols-[1fr_auto_auto_auto] gap-2 mb-3" action="/groups">
        <input name="q" defaultValue={searchParams.q} placeholder="startup founders, book club, react…" aria-label="Search" className={`${field} col-span-2 md:col-span-1`} />
        <select name="topic" defaultValue={searchParams.topic ?? ''} aria-label="Topic" className={field}>
          <option value="">All topics</option>
          {TOPICS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          <option value="other">Other</option>
        </select>
        <select name="city" defaultValue={searchParams.city ?? ''} aria-label="City" className={field}>
          <option value="">Any city</option>
          {CITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="col-span-2 md:col-span-1 bg-18-orange hover:brightness-110 text-white font-semibold text-sm rounded-xl px-5 py-2.5">Search</button>
      </form>
      <p className="text-xs text-white/40 mb-8">
        After you tap Join, tell us if the link worked. Links that stop working or get reported as scams disappear on their own.
      </p>

      {groups === null ? (
        <p className="text-white/60 text-sm">Couldn&apos;t load groups right now. Try again in a minute.</p>
      ) : groups.length === 0 ? (
        <p className="text-white/60 text-sm">No groups match that yet. Know one? Add it below.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => <GroupCard key={g.id} group={g} topicLabel={topicLabel[g.topic] ?? 'Other'} />)}
        </div>
      )}

      <SubmitForm topics={TOPICS.map((t) => ({ key: t.key, label: t.label }))} cities={CITIES} />

      <p className="text-xs text-white/40 mt-10 leading-relaxed">
        Listings are found automatically or added by visitors. They aren&apos;t reviewed, so be careful: never share OTPs or pay anyone you meet in a group.
        Joining a group shows your phone number to its members. Admin of a listed group and want it gone? Reset the invite link in WhatsApp;
        the old one drops off once visitors mark it dead.
      </p>
    </div>
  );
}
