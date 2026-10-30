-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 3: /pregunta.
--
-- bot_preguntas: una fila por pregunta respondida (o fallida), con el modelo,
-- los tokens y el tiempo. Sirve para ver cuánto cuesta y mejorar el prompt.
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí: la prueba va en 2026-10-asistente-fase3-pruebas.sql,
-- en otra query, después.

create table if not exists bot_preguntas (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  pregunta    text not null,
  -- Si falló, empieza con "ERROR: " y trae el motivo.
  respuesta   text not null,
  -- "openai:gpt-5-mini", "anthropic:claude-…"
  modelo      text not null,
  tokens_in   integer not null default 0,
  tokens_out  integer not null default 0,
  ms          integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists bot_preguntas_created_at_idx
  on bot_preguntas (created_at desc);

-- Solo la escribe el servidor con la service key, que ignora RLS de todos
-- modos; se deja explícitamente sin RLS para poder consultarla sin trabas
-- desde el SQL Editor y futuros reportes.
alter table bot_preguntas disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 9 columnas (id, chat_id, pregunta, respuesta, modelo, tokens_in,
-- tokens_out, ms, created_at).
select column_name, data_type
from information_schema.columns
where table_name = 'bot_preguntas'
order by ordinal_position;

-- Esperado: rowsecurity = false.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'bot_preguntas';
