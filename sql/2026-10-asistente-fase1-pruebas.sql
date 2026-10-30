-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 1 · PRUEBAS. Correr DESPUÉS de 2026-10-asistente-fase1.sql,
-- en una query aparte en el SQL Editor.
--
-- Por qué aparte: el editor de Supabase ejecuta toda la query como una sola
-- transacción. Un `rollback` aquí dentro de la misma query que la migración
-- desharía también la columna, el trigger y la tabla.
--
-- Ninguna prueba deja rastro: cada bloque termina en rollback.
-- Correr este archivo entero en una query. Si prefieres ver cada resultado por
-- separado, corre un bloque begin…rollback a la vez.

-- 1. Prueba del trigger, sin dejar rastro (rollback al final).
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

-- 2. Los inserts de n8n sobreviven: este no menciona completed_at ni
--    importante y debe pasar. Rollback: no queda nada.
begin;
  insert into tasks (text, priority, done) values ('__probe n8n__', 'normal', false);
  select text, done, completed_at from tasks where text = '__probe n8n__';
rollback;
