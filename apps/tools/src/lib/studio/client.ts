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
// Actions that only read or search, so asking again after a dropped connection can never
// save anything twice. (Writing a script is not on this list: if the answer was lost after
// the server saved it, asking again would write a second one.)
const SAFE_TO_REPEAT = new Set(['ideas', 'sources', 'search', 'playbook', 'org.list', 'brand.list', 'member.list', 'usage.get', 'knowledge.list', 'knowledge.get', 'knowledge.readPdf']);

export async function api<T = any>(action: string, body: object = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase().auth.getSession();
  const send = () =>
    fetch('/api/studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ action, ...body }),
    });
  let res: Response;
  try {
    res = await send().catch((e) => {
      if (!SAFE_TO_REPEAT.has(action)) throw e;
      return new Promise<Response>((resolve, reject) => setTimeout(() => send().then(resolve, reject), 1500));
    });
  } catch {
    // A phone drops its connection when the screen locks, the app is switched or the signal wobbles.
    // The browser then only says "Load failed" or "Failed to fetch".
    throw new Error('The connection was interrupted. Keep this screen open while it works, check your signal, and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
