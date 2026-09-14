-- GabbyHQ Supabase (NOT the inbox-IM project).
-- CAMBIO 1a: make sure `tasks` has the two date columns end to end.
--
-- Both columns are NULLABLE and have NO default on purpose: n8n (Workflow B,
-- the Telegram "Task → GabbyHQ" and "I'll handle it" buttons) inserts rows
-- without any date, and those inserts must keep working untouched.
--
-- Safe to re-run: every statement is idempotent.
-- Run in the Supabase SQL editor of the GabbyHQ project.

alter table tasks add column if not exists due_date   date;
alter table tasks add column if not exists start_date date;

-- Speeds up the "Hoy" view, which filters open tasks by due_date.
create index if not exists tasks_due_date_idx on tasks (due_date) where done = false;

-- ── Verification ──────────────────────────────────────────────────────────
-- Expected: two rows, data_type = date, is_nullable = YES, column_default = NULL.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'tasks'
  and column_name in ('due_date', 'start_date')
order by column_name;
