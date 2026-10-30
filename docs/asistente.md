# GabbyHQ — Asistente personal por Telegram

Este documento explica, paso a paso y sin dar nada por sabido, cómo funciona el
asistente de Telegram de GabbyHQ, qué hay que hacer a mano para que arranque, y
cómo replicarlo para otra persona. Se construye en 4 fases; cada una tiene su
sección y **no se empieza una fase hasta validar la anterior**.

| Fase | Qué agrega | Estado |
| --- | --- | --- |
| 1 | Alarmas 8:00 am y 6:00 pm | ✅ Validada |
| 2 | Notas de voz (Whisper) | ✅ Construida — pendiente de validar |
| 3 | `/pregunta` (Claude) | ⏳ Pendiente |
| 4 | Google Calendar | ⏳ Pendiente |

---

## 0. Qué es y cómo funciona

GabbyHQ es una app web (Next.js) desplegada en **Vercel**, con los datos en
**Supabase** (Postgres). El bot de Telegram no es un programa aparte: es una
ruta más de esa misma app. Nada vive en n8n ni en otro servidor.

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
| `src/lib/asistente/alarmas.ts` | Arma los mensajes, los manda, reintenta, guarda la numeración |
| `src/lib/asistente/pasa.ts` | El comando `pasa 2,5` / `pasa todo` |
| `src/lib/asistente/telegram.ts` | Envío HTML, partición a 4000 caracteres, lista de chats permitidos |
| `src/lib/asistente/cancun.ts` | Fechas en hora de Cancún |
| `src/lib/asistente/cron-auth.ts` | Verifica el `CRON_SECRET` |
| `sql/2026-10-asistente-fase1.sql` | Migración de la fase 1 (correr en una query) |
| `sql/2026-10-asistente-fase1-pruebas.sql` | Pruebas con rollback de la fase 1 (correr después, en otra query) |
| `sql/2026-10-asistente-fase2.sql` | Migración de la fase 2 (correr en una query) |
| `sql/2026-10-asistente-fase2-pruebas.sql` | Prueba con rollback de la fase 2 (correr después, en otra query) |

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
   una tarea: por ahora responde "Eso lo entenderé en la siguiente fase 🙂".
   La fase 3 lo conectará con Claude.

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

## 3. Fase 3 — `/pregunta` (Claude)

_Pendiente._

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
   `sql/2026-10-asistente-fase2.sql` (y sus pruebas en queries aparte, ver 1b
   y 2b Paso 1).
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
   gasto, ver 2b), `NEXT_PUBLIC_SUPABASE_URL`,
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
| Anthropic (Claude) | 3 | _se estima en la fase 3_ | Depende del modelo y de cuánto contexto se mande por pregunta. |
| Google Calendar API | 4 | $0 | Gratis dentro de las cuotas normales. |

**Fase 1 total: $0 adicionales** sobre lo que ya se paga.
**Fase 2 total: ~$0.10 USD/mes** con uso normal (requiere saldo prepagado en OpenAI, mínimo $5).
