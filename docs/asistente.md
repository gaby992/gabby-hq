# GabbyHQ — Asistente personal por Telegram

Este documento explica, paso a paso y sin dar nada por sabido, cómo funciona el
asistente de Telegram de GabbyHQ, qué hay que hacer a mano para que arranque, y
cómo replicarlo para otra persona. Se construye en 5 fases; cada una tiene su
sección y **no se empieza una fase hasta validar la anterior**.

| Fase | Qué agrega | Estado |
| --- | --- | --- |
| 1 | Alarmas 8:00 am y 6:00 pm | ✅ Validada |
| 2 | Notas de voz (Whisper) | ✅ Validada |
| 3 | `/pregunta` (LLM) | ✅ Validada |
| 3b | Notas y `listo` por Telegram, avisos de OpenAI | ✅ Validada |
| 3c | Todo se maneja desde el bot: borrar, nota en tarea, editar, fecha de cierre | ✅ Construida — pendiente de validar |
| 4 | El bot entiende lenguaje natural + alarmas propias | ✅ Construida — pendiente de validar |
| 4b | "¿Qué sigue?" (bot + web), notas con edad, rediseño de /hoy, limpieza del parser | ✅ Construida — pendiente de validar |
| 4c | Lista completa a demanda, "qué sigue" siempre con 3 secciones, fechas en el intérprete | ✅ Construida — pendiente de validar |
| 5 | Conexión de Google en Settings + Calendar (solo a pedido) + pagos recurrentes | ✅ Construida — pendiente de validar |
| 6 | Correo dentro de GabbyHQ: Gmail, clasificador, alertas, evaluación de modelos (reemplaza n8n) | ✅ Construida — pendiente de validar |
| 6b | Ajustes del correo: listas desde `correos`, lista viva "correos", tachado en sitio, alertas solo VIP/alta, seguridad de mensajes, bug del cierre | ✅ Construida — pendiente de validar (correr el SQL 6b) |
| 6c | Correo: tres niveles por remitente (🔇 Silencio · 📋 Solo app · 🔔 Alerta), "Reaplicar reglas", aprender desde el bot ("el 5 es silencio"), "Reclasificar sin modelo", regla `^asunto` → Solo app, idioma por cuenta | ✅ Construida — pendiente de validar (correr el SQL 6c) |
| 7 | De comandos a conversación: memoria, sugerencias, "organízame", personalidad | ✅ Construida — pendiente de validar |
| 9 | Tablero por horizonte en /hoy (Hoy sí o sí · Mañana · Esta semana · Esperando · Después · Correos), arrastrar tarjetas, estado "esperando", alarma de las 8 reordenada | ✅ Construida — pendiente de validar (correr el SQL 9) |
| 9b | Tablero: franja de KPIs, vista Calendario (semana / mes, pagos recurrentes, arrastrar a un día), badge "sin empresa" editable, "la 5 es de PD" | ✅ Validada |
| 9c | El asistente habla: menú de botones, foto del tablero, resumen en líneas, preguntas narradas, chat 💬 en la web | ✅ Validada |
| 12 | Dashboard de vida: pantalla Resumen clara (agenda con Google Calendar en lectura, prioridades, correos, notas, KPIs, "Resumen diario", herramientas conectadas), menú lateral índigo/morado, pantallas Calendario y Notas, alerta de correo en el idioma de la cuenta | ✅ Construida — pendiente de validar |
| 12b | El asistente explica sus errores (Google en lenguaje normal + enlace para reconectar), eventos libres y repetidos en Calendar por voz, preguntas sobre lo que él mismo dijo, sin "Ojo" tras un tropiezo, botón Probar en Conexiones, chequeo de conexiones en la alarma de las 8 | ✅ Construida — pendiente de validar |
| 14 | Segundo cerebro: documentos (PDF y fotos) al bucket privado, ficha propuesta por el modelo con Guardar/Corregir, varias fotos = un documento, renovaciones con historial, notas sin archivo, preguntas con enlace firmado, vencimientos a 30/7/1 días con botón de renovar, pantalla Archivos | ✅ Construida — pendiente de validar |
| 15 | Cada cosa en su cajón: las alarmas con hora van a Google Calendar (suenan en el teléfono, pueden repetirse cada mes/semana/día), los temporizadores siguen en Telegram, posponer reescribe el mismo mensaje, "pasa mis alarmas al calendario", enlaces limpios | ✅ Construida — pendiente de validar |
| 16 | La semana en bloques (plantilla editable, reglas del mes, "Hoy te toca" en el Resumen y en el mensaje de la mañana, tiempo estimado por tarea) y Gabita conversando: propone días y bloques sobre su semana con un modelo propio | ✅ Construida — pendiente de validar |

---

## 0. Qué es y cómo funciona

GabbyHQ es una app web (Next.js) desplegada en **Vercel**, con los datos en
**Supabase** (Postgres). El bot de Telegram no es un programa aparte: es una
ruta más de esa misma app. Nada vive en n8n ni en otro servidor.

**Chuleta para usarlo** (no técnica, un ejemplo por línea): [comandos.md](comandos.md).
Es lo mismo que el bot manda con `/ayuda todo`; sale de
`src/lib/asistente/comandos.json` y se regenera con `npm run comandos`.

**Principio: el bot es la puerta principal.** Cualquier acción que exista en
la app debe poder decirse al bot, en texto o por voz: crear, completar, mover,
borrar y editar tareas, escribir notas, preguntar. La web (`/hoy`, `/tasks`,
`/correo`) es el tablero para **ver** (y, desde la fase 9, para mover
tarjetas arrastrando; desde la 9c, con el chat 💬 que es el mismo bot), no
un paso obligatorio. Si algo solo se
puede hacer desde la web, es un pendiente del bot.

Hay dos direcciones de tráfico:

```
 (1) Tú escribes (o hablas) al bot
     ┌──────────┐   webhook (HTTPS)   ┌───────────────────────┐   SQL   ┌──────────┐
     │ Telegram │ ──────────────────▶ │ Vercel · /api/telegram │ ──────▶ │ Supabase │
     └──────────┘ ◀────────────────── └───────────┬───────────┘ ◀────── └──────────┘
                    respuesta del bot             │ si es audio:
                    (texto o botones)             │ descarga el .ogg y lo manda a
                                                  ▼
                                          ┌───────────────┐
                                          │ OpenAI Whisper │ ──▶ texto ──▶ mismo parser
                                          └───────────────┘
                                                  │ si es /pregunta: contexto + pregunta
                                                  │ si es texto libre (fase 4): contexto + mensaje
                                                  ▼
                                          ┌────────────────────┐   respuesta ≤ 5 líneas, o
                                          │ LLM (OpenAI o      │ ──▶ JSON de acciones ──▶ plan
                                          │ Anthropic, por env)│      [✅ Hacer todo] → Supabase
                                          └────────────────────┘

 (2) El reloj te escribe a ti
     ┌─────────────┐  GET + secret  ┌──────────────────────────────┐  SQL  ┌──────────┐
     │ Vercel Cron │ ─────────────▶ │ /api/asistente/manana        │ ────▶ │ Supabase │
     │  (8:00 /    │                │ /api/asistente/tarde         │ ◀──── │          │
     │   6:00 pm / │                │ /api/asistente/recordatorios │       └──────────┘
     │   cada 5 min)│               └───────────┬──────────────────┘
     └─────────────┘                            │ sendMessage
                                                ▼
                                          ┌──────────┐
                                          │ Telegram │
                                          └──────────┘
```

- **Telegram → Vercel**: cuando mandas un mensaje al bot, Telegram hace una
  petición HTTP a `https://gabby-hq.vercel.app/api/telegram` (el *webhook*).
  Esa ruta lee el texto, escribe en Supabase y responde por Telegram.
- **Cron → Vercel → Telegram**: Vercel tiene un reloj (Cron) que a las horas
  configuradas llama a una ruta de la app. La ruta arma el mensaje leyendo
  Supabase y lo manda al chat.

Reglas que aplican a todo el asistente:

- **Solo obedece a chats autorizados.** La env var `ALLOWED_CHAT_IDS` es una
  lista de `chat_id` separada por comas. Cualquier otro chat recibe
  "No autorizado" y nada se procesa. Las alarmas se mandan a esos mismos chats.
- **Hora de Cancún.** Todo "hoy / mañana" se calcula en `America/Cancun`
  (UTC-5, sin horario de verano). Vercel Cron trabaja en UTC, por eso los
  horarios en `vercel.json` están corridos 5 horas.
- **Secretos solo en Vercel.** Nunca en el código ni en commits.
- **Lo de la app en Vercel, lo de cada cuenta en Settings.** Lo que es de la
  APP (token del bot, Supabase, OpenAI, `CRON_SECRET`, client id/secret de
  Google, llave de cifrado) vive en Vercel como env var. Lo que es de UNA
  CUENTA (su acceso a Google, sus listas, su chat) vive en la base, en
  Settings → Conexiones, cifrado con la llave de Vercel. Así se agregan
  cuentas (Chelsea, PD) con un click, sin tocar Vercel.
- **Inbox-IM es producción.** El asistente solo *lee* `im_triaje` (cuenta
  correos). Nunca escribe ahí.
- **Columnas nuevas en `tasks`** siempre nullable o con default, para que los
  inserts de n8n (Workflow B) sigan funcionando.

Archivos del asistente dentro del repo:

| Ruta | Qué es |
| --- | --- |
| `vercel.json` | Los tres horarios del Cron (8:00, 6:00 pm, cada 5 min) |
| `src/app/api/asistente/manana/route.ts` | Alarma de las 8:00 |
| `src/app/api/asistente/tarde/route.ts` | Alarma de las 6:00 pm |
| `src/app/api/asistente/recordatorios/route.ts` | Cron cada 5 min: manda las alarmas propias vencidas (fase 4) |
| `src/app/api/telegram/route.ts` | Webhook del bot: lee el update y llama al motor dentro del canal Telegram |
| `src/lib/asistente/motor.ts` | Fase 9c: el motor del bot (antes vivía en el webhook): comandos exactos, texto libre → intérprete → plan, audios, botones. Lo comparten Telegram y el chat web |
| `src/lib/asistente/canal.ts` | Fase 9c: por dónde habla el bot en esta petición (`telegram` \| `web`): el envío consulta esto; en la web los mensajes se recogen y vuelven como JSON |
| `src/lib/asistente/menu.ts` | Fase 9c-A: el menú fijo (reply keyboard) y qué pregunta es cada botón |
| `src/lib/asistente/tablero-datos.ts` | Fase 9c-B: el modelo de la foto del tablero (KPIs + 4 columnas, 6 tarjetas) |
| `src/lib/asistente/tablero-imagen.tsx` | Fase 9c-B: dibuja la foto con `next/og`, la manda con `sendPhoto` y firma la URL |
| `src/app/api/asistente/tablero.png/route.ts` | Fase 9c-B: la foto como PNG (`CRON_SECRET`, sesión o `?firma=`) |
| `src/lib/asistente/narracion.ts` | Fase 9c-C/D: el párrafo de las alarmas y las respuestas narradas a las preguntas naturales |
| `src/lib/asistente/preguntas.ts` | Fase 9c-D: qué pregunta natural es un texto (hoy, pendiente, mañana, estancado, empresa, esperando, semana), sin modelo |
| `src/lib/asistente/simbolos.ts` | Los símbolos de las listas (🔺 🔸 ✴️ ▫️ ▪️), separados para que la narración no importe `alarmas.ts` |
| `src/app/api/asistente/chat/route.ts` | Fase 9c-E: el chat 💬 de /hoy (GET historial · POST texto o botón) sobre el mismo motor |
| `src/components/ChatPanel.tsx` | Fase 9c-E: el botón flotante y el panel lateral de conversación en /hoy |
| `src/lib/asistente/relectura.ts` | Ajuste 9c-1: «eso no son correos, son tareas» / «no, me refería a…» como corrección de la última lectura |
| `scripts/pruebas-parser.mjs` · `scripts/pruebas-loader.mjs` | `npm run pruebas`: pruebas del parser sin base de datos (menú, tablero, preguntas naturales, correos por lenguaje natural, relecturas) |
| `src/lib/asistente/config.ts` | Fase 7: lo que se personaliza (nombre, bot, tono, sugerencias) y el **system prompt único** (`personaPrompt`) |
| `src/lib/asistente/conversacion.ts` | Fase 7: el hilo (`bot_conversacion`): últimos 10 turnos / 30 min, "olvida lo anterior", sugerencias declinadas |
| `src/lib/asistente/sugerencias.ts` | Fase 7: la única sugerencia por mensaje, con botones, y qué hace cada botón |
| `src/lib/asistente/organizar.ts` | Fase 7: el modo "organízame" (cola, botones, resumen) |
| `src/lib/asistente/similitud.ts` | Fase 7-G: "nunca duplicar" — similitud de títulos (≥ 0.75), palabras clave específicas (lista `GENERICAS`), una tarea por línea |
| `src/lib/asistente/correcciones.ts` | Ajuste 7-G: corregir el plan pendiente ("quita X repetido", "déjala donde estaba", "olvídalo", fusionar lo que diga el modelo) sin borrar ni completar nada |
| `src/lib/correo/*` | Fase 6: correo dentro de GabbyHQ (Gmail, clasificador, alertas, decisiones, evaluación de modelos) — ver § 6 |
| `src/lib/correo/listas.ts` | Ajustes 6b: la sección 📧 de las listas, la lista "correos" de una cuenta y el tachado en sitio — ver § 6f |
| `src/lib/asistente/registro-listas.ts` | Ajustes 6b: `bot_alarmas` con chat/mensaje/texto; la última lista numerada de cualquier tipo |
| `src/lib/errores.ts` | Ajuste 6b-1: `mensajeError` / `redactar` — ningún valor de env var ni key sale en mensajes ni logs |
| `src/lib/asistente/pasos.ts` | Fase 7-H: dividir una tarea en 3–5 subtareas y "siguiente paso" |
| `src/app/api/asistente/config/route.ts` | Fase 7: Settings → Asistente (config + costo del mes) |
| `src/components/AsistenteConfigPanel.tsx` | Fase 7: el panel de Settings → Asistente |
| `src/lib/asistente/comandos.json` | La guía de uso (fuente única): `docs/comandos.md` y `/ayuda todo` salen de aquí |
| `src/lib/asistente/comandos.ts` | Renderiza esa guía para Telegram (2–3 mensajes HTML) |
| `scripts/comandos-md.mjs` | `npm run comandos`: regenera `docs/comandos.md` desde el JSON |
| `src/lib/parser.ts` | Parser de los comandos exactos (texto y voz): empresa, urgencia, ★, fecha; también el fallback del intérprete |
| `src/lib/asistente/interprete.ts` | Fase 4: contexto + prompt → JSON de acciones; registro en `bot_preguntas` |
| `src/lib/asistente/plan.ts` | Fase 4: resuelve refs (#3, t12, "la anterior", título), pinta "Entendí: …" y ejecuta |
| `src/lib/asistente/recordatorios.ts` | Fase 4: alarmas propias (`bot_recordatorios`): crear, listar, quitar, mandar, +1h/mañana |
| `src/lib/asistente/que-sigue.ts` | Fase 4b: "¿qué sigue?" — orden determinista en código, HTML como la lista; numeración en `bot_alarmas` |
| `src/app/api/asistente/que-sigue/route.ts` | Fase 4b: el botón "¿Qué sigue?" de /hoy (sesión de la app, no cron) |
| `src/lib/notas.ts` | Notas "por dónde iba": guardar (archiva la anterior en `notas_historial`), borrar, archivar, edad |
| `src/lib/google/crypto.ts` | Fase 5: cifra/descifra el refresh token (AES-256-GCM, `APP_ENCRYPTION_KEY`) |
| `src/lib/google/oauth.ts` | Fase 5: URL de consentimiento, canje del código, refresh del access token, desconectar |
| `src/lib/google/calendar.ts` | Fase 5: crear / actualizar / borrar el evento de una tarea |
| `src/lib/google/sync.ts` | Fase 5: decide si la tarea debe tener evento y lo deja igual a la fila |
| `src/app/api/google/oauth/start/route.ts` | Fase 5: "Conectar" → Google |
| `src/app/api/google/oauth/callback/route.ts` | Fase 5: Google → guarda la cuenta, vuelve a Settings |
| `src/app/api/google/conexiones/route.ts` | Fase 5: lista y desconecta (sin el token) |
| `src/app/(app)/settings/conexiones/page.tsx` | Fase 5: tarjeta "Google" con Conectar / Reconectar / Desconectar |
| `src/lib/asistente/whisper.ts` | Audio → texto con OpenAI whisper-1 |
| `src/lib/asistente/borradores.ts` | Tareas a medias esperando un botón (`bot_borradores`) |
| `src/lib/asistente/tareas.ts` | Preguntas con botones, confirmación en una línea, guardado |
| `src/lib/asistente/contexto.ts` | Arma el contexto en texto plano para `/pregunta` (sin el campo `notes`) |
| `src/lib/asistente/llm.ts` | Llamada al modelo: OpenAI o Anthropic según `LLM_PROVIDER` |
| `src/lib/asistente/pregunta.ts` | System prompt, timeout, respuesta y log en `bot_preguntas` |
| `src/lib/asistente/alarmas.ts` | Arma los mensajes, los manda, reintenta, guarda la numeración |
| `src/lib/asistente/acciones.ts` | `listo`, `pasa`, `borra`, `nota en …` y ediciones: por número de la última alarma o por palabra del título |
| `src/lib/asistente/notas-bot.ts` | `nota IM: …` desde Telegram (misma función de guardado que /hoy y /tasks) |
| `src/lib/asistente/openai-avisos.ts` | Clasifica errores de OpenAI y avisa por Telegram una vez al día |
| `src/lib/asistente/telegram.ts` | Envío HTML, partición a 4000 caracteres, lista de chats permitidos |
| `src/lib/asistente/cancun.ts` | Fechas en hora de Cancún |
| `src/lib/asistente/cron-auth.ts` | Verifica el `CRON_SECRET` |
| `sql/2026-10-asistente-fase1.sql` | Migración de la fase 1 (correr en una query) |
| `sql/2026-10-asistente-fase1-pruebas.sql` | Pruebas con rollback de la fase 1 (correr después, en otra query) |
| `sql/2026-10-asistente-fase2.sql` | Migración de la fase 2 (correr en una query) |
| `sql/2026-10-asistente-fase2-pruebas.sql` | Prueba con rollback de la fase 2 (correr después, en otra query) |
| `sql/2026-10-asistente-fase3.sql` | Migración de la fase 3 (correr en una query) |
| `sql/2026-10-asistente-fase3-pruebas.sql` | Prueba con rollback de la fase 3 + consulta de costos |
| `sql/2026-10-asistente-fase4.sql` | Migración de la fase 4: `bot_recordatorios` (correr en una query) |
| `sql/2026-10-asistente-fase4-pruebas.sql` | Prueba con rollback de la fase 4 + consultas para afinar el prompt |
| `sql/2026-11-asistente-fase4b.sql` | Migración de la fase 4b: `notas_historial` + `bot_alarmas.tipo` admite `que_sigue` |
| `sql/2026-11-limpieza-titulos-hoy-manana.sql` | Limpieza única: títulos que terminan en " hoy"/" mañana" → `due_date` (select primero, update después) |
| `sql/2026-11-limpieza-notas-como-tareas.sql` | Limpieza única: tareas que eran notas "por dónde iba" (select primero; mover a `notas_historial` y borrar después) |
| `sql/2026-11-asistente-fase5.sql` | Migración de la fase 5: `conexiones_google` + `tasks.due_time` + `tasks.gcal_event_id` |
| `sql/2026-11-asistente-fase5c.sql` | Migración de la fase 5-C: `pagos_recurrentes` |
| `sql/2026-11-asistente-fase6-correo.sql` | Migración de la fase 6: roles por cuenta en `conexiones_google` + `cuentas_correo`, `correos`, `correo_evaluaciones`, `correo_veredictos` |
| `sql/2026-11-asistente-fase6b-ajustes.sql` | Ajustes 6b: `bot_alarmas.tipo` admite `lista` y `correos` + columnas `chat_id`, `message_id`, `texto`; `correos.vip` y `correos.respondido_en` |
| `sql/2026-11-asistente-fase6c-niveles.sql` | Ajustes 6c: `cuentas_correo.solo_app` (la lista 📋 Solo app) y `cuentas_correo.idioma` ('es' / 'en') + precarga de Silencio, Solo app, las reglas `^accepted:` / `^declined:` / `^tentative:` e idioma 'en' en IM Chelsea (idempotente: se repite si se amplía) |
| `sql/2026-11-duplicadas-select.sql` | Solo lectura (ajuste 6b-8): tareas con el mismo título donde una está cerrada y otra abierta, para revisar antes de borrar |
| `sql/2026-11-asistente-fase7.sql` | Migración de la fase 7: `bot_conversacion` + `asistente_config` |
| `sql/2026-11-asistente-fase9-tablero.sql` | Migración de la fase 9: `tasks.estado` y `tasks.esperando_a` |
| `sql/2026-11-asistente-fase9c.sql` | Migración de la fase 9c: `bot_conversacion.canal` + `tasks.updated_at` con trigger (para "¿qué tengo estancado?") |
| `src/lib/asistente/pagos.ts` | Fase 5-C: pagos recurrentes (fila + evento mensual en Calendar) |
| `src/app/api/calendar/tarea/route.ts` | Fase 5-B: botón "📅 Agregar a Calendar" del panel de edición y casilla del formulario |
| `src/app/api/calendar/sync/route.ts` | Fase 5-D: la web avisa después de escribir una tarea para que su evento siga a la fila |
| `src/lib/calendar-client.ts` | Fase 5-D: helpers del navegador (sync, quitar antes de borrar, agregar/quitar) |
| `src/app/api/pagos/route.ts` | Fase 5-C: la tabla de pagos de Settings (lista, crea, cambia, quita; Calendar al día) |
| `src/components/PagosRecurrentes.tsx` | Fase 5-C: pestañas por empresa + tabla editable en /settings |

---

## 1. Fase 1 — Alarmas 8:00 am y 6:00 pm

### 1a. Qué hace

De lunes a sábado recibes dos mensajes en Telegram:

**☀️ A las 8:00 am — "Hoy, viernes 30 oct"**

Tu día, agrupado por empresa en este orden: IM · DATAVIA · PD · Personal ·
Chelsea (si hay tareas sin empresa, van al final en "Sin empresa"). Dentro de
cada empresa:

1. 📝 Tu nota "por dónde iba" completa, si la tienes escrita.
2. Las tareas que importan hoy, **numeradas de corrido** a lo largo de todo el
   mensaje (1, 2, 3… sin reiniciar por empresa), para poder referirte a ellas:
   - 🔺 vencidas, con "hace N días"
   - 🔸 vencen hoy
   - ✴️ urgentes o ★ importantes
   - ▫️ normales (con fecha primero, luego sin fecha)
   - ▪️ cuando pueda
   Desde la fase 4d la lista trae **todas** las tareas abiertas de cada
   empresa en ese orden (vencidas más viejas primero → vence hoy → urgente★
   → urgente → ★ → normal con fecha → normal sin fecha → cuando pueda), no
   solo las accionables. Si una empresa pasa de 12, se corta y termina en
   `· +N más en GabbyHQ` con link a `/tasks?company=<id>`. Los emojis son
   los más chicos que hay (Telegram no colorea texto); el mismo set va en el
   cierre, en "¿qué sigue?" y en `/pendientes`.

Una empresa sin nota y sin tareas en esas categorías no aparece. En el bloque
de Chelsea también va cuántos correos tiene pendientes en inbox-IM, con link a
`/inbox`. Al final: "Total: N tareas · abrir GabbyHQ".

Si no hay nada que decir, igual llega un mensaje: "☀️ Hoy no tienes nada
urgente. Revisa Construir en GabbyHQ." **Siempre llega algo**: si un día no
llega nada, es que falló (ver 1e).

Ejemplo:

```
☀️ Hoy, viernes 30 oct

IM
📝 Pendiente la propuesta de X; retomar por la sección de precios.
🔺 1. Mandar factura de septiembre · hace 3 días
🔸 2. Llamar a Y
✴️ 3. Revisar contrato · 5 nov

PD
✴️ 4. Armar deck para inversionistas

Chelsea
✴️ 5. Cotizar proveedor nuevo
📬 3 correos pendientes → /inbox

Total: 5 tareas · abrir GabbyHQ
```

**🌙 A las 6:00 pm — "Cierre del día"**

- ✅ **Hecho hoy (N)**: todo lo que marcaste como hecho hoy, por empresa.
- ⏳ **Sigue pendiente (N)**: la misma selección de la mañana (vencidas, de
  hoy, urgentes/★) que siga abierta, numerada de nuevo, por empresa.
- ❌ **Vencidas hoy sin cerrar (N)**: las que vencían hoy y no cerraste, con su
  mismo número.
- Al final: "¿Qué pasa a mañana? Responde: `pasa 2,5` (o `pasa todo`)".

**Responder `pasa 2,5` o `pasa todo`**

El bot mueve la fecha de esas tareas a mañana (hora de Cancún) y confirma en
una línea: "✅ 2 tareas pasan a mañana (31 oct)". Los números se resuelven
contra **la última alarma enviada** (la de la mañana o la de la tarde, la que
haya llegado más recientemente), así que valen aunque la lista haya cambiado.
`pasa` sin números te recuerda el formato.

**¿Y si algo falla?**

Si el cron corre y no puede (Supabase caído, Telegram responde error), vuelve a
intentar una vez a los 30 segundos. Si vuelve a fallar, te manda
"⚠️ La alarma de las 8:00 falló: {motivo}". Tú siempre te enteras.

**Qué cambia en la base de datos**

- `tasks.completed_at`: la hora en que cerraste cada tarea. La llena un
  *trigger* de Postgres cuando `done` pasa a `true` y la vacía cuando pasa a
  `false`, venga el cambio de donde venga (app, bot, API, n8n). Nadie tiene
  que acordarse de mandarla.
- Tabla nueva `bot_alarmas`: una fila por alarma enviada con la lista
  `[{n, task_id}]`. Es lo que hace que `pasa 3` sepa qué tarea es la 3.

### 1b. Lo que hay que hacer a mano

> El bot de Telegram y el webhook ya existen de antes (`/api/telegram`). Esta
> fase no toca BotFather. Solo falta: SQL, tres env vars y apagar el workflow
> viejo de n8n.

**Paso 1 — Correr el SQL en Supabase (dos queries, en este orden)**

> Importante: el SQL Editor de Supabase ejecuta **toda la query como una sola
> transacción**. Por eso la migración y las pruebas van en archivos separados:
> las pruebas terminan en `rollback`, y si fueran en la misma query desharían
> también la creación. Primero la migración, luego las pruebas, cada una en su
> propia query.

1. Entra a https://supabase.com y abre el proyecto **GabbyHQ** (no el de
   inbox-IM).
2. En la barra izquierda, click en **SQL Editor** → **New query**.
3. Abre `sql/2026-10-asistente-fase1.sql` del repo, copia todo su contenido,
   pégalo y click en **Run** (o Ctrl/Cmd + Enter). Esto crea la columna, el
   trigger y la tabla, y al final hace tres consultas de solo lectura. Revisa:
   - `completed_at` existe, `is_nullable = YES`, sin default.
   - Aparece el trigger `tasks_set_completed_at`.
   - `bot_alarmas` tiene 4 columnas: `id`, `enviada_en`, `tipo`, `items`.
4. Otra vez **New query** (una pestaña nueva, no la misma). Abre
   `sql/2026-10-asistente-fase1-pruebas.sql`, pégalo y **Run**. Son dos
   bloques `begin … rollback` que no dejan filas:
   - La prueba del trigger muestra `completed_at` en `NULL` → con fecha →
     `NULL` otra vez.
   - El insert "estilo n8n" (sin `completed_at` ni `importante`) pasa.
   Si quieres ver cada resultado por separado, corre un bloque a la vez.

Hazlo **antes** de que se dispare la primera alarma. Si la alarma corre sin la
migración, no se rompe nada: te llega "⚠️ La alarma … falló: column
completed_at does not exist" y lo sabes.

**Paso 2 — Generar el `CRON_SECRET`**

Es una contraseña larga que solo conocen Vercel y la app. Genera una de 32
bytes en hexadecimal con cualquiera de estas opciones:

- En una terminal (Mac/Linux/Codespaces):
  ```bash
  openssl rand -hex 32
  ```
- O con Node:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Copia el resultado (64 caracteres). Guárdalo también en tu gestor de
contraseñas: lo necesitas para las pruebas manuales.

**Paso 3 — Crear las env vars en Vercel**

1. Entra a https://vercel.com, abre el proyecto **gabby-hq**.
2. Arriba, pestaña **Settings** → en la izquierda **Environment Variables**.
3. Por cada variable de la tabla de 1c: escribe el **Key**, pega el **Value**,
   deja marcados los tres entornos (Production, Preview, Development) y click
   en **Save**.
4. Las env vars solo se aplican a deploys nuevos. Al terminar, pestaña
   **Deployments** → en el deploy más reciente, menú `⋯` → **Redeploy** →
   confirma. (Un push a `main` también sirve.)

**Paso 4 — Comprobar que el Cron quedó registrado**

1. En el mismo proyecto de Vercel: **Settings** → **Cron Jobs**.
2. Deben aparecer dos entradas: `/api/asistente/manana` con `0 13 * * 1-6` y
   `/api/asistente/tarde` con `0 23 * * 1-6`. Si no aparecen, el deploy no
   llevaba el `vercel.json`: haz un redeploy.

Los crons solo corren en **Production** (el deploy de `main`), nunca en
previews.

**Paso 5 — Apagar el "Resumen de la mañana" de n8n**

Solo cuando ya hayas recibido bien la alarma de las 8:00 del repo (ver 1d):

1. Entra a tu n8n.
2. En la lista de workflows, abre la carpeta **inbox-IM**.
3. Abre el workflow del **Resumen de la mañana** (el de las 7:00).
4. Arriba a la derecha hay un interruptor **Active**: ponlo en **Inactive**.
   Con eso deja de correr; no hace falta borrarlo.

### 1c. Env vars que agrega esta fase

| Nombre | De dónde sale | Ejemplo (valor falso) |
| --- | --- | --- |
| `CRON_SECRET` | La generas tú (Paso 2). Vercel la manda sola en el header `Authorization: Bearer …` de cada llamada del Cron. | `3f9a1c…e7b2` (64 hex) |
| `ALLOWED_CHAT_IDS` | Tu `chat_id` de Telegram. Para obtenerlo: mándale cualquier cosa al bot y abre en el navegador `https://api.telegram.org/bot<TOKEN>/getUpdates`; busca `"chat":{"id":…}`. Varios chats van separados por coma. | `123456789` |
| `APP_URL` | La URL pública de la app, sin `/` al final. Se usa para los links del mensaje. | `https://gabby-hq.vercel.app` |

Ya existían y se reutilizan: `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_INBOXIM_URL`,
`SUPABASE_INBOXIM_SERVICE_KEY`.

> Ojo: desde que `ALLOWED_CHAT_IDS` entra en vigor, el bot **ignora** todo chat
> que no esté en la lista, también para los comandos viejos (`urgente …`,
> `radar …`). Si el bot te contesta "No autorizado", tu `chat_id` no está en la
> variable o falta el redeploy.

### 1d. Cómo probar que funciona

Las dos alarmas se pueden disparar a mano sin esperar la hora, con `?test=1`.
El mensaje llega con una primera línea "🧪 prueba manual" para distinguirlo.
Hay que mandar el secret en el header, igual que lo hace Vercel.

**Prueba 1 — Alarma de la mañana a mano**

En una terminal (sustituye el secret por el tuyo):

```bash
curl -i -H "Authorization: Bearer TU_CRON_SECRET" \
  "https://gabby-hq.vercel.app/api/asistente/manana?test=1"
```

