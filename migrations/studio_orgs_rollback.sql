-- Undo PART A and PART B of the organisations migration.
--
-- Everything in A and B is NEW (new tables and helper functions only), and the
-- original studio_* tables are never modified by them, so undoing is just
-- dropping what was added. The original data is untouched either way.
--
-- This does NOT undo the cutover (PART D), which has its own rollback file.
-- Run only if you want to remove the organisations feature again.

drop table if exists
  public.studio_ai_usage,
  public.studio_content_feedback,
  public.studio_content_versions,
  public.studio_content,
  public.studio_brands,
  public.studio_org_invites,
  public.studio_org_members,
  public.studio_organisations
cascade;

drop function if exists public.studio_has_role(uuid, text);
drop function if exists public.studio_org_role(uuid);
drop function if exists public.studio_role_rank(text);
