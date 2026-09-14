-- GabbyHQ Supabase (NOT the inbox-IM project).
-- CAMBIO 6a: second axis — `importante` on tasks. This is what lets /hoy tell
-- "esto está en llamas" apart from "esto construye algo".
--
-- NOT NULL *with* a default on purpose: n8n (Workflow B, the Inbox-IM Telegram
-- buttons) inserts task rows that never mention this column, and those inserts
-- have to keep working untouched. The default fills it in for them, and every
-- row that already exists lands on `false` — nothing gets starred by accident.
--
-- Safe to re-run: every statement is idempotent.
-- Run in the Supabase SQL editor of the GabbyHQ project.

alter table tasks
  add column if not exists importante boolean not null default false;

-- The Eisenhower matrix in /hoy slices open tasks by this flag on every load.
create index if not exists tasks_importante_idx
  on tasks (importante) where done = false;

-- ── Verification ──────────────────────────────────────────────────────────
-- 1. The column. Expected: boolean · is_nullable = NO · column_default = false.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'tasks'
  and column_name = 'importante';

-- 2. Backfill sanity. Expected: nulos = 0, and importantes = 0 right after the
--    migration (the flag is opt-in, nothing should already be starred).
select count(*)                                as total,
       count(*) filter (where importante)      as importantes,
       count(*) filter (where importante is null) as nulos
from tasks;

-- 3. Proof that the n8n inserts survive: this one never mentions `importante`
--    and must still succeed, coming back as false. Rolled back, nothing is kept.
begin;
  insert into tasks (text, priority, done)
  values ('__probe importante__', 'normal', false);
  select text, importante from tasks where text = '__probe importante__';
rollback;
