-- GabbyHQ Supabase (NOT the inbox-IM project).
-- CAMBIO 2a: "por dónde iba" — one live note per company, overwritten in place.
-- Run in the Supabase SQL editor of the GabbyHQ project. Safe to re-run.

create table if not exists notas_empresa (
  id         uuid primary key default gen_random_uuid(),
  -- FK instead of a plain text name: companies are editable from Settings, so
  -- a text key would orphan the note the moment a company is renamed.
  company_id uuid not null references companies (id) on delete cascade,
  nota       text not null default '',
  updated_at timestamptz not null default now()
);

-- "Una sola fila viva por empresa": this is what makes the upsert overwrite
-- rather than accumulate history.
create unique index if not exists notas_empresa_company_id_key
  on notas_empresa (company_id);

-- ── Verification ──────────────────────────────────────────────────────────
-- 1. Columns.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'notas_empresa'
order by ordinal_position;

-- 2. RLS must MATCH `tasks`. The app reads and writes this table from the
--    browser with the anon key, exactly like it does with tasks/companies.
--    Both rows below must report the same `rowsecurity` value — if `tasks`
--    says false and `notas_empresa` says true, the notes will silently fail
--    to save.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('tasks', 'notas_empresa');
