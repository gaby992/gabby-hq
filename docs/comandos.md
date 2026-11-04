# GabbyHQ — Chuleta del bot de Telegram

> Generado desde `src/lib/asistente/comandos.json` con `npm run comandos`. No editar a mano.

Todo se le dice al bot en texto o por voz, como hablas. Los números son los de la última lista que te mandó; también vale una palabra del título.

Es lo mismo que manda el bot con `/ayuda todo`. La guía técnica está en [asistente.md](asistente.md).

## 👀 Ver

- `/hoy` — la lista completa de hoy, por empresa (la misma de las 8:00)
- `cierre` — el cierre del día (el mismo de las 6:00 pm)
- `¿qué sigue?` — una tarea para ahora, tres después, tres por vencer y tus notas recientes
- `solo urgentes` — lo mismo, sin la parte de "por vencer"
- `qué vence esta semana` — solo lo que vence de aquí al domingo
- `qué sigue de IM` — lo mismo, pero solo de esa empresa
- `/pendientes IM` — todo lo abierto de IM, numerado
- `qué tengo esperando` — lo que está en manos de alguien más (la columna ⏳ del tablero), numerado; no entra en "qué sigue" ni en "Hoy sí o sí"
- `correos · correos de Chelsea` — todos los correos pendientes de esa cuenta (o de todas), numerados por urgencia; luego "el 3 lo hago yo", "el 2 para Chelsea", "archiva el 5". La línea se tacha sola cuando se resuelve
- `el 5 es silencio · el 5 es solo app · el 5 es alerta` — aprende ese remitente (su dominio, o el email si es gmail/outlook) en la lista de esa cuenta y aplica el nivel al correo; "archiva el 5 y márcalo como silencio" hace las dos cosas. Si ya estaba en otra lista, lo mueve y te lo dice
- `¿qué cerré ayer?` — pregunta libre: te contesta con tus tareas y notas (también "? qué tengo hoy")
- `mis alarmas` — tus alarmas pendientes, numeradas
- `pagos de IM` — los pagos recurrentes de esa empresa; "qué pagos hay esta semana" filtra

## ➕ Agregar

- `urgente IM llamar a Juan mañana 3pm` — tarea con urgencia, empresa, fecha y hora, en el orden que quieras
- `para PD: mandar propuesta el viernes` — otra forma de decir la empresa
- `revisar contrato el 15 de noviembre` — si falta empresa o urgencia, te pregunta con botones
- `IM revisar propuesta el viernes y ponla en calendar` — además crea el evento en Google Calendar (sin hora, te pregunta a qué hora)
- `alarma mañana 9am revisar pagos` — alarma propia: te llega un ⏰ a esa hora (no es una tarea)
- `recuérdame el viernes a las 10 llamar al contador` — lo mismo, dicho de otra forma; "avísame en 2 horas …" también
- `nota IM: vamos por la propuesta 2` — la nota "por dónde iba" de IM (reemplaza la que había)
- `nota IM + ya respondió el cliente` — agrega una línea a esa nota; "nota IM:" sola la borra
- `nota en paypal: ya mandé el de marzo` — comentario con fecha al pie de esa tarea
- `radar probar Notion para clientes` — una idea para el Radar, no una tarea
- `🎤 audio` — todo lo de arriba dictado (máximo 2 minutos); te repite lo que entendió

## ✅ Actuar sobre tareas

