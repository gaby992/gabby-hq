-- GabbyHQ Supabase (NOT the inbox-IM project).
-- MEJORA 4: optional start_date on tasks. due_date already exists.
-- Run in Supabase SQL editor.

alter table tasks add column if not exists start_date date;
