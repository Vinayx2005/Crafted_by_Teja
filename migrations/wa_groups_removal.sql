-- WhatsApp Group Finder: visitor reports delete groups.
--
-- 5 "dead link" reports, or 5 "spam/scam" reports, from different visitors
-- delete the group on the spot. Its URL goes into wa_removed so neither the
-- daily crawler nor the "Add your group" form can bring it back.
--
-- Replaces the earlier rule that hid groups (3 scam, or 3 more dead than
-- working votes). Run after wa_groups_multi.sql. Safe to re-run.

create table if not exists public.wa_removed (
  url        text primary key,
  reason     text not null check (reason in ('broken', 'scam')),
  removed_at timestamptz not null default now()
);
alter table public.wa_removed enable row level security;
revoke all on public.wa_removed from anon, authenticated;

-- After every vote: 5 of a kind deletes the group (its votes go with it).
create or replace function public.wa_check_votes() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  why text;
begin
  select case when count(*) filter (where vote = 'scam')   >= 5 then 'scam'
              when count(*) filter (where vote = 'broken') >= 5 then 'broken' end
    into why
    from wa_votes where group_id = new.group_id;
  if why is not null then
    insert into wa_removed (url, reason)
      select url, why from wa_groups where id = new.group_id
      on conflict (url) do nothing;
    delete from wa_groups where id = new.group_id;
  end if;
  return null;
end $$;

drop trigger if exists wa_votes_check on public.wa_votes;
create trigger wa_votes_check after insert or update on public.wa_votes
  for each row execute function public.wa_check_votes();

-- Removed links are silently skipped on insert, from any source.
create or replace function public.wa_skip_removed() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from wa_removed where url = new.url) then return null; end if;
  return new;
end $$;

drop trigger if exists wa_groups_skip_removed on public.wa_groups;
create trigger wa_groups_skip_removed before insert on public.wa_groups
  for each row execute function public.wa_skip_removed();

-- No more vote-based hiding: a group is either listed or deleted.
create or replace view public.wa_groups_live with (security_invoker = true) as
select g.id, g.url, g.kind, g.name, g.about, g.topics, g.cities, g.created_at, g.fts,
       v.works, v.last_works
from public.wa_groups g
cross join lateral (
  select count(*) filter (where vote = 'works') as works,
         max(created_at) filter (where vote = 'works') as last_works
  from public.wa_votes
  where group_id = g.id
) v;

revoke all on public.wa_groups_live from anon, authenticated;
