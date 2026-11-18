-- Undo PART D (the cutover): back to "any listed team member can do anything",
-- with competitors, scripts and feedback linked to studio_pages again.
--
-- Safe to run: it first makes sure every brand has a page row (brands created
-- after the cutover do not), then restores the old links and rules. No existing
-- row is changed or deleted. Parts A and B stay in place (their own rollback is
-- studio_orgs_rollback.sql).

begin;

-- Brands created after the cutover have no page row. Give them one (same id).
insert into public.studio_pages (id, name, niche, audience, voice, languages, created_by, created_at)
select b.id, b.name,
       case when length(b.niche) >= 3 then b.niche else left(b.name || ' brand', 300) end,
       b.audience, b.voice, b.languages, null, b.created_at
from public.studio_brands b
where not exists (select 1 from public.studio_pages p where p.id = b.id)
on conflict do nothing;

alter table public.studio_feedback    drop constraint if exists studio_feedback_script_page_fkey;
alter table public.studio_scripts     drop constraint if exists studio_scripts_id_page_key;
alter table public.studio_competitors drop constraint if exists studio_competitors_brand_fkey;
alter table public.studio_scripts     drop constraint if exists studio_scripts_brand_fkey;
alter table public.studio_feedback    drop constraint if exists studio_feedback_brand_fkey;

alter table public.studio_competitors add constraint studio_competitors_page_id_fkey foreign key (page_id) references public.studio_pages (id) on delete cascade;
alter table public.studio_scripts     add constraint studio_scripts_page_id_fkey     foreign key (page_id) references public.studio_pages (id) on delete cascade;
alter table public.studio_feedback    add constraint studio_feedback_page_id_fkey    foreign key (page_id) references public.studio_pages (id) on delete cascade;

drop policy if exists studio_comp_read   on public.studio_competitors;
drop policy if exists studio_comp_add    on public.studio_competitors;
drop policy if exists studio_comp_delete on public.studio_competitors;
drop policy if exists studio_video_read  on public.studio_videos;
drop policy if exists studio_script_read   on public.studio_scripts;
drop policy if exists studio_script_rating on public.studio_scripts;
drop policy if exists studio_fb_read on public.studio_feedback;
drop policy if exists studio_fb_add  on public.studio_feedback;

do $$
declare t text;
begin
  foreach t in array array['studio_members', 'studio_competitors', 'studio_videos', 'studio_scripts', 'studio_feedback'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists studio_team on public.%I', t);
    execute format('create policy studio_team on public.%I for all to authenticated using (public.studio_is_member()) with check (public.studio_is_member())', t);
  end loop;
end $$;

drop function if exists public.studio_competitor_can(uuid, text);
drop function if exists public.studio_brand_can(uuid, text, boolean);

commit;
