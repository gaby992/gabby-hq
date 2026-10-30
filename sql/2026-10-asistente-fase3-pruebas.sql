-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 3 · PRUEBA. Correr DESPUÉS de 2026-10-asistente-fase3.sql,
-- en una query aparte. Termina en rollback: no deja nada.

begin;
  insert into bot_preguntas (chat_id, pregunta, respuesta, modelo, tokens_in, tokens_out, ms)
  values (123456789, '¿qué tengo hoy?', 'Tienes 3 cosas…', 'openai:gpt-5-mini', 2800, 120, 1900);
  -- Esperado: 1 fila.
  select pregunta, modelo, tokens_in, tokens_out, ms, created_at
  from bot_preguntas where chat_id = 123456789;
rollback;

-- ── Consultas útiles después de usarlo unos días (sin transacción) ────────
-- Costo aproximado del mes con gpt-5-mini ($0.25 / 1M in, $2 / 1M out):
-- select count(*) as preguntas,
--        sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out,
--        round(sum(tokens_in) * 0.25 / 1e6 + sum(tokens_out) * 2.0 / 1e6, 4) as usd
-- from bot_preguntas
-- where created_at >= date_trunc('month', now());
