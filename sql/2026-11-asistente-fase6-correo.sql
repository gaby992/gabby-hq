-- GabbyHQ Supabase (NOT the inbox-IM project).
-- ASISTENTE · FASE 6: correo dentro de GabbyHQ (reemplaza n8n / inbox-IM).
--
--   A. conexiones_google  — roles por cuenta: usa_calendar (solo UNA cuenta),
--                           usa_gmail (varias), duena ('Gabby' | 'Chelsea'),
--                           company_id (empresa a la que van sus tareas).
--   B. cuentas_correo     — la config de correo de cada cuenta: VIP, ruido,
--                           reglas importadas de n8n, chat y horario de alertas,
--                           y el cursor de Gmail (ultimo_history_id).
--   C. correos            — un correo por fila, clasificado (urgencia, tipo,
--                           categoría, confianza, razón), con su estado y la
--                           alerta de Telegram que recibió.
--   E. correo_evaluaciones — cómo clasificó cada modelo evaluado cada correo.
--      correo_veredictos   — lo que Gabby dice que debió ser (la verdad).
--
-- Nada de esto escribe en im_triaje. Sin RLS, como el resto del asistente.
-- Seguro de volver a correr: todo es idempotente.
-- Correr en Supabase → proyecto GabbyHQ → SQL Editor, en UNA sola query.
-- Sin begin/rollback aquí.

-- ── A. conexiones_google: roles por cuenta ────────────────────────────────
alter table conexiones_google add column if not exists usa_calendar boolean not null default false;
alter table conexiones_google add column if not exists usa_gmail    boolean not null default false;
-- 'Gabby' | 'Chelsea' (texto libre: la app lo muestra tal cual)
alter table conexiones_google add column if not exists duena        text;
alter table conexiones_google add column if not exists company_id   uuid references companies(id) on delete set null;

-- Calendar SOLO puede estar activo en una cuenta.
create unique index if not exists conexiones_google_una_calendar
  on conexiones_google ((true)) where usa_calendar;

-- Defaults: Gabby = calendar on, correo off (por ahora); Chelsea = calendar off, correo on.
update conexiones_google
   set usa_calendar = true, usa_gmail = false, duena = coalesce(duena, 'Gabby')
 where email = 'gabrielarangel169@gmail.com';
update conexiones_google
   set usa_calendar = false, usa_gmail = true, duena = coalesce(duena, 'Chelsea')
 where email = 'chelsea@interactivemarketing.net';
-- Si solo hay una cuenta y ninguna tiene calendar, la más reciente lo toma
-- (así Calendar sigue funcionando igual que antes).
update conexiones_google set usa_calendar = true
 where id = (select id from conexiones_google where activa order by conectado_en desc limit 1)
   and not exists (select 1 from conexiones_google where usa_calendar);

-- ── B. cuentas_correo ─────────────────────────────────────────────────────
create table if not exists cuentas_correo (
  id                 uuid primary key default gen_random_uuid(),
  conexion_id        uuid not null references conexiones_google(id) on delete cascade,
  nombre             text not null,                     -- "IM Chelsea"
  duena              text,                              -- 'Gabby' | 'Chelsea'
  activa             boolean not null default true,
  -- listas: un email o un dominio por elemento ("m@blessoproperties.com", "tottatl.com")
  vip                jsonb not null default '[]'::jsonb,
  ruido              jsonb not null default '[]'::jsonb,
  -- [{ "match": "dominio-o-email-o-texto", "accion": "vip|ruido|para_chelsea|lo_hago_yo|archivar|registrar", "alerta": true }]
  reglas             jsonb not null default '[]'::jsonb,
  chat_id_alertas    bigint,
  alertar            boolean not null default true,
  horario_alertas    text not null default '07:00-21:00',
  ultimo_history_id  text,
  created_at         timestamptz not null default now()
);

create unique index if not exists cuentas_correo_conexion_key on cuentas_correo (conexion_id);
alter table cuentas_correo disable row level security;

-- Precarga: la cuenta de Chelsea (activa) con su VIP y ruido iniciales, y la
-- de Gabby (inactiva, misma config) para activarla después con un click.
insert into cuentas_correo (conexion_id, nombre, duena, activa, vip, ruido)
select c.id, 'IM Chelsea', 'Chelsea', true,
       '["thesocialsceneagency.com","shiftliving.com","m@blessoproperties.com","diamondlawcenter.com","tottatl.com","reiblackbook.com"]'::jsonb,
       '["statefarm.com","bankofamerica.com","barclays.com","barclaycardus.com","citi.com","citibank.com"]'::jsonb
  from conexiones_google c
 where c.email = 'chelsea@interactivemarketing.net'