Esperado: `HTTP 200`, un JSON `{"ok":true,"tipo":"manana","items":N,…}` y el
mensaje "☀️ Hoy, …" en Telegram en menos de 10 segundos, con las tareas
numeradas. Prueba que `pasa 1` (o el número que sea) responde "✅ 1 tarea pasa
a mañana" y que en `/tasks` esa tarea ahora vence mañana.

**Prueba 2 — Alarma de la tarde a mano**

```bash
curl -i -H "Authorization: Bearer TU_CRON_SECRET" \
  "https://gabby-hq.vercel.app/api/asistente/tarde?test=1"
```

Antes de correrla, marca una tarea como hecha en la app: debe salir en
"✅ Hecho hoy". Las que vencen hoy y siguen abiertas deben aparecer en "❌".
Responde `pasa todo` y comprueba que confirma el número correcto.

**Prueba 3 — Seguridad**

```bash
curl -i "https://gabby-hq.vercel.app/api/asistente/manana?test=1"
```

Sin header debe responder `HTTP 401` y **no** llegar nada a Telegram. Luego,
desde otro chat de Telegram (otra persona, u otro número) escríbele al bot
`hola`: debe contestar "No autorizado" y no guardar nada.

Después de las tres pruebas, espera a la primera alarma real a las 8:00 del
siguiente día hábil. Cuando llegue bien, apaga el workflow de n8n (Paso 5).

### 1e. Qué puede fallar y dónde verlo

**Dónde están los logs**

1. Vercel → proyecto **gabby-hq** → pestaña **Logs** (arriba).
2. En el filtro de ruta escribe `/api/asistente` para ver solo las alarmas, o
   `/api/telegram` para el bot.
3. Cada línea del asistente empieza con una etiqueta entre corchetes:
   `[alarma-manana]`, `[alarma-tarde]`, `[bot]`. Verás `telegram ok chat=… parte
   1/1` por cada envío, o `telegram error …` con el motivo que devolvió
   Telegram.

Para ver las corridas del Cron: **Settings → Cron Jobs**; cada job muestra la
última ejecución y si fue 200 o error.

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| No llega la alarma y tampoco el "⚠️ falló" | El cron no corrió: falta `vercel.json` en el deploy, o el deploy no es Production, o `TELEGRAM_BOT_TOKEN` está mal (ni el aviso pudo salir). | Settings → Cron Jobs: ¿aparecen los dos jobs y su última corrida? Revisa Logs con `/api/asistente`. |
| Llega "⚠️ La alarma … falló: Unauthorized" o el curl da 401 | `CRON_SECRET` no está en Vercel, o difiere del que mandas en el curl, o falta el redeploy. | Settings → Environment Variables, revisa y redeploy. |
| Llega "⚠️ … falló: column completed_at does not exist" o "relation bot_alarmas does not exist" | No se corrió el SQL (Paso 1). | Corre `sql/2026-10-asistente-fase1.sql` en Supabase. |
| Llega "⚠️ … falló: ALLOWED_CHAT_IDS está vacío" | Falta la env var. | Créala y redeploy. |
| El bot responde "No autorizado" a ti | Tu `chat_id` no está en `ALLOWED_CHAT_IDS` (o está con espacios raros). | Confírmalo con `getUpdates` (ver 1c). |
| `pasa 3` dice "No hay ninguna alarma con tareas numeradas" | Nunca se ha enviado una alarma con tareas, o `bot_alarmas` no existe. | Dispara una alarma de prueba y vuelve a intentar. |
| Chelsea sale con "Correos: no se pudo consultar inbox-IM" | El proyecto Supabase de inbox-IM no respondió. El resto de la alarma sí sale. | Revisa `SUPABASE_INBOXIM_*` y el estado del proyecto. |
| El mensaje llega "cortado" | Pasó de 4000 caracteres: se manda en varias partes, es normal. | Nada. |
| Llega a la hora equivocada | Vercel Cron es UTC. 13:00 UTC = 8:00 Cancún; 23:00 UTC = 6:00 pm Cancún. | Verifica `vercel.json`. |
| La lista de las 8 (o el cierre) trae tareas ya cerradas y no trae las nuevas, pero "dame la lista" en el bot sí está bien | **Bug del 3 nov 2026.** Next.js 14 cachea para siempre las respuestas de Supabase dentro de una ruta que solo exporta `GET` (los crons), aunque lleve `dynamic = 'force-dynamic'`: ese ajuste solo evita el render estático y leer `request.headers` no marca la ruta como dinámica. La lista NO venía de `bot_alarmas` (esa tabla solo guarda la numeración); venía de una copia vieja de la consulta `tasks?done=eq.false`. La ruta del bot (`POST`) nunca cacheó, por eso el bot sí veía lo real. | Arreglado: `createServerClient()` manda todo con `cache: 'no-store'` y las rutas GET llevan `fetchCache = 'force-no-store'`. Si vuelve a pasar, revisa que ningún `fetch` nuevo a Supabase/Google se haga sin el cliente de `supabase-server.ts` o sin `cache: 'no-store'`. |

**Comportamientos que conviene saber**

- La alarma de la tarde **recalcula** la lista pendiente (misma regla que la
  mañana) y la numera de nuevo desde 1. Los números de `pasa` siempre son los
  del último mensaje que recibiste.
- `pasa N` sobre una tarea sin fecha (✴️) le pone fecha de mañana.
- Las tareas cerradas **antes** de correr el SQL no tienen `completed_at`, así
  que nunca saldrán en "Hecho hoy". Las que cierres después, sí.
- Si Telegram falla a mitad de un mensaje de varias partes, el reintento vuelve
  a mandar desde la parte 1: puede llegar algo duplicado. Preferible a perderlo.

---

## 2. Fase 2 — Notas de voz (Whisper)

### 2a. Qué hace

Le mandas un **audio** al bot en vez de escribir, y pasa exactamente lo mismo
que si lo hubieras tecleado:

1. El bot descarga el audio de Telegram y lo manda a OpenAI (modelo
   `whisper-1`) para convertirlo en texto. Entiende español con palabras en
   inglés mezcladas ("Shift", "Google Ads", "SEO", "follow up").
2. Te responde siempre con lo que entendió, y en **el mismo mensaje** confirma
   o pregunta:
   ```
   🎤 Entendí: «urgente IM llamar a Juan mañana»
   ✅ IM · Urgente ★ · «llamar a Juan» · vence sáb 31 oct
   ```
3. Si al mensaje le falta la **empresa** o la **urgencia** (escrito o hablado,
   da igual), **no guarda**: te pregunta con botones.
   ```
   🎤 Entendí: «llamar a Juan mañana»
   ¿Para qué empresa?
   [ IM ] [ DATAVIA ] [ PD ]
   [ Personal ] [ Chelsea ]
   ```
   Tocas un botón; si aún falta algo te hace la segunda pregunta
   (`¿Qué urgencia?` → Urgente · Normal · Cuando pueda); cuando está completa
   guarda y confirma en una línea. Esa tarea a medias es un **borrador**: vive
   10 minutos. Si no contestas, se descarta; si mandas otra tarea nueva, la
   reemplaza.
4. Audios de más de **2 minutos** no se procesan: "Mándame un audio más corto
   (máx 2 min)".
5. Si el audio empieza con "pregunta" o con "¿" ("¿qué tengo hoy?"), no es
   una tarea: es una pregunta y la contesta la fase 3.

**Confirmación, siempre en una sola línea**

```
✅ IM · Urgente ★ · «Llamar a Juan» · vence vie 1 nov
```

Empresa · urgencia (con ★ si es importante; `urgente` siempre lleva ★) ·
el título entre comillas · "vence …" solo si tiene fecha.

**Lo que entiende el parser** (es el mismo para texto y voz; las piezas pueden
ir en cualquier orden):

| Pieza | Cómo lo dices |
| --- | --- |
| Urgencia | `urgente` / `normal` / `cuando pueda`, al inicio o al final ("…, urgente") |
| Empresa | al inicio (`IM llamar…`), con `para IM` / `para IM:`, o al final (`…, IM`). Si va en medio ("regalo personal") la toma pero no la quita del título |
| ★ Importante | la palabra `importante` en cualquier parte |
| Fecha | `hoy` / `mañana` al inicio o **al final** del mensaje, `para el viernes`, `due friday`, `para mañana` |
| Radar | `radar <idea>` |
| Pregunta | empieza con `?`, `¿` o `pregunta` |
| Ayuda | `ayuda`, `help`, `formato`, `/start` |

Dos arreglos que vienen con esta fase y aplican también a lo escrito:

- "hoy"/"mañana" **al final** del mensaje ("urgente IM Shift Google Ads y SEO
  hoy") ahora se reconoce como fecha y se quita del título. Antes se quedaba
  en el título y la tarea salía sin fecha.
- "hoy" y "mañana" se calculan en **hora de Cancún**. Antes se calculaban en la
  hora del servidor (UTC): un "hoy" dicho después de las 7 pm caía en mañana.

### 2b. Lo que hay que hacer a mano

**Paso 1 — Correr el SQL en Supabase (dos queries, en este orden)**

1. https://supabase.com → proyecto **GabbyHQ** → **SQL Editor** → **New query**.
2. Pega `sql/2026-10-asistente-fase2.sql` completo → **Run**. Crea la tabla
   `bot_borradores`. Al final verás sus 5 columnas y `rowsecurity = true`.
3. **New query** (otra pestaña) → pega `sql/2026-10-asistente-fase2-pruebas.sql`
   → **Run**. Inserta un borrador de prueba, lo muestra y hace `rollback`: no
   queda nada.

**Paso 2 — Crear la API key de OpenAI y ponerle tope de gasto**

1. Entra a https://platform.openai.com e inicia sesión (o crea la cuenta).
2. Arriba a la derecha, el engrane **Settings** → en la izquierda
   **Billing** → **Add payment details** si no hay tarjeta, y **Add to credit
   balance** con un monto chico (p. ej. $5 USD). OpenAI cobra por adelantado;
   sin saldo, Whisper responde error.
3. Todavía en Settings → **Limits** (dentro de Organization). Pon **Monthly
   budget** = `5` y, si quieres aviso antes, **Alert threshold** = `3`. Con
   eso, si algo se descontrola, deja de funcionar al llegar a $5 en vez de
   seguir cobrando.
4. En la izquierda, **API keys** → **Create new secret key**. Nombre:
   `gabbyhq-telegram`. Permisos: **Restricted** → en *Model capabilities*
   marca **Write** (es lo que necesita transcripciones) y deja el resto en
   *None*. Click **Create secret key**.
5. Copia la key (empieza con `sk-…`). **Solo se muestra una vez**: guárdala en
   tu gestor de contraseñas. Si la pierdes, crea otra y borra la vieja.

**Paso 3 — Ponerla en Vercel y redeploy**

1. https://vercel.com → proyecto **gabby-hq** → **Settings** → **Environment
   Variables**.
2. Key `OPENAI_API_KEY`, Value: la key. Marca **Production** (y Preview si
   pruebas en previews). **Save**.
3. **Deployments** → último deploy → `⋯` → **Redeploy**. Sin redeploy, la
   variable no existe para la app y todo audio responderá "Error al
   procesar".

No hay nada que tocar en BotFather: los audios llegan por el mismo webhook.

### 2c. Env vars que agrega esta fase

| Nombre | De dónde sale | Ejemplo (valor falso) |
| --- | --- | --- |
| `OPENAI_API_KEY` | platform.openai.com → Settings → API keys → Create new secret key (Paso 2) | `sk-proj-aB3dE…xYz` |

### 2d. Cómo probar que funciona

**Prueba 1 — Audio completo.** Mándale al bot un audio diciendo: *"urgente
IM llamar a Juan mañana"*. Esperado, en un solo mensaje:
```
🎤 Entendí: «urgente IM llamar a Juan mañana»
✅ IM · Urgente ★ · «llamar a Juan» · vence sáb 31 oct
```
Abre `/tasks`: la tarea está en IM, urgente, con ★ y fecha de mañana.

**Prueba 2 — Audio incompleto + botones.** Audio: *"llamar al contador"*.
Esperado: "🎤 Entendí: «llamar al contador»" + "¿Para qué empresa?" con
botones. Toca **Personal** → "¿Qué urgencia?" con tres botones → toca
**Normal** → "✅ Personal · Normal · «llamar al contador»". Los botones de las
preguntas ya contestadas desaparecen. Luego manda otro audio incompleto, espera
11 minutos y toca el botón: debe decir "Ese borrador ya expiró".

**Prueba 3 — Límites.** (a) Un audio de más de 2 minutos → "Mándame un audio
más corto (máx 2 min)". (b) Un audio diciendo *"pregunta qué tengo hoy"* →
"Eso lo entenderé en la siguiente fase 🙂". (c) Escrito, no hablado:
`urgente IM Shift Google Ads y SEO hoy` → la confirmación dice `vence` con la
fecha de hoy y el título **sin** la palabra "hoy".

### 2e. Qué puede fallar y dónde verlo

Logs: Vercel → **Logs** → filtro `/api/telegram`. Las líneas de voz llevan la
etiqueta `[voz]` (`whisper ok · … · N chars` o `whisper error: …`); las del
bot, `[bot]`.

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Todo audio responde "Error al procesar" y el log dice `OPENAI_API_KEY no está definida` | Falta la env var o el redeploy. | Paso 3. |
| Log: `whisper error: Incorrect API key provided` | Key mal copiada o revocada. | Crea otra en OpenAI y actualízala en Vercel. |
| Log: `whisper error: You exceeded your current quota` / `insufficient_quota` | Sin saldo en OpenAI o se alcanzó el tope mensual. | Billing → Add to credit balance, o sube el límite en Limits. |
| Log: `whisper error: … model_not_found` | La key es *Restricted* sin permiso de Model capabilities. | Edita la key o crea una con Write en Model capabilities. |
| Responde "No entendí el audio" | Whisper devolvió texto vacío (silencio, muy bajo). | Repite más cerca del micrófono. |
| Entiende mal nombres de empresa | Whisper los escribe distinto ("Datavía"). | El parser ignora mayúsculas pero no acentos ni letras cambiadas: si no reconoce la empresa, te la pregunta con botones. Tócalo y listo. |
| Toco un botón y no pasa nada | El borrador expiró (10 min) o lo reemplazó otra tarea; o el webhook tardó. | Manda la tarea otra vez. Revisa Logs por `[bot] callback`. |
| El audio tarda más de 10 s en contestar | Whisper tarda ~2–6 s por audio de 30 s; Vercel permite hasta 60 s en esta ruta. | Normal. Si pasa de 60 s, el log dirá `Task timed out`. |
| Texto escrito que antes se guardaba ahora pregunta empresa | Es a propósito (2d): sin empresa o sin urgencia no se guarda. | Tocar el botón, o escribir la empresa. |

**Comportamientos que conviene saber**

- El audio se procesa **dentro** del webhook: Telegram espera la respuesta.
  Si la transcripción falla, el bot contesta "Error al procesar" y el motivo
  queda en los logs; nada se guarda a medias.
- Los borradores viejos no se limpian solos: el siguiente mensaje del mismo
  chat los borra. La tabla nunca tiene más de una fila por chat.
- Un audio que diga `radar …` o `pasa 2,5` funciona igual que escrito.

## 3. Fase 3 — `/pregunta` (LLM)

### 3a. Qué hace

Le preguntas al bot sobre tu día y te contesta en **máximo 5 líneas**, en
español informal, usando **solo** lo que hay en GabbyHQ. Tres formas de
preguntar, escritas o por audio:

- `/pregunta ¿qué tengo hoy?`
- cualquier mensaje que empiece con `?` o `¿`: `¿por dónde vamos con IM?`
- `pregunta qué cerré ayer`

Cómo funciona por dentro, cada vez que preguntas:

1. El bot arma un **contexto** en texto plano, en hora de Cancún, agrupado por
   empresa (IM · DATAVIA · PD · Personal · Chelsea):
   - fecha y hora actual, y hasta qué domingo llega "esta semana";
   - por empresa: la nota "por dónde iba" completa; las tareas abiertas de hoy
     (vencidas, vence hoy, urgentes/★); las del resto de la semana (con fecha
     hasta el domingo); las cerradas en los últimos 7 días;
   - de Chelsea, además, el **número** de correos pendientes en inbox-IM.
   De cada tarea solo va el título, la empresa, la prioridad, la ★ y la fecha.
   **Nunca va el campo `notes`** de las tareas: ahí viven resúmenes de correos
   con `Ref: gmail:…` y no deben salir de la base. El contexto se recorta a
   ~3000 tokens (notas muy largas se cortan a 1200 caracteres; listas, a 30).
2. Manda contexto + pregunta al modelo con este system prompt:
   > Eres el asistente personal de Gabby. Respondes en español, informal, en
   > MÁXIMO 5 líneas. Solo usas el contexto dado; si algo no está ahí, dices
   > que no lo tienes. Nunca inventas tareas ni fechas. Si pregunta qué hacer
   > primero, priorizas: vencidas > vence hoy > urgente★ > urgente > ★.
   Con `max_tokens` 300 y 20 segundos de espera máxima. Si se pasa o falla:
   "Se me trabó, pregunta otra vez."
3. Guarda la pregunta, la respuesta, el modelo, los tokens y los milisegundos
   en la tabla `bot_preguntas`. Es solo un registro: sirve para ver cuánto
   cuesta y qué preguntas contesta mal, para afinar el prompt.

**Modelo y proveedor por env vars, sin tocar código**

| `LLM_PROVIDER` | `LLM_MODEL` (ejemplos) | Key que usa |
| --- | --- | --- |
| `openai` (default) | `gpt-5-mini` (default), `gpt-5-nano`, `gpt-4o-mini` | `OPENAI_API_KEY` (la misma de la fase 2) |
| `anthropic` | `claude-haiku-5-5`, `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` (solo si cambias a Anthropic) |

Para cambiar de proveedor: cambias las dos env vars (y agregas la key del
otro), redeploy, listo. El código ya habla los dos protocolos.

> La key de OpenAI puede ser de **cualquier cuenta**: la que vaya a pagar. Si
> mañana la paga otra persona u otra empresa, creas la key en esa cuenta, la
> pegas en Vercel sobre `OPENAI_API_KEY` y haces redeploy. Nada más cambia.

**`/ayuda`**: responde en cuatro secciones (Agregar · Cerrar/Mover · Notas ·
Preguntar, 13 líneas) todo lo que el bot entiende y termina con
`🤖 Modelo actual: gpt-5-mini (openai)`. También funciona `ayuda`,
`help`, `formato` y `/start`.

### 3b. Lo que hay que hacer a mano

**Paso 1 — Correr el SQL en Supabase (dos queries, en este orden)**

1. https://supabase.com → proyecto **GabbyHQ** → **SQL Editor** → **New query**.
2. Pega `sql/2026-10-asistente-fase3.sql` completo → **Run**. Crea
   `bot_preguntas` **sin RLS** (lo verás como `rowsecurity = false`; es a
   propósito, para poder consultarla sin trabas desde el editor).
3. **New query** (otra pestaña) → pega `sql/2026-10-asistente-fase3-pruebas.sql`
   → **Run**. Inserta una fila de prueba, la muestra y hace `rollback`.

**Paso 2 — Env vars en Vercel y redeploy**

1. https://vercel.com → **gabby-hq** → **Settings** → **Environment Variables**.
2. Agrega `LLM_PROVIDER` = `openai` y `LLM_MODEL` = `gpt-5-mini`. No son
   secretas: déjalas como variables normales, en Production (y Preview si
   quieres probar ahí). Si no las creas, el código usa esos mismos valores por
   defecto, pero tenerlas visibles es lo que permite cambiarlas sin tocar
   código.
3. Verifica que `OPENAI_API_KEY` (fase 2) sigue ahí y que la key tiene permiso
   de **Model capabilities → Write** (la misma que usa Whisper lo tiene).
4. **Deployments** → último deploy → `⋯` → **Redeploy**.

**Paso 3 (opcional) — Que Telegram muestre los comandos**

Para que al escribir `/` aparezcan `/pregunta` y `/ayuda` sugeridos:
en **@BotFather** → `/setcommands` → elige tu bot → pega:
```
pregunta - Pregúntame sobre tu día: /pregunta ¿qué tengo hoy?
ayuda - Todo lo que entiendo
```

### 3c. Env vars que agrega esta fase

| Nombre | De dónde sale | Ejemplo |
| --- | --- | --- |
| `LLM_PROVIDER` | Tú lo decides: `openai` o `anthropic`. Tipo Config, no secreta. | `openai` |
| `LLM_MODEL` | El id del modelo en ese proveedor. Tipo Config, no secreta. | `gpt-5-mini` |
| `LLM_MODEL_FALLBACK` | Opcional (fase 3b). Modelo de respaldo si OpenAI retira `LLM_MODEL`. Default `gpt-4o-mini`. | `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | **Solo si** `LLM_PROVIDER=anthropic`: console.anthropic.com → API Keys. | `sk-ant-…` |

Sin key nueva mientras sigas en OpenAI: se reutiliza `OPENAI_API_KEY`.

### 3d. Cómo probar que funciona

Las cinco preguntas que deben funcionar. Manda cada una (escrita, o por audio
empezando con "pregunta …") y revisa que la respuesta tenga ≤ 5 líneas y
hable **solo** de lo que hay en la app:

| # | Pregunta | Esperado |
| --- | --- | --- |
| 1 | `¿qué tengo hoy?` | Lista o resume las tareas vencidas, de hoy y urgentes/★, por empresa. Si no hay, lo dice. |
| 2 | `¿por dónde vamos con IM?` | Resume la nota "por dónde iba" de IM y sus tareas abiertas. Si IM no tiene nota, dice que no la tiene. |
| 3 | `¿qué se me olvidó esta semana?` | Las vencidas (con "hace N días") y lo que vence hasta el domingo. |
| 4 | `¿qué cerré ayer?` | Las tareas con `completed_at` de ayer. Si cerraste una hoy y preguntas por ayer, no debe mezclarlas. |
| 5 | `¿qué hay de Chelsea?` | Sus tareas abiertas y "N correos pendientes". Nunca el contenido de los correos. |

Extra: `/pregunta` solo → el formato de uso. `/ayuda` → 8 líneas. Luego en
Supabase → **Table Editor** → `bot_preguntas`: una fila por pregunta con
`tokens_in` ≈ 1000–3500 y `ms` < 20000.

### 3e. Qué puede fallar y dónde verlo

Logs: Vercel → **Logs** → filtro `/api/telegram`; las líneas llevan
`[pregunta]`: `ok · openai:gpt-5-mini · ctx N chars · in N · out N · N ms`
o `error · … · motivo`. Las fallas también quedan en `bot_preguntas` con
`respuesta` empezando por `ERROR:`.

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Siempre "Se me trabó" y el log dice `OPENAI_API_KEY no está definida` / `ANTHROPIC_API_KEY no está definida` | Falta la key del proveedor elegido, o el redeploy. | Settings → Environment Variables → redeploy. |
| Log: `timeout tras 20s` | El modelo tardó demasiado (raro con gpt-5-mini). | Pregunta otra vez; si es constante, prueba `gpt-5-nano`. |
| Log: `model_not_found` / `The model … does not exist` | `LLM_MODEL` mal escrito o no disponible para esa key. | Corrige la env var; redeploy. |
| Log: `insufficient_quota` | Sin saldo en OpenAI o tope mensual alcanzado. | Billing → Add to credit balance / Limits. |
| Log: `LLM_PROVIDER inválido` | Valor distinto de `openai` / `anthropic`. | Corrige la env var. |
| Responde con tareas que no existen | El modelo inventó pese al prompt. | Copia la fila de `bot_preguntas` y ajusta `SYSTEM_PROMPT` en `src/lib/asistente/pregunta.ts`. |
| Responde "no tengo esa información" a algo que sí está | El contexto se recortó (más de ~3000 tokens) o la tarea no entra en hoy/semana/7 días. | Revisa `ctx N chars` en el log; acorta las notas "por dónde iba". |
| Responde pero no queda fila en `bot_preguntas` | No se corrió el SQL. El log dice `bot_preguntas insert: relation … does not exist`. | Paso 1. |
| Habla de correos de Chelsea con detalle | No debería poder: solo recibe el número. Si pasa, revisa `contexto.ts`. | Reporta. |

### 3f. Fase 3b — notas, completar tareas, modelos retirados

**Notas "por dónde iba" por Telegram** (texto o voz). Usan exactamente la
misma función de guardado que el editor de /hoy y el panel de /tasks, así que
lo que escribas aquí aparece allá al instante:

| Dices | Pasa | Confirma |
| --- | --- | --- |
| `nota IM: quedé a la mitad de los PayPal, sigue abril` | **Reemplaza** la nota de IM | `📝 Nota de IM guardada (1 línea)` |
| `nota IM + enviar TOTT reminder` (por voz: "nota IM más enviar…") | **Agrega** una línea al final de la nota de IM | `📝 Nota de IM guardada (3 líneas)` |
| `nota IM:` (nada después) | **Borra** la nota de IM | `📝 Nota de IM borrada` |
| `nota: quedé a la mitad…` (sin empresa) | Pregunta `¿Nota de qué empresa?` con los botones de siempre | — |

La empresa se busca por nombre, sin importar mayúsculas (IM · DATAVIA · PD ·
Personal · Chelsea, o cualquiera que exista en Settings).

**Completar tareas por Telegram** (texto o voz):

| Dices | Pasa |
| --- | --- |
| `listo 3` / `listo 2,5` | Completa esas tareas, por su número en la **última alarma** (igual que `pasa`) |
| `listo paypal` | Busca «paypal» en los títulos de las tareas abiertas, sin acentos ni mayúsculas. 1 coincidencia → la completa. 2 a 5 → botones para escoger. 0 → `No encontré ninguna tarea con «paypal»`. Más de 5 → pide algo más específico. |
| `pasa paypal` | Lo mismo, pero la mueve a mañana |

Al completar: `done = true` (el trigger de la fase 1 pone `completed_at`) y
confirma `✅ Hecha: «paypal statements Mar and Apr» · IM`. No existe
`listo todo` a propósito: cerrar toda la alarma de un golpe es demasiado fácil
de mandar por error.

**Ajustes a `/pregunta`**

- El system prompt pide español neutro con tuteo ("tienes", "quieres") y
  prohíbe el voseo ("tenés", "querés").
- Prosa: máximo 5 líneas. Si la pregunta pide una lista ("qué tengo", "qué
  cerré"): máximo 8 ítems en formato `- título · empresa · fecha` y, si hay
  más, una última línea `+N más en GabbyHQ → https://gabby-hq.vercel.app/hoy`.
  El código recorta a 9 líneas por si el modelo se pasa.

**Modelos retirados, key inválida, sin saldo**

OpenAI cambia nombres de modelos sin avisar. Qué hace el bot cuando OpenAI
responde error:

| OpenAI dice | El bot hace |
| --- | --- |
| "model not found" para `LLM_MODEL` | Reintenta **una vez** con `LLM_MODEL_FALLBACK` (por defecto `gpt-4o-mini`) y te contesta con ese. Además manda a Telegram, **una sola vez al día**: `⚠️ El modelo gpt-5-mini ya no existe. Cambia LLM_MODEL en Vercel.` |
| "model not found" para `whisper-1` | No hay fallback: avisa una vez al día que hay que actualizarlo en `src/lib/asistente/whisper.ts`. |
| 401 (key inválida) | `⚠️ OpenAI: la key no es válida (…). Revisa saldo/key.` — una vez al día |
| 429 por quota (sin saldo o tope mensual) | `⚠️ OpenAI: sin saldo o tope mensual alcanzado (…). Revisa saldo/key.` — una vez al día |

**Qué hacer cuando OpenAI retire un modelo**: Vercel → **gabby-hq** →
**Settings** → **Environment Variables** → edita `LLM_MODEL` con el nombre
nuevo (lo ves en https://platform.openai.com/docs/models) → **Save** →
**Deployments** → `⋯` → **Redeploy**. Sin tocar código. Mientras tanto el
bot sigue contestando con el modelo de respaldo.

La marca de "ya avisé hoy" se guarda en `bot_preguntas` (filas con `chat_id`
0 y `pregunta` que empieza con `⚠️aviso:`), no en `bot_alarmas`: esa tabla
tiene un CHECK que solo admite `manana`/`tarde` y cambiarlo sería un SQL
nuevo. Puedes borrar esas filas cuando quieras.

**Env var opcional de esta fase**

| Nombre | De dónde sale | Ejemplo |
| --- | --- | --- |
| `LLM_MODEL_FALLBACK` | Tú lo decides; solo si quieres un respaldo distinto de `gpt-4o-mini`. Tipo Config. | `gpt-4o-mini` |

### 3g. Fase 3c — todo se maneja desde el bot

**Borrar tareas**: `borra 3` (número de la última alarma) o `borra paypal`
(palabra del título, con botones si hay varias). **Siempre** pide confirmación
antes:
```
¿Borrar esta tarea?
• «paypal statements Mar and Apr» · IM
[ 🗑️ Sí, borrar ]  [ No ]
```
Al confirmar: `🗑️ Borrada: «paypal statements Mar and Apr» · IM`. Con "No":
`Ok, no borré nada.` No existe `borra todo`.

**Nota en una tarea**: `nota en paypal: ya mandé el de marzo, falta abril`
busca la tarea por título y **agrega al final** de su campo notas una línea
con la fecha: `30 oct: ya mandé el de marzo, falta abril`. Nunca sobrescribe
lo que ya había: las tareas que vienen de inbox-IM conservan intacto su bloque
`De:/resumen/Ref: gmail:…` y la línea nueva queda debajo. Confirma
`📎 Nota agregada a «paypal statements Mar and Apr»`. Se ve en /tasks al
expandir la tarjeta.

**Cambiar fecha, urgencia o empresa**: el título primero y el cambio al final.

| Dices | Cambia | Confirma |
| --- | --- | --- |
| `paypal para el viernes` (o `paypal mañana`, `paypal hoy`, `paypal due monday`) | `due_date` | `✏️ «paypal …» · IM → vence vie 6 nov` |
| `paypal urgente` (o `normal`, `cuando pueda`) | prioridad; `urgente` también pone ★ | `✏️ «paypal …» · IM → Urgente ★` |
| `paypal es de PD` (o `va para PD`, `pasa a PD`) | empresa | `✏️ «paypal …» · PD → PD` |
| `paypal urgente para mañana` | varios a la vez | `✏️ … → Urgente ★ · vence sáb 31 oct` |

Cómo decide el bot si es una edición o una tarea nueva: solo es edición cuando
el modificador va **al final** y existe una tarea abierta cuyo título contiene
lo que quedó antes ("paypal"). Si no hay ninguna que coincida, se crea como
tarea nueva con el flujo normal (y pregunta empresa/urgencia si faltan). Por
eso `urgente IM llamar a Juan` (modificador al inicio) siempre crea. Varias
coincidencias → botones para escoger.

**Fecha de cierre visible**

- En `/tasks` → pestaña **Completadas**, cada tarjeta muestra `✓ hecha 30 oct`
  (la fecha de `completed_at`, en verde) y la lista va de la más reciente a la
  más antigua. Las que se cerraron antes de la fase 1 no tienen fecha y quedan
  al final.
- `/pregunta` recibe, para cada tarea cerrada, `[cerrada ayer, jue 29 oct]` y
  el prompt le pide incluir esa fecha: `- título · IM · cerrada jue 29 oct`.

**`/ayuda`** se reorganizó en cuatro secciones (📥 Agregar · ✅ Cerrar/Mover ·
🗒 Notas · ❓ Preguntar), 13 líneas, y sigue terminando con el modelo actual.

**Pruebas de la fase 3c**

1. `borra paypal` con una sola coincidencia → pregunta con los dos botones.
   Toca **No** → "Ok, no borré nada." y la tarea sigue en /tasks. Repite y
   toca **Sí, borrar** → `🗑️ Borrada: …` y ya no está. Con dos coincidencias
   primero salen los botones de "¿Cuál borro?" y después la confirmación.
2. En una tarea que vino de inbox-IM (tiene `Ref: gmail:` en notas):
   `nota en <palabra del asunto>: probando` → `📎 Nota agregada a «…»`. En
   /tasks, expande la tarjeta: el bloque `De:/resumen/Ref:` sigue igual y
   abajo aparece `30 oct: probando`.
3. `paypal para el viernes` → `✏️ … → vence vie 6 nov`; `paypal urgente` →
   `→ Urgente ★`; `paypal es de PD` → `→ PD`. Comprueba cada uno en /tasks.
   Luego `zzz urgente` (sin ninguna tarea con "zzz") → te pregunta la empresa:
   se está creando una tarea nueva, no editando.
4. Completa una tarea desde el bot (`listo …`) y abre /tasks → Completadas: la
   primera tarjeta es esa, con `✓ hecha` y la fecha de hoy.
5. `¿qué cerré ayer?` → cada ítem trae `cerrada` con su fecha. `/ayuda` →
   cuatro encabezados y no más de 14 líneas.

**Pruebas de la fase 3b**

1. `nota IM: prueba desde Telegram` → `📝 Nota de IM guardada (1 línea)`; abre
   /hoy y la nota de IM dice eso. Luego `nota IM + segunda línea` → `(2
   líneas)`. Luego `nota IM:` → `📝 Nota de IM borrada` y /hoy ya no la
   muestra.
2. Crea dos tareas con "paypal" en el título. `listo paypal` → botones con las
   dos; toca una → `✅ Hecha: «…» · IM`. Otra vez `listo paypal` → ahora una
   sola coincidencia, la completa directo. `listo paypal` de nuevo → `No
   encontré ninguna tarea con «paypal»`.
3. Después de una alarma: `listo 1` → `✅ Hecha: «…»`. `listo 99` → "No
   encontré el 99…".
4. `¿qué tengo hoy?` con más de 8 tareas → 8 líneas `- título · empresa ·
   fecha` y `+N más en GabbyHQ → …/hoy`. Nunca "tenés".
5. Pon `LLM_MODEL=gpt-modelo-inexistente` en Vercel, redeploy, pregunta algo:
   contesta igual (con el fallback) y llega el ⚠️. Pregunta otra vez: contesta
   pero **no** repite el ⚠️. Regresa `LLM_MODEL` a `gpt-5-mini` y redeploy.

**Comportamientos que conviene saber**

- Cada pregunta manda todo el contexto de nuevo (no hay memoria entre
  preguntas): "¿y de DATAVIA?" sin más contexto no sabe a qué te refieres.
- Con los modelos gpt-5 el código manda `reasoning_effort: minimal` para que
  no gaste los 300 tokens pensando y conteste vacío. Con otros modelos no se
  manda.
- Una pregunta por audio pasa primero por Whisper y luego por el LLM: puede
  tardar 5–10 s en total.

## 4. Fase 4 — El bot entiende lenguaje natural + alarmas propias

### 4a. Qué hace

**El problema real** (captura del 30 oct): Gabby respondió al cierre del día
con cinco órdenes en un mensaje:

```
1 terminado / 9 cancelar no se va hacer / 10 terminaso /
11 se llama URo, pasar para mañana / 12 pasar para mañana
```

El bot lo tomó como una tarea nueva y preguntó la empresa. Así es como ella
habla; el bot tiene que adaptarse a ella, no al revés.

**Intérprete de intenciones (texto y voz).** Todo mensaje que **no** sea un
comando exacto pasa por el LLM (el mismo `LLM_PROVIDER` / `LLM_MODEL` de la
fase 3) con un prompt que devuelve un JSON: una lista de acciones, cada una
con tipo y datos. Los comandos exactos siguen igual y no tocan el modelo:
`/ayuda`, `/pregunta` (y `?`/`¿`), `pasa …`, `listo …`, `borra …`, `nota IM: …`,
`nota en …: …`, `radar …`, `mis alarmas`, `quita alarma N`.

| Acción | Qué dice Gabby | Qué hace |
| --- | --- | --- |
| `completar {ref}` | "1 terminado", "el 3 ya está", "listo el de paypal" | `done = true` |
| `cancelar {ref, motivo?}` | "9 cancelar no se va hacer", "ya no aplica" | `done = true` + línea en notas `1 nov: cancelada — no se va a hacer`. **No se borra.** |
| `borrar {ref}` | "bórralo", "elimina el 4", "borra la de paypal" | se elimina de verdad, **siempre** tras [🗑️ Sí, borrar] [No] |
| `posponer {ref, fecha}` | "12 pasar para mañana", "pasa el 5 al lunes" | `due_date` |
| `renombrar {ref, titulo}` | "11 se llama URo" | `text` |
| `cambiar {ref, prioridad\|empresa\|fecha}` | "el 4 es urgente", "paypal es de PD" | lo que diga |
| `crear {titulo, empresa?, prioridad?, fecha?, importante?}` | "llamar a Juan", "urgente IM mandar propuesta mañana" | tarea nueva (pregunta lo que falte, como siempre) |
| `nota_empresa {empresa, texto, modo}` | "apunta en PD que …", "nota de IM: …" | `notas_empresa` (reemplazar o agregar) |
| `nota_tarea {ref, texto}` | "al 3 ponle que ya mandé el de marzo" | línea con fecha en `tasks.notes` |
| `alarma {texto, fecha, hora}` | "alarma mañana 3pm revisar pagos" | ver **Alarmas propias** |
| `pregunta {texto}` | "qué tengo hoy" | va a `/pregunta` |
| `desconocido {texto}` | "hola", "jaja" | ver **Reglas** |

**Cancelar no es borrar.** "borra / elimina / bórralo" → `borrar` (la tarea
desaparece, con la misma confirmación de botones que `borra 3`). "cancelar /
no se va a hacer / ya no aplica" → `cancelar` (queda en Completadas con su
nota). La nota de cancelación lleva el **motivo solo si lo dio** ("no se va a
hacer", "el cliente se echó atrás"); nunca la orden literal ("pídelo
cancelar", "bórralo"): el prompt lo pide y `limpiarMotivo()` lo filtra por si
acaso. Sin motivo, la nota es solo `1 nov: cancelada`.

`ref` puede ser el **número de la última alarma** (`#3` — "el 3", "1
terminado"), el id de cualquier otra tarea abierta que el modelo ve en el
contexto (`t12`), **"la anterior"** (la última tarea mencionada en este chat,
sacada del registro en `bot_preguntas`) o un **trozo del título**. Los errores
de dedo ("terminaso", "URo" por "Puro") los resuelve el modelo: elige la tarea
más parecida.

El contexto que recibe el modelo: fecha y hora de Cancún, las empresas, la
última alarma con sus números, las demás tareas abiertas (título · empresa ·
fecha · prioridad, máximo 80) y la última tarea mencionada. **Nunca va el
campo `notes`.** El prompt completo está en `systemPrompt()` dentro de
`src/lib/asistente/interprete.ts`; incluye el mensaje del 30 oct como ejemplo.

**Confirmación antes de ejecutar.** Si el mensaje produce **2 o más
acciones**, o alguna es **cancelar**, el bot muestra el plan y pide OK:

```
Entendí:
1. ✅ Completar «Converstiones GS4»
2. 🗑 Cancelar «AAMA agente SDK» (nota: no se va a hacer)
3. ✅ Completar «AAMA pasar la información…»
4. ✏️ Renombrar «Puro lobo pendiente» → «URo pendiente» y pasar a mañana
5. ➡️ Pasar a mañana «Necesito una lista de preguntas…»
[ ✅ Hacer todo ]  [ ✏️ No, corrijo ]
```

Dos acciones seguidas sobre la misma tarea van en una línea ("… y pasar a
mañana"). Una ref que no se encuentra sale como `⚠️ … (no se hará)` y el resto
sigue. Con **Hacer todo** ejecuta en orden y responde una línea por acción (las
mismas confirmaciones de siempre: `✅ Hecha: …`, `🗑 Cancelada: …`, `✏️ «…» →
«…»`, `📅 … pasa a mañana`). Con **No, corrijo** el plan sigue esperando y
el siguiente mensaje lo corrige ("quita X", "la de X a las 4", "olvídalo";
ver § 7 G, "Corregir el plan antes de aprobarlo"); nada se ejecuta hasta
**Hacer todo**.

Una sola acción simple (completar, posponer, renombrar, cambiar, nota, alarma
con hora, pregunta) se ejecuta directo y confirma en una línea, como hoy. Una
sola `borrar` ("bórralo") pregunta [🗑️ Sí, borrar] [No] igual que `borra 3`;
dentro de un plan, la línea `❌ Borrar «…» (se elimina)` y el **Hacer todo**
son la confirmación. Una sola `crear` entra al flujo normal de tareas (pregunta empresa/urgencia con
botones si faltan). Dentro de un plan aprobado, una `crear` sin empresa o
urgencia se guarda tal cual (`Sin empresa · Normal`) — el plan ya lo decía y
se corrige después con "zzz es de PD". Si la ref de una acción sola coincide
con 2–5 tareas, pregunta "¿Cuál?" con botones.

**Alarmas propias.**

```
alarma mañana 3pm revisar pagos de PD
recuérdame el viernes a las 10 llamar al contador
avísame en 2 horas revisar el deploy
```

- Se guardan en `bot_recordatorios` (id, chat_id, texto, dispara_en, enviado,
  created_at). Confirma: `⏰ Alarma: «revisar pagos de PD» · sáb 1 nov 3:00 pm`.
- Un Cron más en `vercel.json`, **cada 5 minutos** → `/api/asistente/recordatorios`
  (mismo `CRON_SECRET`): manda las vencidas como `⏰ {texto}` con botones
  `[✅ Listo] [⏰ +1h] [📅 Mañana]` y las marca `enviado`. **+1h** la vuelve a
  programar una hora después de tocar el botón; **Mañana**, a la misma hora del
  día siguiente. Una alarma llega con hasta 5 minutos de retraso: es la
  resolución del cron.
- **Sin hora** → pregunta con botones `9:00 am · 12:00 pm · 3:00 pm · 6:00 pm`.
  Si dice solo la hora y ya pasó hoy, es mañana. Dentro de un plan, una alarma
  sin hora queda a las 9:00 am (el plan lo muestra antes de aprobar).
- `mis alarmas` lista las pendientes con número; `quita alarma 2` (o `quita
  alarma pagos`) la borra.
- **Las alarmas NO son tareas**: no entran en Hoy, en la matriz ni en las
  alarmas de 8:00 / 6:00 pm. Si además quiere la tarea, lo dice: "… y agrégala
  como tarea".

**Reglas.**

- Si el LLM falla (timeout, key, JSON roto) → cae al parser clásico de siempre
  (crea la tarea, edita, etc.), salvo que el mensaje empiece por
  "alarma/recuérdame/avísame": ahí avisa que el modelo falló y pide reintentar.
- Si el LLM devuelve solo `desconocido` → el parser clásico si encontró algo
  explícito (urgencia, empresa, fecha o un modificador al final); si no,
  responde "No te entendí. ¿Es una tarea nueva, una orden sobre una tarea, o
  una alarma?" con botones `[➕ Tarea nueva] [🔧 Orden] [⏰ Alarma]`. Tarea
  nueva → flujo clásico; Orden / Alarma → segundo intento con esa pista.
- Cada mensaje interpretado se registra en `bot_preguntas` con
  `modelo = "interprete:openai:gpt-5-mini"`, el mensaje en `pregunta` y el JSON
  de acciones resueltas en `respuesta` (ids de las tareas incluidos; es de ahí
  de donde sale "la anterior"). Las consultas para revisar qué entendió mal
  están al final de `sql/2026-10-asistente-fase4-pruebas.sql`.
- `/ayuda` empieza con "💬 Háblame normal: …" y tiene una sección nueva
  "⏰ Alarmas propias" (16 líneas).

### 4b. Lo que hay que hacer a mano

**Paso 1 — Correr el SQL en Supabase (dos queries, en este orden)**

1. https://supabase.com → proyecto **GabbyHQ** → **SQL Editor** → **New query**.
2. Pega el contenido completo de `sql/2026-10-asistente-fase4.sql` y **Run**.
   Abajo deben salir tres resultados: 6 columnas de `bot_recordatorios`,
   `rowsecurity = false` y el índice `bot_recordatorios_pendientes_idx`.
3. **New query** otra vez, pega `sql/2026-10-asistente-fase4-pruebas.sql` y
   **Run**. Termina en rollback; sirve para ver que el insert y la consulta del
   cron funcionan. No deja filas.

**Paso 2 — Redeploy en Vercel**

Al hacer push a `main`, Vercel despliega y lee el `vercel.json` nuevo. Después
en **Settings → Cron Jobs** deben verse **tres** jobs: `manana`, `tarde` y
`recordatorios` (`*/5 * * * *`). Si solo salen dos, el deploy no tomó el
archivo: **Redeploy** desde el último deployment.

**Paso 3 — Nada más.** No hay env vars nuevas: el intérprete usa
`LLM_PROVIDER` / `LLM_MODEL` / `OPENAI_API_KEY` de la fase 3 y el cron usa el
`CRON_SECRET` de la fase 1.

### 4c. Env vars que agrega esta fase

Ninguna.

### 4d. Cómo probar que funciona

1. **El mensaje del 30 oct.** Después de una alarma con al menos 5 tareas,
   manda: `1 terminado / 2 cancelar no se va hacer / 3 terminaso / 4 se llama
   Prueba, pasar para mañana / 5 pasar para mañana`. Debe responder "Entendí:"
   con 5 líneas (la 4 con "Renombrar … y pasar a mañana") y los dos botones.
   Toca **No, corrijo** → "Dime qué corrijo: …" y nada cambió en /tasks;
   `olvídalo` → "descarté el plan". Repite y toca **Hacer todo** → una línea
   por acción. En /tasks → Completadas, la
   tarea 2 trae en notas `1 nov: cancelada — no se va a hacer`.
2. **Una orden sola.** `el 3 ya está` → `✅ Hecha: …` directo, sin plan.
   `pasa el 4 al lunes` → `✏️ … → vence lun …`. `la anterior es urgente` →
   cambia la que acabas de mover. `bórralo` → pregunta [Sí, borrar] [No];
   `cancélalo` → plan de una línea `🗑 Cancelar «…»` sin "(nota: …)", y en
   Completadas la nota dice solo `1 nov: cancelada`.
3. **Alarma con hora.** `alarma en 6 minutos probar el cron` →
   `⏰ Alarma: «probar el cron» · …`. Entre 6 y 11 minutos después llega
   `⏰ probar el cron` con los tres botones. Toca **+1h** → `⏰ Te lo recuerdo
   otra vez: … ` una hora después. `mis alarmas` la lista; `quita alarma 1`
   la borra.
4. **Alarma sin hora.** `recuérdame mañana llamar al contador` → pregunta la
   hora con 4 botones; toca **3:00 pm** → `⏰ Alarma: «llamar al contador» ·
   … 3:00 pm`. Comprueba en /hoy que **no** aparece como tarea.
5. **Fallbacks.** `hola` → "No te entendí…" con los tres botones; toca
   **Tarea nueva** → pregunta la empresa (flujo clásico). Pon
   `LLM_MODEL=gpt-modelo-inexistente`, redeploy, manda `llamar a Juan` →
   crea la tarea igual (parser clásico + fallback de modelo, llega el ⚠️ de
   la fase 3b). Regresa `LLM_MODEL` y redeploy.
6. **Por voz.** Un audio diciendo "el uno terminado y pásame el dos para
   mañana" → `🎤 Entendí: «…»` y debajo el plan con 2 líneas.
7. En Supabase: `select pregunta, left(respuesta, 200) from bot_preguntas
   where modelo like 'interprete:%' order by created_at desc limit 10` → una
   fila por mensaje de las pruebas anteriores.

### 4e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| Todo texto libre crea una tarea y nunca sale "Entendí:" | El modelo falla y cae al parser clásico | Vercel → Logs → `/api/telegram`, busca `[interprete] error`. Suele ser `OPENAI_API_KEY` sin saldo o `LLM_MODEL` retirado (fase 3b). |
| Entiende mal un mensaje | Prompt o contexto | `bot_preguntas` con `modelo like 'interprete:%'`: la columna `respuesta` trae exactamente qué acciones sacó. Ajusta `systemPrompt()` en `interprete.ts` (y el ejemplo del final). |
| "No encontré el 9 en la última alarma" | La alarma de hoy no tenía ese número, o la tarea ya se cerró | Mira la última alarma; usa una palabra del título. |
| La alarma propia nunca llega | El cron de 5 min no existe o `CRON_SECRET` cambió | Vercel → Settings → Cron Jobs (deben ser 3); Logs → `/api/asistente/recordatorios` con `401` = secret. Prueba a mano: `curl -H "Authorization: Bearer $CRON_SECRET" https://gabby-hq.vercel.app/api/asistente/recordatorios` → `{"ok":true,"vencidos":…}`. |
| La alarma llega pero los botones no hacen nada | El `chat_id` no está en `ALLOWED_CHAT_IDS` | Logs: `callback de chat no autorizado`. |
| Cada mensaje tarda 3–5 s | Es el LLM (más Whisper si es audio) | Normal. Los comandos exactos (`listo 3`, `pasa 2,5`) siguen siendo instantáneos. |
| `response_format` error en los logs | `LLM_MODEL` no soporta modo JSON | Cambia a `gpt-5-mini` / `gpt-4o-mini`; con Anthropic no se usa ese campo. |

---

### 4f. Fase 4b — "¿Qué sigue?", notas con edad, rediseño de /hoy

**Problema**: la matriz muestra todo pero no dirige. Gabby quiere que el
sistema le diga "esto primero", como un asistente, no un tablero. Y la vista
estaba apretada: notas de 40+ días en C1, sin aire entre empresas, tareas con
"hoy" en el título y sin fecha.

**A) "¿Qué sigue?" (bot + web).** Texto o voz: `¿qué sigue?`, `qué hago
primero`, `qué es lo más urgente`, `por dónde empiezo`, `solo urgentes`, `qué
vence esta semana`, `qué está por vencer`, `qué sigue de IM`. No es la lista
completa (eso es la alarma de las 8): es una respuesta corta y ordenada con
formato fijo:

```
🎯 Qué sigue · dom 1 nov

Ahora
🔺 1. paypal statements · IM · hace 3 días

Después
🔸 2. … · PD · hoy
✴️ 3. … · IM · urgente ★
✴️ 4. … · DATAVIA · urgente

Por vencer esta semana
▫️ 5. … · IM · jue 6 nov
▫️ 6. … · PD · vie 7 nov 3:00 pm

Por dónde ibas
📝 IM: … (solo notas de los últimos 3 días, una línea cada una)
```

Mismo estilo que la lista de la mañana: encabezado con la fecha, cada
sección con su título en negrita en su propia línea, línea en blanco entre
secciones, y cada ítem como en la lista: símbolo (🔺 vencida · 🔸 hoy · ✴️
urgente/importante · ▫️ normal · ▪️ cuando pueda) + número + título +
empresa + fecha o edad. Sección vacía: `— nada vence esta semana` / `— sin notas de
los últimos 3 días`.

El orden lo decide el **código**, determinista: vencidas (más vieja primero)
> vence hoy > urgente★ > urgente > ★ con fecha esta semana > ★ sin fecha.
"Por vencer" son las que vencen entre mañana y el domingo y no salieron
arriba, por fecha. **No pasa por el LLM**: con el formato de ítem fijo no
queda nada que redactar, así que es instantáneo y no cuesta tokens. Las
tareas de Chelsea no entran (son delegadas) salvo que pidas `qué sigue de
Chelsea`.

| Variante | Qué cambia |
| --- | --- |
| `solo urgentes` | sin la sección ⏳ |
| `qué sigue de IM` | filtra por empresa (también `… de PD`, `… en DATAVIA`) |
| `qué vence esta semana` / `qué está por vencer` | solo la sección ⏳ |

Los números se guardan en `bot_alarmas` con `tipo = 'que_sigue'`, igual que
una alarma: después de la respuesta, `listo 1`, `pasa 2,5`, "listo el
primero", "pasa el segundo al lunes" funcionan sobre ella (el intérprete ve
"ÚLTIMA LISTA NUMERADA (respuesta a ¿qué sigue?)" en su contexto).

En la web: botón **🎯 ¿Qué sigue?** arriba de /hoy → tarjeta destacada con el
mismo texto (`GET /api/asistente/que-sigue`, protegido por la sesión de la
app), con "actualizar" y ✕ para cerrarla. Desde la web no se guarda
numeración.

**B) Notas "por dónde iba" con edad.**

| Edad | C1 y alarma de las 8 | Bloque de empresa en /hoy |
| --- | --- | --- |
| ≤ 3 días | sí | en el acento (morado), "escrita hace N días" |
| 4–14 días | no | en gris, "escrita hace N días", con **archivar** |
| > 14 días | no | una línea `📝 nota de hace 39 días — ver / archivar` |

**Archivar** la guarda en `notas_historial` (company_id, nota, escrita_en,
archivada_en) y borra la nota viva. Al **escribir una nota nueva encima de una
vieja** (web o `nota IM: …`), la vieja va sola al historial; `nota IM + línea`
solo agrega y no archiva nada; `nota IM:` (borrar) también archiva antes de
borrar. Nada se pierde, pero deja de estorbar. El historial se consulta en
Supabase (`select * from notas_historial order by archivada_en desc`); no
tiene vista en la app todavía.

**C) Rediseño de /hoy (solo layout, misma lógica).**

