-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 17: PROYECTOS.
--
-- Un proyecto es lo que tiene un FINAL: "asistente del curso", "agente de
-- CPT", "marketing de DATAVIA". Guarda las 4 definiciones que ella pide
-- antes de arrancar cualquier cosa (qué es "terminado", producción, pruebas
-- y salida, con fechas) y agrupa sus pasos, que son tareas normales con
-- tasks.proyecto_id. Así los pasos caen en sus bloques como cualquier tarea
-- y el proyecto se ve entero en /proyectos.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

create table if not exists proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  company_id uuid null references companies(id) on delete set null,
  -- Qué es "terminado" (la versión mínima).
  terminado text not null default '',
  produccion_desde date null,
  produccion_hasta date null,
  pruebas_desde date null,
  pruebas_hasta date null,
  -- La fecha de salida: la que no se puede olvidar.
  salida date null,
  estado text not null default 'activo',
  notas text not null default '',
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

alter table proyectos drop constraint if exists proyectos_estado_check;
alter table proyectos add constraint proyectos_estado_check check (estado in ('activo', 'pausado', 'terminado'));
alter table proyectos disable row level security;

alter table tasks add column if not exists proyecto_id uuid null references proyectos(id) on delete set null;
create index if not exists tasks_proyecto_idx on tasks (proyecto_id) where proyecto_id is not null;

-- Verificación: esperado rowsecurity = false, y 1 fila con la columna proyecto_id.
select relname, relrowsecurity from pg_class where relname = 'proyectos';
select column_name from information_schema.columns where table_name = 'tasks' and column_name = 'proyecto_id';
