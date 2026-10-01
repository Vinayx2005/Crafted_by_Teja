-- CMS "Users" module — one call that lists every account across the apps
-- with the apps each person is associated with.
--
-- Source of truth is `auth.users`, not `pft.users`: the signup trigger that
-- mirrors rows into pft.users swallows its own failures (see
-- harden_signup_triggers.sql), so an account can exist in auth with no
-- mirror row. Listing from auth guarantees nobody is missed.
--
-- App association, since no table records membership directly:
--   PFT   — every account, except ones that signed up through Writer.
--           Not conditioned on having entered data — a signed-up user with
--           an empty ledger is still a PFT user.
--   Writer — has a writer.prefs row (created on first Writer sign-in).
--           Accounts whose writer.prefs row appeared within 10 minutes of
--           the account itself signed up via Writer, so they drop the PFT
--           tag. Requires writer_prefs.sql to have run first.
--   Root  — authored a blog.posts row with site='root'
--   Blog  — authored a blog.posts row with site='pft'
--   Dilse — authored a dilse.stories or dilse.books row
--   CMS   — email is on the CMS author allowlist (kept in sync with
--           apps/cms/src/lib/supabase.ts AUTHOR_ALLOWLIST)
--
-- auth.users is unreadable by the anon client and pft.users has per-row RLS
-- (users_owner), so this security-definer function is the admin read path.
-- The WHERE clause is the gate — a non-allowlisted caller gets zero rows,
-- not everyone else's email.
--
-- Also defines public.cms_delete_user(uuid) — the Delete button on that page.
-- It mirrors delete_own_account() (move_pft_to_pft_schema.sql) but takes a
-- target id, is gated on the same allowlist, and refuses to delete the
-- caller's own account.
--
-- Safe to re-run. Paste into Supabase SQL editor.

-- Dropped rather than replaced: the return type changed when last_sign_in_at
-- was added, and create-or-replace cannot alter a function's signature.
drop function if exists public.cms_users_overview();

create function public.cms_users_overview()
returns table (
  id         uuid,
  email      text,
  full_name  text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  apps       text[]
)
language sql
stable
security definer
set search_path = pft, public, auth
as $$
  select
    a.id,
    a.email::text,
    coalesce(
      nullif(u.full_name, ''),
      a.raw_user_meta_data->>'full_name',
      a.raw_user_meta_data->>'name',
      split_part(a.email::text, '@', 1)
    )::text as full_name,
    a.created_at::timestamptz,
    a.last_sign_in_at::timestamptz,
    array_remove(array[
      -- ponytail: signup app inferred from timing (no column records it);
      -- store a signup_app on auth metadata if this ever misfires.
      case when not exists (select 1 from writer.prefs w
                            where w.user_id = a.id
                              and w.created_at <= a.created_at + interval '10 minutes')
           then 'PFT' end,
      case when exists (select 1 from writer.prefs w where w.user_id = a.id)
           then 'Writer' end,
      case when exists (select 1 from blog.posts p
                        where p.site = 'root' and lower(p.author_email) = lower(a.email::text))
           then 'Root' end,
      case when exists (select 1 from blog.posts p
                        where p.site = 'pft' and lower(p.author_email) = lower(a.email::text))
           then 'Blog' end,
      case when exists (select 1 from dilse.stories s where lower(s.author_email) = lower(a.email::text))
             or exists (select 1 from dilse.books bk where lower(bk.author_email) = lower(a.email::text))
           then 'Dilse' end,
      case when lower(a.email::text) = any (array['vinayteja23@gmail.com']) then 'CMS' end
    ], null) as apps
  from auth.users a
  left join pft.users u on u.id = a.id
  where lower(auth.jwt() ->> 'email') = any (array['vinayteja23@gmail.com'])
  order by a.last_sign_in_at desc nulls last, a.created_at desc;
$$;

revoke execute on function public.cms_users_overview() from public, anon;
grant  execute on function public.cms_users_overview() to authenticated;

-- ─── Delete a user ─────────────────────────────────────────────────────
-- Removes every PFT row the account owns, then the auth account itself.
-- Authored content (blog.posts / dilse.stories) is left alone — author_email
-- is a plain text column, not an FK, so posts survive their author.
create or replace function public.cms_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = pft, public, auth
as $$
begin
  if lower(auth.jwt() ->> 'email') <> all (array['vinayteja23@gmail.com']) then
    raise exception 'Not allowed';
  end if;

  if target = auth.uid() then
    raise exception 'Refusing to delete the account you are signed in as';
  end if;

  -- Every user-owned pft table is ON DELETE CASCADE from pft.users, and
  -- history/audit columns are ON DELETE SET NULL on purpose
  -- (add_cascade_fks_to_users.sql) — so these two deletes clear everything
  -- without destroying the audit trail. pft.users goes first so this still
  -- works if users.id → auth.users was never made cascading.
  delete from pft.users  where id = target;
  delete from auth.users where id = target;
end;
$$;

revoke execute on function public.cms_delete_user(uuid) from public, anon;
grant  execute on function public.cms_delete_user(uuid) to authenticated;
