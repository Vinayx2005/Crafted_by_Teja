-- Author profile — one row, edited in the CMS, read by every site.
--
-- Feeds: the craftedbyteja.com home page, the byline under every post, the Person and
-- BlogPosting structured data, and the `sameAs` evidence links that let
-- search engines connect scattered profiles into one identity.
--
-- Safe to re-run. Paste into Supabase SQL editor.

create table if not exists blog.author_profile (
  id          int primary key default 1 check (id = 1),   -- single row
  name        text not null,
  role        text,
  bio         text,
  image_url   text,
  location    text,
  email       text,
  credentials text,   -- what you are, and plainly what you are not
  disclosure  text,   -- how these posts are written (AI use, editing, sources)
  links       jsonb not null default '[]'::jsonb,  -- [{ "label": "YouTube", "url": "https://…" }]
  updated_at  timestamptz not null default now()
);

drop trigger if exists author_profile_set_updated_at on blog.author_profile;
create trigger author_profile_set_updated_at before update on blog.author_profile
  for each row execute function public.content_set_updated_at();

-- Seed from what is currently hard-coded in the apps, so nothing regresses
-- before the first save in the CMS.
insert into blog.author_profile (id, name, role, bio, image_url, links)
values (
  1,
  'Teja Surishetti',
  'Entrepreneur, author and builder',
  'Teja is an entrepreneur and author who has built software products, written books and published 200+ YouTube videos. He writes about money, building and learning by doing.',
  'https://www.craftedbyteja.com/teja.jpg',
  '[{"label": "LinkedIn", "url": "https://www.linkedin.com/in/surishettiteja/"},
    {"label": "Instagram", "url": "https://www.instagram.com/tejasurishetti/"}]'::jsonb
) on conflict (id) do nothing;

-- Public read (it renders on every blog post); only the author may edit.
alter table blog.author_profile enable row level security;

drop policy if exists "author_profile_public_read" on blog.author_profile;
create policy "author_profile_public_read" on blog.author_profile for select using (true);

drop policy if exists "author_profile_author_write" on blog.author_profile;
create policy "author_profile_author_write" on blog.author_profile
  for all using ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com');

grant select on blog.author_profile to anon, authenticated;
grant insert, update on blog.author_profile to authenticated, service_role;
