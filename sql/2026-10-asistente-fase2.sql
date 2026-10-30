-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 2: notas de voz + borradores con botones.
--
-- bot_borradores: una tarea que el bot entendió a medias (sin empresa o sin
-- urgencia) espera aquí a que Gabby toque el botón que la completa. Vive
-- máximo 10 minutos y hay una sola por chat: el siguiente mensaje la
-- reemplaza.
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí: las pruebas van en 2026-10-asistente-fase2-pruebas.sql,
-- en otra query, después.

create table if not exists bot_borradores (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  texto       text not null,
  -- Lo que el parser entendió: { text, priority, company_id, company_name,
  -- importante, due_date }. Los null son lo que falta preguntar.
  parsed      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- El bot siempre busca "el borrador más reciente de este chat".
create index if not exists bot_borradores_chat_idx
  on bot_borradores (chat_id, created_at desc);

-- Solo la escribe el servidor (service role); nada del navegador la toca.
alter table bot_borradores enable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 5 columnas (id, chat_id, texto, parsed, created_at).
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'bot_borradores'
order by ordinal_position;

-- Esperado: rowsecurity = true.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'bot_borradores';
