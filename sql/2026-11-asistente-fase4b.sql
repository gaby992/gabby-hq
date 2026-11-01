-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 4b: "¿qué sigue?" + notas con edad.
--
--   1. notas_historial  — las notas "por dónde iba" que se archivan (desde el
--                         botón "archivar" en /hoy, o solas cuando se escribe
--                         una nota nueva encima de una vieja). Nada se pierde.
--   2. bot_alarmas.tipo — admite 'que_sigue': la respuesta de "¿qué sigue?"
--                         se numera y se guarda igual que las alarmas, para
--                         que "listo 1" / "pasa el segundo" funcionen sobre ella.
--
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- La limpieza de títulos (" hoy" / " mañana") va en otro archivo:
-- 2026-11-limpieza-titulos-hoy-manana.sql (primero el select, luego el update).

-- ── 1. notas_historial ────────────────────────────────────────────────────
create table if not exists notas_historial (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  nota         text not null,
  -- Cuándo se había escrito la nota viva (updated_at de notas_empresa).
  escrita_en   timestamptz,
  archivada_en timestamptz not null default now()
);

create index if not exists notas_historial_company_idx
  on notas_historial (company_id, archivada_en desc);

-- La escribe el navegador con la anon key (igual que notas_empresa), así que
-- su RLS debe ser la MISMA que la de notas_empresa. Se copia tal cual:
do $$
declare v_rls boolean;
begin
  select rowsecurity into v_rls from pg_tables
  where schemaname = 'public' and tablename = 'notas_empresa';
  if v_rls then
    execute 'alter table notas_historial enable row level security';
  else
    execute 'alter table notas_historial disable row level security';
  end if;
end $$;

-- ── 2. bot_alarmas admite 'que_sigue' ─────────────────────────────────────
alter table bot_alarmas drop constraint if exists bot_alarmas_tipo_check;
alter table bot_alarmas add constraint bot_alarmas_tipo_check
  check (tipo in ('manana', 'tarde', 'que_sigue'));

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 5 columnas (id, company_id, nota, escrita_en, archivada_en).
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'notas_historial'
order by ordinal_position;

-- Esperado: las dos filas con el MISMO rowsecurity.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('notas_empresa', 'notas_historial');

-- Esperado: el check con 'que_sigue'.
select pg_get_constraintdef(oid) from pg_constraint where conname = 'bot_alarmas_tipo_check';
