-- Undo studio_calendar.sql: removes the content calendar table and the topics in it.
-- Nothing else is touched. Scripts already written are unaffected.
drop table if exists public.studio_calendar;
