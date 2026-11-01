-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 4 · PRUEBA. Correr DESPUÉS de 2026-10-asistente-fase4.sql,
-- en una query aparte. Termina en rollback: no deja nada.

begin;
  insert into bot_recordatorios (chat_id, texto, dispara_en)
  values
    (123456789, 'revisar pagos de PD', now() - interval '1 minute'),   -- ya vencida: el cron la mandaría
    (123456789, 'llamar al contador',  now() + interval '2 hours');    -- pendiente

  -- Esperado: 2 filas, enviado = false, la vencida primero.
  select texto, dispara_en, enviado, created_at
  from bot_recordatorios where chat_id = 123456789
  order by dispara_en;

  -- Lo que hace el cron: las vencidas y no enviadas. Esperado: 1 fila.
  select texto from bot_recordatorios
  where not enviado and dispara_en <= now() and chat_id = 123456789;

  update bot_recordatorios set enviado = true
  where chat_id = 123456789 and dispara_en <= now();

  -- "mis alarmas" después del envío. Esperado: 1 fila (llamar al contador).
  select texto from bot_recordatorios
  where chat_id = 123456789 and not enviado order by dispara_en;
rollback;

-- ── Consultas útiles (sin transacción) ────────────────────────────────────
-- Qué entendió el intérprete en los últimos mensajes (para afinar el prompt):
-- select created_at, pregunta, left(respuesta, 300) as acciones, tokens_in, tokens_out, ms
-- from bot_preguntas
-- where modelo like 'interprete:%'
-- order by created_at desc limit 30;
--
-- Mensajes que el modelo no supo leer (cayeron al parser clásico o a "No te entendí"):
-- select created_at, pregunta, respuesta from bot_preguntas
-- where modelo like 'interprete:%' and (respuesta like 'ERROR:%' or respuesta like '%"desconocido"%')
-- order by created_at desc limit 30;
--
-- Alarmas que ya sonaron, las últimas 20:
-- select texto, dispara_en, enviado from bot_recordatorios order by dispara_en desc limit 20;