- Matriz: 24px de padding por cuadrante; en C1 las notas van en su propia
  zona (fondo `#222`, nombre de la empresa como encabezado) separadas de las
  tareas por una línea sutil; cuando hay 2+ tareas seguidas de la misma
  empresa, la empresa va como mini-encabezado (badge) y las tareas debajo sin
  repetir el badge.
- Tarjeta de tarea en la matriz: **una sola línea** (título truncado a 70
  caracteres, el completo en el tooltip) con los badges a la derecha.
- Bloques de empresa: título más grande, 32px entre empresas, nota primero
  (acento) y tareas después (blanco).
- Móvil: la matriz se apila C1 → C2 → C3 → C4; C4 arranca plegado (botón
  "ver").

**D) Limpieza del parser.**

- "hoy" / "mañana" al final del título → fecha, fuera del título. El parser
  clásico ya lo hacía desde la fase 2 (`Shift Google Ads y SEO hoy` → título
  `Shift Google Ads y SEO`, vence hoy); lo que faltaba era el camino del
  intérprete: ahora el prompt lo pide y `sinFechaEnTitulo()` lo garantiza
  aunque el modelo deje la palabra en el título. En medio de la frase se
  respeta ("avisar que hoy no voy").
- Campos dictados por voz: `Agregar un nuevo task, whatsapp, chelito, due
  date, mañana, compañía` → título `whatsapp chelito`, vence mañana, y
  pregunta la empresa con botones. Lo entienden tanto el prompt del
  intérprete como `parseDictado()` en el parser clásico (por si el modelo
  falla): las palabras de campo (task, due date, compañía, prioridad…) no van
  al título.
- Migración de datos una sola vez: `sql/2026-11-limpieza-titulos-hoy-manana.sql`.
  Primero el `select` (lista `titulo_actual → titulo_nuevo`, `due_date_nuevo`
  relativo a `created_at` en hora de Cancún); si está bien, se descomenta el
  `update`.

**Lo que hay que hacer a mano (fase 4b)**

1. Supabase → SQL Editor → `sql/2026-11-asistente-fase4b.sql` en una query.
   Abajo: 5 columnas de `notas_historial`, las dos tablas de notas con el
   **mismo** `rowsecurity`, y el check de `bot_alarmas` con `que_sigue`.
2. Otra query: el `select` de `sql/2026-11-limpieza-titulos-hoy-manana.sql`.
   Revisa la lista; si está bien, corre el `update` (descomentado).
3. Push → redeploy. Sin env vars nuevas ni crons nuevos.

**Pruebas de la fase 4b**

1. `¿qué sigue?` → las secciones en ese orden, numeradas. `listo 1` → cierra
   la de "Ahora". `qué sigue de IM` → solo IM. `solo urgentes` → sin ⏳.
   `qué vence esta semana` → solo ⏳. Por voz: "qué hago primero".
2. /hoy → **🎯 ¿Qué sigue?** → la tarjeta con el mismo texto; ✕ la cierra.
3. Una nota de IM escrita hace 5+ días: ya no sale en C1 ni en la alarma de
   las 8, y en el bloque de IM se ve en gris con "escrita hace N días". Con
   una de 15+ días: una sola línea "nota de hace N días — ver / archivar";
   **archivar** → desaparece y `select * from notas_historial` la tiene.
4. `nota IM: texto nuevo` encima de una nota vieja → la vieja está en
   `notas_historial` y /hoy muestra la nueva en morado.
5. En el móvil, /hoy: C4 plegado con "ver". En escritorio, C1 con las notas
   arriba y una línea antes de las tareas; una tarea larga en una línea con
   el tooltip.
6. Audio: "Agregar un nuevo task, whatsapp, chelito, due date, mañana,
   compañía" → pregunta la empresa; al elegir: `✅ IM · … · «whatsapp
   chelito» · vence …`. Texto: `Shift Google Ads y SEO hoy` → título sin
   "hoy", vence hoy.


### 4g. Fase 4c — lista a demanda, "qué sigue" fijo, fechas en el intérprete

**A) Lista completa a demanda.** `/hoy`, `dame la lista`, `lista de la
mañana`, `lista completa`, `todo lo pendiente` → el bot manda **el mismo
mensaje de la alarma de las 8:00** (misma función `buildManana`, mismo
formato numerado) y guarda la misma fila en `bot_alarmas`, así que `listo 3`
funciona igual. `cierre`, `lista de la tarde`, `/cierre` → el de las 6:00 pm.
El intérprete también lo entiende dicho de otra forma ("mándame la lista",
"el cierre del día") como acción `lista`, distinta de `que_sigue`. Está en
`/ayuda` (📋).

**B) "Qué sigue" siempre con 3 secciones.** Si no hay nada por vencer:
`— nada vence esta semana`. Si no hay notas recientes: `— sin notas de los
últimos 3 días`. La respuesta tiene siempre la misma forma. (`solo urgentes`
sigue sin "Por vencer" y `qué vence esta semana` sigue solo con esa sección,
porque eso se pidió así.)

**C) Bug: fecha dentro del título al crear por intérprete.** "normal IM
revisar propuesta de TOTT para el viernes" creaba «revisar propuesta de TOTT
para el viernes» sin fecha. Ahora hay **un solo extractor de fechas**,
`extraerFecha()` en `src/lib/parser.ts`, que usan el parser clásico y el
intérprete (sobre el título que devuelve el modelo). Entiende las 8 formas:

| Dices | `due_date` |
| --- | --- |
| `… hoy` | hoy |
| `… mañana` | mañana |
| `… pasado mañana` | +2 |
| `… el viernes` | el próximo viernes |
| `… para el viernes` | el próximo viernes |
| `… en 3 días` (también `en una semana`, `en dos semanas`) | hoy + 3 |
| `… el 15 de noviembre` | ese día (el año que viene si ya pasó) |
| `… due friday` | el próximo viernes |

"hoy"/"mañana" en medio de la frase se quedan en el título ("avisar que hoy
no voy"). Probado con las 8 formas en `revisar propuesta de TOTT …` → título
«revisar propuesta de TOTT» y la fecha correcta.

**D) Fase 4d — lista completa, `/pendientes`, notas no son tareas.**

- **Lista completa**: la lista de la mañana, `/hoy`, `dame la lista`,
  `/pendientes` y el cierre muestran **todas** las tareas abiertas de cada
  empresa (orden y corte de 12 descritos en § 1a). "Sigue pendiente" en el
  cierre cuenta todas las abiertas.
- **`/pendientes IM`** (también `pendientes de IM`, `todo lo pendiente de
  IM`, `qué tengo pendiente en PD`, y el intérprete con "mándame lo de IM")
  → la misma lista completa de **una** empresa: encabezado `📋 Pendiente ·
  IM (5)`, numerada y espaciada igual que la de la mañana, sin viñetas. La
  numeración se guarda como la de la mañana: `listo 2` funciona.
  `/pendientes` sin empresa = la lista de la mañana.
- **Notas no son tareas**: un mensaje que empieza por `por dónde iba …`,
  `nota: …`, `nota IM: …` o `notas de PD: …` es una nota de empresa, nunca
  una tarea — tanto en el parser clásico como en el intérprete (si el modelo
  devolviera `crear` con ese título, `comoNotaEmpresa()` lo convierte en
  `nota_empresa`; sin empresa, pregunta de cuál). "Notas de reunión con
  Juan" sin dos puntos sigue siendo una tarea. Migración única:
  `sql/2026-11-limpieza-notas-como-tareas.sql` (primero el select; luego,
  si quieres, el bloque que las pasa a `notas_historial` y las borra).

**Pruebas de la fase 4c/4d**

0. `/hoy` → cada empresa con todas sus abiertas en orden y con 🔺 🔸 ✴️ ▫️
   ▪️; una empresa con más de 12 termina en `+N más en GabbyHQ`.
   `/pendientes IM` → `📋 Pendiente · IM (N)` con solo IM; `listo 1` cierra la
   primera. `Por dónde iba IM: probando` → `📝 Nota de IM guardada`, y en
   /tasks no apareció ninguna tarea nueva.

1. `/hoy` → llega el mismo mensaje de las 8:00; `listo 1` cierra la primera.
   `cierre` → el de las 6:00 pm. Por voz: "dame la lista".
2. `¿qué sigue?` sin nada esta semana ni notas → trae `— nada vence esta
   semana` y `— sin notas de los últimos 3 días`.
3. `normal IM revisar propuesta de TOTT para el viernes` → `✅ IM · Normal ·
   «revisar propuesta de TOTT» · vence vie …`. Repite con las otras 7 formas.

## 5. Fase 5 — Conexión de Google en Settings + Calendar

### 5a. Qué hace

**A) Conector de Google en Settings.** Settings → **Conexiones (Google) →**
(`/settings/conexiones`). La tarjeta "Google" tiene **Conectar**: abre la
pantalla de consentimiento de Google en el navegador
(`/api/google/oauth/start` → Google → `/api/google/oauth/callback`) pidiendo
de una vez `calendar.events`, `gmail.readonly` y `gmail.modify` (el correo se
usa en la fase 6; se pide todo junto para no reautorizar). Al volver, la
tarjeta muestra `Conectado ✓ · email · conectada hace N días · usada hace N
días` y los botones **Reconectar** / **Desconectar** (con confirmación).

Lo que se guarda: una fila en `conexiones_google` (id, email,
refresh_token_enc, scopes, conectado_en, ultimo_uso, activa). El refresh
token va **cifrado** con AES-256-GCM usando `APP_ENCRYPTION_KEY` (env var de
Vercel, 32 bytes en hex). La UI nunca lo ve: la página solo recibe email y
fechas por `/api/google/conexiones`. Desconectar revoca el token en Google
(si puede) y borra la fila. El asistente usa la cuenta activa más reciente.
Reconectar la misma cuenta reemplaza su token (índice único por email).

**B) Calendar, solo a pedido.** El parser y el intérprete entienden **hora**:
`mañana 3pm`, `el viernes a las 10`, `due friday 2pm`, `a las 3:30`, `15:00`,
`8 de la noche`. Sin am/pm, 1–6 es tarde y 7–12 mañana. Se guarda en
`tasks.due_time` (`time`, nullable) y se ve en la alarma de las 8:00, "¿qué
sigue?", los chips de fecha y el contexto de `/pregunta` ("¿qué tengo a las
3?" se contesta).

**Una tarea NUNCA va a Calendar sola, aunque tenga hora.** Va solo si Gabby
lo pide:

| Dices | Qué pasa |
| --- | --- |
| `urgente IM llamar a Juan mañana 3pm y ponla en calendar` (o `agrégala al calendario`, `en la agenda`, `calendar: …`) | crea la tarea y el evento: `✅ IM · Urgente ★ · «llamar a Juan» · mar 3 nov 3:00 pm · 📅` |
| lo mismo **sin hora** (`… el viernes y ponla en calendar`) | crea la tarea y pregunta `📅 ¿A qué hora la pongo en calendar?` con `9:00 am · 12:00 pm · 3:00 pm · 6:00 pm · 📆 Todo el día` |
| `pon en calendar la de TOTT` (o `agrega al calendario el 3`, `la anterior al calendar`) | busca la tarea abierta por título, usa su fecha; sin hora pregunta igual; sin fecha avisa que necesita una |

Confirmación del evento: `📅 En calendar: «título» · vie 6 nov 3:00 pm` (o
`· vie 6 nov · todo el día`). El evento va al calendario principal de la
cuenta conectada: `[IM] título`, 30 minutos (o todo el día), descripción con
la prioridad y el link a /tasks, recordatorio emergente 15 minutos antes. El
id queda en `tasks.gcal_event_id`.

**Sincronización** (solo para tareas que ya tienen `gcal_event_id`):
completar o cancelar → se borra el evento; cambiar fecha u hora (`paypal
mañana 3pm`, "pasa el 3 al lunes") → se actualiza; renombrar → se actualiza
el título; borrar la tarea → se borra el evento antes que la fila. Si Google
falla, la tarea se guarda igual y el bot agrega `⚠️ sin evento en Calendar:
{motivo}`. Las alarmas propias (`bot_recordatorios`) **no** van al
calendario.

**Web (fase 5-D).** El formulario de nueva tarea y el panel de edición tienen
campo **Hora** (solo con fecha) y **📅 Calendar**: en el formulario es una
casilla ("crea también el evento"); en el panel de edición es el botón
**📅 Agregar a Calendar** (con evento: `📅 En Calendar · quitar`). Ambos pasan
por `/api/calendar/tarea`. Y todo lo que la web escribe en una tarea con
evento (guardar cambios, completar desde /tasks, /hoy o la matriz, borrar)
llama después a `/api/calendar/sync` para que el evento siga a la fila o se
borre; el navegador nunca habla con Google. Si Google falla, la tarea se
guarda igual y el aviso sale en gris debajo del panel.

**C) Fechas de pago recurrentes.** Caso: "agrega en calendar IM todas las
fechas de pago con recordatorios de 1 semana, 3 días y el día, todos los
meses". Tabla `pagos_recurrentes` (id, company_id, nombre, dia_del_mes,
monto_texto, recordatorios `int[]` default `{7,3,0}`, gcal_event_id, activo,
created_at). **No son tareas**: no entran en Hoy, la matriz ni las alarmas.

Se administran **solo en la web**: /settings → **Pagos recurrentes**, una
pestaña por empresa, tabla editable (nombre, día, monto), **📅 Agregar a
Calendar** cuando la fila no tiene evento, Edit y Quitar. Pasa por
`/api/pagos`, que al crear o cambiar un pago crea o actualiza su evento
**recurrente** mensual (`RRULE:FREQ=MONTHLY;BYMONTHDAY=15`), título `💳 IM ·
Vercel · $20 USD`, con avisos 7 días antes, 3 días antes y ese mismo día a las
9:00 am (Cancún); al quitarlo, borra fila y evento.

Por el bot **solo se consultan**:

| Dices | Qué pasa |
| --- | --- |
| `pagos` / `pagos de IM` | la lista numerada con el próximo vencimiento de cada uno |
| `qué pagos hay esta semana` / `qué pagos vencen esta semana de PD` | solo los que caen entre hoy y el domingo |

Si le pides al bot crear, cambiar o quitar un pago, responde que eso se hace
en Settings → Pagos recurrentes.

Por qué el evento es de 9:00 a 9:30 am y no "todo el día": en la API de
Google los avisos de un evento de todo el día cuentan hacia atrás desde la
medianoche, así que "ese mismo día a las 9" no se puede expresar. Con el
evento a las 9:00, los avisos quedan exactos: 7 días (10080 min), 3 días
(4320) y 0 (a las 9:00 de ese día). Día 31 en meses cortos: Google salta ese
mes (regla de `BYMONTHDAY`).

**Pendiente (fase 2 de los pagos, anotado):** que la alarma de las 8:00 diga
`💳 Hoy vence: IM Vercel` leyendo `pagos_recurrentes`.

### 5b. Lo que hay que hacer a mano (con cada click)

**Paso 1 — Proyecto en Google Cloud**

1. https://console.cloud.google.com → arriba a la izquierda, el selector de
   proyecto → **New project** → nombre `gabbyhq-asistente` → **Create**.
   Espera la notificación y selecciónalo.
2. Menú ☰ → **APIs & Services → Library**. Busca **Google Calendar API** →
   **Enable**. Vuelve a Library, busca **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (en consolas nuevas se llama
   **Google Auth Platform → Branding**). Tipo **External** → **Create**.
   App name `GabbyHQ`, User support email = tu Gmail, Developer contact =
   tu Gmail → **Save and continue**. En **Scopes** no hace falta agregar
   nada (la app los pide al conectar) → **Save and continue**. En **Test
   users** → **Add users** → tu Gmail (la cuenta cuyo calendario quieres
   usar) → **Save and continue** → **Back to dashboard**. La app queda en
   modo *Testing*: solo esos usuarios pueden conectar. Ojo: en Testing el
   token caduca a los **7 días** y toca Reconectar; cuando todo funcione,
   **Publish app** (botón en la misma pantalla) lo quita sin pedir
   verificación.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type **Web application**, nombre `gabbyhq-web`. En
   **Authorized redirect URIs** → **Add URI** →
   `https://gabby-hq.vercel.app/api/google/oauth/callback` (exacto, sin
   barra final) → **Create**. Copia **Client ID** y **Client secret**.

