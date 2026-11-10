-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 16: LA SEMANA EN BLOQUES + GABITA CONVERSANDO.
--
-- Qué crea:
--   1. semana_bloques — la plantilla de la semana: cada día con sus bloques
--      (hora, nombre, de qué es, lo fijo de ese bloque y qué tareas le
--      tocan). Es lo que el Resumen muestra en "Hoy te toca", lo que dice
--      el mensaje de la mañana y lo que Gabita usa para proponer cuándo
--      hacer algo. Todo editable en Settings → Mi semana.
--   2. semana_reglas_mes — lo que cambia según el día del mes: del 1 al 7,
--      el Bloque B es un cliente de SEO/GEO por día; del 1 al 5, el Bloque
--      A son los estados de cuenta; del 12 al 16, el repaso de mitad de mes.
--   3. tasks.minutos_estimados / responsable / proyecto — cuánto tarda una
--      tarea, quién la hace y de qué proyecto es. Nulos en todo lo que ya
--      existe; nada cambia hasta que se llenen.
--
-- La plantilla se siembra UNA vez (solo si la tabla está vacía): volver a
-- correr este archivo nunca pisa lo que ella haya editado.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.

-- ── 1. Tareas: tiempo, responsable, proyecto ──────────────────────────────
alter table tasks add column if not exists minutos_estimados integer null;
alter table tasks add column if not exists responsable text null;
alter table tasks add column if not exists proyecto text null;

alter table tasks drop constraint if exists tasks_minutos_estimados_check;
alter table tasks add constraint tasks_minutos_estimados_check
  check (minutos_estimados is null or (minutos_estimados > 0 and minutos_estimados <= 6000));

