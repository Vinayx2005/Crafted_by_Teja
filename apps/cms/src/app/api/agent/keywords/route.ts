// POST /api/agent/keywords — turns the editor's loose topics into the search
// terms a post should actually target.
//
// Lives on the server because the Gemini key does. Called straight from the
// Research form's "Generate keywords" button so the editor sees and can edit
// the keywords before committing to a research run.

import { NextRequest, NextResponse } from 'next/server';
import { AUTHOR_ALLOWLIST } from '@/lib/allowlist';
import { db, keywordsFromTopics, Site } from '@/lib/agent';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the CMS' }, { status: 500 });
  }

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data } = jwt ? await db().auth.getUser(jwt) : { data: null };
  const email = data?.user?.email?.toLowerCase();
  if (!email || !AUTHOR_ALLOWLIST.includes(email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { site, country, notes } = await req.json().catch(() => ({} as any));
  if (!notes?.trim()) return NextResponse.json({ error: 'Write your topics first' }, { status: 400 });

  try {
    const keywords = await keywordsFromTopics({
      site: (site === 'root' ? 'root' : 'pft') as Site,
      country: country || 'IN',
      notes: String(notes),
    });
    return NextResponse.json({ keywords });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