**Paso 2 — Env vars en Vercel (Settings → Environment Variables, marcar Secret)**

| Variable | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | el Client ID del paso 1.4 |
| `GOOGLE_CLIENT_SECRET` | el Client secret del paso 1.4 |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` en una terminal (64 caracteres hex) |

`APP_URL` ya existe y debe ser `https://gabby-hq.vercel.app`: de ahí sale el
redirect URI. **Redeploy** (Deployments → ⋯ → Redeploy).

**Paso 3 — SQL en Supabase** (SQL Editor, dos queries):
`sql/2026-11-asistente-fase5.sql` (7 columnas de `conexiones_google`,
`rowsecurity = false`, y `due_time` / `gcal_event_id` en `tasks`) y luego
`sql/2026-11-asistente-fase5c.sql` (`pagos_recurrentes`, 9 columnas).

**Paso 4 — Conectar.** GabbyHQ → Settings → **Conexiones (Google) →** →
**Conectar** → elige tu Gmail → Google avisa "app no verificada" (normal en
modo Testing): **Continue** → marca los permisos → **Continue**. Vuelves a
la tarjeta con `Conectado ✓ · tu@gmail.com`.

### 5c. Env vars que agrega esta fase

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ENCRYPTION_KEY`. Nada por
cuenta: cada cuenta se conecta desde Settings.

### 5d. Cómo probar que funciona

1. `urgente IM llamar a Juan mañana 3pm` → `✅ … · mar 3 nov 3:00 pm` **sin**
   📅 y sin evento en Google (la hora sola no basta).
2. `urgente IM llamar a Pedro mañana 3pm y ponla en calendar` → `… · 📅` y
   abajo `📅 En calendar: «llamar a Pedro» · mar 3 nov 3:00 pm`. En Google:
   `[IM] llamar a Pedro`, 3:00–3:30 pm, aviso 15 min.
3. `IM revisar propuesta el viernes, agrégala al calendario` → crea la tarea
   y pregunta la hora con 5 botones; toca **Todo el día** → `📅 En calendar:
   … · vie 6 nov · todo el día`.
4. `pon en calendar la de Juan` → pregunta la hora o crea directo si ya la
   tiene. Luego `llamar a pedro a las 4` → `✏️ … → a las 4:00 pm 📅` y el
   evento se movió; `listo pedro` → el evento desapareció.
5. /tasks → nueva tarea con fecha, **Hora** 15:00 y la casilla **📅
   Calendar** → en Google aparece el evento. Edita otra tarea con fecha →
   **📅 Agregar a Calendar** → `📅 En Calendar · quitar`. Cámbiale la hora y
   guarda → el evento se movió. Márcala hecha desde /hoy → el evento
   desapareció.
6. /settings → Pagos recurrentes → pestaña IM → `Vercel`, día `15`, `$20
   USD` → **Agregar** → la fila dice `📅 en Calendar` y en Google hay un
   evento mensual el 15 a las 9:00 con 3 avisos. Edit → día 20 → el evento se
   movió. En el bot: `pagos de IM` lo lista con `próximo …`; `qué pagos hay
   esta semana` filtra. Quitar → fila y evento fuera.
7. Settings → Conexiones → **Desconectar**. `pon en calendar la de …` →
   `⚠️ sin evento en Calendar: no hay cuenta de Google conectada`. Vuelve a
   **Conectar**.
8. `¿qué tengo a las 3?` → contesta con la tarea de las 3:00 pm.
   `alarma mañana 9am revisar deploy` → llega el ⏰ pero no hay evento.

### 5e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| "Faltan GOOGLE_CLIENT_ID…" en la tarjeta | Env vars sin cargar o sin redeploy | Vercel → Settings → Environment Variables; Redeploy. |
| Google: `redirect_uri_mismatch` | La URI en Credentials no es exacta | Debe ser `https://gabby-hq.vercel.app/api/google/oauth/callback`. `APP_URL` sin barra final. |
| Google: `access_denied` / "app no verificada" sin botón Continue | Tu Gmail no está en Test users | Consent screen → Test users → agrégalo. |
| "Google no devolvió refresh_token" | Ya habías autorizado antes sin `prompt=consent` | https://myaccount.google.com/permissions → quita GabbyHQ → Conectar otra vez. |
| "APP_ENCRYPTION_KEY debe ser 32 bytes en hex" | La llave no tiene 64 caracteres hex | `openssl rand -hex 32`; pégala completa; Redeploy. Si cambias la llave, las cuentas ya conectadas dejan de descifrarse: Reconectar. |
| `⚠️ sin evento en Calendar: invalid_grant` | Token revocado o caducado: con la app en modo *Testing*, Google caduca el refresh token a los 7 días | Settings → Conexiones → **Reconectar**. Para que no pase cada semana: OAuth consent screen → **Publish app** (sigue sin verificación; solo quita la caducidad de 7 días). |
| El evento no aparece | No lo pediste ("y ponla en calendar") o la tarea no tiene fecha | `pon en calendar la de …`. Logs: `[calendar]`. |
| El pago no aparece en Google | Google falló al crear (la fila sí quedó) | /settings → Pagos recurrentes → **📅 Agregar a Calendar** en esa fila. Logs: `[pagos]`. |

---

## 6. Fase 6 — Correo dentro de GabbyHQ (reemplaza n8n / inbox-IM)

**Por qué.** El triage de n8n clasificaba mal urgencia y tipo y dejó de
alertar los VIP. Se rehace aquí, con las dos cuentas ya conectadas en
Settings → Conexiones: `chelsea@interactivemarketing.net` (primero) y
`gabrielarangel169@gmail.com` (después, misma config). n8n sigue vivo hasta
que esto clasifique bien; se apaga en 6b. Nada de lo nuevo escribe en
`im_triaje`; `/inbox`, `/chelsea` y `/rules` quedan intactas hasta entonces.

### 6a. Qué hace

**A) Roles por cuenta** (`conexiones_google.usa_calendar`, `usa_gmail`,
`duena`, `company_id`). Settings → Conexiones muestra por cuenta un selector
"¿De quién?" (Gabby / Chelsea) y dos toggles: **📅 Calendar** (solo puede
estar encendido en UNA cuenta: encenderlo en una lo apaga en las demás, y un
índice único parcial lo garantiza en la base) y **📧 Correo** (en las que
quieras). `conexionActiva()` ahora devuelve la cuenta con Calendar encendido,
no "la más reciente"; antes del SQL (sin columnas) sigue siendo la más
reciente, para que nada se rompa. Defaults del SQL: Gabby = calendar on,
correo off; Chelsea = calendar off, correo on.

**B) Config de correo por cuenta** (`cuentas_correo`, Settings → **Correo**).
Una tarjeta por cuenta: nombre ("IM Chelsea"), dueña, activa, alertar; las
**tres listas por remitente** 🔇 Silencio · 📋 Solo app · 🔔 Alerta (§ 6g;
un email o dominio por línea; un dominio cubre sus subdominios; en la base
siguen siendo las columnas `ruido`, `solo_app` y `vip`);
**reglas** `{match, accion, alerta}` donde `match` es email, dominio o texto
del asunto y `accion` ∈ vip · ruido · para_chelsea · lo_hago_yo · archivar ·
registrar; **chat de alertas** (vacío = `ALLOWED_CHAT_IDS`); **horario**
`07:00-21:00` (Cancún; fuera de él no suena nada y esos correos salen en la
lista de las 8); el cursor de Gmail (`ultimo_history_id`, con "Reiniciar
cursor" para volver a leer 3 días sin duplicar) y **Importar de n8n**: se
pega el JSON de `im_reglas` (o `{vip, ruido, reglas}`) y se suma a lo que
hay: auto_chelsea → para_chelsea, auto_gabby → lo_hago_yo, auto_archivar →
archivar, solo_registrar → registrar; un remitente/dominio con `alerta: true`
entra también a VIP. El SQL precarga la cuenta de Chelsea (activa) y la de
Gabby (inactiva) con el VIP y el ruido iniciales. "📥 Leer ahora" corre la
ingesta desde el navegador (máx 20 correos) para probar sin esperar al cron.

**C) Ingesta** (`src/lib/correo/ingesta.ts`, cron `*/15 * * * *` →
`/api/correo/ingesta` con `CRON_SECRET`; también entra con la sesión web).
Por cuenta activa con 📧 encendido: `users.history` desde el cursor (la
primera vez, o si Gmail ya olvidó el cursor, `newer_than:3d` en INBOX), máx
50 por corrida, de más viejo a más nuevo, en lotes de 4. Cada mensaje →
fila en `correos` (asunto MIME-decodificado, remitente partido en nombre y
email, cuerpo en texto plano sin la cita del hilo, 3000 caracteres) →
clasificador → alerta si toca. El cursor solo avanza cuando el lote entero
se procesó; si algo quedó, la siguiente corrida vuelve a listar y el índice
único de `gmail_message_id` evita duplicados. Lo que la cuenta misma envió
(CC a sí misma) se ignora. Cada llamada al modelo queda en `bot_preguntas`
con `modelo = correo:…` y `chat_id = 0`, así Settings → Asistente la cuenta
en el costo del mes.

**D) Clasificador v2** (`src/lib/correo/clasificar.ts`). Entra el correo,
sale `{urgencia alta|media|baja, tipo necesita_respuesta|pedido_de_tarea|
fyi|notificacion|marketing|reunion|pago, categoria, confianza 0-1, resumen,
razon}`. Orden:

1. **Reglas deterministas, sin modelo**: ruido (lista o regla) → `registrado`,
   baja, sin IA, sin alerta; **VIP** → urgencia **alta** fija + alerta
   forzada (el modelo solo pone tipo y resumen); regla para_chelsea /
   lo_hago_yo / archivar / registrar → ese estado directo (lo_hago_yo crea
   la tarea al momento); **pago fallido / AMEX** (regex en asunto y primeras
   líneas: declined, failed, past due, rechazado, american express…) → alta
   + pago.
2. **LLM solo para lo demás**, con un prompt que dice qué es alta de verdad
   (cliente esperando, fecha cercana, pago fallido, cuenta suspendida) y que
   un correo automático nunca es alta salvo que anuncie un fallo. En un hilo
   recibe los **resúmenes previos** del mismo `gmail_thread_id` y resume
   **solo lo nuevo** (resumen diferencial). Si el modelo falla, el correo
   queda media/fyi con el error en `razon` y sigue visible (un VIP sigue
   alertando).

Proveedor propio, independiente del de `/pregunta`: `LLM_PROVIDER_CORREO`
(openai | anthropic | compatible), `LLM_MODEL_CORREO`, y para "compatible"
`LLM_CORREO_BASE_URL` + `LLM_CORREO_API_KEY` (cualquier endpoint estilo
OpenAI `/chat/completions`: así entra JEV sin tocar código). Sin esas vars,
usa el mismo modelo que `/pregunta`.

**E) Evaluación** (`/correo/evaluar`, `/api/correo/evaluar`). Elige cuenta,
ventana (3/7/14/30 días) y un modelo (`openai:gpt-5-mini`,
`anthropic:claude-haiku-5-5`, `compatible:<modelo JEV>`) → reclasifica esos
correos **sin cambiar su estado** y guarda cada respuesta en
`correo_evaluaciones` (una fila por correo × modelo; repetir reemplaza). La
tabla muestra cada correo con la columna "producción" (cómo quedó de verdad)
y una columna por modelo evaluado; por fila, **✓ correcto** (guarda la
clasificación de producción como verdad) o **debió ser: urgencia · tipo**
(`correo_veredictos`). Arriba, el % de acierto por modelo (urgencia, tipo,
ambos) sobre las filas con veredicto. Eso decide entre gpt-5-mini, JEV y
Claude con datos reales.

**F) Alertas y decisiones** (`src/lib/correo/alertas.ts`,
`decisiones.ts`). Alerta individual SOLO si: **VIP** (o regla con alerta) o
**urgencia alta** — y dentro del horario de la cuenta (ajuste 6b-4; antes
también necesita_respuesta / pedido_de_tarea). Lo demás no suena: sale en
las listas (§ 6f).

```
📧 IM Chelsea · ✴️ alta · necesita respuesta · De: Andrew (TOTT)
Landing page changes
Andrew pide cambios al hero para el viernes
cliente con fecha cercana
[ 📨 Para Chelsea ] [ 🙋 Lo hago yo ]
[ ➕ Tarea ]        [ 🗄 Archivar ]
```

Los botones viajan como `m:<uuid del correo>:ch|yo|ta|ar` (sin borrador:
valen hasta que se decide). **Lo hago yo** y **Tarea** crean una tarea en
`tasks` con notas de tres líneas (`De: …` / resumen / `Ref: gmail:{id}`),
deduplicada por esa línea `Ref:` (igual que el botón de inbox-IM), con la
empresa de la cuenta (`conexiones_google.company_id`) y urgente ★ si el
correo era alta. **Archivar** quita INBOX en Gmail: es lo único que el
asistente toca del Gmail. **Lenguaje natural** (acción `correo` del
intérprete): "el correo de Andrew lo hago yo", "el 15 para Chelsea",
"archiva los de marketing de hoy" (filtro por tipo/urgencia/remitente/hoy);
varios correos a la vez pasan por el plan con [Hacer todo]. **Autoresolver**
en cada corrida: si en el hilo hay un SENT posterior al correo → estado
`respondido` y la alerta se edita a "✅ Respondido".

**Listas.** La de las 8 y el cierre traen una sección **📧 Correos (N)**
numerada a continuación de las tareas (alta + necesita respuesta + pedido de
tarea, pendientes): "el 15 lo hago yo" funciona como "listo 3". Un "listo
15" sobre un correo responde que es un correo y cómo decidirlo. "¿Qué
sigue?" incluye **Correos urgentes** (alta, máx 3, también numerados).
`/pregunta` recibe asunto + resumen + estado de los últimos 7 días, nunca
el cuerpo.

**G) Web.** `/correo`: feed con filtros por cuenta, estado, urgencia, tipo y
búsqueda; las mismas 4 acciones por fila; clic en la fila abre razón y
cuerpo; **Copy pending (Chelsea)** con el formato en inglés de siempre
(HIGH/MEDIUM/LOW) sobre los correos `para_chelsea`. `/correo/evaluar` (E) y
Settings → Correo (B). La nav tiene **Correo** junto a Inbox IM.

| Archivo | Qué hace |
| --- | --- |
| `src/lib/correo/cuentas.ts` | cuentas_correo: cargar/guardar, listas y reglas normalizadas, `coincideLista`, `reglaQueAplica`, `dentroDeHorario` |
| `src/lib/correo/gmail.ts` | Gmail API: history/list, mensaje → campos (MIME, remitente, HTML → texto, sin citas), quitar INBOX, ¿hilo respondido? |
| `src/lib/correo/clasificar.ts` | reglas deterministas + LLM, prompt, validación, `mereceAlerta` |
| `src/lib/correo/ingesta.ts` | el cron: nuevos → fila → clasificar → alertar; autoresolver; cursor |
| `src/lib/correo/alertas.ts` | el mensaje con botones, "✅ Respondido" |
| `src/lib/correo/decisiones.ts` | las 4 decisiones (tarea con Ref, archivar en Gmail) |
| `src/lib/correo/evaluar.ts` | reclasificar con otro modelo, tabla y % de acierto, veredictos |
| `src/lib/correo/importar.ts` | JSON de n8n → listas y reglas |
| `src/lib/correo/pendientes.ts` | lo que las listas, "qué sigue", `/pregunta` y el intérprete saben del correo (nunca el cuerpo) |
| `src/lib/asistente/llm.ts` | `llamarLlm(target)` con proveedor `compatible`; `llmConfigCorreo()`, `parsearModelo()` |

### 6b. Lo que hay que hacer a mano

1. Supabase → SQL Editor → `sql/2026-11-asistente-fase6-correo.sql` en una
   query. Abajo: las columnas nuevas de `conexiones_google`, las dos cuentas
   precargadas y `rowsecurity = false` en las 4 tablas. Después, en otra
   query, `sql/2026-11-asistente-fase6b-ajustes.sql` (los ajustes de § 6f:
   sin él la lista "correos" se guarda sin mensaje y nada se tacha en sitio).
2. Vercel → env vars (ver 6c) → push → redeploy. El cron nuevo aparece en
   Vercel → Settings → Cron Jobs (`/api/correo/ingesta` cada 15 min).
3. Settings → Conexiones: confirma que Gabby tiene 📅 Calendar on y Chelsea
   📧 Correo on (el SQL lo deja así). Si Calendar quedó apagado en las dos,
   enciéndelo en la de Gabby.
4. Settings → Correo: revisa la tarjeta "IM Chelsea" (VIP y ruido ya
   cargados), pon el chat de alertas si no es el del bot, guarda. Pega el
   JSON de n8n en "Importar de n8n" si quieres traer las reglas viejas.
5. "📥 Leer ahora" → trae los últimos 3 días. Revisa `/correo`.
6. Orden del resto (H): evaluar modelos (6d-3), activar alertas con el
   ganador (ya están activas: apágalas en la tarjeta si prefieres evaluar en
   silencio), y después activar la cuenta de Gabby: en Conexiones 📧 Correo
   on en gabrielarangel169@gmail.com y en Settings → Correo marcar "IM Gabby"
   como activa.
7. **Apagar n8n cuando esto clasifique bien** (validado con 6d): en n8n
   desactiva los 4 workflows del triage (A reglas/VIP, B ingesta → Supabase
   inbox-IM, C alertas Telegram, D autoresolver) con el toggle "Active" de
   cada uno — no los borres hasta un mes después, por si hay que volver. En
   BotFather, `/mybots` → el bot viejo del inbox → "Delete Bot" (o
   `/revoke` para invalidar su token sin borrarlo). Después, las vistas
   `/inbox`, `/chelsea` y `/rules` y las env vars `SUPABASE_INBOXIM_*`
   se eliminan en una fase de limpieza.

### 6c. Env vars que agrega esta fase

| Variable | Valor | Obligatoria |
| --- | --- | --- |
| `LLM_PROVIDER_CORREO` | `openai` \| `anthropic` \| `compatible` | No (default: el de `/pregunta`) |
| `LLM_MODEL_CORREO` | p. ej. `gpt-5-mini`, `claude-haiku-5-5`, el modelo de JEV | No (default: `LLM_MODEL`) |
| `LLM_CORREO_BASE_URL` | base URL del endpoint compatible (JEV), sin `/chat/completions` | Solo con `compatible` |
| `LLM_CORREO_API_KEY` | la API key de JEV (Secret) | Solo con `compatible` |

`CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, `GOOGLE_*` y
`APP_ENCRYPTION_KEY` ya existían. Evaluar con `anthropic:…` necesita
`ANTHROPIC_API_KEY`.

### 6d. Cómo probar que funciona

1. **A + B.** Tras el SQL, crea una tarea con hora y "ponla en calendar" →
   el evento sigue cayendo en el calendario de Gabby. Apaga 📅 en Gabby y
   enciéndelo en Chelsea → el siguiente evento va al de Chelsea (y vuelve).
2. **C + D.** Con Chelsea activa, "📥 Leer ahora" → `/correo` muestra los
   correos de 3 días con urgencia, tipo, resumen y razón. Un correo de
   `tottatl.com` sale alta con razón "VIP: tottatl.com"; uno de
   `bankofamerica.com` está en estado Registrado sin pasar por el modelo.
   Vercel logs: `[correo-ingesta] IM Chelsea: +N · alertas N · respondidos N`.
3. **E.** `/correo/evaluar` → modelo `openai:gpt-5-mini` → Evaluar; luego
   `compatible:<modelo JEV>` (con las env vars de JEV). Marca 15–20 filas
   con ✓ o "debió ser". Arriba, el % por modelo. El ganador va a
   `LLM_PROVIDER_CORREO` / `LLM_MODEL_CORREO`.
4. **F.** Mándate un correo desde una dirección VIP a la cuenta de Chelsea →
   en ≤ 15 min llega la alerta con 4 botones. Toca **Lo hago yo** → la tarea
   aparece en /tasks con las notas `De:` / resumen / `Ref: gmail:…` y el
   mensaje pierde los botones. Contesta ese correo desde Gmail → en la
   siguiente corrida el estado es Respondido y la alerta dice "✅
   Respondido". Por texto: `el correo de <nombre> para Chelsea`,
   `archiva los de marketing de hoy` (plan con [Hacer todo]).
5. **Listas.** Con un correo alta pendiente, `dame la lista` → sección "📧
   Correos (1)" numerada al final; `el N lo hago yo` lo decide; `listo N`
   responde que es un correo. `¿qué sigue?` → "Correos urgentes".
   `¿qué correos tengo pendientes?` → la lista viva "correos" (§ 6f-2).
6. **Cuenta de Gabby.** Paso 6 de 6b; "Leer ahora" → sus correos aparecen
   en `/correo` con el filtro de cuenta "IM Gabby".

### 6e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| "Leer ahora" dice `invalid_grant` | El refresh token de esa cuenta se revocó | Conexiones → Reconectar esa cuenta |
| Nada entra | 📧 Correo apagado en Conexiones, o la cuenta inactiva en Settings → Correo | Enciende los dos; logs `[correo-ingesta] … sin cuentas activas` |
| Todo sale media/fyi con "modelo falló" en razón | `LLM_*_CORREO` mal, key sin saldo, o timeout | Logs `[correo] clasificar falló`; `bot_preguntas` no registra la llamada |
| Llegan correos viejos otra vez | Cursor reiniciado o Gmail olvidó el historyId | Normal: no se duplican (índice único) |
| Alertas fuera de hora | `horario_alertas` mal escrito (debe ser `HH:MM-HH:MM`) | Se guarda `07:00-21:00` si el formato no es válido |
| "Archivar" dice que no pudo sacarlo de Gmail | La cuenta no tiene `gmail.modify` (conectada antes de la fase 5) | Conexiones → Reconectar; el estado sí cambió |
| El evento de Calendar cae en la cuenta equivocada | 📅 encendido en la otra cuenta | Conexiones: enciéndelo en la correcta (apaga la otra solo) |
| "correos" se manda pero "el 3 lo hago yo" no lo encuentra, o nada se tacha | Falta `sql/2026-11-asistente-fase6b-ajustes.sql` (la fila se guarda sin mensaje y como `que_sigue`) | Corre el SQL 6b; logs `[bot_alarmas] sin migración 6b` |
| Un botón de la alerta dice "ese botón ya caducó (48 h)" | Respondido / Para Chelsea hace más de 48 h | Decídelo en `/correo` o con texto ("el correo de X lo hago yo") |

### 6f. Ajustes 6b (3 nov 2026) — listas desde `correos`, lista viva, seguridad, bug del cierre

Nueve ajustes después de la primera semana. SQL: `sql/2026-11-asistente-fase6b-ajustes.sql`.

**0) Las listas leen la tabla `correos`, nunca inbox-IM.** La de las 8, el
cierre y "¿qué sigue?" ya no consultan `im_triaje` (desaparece la línea
"📬 Sin correos pendientes" bajo CHELSEA y `countChelseaMail`). En su lugar,
una sección **📧 por cuenta** a continuación de las tareas, con los correos
**pendientes** (estado `nuevo` o `para_chelsea`, últimos 7 días), numerados
en la misma secuencia de la lista para que "el 15 lo hago yo" funcione:

```
📧 IM Chelsea (7)
📧 15. ✴️ Andrew (TOTT) · Landing page changes · hace 3h
📧 16. Lion's Gate (TOTT) · Invoice October · hace 5h · 📨 Chelsea
📧 17. Meta Ads · Your campaign was approved · hace 9h
📧 18. …
📧 19. …
· +2 más → correos
✅ Chelsea respondió · Lion's Gate (TOTT) · Proposal v2
Para decidir: el 15 lo hago yo · el 15 para Chelsea · archiva el 15 · correos = la lista completa · /correo
```

Orden: alta → alguien espera (necesita respuesta / pedido de tarea) → resto;
dentro de cada grupo el más nuevo primero. Máximo **5 por cuenta** y "+N más
→ correos". Sin nada pendiente: una línea "📧 Sin correos pendientes". Si la
consulta falla, la lista sale igual con "📧 Correos: no se pudieron consultar
ahora". El contexto de `/pregunta` también dejó de leer inbox-IM (cuenta los
`para_chelsea` de la tabla `correos`). Código: `src/lib/correo/listas.ts`
(`seccionCorreosDiaria`) y `pendientes.ts` (`correosPendientes`).

**1) Seguridad: ningún valor de env var ni key en mensajes ni logs.** El bot
llegó a imprimir en Telegram "modelo falló: LLM_PROVIDER_CORREO inválido:
sk-proj-…" porque la key se pegó en la variable equivocada y el error la
repetía. Tres capas:
- `llmConfig()` / `llmConfigCorreo()` ya no incluyen el valor en el error
  (solo el **nombre** de la variable y los valores permitidos).
- El clasificador deja en `razon` un texto genérico por tipo: `⚠️
  clasificador no disponible (config | timeout | respuesta | proveedor)`.
  Es lo que la alerta y `/correo` muestran.
- `src/lib/errores.ts`: `mensajeError(err)` / `redactar(texto)` enmascaran
  cualquier cosa con pinta de credencial (`sk-…`, `Bearer …`, tokens
  largos) y el valor real de toda env var cuyo nombre contenga KEY, SECRET,
  TOKEN, PASSWORD o SEED. **Todos los catch** que convierten un error en
  texto (Telegram, respuestas de `/api/*`, logs del plan, intérprete,
  pregunta, pasos, organízame, alarmas, ingesta, decisiones, Calendar,
  pagos) pasan por ahí. `motivoParaUsuario(err)` devuelve solo "config"
  cuando el problema es de variables.

**2) Lista viva de correos.** `correos`, `mis correos`, `correos de
Chelsea`, `correos de IM Gabby`, `¿qué correos tengo pendientes?` (y el
botón **[📋 Correos de IM Chelsea]** al pie de cada alerta) → un mensaje
con **todos** los pendientes de esa cuenta (sin cuenta: de todas, con el
nombre de la cuenta al final de cada línea), numerados y agrupados
**✴️ Alta / ✉️ Necesitan respuesta / Resto**, con remitente y "hace Nh";
debajo, los VIP respondidos en las últimas 48 h en cursiva. Se guarda en
`bot_alarmas` con `tipo = 'correos'`, así "el 3 para Chelsea", "archiva el
5", "el 2 lo hago yo" resuelven contra ella (el intérprete recibe "lista de
CORREOS: todos sus números son correos"). Más de 40 → "+N más → /correo".
Una cuenta que no existe: "No tengo una cuenta de correo «X». Las que hay:
…". Si el nombre coincide con la dueña (`duena`), el nombre o el email de
la cuenta, la encuentra.

**3) Actualización en sitio.** `bot_alarmas` guarda ahora `chat_id`,
`message_id` y `texto` de cada lista enviada (las de las 8 y 6, "qué
sigue", las pedidas a mano y la de correos). Cuando un correo se decide
(botón, texto o web) o el autoresolver ve la respuesta, el **último mensaje
de lista** que lo numera, si tiene **menos de 12 h**, se edita tachando
esa línea: `~~16. Lion's Gate (TOTT) · Invoice…~~ ✅` (o `🙋`, `➕`, `📨
Chelsea`, `🗄`). Sin mensajes nuevos: la lista refleja el estado real. Una
lista que Telegram partió en varios mensajes (> 4000 caracteres) no se
edita (solo se conoce el id del último trozo). `tacharCorreoEnLista` en
`listas.ts`; `ultimaListaCon` en `registro-listas.ts`.

**4) Alertas individuales solo para VIP y alta** (`mereceAlerta`). Lo
demás — necesita respuesta, pedido de tarea, media — solo sale en las
listas.

**5) `/chelsea` lee `correos`.** La sección de correos de la web es
`/api/correo?estado=para_chelsea` (con "Show resolved": + `respondido`, 14
días), agrupada por el día en que se pasó o respondió. La casilla archiva
(sale del inbox de Gmail); el botón 🙋 lo toma Gabby como tarea. "Copy
pending list" conserva el formato en inglés (🔴 HIGH / 🟡 MEDIUM / 🟢 LOW +
Tasks). `/inbox` y `/rules` siguen en inbox-IM hasta la fase de limpieza.

**6) "Respondido" no cierra para Gabby.** El autoresolver marca
`respondido` y guarda `respondido_en`; la alerta se edita a **"✅ Chelsea
respondió · asunto · De: …"** (el nombre es `cuentas_correo.duena`; sin
dueña, "✅ Respondido") y **conserva [🙋 Lo hago yo] [➕ Tarea]** 48 h. Si
Gabby toca uno, se crea la tarea normal (estado `lo_hago_yo` / `tarea`,
`respondido_en` se queda) y el mensaje pasa a "✅ Chelsea respondió · 📝
tarea creada · asunto". En las listas, los **VIP** respondidos (columna
`correos.vip`, que el clasificador marca cuando el remitente está en la
lista VIP o en una regla VIP; el SQL rellena los anteriores por la `razon`)
se quedan 48 h en cursiva: "✅ Chelsea respondió · Lion's Gate (TOTT) ·
asunto". Lo mismo para **Para Chelsea**: la alerta pasa a "📨 Para Chelsea
· asunto" y conserva [🙋 Lo hago yo] 48 h. Pasadas las 48 h, el botón
responde "ese botón ya caducó (48 h); decídelo en /correo".

**7) Bug del cierre de las 6: "1 listo" → "no encontré el 1".** Tres
causas posibles, tres arreglos:
- `ultimaAlarma()` tomaba **solo la última fila** de `bot_alarmas` y, si
  tenía `items` vacío (una lista pedida sin tareas, "/pendientes X" vacío),
  devolvía "ninguna" aunque el cierre estuviera justo antes. Ahora revisa
  las últimas 8 filas y usa la **primera con items**, de **cualquier
  tipo** (`manana`, `tarde`, `que_sigue`, `lista`, `correos`).
- "1 listo", "3 terminado", "2, 5 hechas", "el 4 listo", "listo el 3" se
  resuelven en el **parser**, sin modelo (`accion: listo`), contra esa
  última lista. Si el número es un correo: "El 1 es un correo: dime 'el 1
  lo hago yo'…". Por el intérprete, un `#n` que es correo da el mismo
  aviso en vez de "no encontré".
- Las listas pedidas a mano se guardan como `tipo = 'lista'` (antes
  `manana`) y el cierre del cron, como siempre, `tarde`; ambos con el
  mensaje. `idDeNumero` del webhook usa la misma `ultimaAlarma()`.

**8) Duplicadas: solo un SELECT.** `sql/2026-11-duplicadas-select.sql`
lista las tareas cuyo título normalizado (sin acentos ni mayúsculas) se
repite con **una cerrada y otra abierta**, con id, empresa, estado, fechas
y el inicio de las notas, para decidir a ojo. No borra ni actualiza nada.

**Cómo probar 6f** (después del SQL 6b y el deploy):
1. `correos` → la lista por urgencia; `correos de Chelsea` → solo esa
   cuenta; `correos de nadie` → "No tengo una cuenta…".
2. `el 2 lo hago yo` → tarea creada y, en el mensaje de la lista, la línea
   2 tachada con 🙋 (sin mensaje nuevo de lista). `archiva el 3` → tachada
   con 🗄.
3. `/hoy` → sección 📧 por cuenta con máximo 5 líneas y "+N más → correos";
   `el 15 para Chelsea` funciona con esos números; `15 listo` responde que
   es un correo.
4. `cierre` (o la de las 6) → `1 listo` cierra el 1 de ese cierre; `listo
   el 2` también.
5. Contesta desde Gmail un correo alertado → en ≤ 15 min la alerta dice
   "✅ Chelsea respondió" con [Lo hago yo] [Tarea]; toca [Lo hago yo] →
   "✅ Chelsea respondió · 📝 tarea creada". Si era VIP, la lista de las 8
   lo muestra en cursiva 48 h.
6. Un correo media / necesita respuesta ya no manda alerta: aparece en
   `correos` y en la lista de las 8.
7. Pon a propósito `LLM_PROVIDER_CORREO=sk-xxx` → `razon` dice "⚠️
   clasificador no disponible (config)"; en los logs no aparece el valor.
8. `/chelsea` muestra los `para_chelsea` de `correos`; la casilla archiva.

---

### 6g. Ajustes 6c (3 nov 2026) — tres niveles por remitente, reaplicar, aprender desde el bot

SQL: `sql/2026-11-asistente-fase6c-niveles.sql` (agrega la columna
`cuentas_correo.solo_app` y precarga IM Chelsea). Sin correrlo, la app sigue
funcionando con dos listas y avisa en los logs al guardar Solo app.

**1) Tres niveles explícitos.** En Settings → Correo cada cuenta tiene tres
listas (email o dominio, uno por línea). "Ruido" pasó a llamarse Silencio y
"VIP" a Alerta; Solo app es nueva. Las columnas de la base conservan el
nombre viejo.

| Nivel | Columna | Qué pasa con el correo | Telegram | Lista "correos" del bot y lista de las 8 | /correo |
| --- | --- | --- | --- | --- | --- |
| 🔇 **Silencio** | `ruido` | `registrado`, baja, sin IA. `razon` = "silencio: dominio" | Nunca | No sale | Solo con el filtro "Silencio (registrado)"; "Todos" lo excluye |
| 📋 **Solo app** | `solo_app` | El modelo lo clasifica (urgencia, tipo, resumen) pero `soloApp` apaga la alerta | **Nunca**, aunque el modelo diga alta | Sí (numerado, como cualquier pendiente) | Sí |
| 🔔 **Alerta** | `vip` | Urgencia **alta** fija, `vip = true`; el modelo pone tipo y resumen | Inmediato, con botones (dentro del horario) | Sí, y respondido queda 48 h en cursiva | Sí |

Orden de evaluación en `clasificarPorReglas` (`nivelDe`): **Silencio >
Alerta > Solo app** > reglas importadas de n8n > pago fallido / AMEX >
modelo. Lo que no está en ninguna lista lo decide el modelo: alta → suena
como Alerta; lo demás se comporta como Solo app (listas y /correo, sin
sonar). El SQL precarga en IM Chelsea, además de los bancos: `zoom.us`,
`fathom.video`, `fireflies.ai`, `read.ai`, `otter.ai`, `trustpilotmail.com`,
`gusto.com`, `calendar-notification@google.com`, `slack.com` en Silencio, y
`gabrielarangel169@gmail.com` en Solo app (lo que Gabby le manda a Chelsea
no es pendiente de ella). Las respuestas de calendario ("Accepted: …",
"Declined: …", "Tentative: …") no llegan de un remitente fijo sino de quien acepta, así que
van como **regla por asunto** con la acción nueva `📋 Solo app`: una regla
cuyo `match` empieza con `^` aplica cuando el asunto **empieza** por ese
texto (`^accepted:`); sin `^` basta con que lo contenga. Las reglas se
evalúan después de las tres listas: un "Accepted:" de un remitente en
Alerta sigue sonando.

**2) Reaplicar reglas a lo ya ingerido.** Botón "🔁 Reaplicar reglas" en la
tarjeta de cada cuenta (guarda primero: lee las listas de la base) y ruta
`/api/correo/reaplicar-reglas` (`GET` con `Authorization: Bearer
$CRON_SECRET`, `?cuenta=<id>` para una sola; `POST {cuenta_id}` con la sesión
web). Recorre los correos de los últimos 30 días con estado `nuevo` o
`para_chelsea` (máx 500 por cuenta) y, si el remitente coincide con una
lista, aplica el nivel: Silencio → `registrado` (y tacha su línea en la
última lista con 🔇); Alerta → urgencia alta + `vip`; Solo app → `alertado =
false` (no vuelve a sonar, no se borra la alerta vieja). Un correo con
tarea creada (`task_id`) es decisión a mano y no se toca. Responde "N a
silencio · M a alerta · K a solo app" por cuenta. No manda alertas nuevas.

```
curl -H "Authorization: Bearer $CRON_SECRET" https://gabby-hq.vercel.app/api/correo/reaplicar-reglas
→ {"ok":true,"texto":"IM Chelsea: 4 a silencio · 0 a alerta · 2 a solo app", …}
```

**3) Aprender desde el bot** (`aprenderNivel` en `src/lib/correo/niveles.ts`;
el intérprete manda `{"tipo":"correo","nivel":"silencio|solo_app|alerta"}`,
con `accion` o sin ella). Sobre un "📧" numerado de la última lista o un
correo reciente por remitente/asunto:

| Dices | Hace |
| --- | --- |
| `el 5 es silencio` | Dominio del remitente → 🔇 Silencio de esa cuenta; el correo pasa a registrado. Confirma `🔇 zoom.us → Silencio en IM Chelsea` |
| `el 5 es solo app` / `que no me avise, solo en la app` | Dominio → 📋 Solo app; el correo deja de contar como alertado |
| `el 5 es alerta` / `avísame siempre de TOTT` | Dominio → 🔔 Alerta; el correo queda alta y `vip` |
| `archiva el 5 y márcalo como silencio` | Las dos cosas: archiva (saca del inbox de Gmail) y aprende el dominio |
| `el correo de Juan (gmail) es silencio` | En buzones genéricos (gmail, outlook, hotmail, yahoo, icloud, proton…) aprende el **email completo**, no el dominio |

Si el dominio ya estaba en otra lista, lo mueve y lo dice: `🔔 tottatl.com →
Alerta en IM Chelsea (estaba en Solo app)`. Varios correos del mismo
remitente en una orden ("archiva el 3 y el 4 y márcalos como silencio")
aprenden el dominio una sola vez. En `/ayuda todo` está el ejemplo.

**4) Reclasificar lo que nunca pasó por el modelo.** Los correos ingeridos
mientras el clasificador estaba caído (2 nov) quedaron con `confianza = 0`,
`resumen = asunto` y una razón "⚠️ clasificador no disponible". "Reaplicar
reglas" no los toca (solo mira listas). Botón "🤖 Reclasificar sin modelo"
en la tarjeta de cada cuenta y ruta `/api/correo/reclasificar` (`GET` con el
bearer de `CRON_SECRET`, `?cuenta=<id>`; `POST {cuenta_id}` con sesión).
Recorre los pendientes (`nuevo` / `para_chelsea`) de 30 días con
`confianza = 0` (o nula) o razón vacía, máx 200 por clic y 80 s, de más
viejo a más nuevo para que los resúmenes del hilo se acumulen, y los pasa
por reglas + modelo como recién llegados: actualiza urgencia, tipo,
categoría, resumen, razón, confianza y `vip`; si una lista o regla decide el
estado sin efectos (registrado, archivado, para Chelsea) también lo aplica
(🔇 tacha la línea en la última lista). **Nunca alerta por Telegram** y no
crea tareas. Un correo con tarea no se toca. Si el modelo vuelve a fallar
la fila queda como estaba y cuenta como "sin modelo". Responde "N
reclasificados" (y "· M sin modelo" si hubo).

```
curl -H "Authorization: Bearer $CRON_SECRET" https://gabby-hq.vercel.app/api/correo/reclasificar
→ {"ok":true,"texto":"IM Chelsea: 23 reclasificados", …}
```

**5) Idioma por cuenta** (`cuentas_correo.idioma`, `'es'` | `'en'`, default
`'es'`; selector junto al nombre en Settings → Correo; IM Chelsea → `en`).
Lo que está pensado para la dueña del buzón sale en su idioma, para
copiarlo y pegárselo tal cual: el **resumen y la razón** del clasificador
(el prompt agrega una línea "escribe resumen y razon en inglés"; con `es`
el prompt no cambia ni una letra, así las evaluaciones siguen siendo
comparables), la **alerta de Telegram** (cabecera "📧 IM Chelsea · ✴️ high ·
needs a reply · From: Andrew (TOTT)", "(no subject)", "5 min ago"), la
edición "✅ Chelsea replied", la **lista "correos"** de esa cuenta (título
"Mail · IM Chelsea (7)", grupos "✴️ High / ✉️ Need a reply / Rest", "+3 more
→ /correo", "Nothing pending 🎉") y las líneas de esa cuenta en la **sección
📧 de la lista de las 8 y de las 6**. Con "correos" de todas las cuentas el
título va en español y cada línea en el idioma de su cuenta. Todo lo demás
sigue en español: las tareas, "qué sigue", las notas, los botones de la
alerta, los títulos tras decidir ("📨 Para Chelsea", "➕ Tarea creada") y el
pie "Para decidir: el 5 lo hago yo…". Los correos ya clasificados no
cambian de idioma solos: "🤖 Reclasificar sin modelo" solo rehace los que
quedaron sin clasificar. Implementación: `src/lib/correo/idioma.ts`
(`textos(idioma)`), `instruccionIdioma` en el prompt; las listas toman el
idioma de `cargarCuentas()`, no de un join, para seguir funcionando antes de
correr el SQL.

**Cómo probar**

1. Corre el SQL 6c → Settings → Correo muestra tres columnas; IM Chelsea
   tiene `zoom.us` y `slack.com` en Silencio, `gabrielarangel169@gmail.com`
   en Solo app, tres reglas `^accepted:` / `^declined:` / `^tentative:` → 📋
   Solo app, e idioma 🇺🇸 English.
2. "🔁 Reaplicar reglas" → aviso "N a silencio · …"; en /correo con "Todos"
   ya no salen los de Zoom; con "Silencio (registrado)" sí.
3. Mándate un correo desde tu Gmail a la de Chelsea → entra a /correo y a
   `correos`, sin alerta en Telegram aunque diga "urgente".
4. `correos` → `el 2 es silencio` → confirma con el dominio; su línea queda
   tachada con 🔇 y Settings → Correo lo muestra en Silencio.
5. "🤖 Reclasificar sin modelo" → aviso "N reclasificados"; en /correo los
   del 2 nov ya traen resumen propio y confianza > 0 (en inglés en IM
   Chelsea), y Settings → Asistente cuenta esas llamadas como
   `correo:<modelo>`.
6. `correos de Chelsea` → "📧 Mail · IM Chelsea (N)" con "✴️ High" y "3h
   ago"; `correos` (todas) → título en español, las líneas de IM Chelsea en
   inglés. La siguiente alerta de un remitente en Alerta llega con "From:"
   y la razón en inglés; los botones siguen en español.

## 7. Fase 7 — De comandos a conversación

**La lección más importante del curso: tu asistente conversa.** La versión
para pegar en un Gem / GPT / Proyecto, con las mismas reglas, está en
[prompt-maestro.md](prompt-maestro.md); al final de ese archivo hay una tabla
de qué cumple ya el bot y qué no. Hablar con
el bot tiene que sentirse como hablar con una asistente humana, no con un
menú. La alumna "no sabe organizarse"; el asistente organiza **por** ella,
conversando. Todo lo construido antes (listas, acciones, alarmas, Calendar)
sigue igual por debajo: esta fase cambia la capa de arriba.

### 7a. Qué hace

**A) Memoria de conversación.** Cada mensaje de ida y vuelta queda en
`bot_conversacion` (chat_id, rol `user`/`assistant`, texto, acciones,
created_at): lo que ella escribe (o dicta), lo que el bot responde, y qué
botón tocó. Al interpretar un mensaje, el modelo recibe los **últimos 10
turnos o los de los últimos 30 minutos**, lo que sea menor, con las tareas
que cada turno mencionó y su ref actual. Así funcionan "sí", "la segunda",
"esa no, la otra", "lo mismo para PD", "¿y lo de ayer?", "cambia la hora a
las 4". "La anterior" ahora sale del hilo (antes, del registro). `olvida lo
anterior` / `empecemos de nuevo` corta el hilo: el bot deja una marca y no
mira nada anterior.

**B) El asistente propone.** Después de una acción o una respuesta puede
agregar **una** sugerencia corta con botones (nunca más de una por mensaje;
nunca si Settings dice "solo obedece"):

| Cuándo | Sugerencia |
| --- | --- |
| Tarea nueva sin fecha | `¿Para cuándo?` [Hoy] [Mañana] [Esta semana] [Sin fecha] — "esta semana" = el viernes |
| Tarea nueva sin empresa | los botones de empresa de siempre |
| Tarea nueva importante/urgente con hora y sin calendar | `¿La pongo en calendar?` [📅 Sí] [No] |
| Al completar una tarea (`listo 3`, "el 3 ya está") | `👏 Te quedan N de IM. ¿Seguimos con «…»?` [Sí] [Luego] |
| Audio largo con 3+ órdenes | el plan de siempre, cerrando con `¿Algo que se me escapó?` |
| Una pregunta cuya respuesta revela un problema (3+ vencidas de una empresa, o una nota de 20+ días) | `Ojo: 3 vencidas de AAMA; «website» lleva 46 días. ¿La pasamos a esta semana o la cancelamos?` [Esta semana] [Cancelar] [Déjala] · o `Ojo: la nota de IM tiene 20 días. ¿La archivo?` [Archivar] [Déjala] |

Si dice **Luego** o **Déjala**, queda guardado en `bot_conversacion`
(`acciones.declinado`) y el bot no insiste: "seguimos" no vuelve ese día; una
vencida o una nota concretas, no vuelven en 30 días.

**C) Modo "organízame".** Disparadores: `organízame`, `ayúdame con mis
pendientes`, `no sé por dónde empezar`, `estoy abrumada`, `qué hago`,
`ponme en orden`. El bot toma el control:

```
Tienes 11 pendientes, Gabby. Vamos a dejarlos en orden en 2 minutos.
Empiezo por lo vencido: 1/8 · «AAMA website» · AAMA lleva 46 días vencida. ¿Qué hacemos?
[Hoy] [Mañana] [Esta semana]
[Cancelar] [Delegar] [Siguiente ›]
```

Recorre vencidas (más vieja primero) → sin fecha (urgentes y ★ primero) →
urgentes con fecha, una por una. Cada botón ejecuta y pasa a la siguiente
(**Delegar** la pasa a la empresa Chelsea si existe; si no, le deja una
nota). **Siguiente** la salta. Máximo 8 por sesión: "Vamos con los 8 más
viejos; el resto mañana". Se sale con `para` / `después` / `basta`. Al
final: `Listo, Gabby 👏 Hoy: 3. Mañana: 4. Esta semana: 2. Cancelaste 2.` y
`¿Te mando la lista?` [Sí] [No]. La sesión vive 30 minutos (los demás
borradores, 10).

**D) Tono y personalidad.** Un solo system prompt (`personaPrompt()` en
`config.ts`, las reglas del prompt maestro en palabras de la app) para el
intérprete, `/pregunta` y la línea de la mañana:
español neutro, cálido, breve, sin voseo; usa el nombre de la persona;
celebra en una palabra (`✅ Hecha 👏 «…»`); si no entiende, pregunta una cosa
concreta con botones (`No pillé eso, Gabby. ¿Es una tarea nueva, una orden o
una alarma?`); nunca inventa. Configurable en **Settings → Asistente**:
nombre de la persona, nombre del bot, tono (informal/formal) y si propone
sugerencias o solo obedece (modo menú). Eso es lo que se personaliza por
alumna; vive en `asistente_config` (una fila) y, mientras no exista la
tabla, aplican los defaults (Gabby · Asistente · informal · propone).
`/start` (o un "hola" solo) responde con la presentación: quién es, cómo
hablarle, dónde cambiar los nombres, y "suéltame todo lo que tienes en la
cabeza".

**E) Mensajes del día más humanos.** La alarma de las 8 abre con una línea
generada por el modelo a partir de los números del día (cuántas vencen hoy,
cuántas vencidas, cuáles tienen hora, la más importante): "Buenos días,
Gabby. Hoy vencen 3 cosas y tienes una reunión a las 3. Lo más importante:
«…»". Si el modelo tarda más de 8 s o falla, sale la versión fija con los
mismos datos. El cierre abre con el balance: `Cerraste 4 de 11 👏. Quedan 2
vencidas.` Si no cerró nada y hay abiertas, además llega `Día difícil.
¿Pasamos todo a mañana y arrancamos limpio?` [Sí] [Elijo] (Sí = `pasa
todo`).

**F) Log y costo.** Cada turno que pasa por el modelo (intérprete,
`/pregunta`, línea de la mañana) queda en `bot_preguntas` con sus tokens;
timeout 20 s (8 s la línea de la mañana). **Settings → Asistente** muestra el
costo del mes: turnos por tipo, tokens y el estimado en USD a precio de lista
de gpt-5-mini. Las sugerencias y "organízame" no usan el modelo: son reglas,
y no cuestan.

**G) Planificar la semana hablando.** Cuando el mensaje describe varios días
("hoy…, mañana…, el miércoles…, el jueves…"), el intérprete separa cada cosa
en su propia tarea con la fecha de ese día. Antes de crear, `similitud.ts`
busca una tarea abierta que sea lo mismo: similitud de título **≥ 0.75**
(Dice sobre bigramas, sin acentos) o una **palabra clave específica**
compartida ("marketing", "Jobescape", "Chelsea": palabras de 5+ letras que
no estén en la lista `GENERICAS` del código — "asistente", "equipo", "curso",
"correo", "tarea", "pendiente"… no identifican nada). La palabra clave
tolera cómo la transcribe Whisper: "Job Escape" y "Jobscape" siguen siendo
«Jobescape». Si existe, no se duplica: se actualiza (fecha, prioridad, hora)
y el plan lo dice. **Una tarea abierta se empareja con UNA sola línea** del
mensaje (`emparejarParecidas()`: la de título más parecido; entre dos por
palabra clave, la que comparte más claves y, en empate, la dicha primero);
las demás líneas crean tareas nuevas. Una línea que repite una tarea que
el mismo mensaje ya mueve por ref ("posponer t3" + "crear lo de marketing")
se descarta: es la misma orden dicha dos veces. "prioridad", "lo
importante", "me voy a concentrar en" → urgente ★ ese día. El plan se
muestra **por día**, no por acción:

```
Así queda tu semana:
Mañana (lun 2 nov):
  ✴️ Correos de Chelsea pendientes · IM (ya existía, la muevo)
Miércoles (4):
  ▫️ Marketing Team · DATAVIA · ⏰ 10:00 am (ya existía, la muevo)
  ▫️ Cancelar Jobescape · Personal
Jueves (5):
  ▫️ Pasar $500 de IM a WSH · IM
💡 Si alguna tiene hora, dímelo ("la de marketing a las 10") y, si quieres, la pongo en calendar.
[ ✅ Así queda ]  [ ✏️ Corrijo ]
```

Una alarma sobre una tarea del plan ("…a las 10 y recuérdamelo") va como
`⏰ 10:00 am` en la línea de esa tarea, no repetida abajo en "También"
(`emparejarAlarmas()`; al ejecutar se crean las dos cosas igual).

**Solo lo que se nombró.** En un plan por días el bot crea o mueve
únicamente las tareas que el mensaje nombra; las demás no se tocan aunque
estén vencidas o tengan fecha de esos días ("mañana" no significa mover
nada a mañana). Está en el prompt y, por si el modelo se pasa, en código:
`soloLasNombradas()` descarta un `posponer`/`cambiar` sobre una tarea que
el mensaje no menciona (ni por título, ni por palabra clave — las mismas
que usa la similitud, tolerando la transcripción —, ni por número) y lo
muestra como `⚠️ … no la nombraste, no la toco`. Si quiere que el bot
reacomode lo existente, lo pide: "acomoda el resto".

Debajo va **una** sugerencia (qué le falta: empresa u hora), sin botones
(los botones son los del plan). Al aprobar, las tareas creadas quedan en el
hilo, así que "la de marketing a las 10", "lo de WSH ponlo en calendar" o
"sí" aplican sobre ese plan con la memoria de conversación.

**Corregir el plan antes de aprobarlo** (`correcciones.ts`). Mientras el
plan espera su OK (o después de tocar **Corrijo**, que ya no lo descarta),
el siguiente mensaje lo corrige. Una corrección **nunca borra ni completa
una tarea**: solo cambia el plan.

| Dice | Qué pasa |
| --- | --- |
| `quita el marketing repetido`, `marketing sale dos veces` | Se queda una línea de marketing (la que mueve la tarea existente); la otra se va. Con una sola línea, esa línea era el duplicado de una tarea que ya existía: se va (no se crea nada). |
| `quita X`, `sin X`, `saca X` | La línea de X sale del plan; la tarea no se toca. Si X está en 2+ líneas, pregunta con botones [Solo la repetida] [Las N] [Dejar como está]. |
| `borra X`, `elimina X` (con el plan pendiente) | Pregunta: [Solo quitarla del plan] [Borrar la tarea de verdad] [Dejar como está]. Nunca borra sin ese botón. |
| `déjala donde estaba`, `no la muevas`, `X se queda` | La línea que movía esa tarea existente sale del plan. Sin nombre y con varias movidas, pregunta cuál con botones. |
| `olvida lo anterior`, `olvídalo`, `no`, `nada` | Descarta el plan pendiente entero ("olvida" además limpia el hilo). |
| `la de marketing a las 10`, `lo de WSH el viernes`, `la de Chelsea es de IM`, `y el viernes llamar a Juan` | Va al intérprete; lo que devuelve se **fusiona** en el plan (`fusionarCorreccion()`): la línea que nombra cambia (y su alarma se mueve con ella), lo que no nombra se agrega, lo demás queda igual. Si el modelo devolviera `borrar`/`cancelar`/`completar`, el bot pregunta con botones en vez de hacerlo. Una pregunta o una orden sobre otra tarea no es corrección: se atiende normal y el plan sigue esperando. |

El plan corregido muestra **solo lo que cambia** y vuelve a pedir el OK:

```
Corregido:
  ✂️ Quito «Zip del equipo de marketing» (no la creo)
  ▫️ Marketing Team · DATAVIA · mié 4 · ⏰ 11:00 am (ya existía, la muevo)
Lo demás (6 líneas) queda igual.
[ ✅ Así queda ]  [ ✏️ Corrijo ]
```

Las alarmas y líneas que no se corrigieron no se repiten. Si el plan se
queda vacío, "No hago nada". Los botones de una duda viajan como
`c:<nonce>:<n>` sobre el borrador `plan_duda`.

**H) Un paso a la vez** (regla 4 del prompt maestro). `me da flojera «X»`,
`no sé por dónde empezar con «X»`, `divide «X»`, `paso a paso «X»` → busca la
tarea por título, el modelo propone 3–5 pasos concretos (solo recibe el
título y la empresa, nunca las notas), se guardan como **subtareas** de esa
tarea (las mismas que se ven en /tasks) y el bot dice solo el primero:
`Empieza por: …`. `siguiente paso` marca ese como hecho y dice el que sigue;
al terminar el último, propone cerrar la tarea. Si ya estaba dividida,
repite los pasos pendientes sin volver a pedirlos al modelo.

**Prueba obligatoria**: el mensaje de voz de Gabby con su semana, tal cual
lo dicte ella (el del 1 nov: "mañana los correos de Chelsea y los míos en
el asistente, eso es prioridad; el miércoles armar el equipo de marketing,
el zip, y cancelar Jobescape; el jueves pasar 500 de IM a WSH"). Debe salir
el plan por día de arriba, con «Marketing Team» marcada como existente si
esa tarea está abierta, y nada duplicado en /tasks después de **Así queda**.

### 7b. Lo que hay que hacer a mano

1. Supabase → SQL Editor → `sql/2026-11-asistente-fase7.sql` en una query.
   Abajo: las columnas de `bot_conversacion` y `asistente_config`, y la fila
   de config con los defaults.
2. Push → redeploy. Sin env vars nuevas.
3. GabbyHQ → Settings → **Asistente**: pon tu nombre y el del bot, elige el
   tono y si quieres sugerencias. Guardar.

### 7c. Env vars que agrega esta fase

Ninguna.

### 7d. Cómo probar que funciona

1. `IM llamar a Juan` → `✅ IM · … «llamar a Juan»` y debajo `¿Para cuándo?`
   con 4 botones; toca **Mañana** → `✏️ … → vence …`. Luego `cambia la hora a
   las 4` → le pone 4:00 pm a esa misma tarea (memoria).
2. `listo 1` → `✅ Hecha 👏 …` y `👏 Te quedan N de IM. ¿Seguimos con «…»?`;
   toca **Luego**. Cierra otra con `listo 2`: ya no pregunta.
3. `¿qué tengo hoy?` con 3+ vencidas de una empresa → la respuesta y debajo
   `Ojo: …` con [Esta semana] [Cancelar] [Déjala].
4. `organízame` → la intro y el primer ítem con 6 botones; responde varios;
   `para` → el resumen. Vuelve a entrar y termina → `¿Te mando la lista?`.
5. `olvida lo anterior` → "Listo, empezamos de cero." Luego `sí` solo →
   el bot pregunta qué es (no tiene a qué responder).
6. Settings → Asistente → cambia tu nombre a "Gabriela" y el tono a formal
   → `¿qué tengo hoy?` te trata de usted y te llama Gabriela. Pon
   "Solo obedece" → `IM llamar a Pedro` ya no pregunta `¿Para cuándo?`.
7. Prueba manual de la alarma de la mañana (§ 1d) → empieza con la línea
   de saludo. La de la tarde un día sin cerrar nada → `Día difícil…` con
   [Sí] [Elijo].
8. Settings → Asistente muestra el costo del mes con los turnos de estas
   pruebas.
9. **La semana por voz** (obligatoria): el audio de Gabby con su semana →
   plan por día con [Así queda] [Corrijo]; después `la de marketing a las
   10` → le pone la hora a esa tarea; `lo de WSH ponlo en calendar` → el
   evento. En /tasks no hay duplicados.
9b. Con «revisar propuesta de TOTT» abierta y vencida, el mismo audio de la
    semana: TOTT **no** aparece en el plan ni cambia de fecha en /tasks.
    Luego `acomoda el resto` → ahí sí propone moverla.
9c. **Correcciones** (ajuste 7-G, con el plan de 9 esperando): `quita el
    marketing repetido` → "Corregido: ✂️ Quito «…»" y "Lo demás queda
    igual" con los botones otra vez; en /tasks nada cambió. `la de marketing
    a las 10` → solo esa línea con `⏰ 10:00 am`. `déjala donde estaba` →
    pregunta cuál si hay varias movidas. `borra lo de Jobescape` → tres
    botones, nunca borra directo. `olvídalo` → "descarté el plan". Un
    mensaje con "cancelar la suscripción de Job Escape" (como lo
    transcribe Whisper) no marca «Cancelar Jobescape» como "no la
    nombraste".
10. `me da flojera armar el equipo de marketing` → 3–5 pasos y "Empieza
    por: …"; en /tasks la tarea tiene esas subtareas. `siguiente paso` →
    marca el primero y dice el segundo.

### 7e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| "sí" / "la segunda" no funcionan | La tabla `bot_conversacion` no existe (el bot sigue, sin memoria) | Logs: `[conversacion] insert: relation … does not exist`. Correr el SQL. |
| No propone nada | Settings → Asistente en "Solo obedece", o ya dijo "Luego" hoy | Cambia el ajuste; `select * from bot_conversacion where acciones->'declinado' is not null`. |
| Organízame se corta a la mitad | Pasaron 30 min, o llegó otro mensaje que creó un borrador | Vuelve a decir `organízame`; retoma desde los que faltan. |
| La mañana no trae la línea de saludo | El modelo falló o tardó >8 s: sale la fija | Logs: `[alarma-manana] línea del día:`. Nada que hacer. |
| El costo del mes dice "no disponible" | `bot_preguntas` no existe | SQL de la fase 3. |

---

## 9. Fase 9 — Tablero por horizonte (nueva pantalla /hoy)

**Motivo.** La matriz de Eisenhower sirve para *pensar*; para *ejecutar*
hace falta ver de un vistazo qué es de hoy, qué es de mañana y qué puede
esperar, como un pipeline. El tablero pasa a ser la pantalla de entrada
(`/` redirige a `/hoy`); la matriz queda como pestaña **Prioridad** y los
bloques por empresa con sus notas como pestaña **Empresas**. Nada de lo
anterior se quitó: cambió la primera pantalla.

### 9a. Qué hace

**A) Seis columnas, de izquierda a derecha.** Cada una con contador y
scroll propio; se ven 8 tarjetas y luego "ver N más".

| Columna | Qué cae ahí |
| --- | --- |
| 🔥 Hoy sí o sí | `due_date` = hoy, vencidas, y lo marcado **urgente** sin fecha |
| 📅 Mañana | `due_date` = mañana |
| 🗓 Esta semana | `due_date` de pasado mañana al domingo |
| ⏳ Esperando | tareas con `estado = 'esperando'` (con "de quién"), **todas las tareas de la empresa Chelsea** y los correos marcados "Para Chelsea" (como tarjetas de correo) |
| 📦 Después | sin fecha, o más allá del domingo, o "cuando pueda" sin fecha |
| 📧 Correos | pendientes (`nuevo`) de las cuentas activas que son **alta** o **necesita respuesta / pedido de tarea**, con sus 4 botones (📨 Chelsea · 🙋 Lo hago yo · ➕ Tarea · 🗄 Archivar) |

La regla vive en UN solo lugar, `src/lib/horizonte.ts`
(`horizonteDe(tarea, hoy, chelseaId)`), y la usan el tablero, la alarma de
las 8 y el cierre, así que nunca se contradicen. Se evalúa en orden y gana
la primera: esperando (o Chelsea) → hoy → mañana → esta semana → después.
Una tarea en "esperando" **no** entra en 🔥 ni en "¿qué sigue?" aunque
tenga fecha vencida: está en manos de alguien más.

**B) Tarjeta.** Título en una línea (el tooltip trae el texto completo, la
primera línea de las notas y la edad) · badge de empresa · hora si tiene ·
★ si es importante · color de edad: **gris** a partir de 14 días desde que
se creó, **rojo** (borde y título) a partir de 30, con los días a la
derecha. En 🔥 las vencidas dicen "vencida 1 nov"; en ⏳ dice "⏳ Andrew
(TOTT)" (o "Chelsea" si es de esa empresa, o "¿de quién?" si no se dijo).
Click → el **panel de edición que ya existe** (la tarjeta de /tasks,
abierta directo en el formulario) sobre un fondo oscuro; ✕ o click fuera
lo cierra. Checkbox a la izquierda para completar (hace lo mismo que
`listo 3`: `done = true` y el evento de Calendar se va).

**C) Arrastrar.** Drag & drop nativo del navegador (HTML5, sin librería),
con el botón **⋯ Mover a…** en cada tarjeta como alternativa (es lo que se
usa en el teléfono, donde no hay drag). Al soltar:

| Suelto en | Qué cambia en la tarea |
| --- | --- |
| 🔥 Hoy | `due_date` = hoy, `estado` vuelve a `abierta` |
| 📅 Mañana | `due_date` = mañana, `abierta` |
| 🗓 Esta semana | `due_date` = **viernes** si hoy es domingo–jueves, si no el **lunes siguiente** (el encabezado de la columna dice a qué día cae); `abierta` |
| ⏳ Esperando | `estado = 'esperando'` y pregunta **"¿de quién?"** en un input chico arriba de la columna (OK vacío = sin nombre; ✕ cancela el movimiento). La fecha se conserva |
| 📦 Después | quita `due_date` (y la hora), `abierta` |
| un **correo** en 🔥 / 📅 | ejecuta **"Lo hago yo"** (mismo código que el botón: estado `lo_hago_yo` + tarea con `Ref: gmail:…`, nunca duplicada) y a esa tarea le pone esa fecha |
| un **correo** en ⏳ | ejecuta **"Para Chelsea"** |

Un correo no puede ir a Esta semana / Después, y nada se puede soltar en 📧.
**Todo pasa por el servidor**: `POST /api/hoy` (protegido por la sesión de
la app) llama a las **mismas funciones que usa el bot** — `moverTarea`
(`src/lib/asistente/esperando.ts`), `ejecutarAccion({accion:'listo'})`,
`decidirCorreo` — y la lectura es `GET /api/hoy` (tareas abiertas con
empresa y subtareas, empresas, notas, radar, correos pendientes de las
cuentas activas, cuentas). El tablero no escribe en Supabase desde el
navegador. (El panel de edición y las pestañas Prioridad / Empresas siguen
escribiendo como antes, con el cliente anon.)

**D) Estado "esperando" — modelo y bot.** Dos columnas nuevas en `tasks`:
`estado text not null default 'abierta'` (`abierta` | `esperando`, con
check) y `esperando_a text null`. El bot:

| Le dices | Qué hace |
| --- | --- |
| `la de TOTT está esperando a Andrew` · `la 3 esperando a Juan` · `lo de paypal queda esperando por el banco` | `estado = esperando`, `esperando_a = "Andrew"`. Sale de 🔥 y de "¿qué sigue?". Por número de la última lista o por palabra del título (con botones si hay varias) |
| `la de TOTT ya no espera` · `la 3 ya no está esperando` · `paypal vuelve a mí` | vuelve a `abierta` (la fecha no se toca) |
| `qué tengo esperando` · `¿qué tengo esperando?` · `en espera` | la lista **⏳ Esperando (N)** numerada y registrada: después `listo 2` o `la 2 ya no espera` funcionan |

Las formas exactas las lee el parser clásico sin modelo; cualquier otra
forma ("esa está en manos del cliente", "ya respondió Andrew, retomo la de
TOTT") la entiende el intérprete con las acciones nuevas `esperar`
(`ref`, `quien`, `fin`) y `esperando`. En el contexto del intérprete y de
`/pregunta` cada tarea que espera va marcada "⏳ esperando a X", y
`/pregunta` las lista aparte ("Esperando a alguien (N)"). También quedan
fuera de **organízame**, de "¿seguimos con…?" y de "ojo: vencidas".
Completarlas (`listo`) o moverlas de fecha (`pasa … al lunes`) sigue
funcionando igual; mover la fecha **no** las saca de esperando (solo
soltarlas en otra columna o decir "ya no espera").

**E) Arriba del tablero.** Chips por empresa (como en /tasks; filtran
tareas **y** correos — un correo es de la empresa de su cuenta, Settings →
Correo) · botón **🎯 ¿Qué sigue?** (la tarjeta de siempre) · toggle
**Tablero | Prioridad | Empresas**, recordado en `localStorage`
(`hoy.vista`). Las notas "por dónde iba" son una **franja plegable**: una
línea por empresa (nombre + primera línea de la nota, morada si es de ≤ 3
días, gris con la edad si no); click en la línea despliega la nota completa
**editable** (el mismo editor de los bloques; guardar al salir, Esc
cancela, archivar si es vieja). En Prioridad, click en una nota de C1 salta
a Empresas y abre ese bloque, como antes.

**F) Alarma de las 8 y cierre de las 6.** Reflejan el tablero. Secciones
en este orden, numeradas de corrido (así `listo 4`, `pasa 2,5`, "el 7 ya
no espera" funcionan sobre ellas):

```
☀️ Hoy, martes 4 nov
Buenos días, Gabby. … (la línea del día, como en la fase 7)

📝 Por dónde ibas                     ← solo notas de ≤ 3 días, una línea cada una
📝 IM: vamos por la propuesta 2

🔥 Hoy sí o sí (3)
🔺 1. paypal statements · IM · hace 3 días
🔸 2. llamar a Juan · PD · 3:00 pm 📅
✴️ 3. propuesta TOTT · IM · urgente ★
· +N más en GabbyHQ                   ← a partir de 15

📅 Mañana (2)                         ← solo títulos (y empresa / hora)
▫️ 4. correos de Chelsea · IM
▫️ 5. revisar pagos · PD · 10:00 am

⏳ Esperando (2)
⏳ 6. landing TOTT · IM · Andrew (TOTT)
⏳ 7. whatsapp chelito · Chelsea

📧 IM Chelsea (3)                     ← igual que antes (ajuste 6c)
📧 8. ✴️ Andrew (TOTT) · Landing page changes · hace 3h
…

Total: 14 tareas abiertas (4 esta semana · 3 después, en la app) · abrir GabbyHQ
```

"Esta semana" y "Después" **no van** en la alarma (están en la app); solo
viajan sus contadores en la última línea. Las secciones 📅 y ⏳ se omiten
si están vacías; 🔥 siempre sale ("— nada vencido ni urgente 🎉"). Topes:
15 en 🔥, 10 en 📅, 10 en ⏳. Dentro de 🔥 el orden es el del tablero:
vencidas (más vieja primero) → vence hoy (por hora) → urgente sin fecha.
La línea del saludo cuenta solo lo propio (ni Chelsea ni esperando).

El **cierre de las 6** es igual, con **✅ Hecho hoy** arriba: balance,
✅ Hecho hoy (por empresa, sin numerar), 🔥 Hoy sí o sí (lo de hoy que
**sigue abierto** — eso es lo que pregunta "¿Qué pasa a mañana?"), 📅
Mañana, ⏳ Esperando, 📧 Correos, totales, y el pie `pasa 2,5` / `pasa
todo`. La sección "❌ Vencidas hoy sin cerrar" desapareció: es exactamente
🔥. La sugerencia de "día difícil" (fase 7-E) sigue igual. `/pendientes IM`
no cambia (sigue siendo la lista completa de una empresa).

**G) Móvil.** Las columnas van en un **carrusel horizontal con snap**
(cada columna ocupa ~82 % del ancho; se desliza de una en una), 🔥 primero.
En tablet, 3 columnas por fila; en pantallas anchas (≥ 1536 px) las 6 en
una fila, más ancho que el resto de la página.

**H) Franja de KPIs (9b).** Debajo de los chips, cuatro números grandes:
🔥 Hoy sí o sí · 🔺 Vencidas · ⏳ Esperando · 📧 Correos. Se calculan con
la misma regla de columnas (`horizonteDe` / `columnaCorreo`) sobre lo que
el chip de empresa deja pasar, así que coinciden siempre con los
contadores de las columnas: "Vencidas" es la parte de 🔥 con fecha
pasada; "Esperando" suma tareas y correos "Para Chelsea"; "Correos" es la
columna 📧. Click en un KPI pasa a la vista Tablero, hace scroll a esa
columna y la resalta un momento (Vencidas → 🔥).

**I) Vista Calendario (9b).** Cuarta pestaña del toggle (Tablero |
Prioridad | Empresas | Calendario), con sub-toggle **Semana | Mes**
recordado en `localStorage` (`hoy.calendario`) junto a la vista
(`hoy.vista`). Flechas ‹ › y "hoy" para moverse.

| | Semana | Mes |
| --- | --- | --- |
| Forma | 7 columnas lun–dom, hoy resaltado en morado; en el teléfono se deslizan de lado | cuadrícula lun–dom; los días de otro mes atenuados |
| Tarea | en su `due_date`: hora si tiene `due_time`, título, ★, badge de empresa; vencidas con borde rojo | hasta **3 chips por día** (una línea cada uno) y "+N"; **click en el día abre un panel lateral** con la lista completa de ese día (también acepta soltar) |
| Esperando | en su fecha, con ⏳ y atenuada | igual |
| Completadas | no salen | no salen |

Arriba, la franja **📦 Sin fecha · N** plegada con el contador; al abrirla
lista las tareas sin fecha para arrastrarlas a su día. **Arrastrar una
tarea a otro día cambia `due_date` y conserva `due_time`**: va por
`POST /api/hoy` con `accion: 'fecha'`, que ejecuta el mismo "editar" del
bot (`paypal para el viernes`), con su sincronización de Calendar. En el
teléfono, ⋯ en el chip abre un **selector de fecha** nativo. Click en un
chip abre el panel de edición.

Los **pagos recurrentes** (`pagos_recurrentes`, Settings → Pagos
recurrentes) se pintan en su día como chip `💳 [IM] Vercel $20`, verde,
punteado y **no arrastrable** (el día del pago se cambia en Settings; en
meses cortos el día 31 cae en el último día, como en Calendar). Los chips
respetan el chip de empresa. **Los eventos de Google Calendar NO se leen**:
Calendar sigue siendo solo a pedido (regla de la fase 5).

**J) Tareas sin empresa (9b).** Las tareas que llegan de un correo de una
cuenta sin empresa, o del botón de inbox-IM, nacen sin empresa. En el
panel de edición el selector **Empresa** ya era editable; en el tablero y
el calendario la tarjeta muestra un badge gris **"sin empresa"** que, al
click, se convierte en el selector directo (`POST /api/hoy` con
`accion: 'empresa'`, el mismo "editar" del bot). En el bot: `la 5 es de PD`
/ `el 3 es de IM` → el parser clásico lo lee como edición **por número de la
última lista** (antes buscaba "la 5" en los títulos y, sin modelo, creaba
una tarea "la 5 es de"); `quickbooks es de PD` / `la de quickbooks es de PD`
por palabra del título; cualquier otra forma la entiende el intérprete con
`cambiar` + `empresa`, que ya existía.

**K) Franja "Por dónde iba" — regla (9b).** En producción la franja mostró 3
notas y luego 2 sin que se editara ninguna. La franja ahora se construye
**desde las notas** (`notas_empresa`, toda fila con texto), no desde las
empresas: una nota cuya empresa ya no existe sale como "(empresa
borrada)" en vez de desaparecer, y **ningún** filtro de edad, vista o
refetch la oculta; solo un chip de empresa activo la reduce a esa empresa.
Si una nota deja de aparecer, es que la fila ya no está (o quedó vacía):
las notas reemplazadas o archivadas viven en `notas_historial`
(`select company_id, nota, escrita_en, archivada_en from notas_historial
order by archivada_en desc limit 10`); las formas de archivar son el
botón **archivar** (notas de > 3 días, en la franja abierta y en
Empresas), la sugerencia del bot "¿La archivo?" (notas de ≥ 20 días, fase
7-B) y `nota PD:` sin texto (borra) o `nota PD: …` (reemplaza) desde el bot.

### 9b. Lo que hay que hacer a mano

1. **Antes del deploy**: Supabase → SQL Editor →
   `sql/2026-11-asistente-fase9-tablero.sql` en una query. Abajo deben
   salir las dos columnas (`estado` default `'abierta'`, `esperando_a`
   nullable) y `esperando = 0`. El bot y el tablero leen esas columnas
   (`select … estado, esperando_a`): sin el SQL, las listas del bot y
   `GET /api/hoy` fallan con "column tasks.estado does not exist".
2. Push → redeploy. Sin env vars nuevas.
3. Abre GabbyHQ: `/` te lleva a `/hoy` con el tablero. Si prefieres la
   matriz como entrada, toca **Prioridad** una vez: se recuerda.

### 9c. Env vars que agrega esta fase

Ninguna.

### 9d. Cómo probar que funciona

1. **Arrastrar "Voice Calls precios" de 🔥 Hoy a 📦 Después.** La tarjeta
   desaparece de 🔥 y aparece en 📦 sin fecha; arriba sale la línea verde
   "📦 «Voice Calls precios» … → Después (sin fecha)". En /tasks la tarea
   ya no tiene fecha. Si tenía evento en Calendar, el evento se borra
   (una fecha vacía = sin evento, como en la fase 5-D).
2. **Un correo de Hope a 🔥 Hoy.** La tarjeta de correo sale de 📧, el
   correo queda `lo_hago_yo` en /correo, y en 🔥 aparece una tarea nueva
   con el asunto del correo, `due_date` = hoy y el `Ref: gmail:…` en sus
   notas (ábrela con click para verlo). Si vuelves a arrastrar otro correo
   del mismo hilo no se duplica la tarea (misma Ref).
3. **A ⏳ Esperando.** Arrastra una tarea: aparece el input "¿de quién?";
   escribe `Andrew (TOTT)` y OK. La tarjeta muestra "⏳ Andrew (TOTT)".
   Pide `¿qué sigue?` al bot: esa tarea **no** sale. Di `qué tengo
   esperando`: sale numerada. Di `la 1 ya no espera`: vuelve a su columna
   por fecha.
4. **Desde el bot**: `la de TOTT está esperando a Andrew` → "⏳ «…» queda
   esperando a Andrew". Recarga /hoy: está en ⏳.
5. **Alarma**: `curl -H "Authorization: Bearer $CRON_SECRET"
   "$APP_URL/api/asistente/manana?test=1"` (como en 1d). Debe llegar con
   las secciones 🔥 → 📅 → ⏳ → 📧 y los números de corrido; `listo 4`
   cierra la cuarta línea sea de la sección que sea. `cierre` por el bot:
   ✅ Hecho hoy arriba, luego lo mismo.
6. **Móvil**: en el teléfono, /hoy desliza de columna en columna; en cada
   tarjeta ⋯ → "Mover a…" lista los destinos con la fecha a la que caen.
7. **Vista recordada**: toca Prioridad, recarga: sigue en Prioridad.
8. **(9b) Calendario → Semana**: arrastra **"Marketing Team"** al jueves.
   El chip cambia de columna, conserva su hora si tenía, arriba sale
   "✏️ «Marketing Team» … → vence jue …", y en /tasks la fecha es el
   jueves. En Mes, click en ese jueves abre el panel con la tarea.
9. **(9b) Badge "sin empresa"**: en el tablero, en la tarjeta **"Your
   QuickBooks Line of Credit"** toca el badge gris "sin empresa", elige
   **PD**. La tarjeta muestra el badge de PD; el chip PD la filtra. Desde
   el bot, `la 5 es de PD` (número de la última lista) hace lo mismo.
10. **(9b) KPIs**: con el chip IM, los cuatro números son solo de IM; click
    en 🔺 Vencidas lleva a la columna 🔥 resaltada.
11. **(9b) Pagos**: con un pago recurrente del día 15, en Calendario → Mes
    ese día muestra `💳 [IM] Vercel …`; no se puede arrastrar.
12. **(9c) La foto**: dile al bot `mándame el tablero` (o toca 🖥 Tablero
    en el menú). Llega una imagen con la franja de KPIs y las cuatro columnas
    (Hoy sí o sí · Mañana · Esperando · Correos), 6 tarjetas por columna con
    badge de empresa y ★, "ver N más" al pie, y debajo el botón
    **🖥 Abrir tablero** que lleva a /hoy. La misma foto llega sola antes
    del texto de la alarma de las 8 y del cierre (`?test=1` como en 1d).
13. **(9c) Por voz**: manda un audio diciendo «¿cómo va IM?». Responde
    «🎤 Entendí: …» y un párrafo con las abiertas, vencidas, esperando,
    correos pendientes y la nota "por dónde iba" de IM, luego la lista corta
    numerada de lo urgente de IM y una propuesta («¿Seguimos con …?»). Sin
    pasar por el modelo (el parser lo reconoce); `la 1 lista` cierra la
    primera línea.
14. **(9c) Chat web**: en /hoy toca 💬 (abajo a la derecha) y escribe
    «pásame Marketing Team al viernes». Contesta igual que en Telegram
    («➡️ «Marketing Team» → vence vie …») y la tarjeta se mueve sola de
    columna sin recargar. Prueba también «¿qué tengo estancado?»: aparece el
    plan con [✅ Hacer todo] [✏️ No, corrijo] como botones del panel; al
    confirmar, las tarjetas pasan a 📦 Después. Abre Telegram: la misma
    conversación sigue ahí (es un solo hilo).

### 9e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| /hoy dice "No se pudo cargar: … column tasks.estado does not exist" (o la alarma de las 8 falla con eso) | Falta el SQL 9 | Correr `sql/2026-11-asistente-fase9-tablero.sql`. |
| Soltar no hace nada en el teléfono | El drag nativo no existe en touch | Usa ⋯ → Mover a… en la tarjeta (es lo esperado). |
| Una tarjeta soltada en ⏳ no se mueve | El input "¿de quién?" quedó esperando (OK o ✕) | Contesta el input; ✕ cancela el movimiento. |
| Un correo arrastrado dice "Un correo solo puede ir a Hoy, Mañana … o Esperando" | Se soltó en Esta semana / Después | Es a propósito: decide primero (Lo hago yo) y luego mueve la tarea. |
| La tarea de un correo no sale en 🔥 | La cuenta no tiene empresa y el chip filtra por empresa | Chip "Todas" (o "Sin empresa"). |
| Una tarea vencida no aparece en 🔥 | Está en esperando (⏳) o es de la empresa Chelsea | Es la regla; "la 3 ya no espera" la regresa. |
| El tablero no cambia después de arrastrar | `POST /api/hoy` devolvió error (línea roja arriba del tablero) | Logs de Vercel: `[hoy] POST mover: …`. |
| Una nota desapareció de la franja | La fila ya no está en `notas_empresa` (archivada, reemplazada o borrada desde el bot) o hay un chip de empresa activo | Chip "Todas"; `notas_historial` conserva el texto (ver 9a-K). |
| En Calendario no sale ningún pago | `pagos_recurrentes` vacía o todos inactivos, o la tabla no existe (SQL 5c) | Settings → Pagos recurrentes; logs `[hoy] pagos: …`. |
| Al arrastrar a un día la hora se perdió | No debería: `accion: 'fecha'` solo toca `due_date` | Si pasa, logs `[hoy] POST fecha: …` y /tasks → la tarea. |

---

## 9c. Fase 9c — El asistente habla: menú, foto del tablero, narración, preguntas y chat en /hoy

**Principio.** El bot contesta como una asistente que **narra y propone**,
no como un listado. Los números de las tareas se conservan solo como apoyo
para referirse a ellas («la 3 lista»), nunca como la forma principal de
usarlo. Español neutro, nunca voseo. Nada de lo anterior se quitó: los
comandos exactos y las listas completas siguen igual; cambió la primera
respuesta.

### 9c-a. Qué hace

**A) Menú fijo (reply keyboard).** Dos filas bajo el teclado de Telegram,
siempre visibles:

```
[📋 Hoy] [📅 Mañana] [⏳ Esperando]
[📧 Correos] [🎯 ¿Qué sigue?] [🖥 Tablero]
```

Cada botón **es una pregunta en lenguaje natural**: Telegram manda el texto
del botón como un mensaje normal y el parser lo cambia por su frase
(`src/lib/asistente/menu.ts`: 📋 Hoy → «¿qué tengo hoy?», 📅 Mañana →
«¿qué tengo mañana?», ⏳ Esperando → «¿qué tengo esperando?», 📧 Correos →
«correos», 🎯 → «¿qué sigue?», 🖥 Tablero → «mándame el tablero»). Tocar el
botón y escribir la pregunta hacen exactamente lo mismo. Se instala con el
**primer mensaje** de una conversación (no hay turnos en los últimos 30
min: la respuesta lleva el teclado), con `/menu` (también «menú», «dame el
menú»), con `/start` y bajo el texto de **cada alarma de las 8 y cierre**,
así nunca se pierde. `/ocultar` («quita el menú») lo quita. Un teclado de
respuesta no puede ir en el mismo mensaje que botones inline, por eso viaja
en la primera respuesta sin botones de la petición (`canal.ts`:
`pedirMenu()` → `sendTelegram` lo adjunta).

**B) Foto del tablero.** `src/lib/asistente/tablero-imagen.tsx` dibuja
con `next/og` (Satori + resvg, viene con Next 14; es el mismo motor que
`@vercel/og`, sin paquete aparte) una imagen de 1200×760: título y fecha,
la **franja de KPIs** (Hoy sí o sí · Vencidas · Esperando · Correos) y
**cuatro columnas** (Hoy sí o sí · Mañana · Esperando · Correos) con hasta
**6 tarjetas** cada una — título, badge de empresa con su color (o «sin
empresa»), ★ si es importante y a la derecha «vencida 1 nov», la hora o
«de quién» — y «ver N más» al pie. El modelo (qué va en cada columna) es
`tablero-datos.ts` y usa **la misma regla** del tablero web y las listas
(`horizonteDe` / `columnaCorreo`), así que nunca se contradicen. Sin emojis
dentro de la imagen a propósito: Satori los baja de un CDN al renderizar y
la foto no debe depender de eso (★ es un SVG). **Nunca** van datos de env
vars ni correos completos: una tarjeta de correo es el nombre corto del
remitente y el asunto, nada más.

Cómo llega:

| Cuándo | Qué pasa |
| --- | --- |
| Alarma de las 8 y cierre de las 6 | `ejecutarAlarma` manda la foto con `sendPhoto` **antes** del texto, con el botón inline **🖥 Abrir tablero** → `APP_URL/hoy`. Es *best effort*: si la imagen falla queda una línea en el log (`[alarma-manana] foto del tablero: …`) y el texto sale igual; la foto nunca bloquea la alarma ni cuenta para el reintento |
| «mándame el tablero» · «foto del tablero» · «cómo se ve el tablero» · 🖥 Tablero | el parser (sin modelo) o el intérprete (acción `tablero`) la mandan a demanda; si falla, lo dice y da el link a /hoy |
| `GET /api/asistente/tablero.png` | la misma imagen como PNG, para verla o probarla. Tres puertas: `Authorization: Bearer $CRON_SECRET` (como las alarmas), la sesión de la app (abrirla en el navegador logueada) o `?firma=<HMAC-SHA256(CRON_SECRET, "tablero:YYYY-MM-DD")>` (32 hex) para un link del día sin exponer el secreto |

Los bytes se **suben** a Telegram (multipart), no se le da una URL: funciona
igual en previews y no depende de que Telegram alcance la app. En el chat
web la foto viaja como `data:image/png` dentro del mensaje.

**C) Alarmas narradas — en líneas (ajuste 9c-2).** La alarma de las 8
abre con un **resumen en líneas**, nunca un párrafo, y debajo va la lista
numerada por secciones como hasta ahora (fase 9). Formato fijo, armado en
código (`narracion.ts`: `resumenMananaFijo` / `resumenTardeFijo`):

- saludo en una línea;
- **una línea por horizonte**: símbolo + conteo + a lo sumo UN dato corto
  entre paréntesis — 🔺 vencidas (cuántos días lleva la más vieja) ·
  🔸 para hoy (la hora de la primera) · ✴️ urgentes sin fecha · 📅 mañana ·
  ⏳ esperando (a quién) · 📧 correos que piden respuesta (cuántos
  urgentes). Las líneas con 0 se omiten;
- última línea 👉 con **una sola recomendación**, por **nombre corto**
  (las dos o tres primeras palabras del título: «Shift Google Ads»), nunca
  un título o asunto entre comillas;
- nada de títulos ni asuntos en el resumen: eso vive en la lista de abajo;
- máximo 8 líneas antes de la lista.

El modelo solo **pule el fraseo** de cada línea (`pulir`: mismas líneas,
mismo orden, mismo emoji inicial y mismos números, sin comillas; 8 s de tope
y si no cumple, van las fijas). El cierre de las 6 igual: «Cerraste N de M
hoy 👏» (o «Hoy no se cerró nada»), las líneas de lo que queda y un 👉 con
qué pasar a mañana.

```
☀️ Hoy, miércoles 4 nov
Buenos días, Gabby.
🔺 2 vencidas (la de Shift Google Ads lleva 9 días)
🔸 4 para hoy, la primera a las 9 am
✴️ 3 urgentes sin fecha
📅 Mañana: 1
⏳ Chelsea onboarding sigue esperando a PTHO
📧 9 correos piden respuesta (2 urgentes)
👉 Empieza por Shift Google Ads.

📝 Por dónde ibas
…
🔥 Hoy sí o sí (9)
🔺 1. Shift Google Ads campaign review · IM · hace 9 días
…
```

**D) Preguntas en lenguaje natural, con respuesta narrada.** Sin comandos
nuevos: es la intención `pregunta` ampliada. `preguntas.ts` reconoce las
formas (con o sin «¿…?», sin modelo) y `narracion.ts` contesta en prosa +
lista corta numerada (registrada en `bot_alarmas` como `lista`, así «la 3
lista» funciona sobre ella) + **siempre una propuesta de siguiente acción**.
Si la pregunta llega por el intérprete (otra forma de decirlo), la acción
`pregunta` pasa primero por aquí; lo que no es ninguna de estas sigue
yendo al modelo (`/pregunta` de la fase 3, «¿qué cerré ayer?»).

Todas contestan con el **mismo formato en líneas** del punto C (resumen ≤ 8
líneas con 👉 al final, sin títulos ni comillas) y debajo la lista numerada:

| Pregunta | Líneas del resumen | Lista de abajo · 👉 |
| --- | --- | --- |
| «¿qué tengo hoy?» · «qué hay hoy» · «cómo viene el día» · 📋 Hoy | 🔺 vencidas · 🔸 para hoy · ✴️ urgentes · 📧 correos | 🔥 Hoy sí o sí (≤ 8) · «👉 Empieza por Shift Google Ads.» |
| «¿qué me queda pendiente?» · «qué tengo» · «qué me falta» | total abierto + las seis líneas del día | igual |
| «¿qué tengo mañana?» · 📅 Mañana | 📅 mañana (la primera a las…) · 🗓 resto de la semana | 📅 Mañana · «👉 Si algo de hoy no sale, dime «pasa … a mañana»» |
| «¿qué tengo estancado?» · «qué se me quedó atorado» · «qué está parado» | 📦 sin moverse en 14+ días y sin fecha futura (`tasks.updated_at`, SQL 9c; antes, `created_at`) · ⏳ 3+ días esperando | 📦 y ⏳ numeradas · «👉 ¿Las paso a Después, las cancelo o les pongo alarma?» + **plan** a 📦 Después con [✅ Hacer todo] [✏️ No, corrijo], corregible («cancela la 2», «la 3 déjala», «olvídalo») |
| «¿cómo va IM?» · «cómo vamos con PD» · «qué tal DATAVIA» (cualquier empresa) | «IM: N tareas abiertas» + las líneas de esa empresa + 📧 de sus cuentas + 📝 por dónde ibas (≤ 90 caracteres) | 🔥 de la empresa (≤ 6) · «👉 Sigue con …» o «todo lo pendiente de IM» |
| «¿qué tengo esperando?» · «a quién estoy esperando» · ⏳ Esperando | ⏳ una línea por persona (cuántas, la más vieja) · 📧 con Chelsea | ⏳ numerada con días · «👉 Si X ya respondió, «la 1 ya no espera»» |
| «¿qué hay esta semana?» · «cómo viene la semana» | 🗓 con fecha (el día más cargado) · 🔺 de antes · ⏳ | por día, lunes a domingo («pasó» los anteriores) · «👉 pasa 3 al viernes» |

Dos acciones nuevas del intérprete acompañan esto: `tablero` («mándame el
tablero») y `despues` («deja X para después», «quítale la fecha a X» →
📦 Después, sin fecha; es lo que ejecuta el plan de las estancadas).

**E) Chat 💬 en /hoy.** Botón flotante abajo a la derecha; abre un panel
lateral (toda la pantalla en el teléfono) que recuerda si estaba abierto
(`localStorage` `hoy.chat`). Usa **exactamente el mismo motor** que
Telegram: `src/lib/asistente/motor.ts` (el código del webhook, movido a una
librería) con el mismo parser, intérprete, memoria (`bot_conversacion`),
borradores y confirmación de planes. El truco es el **canal**
(`src/lib/asistente/canal.ts`, un `AsyncLocalStorage`): `POST
/api/asistente/chat` envuelve la petición en el canal `web`, y `sendTelegram`
—en vez de llamar a Telegram— **recoge** cada mensaje (texto, si es HTML,
sus botones inline y la foto si la hay) y la ruta los devuelve como JSON. Un
botón del panel manda su `callback_data` como `boton` y pasa por
`procesarBoton`, el mismo código que un tap en Telegram (quitar botones y
«answerCallbackQuery» son no-op en la web). Así «pásame Marketing Team al
viernes», «¿qué tengo estancado?» → plan → [✅ Hacer todo], «borra 3» → [Sí,
borrar] funcionan idénticos. Solo texto; voz no por ahora.

Es **la misma conversación** que Telegram: el chat web habla como el primer
chat de `ALLOWED_CHAT_IDS` (`chatIdWeb()`), así «sí», «la segunda» funcionan
entre los dos y una alarma puesta desde la web suena en Telegram. La columna
`bot_conversacion.canal` (`telegram` | `web`, SQL 9c) dice por dónde entró
cada turno; el panel carga los últimos 40 (`GET /api/asistente/chat`) y marca
«desde Telegram». **Tras cada respuesta el tablero se refresca solo**
(`onChanged` → `GET /api/hoy`), así una acción confirmada mueve la tarjeta
al instante. Las respuestas en HTML de Telegram (`<b>`, `<i>`, `<code>`,
`<s>`, `<a>`) se pintan con esas etiquetas y nada más; el resto va como texto.
Abajo del panel están los mismos seis botones del menú de Telegram.

### 9c-b. Lo que hay que hacer a mano

1. Supabase → SQL Editor → `sql/2026-11-asistente-fase9c.sql` en una
   query. Agrega `bot_conversacion.canal` y `tasks.updated_at` (rellenado
   con `coalesce(completed_at, created_at)`) con su trigger. **Nada rompe
   sin él**: el bot guarda los turnos sin `canal` (lo avisa una vez en el
   log) y usa `created_at` como «último cambio» para «¿qué tengo
   estancado?»; con el SQL la respuesta es exacta.
2. Push → redeploy. Sin env vars nuevas (`APP_URL` ya existía: es a donde
   apunta 🖥 Abrir tablero).
3. En Telegram escribe `/menu` una vez (o espera la alarma de las 8): el
   menú queda fijo.

### 9c-c. Env vars que agrega esta fase

Ninguna.

### 9c-d. Cómo probar que funciona

Los pasos 12, 13 y 14 de [§ 9d](#9d-cómo-probar-que-funciona): recibir la
foto con «mándame el tablero», preguntar «¿cómo va IM?» por voz, y desde el
chat web decir «pásame Marketing Team al viernes» y ver que la tarjeta se
mueve.

### 9c-e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo / qué hacer |
| --- | --- | --- |
| La alarma llega sin foto | `next/og` falló al renderizar (fuente, memoria) o Telegram rechazó el `sendPhoto` | Logs: `[alarma-manana] foto del tablero: …`. El texto llega igual. Prueba `GET /api/asistente/tablero.png` con el `CRON_SECRET` para ver el error completo |
| «mándame el tablero» responde «No pude armar la imagen…» | lo mismo, a demanda | Logs `[bot] tablero: …` |
| El menú no aparece | el primer mensaje de la conversación llevaba botones inline (una pregunta con botones): el teclado no cabe en el mismo mensaje | `/menu`, o espera la siguiente alarma de las 8; o `/ocultar` si lo quitaste |
| Un botón del menú crea una tarea «📋 Hoy» | la app vieja (sin fase 9c) recibió el texto del botón | Redeploy; el parser de 9c cambia el botón por su pregunta |
| «¿qué tengo estancado?» marca como estancadas tareas que acabas de tocar | falta el SQL 9c: sin `updated_at` se usa `created_at` | Correr `sql/2026-11-asistente-fase9c.sql` |
| El panel 💬 dice «Unauthorized» | sesión de la app vencida | Vuelve a entrar en /login |
| El chat web y Telegram no comparten la conversación | `ALLOWED_CHAT_IDS` vacío (el chat web habla como chat 0) | Define `ALLOWED_CHAT_IDS` en Vercel |
| Log `[conversacion] sin columna canal` | falta el SQL 9c | Correr el SQL; mientras, los turnos se guardan igual |
| «correos de X» pregunta «¿Cuál de estas?» con botones | «X» no coincide con ninguna cuenta (o con varias) por nombre, dueña o email | Toca la cuenta o escribe su nombre; revisa los nombres en Settings → Correo (ajuste 9c-1) |
| El bot tomó «eso no son correos» como una orden | La frase no empieza por «no» / «eso no» / «me refería» | Dilo así: «no, me refería a los correos de PD» (ajuste 9c-1, regla 4) |
| El párrafo de las 8 sale «seco» (el texto fijo) | el modelo tardó más de 8 s o devolvió algo que no conserva los títulos | Es el diseño: el fijo es correcto; mira `[narracion] pulir: …` en los logs |

### 9c-f. Ajuste 9c-1 (4 nov 2026) — correos por lenguaje natural y español neutro

**Lo que pasó en producción.** «dame una lista de lo más importante de
correos de Chelsea» → el bot pidió «correos»; «los correos de chelsea, una
lista por favor» → «No tengo una cuenta de correo «chelsea, una lista por
favor»»; luego «IM Chelsea» + «sí» → devolvió **tareas** de la empresa
Chelsea, no correos. El parser solo reconocía cuatro formas fijas de pedir
correos, tomaba todo lo que seguía a «de» como nombre de cuenta, y al no
encontrar la cuenta la conversación cayó en el intérprete, que leyó
«Chelsea» como empresa.

**Reglas (y dónde viven):**

1. **Cualquier frase que mencione correo / correos / mail(s) / email(s) /
   buzón / bandeja / inbox es la intención `correos`**, nunca una lista de
   tareas ni una tarea nueva (`parseCorreos` en `src/lib/parser.ts`, que
   ahora corre **antes** que las listas de tareas). Lo que NO es pedir
   correos y sigue su camino: una decisión sobre un correo («el correo de
   Andrew lo hago yo», «archiva…», «es silencio»), una nota («nota en
   paypal: ya mandé el correo»), una alarma, y una tarea con fecha, hora o
   urgencia delante («mañana revisar correo de Juan», «urgente IM contestar
   el correo de TOTT»). El **nombre de la cuenta** es lo que queda de la
   frase al quitar las palabras del pedido («dame», «una lista», «lo más
   importante», «por favor»…): «chelsea», «im gabby», «pd», o nada (= todas).
   Se resuelve con **coincidencia parcial e insensible a mayúsculas** sobre
   `cuentas_correo.nombre`, la dueña y el email de la conexión
   (`elegirCuentas` / `cuentasPorTexto` en `src/lib/correo/listas.ts`):
   «chelsea» → IM Chelsea; «pd» → PD Gabby; «mi correo de IM» → entre IM
   Chelsea e IM Gabby gana la de la dueña (Settings → Asistente, «Gabby»)
   porque dijo «mi». **Varias coincidencias (o ninguna) → botones** con las
   cuentas (`a:<nonce>:<cuenta_id>`, borrador `cuenta_correo`); si en vez de
   tocar escribe el nombre («IM Chelsea»), también vale. La forma de pedir
   que llega por el intérprete tiene su acción: `correos_lista`
   (`cuenta`, `importante`).
2. **Empresa ≠ buzón.** «Chelsea» en una frase de correos es el **buzón**
   (la cuenta IM Chelsea); en una frase de tareas («pendientes de Chelsea»,
   «qué sigue de Chelsea», «cómo va Chelsea») es la **empresa**. El parser
   decide por la frase, nunca se mezclan, y el prompt del intérprete lo dice
   con todas sus letras.
3. **«lo más importante» / «urgentes» / «qué necesita respuesta»** filtra
   a urgencia **alta** + **necesita respuesta / pedido de tarea**
   (`construirListaCorreos(…, { importante: true })`), y dice cuántos quedan
   fuera. La respuesta es **narrada**: un párrafo en español (cuántos hay,
   cuántos urgen con hasta 3 remitentes y asuntos, cuántos piden respuesta,
   cuántos ya están con Chelsea, el más viejo, por cuál empezar) y debajo la
   lista corta numerada de siempre, cada línea **en el idioma de su cuenta**
   (ajuste 6c) y con el pie «el 3 lo hago yo · el 2 para Chelsea · archiva el
   5». Se registra como lista `correos`, así los números funcionan.
4. **Correcciones de lectura.** «eso no son correos, son tareas», «no, me
   refería a los correos de PD», «no eran tareas, eran los correos de
   Chelsea» son una **corrección del último mensaje del bot**, no una orden
   nueva (`src/lib/asistente/relectura.ts`, leído en `handleText` antes del
   parser). El bot lo reconoce («Tienes razón, lo leí mal: eran correos») y
   **reintenta con la otra lectura** sobre lo que ella dijo antes (los
   últimos turnos del hilo): correos → la cuenta mencionada en esos turnos;
   tareas → la lista de pendientes de la empresa mencionada (o la completa);
   «me refería a …» → eso, como mensaje nuevo. Un «no» solo, «no, quita X»
   o «esa no, la otra» no son relecturas: siguen siendo respuestas al plan o
   a la pregunta pendiente.
5. **Español neutro, siempre.** Regla para todos los textos fijos del bot y
   para la persona del modelo (`personaPrompt`): nunca voseo («tenés»,
   «querés», «vos», «dale» como muletilla) ni regionalismos de España
   («pillé», «vale», «mola», «guay», «tío», «currar», «flipar»), de Argentina
   («che», «re», «bárbaro»), de Chile («bacán», «cachái»), de Colombia
   («chévere», «parcero»), de México («chido», «órale», «padre», «ahorita»,
   «chamba», «platicar», «hueva», «flojera», «neta») ni anglicismos de moda
   («cool», «okay»). Sí valen: «Listo», «Hecho», «Ok», «Ojo», «👏», tuteo.
   Lo que la **usuaria** dice puede ser como sea («me da flojera», «me da
   hueva»): esas palabras aparecen en el parser como entrada, no como
   salida. Revisión de hoy sobre `src/`: solo «No pillé eso» (ahora «No
   entendí bien eso»); el resto estaba limpio. Al agregar un texto nuevo,
   pasar esta lista.

### 9c-g. Ajuste 9c-2 (4 nov 2026) — idioma por cuenta y resumen en líneas

**A) Idioma.** Todo el mensaje de correos sale en el idioma de la cuenta
(`cuentas_correo.idioma`): el resumen, los encabezados (✴️ High · ✉️ Need a
reply), los pies («61 low-priority left out», «To decide: …») y las pistas
de botones. Para IM Chelsea (en) no hay nada en español; para una cuenta en
es, nada en inglés salvo los **asuntos**, que siempre van tal cual llegaron.
Las cadenas viven en `src/lib/correo/idioma.ts` (`textos(idioma)`); los
comandos que el bot lee («el 3 lo hago yo») siguen en español y en inglés
llevan su etiqueta entre paréntesis («(I'll handle it)»). Con «correos» de
todas las cuentas, los encabezados van en español y cada línea en el idioma
de su cuenta, como en 6c.

**B) Resumen en líneas.** El formato del punto C (una línea por horizonte,
👉 al final, ≤ 8 líneas, sin títulos ni comillas) aplica a la alarma de las
8, el cierre, «hoy», «lo importante de <cuenta>», «¿cómo va X?», «¿qué tengo
estancado?» y toda respuesta que traiga lista. Para correos son dos líneas:

```
📧 IM Chelsea · what matters (6)
6 that matter: 5 urgent, 1 needs a reply. 61 low-priority left out.
👉 Start with #1 (TechFin)?
```

(`resumenCorreos` en `src/lib/correo/listas.ts`; en español: «6 que
importan: 5 urgentes, 1 pide respuesta. 61 sin prisa fuera.» / «👉
¿Empezamos por el 1 (TechFin)?»). La recomendación va por el **nombre
corto** del remitente, nunca por el asunto.

**C) Pruebas.** `npm run pruebas` comprueba el mensaje real de «lo
importante de Chelsea» (cuenta en inglés → cero palabras en español en el
texto fijo, los asuntos intactos) y el de «/hoy» (resumen ≤ 8 líneas, una
por horizonte, sin comillas, nombre corto, 👉 al final), además de cada
pregunta narrada.

**Pruebas del parser.** `npm run pruebas` (`scripts/pruebas-parser.mjs`,
sin base de datos, con el loader `scripts/pruebas-loader.mjs`): los cuatro
mensajes de producción de arriba están ahí, más las formas de pedir correos,
lo que no lo es, el menú, el tablero y las preguntas naturales. Falla con
código 1 si algo se rompe.

---

## 12. Fase 12 — Dashboard de vida (pantalla Resumen + menú lateral)

**Idea.** Una sola página que reúne el día: la agenda por hora, las
prioridades, los correos que piden respuesta, las notas "por dónde iba", los
números del tablero y el estado de las conexiones. Es lo que el reel "5
proyectos de Claude" llama *Dashboard de vida*; aquí ya existía casi todo —
el tablero (fase 9), las narraciones (9c), el correo (6), Calendar (5) — y
esta fase lo pone junto en la pantalla de entrada. El bot sigue siendo la
puerta principal; esta pantalla es el vistazo.

### 12a. Qué hace

**A) Menú lateral índigo oscuro con el ítem activo en morado**
(`src/components/Sidebar.tsx`), la paleta del reel de referencia. Fijo a la
izquierda en la compu, cajón bajo una barra del mismo color en el teléfono.
La pantalla Resumen usa la paleta clara de la referencia (fondo gris pálido,
tarjetas blancas, acento morado `#6C5CE7`; `src/components/Fondo.tsx` elige
el fondo por ruta); las demás pantallas conservan el tema oscuro hasta que
se rediseñen. Entradas:

```
🏠 Resumen (/resumen)   🗂 Tablero (/hoy)   📅 Calendario (/calendario)
📧 Correos (/correo)    📝 Notas (/notas)   ⚙️ Settings (/settings)
Más: ☑️ Tasks · 📡 Radar · 🗃 Inbox IM          ↩ Sign out
```

La raíz (`/`) abre **Resumen**. `/hoy` conserva su dirección (las alarmas de
Telegram enlazan ahí) y es la pantalla **Tablero**, con *Prioridad* (la
matriz) y *Empresas* (los bloques con notas) como pestañas; **Calendario**
es la vista de la fase 9b como pantalla propia (`/calendario`). Las dos son
el mismo componente (`src/components/PantallaHoy.tsx`, con `modo`), así que
arrastrar, el panel de edición y el chat 💬 funcionan igual en ambas. Un
valor viejo `hoy.vista = calendario` guardado en el navegador cae al tablero.
El título de la app pasa a «GabbyHQ · Dashboard de vida».

**B) Pantalla Resumen** (`src/app/(app)/resumen/page.tsx`, datos de
`GET /api/resumen` → `src/lib/asistente/resumen.ts`):

- **Cabecera**: «Buenos días / tardes / noches, {nombre_persona} ☀️» + la
  fecha larga, y el botón **📋 Resumen diario**: muestra en un panel el
  MISMO texto de la alarma de las 8 (`buildManana`, sin etiquetas de
  Telegram) con el botón **📲 Enviar a Telegram**, que lo manda al chat como
  lista a demanda (`enviarLista(chatIdWeb(), 'manana')`, tipo `lista`, así
  «la 3 lista» funciona sobre él en Telegram). Ruta `POST /api/resumen/diario`
  (`{}` = ver, `{"enviar": true}` = enviar).
- **Franja de KPIs** (🔥 Hoy sí o sí · 🔺 Vencidas · ⏳ Esperando · 📧
  Correos), con la misma regla de columnas del tablero (`panoramaDe` +
  `columnaCorreo`); cada número enlaza a su columna en `/hoy`.
- **Agenda de hoy** (columna izquierda, orden por hora): tareas con hora de
  hoy (▫️ o ★), pagos recurrentes que caen hoy (💳 a las 9:00, con su
  monto) y los **eventos de hoy del Google Calendar** de la cuenta con
  Calendar activo, **solo lectura** (📆, con enlace al evento). Calendar sigue
  escribiendo solo a pedido (regla de la fase 5): aquí no se crea, mueve ni
  borra nada. Los eventos que la propia app creó (el de una tarea o el de un
  pago, por su `gcal_event_id`; las instancias recurrentes se reconocen por
  el id base antes del `_`) no se repiten. Al final, **Sin hora**: las tareas
  de hoy sin `due_time` y los eventos de todo el día. Si Google no responde
  (sin conexión, token rechazado, caído) la sección simplemente no trae
  eventos y una línea gris lo dice; nunca un error.
- **Prioridades principales** (columna derecha): hasta 5, con checkbox =
  completar (`POST /api/hoy` acción `completar`, lo mismo que «listo»). Es el
  ranking de «¿qué sigue?» (`calcularQueSigue`: Ahora → Después → por
  vencer esta semana), con el porqué en gris (hace 9 días · urgente ★ ·
  vence 05/11).
- **Correos que piden respuesta**: hasta 6 (`correosQueEsperan`: alta,
  necesita respuesta, pedido de tarea), cada uno con los cuatro botones de
  siempre (📨 Para Chelsea · 🙋 Lo hago yo · ➕ Tarea · 🗄 Archivar →
  `PATCH /api/correo`) y el «hace…» en el idioma de su cuenta.
- **📝 Por dónde iba**: la primera línea de cada nota viva, en el orden de
  empresas, con su edad; enlace a Notas.
- **Conexiones**: un chip por cuenta de Google (📅 Calendar / 📧 Correo) y
  uno de Telegram, en gris si falta algo; solo se muestra el email y si está
  activo, nunca tokens ni ids.
- **Móvil**: una sola columna en este orden: KPIs → Agenda → Prioridades →
  Correos → Notas.
- El chat 💬 (9c-E) también está aquí; tras cada respuesta la página se
  recarga.

**C) Pantalla Notas** (`/notas`): la nota viva de cada empresa con el mismo
editor del tablero (`CompanyNote`; el bot escribe la misma fila con «nota
IM: …») y, bajo cada una, su historial (`notas_historial`, plegado).

**D) Lectura de Calendar** (`eventosDelDia` en `src/lib/google/calendar.ts`):
`GET …/calendars/primary/events?timeMin&timeMax&singleEvents=true&orderBy=startTime`
sobre el día civil de Cancún, con el token de la conexión que tiene Calendar
activo. El scope `calendar.events` ya permitía leer; no hubo que reconectar.

**E) Fallo #1 (5 nov): la alerta individual de correo en el idioma de la cuenta.**
La alerta de IM Chelsea seguía en español aunque la lista (9c-2) ya salía
en inglés: el resumen y la razón los escribe el **clasificador**, y su
prompt decía «RESUMEN: UNA línea en español» antes de la instrucción de
idioma que iba al final — el modelo obedecía la primera. Ahora
(`src/lib/correo/clasificar.ts`):

1. La regla de idioma va **primero** en el prompt y las líneas RESUMEN y
   RAZON nombran el idioma («en INGLÉS» para una cuenta `en`).
2. Red de seguridad: si la cuenta es `en` y el resumen o la razón **parecen
   español** (`pareceEspanol`: dos o más palabras funcionales del español),
   una segunda llamada corta los traduce (8 s; si falla, queda como vino).
3. La parte fija de la razón — la regla que disparó («alerta: tottatl.com»,
   «regla VIP: …») — sale en el idioma de la cuenta (`razonRegla`: «alert:»,
   «VIP rule:», «silence:», …). También el aviso «classifier unavailable».

`npm run pruebas` comprueba el prompt en los dos idiomas, el detector con la
alerta real del 5 nov y las razones de regla.

### 12b. Lo que hay que hacer a mano

Nada en Supabase ni en Vercel. Al desplegar, la raíz pasa a `/resumen`.
Si al abrir Resumen la agenda no trae eventos de Calendar, revisar en
Settings → Conexiones que una cuenta tenga 📅 Calendar activo; si Google
pidió reconectar, «Desconectar» y «Conectar» de nuevo esa cuenta.

### 12c. Env vars que agrega esta fase

Ninguna.

### 12d. Cómo probar que funciona

1. Abrir `gabby-hq.vercel.app`: debe caer en Resumen con el menú blanco/azul
   a la izquierda (en el teléfono, barra blanca con ☰).
2. Crear un evento de prueba HOY en el Google Calendar de la cuenta conectada
   (p. ej. «Prueba 4 pm») → recargar Resumen → aparece en Agenda con 📆 y
   enlace; una tarea con hora de hoy y un pago que caiga hoy aparecen con ▫️/★
   y 💳.
3. Marcar el checkbox de una prioridad → desaparece y el KPI baja; en
   Telegram «¿qué cerré hoy?» la nombra.
4. «📋 Resumen diario» → el panel muestra el texto de la alarma de las 8;
   «📲 Enviar a Telegram» → llega al bot como lista; «la 1 lista» funciona
   sobre ella.
5. Un correo con 🙋 Lo hago yo desde la tarjeta → crea la tarea y sale de la
   lista.
6. Menú: Tablero abre `/hoy` con las pestañas Tablero | Prioridad | Empresas;
   Calendario abre `/calendario` con Semana | Mes; Notas permite editar y ver
   el historial.
7. Fallo #1: el siguiente correo VIP de IM Chelsea llega con resumen y razón
   en inglés («alert: tottatl.com · …»).

### 12e. Qué puede fallar y dónde verlo

| Síntoma | Causa probable | Dónde verlo |
| --- | --- | --- |
| Agenda sin eventos y la línea «no pude leer Google Calendar» | Ninguna cuenta con 📅 activo, o token rechazado | Logs de Vercel `[resumen] calendar: …`; Settings → Conexiones |
| Un evento sale dos veces | La tarea/pago lo creó pero `gcal_event_id` no coincide con el id base | Comparar `gcal_event_id` de la tarea con el id del evento |
| «Resumen diario» tarda | `pulir` (LLM) hasta 8 s + Supabase | Igual que la alarma de las 8; el texto fijo sale si el modelo falla |
| «Enviar a Telegram» da 400 | `ALLOWED_CHAT_IDS` vacío | Vercel → env vars |
| Resumen de un correo de Chelsea sigue en español | El modelo ignoró el prompt y la traducción falló | Logs `[correo] traducir resumen: …`; `cuentas_correo.idioma` de la cuenta |

### 12f. Versión curso (Nivel 1, sin código)

Lo mismo dentro de un **Proyecto de Claude** o un **Gem de Gemini**: en las
instrucciones del proyecto va el Prompt Maestro y una sección «Mi día» con
tres listas que la alumna mantiene a mano (pendientes con fecha, pagos del
mes, personas a las que espera). Cada mañana escribe «dashboard» y el
asistente responde con la misma estructura de esta pantalla: KPIs en una
línea, agenda de hoy por hora, 3–5 prioridades, a quién espera y una
recomendación 👉. Lo que aquí hace Supabase lo hace la memoria del proyecto;
lo que aquí hace Google Calendar lo hace ella pegando su agenda del día (o
una captura). Sin alarmas ni correo: eso es el Nivel 2.

---

### 12g. Ajuste 12b — el asistente explica, Calendar repite (7 nov)

**Lo que pasó.** Por voz: "agregar a Google Calendar una alarma para Love Me
to Hurt Me desde el viernes 13 hasta dic 1, nota GL; otra para Love on Hire
desde el jueves 12 hasta dic 1; sábado 14 hasta dic 1 Under Her Rules". El
intérprete solo conocía `calendar` **sobre una tarea existente**, así que
buscó tareas parecidas (sacó «paypal statements»), propuso un plan absurdo,
y cuando ella dijo "no hablé de paypal, hablé de: …" tampoco entendió. Aparte,
la cuenta de Calendar fallaba con "⚠️ sin evento en Calendar: Unauthorized" —
cierto, pero inútil — y al preguntar "¿cómo que sin autorización?" el bot
pidió aclarar. Y remató con "Ojo: la nota de IM tiene 46 días".

**Qué cambia.**

1. **Acción `evento`** (`interprete.ts`, `plan.ts`, `google/calendar.ts`):
   un evento libre en Google Calendar que **no es tarea**, una vez o repetido:
   `{"tipo":"evento","titulo","fecha","hora"?,"duracion_min"?,"nota"?,"repetir":{"cada":"dia|semana|mes","dias":["JU"],"hasta"|"veces"}}`.
   "ocho sábados a las 2" → `veces: 8`; "hasta el 1 de diciembre" → `hasta`;
   "hasta que te avise" → sin fin. Se crea con `RRULE` (`FREQ=WEEKLY;BYDAY=TH;UNTIL=…`
   o `COUNT=8`), 60 min por defecto, aviso 15 min antes, la nota en la
   descripción. Si dijo "jueves 12" pero el 12 no es jueves, empieza el primer
   jueves desde esa fecha (`primeraFechaEn`). Varios títulos → un plan con
   [✅ Hacer todo]; uno solo → se crea de una vez con el enlace para abrirlo.
   Regla del prompt: si la frase habla de "google calendar", "calendario" o
   "evento" con un título nuevo, es `evento`, nunca `crear` ni `calendar`, y
   **nunca** se busca una tarea parecida.
2. **Errores de Google en lenguaje normal** (`explicarErrorGoogle`,
   `avisoCalendar` en `google/oauth.ts`): "Unauthorized" → *"Google ya no
   acepta el permiso guardado de X: se dio con una configuración anterior de
   la app. Reconecta la cuenta"*; `invalid_grant` → *"caducó (en modo prueba
   Google lo corta a los 7 días)"*; sin cuenta → *"no tengo ninguna cuenta con
   Calendar activo"*. Siempre con el enlace **🔗 Reconectar Google** a
   Settings → Conexiones. Lo usan el sync de tareas, los pagos, el evento
   libre y la Agenda del Dashboard.
3. **Preguntas sobre lo que el bot dijo**: "¿cómo que está sin autorización?",
   "explícame", "¿por qué falló?" → `pregunta` (no `desconocido`), y la
   respuesta del modelo recibe la **conversación reciente** (8 turnos) con la
   regla de explicar su propio aviso y qué hacer.
4. **Plan mal entendido**: "no hablé de X, hablé de: …" → el intérprete
   devuelve solo lo que dice ahora, completo; el plan anterior se descarta.
5. **Sin "Ojo: …" tras un tropiezo** (`ultimoTurnoFueTropiezo` en `motor.ts`):
   si las dos últimas respuestas del bot traen ⚠️ o "no entendí", no hay
   sugerencia de archivar notas ni de vencidas.
6. **Botón Probar** en Settings → Conexiones (`POST /api/google/conexiones/probar`):
   pide un token a Google con el permiso guardado y dice ✓ o la causa en
   claro, con "Reconectar ahora". Y la **alarma de las 8** hace ese mismo
   chequeo en todas las conexiones activas: si Google rechaza una, cierra con
   una línea 🔌 y el enlace, antes de que algo deje de funcionar en silencio.

**Lo que hay que hacer a mano.** Nada en Supabase ni en Vercel. La cuenta
gabrielarangel169 se conectó el 2 nov con el cliente OAuth anterior: hay que
darle **Reconectar** una vez. Para que los permisos no caduquen cada 7 días,
publicar la app en Google Cloud (Audience → Publish app) desde la cuenta
dueña del proyecto; con la app en Testing, el chequeo de las 8 avisará cuando
toque reconectar.

**Prueba.** Repetir por voz el mensaje de los tres eventos → plan con tres
líneas 📆 → Hacer todo → tres eventos repetidos en Calendar con sus enlaces.
"¿cómo que está sin autorización?" después de un aviso → explicación y qué
hacer. Probar en Conexiones → ✓ en las cuatro cuentas.

---

## 14. Fase 14 — Segundo cerebro (documentos)

**El problema.** Los papeles que de verdad importan —el contrato de
alquiler, la póliza del carro, el pasaporte, los recibos— viven repartidos
entre el correo, la galería del teléfono y carpetas de Drive. Cuando hace
falta un dato ("¿con quién tengo el seguro?", "¿cuánto es la renta?") hay
que ir a buscarlo, y los vencimientos no avisan: se enteran tarde.

**La idea.** Que GabbyHQ sea el archivero. Ella le manda el PDF o la foto
por Telegram, el bot lo lee, propone la ficha y lo guarda; después le
pregunta en palabras normales y le contesta con el dato exacto y el enlace
para abrir el papel. Y lo que vence, avisa a 30, 7 y 1 día.

### 14a. Lo que se guarda

Dos tablas y un bucket privado (`sql/2026-11-asistente-fase14-documentos.sql`):

| Pieza | Para qué |
| --- | --- |
| Bucket `documentos` (privado) | Los archivos. Nada es público: cada enlace se **firma** y caduca en 1 hora, así que un mensaje reenviado no sirve mañana. |
| `documentos` | La ficha: título, categoría, empresa, ruta, tipo, páginas, texto extraído, resumen, fecha del documento, vencimiento, monto, moneda, se renueva, notas, `reemplaza_a`, `historial`, origen. |
| `documentos.busqueda` | Columna generada (`tsvector` en español) con título + categoría + resumen + notas + **el texto del PDF**, con índice GIN. Es lo que hace que la pregunta se responda al instante. |
| `documentos_borradores` | Lo que el bot propuso y espera su 💾, y el grupo de fotos que se está armando. Vive 24 h. |

Las ocho categorías son fijas: Contratos · Alquiler · Seguros · Finanzas ·
Facturas y recibos · Salud · Documentos e IDs · Otros. La misma lista
alimenta los botones, los filtros de la web y el prompt.

### 14b. Cómo entra

1. **PDF o foto por Telegram.** El archivo se sube al bucket, se lee su
   texto (capa de texto con `pdf-parse`; si es un escaneo o una foto, el
   modelo lo transcribe con visión) y el modelo llena la ficha. Lo que ella
   escribió como caption **manda sobre el título**.
2. **La ficha se muestra, no se guarda.** "📥 Esto entendí" + [💾 Guardar]
   [✏️ Corregir]. Un vencimiento mal leído avisaría el día equivocado todo
   un año, así que nada se escribe hasta que ella toca Guardar.
3. **Corregir** es una línea en voz o texto: "el título es Póliza del carro
   2027", "vence el 15 de marzo", "es de IM", "quítale el vencimiento". El
   modelo cambia **solo eso** y vuelve a mostrar la ficha.
4. **Varias fotos = un documento.** Si llega otra foto dentro de 5 minutos
   y la ficha anterior sigue esperando, pregunta "¿es página del mismo
   documento?". [📎 Sí] las junta en una sola ficha; [📄 No] arranca una
   nueva y la anterior **sigue esperando su 💾 en su propio mensaje** (cada
   botón lleva el id de su borrador, así que pueden esperar varias a la vez).
5. **Renovaciones.** Si lo que llega se parece a algo que ya existe (misma
   categoría, misma empresa, título parecido), pregunta si lo reemplaza.
   [🔄 Sí] marca la vieja como `historial = true` —no se borra— y el
   vencimiento que cuenta es el nuevo.
6. **Notas sin archivo.** "guarda: el seguro del carro es con GNP, se paga
   en marzo" entra al archivero como una fila sin ruta, con su categoría y
   su empresa, y sale en las mismas búsquedas.
7. **Más de 20 MB.** Telegram no deja bajarle a un bot archivos de más de
   20 MB: el bot lo dice en claro y manda el enlace a GabbyHQ → Archivos.

### 14c. Cómo se pregunta

Postgres busca primero, el modelo contesta después y **solo** con lo que
dicen esos documentos. La respuesta cierra con la línea del documento y su
enlace firmado, para poder abrirlo y verificar.

- "¿con quién tengo el seguro del carro?" → el dato + 🛡 Póliza … · abrir
- "¿cuánto pago de alquiler?" · "¿cuándo vence mi pasaporte?"
- "mándame el contrato de Bonampak"
- Si no hay nada: "📂 No tengo nada guardado sobre eso. Mándame el PDF…"

Entra por tres puertas: el intérprete (`documentos`), una pregunta normal
que huele a papeles (si el archivero tiene algo, contesta él; si no, sigue
el camino de siempre) y el chat de la web.

### 14d. Vencimientos

- La alarma de las **8:00** trae el bloque "⏳ Por vencer" a los 30, 7 y 1
  día, y **todos los días** una vez pasado, con un botón por documento:
  **➕ Tarea de renovar** (crea la tarea urgente ★ con la fecha del
  vencimiento y la empresa del documento).
- El **Resumen** los muestra como chips de colores (rojo vencido, naranja ≤7,
  amarillo ≤30) en los próximos 45 días.

### 14e. La pantalla Archivos

Oscura, como el resto de GabbyHQ. Buscar (incluye el texto de los PDF),
filtrar por categoría y empresa, ver el historial, subir (uno o varios
archivos, con "son páginas de un mismo documento") o guardar un dato sin
archivo, y por fila: ver · descargar · editar (título, categoría, empresa,
fechas, monto, moneda, se renueva, resumen, notas) · al historial · borrar.

### 14f. Lo que NO hace

- No rasteriza un PDF escaneado de varias páginas para pasarlo por visión:
  guarda lo poco que encuentre y lo dice ("no pude leer el texto… revísala").
- No busca dentro de un video ni de un Word: por ahora PDF y fotos.
- No manda el archivo como adjunto por Telegram: manda el enlace firmado.

### 14g. Versión curso

El trozo vendible de esta fase, para "IA después de los 40":

- **La clase:** "Tu segundo cerebro en WhatsApp/Telegram". Le mandas una
  foto de un papel y lo encuentras un año después preguntando en voz.
- **Lo que se enseña, en orden:** (1) un depósito privado con enlaces que
  caducan —por qué un archivo público es un problema—; (2) sacar el texto
  de un PDF gratis, y usar visión **solo** cuando el PDF es un escaneo;
  (3) la ficha la propone la IA, la confirma la persona: el patrón
  "propón, no guardes" como regla de diseño, no como detalle; (4) buscar
  con el buscador de la base (barato, instantáneo) y dejar que el modelo
  **solo redacte** la respuesta con lo encontrado; (5) los vencimientos
  como el verdadero valor: un archivo que avisa vale más que un archivo
  ordenado.
- **Lo que el alumno se lleva:** el SQL, el prompt de la ficha, el prompt
  de la respuesta y la regla de las tres preguntas del bot (¿misma página?
  ¿reemplaza? ¿lo guardo?).

### 14h. Prueba (definición de "terminado")

1. Guardar **3 documentos reales** por Telegram (un PDF, una foto, un dato
   dictado con "guarda: …") y que las tres fichas salgan bien.
2. Hacer **una pregunta** sobre uno de ellos y recibir el dato correcto con
   el enlace que abre el documento.
3. Ver el **vencimiento** como chip en el Resumen y en Archivos.
4. Que la alarma de las 8 **avise** del vencimiento que toque y que el botón
   ➕ cree la tarea de renovar.

---

## 15. Fase 15 — Cada cosa en su cajón: las alarmas con hora van a Google Calendar

**El problema.** Telegram terminó cargando todo con el mismo peso: la
alarma de un pago, su "te lo recuerdo otra vez", la lista de las 8, el
tablero y la conversación. Cuando todo llega igual, se deja de distinguir y
se termina ignorando. En un solo día (9 nov) el chat tuvo ocho ⏰.

**La regla (decisión de Gabby, 9 nov).** Tres cajones que no se pisan:

| Cajón | Qué guarda | Cómo avisa |
| --- | --- | --- |
| 📆 Google Calendar | lo que tiene **hora**: pagos, citas, "recuérdame llamar al banco a las 10" | el teléfono suena solo, a la hora exacta |
| 📋 Tablero | lo que hay que **hacer**: tareas, con fecha, en sus bloques | aparece en el mensaje de las 8 y en el Dashboard |
| 🧠 Gabita (archivero) | lo que hay que **saber**: papeles, datos, lo que vio | no avisa: se consulta |

Si no tiene hora, no es alarma: es una tarea con fecha.

### 15a. Qué cambió

- **"alarma …", "recuérdame …", "avísame …" con fecha y hora → evento en
  Google Calendar**, con ⏰ en el título, de 15 minutos, y el aviso del
  teléfono en el **minuto 0** (una cita avisa 15 min antes; un recordatorio
  tiene que sonar a la hora). Ella lo dice igual que siempre.
- **Se repiten:** "los días 10 y 20 de cada mes a las 10 am" son dos
  alarmas mensuales; "todos los lunes a las 9", semanal; "todos los días a
  las 7", diaria. Antes la palabra "mensual" se perdía y quedaba una sola
  alarma.
- **"avísame en 20 minutos …" sigue en Telegram**: es un temporizador
  dentro de la conversación, no una fecha.
- **Si Calendar falla, la alarma no se pierde:** cae a Telegram por esa vez
  y la respuesta dice por qué y cómo arreglarlo (el mismo aviso de la 12b).
- **Posponer ya no manda otro mensaje:** [⏰ +1h] y [📅 Mañana] reescriben
  el mismo mensaje ("💤 Pospuesta: … → mar 10 nov 10:00 am"). Un aviso es
  un mensaje, no dos.
- **Mudanza:** "pasa mis alarmas al calendario" lleva a Calendar las que
  quedaban en Telegram. "quita todas las alarmas" y "quita las alarmas de
  pago" limpian varias de una vez.
- **Enlaces limpios:** las confirmaciones salen con "abrir" como enlace, no
  con la URL entre paréntesis. `htmlSeguro()` escapa lo que ella escribió y
  deja nuestras etiquetas; si Telegram igual rechaza el HTML, el mensaje se
  manda en texto plano en vez de perderse.

### 15b. Lo que falta de esta idea (domingo)

- Telegram en **3 mensajes al día**: las 8 (bloque A y B de hoy), el cambio
  de bloque y el check-in de las 7:30 pm. Depende de la plantilla de semana.
- Que una **tarea con hora** vaya sola a Calendar (hoy solo si dice "y ponla
  en calendar").

### 15c. Versión curso

- **La clase:** "Un asistente no es un notificador". Por qué más alarmas =
  menos atención, y cómo repartir: reloj → calendario, hacer → lista,
  saber → archivo.
- **Lo que se enseña:** crear el evento con la API (RRULE mensual/semanal,
  recordatorio en el minuto 0), el patrón "si el servicio falla, cae al
  canal de respaldo y dilo", y editar un mensaje en vez de mandar otro.

---

## 16. Fase 16 — La semana en bloques y Gabita conversando

**El problema.** GabbyHQ sabía QUÉ había que hacer, nunca CUÁNDO se trabaja
en qué. Y cuando ella pensaba en voz alta ("necesito tiempo para CPT esta
semana, no sé cuándo"), el bot contestaba con otra pregunta ("¿cuántos días
quieres bloquear?"): devolverle el problema. En sus palabras: "sigo tirando
flechas".

### 16a. La plantilla de la semana

`sql/2026-11-asistente-fase16-bloques.sql`:

| Pieza | Para qué |
| --- | --- |
| `semana_bloques` | Cada día con sus bloques: hora, nombre, de qué es, empresa y palabras (qué tareas le caen), lo **fijo** del bloque (la rutina, que no son tareas), si recibe tareas y si es horario no disponible. |
| `semana_reglas_mes` | Lo que cambia según el día del mes, solo en días hábiles: del 1 al 7 el Bloque B es un cliente de SEO/GEO por día (turnos: Shift → TOTT → PTHO → Urólogo → CPT); del 1 al 5 el Bloque A son los estados de cuenta; del 12 al 16, el repaso de mitad de mes. Cuando los turnos se acaban, vuelve el bloque normal. |
| `tasks.minutos_estimados` · `responsable` · `proyecto` | Cuánto tarda, quién la hace, de qué proyecto es. Los dos últimos quedan listos para las recetas y el equipo. |

La plantilla se siembra una sola vez con su semana (lun–vie: Estudio 4:45 ·
PD 7:00 · IM 7:30 · Bloque A 8:15 · Bloque B 10:30 · Cierre 12:30 · no
disponible 1–6 · Tarde 6:00; sábado y domingo, 5 h mientras QuickBooks esté
atrasado). Todo se edita en **Settings → Mi semana**.

**Cómo cae una tarea en un bloque** (`bloquesDelDia`): de las tareas del día
(hoy: lo que vence hoy o está vencido; un día futuro: lo que vence ese día;
nunca lo que espera a otra persona), cada una va al primer bloque que la
toma — por empresa y, si el bloque tiene palabras, por palabras. Un bloque
sin empresa ni palabras es un **colchón**: recibe solo lo que nadie más tomó.
Sin estimado, una tarea cuenta 30 minutos (y se marca con ~).

### 16b. Dónde se ve

- **Resumen → "Hoy te toca":** los bloques del día con su rutina (↻), sus
  tareas y su carga; el bloque en curso resaltado; ⚠️ cuando las tareas
  piden más de lo que el bloque dura; y lo que no cayó en ninguno.
- **Mensaje de la mañana:** "🧭 Hoy te toca" con los bloques que quedan.
- **El cierre del día pasa de las 6:00 a las 7:30 pm**, cuando termina su
  último bloque.

### 16c. Gabita conversando

Acción nueva del intérprete: `conversar`. Cuando no hay una orden sino
alguien pensando ("no sé cuándo", "¿me da tiempo?", "ayúdame a organizar",
"tengo una idea"), el mensaje completo va a `responderConversacion`, que arma
el contexto —la hora, **su semana bloque por bloque con lo libre de cada
uno**, las tareas abiertas con su duración, su calendario de los próximos 9
días y el hilo— y pide una propuesta:

- propone días, bloques y horas exactas; nunca devuelve la pregunta,
- respeta lo no disponible y el tema de cada bloque,
- si no cabe antes de la fecha, lo dice y dice qué habría que mover,
- una línea por cosa (`• jue 12 nov · Tarde 6:00–7:30 pm · CPT: reunir la
  información (1 h 30)`) y cierra con "¿Lo dejo así?".

Cuando ella dice "sí, déjalo así", el intérprete (que lee el hilo) crea las
tareas con su fecha y su `minutos`. Por eso el historial ahora conserva los
mensajes largos enteros.

**Modelo propio:** `LLM_MODEL_CONVERSACION` (por ejemplo `gpt-6.1-sol` o
`claude-sonnet-5-5`; el proveedor se deduce del nombre). Es el único punto
donde un modelo más fuerte cambia la respuesta. Si no está definida o ese
modelo falla, responde el de siempre: una respuesta más simple es mejor que
ninguna. Cada turno queda en `bot_preguntas` con `[conversar]` para ver el
costo.

### 16d. Lo que falta (segunda parte)

- **Recetas:** "necesito un agente SDK para CPT" → Gabita ya sabe los pasos,
  las horas y quién hace cada uno, y los reparte. Las columnas
  `responsable` y `proyecto` ya existen.
- **Tareas que se repiten** como tareas (hoy la rutina vive en lo fijo del
  bloque).
- **Telegram en 3 mensajes al día** con el aviso de cambio de bloque.
- Mudar el modelo base (gpt-5-mini está marcado como obsoleto).

### 16e. Versión curso

- **La clase:** "De lista de tareas a semana con horas". Por qué una lista
  sin horario produce culpa y no trabajo, y cómo un horario fijo convierte
  "¿cuándo lo hago?" en un cálculo.
- **Lo que se enseña:** la plantilla (bloques + rutina + qué le cae), el
  reparto automático con aviso de "no cabe", y el patrón de conversación:
  darle al modelo **el espacio libre ya calculado** para que proponga, en vez
  de pedirle que lo adivine. Y la regla de oro: una asistente propone, no
  devuelve la pregunta.

## 10. Cómo replicarlo para otra persona

Checklist completo para levantar el mismo asistente para alguien más (por
ejemplo Chelsea), desde cero hasta la primera alarma. Lo que cambia es: el bot
(token), el `chat_id`, el proyecto de Supabase y su cuenta de Google (que se
conecta desde Settings → Conexiones, sin tocar Vercel).
El código es el mismo repo.

**A. El bot en Telegram (BotFather)**

1. En Telegram busca **@BotFather** y ábrelo.
2. Escribe `/newbot`. Te pide un nombre visible (ej. "Chelsea HQ") y un
   usuario que termine en `bot` (ej. `chelseahq_bot`).
3. BotFather responde con el **token** (algo como `123456:ABC-DEF…`). Guárdalo:
   es `TELEGRAM_BOT_TOKEN`. No lo compartas.
4. La persona abre el bot y le manda `hola` (así existe un chat).
5. En el navegador abre
   `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número en
   `"chat":{"id":…}`. Ese es su `chat_id` → `ALLOWED_CHAT_IDS`.

**B. Supabase propio**

1. https://supabase.com → **New project**. Elige nombre, contraseña de la base
   y región. Espera a que termine de crear.
2. **Settings → API**: copia `Project URL` (→ `NEXT_PUBLIC_SUPABASE_URL`),
   `anon public` (→ `NEXT_PUBLIC_SUPABASE_ANON_KEY`) y `service_role`
   (→ `SUPABASE_SERVICE_ROLE_KEY`; secreto, solo servidor).
3. **SQL Editor**: crea las tablas base de GabbyHQ (`companies`, `tasks`,
   `subtasks`, `radar`, `api_keys`) y corre en orden todos los archivos de
   `sql/` del repo, incluidos `sql/2026-10-asistente-fase1.sql`,
   `sql/2026-10-asistente-fase2.sql`, `sql/2026-10-asistente-fase3.sql` y
   `sql/2026-10-asistente-fase4.sql`, `sql/2026-11-asistente-fase4b.sql` y
   `sql/2026-11-asistente-fase5.sql`, `sql/2026-11-asistente-fase5c.sql`,
   `sql/2026-11-asistente-fase6-correo.sql`, `sql/2026-11-asistente-fase7.sql`,
   `sql/2026-11-asistente-fase6b-ajustes.sql`, `sql/2026-11-asistente-fase6c-niveles.sql`
   y `sql/2026-11-asistente-fase9-tablero.sql` (y sus pruebas en queries aparte, ver
   1b, 2b, 3b y 4b Paso 1). El SQL de la fase 6 precarga las cuentas de
   correo de Gabby y Chelsea: cambia esos emails y listas por los de la
   persona (o bórralas y créalas en Settings → Correo).
4. En la app, en **Settings**, crea las empresas con los nombres que esa
   persona use. El orden fijo de la alarma (IM · DATAVIA · PD · Personal ·
   Chelsea) está en `EMPRESAS_ORDEN` dentro de `src/lib/asistente/alarmas.ts`;
   cámbialo ahí si sus empresas son otras (las que no estén en la lista salen
   al final, en orden alfabético).

**C. Deploy en Vercel**

1. https://vercel.com → **Add New → Project** → importa el repo de GitHub
   (un fork o el mismo repo con otro proyecto de Vercel).
2. Antes de **Deploy**, abre **Environment Variables** y carga todas:
   `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, `APP_URL` (la URL que Vercel le
   asigne, p. ej. `https://chelsea-hq.vercel.app`), `CRON_SECRET` (nuevo,
   `openssl rand -hex 32`), `OPENAI_API_KEY` (una key propia, con su tope de
   gasto, ver 2b), `LLM_PROVIDER` y `LLM_MODEL` (ver 3c),
   `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_PASSWORD` y `API_SECRET_SEED` (login de la app), `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET` y `APP_ENCRYPTION_KEY` (Calendar y Gmail, ver 5c; el
   OAuth client de Google debe tener la redirect URI de esta URL), y si
   quiere otro modelo para el correo, `LLM_PROVIDER_CORREO` / `LLM_MODEL_CORREO`
   (ver 6c; sin ellas usa el de `/pregunta`). Si todavía usa inbox-IM,
   `SUPABASE_INBOXIM_URL` y `SUPABASE_INBOXIM_SERVICE_KEY` (si no, el bloque
   de Chelsea dirá "no se pudo consultar inbox-IM" y todo lo demás funciona).
3. Click **Deploy**. Al terminar, el plan debe ser **Pro** para que el Cron
   corra a la hora exacta (en Hobby los crons se ejecutan como mucho una vez
   al día y con horario impreciso).

**D. Conectar el webhook del bot**

Telegram tiene que saber a dónde mandar los mensajes. Una sola vez, en el
navegador o con curl (sustituye TOKEN y la URL):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://chelsea-hq.vercel.app/api/telegram
```

Debe responder `{"ok":true,"result":true,"description":"Webhook was set"}`.

**E. Primera alarma**

1. Vercel → **Settings → Cron Jobs**: deben verse los cuatro jobs (mañana,
   tarde, recordatorios cada 5 min, ingesta de correo cada 15 min).
2. Corre la Prueba 1 de la sección 1d con el `CRON_SECRET` de ese proyecto.
3. Si llega "☀️ Hoy, …" a su chat, está listo. La primera alarma automática
   llega a las 8:00 (hora de Cancún) del siguiente lunes–sábado.

Si la persona vive en otra zona horaria, hay que cambiar dos cosas: los
horarios en `vercel.json` (están en UTC) y `CANCUN_TZ`/`CANCUN_OFFSET` en
`src/lib/asistente/cancun.ts` (ojo: el código asume una zona **sin** horario de
verano; para una zona con DST hay que calcular el offset en vez de fijarlo).

---

## 11. Costos estimados por mes

| Concepto | Fase | Costo | Nota |
| --- | --- | --- | --- |
| Vercel Pro | 1 | $20 USD / usuario | Ya se paga por GabbyHQ. Los Cron Jobs no cuestan aparte; dos corridas al día de pocos segundos no mueven la factura. |
| Supabase | 1 | $0 | Dentro del plan actual; `bot_alarmas` crece ~2 filas/día. |
| Telegram Bot API | 1 | $0 | Gratis. |
| OpenAI Whisper (`whisper-1`) | 2 | **$0.006 USD por minuto de audio** (precio de lista a octubre 2026; se cobra por segundos, redondeado). Ejemplo: 30 audios de 30 s al mes = 15 min = **$0.09 USD/mes**. Con 100 audios de 1 min = $0.60. | El tope mensual de $5 en OpenAI equivale a ~830 minutos de audio: imposible de alcanzar con uso normal. |
| LLM para `/pregunta` (`gpt-5-mini`) | 3 | **$0.25 USD / 1M tokens de entrada · $2.00 / 1M de salida** (precio de lista a octubre 2026). Una pregunta ≈ 3000 tokens de entrada (el contexto) + 150 de salida ≈ **$0.0011 USD**. Ejemplo: 20 preguntas al día × 30 días = 600 preguntas ≈ **$0.65 USD/mes**. | Si el contexto es corto (pocas tareas), baja a la mitad. Con `gpt-5-nano` cuesta ~5× menos; con Anthropic (`claude-haiku-5-5`) algo más. La consulta de costo real del mes está al final de `sql/2026-10-asistente-fase3-pruebas.sql`. |
| LLM para el intérprete (`gpt-5-mini`) | 4 | Un mensaje libre ≈ 1500 tokens de entrada (prompt + tareas) + 100 de salida ≈ **$0.0006 USD**. 30 mensajes al día × 30 = 900 ≈ **$0.55 USD/mes**. | Los comandos exactos (`listo 3`, `pasa 2,5`, `nota IM: …`) no pasan por el modelo. El cron de 5 min no cuesta: corre en Vercel Pro. |
| Google Calendar API | 5 | $0 | Gratis dentro de las cuotas normales (1M llamadas/día; aquí son unas pocas por tarea). |
| Gmail API | 6 | $0 | Gratis dentro de la cuota (aquí: una lectura de historial cada 15 min y un `get` por correo nuevo). |
| LLM para clasificar correo (`gpt-5-mini` o el de `LLM_MODEL_CORREO`) | 6 | Un correo que llega al modelo ≈ 1200 tokens de entrada (prompt + cuerpo recortado a 3000 caracteres + resúmenes previos del hilo) + 100 de salida ≈ **$0.0005 USD**. Con 30 correos al día que pasan por el modelo × 30 días = 900 ≈ **$0.45 USD/mes**. | El ruido (listas y reglas) no pasa por el modelo; los VIP sí (tipo y resumen). Cada evaluación en `/correo/evaluar` reclasifica la ventana entera: 100 correos ≈ $0.05 por modelo. Se ve en Settings → Asistente como `correo:…`. |
| LLM para narrar (fase 9c) | 9c | Dos llamadas al día (el párrafo de las 8 y el del cierre, ≈ 700 tokens cada una) ≈ **$0.02 USD/mes**. Las preguntas naturales («¿qué tengo hoy?», «¿cómo va IM?»…) y la foto del tablero **no usan el modelo**. | Si el modelo falla o tarda, va el párrafo fijo: cuesta $0. |
| LLM para la conversación (fase 7) | 7 | El intérprete manda además el hilo reciente (≈ +300 tokens por mensaje) y la mañana una llamada corta (≈ 400 tokens). Con 30 mensajes al día: **≈ $0.65 USD/mes** en total para el intérprete; la mañana, centavos. | Sugerencias y "organízame" no usan el modelo. El costo real del mes se ve en Settings → Asistente. |

**Fase 1 total: $0 adicionales** sobre lo que ya se paga.
**Fase 2 total: ~$0.10 USD/mes** con uso normal (requiere saldo prepagado en OpenAI, mínimo $5).
**Fase 3 total: ~$0.65 USD/mes** con 20 preguntas al día. Sale del mismo saldo y del mismo tope de $5 de OpenAI.
**Fase 4 total: ~$0.55 USD/mes** con 30 mensajes libres al día. Mismo saldo, mismo tope.
**Fase 6 total: ~$0.45 USD/mes** con 30 correos al día clasificados por el modelo (más lo que se gaste evaluando). Si el ganador es JEV u otro endpoint compatible, el costo es el de ese proveedor.


## 17. Proyectos (fase 17)

Un **proyecto** es lo que tiene un final: "asistente del curso", "agente de CPT". Guarda las 4 definiciones que se piden antes de arrancar cualquier cosa y agrupa sus pasos.

- **Tabla `proyectos`**: nombre, empresa, `terminado` (qué es la versión mínima), `produccion_desde/hasta`, `pruebas_desde/hasta`, `salida`, `estado` (activo · pausado · terminado).
- **Pasos**: son tareas normales con `tasks.proyecto_id`. Caen en los bloques de la semana como cualquier tarea y se completan igual.
- **`/proyectos`**: cada proyecto entero, con su cuenta regresiva a la salida, lo que falta definir en rojo, el avance y sus pasos. Se crea, edita, pausa, termina o borra desde ahí (al borrar, los pasos quedan como tareas sueltas).
- **Resumen**: tarjeta "Proyectos" con los activos y cuántos días faltan.
- **Gabita**: acción `proyecto` ("proyecto nuevo: agente de CPT, DATAVIA, sale el 30") crea o completa el proyecto y sus pasos de un solo mensaje; si falta alguna de las 4 definiciones, lo dice. `proyectos` ("¿cómo van mis proyectos?") los lista. `crear` acepta `proyecto` para meter una tarea suelta como paso. Cuando conversa, ve los proyectos activos y sus fechas de salida.
- **Nunca inventa**: una fecha que no viene como fecha se descarta y se pide; no se adivina.

SQL: `sql/2026-11-asistente-fase17-proyectos.sql`.

**Versión curso:** proyectos con las 4 definiciones y pasos; sin bloques ni calendario.


## 18. El canal de Chelsea (fase 18)

Lo de Chelsea sale del Telegram de Gabby y va a **su propio chat**, por un segundo bot. Gabby es quien lo lee: es su vista aparte para saber qué tiene Chelsea y recordárselo. Sustituye a los flujos de n8n (`im_triaje_*`, `im_chelsea_digest`).

- **Variables (Vercel):** `TELEGRAM_BOT_TOKEN_CHELSEA` (el bot) y `CHELSEA_CHAT_ID` (el chat). Sin las dos, el canal no existe y todo sigue como antes.
- **Conectar:** `/canal` en el chat de Gabita. Apunta el bot de Chelsea a `/api/telegram?bot=chelsea`, saluda en su chat y manda el resumen de prueba. Dice en claro qué falló si algo falla.
- **Qué llega ahí:** las alertas de los correos de las cuentas de Chelsea (con sus botones Para Chelsea · Lo hago yo · Tarea · Archivar, que funcionan ahí mismo) y, cada mañana con el cron de las 8:00, el resumen: lo que le pasó y no ha contestado, sus correos sin decidir y las tareas de la empresa Chelsea. `/resumen` en ese chat lo manda al momento.
- **Qué NO hace ese chat:** no es Gabita. El texto libre se ignora; las listas numeradas ("listo 3") viven en el chat de Gabby.
- **Cómo se elige el bot:** por el chat de destino (`telegram.ts → tokenPara`), y dentro de una petición del webhook de Chelsea, por el canal (`canal.bot`).

**Versión curso:** no aplica (un solo bot).

**Ajustes 18a / 18b.** Con el canal encendido, las tareas y correos de Chelsea no entran en el día de Gabby (`cargarPanorama(…, { sinChelsea })`). El resumen del canal va en **inglés** y, igual que la sección 📧 de la lista de las 8:00 de Gabby, lista solo los correos que **piden algo** (`pideAlgo`: urgente, VIP, alguien espera respuesta, o ya pasado a Chelsea); facturas, boletines y avisos se cuentan en una línea.

## 19. GabbyHQ como conector de Claude (fase 19)

Gabby le habla a Claude en cualquier chat y Claude trabaja directo en su HQ. Es un servidor MCP remoto dentro de la misma app.

- **Dónde:** `POST /api/mcp/<llave>` (Streamable HTTP sin estado, JSON-RPC). La llave sale de un secreto del servidor (`MCP_SECRET`, o `API_SECRET_SEED`/`CRON_SECRET`); sin la URL completa responde 404.
- **Cómo se conecta:** Settings → Conectar a Claude muestra la URL y los pasos (claude.ai → Configuración → Conectores → conector personalizado).
- **Herramientas** (`src/lib/mcp.ts`): `hoy`, `listar_tareas`, `crear_tareas`, `actualizar_tarea` (mover, completar, borrar…), `listar_proyectos`, `guardar_proyecto`, `semana_por_bloques`. Usan las mismas funciones que Gabita y la web.
- **Reglas que viajan con el conector:** toda tarea lleva empresa; lo que tiene hora va al calendario y lo demás es tarea con fecha; todo proyecto lleva sus 4 definiciones; no se inventan pasos ni fechas.
- **Para cambiar la llave** (si el enlace se filtró): poner o cambiar `MCP_SECRET` en Vercel y volver a agregar el conector con la URL nueva.

**Versión curso:** no aplica (el alumno usa su asistente dentro de la IA que ya tiene).

### 18c · El resumen de Chelsea va como imagen

El resumen de las 8:00 (y `/resumen` en su canal) ya no es texto: es una imagen blanca, en inglés, con solo dos secciones.

- **VIP EMAILS**: los correos de remitentes VIP de las cuentas de Chelsea de los últimos 7 días, en cualquier estado, cada uno con su etiqueta: `Needs action` (nuevo), `Waiting on Chelsea`, `Gabby is on it`, `Now a task`, `Replied`, `Nothing to do`. Lo pendiente va primero.
- **CHELSEA'S TASKS**: todas sus tareas abiertas, por fecha; las vencidas en rojo.

No lleva facturas, boletines ni el conteo de avisos. Las alertas sueltas de correo siguen en texto con botones. Si la imagen falla, sale el texto de antes. Vista previa con sesión: `/api/asistente/chelsea.png`.
Archivos: `chelsea-imagen-datos.ts` (modelo), `chelsea-imagen.tsx` (dibujo), `fuentes-inter.ts` (letra embebida).

### 18d · El mismo resumen para Gabby

`/resumen` en el chat de Gabby manda su imagen: en español y en oscuro. **CORREOS VIP** de sus cuentas (no las de Chelsea), con `Falta hacer algo`, `Lo hago yo`, `Esperando a Chelsea`, `Ya es tarea`, `Respondido` o `Nada que hacer`; y **TUS TAREAS · HOY Y VENCIDAS**, cada una con su empresa. Solo sale cuando lo pide: el mensaje de las 8:00 no cambió. Vista previa con sesión: `/api/asistente/chelsea.png?de=gabby`.

### 18e · Respondido o no, y VIP con la lista de hoy

- **VIP se decide al armar la imagen**, contra la lista 🔔 Alerta que la cuenta tiene en ese momento. Un remitente agregado hoy sale desde hoy, con los correos que ya había mandado (y esos correos quedan marcados VIP).
- **Etiquetas centradas en la respuesta**: `Needs reply` (rojo, con la línea de qué pide), `Waiting on Chelsea`, `Gabby is on it`, `Now a task`, `Replied`, `No reply needed` (avisos y FYI) y `Closed · no reply`. En español: `Falta responder`, `Respondido`, `No pide respuesta`, `Cerrado sin responder`.
- **Una fila por hilo**: el correo más nuevo de cada conversación.
- El chequeo automático de respuestas ahora también revisa los hilos de remitentes VIP, aunque el modelo los haya leído como aviso.

### 18f · El resumen en imagen de Gabby también llega a las 8:00

La alarma de la mañana manda, después de la foto del tablero y antes del texto, la misma imagen de `/resumen` (correos VIP con si falta responder + tareas de hoy y vencidas). Si falla, la alarma sigue igual.

### 18g · Alarmas cortas, cierre a las 4:00 pm y aviso una hora antes

- **Las alarmas de Gabby vuelven a ser texto, y corto** (reemplaza 18f): sin foto del tablero ni la lista larga. La imagen queda solo a pedido con `/resumen` y `/cierre`, porque la suya es larga y en el teléfono se ve muy chiquita. La de Chelsea sigue en imagen.
- **8:00 am**: lo de hoy y lo vencido (lo que tiene hora, con su hora) y los correos VIP por acomodar.
- **4:00 pm** (antes 7:30 pm; cron `0 21 * * 1-6`): lo hecho hoy, lo que sigue pendiente y los VIP por acomodar.
- Si el texto corto falla, sale el texto largo de antes. `/hoy`, `cierre` y `tablero` siguen igual a pedido.
- **Tareas con hora**: el evento de Google Calendar avisa 1 hora antes y 15 minutos antes (`AVISOS_TAREA_MIN`). Aplica a lo que se cree o se cambie desde ahora.

### 18h · La alerta de correo llega como ficha

Cada alerta de correo (VIP o urgente) llega como imagen con el estilo del resumen: cuenta, etiquetas (VIP · tipo · urgencia), quién escribe, asunto, qué pide y por qué avisó. Clara en el canal de Chelsea, oscura en el chat de Gabby. Debajo, una línea con quién y el asunto (es lo que muestra la notificación del teléfono) y los botones de siempre. Al decidir o al responderse, se edita esa línea. Si la imagen falla, sale el texto de antes.
Archivos: `src/lib/correo/alerta-imagen.tsx`, `fichaDeAlerta` y `pieDeAlerta` en `alertas.ts`; `editMessageText` cae a `editMessageCaption` cuando el mensaje es una foto.
