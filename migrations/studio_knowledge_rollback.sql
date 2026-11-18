-- Undo studio_knowledge.sql: removes the knowledge resources table and the text in it.
-- Nothing else is touched. Scripts already written are unaffected.
drop table if exists public.studio_knowledge;
