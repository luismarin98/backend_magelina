# Backend

Los modulos nuevos incluyen proyectos, colaboracion y mentorias, automatizaciones persistentes, auditoria nativa y controles globales. El trabajador de avisos arranca junto a la API y se detiene antes de desconectar Discord y MongoDB. Consulta docs/features.md en la documentacion del repositorio para el alcance completo y las verificaciones pendientes; ese documento no es una dependencia de compilacion.

Base implementada con Express, Mongoose y discord.js. Dependencias instaladas con lockfile; compilacion y comprobacion de tipos verificadas.

## ConfiguraciÃ³n

Requiere Node.js con soporte para `--env-file-if-exists`. Copiar `.env.example` a `.env` y completar MongoDB y las credenciales de la aplicaciÃ³n de Discord. No compartir este archivo.

El arranque valida la configuraciÃ³n, conecta MongoDB, inicia Discord y abre Express. Si alguna conexiÃ³n inicial falla, cierra los recursos. SIGINT y SIGTERM permiten un cierre ordenado.

## Endpoints pÃºblicos

- `GET /`: pagina de estado para confirmar visualmente el despliegue y consultar la disponibilidad de API, MongoDB y Discord.
- `GET /api/health`: confirma que el servidor HTTP responde.
- `GET /api/ready`: devuelve 200 cuando MongoDB y Discord estÃ¡n disponibles; 503 en caso contrario.

Al desplegar en Render, abre la URL publica del servicio para ver la pagina de estado. Puedes configurar `/api/health` como ruta de Health Check en Render.

En produccion, si Vercel sirve la dashboard y Render la API, configura un proxy `/api` en Vercel para mantener la cookie de sesion bajo el mismo origen. Registra como `DISCORD_REDIRECT_URI` en Render y en Discord Developer Portal la URL de callback bajo el dominio de Vercel: `https://TU-DASHBOARD.vercel.app/api/auth/discord/callback`. La cookie HttpOnly usa `SameSite=Lax; Secure`.

CORS permite el origen configurado de la dashboard. CORS no es autenticacion. Las consultas de servidores estan protegidas mediante sesion y comprobacion de permisos; aun no se exponen operaciones para modificarlos.

## Acceso y dashboard

Se ha agregado OAuth2 con Discord, sesiones en MongoDB, consulta de servidores administrables, lectura de roles y un resumen global exclusivo de propietarios y operadores. Configuracion, rutas y limites en [docs/access.md](../docs/access.md).

## Alcance

Solo se solicita el intent `Guilds`. No se escucha el contenido de mensajes. El modulo de solicitudes usa un menu contextual registrado explicitamente en un servidor de prueba; comprueba el mensaje seleccionado y guarda su referencia. Ver [solicitudes y tareas](../docs/workflow.md).

Pendiente: instalar dependencias, fijar resoluciÃ³n con lockfile y comprobar arranque y cierre con MongoDB y una aplicaciÃ³n de Discord de prueba. No se ha ejecutado Node ni npm para esta implementaciÃ³n. Los endpoints de consulta y cambio de solicitudes requieren sesion y permisos de administracion del servidor.

## Despliegue independiente

La configuracion por servidor se guarda en GuildSettings. Sus endpoints permiten activar solicitudes y conocimiento, configurar avisos y establecer el plazo de revision de soluciones. El historial de cambios conserva actor y valores anteriores y posteriores. Los modulos desactivados permiten consultar datos pero bloquean nuevas operaciones.

Este proyecto contiene sus propios contratos en src/types/contracts.ts y no necesita archivos de la dashboard ni de otras carpetas. Los scripts se ejecutan desde backend. build compila src a dist; start usa dist/index.js. Las credenciales y dependencias se configuran exclusivamente aqui. La dashboard se conecta mediante HTTP y tiene su propia copia de los tipos del contrato de la API.

## Diagnostico de arranque

Ejecuta `npm run build` despues de cambiar TypeScript y `npm start` desde esta carpeta. El error de arranque identifica la etapa: configuracion, conexion MongoDB, indices MongoDB, conexion Discord o API HTTP. Los errores de configuracion indican el campo sin mostrar valores; los errores de librerias se traducen a mensajes sin credenciales ni stacks.

