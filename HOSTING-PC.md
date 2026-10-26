# Magelina en Windows con Tailscale Funnel

El frontend permanece en Vercel. La API y el bot se ejecutan en esta PC. Funnel publica HTTPS hacia `127.0.0.1:3000`; Discord recibe el audio directamente desde la PC, no desde Funnel. No se necesita abrir un puerto en el router.

## Preparacion

1. Instalar [Tailscale oficial para Windows](https://tailscale.com/download/windows) e iniciar sesion en la aplicacion. Usar el plan Personal si corresponde al uso no comercial del proyecto.
2. Desde `backend_magelina`, ejecutar:

```powershell
npm run build
npm run host:prepare
npm run host:check
```

`host:prepare` copia las credenciales del `.env` existente al archivo privado `.env.pc` y agrega el perfil de produccion. No imprime secretos y no modifica `.env`. Ambos archivos deben permanecer fuera de Git. Si ya existe `.env.pc`, lo conserva. Si las credenciales del entorno local difieren de Render, usar en `.env.pc` las del mismo bot y base de datos; conservar SESSION_SECRET mantiene la posibilidad de recuperar sesiones existentes. No compartir ese archivo por chat.

El perfil esperado es:

```dotenv
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
TRUST_PROXY=true
DASHBOARD_ORIGIN=https://magelina-five.vercel.app
DISCORD_REDIRECT_URI=https://magelina-five.vercel.app/api/auth/discord/callback
YOUTUBE_EXPERIMENTAL=true
YTDLP_PATH=.tools/yt-dlp.exe
```

MongoDB debe permitir la conexion desde la IP publica actual de la casa. Agregar esa IP a la lista de acceso de Atlas si corresponde. La verificacion previa valida configuracion y binarios; la conexion a MongoDB y Discord se comprueba al arrancar.

## Publicar el tunel y realizar el cambio

1. Con Tailscale conectado, ejecutar:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg http://127.0.0.1:3000
```

Abrir la URL de autorizacion que indique Tailscale si solicita habilitar Funnel/HTTPS. Este paso publica el puerto local cuando el backend este encendido. La aplicacion conserva su autenticacion y sus permisos. Anotar la URL HTTPS `.ts.net` y no renombrar la maquina ni la red durante la migracion.

2. Suspender el backend en Render antes de iniciar el bot en la PC para no ejecutar dos instancias del bot y sus trabajadores sobre la misma base de datos. No es necesario eliminar el servicio de Render.
3. Iniciar el backend desde una terminal normal:

```powershell
npm run host:pc -- -RenderStopped
```

El parametro confirma que ya se suspendio Render; no lo suspende por si mismo. El lanzador evita una segunda sesion iniciada con el mismo script. Mantiene Windows despierto mientras corre y restaura el comportamiento normal al terminar. No modifica permanentemente el plan de energia. Cerrar la tapa, apagar la PC o perder internet puede interrumpir el servicio. La terminal debe permanecer abierta; Ctrl+C detiene el host. No configura un servicio ni una tarea de inicio automatico.

Se establece un maximo de 512 MiB para el heap de JavaScript. No es un limite de RAM total: buffers, FFmpeg y yt-dlp usan memoria adicional. Medir el consumo con una reproduccion antes de sumar canales.

4. Desde `dashboard_magelina`, ejecutar con la direccion real obtenida de Funnel:

```powershell
node scripts/use-pc-backend.mjs https://EQUIPO.RED.ts.net
```

Este comando verifica `/api/ready`, la redireccion inicial hacia Discord y la cookie Secure/HttpOnly antes de cambiar localmente el destino de `/api` en `vercel.json`. Mantiene la regla de React a `/index.html`. No despliega ni hace commits. Si la comprobacion de cookie falla, revisar como el proxy comunica HTTPS; no quitar Secure.

5. Subir y desplegar el cambio del frontend en Vercel. Mantener `VITE_API_URL` sin definir y el callback registrado en Discord exactamente en `https://magelina-five.vercel.app/api/auth/discord/callback`.
6. Verificar desde Vercel: `/api/ready` devuelve `ready`, iniciar sesion, confirmar `/api/auth/me` con 200, entrar a una comunidad, conectar a voz y reproducir una cancion. Comprobar una cuenta sin permisos administrativos. Revisar que no haya cortes con la PC en uso normal.

## Operacion y vuelta a Render

Funnel con `--bg` conserva su configuracion tras reiniciar Tailscale; el backend requiere volver a ejecutar su lanzador. Los usuarios no necesitan instalar Tailscale. Funnel esta en beta y tiene limites de ancho de banda no configurables; este montaje depende de la disponibilidad de la PC y de la conexion domestica.

Para dejar de publicar la API:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --https=443 off
```

Para volver a Render: detener primero el bot local con Ctrl+C, reactivar Render y verificar que este listo. Restaurar solo el destino de API en `dashboard_magelina/vercel.json` a `https://backendmagelina.onrender.com/api/:path*` y redesplegar Vercel. Conservar la regla a `/index.html`.

Si Windows se cerro inesperadamente y queda `.cache/host-pc.lock`, verificar que no siga ejecutandose el host antes de retirar ese archivo. El lanzador nunca mata procesos ajenos ni elimina bloqueos automaticamente.

Fuentes: [Funnel](https://tailscale.com/docs/features/tailscale-funnel), [CLI y persistencia](https://tailscale.com/docs/reference/tailscale-cli/funnel), [plan Personal](https://tailscale.com/pricing).
