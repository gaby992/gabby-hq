-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 14: SEGUNDO CEREBRO (documentos).
--
-- Qué crea:
--   1. Bucket PRIVADO "documentos" en Storage. Nada es público: la app
--      siempre genera un enlace firmado que caduca (1 hora).
--   2. Tabla documentos — la ficha de cada cosa guardada: el PDF o la foto
--      del contrato, y también las "notas sin archivo" ("el seguro del carro
--      es con GNP, se paga en marzo"), que son una fila sin ruta.
--      · busqueda = columna generada con el texto en español (título +
--        resumen + empresa + notas + el texto extraído del PDF). El índice
--        GIN es lo que hace que preguntarle "¿con quién tengo el seguro del
--        carro?" responda al instante.
--      · reemplaza_a + historial = renovaciones. La póliza nueva apunta a la
--        vieja; la vieja queda con historial = true (NO se borra) y deja de
--        contar para vencimientos.
--   3. Tabla documentos_borradores — lo que el bot propuso y espera
--      [Guardar] / [Corregir], y el grupo de varias fotos que todavía se
--      está armando ("¿son del mismo documento?").
--
-- Nada rompe sin este SQL: la pantalla Archivos avisa que falta correrlo.
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

-- ── 1. Bucket privado ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do update set public = false;

-- ── 2. documentos ─────────────────────────────────────────────────────────
create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'Otros',
  company_id uuid null references companies(id) on delete set null,
  -- Ruta dentro del bucket. NULL = nota sin archivo (texto o voz).
  ruta text null,
  tipo text null,
  paginas integer null,
  -- Texto extraído (PDF) o leído de la imagen; es lo que se busca.
  texto text null,
  resumen text null,
  fecha_documento date null,
  vence date null,
  monto numeric(14, 2) null,
  moneda text null,
  se_renueva boolean not null default false,
  notas text null,
  -- Renovaciones: la versión nueva apunta a la anterior.
  reemplaza_a uuid null references documentos(id) on delete set null,
  historial boolean not null default false,
  origen text not null default 'telegram',
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

alter table documentos add column if not exists company_id uuid null references companies(id) on delete set null;
alter table documentos add column if not exists paginas integer null;
alter table documentos add column if not exists reemplaza_a uuid null references documentos(id) on delete set null;
alter table documentos add column if not exists historial boolean not null default false;
alter table documentos add column if not exists origen text not null default 'telegram';

alter table documentos drop constraint if exists documentos_categoria_check;
alter table documentos add constraint documentos_categoria_check check (categoria in (
  'Contratos', 'Alquiler', 'Seguros', 'Finanzas', 'Facturas y recibos',
  'Salud', 'Documentos e IDs', 'Otros'
));

alter table documentos drop constraint if exists documentos_origen_check;
alter table documentos add constraint documentos_origen_check check (origen in ('telegram', 'web', 'nota'));

-- Búsqueda en español sobre todo lo que sirve para encontrarlo.
alter table documentos drop column if exists busqueda;
alter table documentos add column busqueda tsvector generated always as (
  to_tsvector('spanish',
    coalesce(titulo, '') || ' ' ||
    coalesce(categoria, '') || ' ' ||
    coalesce(resumen, '') || ' ' ||
    coalesce(notas, '') || ' ' ||
    coalesce(texto, '')
  )
) stored;

create index if not exists documentos_busqueda_idx on documentos using gin (busqueda);
create index if not exists documentos_vence_idx on documentos (vence) where vence is not null and historial = false;
create index if not exists documentos_categoria_idx on documentos (categoria);
create index if not exists documentos_company_idx on documentos (company_id);

create or replace function documentos_set_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado = now();
  return new;
end
$$;

drop trigger if exists documentos_actualizado on documentos;
create trigger documentos_actualizado
  before update on documentos
  for each row execute function documentos_set_actualizado();

alter table documentos disable row level security;

-- ── 3. documentos_borradores ──────────────────────────────────────────────
-- Un borrador por chat: lo que el bot propuso y espera [Guardar]/[Corregir],
-- o el grupo de fotos que se está juntando. Se limpia solo (24 h).
create table if not exists documentos_borradores (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  estado text not null default 'propuesto',
  -- { titulo, categoria, empresa, vence, monto, moneda, fecha_documento, resumen, se_renueva, notas }
  propuesta jsonb not null default '{}'::jsonb,
  -- [{ ruta, tipo, nombre, paginas, texto }] — varias fotos = un documento.
  archivos jsonb not null default '[]'::jsonb,
  -- Renovación: a qué documento reemplazaría si ella dice que sí.
  reemplaza_a uuid null references documentos(id) on delete set null,
  -- Corrección de una ficha ya guardada.
  documento_id uuid null references documentos(id) on delete cascade,
  creado timestamptz not null default now()
);

alter table documentos_borradores drop constraint if exists documentos_borradores_estado_check;
alter table documentos_borradores add constraint documentos_borradores_estado_check check (estado in (
  'propuesto', 'esperando_paginas', 'corrigiendo', 'preguntando_renovacion'
));

create index if not exists documentos_borradores_chat_idx on documentos_borradores (chat_id, creado desc);

alter table documentos_borradores disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: una fila, documentos con public = false.
select id, name, public from storage.buckets where id = 'documentos';

-- Esperado: 20 columnas de documentos (incluida busqueda tsvector).
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'documentos'
 order by ordinal_position;

-- Esperado: documentos_busqueda_idx (gin), documentos_vence_idx, documentos_categoria_idx, documentos_company_idx.
select indexname from pg_indexes where tablename = 'documentos' order by indexname;

-- Esperado: 0 filas (todavía no hay documentos) y rowsecurity = false en las dos tablas.
select relname, relrowsecurity from pg_class where relname in ('documentos', 'documentos_borradores');
select count(*) as documentos_guardados from documentos;
