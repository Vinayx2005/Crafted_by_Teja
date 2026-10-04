-- Writer app — books.
--
-- projects: one row per book. `settings` is a jsonb blob owned by the app
--           (book font, spacing, running header, page numbers, translate).
-- chapters: ordered by `position`. kind = 'chapter' (has text) or 'blank'
--           (an intentionally empty page). `delta` is the Quill document the
--           editor reloads; `html` is the rendered copy the preview/export use.
--
-- Run after writer_prefs.sql (it creates the `writer` schema and the
-- Exposed-schemas note applies here too). Safe to re-run.

create table if not exists writer.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'Untitled book',
  status     text not null default 'draft',
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists writer.chapters (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references writer.projects(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position   int  not null default 0,
  kind       text not null default 'chapter' check (kind in ('chapter', 'blank')),
  title      text not null default '',
  delta      jsonb,
  html       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chapters_project_idx on writer.chapters (project_id, position);

alter table writer.projects enable row level security;
alter table writer.chapters enable row level security;
grant select, insert, update, delete on writer.projects, writer.chapters to authenticated;

drop policy if exists projects_owner on writer.projects;
create policy projects_owner on writer.projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A chapter must belong to the caller AND sit in one of the caller's projects,
-- so nobody can attach rows to someone else's book by guessing its id.
drop policy if exists chapters_owner on writer.chapters;
create policy chapters_owner on writer.chapters
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from writer.projects p where p.id = project_id and p.user_id = auth.uid())
  );
