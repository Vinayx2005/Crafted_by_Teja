-- Writer app (writer.craftedbyteja.com) — per-user saved state.
--
-- One row per account holding everything the app used to keep in
-- localStorage (saved word choices, history, languages, font size,
-- auto-correct) as a single jsonb blob. The app reads it once after sign-in
-- and upserts the whole blob on change, so nothing here needs to know the
-- shape of the data.
--
-- After running this, add `writer` to Supabase → Settings → API →
-- Exposed schemas (alongside pft / blog / dilse), then re-run
-- cms_users_overview.sql so the CMS Users page shows the Writer tag.
--
-- Safe to re-run. Paste into Supabase SQL editor.

create schema if not exists writer;
grant usage on schema writer to authenticated;

create table if not exists writer.prefs (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table writer.prefs enable row level security;
grant select, insert, update, delete on writer.prefs to authenticated;

drop policy if exists prefs_owner on writer.prefs;
create policy prefs_owner on writer.prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
