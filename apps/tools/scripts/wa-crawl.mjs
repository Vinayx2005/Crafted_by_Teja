// Daily crawler for the WhatsApp Group Finder. Runs in GitHub Actions
// (.github/workflows/wa-crawl.yml); needs NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and GITHUB_TOKEN.
//
// Sources are only ones that allow automated access: GitHub's search API and
// Hacker News' Algolia API. WhatsApp itself is never fetched.
//
//   node apps/tools/scripts/wa-crawl.mjs           crawl + insert
//   node apps/tools/scripts/wa-crawl.mjs --dry     crawl + print, no DB

import { CITIES, TOPICS, badName, classify, findCities, findLinks, isBlocked, isEnglish, db } from '../src/lib/wa.mjs';

const DRY = process.argv.includes('--dry');
const MAX_INSERTS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

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
    if (!badName(name)) return name;
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
    const topics = classify(all);
    if (!topics.length || isBlocked(all) || !isEnglish(`${name} ${about ?? ''}`)) continue;
    found.set(link.url, {
      url: link.url,
      kind: link.kind,
      name: name.slice(0, 100),
      about: about && about !== name ? about : null,
      topics,
      cities: findCities(all),
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

// Each day: the next 3 keywords of every topic plus every city, in READMEs
// one day and GitHub Pages HTML the next, so runs keep turning up new pages.
const day = Math.floor(Date.now() / 864e5);
const ext = day % 2 ? 'html' : 'md';
const terms = TOPICS.flatMap((t) => [0, 1, 2].map((i) => t.words[(day * 3 + i) % t.words.length]))
  .concat(CITIES.filter((c) => c !== 'Online' && c !== 'Outside India').map((c) => c.split(' ')[0].toLowerCase()));
for (const host of ['chat.whatsapp.com', 'whatsapp.com/channel']) {
  await hackerNews(host);
  if (!process.env.GITHUB_TOKEN) continue;
  for (const term of new Set(terms)) {
    await github(`"${host}" ${term} extension:${ext}`);
    await sleep(6500); // code search allows 10 requests a minute
  }
}

const rows = [...found.values()].slice(0, MAX_INSERTS);
console.log(`found ${found.size} links, inserting ${rows.length}`);
if (DRY) {
  for (const r of rows) console.log(`${r.topics.join(',').padEnd(20)} ${r.cities.join(',').padEnd(12)} ${r.name} — ${r.url}`);
} else if (rows.length) {
  // Existing URLs are skipped, so a link someone submitted keeps their name and topic.
  await db('wa_groups?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}