`SESSION_SECRET` es una clave privada aleatoria de al menos 32 caracteres, independiente de DISCORD_CLIENT_SECRET. El cifrador exige al menos dos mayusculas, dos minusculas, dos numeros y dos simbolos; el arranque valida estas reglas sin imprimir la clave. Debe configurarse en `.env` y mantenerse estable entre reinicios. Cambiarla invalida cookies anteriores y afecta el descifrado de sesiones persistidas. `.env.example` contiene las variables necesarias sin valores privados.

## DNS de MongoDB Atlas

Si la consulta SRV falla con `ECONNREFUSED` y otros resolutores encuentran el cluster, configura opcionalmente `DNS_SERVERS=1.1.1.1,8.8.8.8` en `.env`. La configuracion admite hasta cuatro IP de resolutores, separadas por comas. Se aplica antes de conectar MongoDB y afecta las consultas DNS de Node en ese proceso; no modifica el DNS de Windows. Sin esta variable se conserva el resolutor predeterminado.

Se verifico que el resolutor predeterminado rechazaba la consulta SRV y que Cloudflare y Google devolvian los registros. Con DNS_SERVERS configurado, la conexion, la autenticacion y un comando ping a MongoDB fueron correctos, sin modificar datos. No se inicio el bot. La compilacion y los tipos pasan; 26 pruebas locales aprobadas y siete de integracion omitidas por falta de TEST_MONGODB_URI.

