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
| 6 | Gmail | ⏳ Pendiente |
| 7 | De comandos a conversación: memoria, sugerencias, "organízame", personalidad | ✅ Construida — pendiente de validar |

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
`/inbox`) es el tablero para **ver**, no un paso obligatorio. Si algo solo se
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
| `src/app/api/telegram/route.ts` | Webhook del bot: comandos exactos, texto libre → intérprete, audios, botones |
| `src/lib/asistente/config.ts` | Fase 7: lo que se personaliza (nombre, bot, tono, sugerencias) y el **system prompt único** (`personaPrompt`) |
| `src/lib/asistente/conversacion.ts` | Fase 7: el hilo (`bot_conversacion`): últimos 10 turnos / 30 min, "olvida lo anterior", sugerencias declinadas |
| `src/lib/asistente/sugerencias.ts` | Fase 7: la única sugerencia por mensaje, con botones, y qué hace cada botón |
| `src/lib/asistente/organizar.ts` | Fase 7: el modo "organízame" (cola, botones, resumen) |
| `src/lib/asistente/similitud.ts` | Fase 7-G: "nunca duplicar" — similitud de títulos y palabras clave |
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
| `sql/2026-11-asistente-fase7.sql` | Migración de la fase 7: `bot_conversacion` + `asistente_config` |
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
«…»`, `📅 … pasa a mañana`). Con **No, corrijo**: "Ok, no hice nada."

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
   Toca **No, corrijo** → "Ok, no hice nada." y nada cambió en /tasks. Repite
   y toca **Hacer todo** → una línea por acción. En /tasks → Completadas, la
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

## 6. Fase 6 — Gmail

_Pendiente. La cuenta ya queda autorizada con `gmail.readonly` + `gmail.modify` desde la fase 5._

---

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
en su propia tarea con la fecha de ese día. Antes de crear, `buscarParecida()`
(`similitud.ts`) busca una tarea abierta que sea lo mismo: similitud de título
≥ 0.6 (Dice sobre bigramas, sin acentos) o una **palabra clave** compartida
("marketing", "Jobescape", "Chelsea": palabras de 5+ letras que no sean
genéricas). Si existe, no se duplica: se actualiza (fecha, prioridad, hora) y
el plan lo dice. "prioridad", "lo importante", "me voy a concentrar en" →
urgente ★ ese día. El plan se muestra **por día**, no por acción:

```
Así queda tu semana:
Mañana (lun 2 nov):
  ✴️ Correos de Chelsea pendientes · IM (ya existía, la muevo)
Miércoles (4):
  ▫️ Marketing Team · DATAVIA (ya existía, la muevo)
  ▫️ Cancelar Jobescape · Personal
Jueves (5):
  ▫️ Pasar $500 de IM a WSH · IM
💡 Si alguna tiene hora, dímelo ("la de marketing a las 10") y, si quieres, la pongo en calendar.
[ ✅ Así queda ]  [ ✏️ Corrijo ]
```

Debajo va **una** sugerencia (qué le falta: empresa u hora), sin botones
(los botones son los del plan). Al aprobar, las tareas creadas quedan en el
hilo, así que "la de marketing a las 10", "lo de WSH ponlo en calendar" o
"sí" aplican sobre ese plan con la memoria de conversación.

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

## 8. Cómo replicarlo para otra persona

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
   `sql/2026-11-asistente-fase5.sql`, `sql/2026-11-asistente-fase5c.sql` y
   `sql/2026-11-asistente-fase7.sql` (y sus pruebas en queries aparte, ver
   1b, 2b, 3b y 4b Paso 1).
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
   `ADMIN_PASSWORD` y `API_SECRET_SEED` (login de la app), y si usa inbox-IM,
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

1. Vercel → **Settings → Cron Jobs**: deben verse los tres jobs.
2. Corre la Prueba 1 de la sección 1d con el `CRON_SECRET` de ese proyecto.
3. Si llega "☀️ Hoy, …" a su chat, está listo. La primera alarma automática
   llega a las 8:00 (hora de Cancún) del siguiente lunes–sábado.

Si la persona vive en otra zona horaria, hay que cambiar dos cosas: los
horarios en `vercel.json` (están en UTC) y `CANCUN_TZ`/`CANCUN_OFFSET` en
`src/lib/asistente/cancun.ts` (ojo: el código asume una zona **sin** horario de
verano; para una zona con DST hay que calcular el offset en vez de fijarlo).

---

## 9. Costos estimados por mes

| Concepto | Fase | Costo | Nota |
| --- | --- | --- | --- |
| Vercel Pro | 1 | $20 USD / usuario | Ya se paga por GabbyHQ. Los Cron Jobs no cuestan aparte; dos corridas al día de pocos segundos no mueven la factura. |
| Supabase | 1 | $0 | Dentro del plan actual; `bot_alarmas` crece ~2 filas/día. |
| Telegram Bot API | 1 | $0 | Gratis. |
| OpenAI Whisper (`whisper-1`) | 2 | **$0.006 USD por minuto de audio** (precio de lista a octubre 2026; se cobra por segundos, redondeado). Ejemplo: 30 audios de 30 s al mes = 15 min = **$0.09 USD/mes**. Con 100 audios de 1 min = $0.60. | El tope mensual de $5 en OpenAI equivale a ~830 minutos de audio: imposible de alcanzar con uso normal. |
| LLM para `/pregunta` (`gpt-5-mini`) | 3 | **$0.25 USD / 1M tokens de entrada · $2.00 / 1M de salida** (precio de lista a octubre 2026). Una pregunta ≈ 3000 tokens de entrada (el contexto) + 150 de salida ≈ **$0.0011 USD**. Ejemplo: 20 preguntas al día × 30 días = 600 preguntas ≈ **$0.65 USD/mes**. | Si el contexto es corto (pocas tareas), baja a la mitad. Con `gpt-5-nano` cuesta ~5× menos; con Anthropic (`claude-haiku-5-5`) algo más. La consulta de costo real del mes está al final de `sql/2026-10-asistente-fase3-pruebas.sql`. |
| LLM para el intérprete (`gpt-5-mini`) | 4 | Un mensaje libre ≈ 1500 tokens de entrada (prompt + tareas) + 100 de salida ≈ **$0.0006 USD**. 30 mensajes al día × 30 = 900 ≈ **$0.55 USD/mes**. | Los comandos exactos (`listo 3`, `pasa 2,5`, `nota IM: …`) no pasan por el modelo. El cron de 5 min no cuesta: corre en Vercel Pro. |
| Google Calendar API | 5 | $0 | Gratis dentro de las cuotas normales (1M llamadas/día; aquí son unas pocas por tarea). |
| LLM para la conversación (fase 7) | 7 | El intérprete manda además el hilo reciente (≈ +300 tokens por mensaje) y la mañana una llamada corta (≈ 400 tokens). Con 30 mensajes al día: **≈ $0.65 USD/mes** en total para el intérprete; la mañana, centavos. | Sugerencias y "organízame" no usan el modelo. El costo real del mes se ve en Settings → Asistente. |

**Fase 1 total: $0 adicionales** sobre lo que ya se paga.
**Fase 2 total: ~$0.10 USD/mes** con uso normal (requiere saldo prepagado en OpenAI, mínimo $5).
**Fase 3 total: ~$0.65 USD/mes** con 20 preguntas al día. Sale del mismo saldo y del mismo tope de $5 de OpenAI.
**Fase 4 total: ~$0.55 USD/mes** con 30 mensajes libres al día. Mismo saldo, mismo tope.
