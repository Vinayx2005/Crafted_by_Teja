'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const configured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Created on first use, so a missing setting shows a message instead of
// crashing the page while it is being built.
let client: SupabaseClient | null = null;
export const supabase = (): SupabaseClient =>
  (client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''));

// Calls the server (AI, YouTube, feeds) with the signed-in session, so only
// team members get answers.
export async function api<T = any>(action: string, body: object = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase().auth.getSession();
  const res = await fetch('/api/studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
