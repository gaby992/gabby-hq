-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 5: conexión de Google en Settings + Calendar.
--
--   1. conexiones_google  — una fila por cuenta de Google conectada desde
--                           Settings → Conexiones. El refresh token va CIFRADO
--                           (AES-256-GCM con APP_ENCRYPTION_KEY, que solo vive
--                           en Vercel); la UI nunca lo muestra.
--   2. tasks.due_time     — hora de la tarea ('15:00'). Con fecha Y hora, la
--                           tarea es un evento de Calendar.
--   3. tasks.gcal_event_id — el id del evento en Google, para actualizarlo o
--                           borrarlo después.
--
-- Las columnas nuevas son NULLABLE y sin default a propósito: los inserts de
-- n8n (Workflow B) no las mencionan y deben seguir funcionando tal cual.
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí.

-- ── 1. conexiones_google ──────────────────────────────────────────────────
create table if not exists conexiones_google (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  refresh_token_enc text not null,
  scopes            text not null default '',
  conectado_en      timestamptz not null default now(),
  ultimo_uso        timestamptz,
  activa            boolean not null default true
);

-- "Reconectar" la misma cuenta reemplaza su token, no duplica la fila.
create unique index if not exists conexiones_google_email_key
  on conexiones_google (email);

-- Solo la lee y escribe el servidor (service role); el token está cifrado y la
-- llave no está en la base. Sin RLS, como el resto de tablas del asistente.
alter table conexiones_google disable row level security;

-- ── 2 y 3. tasks ──────────────────────────────────────────────────────────
alter table tasks add column if not exists due_time time;
alter table tasks add column if not exists gcal_event_id text;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 7 columnas (id, email, refresh_token_enc, scopes, conectado_en, ultimo_uso, activa).
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'conexiones_google'
order by ordinal_position;

-- Esperado: rowsecurity = false.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'conexiones_google';

-- Esperado: due_time (time without time zone, YES) y gcal_event_id (text, YES).
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'tasks' and column_name in ('due_time', 'gcal_event_id')
order by column_name;
