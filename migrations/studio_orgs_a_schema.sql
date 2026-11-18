-- Content Studio: organisations, brands, roles and generic content.
-- PART A: schema. ADDITIVE ONLY.
--
-- Creates new tables, helper functions and access rules for the NEW tables.
-- Touches no existing table (studio_pages, studio_competitors, studio_videos,
-- studio_scripts, studio_feedback, studio_members, studio_cache are unchanged,
-- and no other app's table is touched). Safe to re-run.
--
-- Run in the Supabase SQL editor. Run PART B (backfill) after this.
-- To undo everything in A and B: migrations/studio_orgs_rollback.sql
--
-- Design notes:
--  * Writes to organisations, members, invites and usage go through the server API
--    (which checks roles), so those tables have no client write rules at all.
--  * Brands and content have role-based rules as a second line of defence.
--  * Versions are immutable: clients can add a version but never edit or delete one.

-- ─── Organisations and membership ───────────────────────────────────────
create table if not exists public.studio_organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 100),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_org_members (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.studio_organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at      timestamptz not null default now(),
  unique (organisation_id, user_id)
);
create index if not exists studio_org_members_user on public.studio_org_members (user_id);

-- Pending invitations. The token itself is never stored, only its hash.
create table if not exists public.studio_org_invites (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.studio_organisations(id) on delete cascade,
  email           text not null check (email = lower(email)),
  role            text not null check (role in ('admin', 'editor', 'viewer')),   -- owners are never invited
  invited_by      uuid references auth.users(id) on delete set null,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists studio_org_invites_pending
  on public.studio_org_invites (organisation_id, email) where accepted_at is null;

-- ─── Brands ─────────────────────────────────────────────────────────────
create table if not exists public.studio_brands (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.studio_organisations(id) on delete cascade,
  name                text not null check (length(name) between 1 and 80),
  niche               text not null default '' check (length(niche) <= 300),   -- short phrase used for research searches
  description         text,
  audience            text,
  voice               text,                                                    -- voice, style and the team's own rules
  languages           text[] not null default '{English}',
  writing_rules       text,
  prohibited_terms    text[] not null default '{}',
  supported_platforms text[] not null default '{}',
  logo_url            text,
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, organisation_id)   -- lets other tables prove a brand belongs to the same organisation
);
create index if not exists studio_brands_org on public.studio_brands (organisation_id);

-- ─── Content and versions ───────────────────────────────────────────────
create table if not exists public.studio_content (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.studio_organisations(id) on delete cascade,
  brand_id         uuid not null,
  created_by       uuid references auth.users(id) on delete set null,
  created_by_email text,                       -- kept for migrated content whose author has no account
  title            text not null check (length(title) between 1 and 200),
  content_type     text not null,              -- the format id, for example short_video_script
  platform         text,
  status           text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'archived')),
  current_version  int not null default 1 check (current_version >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- a piece of content can only point at a brand of its own organisation
  foreign key (brand_id, organisation_id) references public.studio_brands (id, organisation_id) on delete cascade
);
create index if not exists studio_content_brand  on public.studio_content (brand_id, updated_at desc);
create index if not exists studio_content_org    on public.studio_content (organisation_id, status, updated_at desc);

create table if not exists public.studio_content_versions (
  id                      uuid primary key default gen_random_uuid(),
  content_id              uuid not null references public.studio_content(id) on delete cascade,
  version                 int not null check (version >= 1),
  parent_version_id       uuid references public.studio_content_versions(id) on delete set null,
  content_body            jsonb not null,      -- shape depends on the format (for scripts: hook, body, conclusion, cta)
  meta                    jsonb not null default '{}',   -- language, length, topic and similar
  generation_instructions text,
  sources                 jsonb not null default '[]',
  created_by              uuid references auth.users(id) on delete set null,
  created_by_email        text,
  created_at              timestamptz not null default now(),
  unique (content_id, version)
);

