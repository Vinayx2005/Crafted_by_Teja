-- Check studio_knowledge.sql after running it. Read-only. Every row should say ok = true.

select check_name, expected, actual, (expected = actual) as ok
from (
  select 'table exists' as check_name, 1::bigint as expected,
    (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'studio_knowledge')::bigint as actual
  union all select 'row level security is on', 1,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'studio_knowledge' and c.relrowsecurity)
  union all select 'browser and public keys have no access', 0,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'studio_knowledge' and grantee in ('anon', 'authenticated'))
  union all select 'no policies (server only)', 0,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studio_knowledge')
) c
order by ok, check_name;
