-- WhatsApp Group Finder: a group can have several topics and several cities.
--
-- topic/city (single values) become topics/cities (arrays). "Online" in
-- cities means the group shows up whatever city a visitor filters by.
--
-- Run after wa_groups.sql. Safe to re-run.

-- array_to_string isn't marked immutable, which generated columns need.
create or replace function public.wa_join(text[]) returns text
  language sql immutable as $$ select array_to_string($1, ' ') $$;

drop view if exists public.wa_groups_live;

alter table public.wa_groups
  add column if not exists topics text[] not null default '{}',
  add column if not exists cities text[] not null default '{}';

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'wa_groups' and column_name = 'topic') then
    update public.wa_groups set topics = array[topic] where topics = '{}';
    update public.wa_groups set cities = array[city] where city is not null and cities = '{}';
    alter table public.wa_groups drop column fts, drop column topic, drop column city;
  end if;
end $$;

alter table public.wa_groups add column if not exists fts tsvector generated always as (
  to_tsvector('english', name || ' ' || coalesce(about, '') || ' ' || public.wa_join(topics) || ' ' || public.wa_join(cities))
) stored;
create index if not exists wa_groups_fts on public.wa_groups using gin (fts);
create index if not exists wa_groups_topics on public.wa_groups using gin (topics);
create index if not exists wa_groups_cities on public.wa_groups using gin (cities);

create view public.wa_groups_live with (security_invoker = true) as
select g.id, g.url, g.kind, g.name, g.about, g.topics, g.cities, g.created_at, g.fts,
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
