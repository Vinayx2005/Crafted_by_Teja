-- Writers Book Studio — published ebooks.
--
-- Publishing a book stores a snapshot here, so the author can keep editing
-- the draft without changing what readers see; "Update published version"
-- overwrites the snapshot, "Unpublish" deletes it. One per book.
--
-- Anyone with the link can read (writer.craftedbyteja.com/read/<id>), so
-- anon gets SELECT; only the owner can create, update or delete.
--
-- Run after writer_books.sql. Safe to re-run.

grant usage on schema writer to anon;

create table if not exists writer.ebooks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null unique references writer.projects(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  book         jsonb not null,   -- { settings, tagline, chapters: [{ id, kind, title, html }] }
  published_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table writer.ebooks enable row level security;
grant select on writer.ebooks to anon, authenticated;
grant insert, update, delete on writer.ebooks to authenticated;

drop policy if exists ebooks_read on writer.ebooks;
create policy ebooks_read on writer.ebooks
  for select to anon, authenticated
  using (true);

drop policy if exists ebooks_owner on writer.ebooks;
create policy ebooks_owner on writer.ebooks
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from writer.projects p where p.id = project_id and p.user_id = auth.uid())
  );
