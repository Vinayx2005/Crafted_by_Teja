-- Topic clusters for the blog agent.
--
-- A cluster = one broad "pillar" post plus N narrow supporting posts, all
-- interlinked. Google confirms AI Mode uses "query fan-out" (concurrent
-- related sub-queries), so covering a topic's subtopics gets you pulled into
-- answers you never targeted — see .claude/skills/seo-knowledge/aeo.md.
--
-- Only one new column; the pillar/supporting role lives in agent_items.idea.
--
-- Safe to re-run. Paste into Supabase SQL editor.

alter table blog.agent_seeds
  add column if not exists cluster boolean not null default false;

comment on column blog.agent_seeds.cluster is
  'true = research returns one pillar idea + supporting subtopic ideas that link to each other';
