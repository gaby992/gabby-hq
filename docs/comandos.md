# GabbyHQ — Chuleta del bot de Telegram

> Generado desde `src/lib/asistente/comandos.json` con `npm run comandos`. No editar a mano.

Todo se le dice al bot en texto o por voz, como hablas. Los números son los de la última lista que te mandó; también vale una palabra del título.

Es lo mismo que manda el bot con `/ayuda todo`. La guía técnica está en [asistente.md](asistente.md).

## 👀 Ver

- `/hoy` — la lista completa de hoy, por empresa (la misma de las 8:00)
- `/resumen` — tu resumen como imagen: tus correos VIP (con si falta hacer algo o no) y tus tareas de hoy y vencidas, con su empresa
- `cierre` — el cierre del día (el mismo de las 7:30 pm)
- `¿qué sigue?` — una tarea para ahora, tres después, tres por vencer y tus notas recientes
- `solo urgentes` — lo mismo, sin la parte de "por vencer"
- `qué vence esta semana` — solo lo que vence de aquí al domingo
- `qué sigue de IM` — lo mismo, pero solo de esa empresa
- `/pendientes IM` — todo lo abierto de IM, numerado
- `¿qué tengo hoy? · ¿qué me queda pendiente?` — te lo cuenta en un párrafo (qué no puede esperar, qué lleva más de un mes vencido, cuántos correos piden respuesta) y debajo la lista corta numerada; cierra proponiendo por dónde arrancar. También el botón 📋 Hoy del menú
- `¿qué tengo mañana?` — lo de mañana narrado y numerado (botón 📅 Mañana)
- `¿qué hay esta semana?` — por día, de lunes a domingo, con lo vencido que arrastras
- `¿cómo va IM?` — el estado de una empresa en prosa: abiertas, vencidas, esperando, correos pendientes y la nota "por dónde iba"
- `¿qué tengo estancado?` — tareas sin moverse en 14+ días y lo que lleva 3+ días esperando; te propone pasarlas a Después como plan [✅ Hacer todo] [✏️ No, corrijo], y corriges ("cancela la 2", "la 3 déjala")
- `mándame el tablero` — una foto del tablero (KPIs + Hoy sí o sí · Mañana · Esperando · Correos) con el botón 🖥 Abrir tablero; también llega sola antes de la alarma de las 8 y del cierre (botón 🖥 Tablero)
- `qué tengo esperando` — a quién esperas y desde cuándo, en prosa, y debajo la lista ⏳ numerada (botón ⏳ Esperando); no entra en "qué sigue" ni en "Hoy sí o sí"
- `correos · correos de Chelsea · lo más importante de los correos de PD · mi correo de IM` — cualquier frase que mencione correos pide correos (nunca tareas): te cuenta en un párrafo cuántos hay, cuáles urgen y quién espera respuesta, y debajo la lista numerada por urgencia; "Chelsea" ahí es el buzón IM Chelsea (coincidencia parcial sobre el nombre o el email de la cuenta; si hay varias, botones). "lo más importante" / "urgentes" / "qué necesita respuesta" deja solo alta + necesita respuesta. Luego "el 3 lo hago yo", "el 2 para Chelsea", "archiva el 5". La línea se tacha sola cuando se resuelve
- `el 5 es silencio · el 5 es solo app · el 5 es alerta` — aprende ese remitente (su dominio, o el email si es gmail/outlook) en la lista de esa cuenta y aplica el nivel al correo; "archiva el 5 y márcalo como silencio" hace las dos cosas. Si ya estaba en otra lista, lo mueve y te lo dice
- `¿qué cerré ayer?` — pregunta libre: te contesta con tus tareas y notas (también "? qué tengo hoy")
- `mis alarmas` — las alarmas que todavía te aviso por aquí (temporizadores y las viejas); las que tienen hora están en tu Google Calendar con ⏰
- `pagos de IM` — los pagos recurrentes de esa empresa; "qué pagos hay esta semana" filtra

## ➕ Agregar

- `urgente IM llamar a Juan mañana 3pm` — tarea con urgencia, empresa, fecha y hora, en el orden que quieras
- `para PD: mandar propuesta el viernes` — otra forma de decir la empresa
- `revisar contrato el 15 de noviembre` — si falta empresa o urgencia, te pregunta con botones
- `IM revisar propuesta el viernes y ponla en calendar` — además crea el evento en Google Calendar (sin hora, te pregunta a qué hora)
- `alarma mañana 9am revisar pagos` — queda en tu Google Calendar con ⏰ y te suena en el teléfono a esa hora exacta (no es una tarea). Si Calendar falla, te avisa por aquí y te dice por qué
- `alarma: pago del seguro los días 10 y 20 de cada mes a las 10 am` — alarmas que se repiten: cada mes, cada semana ("todos los lunes a las 9") o cada día. Una por cada día que digas
- `recuérdame el viernes a las 10 llamar al contador` — lo mismo, dicho de otra forma: va a tu calendario
- `avísame en 20 minutos revisar el horno` — un temporizador: ese sí te llega por aquí (✅ Listo · ⏰ +1h · 📅 Mañana), y si lo pospones se actualiza el mismo mensaje
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

## 📂 Archivero (segundo cerebro)

