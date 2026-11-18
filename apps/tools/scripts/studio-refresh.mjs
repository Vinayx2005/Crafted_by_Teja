// Daily refresh of every YouTube competitor in the Content Studio. Runs in
// GitHub Actions (.github/workflows/studio-refresh.yml). It asks the studio's
// own API to do the work, one creator at a time, so each call stays inside
// the site's time limit.
//
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to list the
// competitors) and STUDIO_CRON_SECRET (must match the one on the site).
// STUDIO_SITE_URL defaults to the live site; set it to test locally.

import { db } from '../src/lib/wa.mjs';

const SITE = (process.env.STUDIO_SITE_URL || 'https://tools.craftedbyteja.com').replace(/\/$/, '');
if (!process.env.STUDIO_CRON_SECRET) throw new Error('STUDIO_CRON_SECRET is not set');

async function call(action, body) {
  const res = await fetch(`${SITE}/api/studio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.STUDIO_CRON_SECRET}` },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${action} ${res.status}: ${data.error ?? 'no detail'}`);
  return data;
}

// Least recently analysed first, so if the free limits run out the same
// creators don't get skipped every day. Instagram creators are pasted by hand,
// so there is nothing to refresh for them.
const list = await (await db('studio_competitors?select=id,name,page_id&platform=eq.youtube&order=analyzed_at.asc.nullsfirst')).json();
console.log(`refreshing ${list.length} creators on ${SITE}`);

let done = 0;
for (const c of list) {
  try {
    await call('fetchVideos', { competitorId: c.id });
    // Only new videos are watched, so this is usually 0-3 calls. Cap the loop anyway.
    for (let i = 0; i < 4; i++) if (!(await call('deepVideos', { competitorId: c.id })).remaining) break;
    await call('summarise', { competitorId: c.id });
    done++;
    console.log(`ok      ${c.name}`);
  } catch (e) {
    console.warn(`failed  ${c.name}: ${e.message}`);
    // Out of free quota: the rest would fail too. Tomorrow's run starts with them.
    if (/limit is used up|429/.test(e.message)) break;
  }
}
console.log(`done: ${done} of ${list.length} refreshed`);

// Then one combined playbook per page from everything just learned.
for (const pageId of [...new Set(list.map((c) => c.page_id))]) {
  try {
    await call('consolidate', { pageId });
    console.log(`playbook updated for page ${pageId.slice(0, 8)}`);
  } catch (e) {
    console.warn(`playbook failed for page ${pageId.slice(0, 8)}: ${e.message}`);
  }
}
if (list.length && !done) process.exit(1);
