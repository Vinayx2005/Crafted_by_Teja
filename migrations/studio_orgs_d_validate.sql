-- Check PART D after running it. Read-only. Every row should say ok = true.
-- Paste into the Supabase SQL editor.

select check_name, expected, actual, (expected = actual) as ok
from (
  select 'competitors link to brands' as check_name, 1::bigint as expected,
    (select count(*) from pg_constraint where conname = 'studio_competitors_brand_fkey')::bigint as actual
  union all select 'scripts link to brands', 1, (select count(*) from pg_constraint where conname = 'studio_scripts_brand_fkey')
  union all select 'feedback links to brands', 1, (select count(*) from pg_constraint where conname = 'studio_feedback_brand_fkey')
  union all select 'feedback must match its script''s brand', 1, (select count(*) from pg_constraint where conname = 'studio_feedback_script_page_fkey')
  union all select 'old "any team member" rule is gone', 0,
    (select count(*) from pg_policies where schemaname = 'public' and policyname = 'studio_team'
       and tablename in ('studio_members', 'studio_competitors', 'studio_videos', 'studio_scripts', 'studio_feedback'))
  union all select 'role rules in place (8)', 8,
    (select count(*) from pg_policies where schemaname = 'public'
       and policyname in ('studio_comp_read', 'studio_comp_add', 'studio_comp_delete', 'studio_video_read', 'studio_script_read', 'studio_script_rating', 'studio_fb_read', 'studio_fb_add'))
  union all select 'old email list closed to the browser', 0,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'studio_members' and grantee in ('anon', 'authenticated'))
  union all select 'browser cannot write videos', 0,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'studio_videos' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
  union all select 'public (anon) key has no access to studio tables', 0,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'studio\_%' and grantee = 'anon')
  union all select 'no row points at a missing brand', 0,
    (select count(*) from public.studio_competitors c where not exists (select 1 from public.studio_brands b where b.id = c.page_id))
    + (select count(*) from public.studio_scripts s where not exists (select 1 from public.studio_brands b where b.id = s.page_id))
    + (select count(*) from public.studio_feedback f where not exists (select 1 from public.studio_brands b where b.id = f.page_id))
) c
order by ok, check_name;
