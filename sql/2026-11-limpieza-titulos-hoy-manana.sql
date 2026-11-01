-- GabbyHQ Supabase (NOT the inbox-IM project).
-- LIMPIEZA ÚNICA: tareas abiertas cuyo título termina en " hoy" o " mañana"
-- (quedaron así antes de que el parser aprendiera a sacar la fecha).
-- → la fecha pasa a due_date (relativa a created_at, en hora de Cancún) y el
--   título se limpia. Solo si NO tenían due_date; si ya tenían, se respeta la
--   fecha y solo se limpia el título.
--
-- DOS PASOS, en queries separadas:
--   1. Correr SOLO el select de abajo y revisar la lista.
--   2. Si está bien, correr el bloque "APLICAR" (está comentado: quitar los
--      "-- " de cada línea). Vuelve a correr el select: debe dar 0 filas.

-- ── 1. Ver qué se va a cambiar ────────────────────────────────────────────
select
  t.id,
  t.text                                                   as titulo_actual,
  regexp_replace(t.text, '[\s,]+(hoy|mañana|manana)\s*[.!]?$', '', 'i') as titulo_nuevo,
  t.due_date                                               as due_date_actual,
  case
    when t.due_date is not null then t.due_date
    when t.text ~* '[\s,]+hoy\s*[.!]?$' then (t.created_at at time zone 'America/Cancun')::date
    else (t.created_at at time zone 'America/Cancun')::date + 1
  end                                                      as due_date_nuevo,
  c.name                                                   as empresa,
  t.created_at
from tasks t
left join companies c on c.id = t.company_id
where t.done = false
  and t.text ~* '[\s,]+(hoy|mañana|manana)\s*[.!]?$'
order by t.created_at;

-- ── 2. APLICAR (descomentar después de revisar) ───────────────────────────
-- update tasks t set
--   due_date = case
--     when t.due_date is not null then t.due_date
--     when t.text ~* '[\s,]+hoy\s*[.!]?$' then (t.created_at at time zone 'America/Cancun')::date
--     else (t.created_at at time zone 'America/Cancun')::date + 1
--   end,
--   text = regexp_replace(t.text, '[\s,]+(hoy|mañana|manana)\s*[.!]?$', '', 'i')
-- where t.done = false
--   and t.text ~* '[\s,]+(hoy|mañana|manana)\s*[.!]?$';
