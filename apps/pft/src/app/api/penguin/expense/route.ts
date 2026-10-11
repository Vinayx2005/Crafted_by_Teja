// POST /api/penguin/expense
// Used by the Penguin voice assistant: "Spent 1000 rupees on pani puri today from SBI".
// Same pipeline as Quick Add — Gemini parses the sentence against the user's real banks and
// categories, the category is created if new, and the expense is posted to the matching bank.
//
// Auth: the user's own Supabase access token (Penguin gets one via "Connect" in its Apps panel, see
// /connect-penguin). Everything runs as that user under RLS, exactly like the browser does.
//
// Body:  { transcript: string }
// Reply: { ok: true, id, amount, description, category, bank, date, createdCategory }
//    or  { ok: false, error }   (error is a sentence Penguin can read aloud)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseExpenseWithGemini, GeminiParseError } from '@/lib/geminiExpense';
import { parseVoiceInput } from '@/lib/voiceParse';

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return fail('Server not configured', 500);

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return fail('Unauthorized', 401);

  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    db: { schema: 'pft' },
  });
  const { data: u, error: uErr } = await db.auth.getUser(jwt);
  if (uErr || !u?.user) return fail('Penguin is not signed in to PFT any more. Connect it again in the Apps panel', 401);
  const uid = u.user.id;

  const body = (await req.json().catch(() => ({}))) as { transcript?: string };
  const transcript = (body.transcript || '').trim().slice(0, 500);
  if (!transcript) return fail('Missing transcript', 400);

  const [{ data: banks, error: bErr }, { data: cats, error: cErr }] = await Promise.all([
    db.from('banks').select('id, bank_name').eq('is_active', true),
    db.from('categories').select('id, name').eq('type', 'expense'),
  ]);
  if (bErr || cErr) return fail('Could not read your banks and categories', 500);

  const bankList = (banks || []).map((b) => b.bank_name);
  const catList = (cats || []).map((c) => c.name);
  let draft: { amount: number | null; description: string; category: string | null; bank: string | null; date: string };
  try {
    draft = await parseExpenseWithGemini(transcript, bankList, catList);
  } catch (err) {
    if (!(err instanceof GeminiParseError)) throw err;
    // Same graceful degradation as browser Quick Add: when Gemini is down or out of quota, use the local regex parser.
    draft = parseVoiceInput(transcript, bankList, catList);
  }

  const bankNames = (banks || []).map((b) => b.bank_name).join(', ') || 'none set up';
  if (!draft.amount) return fail('I did not catch the amount', 422);
  if (!draft.bank) return fail(`Which bank? You have ${bankNames}`, 422);

  // Exact bank match wins over substring ("SBI" vs "SBI Credit Card"), same as Quick Add.
  const kw = draft.bank.toLowerCase();
  const exact = (banks || []).find((b) => b.bank_name.toLowerCase() === kw);
  const matches = exact ? [exact] : (banks || []).filter((b) => b.bank_name.toLowerCase().includes(kw));
  if (matches.length === 0) return fail(`No bank matches ${draft.bank}. You have ${bankNames}`, 422);
  if (matches.length > 1) return fail(`${draft.bank} matches ${matches.map((b) => b.bank_name).join(' and ')}. Say which one`, 422);
  const bank = matches[0];

  const catName = draft.category || 'Other';
  let category = (cats || []).find((c) => c.name.toLowerCase() === catName.toLowerCase());
  let createdCategory = false;
  if (!category) {
    const { data: newCat, error } = await db
      .from('categories')
      .upsert({ type: 'expense', name: catName, is_default: false, user_id: uid }, { onConflict: 'user_id,type,name' })
      .select('id, name')
      .single();
    if (error || !newCat) return fail('Could not create the category', 500);
    category = newCat;
    createdCategory = true;
  }

  const description = draft.description || category.name;
  const { data: inserted, error: insErr } = await db
    .from('transactions')
    .insert({
      transaction_type: 'expense',
      bank_id: bank.id,
      category_id: category.id,
      description,
      amount: draft.amount,
      transaction_date: draft.date,
      notes: 'via penguin',
      status: 'posted',
      created_by: uid,
    })
    .select('id')
    .single();
  if (insErr || !inserted) return fail('Could not save the expense', 500);

  // Best-effort audit trail, like Quick Add's logAction.
  await db.from('audit_log').insert({
    user_id: uid,
    action: 'create',
    table_name: 'transactions',
    record_id: inserted.id,
    description: `Penguin: ${draft.amount} · ${description} · ${category.name} / ${bank.bank_name}`,
    new_values: { amount: draft.amount, description, category: category.name, bank: bank.bank_name },
  });

  return NextResponse.json({ ok: true, id: inserted.id, amount: draft.amount, description, category: category.name, bank: bank.bank_name, date: draft.date, createdCategory });
}
