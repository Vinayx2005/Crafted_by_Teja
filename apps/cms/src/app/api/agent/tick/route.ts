// POST /api/agent/tick — runs a slice of queued blog-agent work.
//
// Called every minute by pg_cron while work is queued (migrations/blog_agent.sql)
// with x-agent-secret, and by the /agent page (signed-in JWT) so work starts
// right away. Claims are row-locked in SQL, so overlapping ticks are safe.

import { NextRequest, NextResponse } from 'next/server';
import { AUTHOR_ALLOWLIST } from '@/lib/allowlist';
import { db, research, outline, draft, savePost, Item, Seed } from '@/lib/agent';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ponytail: fixed batch per tick, keeps a tick well inside 300s. Raise if
// Gemini quota allows and a 100-post run feels slow (~4 drafts/minute now).
const SEEDS_PER_TICK = 2;
const ITEMS_PER_TICK = 4;

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the CMS' }, { status: 500 });
  }
  const sb = db();

  const secret = process.env.AGENT_CRON_SECRET;
  if (!(secret && req.headers.get('x-agent-secret') === secret)) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: null };
    const email = data?.user?.email?.toLowerCase();
    if (!email || !AUTHOR_ALLOWLIST.includes(email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const [{ data: seeds, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    sb.rpc('agent_claim_seeds', { n: SEEDS_PER_TICK }),
    sb.rpc('agent_claim_items', { n: ITEMS_PER_TICK }),
  ]);
  if (e1 || e2) return NextResponse.json({ error: (e1 || e2)!.message }, { status: 500 });

  await Promise.all([
    ...((seeds || []) as Seed[]).map(runSeed),
    ...((items || []) as Item[]).map(runItem),
  ]);
  return NextResponse.json({ seeds: seeds?.length || 0, items: items?.length || 0 });
}

async function runSeed(seed: Seed) {
  const sb = db();
  try {
    const ideas = await research(seed);
    const { error } = await sb.from('agent_items').insert(ideas.map((idea) => ({ seed_id: seed.id, site: seed.site, idea })));
    if (error) throw error;
    await sb.from('agent_seeds').update({ status: 'done', error: null, locked_at: null }).eq('id', seed.id);
  } catch (e: any) {
    // Stays queued; the claim function retries it, then parks it as failed.
    await sb.from('agent_seeds').update({ error: e.message || String(e), locked_at: null }).eq('id', seed.id);
  }
}

async function runItem(item: Item) {
  const sb = db();
  try {
    const { data: seed, error } = await sb.from('agent_seeds').select('*').eq('id', item.seed_id).single();
    if (error) throw error;
    const done = { note: null, error: null, locked_at: null, attempts: 0 };

    if (item.stage === 'outline_queued') {
      const { plan, outline_md } = await outline(item, seed as Seed);
      await sb.from('agent_items').update({ ...done, stage: 'outline_review', plan, outline_md }).eq('id', item.id);
    } else {
      const { body, cover, seo } = await draft(item, seed as Seed);
      const post_id = await savePost(item, body, cover);
      await sb.from('agent_items').update({ ...done, stage: 'draft_review', seo, post_id }).eq('id', item.id);
    }
  } catch (e: any) {
    await sb.from('agent_items').update({ error: e.message || String(e), locked_at: null }).eq('id', item.id);
  }
}
