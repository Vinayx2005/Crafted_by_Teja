// Content Studio: server helpers. Identity, the database client, Gemini, usage
// limits and the cache. Server only (uses the Supabase service role key).

import { AsyncLocalStorage } from 'async_hooks';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/wa.mjs'; // generic service-role PostgREST client, shared with the group finder
import type { Principal } from './access';
import { HttpError } from './errors';
import { newRef } from './safety';

export { HttpError };

// A pooled connection that the other side has closed in the meantime fails with ECONNRESET on
// the next request (it happens after a quiet spell of ten seconds or so). That is harmless to
// repeat for a read, so reads and the sign-in check try again; writes are never repeated.
const transient = (e: unknown) => {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  return err?.name !== 'TimeoutError' && (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNREFUSED'].includes(err?.cause?.code ?? '') || /fetch failed/i.test(err?.message ?? ''));
};
async function retryRead<T>(fn: () => Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (n >= 2 || !transient(e)) throw e;
      console.warn(`network error, retrying (${(e as { cause?: { code?: string } })?.cause?.code ?? 'fetch failed'})`);
      await new Promise((r) => setTimeout(r, 300 * (n + 1)));
    }
  }
}

export const rows = async <T = any>(path: string): Promise<T[]> => retryRead(async () => (await db(path)).json());

export const insert = async <T = any>(path: string, body: object | object[], prefer = 'return=representation'): Promise<T[]> => {
  const res = await db(path, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(body) });
  return prefer.includes('minimal') ? [] : res.json();
};

export const patch = (path: string, body: object) => db(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = (path: string) => db(path, { method: 'DELETE' });

// Row count without downloading the rows.
export async function count(path: string): Promise<number> {
  const res = await retryRead(() => db(path, { method: 'HEAD', headers: { Prefer: 'count=exact' } }));
  return Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
}

// Who is calling. A signed-in person (checked with Supabase), or the daily job.
// What they may DO is decided afterwards by authorise() in access.ts, per resource.
export async function principal(req: Request): Promise<Principal> {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token) throw new HttpError(401, 'Sign in first.');
  // The daily refresh job (GitHub Actions) has no login, only this shared secret.
  const secret = process.env.STUDIO_CRON_SECRET;
  if (secret && secret.length >= 16 && token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return { kind: 'cron' };
  const res = await retryRead(() =>
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      cache: 'no-store',
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${token}` },
    }),
  );
  if (!res.ok) throw new HttpError(401, 'Your session expired. Sign in again.');
  const u = await res.json();
  const email = String(u.email ?? '').toLowerCase();
  if (!u.id || !email) throw new HttpError(401, 'Your session expired. Sign in again.');
  return { kind: 'user', id: u.id, email };
}

// The email behind an account id (Supabase keeps it, we do not copy it).
export async function emailOf(userId: string): Promise<string | null> {
  const res = await retryRead(() =>
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      cache: 'no-store',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}` },
    }),
  );
  return res.ok ? String((await res.json()).email ?? '').toLowerCase() || null : null;
}

// People who may create new organisations (everyone else joins by invitation).
export const isPlatformAdmin = (email: string) =>
  (process.env.STUDIO_PLATFORM_ADMINS ?? '').toLowerCase().split(/[,\s]+/).filter(Boolean).includes(email.toLowerCase());

// ─── AI usage: limits and tracking ─────────────────────────────────────
type Usage = { organisationId: string; userId: string | null; action: string };
const usageContext = new AsyncLocalStorage<Usage>();

// Everything the action does with Gemini is counted against this organisation.
export const withUsage = <T>(u: Usage, fn: () => Promise<T>): Promise<T> => usageContext.run(u, fn);

const orgDaily = () => Number(process.env.STUDIO_ORG_DAILY_AI_LIMIT) || 300;
const userMinute = () => Number(process.env.STUDIO_USER_MINUTE_AI_LIMIT) || 20;

// Pure, so it is easy to test. The daily job (no user) is not held to the limits, only counted.
export function usageDecision(c: { orgDay: number; userMinute: number }, hasUser: boolean, limits = { org: orgDaily(), user: userMinute() }): string | null {
  if (!hasUser) return null;
  if (c.orgDay >= limits.org) return 'Your organisation has used its AI limit for today. It frees up gradually over the next 24 hours.';
  if (c.userMinute >= limits.user) return 'That is a lot of requests in a minute. Wait a moment and try again.';
  return null;
}

async function checkUsage(u: Usage) {
  const since = (ms: number) => encodeURIComponent(new Date(Date.now() - ms).toISOString());
  const base = `studio_ai_usage?select=id&organisation_id=eq.${u.organisationId}`;
  const [orgDay, user] = await Promise.all([
    u.userId ? count(`${base}&created_at=gte.${since(864e5)}`) : 0,
    u.userId ? count(`${base}&user_id=eq.${u.userId}&created_at=gte.${since(6e4)}`) : 0,
  ]);
  const stop = usageDecision({ orgDay, userMinute: user }, !!u.userId);
  if (stop) throw new HttpError(429, stop);
}

