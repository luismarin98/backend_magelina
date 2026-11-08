# Lavalink local

Magelina conserva comandos, permisos, cola, playlists, dashboard y avisos. Con
`MUSIC_ENGINE=lavalink`, Lavalink extrae y envia audio a Discord, incluido YouTube;
no utiliza yt-dlp ni `@discordjs/voice` para esas conexiones. Todo sigue en la PC.

## Preparacion

```powershell
npm install
npm run lavalink:prepare:youtube
npm run build
```

Se instalan dentro de `.tools/lavalink/`, sin modificar Java ni PATH del sistema:

- Lavalink 4.2.2 y Java 21 portable, con SHA-256 oficial.
- youtube-plugin SABR `02f536d9ac05b4bb0f91dedc19f964f30fc18559`, con SHA-256
  oficial, mas una compilacion local del PR abierto #229, revision
  `1ddb648257d5b547aa1e2dfb8104edf6cb1089be`, para tokens PO por video.
- yt-cipher con Deno portable y yt-dlp/ejs fijado a una revision.
- webpo-generator `682ac9fbfb64948a8b518551011138486c560207`, con `npm ci`.
- Compilador Eclipse ECJ 3.40.0, verificado con el SHA-1 publicado en Maven Central.

El plugin con tokens PO **es experimental y no es una version estable publicada**.
`build-youtube-po.mjs` compila el codigo del PR contra las dependencias del nodo y
actualiza sus clases en el JAR SABR. No modifica ese codigo fuente.
`lavalink:prepare` vuelve a aplicar la compilacion si el generador ya esta preparado.
Ejecutar las preparaciones con el host detenido: reemplazan el JAR del plugin.

Las claves aleatorias permanecen en `.env.lavalink`, excluido de Git. No copiarlas
a `.env` ni `.env.pc`. Los servicios escuchan solo en 127.0.0.1: Lavalink en 2333,
firmas en 8001 y tokens PO en 8002. No usan cookies, cuentas personales ni servicios
publicos de firmas o tokens. El servicio PO resuelve retos de YouTube localmente;
yt-cipher usa dos workers y PO uno. El heap Java tiene un maximo de 512 MiB;
el consumo total del conjunto es mayor y se realiza en esta PC.

## Arranque y cierre

En `.env.pc` (perfil del host):

```dotenv
MUSIC_ENGINE=lavalink
LAVALINK_URL=http://127.0.0.1:2333
YOUTUBE_EXPERIMENTAL=true
```

```powershell
npm run host:pc -- -RenderStopped
npm run host:stop
```

El lanzador inicia primero firmas, tokens y Lavalink; espera su disponibilidad y
despues inicia el mismo bot. Guarda registros en `.cache/lavalink-*.log`.
Al cerrar, libera los reproductores y termina los auxiliares que inicio. Si ya
estaban iniciados en otras terminales, los reutiliza y no los detiene.
No arrancar dos instancias del bot. Un reinicio descarta la cola en memoria.

Para uso manual o desarrollo, abrir los auxiliares en terminales separadas:

```powershell
node scripts/lavalink-local.mjs start-cipher
node scripts/lavalink-local.mjs start-pot
npm run lavalink:start
```

En ese caso se cierran con Ctrl+C en cada terminal. `.env` sigue siendo el perfil
de desarrollo; `.env.pc` es independiente. Para volver al motor anterior, poner
`MUSIC_ENGINE=direct` en el perfil utilizado y reiniciar.

## Verificacion

```powershell
npm run lavalink:check
npm run probe:lavalink -- oOi3oJmfz4o
node scripts/lavalink-local.mjs probe-frames oOi3oJmfz4o 225
```

La primera consulta el nodo; la segunda solo carga metadatos. `probe-frames` consume
audio mediante Lavaplayer y el mismo plugin, sin conectarse a Discord ni guardar
la cancion. Cuenta tramas de 20 ms; limita el objetivo a un segundo antes de la
duracion indicada. Decodifica tan rapido como llegan los datos, no en tiempo real.
Devuelve tiempo al primer audio y milisegundos decodificados, sin URLs ni tokens.

El 7 de noviembre de 2026 se verificaron 220 s de `oOi3oJmfz4o` y 172 s de
`cl_mQplBecI`; el primer audio llego en aproximadamente 3,9 s y 2,8 s. Sin PO,
la rama SABR fallaba a los 60 s con HTTP 403. Esto verifica extraccion y
decodificacion; falta comprobar sonido y estabilidad de voz en un canal real.

`TrackStartEvent` ocurre antes de extraer audio. Magelina espera ademas progreso
con voz conectada antes de anunciar "Ahora suena". Clasifica los errores de la
fuente sin publicar URLs privadas; eventos viejos no avanzan otra vez la cola.
La cola pendiente se conserva al perder la conexion, y el cliente intenta
reconectarse al nodo. Los bloqueos de YouTube aun pueden afectar videos concretos.

Fuentes: [Lavalink](https://lavalink.dev/),
[youtube-source PR #229](https://github.com/lavalink-devs/youtube-source/pull/229),
[yt-cipher](https://github.com/kikkia/yt-cipher),
[webpo-generator](https://github.com/ashton045/webpo-generator).
