-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 5-C: fechas de pago recurrentes.
--
-- pagos_recurrentes: "pago IM Vercel el 15 de cada mes". Una fila por pago y
-- un evento RECURRENTE mensual en Calendar (gcal_event_id). NO son tareas:
-- no entran en Hoy ni en la matriz ni en las alarmas (pendiente, fase 2:
-- "💳 Hoy vence: IM Vercel" en la alarma de las 8 leyendo esta tabla).
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí.

create table if not exists pagos_recurrentes (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  nombre         text not null,
  dia_del_mes    smallint not null check (dia_del_mes between 1 and 31),
  monto_texto    text,
  -- Días antes para avisar; 0 = ese mismo día (9:00 am).
  recordatorios  int[] not null default '{7,3,0}',
  gcal_event_id  text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists pagos_recurrentes_company_idx
  on pagos_recurrentes (company_id, dia_del_mes);

-- La escribe el servidor (API con sesión y el bot); la UI de Settings pasa
-- por la API para que Calendar se actualice. Sin RLS, como el resto.
alter table pagos_recurrentes disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 9 columnas (id, company_id, nombre, dia_del_mes, monto_texto,
-- recordatorios, gcal_event_id, activo, created_at).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'pagos_recurrentes'
order by ordinal_position;

-- Esperado: rowsecurity = false.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'pagos_recurrentes';
