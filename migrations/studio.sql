-- Content Studio (tools.craftedbyteja.com/studio) — pages, competitors,
-- their videos, scripts and the feedback that teaches the script writer.
--
-- Access: only emails listed in studio_members (you manage the list inside
-- the app). Everything is shared across the team. studio_cache holds
-- short-lived API results and is only reachable by the server (service role).
--
-- Safe to re-run. Paste into the Supabase SQL editor.

create table if not exists public.studio_members (
  email text primary key check (email = lower(email))
);
insert into public.studio_members (email) values ('vinayteja23@gmail.com') on conflict do nothing;

-- RLS check used by every policy below. security definer so it can read
-- studio_members without that table's own policy getting in the way.
create or replace function public.studio_is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from studio_members where email = lower(auth.jwt() ->> 'email'))
$$;
grant execute on function public.studio_is_member() to authenticated;

create table if not exists public.studio_pages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  niche      text not null check (length(niche) between 3 and 300),  -- what the page is about
  audience   text,
  voice      text,                                                   -- tone / style notes
  languages  text[] not null default '{English}',
  created_by text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table if not exists public.studio_competitors (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.studio_pages(id) on delete cascade,
  platform    text not null check (platform in ('youtube', 'instagram')),
  ext_id      text not null,            -- YouTube channel id / Instagram username
  name        text not null,
  handle      text,
  url         text,
  thumb       text,
  followers   bigint,
  summary     jsonb,                    -- the "playbook" the analysis produces
  analyzed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (page_id, platform, ext_id)
);

create table if not exists public.studio_videos (
  id            uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.studio_competitors(id) on delete cascade,
  ext_id        text not null,          -- YouTube video id / Instagram reel URL
  url           text,
  title         text,
  caption       text,
  published_at  timestamptz,
  views         bigint,
  likes         bigint,
  comments      bigint,
  duration_s    int,
  is_short      boolean not null default false,
  transcript    text,
  hook          text,
  structure     jsonb,                  -- hook type, beats, CTA, topic, style notes
  analyzed_at   timestamptz,
  unique (competitor_id, ext_id)
);
create index if not exists studio_videos_competitor on public.studio_videos (competitor_id);

create table if not exists public.studio_scripts (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null references public.studio_pages(id) on delete cascade,
  root_id    uuid not null,             -- first version's id; links all revisions
  version    int not null default 1,
  topic      text not null,
  language   text not null,
  length_s   int not null,
  sources    jsonb not null default '[]',
  hook       text not null,
  body       text not null,
  conclusion text not null,
  cta        text not null,
  rating     int check (rating between 1 and 5),
  created_by text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists studio_scripts_page on public.studio_scripts (page_id, created_at desc);
create index if not exists studio_scripts_root on public.studio_scripts (root_id, version);

create table if not exists public.studio_feedback (
  id         uuid primary key default gen_random_uuid(),
  script_id  uuid not null references public.studio_scripts(id) on delete cascade,
  page_id    uuid not null references public.studio_pages(id) on delete cascade,
  section    text not null check (section in ('overall', 'hook', 'body', 'conclusion', 'cta')),
  sentiment  text check (sentiment in ('up', 'down')),
  note       text check (length(note) <= 1000),
  created_by text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists studio_feedback_page on public.studio_feedback (page_id, created_at desc);

create table if not exists public.studio_cache (
  key  text primary key,
  data jsonb not null,
  at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['studio_members', 'studio_pages', 'studio_competitors', 'studio_videos', 'studio_scripts', 'studio_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists studio_team on public.%I', t);
    execute format('create policy studio_team on public.%I for all to authenticated using (public.studio_is_member()) with check (public.studio_is_member())', t);
  end loop;
end $$;

alter table public.studio_cache enable row level security;
revoke all on public.studio_cache from anon, authenticated;
