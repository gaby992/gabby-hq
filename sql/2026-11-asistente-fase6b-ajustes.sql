-- GabbyHQ · Asistente · Ajustes de la fase 6 (correo) + bug del cierre de las 6
-- Correr en Supabase → SQL Editor, en UNA query. Idempotente: se puede repetir.
--
--   1. bot_alarmas.tipo admite 'lista' (una lista pedida a mano) y 'correos'
--      (la lista viva de correos de una cuenta), y guarda en qué mensaje de
--      Telegram salió (chat_id + message_id) y su texto, para poder tachar
--      una línea cuando el correo se resuelve (ajuste 6-3).
--   2. correos.vip (el remitente estaba en la lista VIP) y
--      correos.respondido_en (cuándo vio la respuesta el autoresolver), para
--      que un VIP respondido se quede 48 h en gris en las listas (ajuste 6-6).

-- ── 1. bot_alarmas ────────────────────────────────────────────────────────
alter table bot_alarmas drop constraint if exists bot_alarmas_tipo_check;
alter table bot_alarmas add constraint bot_alarmas_tipo_check
  check (tipo in ('manana', 'tarde', 'que_sigue', 'lista', 'correos'));

alter table bot_alarmas add column if not exists chat_id    bigint;
alter table bot_alarmas add column if not exists message_id bigint;
alter table bot_alarmas add column if not exists texto      text;

-- ── 2. correos ────────────────────────────────────────────────────────────
alter table correos add column if not exists vip           boolean not null default false;
alter table correos add column if not exists respondido_en timestamptz;

-- Lo ya clasificado: la razón empieza con "VIP:" o "regla VIP:" cuando el
-- remitente estaba en la lista. Los ya respondidos toman decidido_en.
update correos set vip = true
 where vip = false and (razon ilike 'VIP:%' or razon ilike 'regla VIP:%');
update correos set respondido_en = coalesce(decidido_en, created_at)
 where estado = 'respondido' and respondido_en is null;

create index if not exists correos_respondido_idx on correos (respondido_en desc) where respondido_en is not null;

-- ── Verificación ──────────────────────────────────────────────────────────
select pg_get_constraintdef(oid) as bot_alarmas_tipo from pg_constraint where conname = 'bot_alarmas_tipo_check';
select column_name from information_schema.columns
 where table_name = 'bot_alarmas' and column_name in ('chat_id', 'message_id', 'texto');
select count(*) filter (where vip) as vip, count(*) filter (where respondido_en is not null) as respondidos from correos;
