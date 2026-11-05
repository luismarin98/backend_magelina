# Prueba local de Lavalink

Magelina conserva comandos, permisos, cola, playlists, dashboard y avisos. El motor
`lavalink` sustituye la extraccion y el envio de audio, incluidos los de YouTube;
no utiliza yt-dlp ni `@discordjs/voice` para esas conexiones. `direct` conserva el
motor anterior. Solo se admite un nodo local en `127.0.0.1` en esta integracion.

## Preparar e iniciar el nodo

```powershell
npm install
npm run lavalink:prepare
npm run lavalink:start
```

El instalador para Windows x64 descarga Lavalink 4.2.2, youtube-plugin 1.18.2 y
Java 21 portable de sus fuentes oficiales y comprueba SHA-256. Los guarda en
`.tools/lavalink/`; no cambia Java ni PATH del sistema. La clave aleatoria queda
en `.env.lavalink`, excluido de Git, y la configuracion del nodo tambien queda
dentro de `.tools/`. Escucha en `127.0.0.1:2333`, sin exponerlo por Funnel. El heap
de Java tiene un maximo de 512 MiB; el consumo total del proceso puede ser mayor.

Con el nodo iniciado, desde otra terminal:

```powershell
npm run lavalink:check
npm run probe:lavalink -- oOi3oJmfz4o
node scripts/lavalink-local.mjs probe-audio oOi3oJmfz4o 180
```

La primera prueba consulta el estado; la segunda solo carga metadatos. La tercera
decodifica audio en tiempo real sin conectarse a Discord ni guardar la cancion.
Cargar metadatos correctamente no demuestra que YouTube entregue el audio.

Tambien se puede comprobar el flujo del reproductor sin conectar a Discord:

```powershell
node scripts/lavalink-local.mjs probe-player oOi3oJmfz4o
```

Esta comprobacion crea un reproductor temporal en el nodo y observa sus eventos
durante 20 segundos. No envia sonido a ningun canal. Un evento de inicio sin
excepciones no demuestra reproduccion audible ni continuidad de la cancion
completa. El endpoint `/youtube/stream` de la prueba de decodificacion y el flujo
del reproductor pueden dar resultados diferentes; confirmar en un canal real.

## Componente opcional de firmas de YouTube

Si el plugin no logra abrir el audio, el proyecto youtube-source recomienda
yt-cipher. Este componente adicional descarga Deno portable y codigo oficial de
`kikkia/yt-cipher` y `yt-dlp/ejs`, y ejecuta un servicio con permisos de red y
archivos. Solo debe prepararse si se ha decidido utilizarlo:

```powershell
node scripts/lavalink-local.mjs prepare-cipher
node scripts/lavalink-local.mjs start-cipher
```

El servicio escucha en `127.0.0.1:8001`, usa su propia clave local y dos workers.
Mantenerlo iniciado y reiniciar Lavalink para que lea la configuracion generada.
No se usa un servidor publico de firmas, OAuth ni cookies de cuentas personales.
Su cache y su archivo de dependencias quedan dentro de `.tools/lavalink/`.

## Activar Magelina despues de verificar el audio

En el perfil usado para arrancar el bot (`.env.pc` para el host local, o `.env`
para desarrollo):

```dotenv
MUSIC_ENGINE=lavalink
LAVALINK_URL=http://127.0.0.1:2333
YOUTUBE_EXPERIMENTAL=true
```

No copiar la clave a otros archivos: el backend lee `.env.lavalink` si no hay
`LAVALINK_PASSWORD` explicitamente configurada. Arrancar desde la raiz del backend.

Detener la instancia anterior antes de iniciar otra. Un reinicio del backend
descarta su cola en memoria. Con Lavalink y, si se utiliza, yt-cipher iniciados:

```powershell
npm run build
npm run host:check
npm run host:pc -- -RenderStopped
```

Se conecta al mismo bot de Discord; no se debe iniciar una segunda instancia.
La integracion espera el evento de inicio de Lavalink antes de marcar la pista
como reproduciendose. Los controles asincronos se aplican antes de actualizar
el estado y los eventos de pistas anteriores no avanzan otra vez la cola.

Para volver al motor anterior, usar `MUSIC_ENGINE=direct` y reiniciar el backend.
Detener los procesos auxiliares con Ctrl+C en sus terminales.

`npm run host:stop` detiene el backend y su conexion con Lavalink; no detiene
los servicios Java y yt-cipher. El cierre del backend espera la liberacion de
los reproductores y desactiva la reconexion del cliente. Un limite de 10 segundos
impide que conexiones residuales mantengan vivo un backend que ya se esta cerrando.

Fuentes: [Lavalink](https://lavalink.dev/),
[youtube-source](https://github.com/lavalink-devs/youtube-source),
[Shoukaku](https://github.com/shipgirlproject/Shoukaku),
[yt-cipher](https://github.com/kikkia/yt-cipher).
