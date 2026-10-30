# GabbyHQ — Asistente personal por Telegram

Este documento explica, paso a paso y sin dar nada por sabido, cómo funciona el
asistente de Telegram de GabbyHQ, qué hay que hacer a mano para que arranque, y
cómo replicarlo para otra persona. Se construye en 4 fases; cada una tiene su
sección y **no se empieza una fase hasta validar la anterior**.

| Fase | Qué agrega | Estado |
| --- | --- | --- |
| 1 | Alarmas 8:00 am y 6:00 pm | ✅ Validada |
| 2 | Notas de voz (Whisper) | ✅ Validada |
| 3 | `/pregunta` (LLM) | ✅ Validada |
| 3b | Notas y `listo` por Telegram, avisos de OpenAI | ✅ Validada |
| 3c | Todo se maneja desde el bot: borrar, nota en tarea, editar, fecha de cierre | ✅ Construida — pendiente de validar |
| 4 | Google Calendar | ⏳ Pendiente |

---

## 0. Qué es y cómo funciona

GabbyHQ es una app web (Next.js) desplegada en **Vercel**, con los datos en
**Supabase** (Postgres). El bot de Telegram no es un programa aparte: es una
ruta más de esa misma app. Nada vive en n8n ni en otro servidor.

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
                                                  │ si es /pregunta:
                                                  │ contexto (tareas + notas) + pregunta
                                                  ▼
                                          ┌────────────────────┐
                                          │ LLM (OpenAI o      │ ──▶ respuesta ≤ 5 líneas
                                          │ Anthropic, por env)│
                                          └────────────────────┘

 (2) El reloj te escribe a ti
     ┌─────────────┐  GET + secret  ┌────────────────────────┐  SQL  ┌──────────┐
     │ Vercel Cron │ ─────────────▶ │ /api/asistente/manana  │ ────▶ │ Supabase │
     │  (8:00 /    │                │ /api/asistente/tarde   │ ◀──── │          │
     │   6:00 pm)  │                └───────────┬────────────┘       └──────────┘
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
- **Inbox-IM es producción.** El asistente solo *lee* `im_triaje` (cuenta
  correos). Nunca escribe ahí.
- **Columnas nuevas en `tasks`** siempre nullable o con default, para que los
  inserts de n8n (Workflow B) sigan funcionando.

Archivos del asistente dentro del repo:

| Ruta | Qué es |
| --- | --- |
| `vercel.json` | Los dos horarios del Cron |
| `src/app/api/asistente/manana/route.ts` | Alarma de las 8:00 |
| `src/app/api/asistente/tarde/route.ts` | Alarma de las 6:00 pm |
| `src/app/api/telegram/route.ts` | Webhook del bot: texto, audios, botones, `pasa` |
| `src/lib/parser.ts` | El único parser de mensajes (texto y voz): empresa, urgencia, ★, fecha |
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
   - 🔴 vencidas, con "hace N días"
   - 🟡 vencen hoy
   - ⭐ urgentes o ★ importantes sin fecha o con fecha futura

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
🔴 1. Mandar factura de septiembre · hace 3 días
🟡 2. Llamar a Y
⭐ 3. Revisar contrato · 5 nov

PD
⭐ 4. Armar deck para inversionistas

Chelsea
⭐ 5. Cotizar proveedor nuevo
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
- `pasa N` sobre una tarea sin fecha (⭐) le pone fecha de mañana.
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

## 4. Fase 4 — Google Calendar

_Pendiente._

---

## 5. Cómo replicarlo para otra persona

Checklist completo para levantar el mismo asistente para alguien más (por
ejemplo Chelsea), desde cero hasta la primera alarma. Lo que cambia es: el bot
(token), el `chat_id`, el proyecto de Supabase y, en la fase 4, el calendario.
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
   `sql/` del repo, incluidos `sql/2026-10-asistente-fase1.sql` y
   `sql/2026-10-asistente-fase2.sql` y `sql/2026-10-asistente-fase3.sql` (y
   sus pruebas en queries aparte, ver 1b, 2b y 3b Paso 1).
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

1. Vercel → **Settings → Cron Jobs**: deben verse los dos jobs.
2. Corre la Prueba 1 de la sección 1d con el `CRON_SECRET` de ese proyecto.
3. Si llega "☀️ Hoy, …" a su chat, está listo. La primera alarma automática
   llega a las 8:00 (hora de Cancún) del siguiente lunes–sábado.

Si la persona vive en otra zona horaria, hay que cambiar dos cosas: los
horarios en `vercel.json` (están en UTC) y `CANCUN_TZ`/`CANCUN_OFFSET` en
`src/lib/asistente/cancun.ts` (ojo: el código asume una zona **sin** horario de
verano; para una zona con DST hay que calcular el offset en vez de fijarlo).

---

## 6. Costos estimados por mes

| Concepto | Fase | Costo | Nota |
| --- | --- | --- | --- |
| Vercel Pro | 1 | $20 USD / usuario | Ya se paga por GabbyHQ. Los Cron Jobs no cuestan aparte; dos corridas al día de pocos segundos no mueven la factura. |
| Supabase | 1 | $0 | Dentro del plan actual; `bot_alarmas` crece ~2 filas/día. |
| Telegram Bot API | 1 | $0 | Gratis. |
| OpenAI Whisper (`whisper-1`) | 2 | **$0.006 USD por minuto de audio** (precio de lista a octubre 2026; se cobra por segundos, redondeado). Ejemplo: 30 audios de 30 s al mes = 15 min = **$0.09 USD/mes**. Con 100 audios de 1 min = $0.60. | El tope mensual de $5 en OpenAI equivale a ~830 minutos de audio: imposible de alcanzar con uso normal. |
| LLM para `/pregunta` (`gpt-5-mini`) | 3 | **$0.25 USD / 1M tokens de entrada · $2.00 / 1M de salida** (precio de lista a octubre 2026). Una pregunta ≈ 3000 tokens de entrada (el contexto) + 150 de salida ≈ **$0.0011 USD**. Ejemplo: 20 preguntas al día × 30 días = 600 preguntas ≈ **$0.65 USD/mes**. | Si el contexto es corto (pocas tareas), baja a la mitad. Con `gpt-5-nano` cuesta ~5× menos; con Anthropic (`claude-haiku-5-5`) algo más. La consulta de costo real del mes está al final de `sql/2026-10-asistente-fase3-pruebas.sql`. |
| Google Calendar API | 4 | $0 | Gratis dentro de las cuotas normales. |

**Fase 1 total: $0 adicionales** sobre lo que ya se paga.
**Fase 2 total: ~$0.10 USD/mes** con uso normal (requiere saldo prepagado en OpenAI, mínimo $5).
**Fase 3 total: ~$0.65 USD/mes** con 20 preguntas al día. Sale del mismo saldo y del mismo tope de $5 de OpenAI.
