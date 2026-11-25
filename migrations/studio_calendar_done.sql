-- Content Calendar: "Completed". ADDITIVE ONLY: one new column on studio_calendar.
-- The dates a topic was marked completed. Kept per date, so each date a repeating topic
-- falls on is ticked off on its own. Existing rows start with none. Safe to re-run.
-- Undo: alter table public.studio_calendar drop column if exists done_days;

alter table public.studio_calendar add column if not exists done_days date[] not null default '{}';
