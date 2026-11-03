-- Ajuste 6-8 · SOLO LECTURA. Tareas con el mismo título (sin acentos ni
-- mayúsculas, espacios colapsados) donde al menos una está cerrada (done)
-- y al menos una sigue abierta: candidatas a duplicado que hay que revisar
-- a ojo ANTES de borrar nada. No ejecuta ningún update ni delete.
--
-- Columnas: titulo normalizado · cuántas abiertas · cuántas cerradas · y
-- cada fila con su id, empresa, estado, fecha y notas (recortadas), para
-- decidir cuál se queda.

create extension if not exists unaccent;   -- ya existe en Supabase; no falla si está

with normalizadas as (
  select
    t.id,
    t.text,
    t.done,
    t.due_date,
    t.priority,
    t.created_at,
    t.completed_at,
    c.name as empresa,
    left(coalesce(t.notes, ''), 80) as notas,
    regexp_replace(lower(unaccent(trim(t.text))), '\s+', ' ', 'g') as titulo_norm
  from tasks t
  left join companies c on c.id = t.company_id
),
grupos as (
  select
    titulo_norm,
    count(*) filter (where not done) as abiertas,
    count(*) filter (where done)     as cerradas
  from normalizadas
  group by titulo_norm
  having count(*) filter (where not done) >= 1
     and count(*) filter (where done)     >= 1
)
select
  g.titulo_norm,
  g.abiertas,
  g.cerradas,
  n.id,
  n.empresa,
  case when n.done then 'cerrada' else 'ABIERTA' end as estado,
  n.priority,
  n.due_date,
  n.created_at::date  as creada,
  n.completed_at::date as cerrada_el,
  n.notas
from grupos g
join normalizadas n on n.titulo_norm = g.titulo_norm
order by g.titulo_norm, n.done, n.created_at;
