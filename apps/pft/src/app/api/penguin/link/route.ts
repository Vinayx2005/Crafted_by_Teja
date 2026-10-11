// POST /api/penguin/link
// Called by the /connect-penguin page once the user is signed in. Mints a SEPARATE session for the same user
// (so Penguin never shares the browser's rotating refresh token and can't log the browser out) and returns it
// together with the public Supabase details Penguin needs to refresh it.
//
// Auth: Authorization: Bearer <the user's Supabase access token>.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceRoleKey) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'Missing auth' }, { status: 401 });

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceRoleKey, opts);
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  const email = u?.user?.email;
  if (uErr || !email) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // A magic-link token exchanged server-side = a brand-new session for this user. No email is sent.
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link?.properties?.hashed_token;
  if (lErr || !hashed) return NextResponse.json({ error: 'Could not create a Penguin session' }, { status: 500 });

  const { data: v, error: vErr } = await createClient(url, anon, opts).auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (vErr || !v.session) return NextResponse.json({ error: 'Could not create a Penguin session' }, { status: 500 });

  return NextResponse.json({
    email,
    access_token: v.session.access_token,
    refresh_token: v.session.refresh_token,
    supabase_url: url,
    anon_key: anon,
  });
}