- `(le mandas un PDF o una foto)` — lo guarda en privado, lo lee y te propone la ficha (título, categoría, empresa, vencimiento, monto) con 💾 Guardar y ✏️ Corregir. Nada se archiva hasta que tocas Guardar
- `(varias fotos seguidas)` — te pregunta si son páginas del mismo documento y las junta en uno solo
- `(una versión nueva de algo que ya tienes)` — te pregunta si reemplaza a la anterior; la vieja queda en el historial, no se borra, y el vencimiento que cuenta es el nuevo
- `el título es Póliza del carro 2027` — después de ✏️ Corregir: cambia solo eso y te muestra la ficha otra vez. También «vence el 15 de marzo», «es de IM», «categoría seguros», «quítale el vencimiento»
- `guarda: el seguro del carro es con GNP, se paga en marzo` — un dato suelto, sin archivo: entra al archivero y sale en las búsquedas igual que un documento
- `¿con quién tengo el seguro del carro?` — te contesta con el dato exacto y el enlace para abrir el documento (el enlace caduca en una hora)
- `¿cuánto pago de alquiler? · ¿cuándo vence mi pasaporte?` — lo mismo: busca en el texto de los PDF, no solo en los títulos
- `mándame el contrato de Bonampak` — te manda ese documento con su enlace
- `(archivo de más de 20 MB)` — Telegram no deja bajarlo: te lo dice y te manda a subirlo en GabbyHQ → Archivos

## 🧭 Organizarte (Gabita conversando)

- `necesito tiempo para CPT esta semana, no sé cuándo` — no te devuelve la pregunta: te propone días, bloques y horas de TU semana, y cierra con «¿Lo dejo así?»
- `tengo que hacer primero la reunión, luego recolectar la información y luego 6 horas de crear el agente, para el viernes 20` — reparte los pasos en orden en tus bloques, con su tiempo, y te avisa si no cabe antes de esa fecha
- `sí, déjalo así` — crea esas tareas con sus fechas y su duración
- `¿me da tiempo de terminar lo de PTHO para el viernes?` — mira lo que ya tienes en cada bloque y te contesta con criterio
- `mañana revisar el contrato de CPT, toma 2 horas` — la tarea se guarda con su duración, y así «Hoy te toca» sabe si el bloque alcanza
- `(en la web) Resumen → Hoy te toca` — tus bloques de hoy, lo fijo de cada uno y las tareas que caen ahí; ⚠️ cuando no caben en las horas
- `(en la web) Settings → Mi semana` — cambias tus bloques, las horas, de qué es cada uno y lo que cambia según el día del mes

## ℹ️ Otros

- `/ayuda` — el resumen corto; "/ayuda todo" manda esta guía completa
- `mis alarmas · quita alarma 2 · quita las alarmas de pago · quita todas las alarmas` — las que todavía te aviso por aquí (las que tienen hora están en tu Google Calendar)
- `pasa mis alarmas al calendario` — muda a Google Calendar todas las alarmas que quedaban por aquí
- `/menu · /ocultar` — el menú fijo bajo el teclado: 📋 Hoy · 📅 Mañana · ⏳ Esperando · 📧 Correos · 🎯 ¿Qué sigue? · 🖥 Tablero. Cada botón es una de estas preguntas; aparece solo con el primer mensaje y con cada alarma de las 8
- `botones` — aparecen cuando falta empresa o urgencia, cuando varias tareas coinciden, antes de borrar, y en cada ⏰ (Listo · +1h · Mañana)
- `eso no son correos, son tareas · no, me refería a los correos de PD` — corrige cómo leyó tu último mensaje: lo reconoce («Tienes razón, lo leí mal») y lo reintenta con la otra lectura, sin tomarlo como una orden nueva
- `"No te entendí"` — si no capta la frase, te pregunta si es una tarea nueva, una orden o una alarma
- `hora de Cancún` — "hoy", "mañana" y las horas van en hora de Cancún; "el viernes" siempre es el próximo viernes
- `en la web` — /hoy (tablero por horizonte: Hoy sí o sí · Mañana · Esta semana · Esperando · Después · Correos, arrastra las tarjetas; pestañas Prioridad, Empresas y Calendario; ¿Qué sigue?; y el chat 💬 abajo a la derecha: el mismo asistente que en Telegram, misma conversación, mismos planes con botones; el tablero se refresca solo), /tasks (tareas y notas), /correo, /settings (empresas, Conexiones de Google, Pagos recurrentes)

## 📁 Proyectos (lo que tiene un final)

- `proyecto nuevo: agente de CPT, DATAVIA, sale el 30 de noviembre` — abre el proyecto; te pide lo que falte (qué es terminado, producción, pruebas)
- `proyecto asistente del curso: terminado es que Kenny anote tareas por Telegram; producción 14 y 15, pruebas del 16 al 20, sale el 21. Pasos: construirlo el sábado 14, dos horas; revisarlo el domingo 15` — el proyecto completo con sus pasos, de un solo mensaje
- `agrégale al proyecto del curso el paso grabar el video, para el jueves` — un paso nuevo dentro de un proyecto que ya existe
- `¿cómo van mis proyectos?` — cada proyecto con su fecha de salida, avance y lo que falta definir

## 📨 El canal de Chelsea

- `/canal` — conecta el bot de Chelsea a GabbyHQ y te manda ahí su resumen de prueba
- `/resumen (en el chat de Chelsea)` — el resumen de Chelsea como imagen: sus correos VIP (con si falta hacer algo o no) y todas sus tareas
