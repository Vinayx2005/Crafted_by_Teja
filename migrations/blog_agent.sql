-- Blog agent — keyword research → outline → draft pipeline that feeds
-- blog.posts. Driven from cms.craftedbyteja.com/agent; the heavy work runs
-- in POST /api/agent/tick, which pg_cron pings every minute while there is
-- queued work (section at the bottom).
--
-- Scheduling needs nothing extra: posts_public_read already hides rows
-- whose published_at is in the future, so a scheduled post goes live on
-- its own.
--
-- Safe to re-run. Paste into Supabase SQL editor.

-- ─── Tables ────────────────────────────────────────────────────────────
-- One row per keyword you asked it to research.
create table if not exists blog.agent_seeds (
  id            bigserial primary key,
  site          text not null check (site in ('root', 'pft')),
  keyword       text not null,
  country       text not null default 'IN',
  ideas_wanted  int  not null default 10 check (ideas_wanted between 1 and 25),
  notes         text,
  status        text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  error         text,
  attempts      int  not null default 0,
  locked_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- One row per blog idea, carried through every stage until it's a post.
create table if not exists blog.agent_items (
  id          bigserial primary key,
  seed_id     bigint not null references blog.agent_seeds(id) on delete cascade,
  site        text not null check (site in ('root', 'pft')),
  stage       text not null default 'idea' check (stage in (
                'idea', 'outline_queued', 'outline_review', 'draft_queued',
                'draft_review', 'approved', 'scheduled', 'discarded', 'failed')),
  idea        jsonb not null,  -- title, primary_keyword, demand, competition, score, angle …
  plan        jsonb,           -- keyword plan + meta, from the outline step
  outline_md  text,
  note        text,            -- your feedback for the next (re)generation
  seo         jsonb,           -- automated checks on the draft
  post_id     bigint references blog.posts(id) on delete set null,
  error       text,
  attempts    int not null default 0,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_items_stage_idx on blog.agent_items(stage);

drop trigger if exists agent_items_set_updated_at on blog.agent_items;
create trigger agent_items_set_updated_at before update on blog.agent_items
  for each row execute function public.content_set_updated_at();

-- ─── Grants ────────────────────────────────────────────────────────────
-- authenticated = you in the CMS (RLS narrows it to the allowlist).
-- service_role  = the tick route; it also writes the drafts to blog.posts.
grant usage on schema blog to service_role;
grant select, insert, update, delete on blog.agent_seeds, blog.agent_items to authenticated, service_role;
grant select, insert, update, delete on blog.posts to service_role;
grant usage, select on sequence blog.agent_seeds_id_seq, blog.agent_items_id_seq, blog.posts_id_seq
  to authenticated, service_role;

-- ─── RLS — same author allowlist as blog.posts ─────────────────────────
alter table blog.agent_seeds enable row level security;
alter table blog.agent_items enable row level security;

drop policy if exists "agent_seeds_author_all" on blog.agent_seeds;
create policy "agent_seeds_author_all" on blog.agent_seeds
  for all using ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com');

drop policy if exists "agent_items_author_all" on blog.agent_items;
create policy "agent_items_author_all" on blog.agent_items
  for all using ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'vinayteja23@gmail.com');

-- ─── Work claiming ─────────────────────────────────────────────────────
-- Each tick claims a few rows. SKIP LOCKED lets overlapping ticks run
-- side by side without double-processing; a lock older than 10 minutes
-- means the tick died (timeout/deploy), so the row is up for grabs again.
-- Three dead or failed attempts park the row as failed.
create or replace function blog.agent_claim_seeds(n int)
returns setof blog.agent_seeds language plpgsql security definer set search_path = '' as $$
begin
  update blog.agent_seeds set status = 'failed', locked_at = null,
         error = coalesce(error, 'Gave up after 3 attempts')
   where status = 'queued' and attempts >= 3
     and (locked_at is null or locked_at < now() - interval '10 minutes');
  return query
  update blog.agent_seeds s set locked_at = now(), attempts = s.attempts + 1
   where s.id in (select id from blog.agent_seeds
                   where status = 'queued'
                     and (locked_at is null or locked_at < now() - interval '10 minutes')
                   order by id limit n for update skip locked)
  returning s.*;
end $$;

create or replace function blog.agent_claim_items(n int)
returns setof blog.agent_items language plpgsql security definer set search_path = '' as $$
begin
  update blog.agent_items set stage = 'failed', locked_at = null,
         error = coalesce(error, 'Gave up after 3 attempts')
   where stage in ('outline_queued', 'draft_queued') and attempts >= 3
     and (locked_at is null or locked_at < now() - interval '10 minutes');
  return query
  update blog.agent_items i set locked_at = now(), attempts = i.attempts + 1
   where i.id in (select id from blog.agent_items
                   where stage in ('outline_queued', 'draft_queued')
                     and (locked_at is null or locked_at < now() - interval '10 minutes')
                   order by id limit n for update skip locked)
  returning i.*;
end $$;

revoke all on function blog.agent_claim_seeds(int), blog.agent_claim_items(int) from public, anon, authenticated;
grant execute on function blog.agent_claim_seeds(int), blog.agent_claim_items(int) to service_role;

-- ─── Background runner ─────────────────────────────────────────────────
-- Pings the CMS every minute, only while something is queued. Replace
-- REPLACE_WITH_AGENT_CRON_SECRET with the same value you put in the CMS's
-- AGENT_CRON_SECRET env var on Vercel. Without this block the agent still
-- works, but only while the /agent page is open.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('blog-agent-tick', '* * * * *', $cron$
  select net.http_post(
    url     := 'https://cms.craftedbyteja.com/api/agent/tick',
    headers := jsonb_build_object('x-agent-secret', 'REPLACE_WITH_AGENT_CRON_SECRET'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
  where exists (select 1 from blog.agent_seeds where status = 'queued')
     or exists (select 1 from blog.agent_items where stage in ('outline_queued', 'draft_queued'));
$cron$);
