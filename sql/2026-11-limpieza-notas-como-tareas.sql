-- GabbyHQ Supabase (NOT the inbox-IM project).
-- LIMPIEZA ÚNICA: tareas abiertas que en realidad son notas "por dónde iba"
-- (el título empieza por "Por dónde iba", "nota:", "nota IM", "notas de …").
-- Desde la fase 4d el bot ya no las crea así: eso va a notas_empresa.
--
-- DOS PASOS, en queries separadas:
--   1. Correr SOLO el select y revisar la lista.
--   2. Decidir fila por fila: si el texto todavía sirve, cópialo a la nota de
--      esa empresa (GabbyHQ → /hoy → bloque de la empresa, o "nota IM: …" en
--      el bot) y luego corre el bloque APLICAR (descomentado) para mover las
--      tareas a notas_historial y borrarlas. Nada se pierde: cada una queda
--      en el historial con su texto completo.

-- ── 1. Ver qué hay ────────────────────────────────────────────────────────
select
  t.id,
  c.name       as empresa,
  t.text       as titulo,
  t.notes,
  t.priority,
  t.due_date,
  t.created_at
from tasks t
left join companies c on c.id = t.company_id
where t.done = false
  and t.text ~* '^\s*(por\s+d[oó]nde\s+(iba|voy|vamos)|notas?(\s+de)?\s*:?\s+)'
order by c.name, t.created_at;

-- ── 2. APLICAR (descomentar después de revisar) ───────────────────────────
-- Mueve cada una al historial de notas de su empresa (las que no tienen
-- empresa no caben en notas_historial: se borran igual, revísalas antes) y
-- luego las borra de tasks.
-- insert into notas_historial (company_id, nota, escrita_en)
-- select t.company_id,
--        t.text || case when t.notes is not null and t.notes <> '' then E'\n\n' || t.notes else '' end,
--        t.created_at
-- from tasks t
-- where t.done = false
--   and t.company_id is not null
--   and t.text ~* '^\s*(por\s+d[oó]nde\s+(iba|voy|vamos)|notas?(\s+de)?\s*:?\s+)';
--
-- delete from tasks t
-- where t.done = false
--   and t.text ~* '^\s*(por\s+d[oó]nde\s+(iba|voy|vamos)|notas?(\s+de)?\s*:?\s+)';
