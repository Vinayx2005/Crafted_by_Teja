-- Content Studio: knowledge resources. ADDITIVE ONLY: one new table.
--
-- Documents and notes a brand's team gives the writer (product details, articles, FAQs,
-- brand facts). Only the TEXT is stored; uploaded files themselves are not kept.
-- Server only: the browser never reads or writes this table directly, every access goes
-- through the API, which checks the person's role in the brand's organisation.
--
-- Touches no existing table. Safe to re-run. Undo: migrations/studio_knowledge_rollback.sql
-- Check afterwards: migrations/studio_knowledge_validate.sql

create table if not exists public.studio_knowledge (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.studio_brands(id) on delete cascade,
  title      text not null check (length(title) between 1 and 120),
  kind       text not null check (kind in ('text', 'file')),
  file_name  text check (file_name is null or length(file_name) <= 200),
  content    text not null check (length(content) between 1 and 60000),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_knowledge_brand on public.studio_knowledge (brand_id, updated_at desc);

alter table public.studio_knowledge enable row level security;
revoke all on public.studio_knowledge from anon, authenticated;
-- No policies and no grants: only the server (service role) can touch it.
