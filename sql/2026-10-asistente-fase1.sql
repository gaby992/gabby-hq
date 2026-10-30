-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 1: alarmas 8:00 / 6:00 pm.
--
--   1. tasks.completed_at  — cuándo se cerró cada tarea (para "✅ Hecho hoy").
--   2. trigger             — lo llena/limpia solo, venga el cambio de donde
--                            venga (app, bot, /api/tasks, n8n).
--   3. bot_alarmas         — la numeración de cada alarma enviada, para que
--                            "pasa 2,5" sepa a qué tareas se refiere.
--
-- La columna nueva es NULLABLE y sin default a propósito: los inserts de n8n
-- (Workflow B) no la mencionan y deben seguir funcionando tal cual.
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor.

-- ── 1. Columna ────────────────────────────────────────────────────────────
alter table tasks add column if not exists completed_at timestamptz;

-- La alarma de las 6:00 pm busca "done = true y completed_at de hoy".
create index if not exists tasks_completed_at_idx
  on tasks (completed_at) where done = true;

-- ── 2. Trigger: done=true → now(); done=false → null ──────────────────────
-- Un solo lugar para la regla, en la base: así ni el bot, ni la app, ni n8n,
-- ni la API tienen que acordarse de mandar completed_at.
create or replace function tasks_set_completed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.done then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
  elsif new.done is distinct from old.done then
    new.completed_at := case when new.done then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completed_at on tasks;
create trigger tasks_set_completed_at
  before insert or update of done on tasks
  for each row
  execute function tasks_set_completed_at();

-- ── 3. bot_alarmas ────────────────────────────────────────────────────────
create table if not exists bot_alarmas (
  id          uuid primary key default gen_random_uuid(),
  enviada_en  timestamptz not null default now(),
  tipo        text not null check (tipo in ('manana', 'tarde')),
  -- [{ "n": 1, "task_id": "uuid" }, ...] en el orden del mensaje.
  items       jsonb not null default '[]'::jsonb
);

-- "pasa N" siempre busca la última: índice por fecha descendente.
create index if not exists bot_alarmas_enviada_en_idx
  on bot_alarmas (enviada_en desc);

-- Solo la escribe el servidor (service role). Igual que las tablas del
-- inbox-IM: nada del navegador la toca.
alter table bot_alarmas enable row level security;

-- ── Verificación ──────────────────────────────────────────────────────────
-- 1. La columna. Esperado: timestamp with time zone · is_nullable = YES ·
--    column_default = NULL.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'tasks' and column_name = 'completed_at';

-- 2. El trigger existe. Esperado: 1 fila, tasks_set_completed_at.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'tasks'::regclass and tgname = 'tasks_set_completed_at';

-- 3. La tabla. Esperado: 4 columnas (id, enviada_en, tipo, items).
select column_name, data_type
from information_schema.columns
where table_name = 'bot_alarmas'
order by ordinal_position;

-- 4. Prueba del trigger, sin dejar rastro (rollback al final).
--    Esperado: fila 1 completed_at = NULL; fila 2 con fecha; fila 3 NULL otra vez.
begin;
  insert into tasks (text, priority, done)
  values ('__probe completed_at__', 'normal', false);
  select 1 as paso, completed_at from tasks where text = '__probe completed_at__';
  update tasks set done = true  where text = '__probe completed_at__';
  select 2 as paso, completed_at from tasks where text = '__probe completed_at__';
  update tasks set done = false where text = '__probe completed_at__';
  select 3 as paso, completed_at from tasks where text = '__probe completed_at__';
rollback;

-- 5. Los inserts de n8n sobreviven: este no menciona completed_at ni
--    importante y debe pasar. Rollback: no queda nada.
begin;
  insert into tasks (text, priority, done) values ('__probe n8n__', 'normal', false);
  select text, done, completed_at from tasks where text = '__probe n8n__';
rollback;
