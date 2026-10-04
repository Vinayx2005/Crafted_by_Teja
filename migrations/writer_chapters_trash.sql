-- Writers Book Studio — deleted chapters bin.
--
-- Deleting a chapter or empty page now sets deleted_at instead of removing
-- the row; the book page lists them under "Deleted chapters" with Restore
-- and Delete forever. Rows with deleted_at set are left out of the book,
-- the preview and every export. Existing RLS (chapters_owner) already covers
-- the column.
--
-- Run after writer_books.sql. Safe to re-run.

alter table writer.chapters add column if not exists deleted_at timestamptz;
