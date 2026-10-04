-- Author inputs for the blog agent.
--
-- A place to dump your own raw material — notes, numbers, screenshots, a
-- paragraph of opinion — for one post or for a whole cluster. The agent
-- treats it as authoritative and uses it where it fits. This is the only
-- part of a post that competitors can't copy, so it's worth the plumbing.
--
-- Shape of the `inputs` column:
--   { "text": "whatever you pasted (markdown-ish)",
--     "images": [{ "url": "https://…", "name": "spend-by-category.png" }] }
--
-- Safe to re-run. Paste into Supabase SQL editor.

alter table blog.agent_seeds add column if not exists inputs jsonb;
alter table blog.agent_items add column if not exists inputs jsonb;

comment on column blog.agent_seeds.inputs is 'Author notes/images applied to every post from this keyword';
comment on column blog.agent_items.inputs is 'Author notes/images for this post only';

-- ─── Storage for pasted images ─────────────────────────────────────────
-- Public bucket: the images end up in published posts, and the model has to
-- fetch them. Nothing private should be pasted here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-inputs', 'blog-inputs', true, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- Anyone may read (they're public URLs in published posts); only the author
-- may write or delete.
drop policy if exists "blog_inputs_public_read" on storage.objects;
create policy "blog_inputs_public_read" on storage.objects
  for select using (bucket_id = 'blog-inputs');

drop policy if exists "blog_inputs_author_write" on storage.objects;
create policy "blog_inputs_author_write" on storage.objects
  for all using (
    bucket_id = 'blog-inputs' and (auth.jwt() ->> 'email') = 'vinayteja23@gmail.com'
  ) with check (
    bucket_id = 'blog-inputs' and (auth.jwt() ->> 'email') = 'vinayteja23@gmail.com'
  );
