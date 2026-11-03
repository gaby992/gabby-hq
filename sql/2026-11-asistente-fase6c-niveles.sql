-- GabbyHQ · Asistente · Ajustes 6c (3 nov 2026): tres niveles por remitente.
-- Correr en Supabase → SQL Editor, en UNA query. Idempotente: se puede repetir.
--
--   Cada cuenta de correo tiene tres listas (email o dominio por elemento):
--     🔇 Silencio  → columna `ruido`    (se registra; no sale en Telegram, ni en "correos", ni en /correo)
--     📋 Solo app  → columna `solo_app` (NUEVA: entra a /correo y a "correos"; nunca alerta en Telegram)
--     🔔 Alerta    → columna `vip`      (Telegram inmediato con botones + lista de las 8)
--   Las columnas conservan su nombre viejo; la app las muestra con los nombres nuevos.

-- ── 1. Columnas nuevas ────────────────────────────────────────────────────
alter table cuentas_correo add column if not exists solo_app jsonb not null default '[]'::jsonb;
-- Idioma de la dueña ('es' | 'en'): resumen, razón, alertas y listas de correo salen así.
alter table cuentas_correo add column if not exists idioma text not null default 'es';
alter table cuentas_correo drop constraint if exists cuentas_correo_idioma_check;
alter table cuentas_correo add constraint cuentas_correo_idioma_check check (idioma in ('es', 'en'));

-- ── 2. Precarga en IM Chelsea (se suma a lo que haya; sin duplicados) ────────
--   3 nov (segunda tanda): slack.com en Silencio; las respuestas de calendario
--   ("Accepted: …" / "Declined: …" / "Tentative: …") en Solo app por asunto
--   (regla `^accepted:` = el asunto empieza por eso). Idioma de IM Chelsea → 'en'.
update cuentas_correo
   set ruido = (
     select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
       from jsonb_array_elements_text(
         ruido || '["zoom.us","fathom.video","fireflies.ai","read.ai","otter.ai","trustpilotmail.com","gusto.com","calendar-notification@google.com","slack.com"]'::jsonb
       ) as t(x)
   ),
       reglas = reglas || coalesce((
     select jsonb_agg(n)
       from jsonb_array_elements('[{"match":"^accepted:","accion":"solo_app","alerta":false},{"match":"^declined:","accion":"solo_app","alerta":false},{"match":"^tentative:","accion":"solo_app","alerta":false}]'::jsonb) as n
      where not exists (select 1 from jsonb_array_elements(reglas) as e where e->>'match' = n->>'match')
   ), '[]'::jsonb),
       idioma = 'en',
       solo_app = (
     select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
       from jsonb_array_elements_text(solo_app || '["gabrielarangel169@gmail.com"]'::jsonb) as t(x)
   )
 where nombre = 'IM Chelsea';

-- ── Verificación ──────────────────────────────────────────────────────────
-- Esperado: IM Chelsea con idioma 'en', ≥ 15 en silencio, 1 en solo_app y 3 reglas `^accepted:` / `^declined:` / `^tentative:` → solo_app.
select nombre, idioma, jsonb_array_length(ruido) silencio, jsonb_array_length(solo_app) solo_app, jsonb_array_length(vip) alerta, jsonb_array_length(reglas) reglas from cuentas_correo;
