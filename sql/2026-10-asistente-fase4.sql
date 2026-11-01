-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 4: lenguaje natural + alarmas propias.
--
-- bot_recordatorios: las alarmas que Gabby se pone a sí misma desde el bot
-- ("alarma mañana 3pm revisar pagos de PD"). Un cron cada 5 minutos
-- (/api/asistente/recordatorios) manda las vencidas y las marca `enviado`.
-- NO son tareas: no entran en Hoy, en la matriz ni en las alarmas de 8/18.
--
-- El intérprete de lenguaje natural no necesita tabla nueva: registra cada
-- mensaje en bot_preguntas (fase 3) con modelo "interprete:…".
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí: la prueba va en 2026-10-asistente-fase4-pruebas.sql,
-- en otra query, después.

create table if not exists bot_recordatorios (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  texto       text not null,
  -- Cuándo avisar (instante exacto; el bot lo calcula en hora de Cancún).
  dispara_en  timestamptz not null,
  enviado     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- El cron pregunta "las no enviadas con dispara_en <= ahora"; "mis alarmas"
-- pregunta "las no enviadas de este chat". Un índice parcial cubre ambas.
create index if not exists bot_recordatorios_pendientes_idx
  on bot_recordatorios (dispara_en) where not enviado;

-- Solo la escribe el servidor con la service key (que ignora RLS de todos
-- modos); se deja explícitamente sin RLS, igual que bot_preguntas, para
-- poder consultarla sin trabas desde el SQL Editor.
alter table bot_recordatorios disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 6 columnas (id, chat_id, texto, dispara_en, enviado, created_at).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'bot_recordatorios'
order by ordinal_position;

-- Esperado: rowsecurity = false.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'bot_recordatorios';

-- Esperado: 1 fila con el índice parcial.
select indexname from pg_indexes where tablename = 'bot_recordatorios';
