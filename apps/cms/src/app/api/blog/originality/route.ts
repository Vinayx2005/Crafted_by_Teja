// POST /api/blog/originality — takes every sentence in a post and searches the
// web for each one, word for word.
//
// Every sentence in the body is checked, in batches — not a sample. A long
// post is therefore several search calls and can take a couple of minutes,
// which is why it runs on demand rather than on every keystroke.

import { NextRequest, NextResponse } from 'next/server';
import { AUTHOR_ALLOWLIST } from '@/lib/allowlist';
import { db, allPhrases, phraseCheckAll } from '@/lib/agent';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data } = jwt ? await db().auth.getUser(jwt) : { data: null };
  const email = data?.user?.email?.toLowerCase();
  if (!email || !AUTHOR_ALLOWLIST.includes(email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { body_md } = await req.json().catch(() => ({} as any));
  if (!body_md?.trim()) return NextResponse.json({ error: 'Nothing to check yet' }, { status: 400 });

  if (!allPhrases(String(body_md)).length) return NextResponse.json({ sampled: 0, phrases: [] });

  try {
    const phrases = await phraseCheckAll(String(body_md));
    if (!phrases.length) return NextResponse.json({ error: 'The check could not run — try again' }, { status: 502 });
    return NextResponse.json({
      sampled: phrases.length,
      unchecked: phrases.filter((p) => p.unchecked).length,
      phrases,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