create table if not exists public.studio_content_feedback (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.studio_content(id) on delete cascade,
  version_id uuid references public.studio_content_versions(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  user_email text,
  section    text not null check (length(section) between 1 and 40),
  sentiment  text check (sentiment in ('up', 'down')),
  rating     int check (rating between 1 and 5),
  note       text check (length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists studio_content_feedback_content on public.studio_content_feedback (content_id, created_at desc);

-- ─── AI usage (limits and tracking). Server only. ───────────────────────
create table if not exists public.studio_ai_usage (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.studio_organisations(id) on delete cascade,
  user_id         uuid,
  action          text not null,
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists studio_ai_usage_org_time on public.studio_ai_usage (organisation_id, created_at desc);

-- ─── Role helpers used by the access rules ──────────────────────────────
-- security definer so they can read studio_org_members without that table's own
-- rules getting in the way. They only ever answer about the CALLING user.
create or replace function public.studio_role_rank(r text) returns int
  language sql immutable as $$
  select case r when 'viewer' then 1 when 'editor' then 2 when 'admin' then 3 when 'owner' then 4 else 0 end
$$;

create or replace function public.studio_org_role(org uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.studio_org_members where organisation_id = org and user_id = auth.uid()
$$;

create or replace function public.studio_has_role(org uuid, need text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.studio_role_rank(public.studio_org_role(org)) >= public.studio_role_rank(need), false)
$$;

revoke all on function public.studio_org_role(uuid), public.studio_has_role(uuid, text) from public, anon;
grant execute on function public.studio_org_role(uuid), public.studio_has_role(uuid, text) to authenticated;
grant execute on function public.studio_role_rank(text) to authenticated;

-- ─── Grants: start from nothing, then add exactly what is needed ────────
alter table public.studio_organisations    enable row level security;
alter table public.studio_org_members      enable row level security;
alter table public.studio_org_invites      enable row level security;
alter table public.studio_brands           enable row level security;
alter table public.studio_content          enable row level security;
alter table public.studio_content_versions enable row level security;
alter table public.studio_content_feedback enable row level security;
alter table public.studio_ai_usage         enable row level security;

revoke all on public.studio_organisations, public.studio_org_members, public.studio_org_invites,
              public.studio_brands, public.studio_content, public.studio_content_versions,
              public.studio_content_feedback, public.studio_ai_usage from anon, authenticated;

grant select on public.studio_organisations, public.studio_org_members to authenticated;
grant select, insert, update on public.studio_brands to authenticated;
grant select, insert, update, delete on public.studio_content to authenticated;
grant select, insert on public.studio_content_versions, public.studio_content_feedback to authenticated;
-- studio_org_invites and studio_ai_usage: no client access at all (server only).

-- ─── Access rules ───────────────────────────────────────────────────────
drop policy if exists studio_orgs_read on public.studio_organisations;
create policy studio_orgs_read on public.studio_organisations
  for select to authenticated using (public.studio_has_role(id, 'viewer'));

drop policy if exists studio_members_read on public.studio_org_members;
create policy studio_members_read on public.studio_org_members
  for select to authenticated using (public.studio_has_role(organisation_id, 'viewer'));

drop policy if exists studio_brands_read on public.studio_brands;
create policy studio_brands_read on public.studio_brands
  for select to authenticated using (public.studio_has_role(organisation_id, 'viewer'));
drop policy if exists studio_brands_insert on public.studio_brands;
create policy studio_brands_insert on public.studio_brands
  for insert to authenticated with check (public.studio_has_role(organisation_id, 'admin'));
drop policy if exists studio_brands_update on public.studio_brands;
create policy studio_brands_update on public.studio_brands
  for update to authenticated using (public.studio_has_role(organisation_id, 'admin'))
  with check (public.studio_has_role(organisation_id, 'admin'));

drop policy if exists studio_content_read on public.studio_content;
create policy studio_content_read on public.studio_content
  for select to authenticated using (public.studio_has_role(organisation_id, 'viewer'));
drop policy if exists studio_content_insert on public.studio_content;
create policy studio_content_insert on public.studio_content
  for insert to authenticated with check (public.studio_has_role(organisation_id, 'editor'));
drop policy if exists studio_content_update on public.studio_content;
create policy studio_content_update on public.studio_content
  for update to authenticated using (public.studio_has_role(organisation_id, 'editor'))
  with check (public.studio_has_role(organisation_id, 'editor'));
drop policy if exists studio_content_delete on public.studio_content;
create policy studio_content_delete on public.studio_content
  for delete to authenticated using (public.studio_has_role(organisation_id, 'admin'));

drop policy if exists studio_versions_read on public.studio_content_versions;
create policy studio_versions_read on public.studio_content_versions
  for select to authenticated using (exists (
    select 1 from public.studio_content c where c.id = content_id and public.studio_has_role(c.organisation_id, 'viewer')));
drop policy if exists studio_versions_insert on public.studio_content_versions;
create policy studio_versions_insert on public.studio_content_versions
  for insert to authenticated with check (exists (
    select 1 from public.studio_content c where c.id = content_id and public.studio_has_role(c.organisation_id, 'editor')));

drop policy if exists studio_cfeedback_read on public.studio_content_feedback;
create policy studio_cfeedback_read on public.studio_content_feedback
  for select to authenticated using (exists (
    select 1 from public.studio_content c where c.id = content_id and public.studio_has_role(c.organisation_id, 'viewer')));
drop policy if exists studio_cfeedback_insert on public.studio_content_feedback;
create policy studio_cfeedback_insert on public.studio_content_feedback
  for insert to authenticated with check (user_id = auth.uid() and exists (
    select 1 from public.studio_content c where c.id = content_id and public.studio_has_role(c.organisation_id, 'editor')));
