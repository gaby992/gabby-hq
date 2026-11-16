-- GabbyHQ Supabase (NOT the inbox-IM project).
-- FASE 20: cambiar el bloque de UN día, sin tocar la plantilla de la semana.
-- "Mañana el Bloque A es de PD", "el miércoles el de las 10:30 es de IM":
-- una fila por (fecha, hora de inicio del bloque) con la empresa de ese día.
-- La plantilla (semana_bloques) queda igual; al pasar el día, la fila ya no aplica.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

create table if not exists semana_cambios (
  fecha date not null,
  inicio time not null,
  company_id uuid references companies(id) on delete cascade,
  tema text,
  creado timestamptz not null default now(),
  primary key (fecha, inicio)
);

alter table semana_cambios disable row level security;

-- Verificación: esperado rowsecurity = false.
select relname, relrowsecurity from pg_class where relname = 'semana_cambios';
