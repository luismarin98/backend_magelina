# Comandos por carpeta

Cada carpeta agrupa una capacidad: `music/`, `community/`, `entertainment/`
y `requests/`. Cada subcomando tiene su propio archivo con `definition` y
`execute`: por ejemplo, `music/youtube.ts`, `music/buscar.ts`,
`music/conectar.ts`, `music/agregar.ts` y `music/cola.ts`.

Los archivos `index.ts` ensamblan el comando raiz y seleccionan su ejecucion.
Para agregar un subcomando, crea su archivo e incluyelo en `subcommands` del
indice. Esa misma lista alimenta la definicion publicable y la ejecucion;
no hay otro switch que actualizar.

`../slash.ts` conserva la autorizacion general, las respuestas privadas y el
manejo de errores. `music/context.ts` prepara el servicio y las comprobaciones
compartidas de permisos y canales de voz. Cada archivo musical ejecuta su propia
accion. Los juegos comparten el motor de sesiones y botones de `../games.ts`.

`registry.ts` conserva el registro central por categoria, tipo y nombre.
`../handler.ts` dirige cada interaccion a una sola ruta. Las dependencias de
los subcomandos se cargan cuando se necesitan.

La pantalla de control compara este registro con los comandos publicados en
Discord. Discord publica cada comando raiz junto con sus subcomandos; separar
los archivos no cambia esa unidad de publicacion. La publicacion sigue siendo
manual.


`adventure/` define los comandos personales del juego. `../adventure.ts` administra sus paneles privados y confirmaciones; `adventure/services.ts` usa los mismos servicios de personaje, inscripción, economía y expediciones que el dashboard. El registro central los dirige al manejador `adventure`. Los menús son temporales y están vinculados al usuario y servidor; las operaciones y recompensas se guardan en MongoDB con claves de idempotencia.