-- ── 2. semana_bloques ─────────────────────────────────────────────────────
create table if not exists semana_bloques (
  id uuid primary key default gen_random_uuid(),
  -- 0 = domingo, 1 = lunes … 6 = sábado.
  dia smallint not null,
  inicio time not null,
  fin time not null,
  -- "Bloque A", "Estudio", "PD diario", "Tarde".
  nombre text not null,
  -- De qué es: "PD: cierre de la semana", "GHL", "DATAVIA".
  tema text not null default '',
  -- Las tareas de esta empresa caen en este bloque. NULL = cualquiera.
  company_id uuid null references companies(id) on delete set null,
  -- Si hay palabras, solo caen las tareas que traen alguna ("ghl", "quickbooks").
  palabras text[] not null default '{}',
  -- Lo que se hace SIEMPRE en este bloque (no son tareas: es la rutina).
  fijas text[] not null default '{}',
  -- false = bloque de rutina (bancos de las 7, el cierre): no recibe tareas.
  toma_tareas boolean not null default true,
  -- true = horario que no es de trabajo (niñas, comida): Gabita no agenda ahí.
  bloqueado boolean not null default false,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

alter table semana_bloques drop constraint if exists semana_bloques_dia_check;
alter table semana_bloques add constraint semana_bloques_dia_check check (dia between 0 and 6);
alter table semana_bloques drop constraint if exists semana_bloques_horas_check;
alter table semana_bloques add constraint semana_bloques_horas_check check (fin > inicio);

create index if not exists semana_bloques_dia_idx on semana_bloques (dia, inicio);
alter table semana_bloques disable row level security;

-- ── 3. semana_reglas_mes ──────────────────────────────────────────────────
-- En los días hábiles (lun–vie) cuyo día del mes cae entre `desde` y
-- `hasta`, el bloque que empieza a `inicio` cambia de tema. Con `rotacion`,
-- cada día hábil toma el siguiente de la lista ("Shift", luego "TOTT"…) y la
-- regla deja de aplicar cuando la lista se acaba.
create table if not exists semana_reglas_mes (
  id uuid primary key default gen_random_uuid(),
  desde smallint not null,
  hasta smallint not null,
  inicio time not null,
  tema text not null,
  rotacion text[] not null default '{}',
  fijas text[] not null default '{}',
  activo boolean not null default true,
  creado timestamptz not null default now()
);

alter table semana_reglas_mes drop constraint if exists semana_reglas_mes_dias_check;
alter table semana_reglas_mes add constraint semana_reglas_mes_dias_check
  check (desde between 1 and 31 and hasta between 1 and 31 and hasta >= desde);

alter table semana_reglas_mes disable row level security;

-- ── 4. La plantilla de Gabby (solo si está vacía) ─────────────────────────
do $$
declare
  pd uuid := (select id from companies where upper(trim(name)) = 'PD' limit 1);
  im uuid := (select id from companies where upper(trim(name)) = 'IM' limit 1);
  dv uuid := (select id from companies where upper(trim(name)) = 'DATAVIA' limit 1);
  d smallint;
  qb text[] := array['quickbooks', 'qb', 'paypal', 'statement', 'cashflow', 'cash flow', 'transferir', 'banco'];
begin
  if exists (select 1 from semana_bloques) then
    raise notice 'semana_bloques ya tiene filas: no se siembra nada';
    return;
  end if;

  -- Lunes a viernes: lo que es igual todos los días.
  for d in 1..5 loop
    insert into semana_bloques (dia, inicio, fin, nombre, tema, company_id, palabras, fijas, toma_tareas, bloqueado) values
      (d, '04:45', '06:45', 'Estudio',   'GHL: certificación',                null, array['ghl', 'estudiar', 'certificaci', 'curso'], array['2 temas de GHL en la Academy'], true,  false),
      (d, '07:00', '07:30', 'PD diario', 'Bancos, pagos y cashflow',          pd,   '{}', array['Resumen de bancos', 'Pagos del día', 'Reporte de cashflow'], false, false),
      (d, '07:30', '08:00', 'IM diario', 'Bancos, cargos, Stripe y cashflow', im,   '{}', array['Bancos y cargos', 'Stripe: pagos que vienen', 'Cashflow'], false, false),
      (d, '12:30', '13:00', 'Cierre',    'Nota de por dónde iba',             null, '{}', array['Dejar la nota "por dónde iba"'], false, false),
      (d, '13:00', '18:00', 'Bloqueado', 'Niñas y comida',                    null, '{}', '{}', false, true),
      (d, '18:00', '19:30', 'Tarde',     'Apps y DATAVIA',                    dv,   '{}', '{}', true,  false);
  end loop;

  -- Bloque A (8:15) y Bloque B (10:30) de cada día.
  insert into semana_bloques (dia, inicio, fin, nombre, tema, company_id, palabras, fijas) values
    (1, '08:15', '10:15', 'Bloque A', 'PD: cierre de la semana',          pd,   '{}', array['Cierre de la semana pasada en QuickBooks', 'Sales commission', 'Reporte weekly/monthly (Google Sheet)']),
    (1, '10:30', '12:30', 'Bloque B', 'GHL',                              im,   array['ghl'], '{}'),
    (2, '08:15', '10:15', 'Bloque A', 'IM: cierre de la semana',          im,   qb, array['Cierre de la semana en QuickBooks', 'Revisar el cashflow']),
    (2, '10:30', '12:30', 'Bloque B', 'Google Ads de Shift y GHL',        im,   array['shift', 'google ads', 'ghl'], array['Revisar Google Ads de Shift']),
    (3, '08:15', '10:15', 'Bloque A', 'PD: QuickBooks atrasado y payroll', pd,  '{}', array['Payroll (cuando toque)']),
    (3, '10:30', '12:30', 'Bloque B', 'DATAVIA: marketing y CPT',         dv,   '{}', '{}'),
    (4, '08:15', '10:15', 'Bloque A', 'IM: QuickBooks atrasado',          im,   qb, '{}'),
    (4, '10:30', '12:30', 'Bloque B', 'GHL',                              im,   array['ghl'], '{}'),
    (5, '08:15', '10:15', 'Bloque A', 'PD: QuickBooks atrasado',          pd,   '{}', '{}'),
    (5, '10:30', '12:30', 'Bloque B', 'Colchón: lo que no cerró en la semana', null, '{}', '{}');

  -- Sábado (mientras QuickBooks esté atrasado: 5 h).
  insert into semana_bloques (dia, inicio, fin, nombre, tema, company_id, palabras, fijas, toma_tareas) values
    (6, '04:45', '06:45', 'Estudio',  'GHL: certificación',                 null, array['ghl', 'estudiar', 'certificaci'], array['2 temas de GHL en la Academy'], true),
    (6, '07:30', '10:30', 'SEO/GEO',  'Curso SEO/GEO y terminar el blueprint', null, array['geo', 'blueprint'], array['Avanzar el curso de GEO', 'Cerrar el blueprint'], true),
    (6, '11:00', '12:00', 'PD',       'QuickBooks de PD',                   pd,   '{}', '{}', true),
    (6, '12:00', '13:00', 'IM',       'QuickBooks y cashflow de IM',        im,   qb, '{}', true);

  -- Domingo (mientras QuickBooks esté atrasado: 5 h).
  insert into semana_bloques (dia, inicio, fin, nombre, tema, company_id, palabras, fijas, toma_tareas) values
    (0, '08:00', '09:30', 'SEO/GEO',   'Aplicar el blueprint: repaso de clientes', null, array['seo', 'geo', 'tott', 'ptho', 'shift', 'urolog', 'cpt'], '{}', true),
    (0, '10:00', '12:30', 'QuickBooks', 'QuickBooks atrasado de PD e IM',   null, qb, '{}', true),
    (0, '12:30', '13:30', 'Al día',    'Videos e información nueva, cursos de DATAVIA', null, '{}', array['Ver lo último y actualizado'], false),
    (0, '18:00', '18:30', 'Revisión',  'Revisión semanal',                  null, '{}', array['Repasar la semana y planear la que viene'], false);

  -- Lo que cambia según el día del mes.
  insert into semana_reglas_mes (desde, hasta, inicio, tema, rotacion, fijas) values
    (1,  7,  '10:30', 'SEO/GEO del mes: un cliente por día', array['Shift', 'TOTT', 'PTHO', 'Urólogo', 'CPT'],
       array['Reporte y análisis de cómo cerró el mes', 'Keywords', 'Estrategia del mes para el equipo']),
    (1,  5,  '08:15', 'Estados de cuenta de IM y PD', array['día 1 de 3', 'día 2 de 3', 'día 3 de 3'],
       array['Bajar los estados de bancos y tarjetas', 'Subirlos a Lovable y Dropbox']),
    (12, 16, '10:30', 'Repaso SEO/GEO de mitad de mes', array['Shift, TOTT y PTHO', 'Urólogo y CPT'],
       array['Cómo va cada cliente', 'Ajustes para el equipo']);
end $$;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: 3 filas (minutos_estimados, responsable, proyecto).
select column_name, data_type from information_schema.columns
 where table_name = 'tasks' and column_name in ('minutos_estimados', 'responsable', 'proyecto')
 order by column_name;

-- Esperado: lun–vie 8 bloques cada uno, sábado 4, domingo 4 (48 en total).
select dia, count(*) as bloques from semana_bloques group by dia order by dia;

-- Esperado: 3 reglas de mes.
select desde, hasta, inicio, tema, rotacion from semana_reglas_mes order by desde, inicio;

-- Esperado: rowsecurity = false en las dos tablas.
select relname, relrowsecurity from pg_class where relname in ('semana_bloques', 'semana_reglas_mes');
