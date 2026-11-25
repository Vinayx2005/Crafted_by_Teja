-- Content Studio: content calendar. ADDITIVE ONLY: one new table.
--
-- The topics a brand plans to post, one row per topic. A repeating topic is ONE row with a
-- repeat rule; the screen works out the dates it falls on.
-- Read by anyone in the brand's organisation (Viewer and up); added, changed and removed by
-- an Editor and up, only while the brand is active. Uses studio_brand_can from
-- studio_orgs_d_cutover.sql, so run that first.
--
-- Touches no existing table. Safe to re-run. Undo: migrations/studio_calendar_rollback.sql

create table if not exists public.studio_calendar (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.studio_brands(id) on delete cascade,
  day          date not null,
  topic        text not null check (length(topic) between 1 and 300),
  notes        text check (notes is null or length(notes) <= 3000),
  platforms    text[] not null default '{}',
  repeat       text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly')),
  repeat_until date check (repeat_until is null or repeat_until >= day),
  script_id    uuid references public.studio_scripts(id) on delete set null,
  done_days    date[] not null default '{}', -- dates marked completed (see studio_calendar_done.sql)
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists studio_calendar_brand on public.studio_calendar (brand_id, day);

alter table public.studio_calendar enable row level security;
revoke all on public.studio_calendar from anon, authenticated;
grant select, insert, update, delete on public.studio_calendar to authenticated;

drop policy if exists studio_cal_read on public.studio_calendar;
drop policy if exists studio_cal_add on public.studio_calendar;
drop policy if exists studio_cal_change on public.studio_calendar;
drop policy if exists studio_cal_delete on public.studio_calendar;
create policy studio_cal_read   on public.studio_calendar for select to authenticated using (public.studio_brand_can(brand_id, 'viewer'));
create policy studio_cal_add    on public.studio_calendar for insert to authenticated with check (public.studio_brand_can(brand_id, 'editor', true));
create policy studio_cal_change on public.studio_calendar for update to authenticated
  using (public.studio_brand_can(brand_id, 'editor', true)) with check (public.studio_brand_can(brand_id, 'editor', true));
create policy studio_cal_delete on public.studio_calendar for delete to authenticated using (public.studio_brand_can(brand_id, 'editor', true));
