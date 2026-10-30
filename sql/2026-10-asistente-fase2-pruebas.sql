-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 2 · PRUEBAS. Correr DESPUÉS de 2026-10-asistente-fase2.sql,
-- en una query aparte (el editor corre cada query como una sola transacción;
-- un rollback junto a la creación la desharía).
-- No deja rastro: termina en rollback.

begin;
  insert into bot_borradores (chat_id, texto, parsed)
  values (123456789, 'llamar a Juan mañana',
          '{"text":"llamar a Juan","priority":null,"company_id":null,"company_name":null,"importante":false,"due_date":"2026-10-31"}'::jsonb);
  -- Esperado: 1 fila, con parsed->>'priority' en null y created_at = ahora.
  select chat_id, texto, parsed->>'priority' as priority, parsed->>'due_date' as due_date, created_at
  from bot_borradores where chat_id = 123456789;
rollback;
