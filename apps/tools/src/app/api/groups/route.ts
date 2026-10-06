import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { CITIES, TOPIC_KEYS, canonical, db, isBlocked } from '@/lib/wa.mjs';

const VOTES = ['works', 'broken', 'scam'];
const MAX_SUBMITS_PER_DAY = 5;

// Hashed so we can count one vote / a few submissions per visitor without storing IPs.
function visitor(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  return createHash('sha256').update(ip + process.env.SUPABASE_SERVICE_ROLE_KEY).digest('hex').slice(0, 32);
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const who = visitor(req);

  if (body.action === 'vote') {
    if (!Number.isInteger(body.id) || !VOTES.includes(body.vote)) return fail('Bad vote');
    await db('wa_votes?on_conflict=group_id,voter', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ group_id: body.id, voter: who, vote: body.vote, created_at: new Date().toISOString() }),
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'submit') {
    const link = canonical(body.link ?? '');
    const name = String(body.name ?? '').trim();
    const about = String(body.about ?? '').trim();
    const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : [v]).filter(Boolean).map(String))];
    const topics = list(body.topics);
    const cities = list(body.cities);
    if (!link) return fail('Paste one WhatsApp group or channel invite link.');
    if (name.length < 3 || name.length > 100) return fail('Name should be 3–100 characters.');
    if (about.length > 500) return fail('Description should be under 500 characters.');
    if (!topics.length || topics.length > 3 || !topics.every((t) => TOPIC_KEYS.includes(t))) return fail('Pick 1 to 3 topics.');
    if (cities.length > 5 || !cities.every((c) => CITIES.includes(c))) return fail('Pick up to 5 cities from the list.');
    if (isBlocked(`${name} ${about}`)) return fail('This looks like a kind of group we don’t list (trading tips, earning, betting, adult and similar).');

    const since = new Date(Date.now() - 864e5).toISOString();
    const recent = await db(`wa_groups?select=id&submitter=eq.${who}&created_at=gt.${since}`, {
      method: 'HEAD',
      headers: { Prefer: 'count=exact' },
    });
    if (Number(recent.headers.get('content-range')?.split('/')[1] ?? 0) >= MAX_SUBMITS_PER_DAY) {
      return fail('You’ve added a few groups today. Try again tomorrow.', 429);
    }

    const res = await db('wa_groups?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        url: link.url, kind: link.kind, name, about: about || null,
        topics, cities, source: 'submit', submitter: who,
      }),
    });
    if (!(await res.json()).length) return fail('That link is already listed.', 409);
    return NextResponse.json({ ok: true });
  }

  return fail('Unknown action');
}