on conflict (conexion_id) do nothing;

insert into cuentas_correo (conexion_id, nombre, duena, activa, vip, ruido)
select c.id, 'IM Gabby', 'Gabby', false,
       '["thesocialsceneagency.com","shiftliving.com","m@blessoproperties.com","diamondlawcenter.com","tottatl.com","reiblackbook.com"]'::jsonb,
       '["statefarm.com","bankofamerica.com","barclays.com","barclaycardus.com","citi.com","citibank.com"]'::jsonb
  from conexiones_google c
 where c.email = 'gabrielarangel169@gmail.com'
on conflict (conexion_id) do nothing;

-- ── C. correos ────────────────────────────────────────────────────────────
create table if not exists correos (
  id                   uuid primary key default gen_random_uuid(),
  cuenta_id            uuid not null references cuentas_correo(id) on delete cascade,
  gmail_message_id     text not null,
  gmail_thread_id      text,
  de_nombre            text,
  de_email             text,
  asunto               text,                 -- MIME decodificado
  resumen              text,                 -- 1 línea; en hilos, solo lo nuevo
  cuerpo_texto         text,                 -- primeros 3000 caracteres, texto plano
  recibido_en          timestamptz,
  urgencia             text check (urgencia in ('alta', 'media', 'baja')),
  tipo                 text check (tipo in ('necesita_respuesta', 'pedido_de_tarea', 'fyi', 'notificacion', 'marketing', 'reunion', 'pago')),
  categoria            text,
  confianza            numeric(3, 2),        -- 0..1
  razon                text,
  estado               text not null default 'nuevo'
                         check (estado in ('nuevo', 'para_chelsea', 'lo_hago_yo', 'tarea', 'archivado', 'respondido', 'registrado')),
  alertado             boolean not null default false,
  decidido_en          timestamptz,
  telegram_chat_id     bigint,
  telegram_message_id  bigint,
  task_id              uuid,                 -- la tarea creada con "Lo hago yo" / "Tarea"
  created_at           timestamptz not null default now()
);

create unique index if not exists correos_gmail_message_key on correos (gmail_message_id);
create index if not exists correos_cuenta_recibido_idx on correos (cuenta_id, recibido_en desc);
create index if not exists correos_estado_idx on correos (estado, recibido_en desc);
create index if not exists correos_hilo_idx on correos (gmail_thread_id);
alter table correos disable row level security;

-- ── E. evaluación de modelos ──────────────────────────────────────────────
create table if not exists correo_evaluaciones (
  id          uuid primary key default gen_random_uuid(),
  correo_id   uuid not null references correos(id) on delete cascade,
  modelo      text not null,                 -- "openai:gpt-5-mini", "compatible:jev-…"
  urgencia    text,
  tipo        text,
  razon       text,
  created_at  timestamptz not null default now()
);

-- Reevaluar con el mismo modelo reemplaza la fila, no duplica.
create unique index if not exists correo_evaluaciones_key on correo_evaluaciones (correo_id, modelo);
alter table correo_evaluaciones disable row level security;

create table if not exists correo_veredictos (
  id          uuid primary key default gen_random_uuid(),
  correo_id   uuid not null references correos(id) on delete cascade,
  urgencia    text not null,                 -- lo que debió ser
  tipo        text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists correo_veredictos_key on correo_veredictos (correo_id);
alter table correo_veredictos disable row level security;

-- ── Verificación (solo lectura) ───────────────────────────────────────────
-- Esperado: usa_calendar, usa_gmail, duena, company_id en conexiones_google.
select email, usa_calendar, usa_gmail, duena, company_id from conexiones_google order by conectado_en;

-- Esperado: 2 cuentas (IM Chelsea activa, IM Gabby inactiva) con 6 VIP y 6 ruido.
select nombre, duena, activa, jsonb_array_length(vip) vip, jsonb_array_length(ruido) ruido, horario_alertas from cuentas_correo;

-- Esperado: rowsecurity = false en las 4 tablas nuevas.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('cuentas_correo', 'correos', 'correo_evaluaciones', 'correo_veredictos');
