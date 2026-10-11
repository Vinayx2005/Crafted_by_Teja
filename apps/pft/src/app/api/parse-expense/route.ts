// POST /api/parse-expense
// Takes a user's spoken/typed expense sentence + their actual banks +
// their actual expense categories, calls Gemini to turn it into structured
// JSON, and returns the parsed fields. Auth-gated so this can't be abused
// to burn the free-tier quota anonymously.
//
// Body:  { transcript: string, banks: string[], categories: string[] }
// Reply: { amount, description, category, bank, date, missing }
//
// Falls back to a 502 when Gemini errors — the client-side helper then
// re-runs the local regex parser, so voice input degrades gracefully.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { parseExpenseWithGemini, GeminiParseError } from '@/lib/geminiExpense';

interface ParseBody {
  transcript?: string;
  banks?: string[];
  categories?: string[];
}

export async function POST(req: NextRequest) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    // Signals to the client-side helper to fall back to the regex parser.
    return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 501 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  // Auth — verify the caller's JWT so anonymous callers can't burn quota.
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    return NextResponse.json({ error: 'Missing auth' }, { status: 401 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db:   { schema: 'pft' },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ParseBody;
  const transcript = (body.transcript || '').trim();
  const banks = Array.isArray(body.banks) ? body.banks.filter(Boolean) : [];
  const categories = Array.isArray(body.categories) ? body.categories.filter(Boolean) : [];
  if (!transcript) {
    return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });
  }

  // The client can't tell us its timezone here, so it passes the offset via a header — falls back to IST (+05:30).
  const tzOffsetMin = parseInt(req.headers.get('x-tz-offset-min') || '', 10);
  try {
    const clean = await parseExpenseWithGemini(transcript, banks, categories, Number.isFinite(tzOffsetMin) ? tzOffsetMin : 330);
    return NextResponse.json({ ok: true, source: 'gemini', ...clean });
  } catch (err) {
    if (err instanceof GeminiParseError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    throw err;
  }
}
