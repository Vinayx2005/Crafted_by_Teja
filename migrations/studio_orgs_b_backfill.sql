-- Content Studio: organisations. PART B: copy existing data into the new tables.
--
-- INSERT ONLY. Reads studio_members, studio_pages and studio_scripts and
-- studio_feedback; changes none of them. Run PART A first.
--
-- It is ONE atomic block: if any count at the end does not match, it raises an
-- error and NOTHING is saved. Safe to re-run (every insert skips rows that exist).
--
-- What it does:
--   * one organisation "18startup" for all existing data
--   * the earliest account among today's team members becomes the Owner;
--     anyone else on the old team list becomes an Editor
--   * each page becomes a brand with the SAME id (so competitors, videos, scripts,
--     feedback and cached playbooks keep pointing at the right thing)
--   * each script chain becomes one content item (id = the chain's root id), each
--     script becomes a version, status Draft
--   * old feedback and star ratings become content feedback
--
-- Undo: migrations/studio_orgs_rollback.sql

do $$
declare
  org         uuid;
  owner_user  uuid;
  m           record;
  n_pages     int;
  n_scripts   int;
  n_feedback  int;
begin
  -- Owner = the earliest-created account among the current team members.
  select u.id into owner_user
    from public.studio_members sm
    join auth.users u on lower(u.email) = sm.email
   order by u.created_at
   limit 1;
  if owner_user is null then
    raise exception 'No studio_members email matches a signed-up account, so there is nobody to make Owner. Nothing was saved.';
  end if;

  select id into org from public.studio_organisations where slug = '18startup';
  if org is null then
    insert into public.studio_organisations (name, slug, created_by)
    values ('18startup', '18startup', owner_user)
    returning id into org;
  end if;

  -- Membership
  for m in
    select sm.email, u.id as uid
      from public.studio_members sm
      left join auth.users u on lower(u.email) = sm.email
     order by u.created_at nulls last
  loop
    if m.uid is null then
      raise notice 'No account yet for %, skipped. Invite them after the migration.', m.email;
      continue;
    end if;
    insert into public.studio_org_members (organisation_id, user_id, role)
    values (org, m.uid, case when m.uid = owner_user then 'owner' else 'editor' end)
    on conflict (organisation_id, user_id) do nothing;
  end loop;

  -- Brands: one per page, same id.
  insert into public.studio_brands (id, organisation_id, name, niche, audience, voice, languages, created_by, created_at, updated_at)
  select p.id, org, p.name, p.niche, p.audience, p.voice, p.languages,
         (select u.id from auth.users u where lower(u.email) = lower(p.created_by)),
         p.created_at, p.created_at
    from public.studio_pages p
  on conflict (id) do nothing;

  -- Content: one item per chain of script versions (they share a root_id).
  insert into public.studio_content
    (id, organisation_id, brand_id, created_by, created_by_email, title, content_type, platform, status, current_version, created_at, updated_at)
  select c.root_id, org, c.page_id,
         (select u.id from auth.users u where lower(u.email) = lower(v1.created_by)),
         v1.created_by, left(v1.topic, 200), 'short_video_script', null, 'draft', c.max_version, c.first_at, c.last_at
    from (select root_id, page_id, max(version) as max_version, min(version) as min_version,
                 min(created_at) as first_at, max(created_at) as last_at
            from public.studio_scripts group by root_id, page_id) c
    join public.studio_scripts v1 on v1.root_id = c.root_id and v1.version = c.min_version
  on conflict (id) do nothing;

  -- Versions: every script becomes a version; parent = the previous version of the chain.
  insert into public.studio_content_versions
    (id, content_id, version, parent_version_id, content_body, meta, generation_instructions, sources, created_by, created_by_email, created_at)
  select s.id, s.root_id, s.version, prev.id,
         jsonb_build_object('hook', s.hook, 'body', s.body, 'conclusion', s.conclusion, 'cta', s.cta),
         jsonb_build_object('language', s.language, 'length_s', s.length_s, 'topic', s.topic),
         null, s.sources,
         (select u.id from auth.users u where lower(u.email) = lower(s.created_by)),
         s.created_by, s.created_at
    from public.studio_scripts s
    left join public.studio_scripts prev on prev.root_id = s.root_id and prev.version = s.version - 1
  on conflict (id) do nothing;

  -- Feedback: carried over one for one.
  insert into public.studio_content_feedback
    (id, content_id, version_id, user_id, user_email, section, sentiment, rating, note, created_at)
  select f.id, s.root_id, s.id,
         (select u.id from auth.users u where lower(u.email) = lower(f.created_by)),
         f.created_by, f.section, f.sentiment, null, f.note, f.created_at
    from public.studio_feedback f
    join public.studio_scripts s on s.id = f.script_id
  on conflict (id) do nothing;

  -- Star ratings lived on the script row. Attach each to its "overall" feedback
  -- if there is one, otherwise create that feedback row.
  update public.studio_content_feedback f
     set rating = s.rating
    from public.studio_scripts s
   where f.version_id = s.id and f.section = 'overall' and f.rating is null and s.rating is not null;

  insert into public.studio_content_feedback (content_id, version_id, user_id, user_email, section, sentiment, rating, note, created_at)
  select s.root_id, s.id, null, s.created_by, 'overall',
         case when s.rating >= 4 then 'up' when s.rating <= 2 then 'down' end, s.rating, null, s.created_at
    from public.studio_scripts s
   where s.rating is not null
     and not exists (select 1 from public.studio_content_feedback f where f.version_id = s.id and f.section = 'overall');

  -- Safety checks. Any mismatch aborts the whole block, so nothing is half-copied.
  select count(*) into n_pages from public.studio_pages;
  if (select count(*) from public.studio_brands where organisation_id = org) <> n_pages then
    raise exception 'Brand count does not match page count. Nothing was saved.';
  end if;

  select count(*) into n_scripts from public.studio_scripts;
  if (select count(*) from public.studio_content_versions v join public.studio_content c on c.id = v.content_id where c.organisation_id = org) <> n_scripts then
    raise exception 'Version count does not match script count. Nothing was saved.';
  end if;

  select count(*) into n_feedback from public.studio_feedback;
  if (select count(*) from public.studio_content_feedback f join public.studio_content c on c.id = f.content_id where c.organisation_id = org) < n_feedback then
    raise exception 'Some feedback was not copied. Nothing was saved.';
  end if;

  raise notice 'Done: organisation %, % brands, % script versions, feedback copied.', org, n_pages, n_scripts;
end $$;