Referencia: [Mongoose: querySrv ECONNREFUSED](https://mongoosejs.com/docs/faq.html).

## Persistencia de la sesion OAuth

El inicio OAuth guarda el estado antes de redirigir a Discord. La configuracion del store conserva el cifrado y admite tanto objetos como JSON al recuperar sesiones, evitando un segundo JSON.parse incompatible con la version instalada de kruptein. Una prueba con las librerias reales y operaciones Mongo simuladas verifica el cifrado, el guardado y la recuperacion; el token sintetico no aparece en el registro cifrado.

Despues de actualizar SESSION_SECRET, reinicia el backend. Las cookies firmadas con la clave anterior quedan invalidadas. No se verifico una autorizacion OAuth completa en navegador.

## Imagenes publicas y perfil

GET /api/bot publica solo la identidad visual del bot; no incluye tokens, estado operativo, lista de comunidades ni controles. /auth/me devuelve el avatar y la decoracion del usuario verificado con identify. Una cache en memoria de hasta mil sesiones, con cinco minutos por entrada, evita consultar Discord en cada foco del navegador. El cache se descarta al cerrar sesion y no modifica el vencimiento de la cookie. Una respuesta 401 o una identidad distinta de Discord invalida la comprobacion; un fallo temporal conserva el perfil verificado anteriormente.

Los serializadores construyen URLs del CDN oficial a partir de IDs y hashes validados. /guilds incluye iconos y banners de las comunidades autorizadas. Los datos de Gateway se reutilizan para las comunidades instaladas; no se solicitan permisos OAuth adicionales ni se consultan perfiles privados.


### Roles del servidor

La dashboard permite crear roles de Discord y clasificar roles existentes como Moderador, Coordinador, Colaborador, Lector o Personalizado. La clasificacion se guarda en MongoDB (`GuildRoleBinding`) con version para detectar cambios concurrentes; no modifica permisos por si sola.

- `GET /api/guilds/:guildId/roles`: roles, tipos, opciones y permisos efectivos.
- `POST /api/guilds/:guildId/roles`: crea un rol con nombre, color, tipo y permisos de Discord seleccionados.
- `PATCH /api/guilds/:guildId/roles/:roleId/type`: clasifica un rol existente con `kind` y `version`.
- `POST /api/guilds/:guildId/roles/:roleId/apply-template`: aplica permisos internos del tipo guardado con `version` de politica y `bindingVersion`. Conserva las asignaciones de otros roles.

Gestionar roles en Discord permite abrir esta pantalla sin conceder acceso a configuracion ni permisos internos. Las escrituras nativas requieren Gestionar roles del usuario y del bot; la clasificacion respeta ambas jerarquias y excluye @everyone e integraciones. El propietario global puede actuar con los permisos del bot. Aplicar permisos internos sigue reservado a quienes pueden configurar el servidor. Las plantillas no incluyen Administrador y no asignan miembros automaticamente. Los permisos nativos de roles existentes se conservan.

Si Discord crea un rol pero falla el guardado de su tipo, la respuesta indica que debe seleccionarse el rol existente para clasificarlo, sin repetir la creacion.


### Moderacion de miembros

Pantalla independiente `/dashboard/servers/:guildId/moderation`, autorizada por permisos nativos de Discord (Moderar, Expulsar, Banear miembros o Gestionar servidor), no por el nombre de un rol. Los permisos efectivos del actor se consultan en Discord en cada peticion; el propietario global conserva su acceso administrativo.

- `GET /api/guilds/:guildId/moderation/members?after=...`: lista paginada de 30 miembros. Discord requiere habilitar Server Members Intent en Developer Portal para el listado REST; no se activa automaticamente ningun intent privilegiado en el bot. Si falta, se puede consultar por ID.
- `GET /api/guilds/:guildId/moderation/members/:memberId`: ficha actual con roles, fechas, suspension y acciones disponibles.
- `GET /api/guilds/:guildId/moderation/cases?memberId=...&before=...`: incidentes de este servidor, incluidos miembros que ya salieron. Los filtros son opcionales.
- `GET /api/guilds/:guildId/moderation/activity?memberId=...&before=...`: auditoria de Discord, filtrada por autor cuando hay memberId. Requiere Ver registro de auditoria del actor y del bot; respeta la disponibilidad del modulo de auditoria. No lee mensajes ni evalua automaticamente la conducta.
- `POST /api/guilds/:guildId/moderation/members/:memberId/cases`: `requestId` UUID v4, `action` warning/timeout/untimeout/kick/ban, `reason` (10-1000 caracteres), hasta 3 `evidence` (enlaces a mensajes de este servidor), `durationMinutes` (solo timeout, 1-40320).

Las advertencias son anotaciones internas; no envian DMs. Las sanciones verifican permisos nativos del actor y del bot y ambas jerarquias. No se actua contra el propio actor, el propietario del servidor ni bots; los administradores no pueden recibir timeout. Ban no borra mensajes. Cada caso conserva responsable, objetivo, motivo y resultado. Los enlaces a evidencias no se descargan ni se utilizan para eludir permisos de canales privados.

Antes de contactar con Discord se persiste el caso con un indice unico por servidor y requestId. Reintentar el mismo cuerpo con ese ID devuelve el caso existente; cambiar el cuerpo con el mismo ID genera conflicto. Si Discord falla por red, el resultado queda `uncertain`; si falla el guardado posterior, queda `pending`. No se reejecutan sanciones automaticamente ni se asume que no ocurrieron: deben revisarse el miembro y la auditoria antes de iniciar otra operacion. El historial de casos solo incluye acciones iniciadas desde Magelina, no sanciones previas ni conversaciones historicas.


### Musica en canales de voz (Audius)

El backend incorpora `@discordjs/voice` 0.19.2 (DAVE), `opusscript` y `ffmpeg-static`. Node 24.13.1 cumple el minimo de esta version. FFmpeg es un binario de la plataforma: instalar las dependencias en el destino, sin copiar node_modules de Windows a Linux. El hosting del bot debe mantener WebSocket y permitir trafico UDP de Discord; el frontend sigue siendo un despliegue independiente.

Puesta en marcha:
1. Reiniciar el backend para cargar GuildVoiceStates (no es un intent privilegiado).
2. En Configuracion del servidor, habilitar Musica. Los documentos anteriores reciben `modules.music=false` al leerse; no se habilita automaticamente en gremios existentes.
3. En Permisos internos, asignar Consultar musica (`music.read`), Solicitar canciones (`music.request`) y/o Controlar musica (`music.manage`). Solicitar incluye consulta; controlar incluye ambos. Los administradores nativos y el propietario global conservan su acceso completo.
4. Dar a Magelina Ver canal, Conectar y Hablar en el canal. Elegir un canal normal de voz desde Musica y conectar.
5. Buscar una pista publica gratuita de Audius y agregarla. Un usuario delegado debe estar en el mismo canal; un administrador puede operar remotamente si tiene acceso al canal. Se excluyen Stage Channels.

`AUDIUS_API_KEY` es opcional y solo se usa en el backend. Puede configurarse con una clave del plan gratuito para mejorar los limites; sin ella se utiliza el acceso publico disponible. No es necesario enlazar las cuentas de los usuarios a Audius. No se guardan tokens de usuarios ni se expone la URL de streaming.

API autenticada:
- `GET /api/guilds/:guildId/music`: estado, canales visibles y permisos efectivos.
- `GET /api/guilds/:guildId/music/search?q=...`: busqueda (2-100 caracteres), solo si el modulo esta habilitado.
- `POST /api/guilds/:guildId/music/connect`: `{ channelId, version }`.
- `POST /api/guilds/:guildId/music/queue`: `{ trackId, version }`; el servidor obtiene los metadatos de Audius y no acepta URLs arbitrarias.
- `POST /api/guilds/:guildId/music/control`: `{ action, version, value? }`; pause, resume, skip, stop, disconnect, volume (0-100), remove (ID de la entrada pendiente).

Cada mutacion se serializa por gremio y verifica la version. Una vista desactualizada recibe 409 y debe refrescar; no se reintentan escrituras automaticamente. La dashboard consulta el estado cada 10 segundos mientras la pestana esta visible y conserva la invalidacion compartida existente tras las escrituras.

Limites de la primera version: una conexion/reproductor por gremio, 25 pistas pendientes, canciones de hasta 30 minutos, volumen inicial 30%. Cola, volumen y reproduccion activos viven en memoria y se vacian al reiniciar; la configuracion y permisos siguen en MongoDB. Ejecutar un solo proceso responsable de este bot; no repartir sus APIs entre varias replicas sin coordinacion de sesiones.

Las pistas se comprueban al agregarse y al iniciar su turno. Se excluyen las que no son reproducibles, estan restringidas, ocultas, no disponibles o con condiciones de acceso. Se muestran artista, titulo y enlace a Audius. Una pista fallida se descarta y la siguiente se procesa sin bloquear toda la cola en un bucle prolongado. Se desconecta tras 60 segundos sin participantes humanos o 120 segundos conectado sin canciones. Configuracion, mantenimiento, bloqueo del gremio y movimientos del bot se comprueban cada 15 segundos para detener la sesion cuando corresponda.

El audio se obtiene solo de la ruta oficial de streaming del ID validado. Cada redireccion HTTPS se verifica y su DNS se resuelve en el socket rechazando direcciones locales/privadas. FFmpeg recibe bytes por stdin, no URLs ni rutas enviadas por el usuario, con protocolos limitados a pipe. El audio no se escribe en disco ni en MongoDB.

Validacion: pruebas unitarias y HTTP con Discord simulado, consulta real de metadatos publicos de Audius, lectura del primer fragmento de un stream (HTTP 200, sin guardarlo) y codificacion local de una muestra sintetica FFmpeg/Opus. No se conecta automaticamente el bot a un canal real durante las pruebas. La verificacion final de audio en Discord requiere iniciar el backend y conectar desde la dashboard en un canal de pruebas.


El monitor de Musica devuelve `player.positionMs` (posicion del recurso de audio) y `player.observedAt` en cada lectura, sin modificar la version de la cola. Tambien devuelve el numero de oyentes humanos del canal autorizado; se excluyen bots. La dashboard muestra portada, cancion, canal, solicitante, progreso aproximado, cola, tiempo pendiente y volumen. El progreso avanza localmente entre muestras y queda detenido durante la pausa; se refresca al recuperar el foco o la visibilidad de la pestana. El monitoreo requiere music.read y no concede controles adicionales.

### Recursos de la instancia

Centro de control > Estado del bot consulta `GET /api/admin/resources` cada cinco segundos con la pantalla visible. Requiere una sesion de propietario u operador. El endpoint no modifica recursos ni ajustes de Render, y comparte una muestra durante dos segundos para evitar lecturas excesivas.

En Linux lee consumo y cuotas de cgroups v2 o v1, incluidos limites mas estrictos de ancestros visibles. CPU se expresa en vCPU consumidas durante el intervalo entre muestras; la primera lectura no calcula uso de CPU. Memoria se expresa en bytes del contenedor e incluye procesos auxiliares y memoria contabilizada por el sistema. Sin contadores del contenedor se informa solo el proceso Node; sin cuota detectable no se inventan limites usando los recursos de la maquina anfitriona. Los limites detectados son los visibles para la instancia, no una consulta al plan o la facturacion de Render. Contrastar con el tipo de instancia y las metricas del servicio en Render.

El porcentaje es consumo / limite * 100. El margen hasta el limite es max(0, limite - consumo). El objetivo recomendado es 80% del limite y el margen hasta ese objetivo es max(0, limite * 0.8 - consumo). Se muestra aviso desde 80% y estado critico desde 90%. Son referencias visuales: no aplican throttling, no paran canciones y no estiman cuantos servidores adicionales caben. No requiere nuevas variables de entorno.
