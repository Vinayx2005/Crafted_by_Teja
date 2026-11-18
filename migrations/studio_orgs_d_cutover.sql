-- Content Studio: organisations. PART D: cutover.
--
-- THIS ONE CHANGES EXISTING TABLES. Run it only after Parts A, B and C are done
-- and C said every check is ok. Take a backup first (node scripts/studio-backup.mjs).
-- Undo with: migrations/studio_orgs_d_rollback.sql
--
-- What it does, in one transaction (all or nothing):
--  1. Competitors, scripts and feedback now belong to a BRAND (studio_brands)
--     instead of a page (studio_pages). Brand ids equal the old page ids, so no
--     row changes. Only the link rule changes.
--  2. The old rule "any listed team member can do anything" is replaced by role
--     rules tied to the organisation that owns the brand:
--        read          Viewer and above
--        add / rate    Editor and above
--        delete a competitor   Admin and above
--     Videos and script text are written by the server only, never by the browser.
--  3. studio_members (the old email list) is closed to the browser. It stays in
--     place, unchanged, so the rollback can restore the old behaviour.
-- No rows are added, changed or deleted in any existing table.

begin;

-- Stop here (and change nothing) if any row points at a page that has no brand.
do $$
declare bad bigint;
begin
  select (select count(*) from public.studio_competitors c where not exists (select 1 from public.studio_brands b where b.id = c.page_id))
       + (select count(*) from public.studio_scripts     s where not exists (select 1 from public.studio_brands b where b.id = s.page_id))
       + (select count(*) from public.studio_feedback    f where not exists (select 1 from public.studio_brands b where b.id = f.page_id))
    into bad;
  if bad > 0 then
    raise exception 'Cutover stopped: % rows point at a page that has no brand. Run PART B again, then retry. Nothing was changed.', bad;
  end if;
end $$;

-- ─── 1. Re-point the links ──────────────────────────────────────────────
alter table public.studio_competitors drop constraint if exists studio_competitors_page_id_fkey;
alter table public.studio_scripts     drop constraint if exists studio_scripts_page_id_fkey;
alter table public.studio_feedback    drop constraint if exists studio_feedback_page_id_fkey;

alter table public.studio_competitors add constraint studio_competitors_brand_fkey foreign key (page_id) references public.studio_brands (id) on delete cascade;
alter table public.studio_scripts     add constraint studio_scripts_brand_fkey     foreign key (page_id) references public.studio_brands (id) on delete cascade;
alter table public.studio_feedback    add constraint studio_feedback_brand_fkey    foreign key (page_id) references public.studio_brands (id) on delete cascade;

-- A feedback row must point at a script of the SAME brand (the browser could otherwise mix them).
alter table public.studio_scripts drop constraint if exists studio_scripts_id_page_key;
alter table public.studio_scripts add constraint studio_scripts_id_page_key unique (id, page_id);
alter table public.studio_feedback drop constraint if exists studio_feedback_script_page_fkey;
alter table public.studio_feedback add constraint studio_feedback_script_page_fkey
  foreign key (script_id, page_id) references public.studio_scripts (id, page_id) on delete cascade;

-- ─── 2. Role rules ──────────────────────────────────────────────────────
-- "May the caller do `need` on this brand?" Writes also need the brand to be active.
-- security definer so the answer does not depend on the caller's rules for studio_brands.
create or replace function public.studio_brand_can(brand uuid, need text, writing boolean default false)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select public.studio_has_role(b.organisation_id, need) and (not writing or b.archived_at is null)
                   from public.studio_brands b where b.id = brand), false)
$$;
create or replace function public.studio_competitor_can(comp uuid, need text)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select public.studio_brand_can(c.page_id, need, false) from public.studio_competitors c where c.id = comp), false)
$$;
revoke all on function public.studio_brand_can(uuid, text, boolean), public.studio_competitor_can(uuid, text) from public, anon;
grant execute on function public.studio_brand_can(uuid, text, boolean), public.studio_competitor_can(uuid, text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['studio_members', 'studio_competitors', 'studio_videos', 'studio_scripts', 'studio_feedback'] loop
    execute format('drop policy if exists studio_team on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- competitors: read, add (Editor), delete (Admin). Changes to them come from the server.
grant select, insert, delete on public.studio_competitors to authenticated;
create policy studio_comp_read   on public.studio_competitors for select to authenticated using (public.studio_brand_can(page_id, 'viewer'));
create policy studio_comp_add    on public.studio_competitors for insert to authenticated with check (public.studio_brand_can(page_id, 'editor', true));
create policy studio_comp_delete on public.studio_competitors for delete to authenticated using (public.studio_brand_can(page_id, 'admin', true));

-- videos: read only. The server fetches and analyses them.
grant select on public.studio_videos to authenticated;
create policy studio_video_read on public.studio_videos for select to authenticated using (public.studio_competitor_can(competitor_id, 'viewer'));

-- scripts: read; an Editor may only change the star rating. New scripts come from the server.
grant select on public.studio_scripts to authenticated;
grant update (rating) on public.studio_scripts to authenticated;
create policy studio_script_read   on public.studio_scripts for select to authenticated using (public.studio_brand_can(page_id, 'viewer'));
create policy studio_script_rating on public.studio_scripts for update to authenticated
  using (public.studio_brand_can(page_id, 'editor', true)) with check (public.studio_brand_can(page_id, 'editor', true));

-- feedback: read; an Editor adds their own. Nobody edits or deletes it from the browser.
grant select, insert on public.studio_feedback to authenticated;
create policy studio_fb_read on public.studio_feedback for select to authenticated using (public.studio_brand_can(page_id, 'viewer'));
create policy studio_fb_add  on public.studio_feedback for insert to authenticated with check (public.studio_brand_can(page_id, 'editor', true));

commit;
