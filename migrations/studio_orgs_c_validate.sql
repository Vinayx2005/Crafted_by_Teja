-- Content Studio: organisations. PART C: read-only validation. Changes nothing.
--
-- Run after PART B (and again after the cutover). Every row should say ok = true.

select check_name, expected, actual, (expected = actual) as ok
from (
  select 'one organisation exists' as check_name, 1::bigint as expected, (select count(*) from public.studio_organisations)::bigint as actual
  union all select 'exactly one owner in it',               1, (select count(*) from public.studio_org_members where role = 'owner')
  union all select 'brands = pages',                        (select count(*) from public.studio_pages), (select count(*) from public.studio_brands)
  union all select 'brand ids match page ids',              (select count(*) from public.studio_pages), (select count(*) from public.studio_pages p join public.studio_brands b on b.id = p.id)
  union all select 'content items = script chains',         (select count(distinct root_id) from public.studio_scripts), (select count(*) from public.studio_content)
  union all select 'content versions = scripts',            (select count(*) from public.studio_scripts), (select count(*) from public.studio_content_versions)
  union all select 'competitors all point at a brand',      (select count(*) from public.studio_competitors), (select count(*) from public.studio_competitors c join public.studio_brands b on b.id = c.page_id)
  union all select 'scripts all point at a brand',          (select count(*) from public.studio_scripts), (select count(*) from public.studio_scripts s join public.studio_brands b on b.id = s.page_id)
  union all select 'no content without its brand',          0, (select count(*) from public.studio_content c where not exists (select 1 from public.studio_brands b where b.id = c.brand_id and b.organisation_id = c.organisation_id))
  union all select 'no version without its content',        0, (select count(*) from public.studio_content_versions v where not exists (select 1 from public.studio_content c where c.id = v.content_id))
) t
order by ok, check_name;
