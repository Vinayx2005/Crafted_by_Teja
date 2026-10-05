-- Tools — WhatsApp Group Finder (tools.craftedbyteja.com/groups).
--
-- Links come from the daily crawler (.github/workflows/wa-crawl.yml) and the
-- public "Add your group" form. Nothing ever fetches WhatsApp itself: link
-- health comes from visitors' votes. A group hides itself once it collects
-- 3 more "broken" than "works" votes, or 3 "scam" votes, in the last 90 days.
--
-- Only the service role (tools app server + crawler) touches these tables;
-- anon has no access. Safe to re-run.

create table if not exists public.wa_groups (
  id         bigint generated always as identity primary key,
  url        text not null unique,          -- canonical invite / channel URL
  kind       text not null check (kind in ('group', 'channel')),
  name       text not null check (length(name) between 3 and 100),
  about      text check (length(about) <= 500),
  topic      text not null,
  city       text,
  source     text not null check (source in ('github', 'hn', 'submit')),
  source_url text,
  submitter  text,                          -- hashed IP, for the submit rate limit
  created_at timestamptz not null default now(),
  fts        tsvector generated always as (
    to_tsvector('english', name || ' ' || coalesce(about, '') || ' ' || topic || ' ' || coalesce(city, ''))
  ) stored
);
create index if not exists wa_groups_fts on public.wa_groups using gin (fts);

create table if not exists public.wa_votes (
  group_id   bigint not null references public.wa_groups(id) on delete cascade,
  voter      text not null,                 -- hashed IP; one vote per visitor per group
  vote       text not null check (vote in ('works', 'broken', 'scam')),
  created_at timestamptz not null default now(),
  primary key (group_id, voter)
);

alter table public.wa_groups enable row level security;
alter table public.wa_votes  enable row level security;
revoke all on public.wa_groups, public.wa_votes from anon, authenticated;

create or replace view public.wa_groups_live with (security_invoker = true) as
select g.id, g.url, g.kind, g.name, g.about, g.topic, g.city, g.created_at, g.fts,
       v.works, v.last_works
from public.wa_groups g
cross join lateral (
  select count(*) filter (where vote = 'works')  as works,
         count(*) filter (where vote = 'broken') as broken,
         count(*) filter (where vote = 'scam')   as scam,
         max(created_at) filter (where vote = 'works') as last_works
  from public.wa_votes
  where group_id = g.id and created_at > now() - interval '90 days'
) v
where v.scam < 3 and v.broken - v.works < 3;

revoke all on public.wa_groups_live from anon, authenticated;
