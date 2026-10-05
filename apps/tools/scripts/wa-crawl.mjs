// Daily crawler for the WhatsApp Group Finder. Runs in GitHub Actions
// (.github/workflows/wa-crawl.yml); needs NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and GITHUB_TOKEN.
//
// Sources are only ones that allow automated access: GitHub's search API and
// Hacker News' Algolia API. WhatsApp itself is never fetched.
//
//   node apps/tools/scripts/wa-crawl.mjs           crawl + insert
//   node apps/tools/scripts/wa-crawl.mjs --dry     crawl + print, no DB

import { TOPICS, classify, findCity, findLinks, isBlocked, isEnglish, db } from '../src/lib/wa.mjs';

const DRY = process.argv.includes('--dry');
const MAX_INSERTS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const GENERIC = /\b(join|joining|our|the|my|this|a|an|here|link|links|click|whatsapp|group|groups|channel|community|chat|invite|us|on|to|via|please|and|or|for|at|is)\b/gi;

// Best guess at a link's name: markdown/HTML link text, else the rest of its line.
function nameFor(text, link) {
  const raw = link.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const md = text.match(new RegExp(`\\[([^\\]]{3,100})\\]\\([^)]*${raw}`));
  const html = text.match(new RegExp(`${raw}[^>]*>([^<]{3,100})<`));
  const line = text.slice(text.lastIndexOf('\n', link.index) + 1).split('\n')[0];
  for (const candidate of [md?.[1], html?.[1], line]) {
    if (!candidate) continue;
    const name = candidate
      .replace(/https?:\/\/\S+|\S*whatsapp\.com\/\S+/gi, '')
      .replace(/<[^>]+>|[*_`#>|\[\]()]|\+?\d[\d\s-]{8,}\d/g, '')
      .replace(/^[\s\-–•:"']+|[\s\-–•:"']+$/g, '')
      .trim();
    // A line of code, leftover HTML, or a "GitHub · Telegram · WhatsApp" footer — not a name.
    if (/[=;{}$<]|\/\/|\b(const|let|var|href|function|github|instagram|linkedin|telegram|discord|twitter)\b/i.test(name)) continue;
    if (name.replace(GENERIC, '').replace(/[^a-z0-9]/gi, '').length >= 4 && name.length <= 100) return name;
  }
  return null;
}

const found = new Map();

// Only links with a real name and a recognisable topic get in; everything
// else from the open web is overwhelmingly bots, class chats and dead projects.
function collect(text, { title, titleIsName, context, sourceUrl, source }) {
  text = decode(text);
  for (const link of findLinks(text)) {
    if (found.has(link.url)) continue;
    const name = nameFor(text, link) || (titleIsName ? title : null);
    if (!name || name.length < 3) continue;
    const line = text.slice(text.lastIndexOf('\n', link.index) + 1).split('\n')[0];
    // Tags, URLs and phone numbers out.
    const about = line.replace(/<[^>]+>|https?:\/\/\S+|\+?\d[\d\s-]{8,}\d/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    const all = `${name} ${about ?? ''} ${title ?? ''} ${context ?? ''}`;
    const topic = classify(all);
    if (!topic || isBlocked(all) || !isEnglish(`${name} ${about ?? ''}`)) continue;
    found.set(link.url, {
      url: link.url,
      kind: link.kind,
      name: name.slice(0, 100),
      about: about && about !== name ? about : null,
      topic,
      city: findCity(all),
      source,
      source_url: sourceUrl,
    });
  }
}

// READMEs and docs only: source files are mostly bots with hard-coded links.
async function github(q) {
  const res = await fetch(`https://api.github.com/search/code?per_page=100&q=${encodeURIComponent(q)}`, {
    headers: {
      Accept: 'application/vnd.github.text-match+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'User-Agent': 'craftedbyteja-wa-crawl',
    },
  });
  if (!res.ok) return console.warn(`github "${q}": ${res.status}`);
  for (const item of (await res.json()).items ?? []) {
    const repo = item.repository;
    for (const m of item.text_matches ?? []) {
      collect(m.fragment, {
        title: repo.name.replace(/[-_.]+/g, ' '),
        context: repo.description,
        sourceUrl: item.html_url,
        source: 'github',
      });
    }
  }
}

async function hackerNews(q) {
  const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?hitsPerPage=200&query=${encodeURIComponent(q)}`);
  if (!res.ok) return console.warn(`hn "${q}": ${res.status}`);
  for (const hit of (await res.json()).hits) {
    collect((hit.comment_text ?? hit.story_text ?? '').replace(/<p>/g, '\n'), {
      title: hit.story_title ?? hit.title,
      titleIsName: true,
      sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: 'hn',
    });
  }
}

// A different keyword per topic each day, so every run turns up new READMEs.
const day = Math.floor(Date.now() / 864e5);
for (const host of ['chat.whatsapp.com', 'whatsapp.com/channel']) {
  await hackerNews(host);
  if (!process.env.GITHUB_TOKEN) continue;
  for (const topic of TOPICS) {
    await github(`"${host}" ${topic.words[day % topic.words.length]} extension:md`);
    await sleep(7000); // code search allows 10 requests a minute
  }
}

const rows = [...found.values()].slice(0, MAX_INSERTS);
console.log(`found ${found.size} links, inserting ${rows.length}`);
if (DRY) {
  for (const r of rows) console.log(`${r.topic.padEnd(10)} ${(r.city ?? '').padEnd(10)} ${r.name} — ${r.url}`);
} else if (rows.length) {
  // Existing URLs are skipped, so a link someone submitted keeps their name and topic.
  await db('wa_groups?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}
