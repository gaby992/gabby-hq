-- GabbyHQ Supabase (NOT the inbox-IM project).
-- AJUSTE 16b: la palomita de la agenda del Resumen.
-- Guarda qué líneas de la agenda (eventos de Google Calendar, pagos) marcó
-- como hechas en un día. No toca Google Calendar. Las tareas no pasan por
-- aquí: su palomita las completa de verdad.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

create table if not exists agenda_hechos (
  fecha date not null,
  clave text not null,
  creado timestamptz not null default now(),
  primary key (fecha, clave)
);

alter table agenda_hechos disable row level security;

-- Verificación: esperado rowsecurity = false.
select relname, relrowsecurity from pg_class where relname = 'agenda_hechos';
