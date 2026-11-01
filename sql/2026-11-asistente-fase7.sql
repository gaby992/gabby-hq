-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 7: de comandos a conversación.
--
--   1. bot_conversacion — cada mensaje de ida y vuelta con el bot. El
--                         intérprete recibe los últimos 10 turnos (o los de
--                         los últimos 30 min) para entender "sí", "la
--                         segunda", "lo mismo para PD". También guarda las
--                         sugerencias que se declinaron ("luego").
--   2. asistente_config  — lo que se personaliza por alumna: su nombre, el
--                         nombre del bot, el tono y si el bot propone cosas o
--                         solo obedece. Una sola fila (id = 1). Se edita en
--                         Settings → Asistente.
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí.

-- ── 1. bot_conversacion ───────────────────────────────────────────────────
create table if not exists bot_conversacion (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  rol         text not null check (rol in ('user', 'assistant')),
  texto       text not null,
  -- Lo que ese turno tocó: { tareas: [{id, text}], declinado: "seguir" … }.
  acciones    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists bot_conversacion_chat_idx
  on bot_conversacion (chat_id, created_at desc);

alter table bot_conversacion disable row level security;

-- ── 2. asistente_config ───────────────────────────────────────────────────
create table if not exists asistente_config (
  id              integer primary key default 1 check (id = 1),
  nombre_persona  text not null default 'Gabby',
  nombre_bot      text not null default 'Asistente',
  -- 'informal' (tuteo cálido) | 'formal' (usted, más sobrio)
  tono            text not null default 'informal' check (tono in ('informal', 'formal')),
  -- false = modo menú: solo obedece, nunca propone
  sugerencias     boolean not null default true,
  updated_at      timestamptz not null default now()
);

insert into asistente_config (id) values (1) on conflict (id) do nothing;

alter table asistente_config disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 6 columnas de bot_conversacion y 6 de asistente_config.
select table_name, column_name, data_type
from information_schema.columns
where table_name in ('bot_conversacion', 'asistente_config')
order by table_name, ordinal_position;

-- Esperado: 1 fila con los defaults.
select * from asistente_config;
