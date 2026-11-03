-- GabbyHQ · Asistente · Ajustes 6c (3 nov 2026): tres niveles por remitente.
-- Correr en Supabase → SQL Editor, en UNA query. Idempotente: se puede repetir.
--
--   Cada cuenta de correo tiene tres listas (email o dominio por elemento):
--     🔇 Silencio  → columna `ruido`    (se registra; no sale en Telegram, ni en "correos", ni en /correo)
--     📋 Solo app  → columna `solo_app` (NUEVA: entra a /correo y a "correos"; nunca alerta en Telegram)
--     🔔 Alerta    → columna `vip`      (Telegram inmediato con botones + lista de las 8)
--   Las columnas conservan su nombre viejo; la app las muestra con los nombres nuevos.

-- ── 1. La lista nueva ─────────────────────────────────────────────────────
alter table cuentas_correo add column if not exists solo_app jsonb not null default '[]'::jsonb;

-- ── 2. Precarga en IM Chelsea (se suma a lo que haya; sin duplicados) ────────
update cuentas_correo
   set ruido = (
     select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
       from jsonb_array_elements_text(
         ruido || '["zoom.us","fathom.video","fireflies.ai","read.ai","otter.ai","trustpilotmail.com","gusto.com","calendar-notification@google.com"]'::jsonb
       ) as t(x)
   ),
       solo_app = (
     select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
       from jsonb_array_elements_text(solo_app || '["gabrielarangel169@gmail.com"]'::jsonb) as t(x)
   )
 where nombre = 'IM Chelsea';

-- ── Verificación ──────────────────────────────────────────────────────────
-- Esperado: IM Chelsea con ≥ 14 en silencio y 1 en solo_app.
select nombre, jsonb_array_length(ruido) silencio, jsonb_array_length(solo_app) solo_app, jsonb_array_length(vip) alerta from cuentas_correo;
