// Step 0 of the organisations migration: a safety net. READ-ONLY.
//
//   node apps/tools/scripts/studio-backup.mjs
//
// 1. Exports every studio_* table to JSON in backups/studio-<timestamp>/ (git-ignored).
// 2. Writes a manifest: row count and SHA-256 per table, so a restore can be checked.
// 3. Records a baseline of every OTHER table the project exposes (columns, row
//    count, content hash), so after the migration we can prove nothing else moved.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Writes nothing to the database.

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function get(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// PostgREST returns at most 1000 rows per request, so read in pages.
async function all(table, order) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await get(`${table}?select=*&order=${order}&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const schema = await (await fetch(`${URL}/rest/v1/`, { headers })).json();
const defs = schema.definitions ?? {};
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = join('backups', `studio-${stamp}`);
mkdirSync(dir, { recursive: true });

const manifest = { taken_at: new Date().toISOString(), project: new globalThis.URL(URL).host, studio: {}, others: {} };

// The order column used for stable paging: the primary key, or the first column.
const orderOf = (name) => (name === 'studio_members' ? 'email' : name === 'studio_cache' ? 'key' : Object.keys(defs[name].properties).includes('id') ? 'id' : Object.keys(defs[name].properties)[0]);

for (const name of Object.keys(defs).filter((n) => n.startsWith('studio_')).sort()) {
  const rows = await all(name, orderOf(name));
  const json = JSON.stringify(rows, null, 1);
  writeFileSync(join(dir, `${name}.json`), json);
  manifest.studio[name] = { rows: rows.length, sha256: sha(json), columns: Object.keys(defs[name].properties) };
  console.log(`backed up ${name.padEnd(22)} ${String(rows.length).padStart(5)} rows`);
}

// Baseline of everything else this API exposes. Rows are sorted client-side so
// the hash does not depend on the database's row order.
for (const name of Object.keys(defs).filter((n) => !n.startsWith('studio_')).sort()) {
  try {
    const rows = await all(name, orderOf(name));
    const canon = rows.map((r) => JSON.stringify(r)).sort().join('\n');
    manifest.others[name] = { rows: rows.length, sha256: sha(canon), columns: Object.keys(defs[name].properties) };
    console.log(`baseline  ${name.padEnd(22)} ${String(rows.length).padStart(5)} rows`);
  } catch (e) {
    manifest.others[name] = { error: String(e.message).slice(0, 120) };
    console.log(`baseline  ${name.padEnd(22)} could not read (${String(e.message).slice(0, 60)})`);
  }
}

writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\nSaved to ${dir}/ (manifest.json lists counts and checksums)`);