- `listo 3` — la cierra (también "el 3 ya está", "listo paypal")
- `pasa 2,5` — las pasa a mañana; "pasa todo" mueve toda la lista
- `pasa el 5 al lunes` — a otro día: mañana, el viernes, en 3 días, el 15 de noviembre…
- `9 cancelar, no se va a hacer` — queda cerrada con la nota "cancelada — no se va a hacer"; no se borra
- `borra 3` — la elimina de verdad, siempre con botón de confirmación (también "bórrala")
- `11 se llama URo pendiente` — le cambia el título
- `paypal urgente` — cambia la urgencia; "paypal para el viernes" la fecha; "paypal es de PD" la empresa; "paypal mañana 3pm" fecha y hora
- `la 5 es de PD` — le pone empresa a una tarea "sin empresa" (o se la cambia) por su número de la última lista; en la web, el badge gris "sin empresa" de la tarjeta abre el selector
- `pon en calendar la de TOTT` — crea el evento de una tarea que ya existe
- `la de TOTT está esperando a Andrew` — la deja en ⏳ Esperando con "de quién" (también "la 3 esperando a Juan"); "la de TOTT ya no espera" / "la 3 vuelve a mí" la retoma
- `la anterior es urgente` — "la anterior" = la última tarea de la que hablaste
- `quita alarma 2` — borra una alarma propia (número de "mis alarmas")

## 🧾 Varias de una vez

- `1 listo · 3 terminado · 2, 5 hechas` — cierra esos números de la última lista que te mandé (la de las 8, el cierre, "qué sigue", una pedida o la de correos), sin pasar por el modelo
- `1 terminado / 9 cancelar no se va hacer / 11 se llama URo, pasar para mañana / 12 pasar para mañana` — te muestra el plan numerado y esperas [✅ Hacer todo] o [✏️ No, corrijo]; nada se ejecuta antes
- `el 3 ya está y pasa el 4 al lunes` — dos órdenes en una frase, separadas por "y", comas o barras
- `alarma mañana 3pm revisar pagos y agrégala como tarea` — una alarma y una tarea a la vez
- `el 2 es urgente y es de IM` — varios cambios a la misma tarea en una línea
- `sí · la segunda · esa no, la otra · lo mismo para PD` — el bot recuerda lo último que hablaron (30 min): respuestas cortas funcionan
- `organízame` — repasa tus pendientes uno por uno con botones (también "no sé por dónde empezar", "estoy abrumada"); "para" sale
- `olvida lo anterior` — limpia la conversación y empieza de cero
- `mañana los correos de Chelsea, el miércoles armar el equipo de marketing y el jueves pasar $500 a WSH` — tu semana en un mensaje: la arma por día, sin duplicar lo que ya existía, y te la muestra para que digas "así queda"
- `quita el marketing repetido · déjala donde estaba · la de marketing a las 10 · olvídalo` — corrige el plan antes de aprobarlo: te muestra solo lo que cambia y vuelve a preguntar; nunca borra ni completa una tarea por una corrección
- `el correo de Andrew lo hago yo · el 15 para Chelsea · archiva los de marketing de hoy` — decide correos sin botones: lo hago yo / tarea crean la tarea con el Ref del correo; archivar lo saca del inbox de Gmail; varios a la vez pasan por el plan. Un correo respondido o pasado a Chelsea conserva [Lo hago yo] 48 h en su alerta
- `me da flojera armar el equipo de marketing` — la parte en 3-5 pasos (subtareas) y te dice solo el primero; "siguiente paso" avanza

## ℹ️ Otros

- `/ayuda` — el resumen corto; "/ayuda todo" manda esta guía completa
- `botones` — aparecen cuando falta empresa o urgencia, cuando varias tareas coinciden, antes de borrar, y en cada ⏰ (Listo · +1h · Mañana)
- `"No te entendí"` — si no capta la frase, te pregunta si es una tarea nueva, una orden o una alarma
- `hora de Cancún` — "hoy", "mañana" y las horas van en hora de Cancún; "el viernes" siempre es el próximo viernes
- `en la web` — /hoy (tablero por horizonte: Hoy sí o sí · Mañana · Esta semana · Esperando · Después · Correos, arrastra las tarjetas; pestañas Prioridad y Empresas; ¿Qué sigue?), /tasks (tareas y notas), /correo, /settings (empresas, Conexiones de Google, Pagos recurrentes)