const recordUsage = (u: Usage, model: string) =>
  insert('studio_ai_usage', { organisation_id: u.organisationId, user_id: u.userId, action: u.action, model }, 'return=minimal').catch((e) => console.error('usage not recorded:', e));

// ─── Gemini ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiOpts = { lite?: boolean; json?: boolean; video?: string; timeoutMs?: number; noThink?: boolean; inline?: { mime: string; data: string } };

export async function gemini(prompt: string, o: GeminiOpts = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(501, 'GEMINI_API_KEY is not set on the tools app.');
  // "lite" is a cheaper model with its own free quota, used for bulk work.
  const model = o.lite
    ? process.env.STUDIO_LITE_MODEL || 'gemini-flash-lite-latest'
    : process.env.STUDIO_MODEL || 'gemini-flash-latest';
  const usage = usageContext.getStore();
  if (usage) await checkUsage(usage);

  const parts: object[] = [];
  if (o.video) parts.push({ file_data: { file_uri: o.video } });
  if (o.inline) parts.push({ inline_data: { mime_type: o.inline.mime, data: o.inline.data } });
  parts.push({ text: prompt });

  // noThink skips Gemini's slow internal reasoning: for long scripts it is the difference between 30 seconds and over a minute.
  // The body is read here too, so a connection that drops mid-answer is retried like one that drops at the start.
  const call = async (think = !o.noThink): Promise<Response> => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { ...(o.json ? { responseMimeType: 'application/json' } : {}), ...(think ? {} : { thinkingConfig: { thinkingBudget: 0 } }) },
      }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
    });
    return new Response(await r.text(), { status: r.status, statusText: r.statusText });
  };

  // Overload and rate-limit blips are common on the free tier: wait, retry twice.
  // A dropped connection (ECONNRESET and the like) is common and passes on a second try.
  // A timeout is not retried: it would only time out again.
  const net = async (think?: boolean): Promise<Response> => {
    for (let n = 0; ; n++) {
      try {
        return await call(think);
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        if (err?.name === 'TimeoutError' || n >= 2) throw e;
        console.warn(`gemini network error, retrying (${err?.cause?.code ?? err?.message})`);
        await sleep(1500 * (n + 1));
      }
    }
  };
  let res: Response;
  try {
    res = await net();
    // A model that does not accept the no-thinking setting: ask again without it.
    if (res.status === 400 && o.noThink) res = await net(true);
  } catch (e) {
    if ((e as Error)?.name === 'TimeoutError') throw new HttpError(504, 'The AI took too long. Try a shorter length, or try again.');
    throw e;
  }
  for (let wait = 4000; [429, 500, 503].includes(res.status) && wait <= 12_000; wait *= 3) {
    await sleep(wait);
    res = await net().catch((e) => { throw (e as Error)?.name === 'TimeoutError' ? new HttpError(504, 'The AI took too long. Try a shorter length, or try again.') : e; });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, 'Gemini’s free limit is used up for now. Wait a minute, or try again tomorrow.');
    // What Google says can carry internal detail. It goes to the log, not to the screen.
    const ref = newRef();
    console.error(`gemini ${res.status} [${ref}]:`, data?.error?.message ?? res.statusText);
    throw new HttpError(502, `The AI service had a problem (ref ${ref}). Try again in a moment.`);
  }
  if (usage) void recordUsage(usage, model);
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('');
  if (!text.trim()) throw new HttpError(502, `Gemini returned nothing (${data?.candidates?.[0]?.finishReason ?? 'no candidates'}).`);
  return text;
}

export function parseJson<T>(text: string): T {
  const s = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start < 0 || end < start) throw new HttpError(502, 'Gemini did not return usable JSON. Try again.');
  return JSON.parse(s.slice(start, end + 1));
}

export const askJson = async <T>(prompt: string, o: GeminiOpts = {}): Promise<T> =>
  parseJson<T>(await gemini(prompt, { ...o, json: true }));

// Free-tier quotas are tight, so API results are reused for a while.
export async function cached<T>(key: string, ttlMs: number, fresh: boolean, make: () => Promise<T>): Promise<T> {
  const k = encodeURIComponent(key);
  if (!fresh) {
    const [hit] = await rows(`studio_cache?select=data,at&key=eq.${k}`);
    if (hit && Date.now() - Date.parse(hit.at) < ttlMs) return hit.data as T;
  }
  const data = await make();
  await insert('studio_cache?on_conflict=key', { key, data, at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
  return data;
}
