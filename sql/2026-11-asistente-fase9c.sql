-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 9c: el asistente habla (menú, foto del tablero, narración,
-- preguntas naturales, chat web en /hoy).
--
--   1. bot_conversacion.canal  'telegram' (default) | 'web'. El chat 💬 de /hoy
--                              y Telegram son UNA sola conversación (mismo
--                              chat_id); esta columna dice por dónde entró
--                              cada turno (el panel web marca "desde Telegram").
--   2. tasks.updated_at        cuándo se tocó la tarea por última vez (trigger
--                              before update). "¿Qué tengo estancado?" = sin
--                              cambios en 14+ días. Se rellena con
--                              coalesce(completed_at, created_at) para que la
--                              pregunta funcione desde el primer día.
--
-- Nada rompe sin este SQL: el bot escribe los turnos sin `canal` y usa
-- `created_at` como "último cambio" hasta que exista `updated_at`.
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

-- ── 1. bot_conversacion.canal ─────────────────────────────────────────────
alter table bot_conversacion add column if not exists canal text not null default 'telegram';
alter table bot_conversacion drop constraint if exists bot_conversacion_canal_check;
alter table bot_conversacion add constraint bot_conversacion_canal_check check (canal in ('telegram', 'web'));

alter table bot_conversacion disable row level security;

-- ── 2. tasks.updated_at + trigger ─────────────────────────────────────────
alter table tasks add column if not exists updated_at timestamptz null;

-- Relleno único: lo último que sabemos de cada fila (cierre o creación).
update tasks set updated_at = coalesce(completed_at, created_at) where updated_at is null;

alter table tasks alter column updated_at set default now();
alter table tasks alter column updated_at set not null;

create or replace function tasks_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at
  before update on tasks
  for each row execute function tasks_set_updated_at();

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: bot_conversacion.canal text not null default 'telegram';
--           tasks.updated_at timestamptz not null default now().
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where (table_name = 'bot_conversacion' and column_name = 'canal')
    or (table_name = 'tasks' and column_name = 'updated_at')
 order by table_name;

-- Esperado: una fila, el trigger tasks_updated_at.
select tgname from pg_trigger where tgrelid = 'tasks'::regclass and tgname = 'tasks_updated_at';

-- Cuántas tareas abiertas llevan 14+ días sin moverse (lo que contesta "¿qué tengo estancado?").
select count(*) as estancadas
  from tasks
 where done = false and coalesce(estado, 'abierta') <> 'esperando' and updated_at < now() - interval '14 days';
