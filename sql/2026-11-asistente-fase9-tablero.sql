-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 9: tablero por horizonte (/hoy) y estado "esperando".
--
--   tasks.estado       'abierta' (default) | 'esperando'. Una tarea en
--                      "esperando" está en manos de alguien más: no entra en
--                      "🔥 Hoy sí o sí" ni en "¿qué sigue?" aunque tenga fecha
--                      vencida; sale en su propia columna / sección "⏳ Esperando".
--   tasks.esperando_a  de quién se espera ("Andrew (TOTT)"). Texto corto, NULLABLE.
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr ANTES del deploy de la fase 9 (el bot y el tablero leen estas columnas).
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

alter table tasks add column if not exists estado text not null default 'abierta';
alter table tasks drop constraint if exists tasks_estado_check;
alter table tasks add constraint tasks_estado_check check (estado in ('abierta', 'esperando'));

alter table tasks add column if not exists esperando_a text null;

-- Las tareas cerradas no esperan a nadie: si alguna quedó marcada, se limpia.
update tasks set estado = 'abierta', esperando_a = null where done = true and estado <> 'abierta';

-- ── Verificación ──────────────────────────────────────────────────────────
-- Esperado: dos filas, `estado` text not null default 'abierta', `esperando_a` text nullable.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'tasks' and column_name in ('estado', 'esperando_a')
 order by column_name;

-- Cuántas esperan ahora mismo (0 recién corrido el SQL).
select count(*) as esperando from tasks where done = false and estado = 'esperando';
