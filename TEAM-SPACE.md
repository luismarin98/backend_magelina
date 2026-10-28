# Espacio privado del equipo

En Moderacion, preparar una categoria con canales de texto o voz. La propuesta
muestra roles, nombres y destinos antes de confirmar. Se pueden reutilizar
categorias y canales existentes del mismo servidor si sus permisos explicitos
coinciden con el acceso previsto; nunca se modifican sus permisos automaticamente.
Solo se aceptan roles propios con permisos nativos de moderacion. El usuario y
el bot necesitan Gestionar canales y Gestionar roles. Los administradores
conservan acceso por las reglas de Discord.

Se conservan IDs y progreso en MongoDB. Las operaciones se serializan por gremio
con versionado y un bloqueo persistente. Se guarda intencion antes de crear cada
canal; si la respuesta es incierta se requiere seleccionar el canal existente
tras revisar Discord, evitando recrearlo automaticamente. Si el proceso muere
con el bloqueo activo, un administrador tecnico debe comprobar que termino
antes de retirar el bloqueo en la base. No hay eliminaciones ni cambios de
permisos, nombres o destinos de canales previamente registrados.

El boton Publicar resumen de pendientes publica o actualiza un unico mensaje en
el canal con clave notices. Solo incluye recuentos del servidor: revisiones
vencidas y seguimientos sin responsable; no incluye personas, motivos ni pruebas.
Los permisos privados se vuelven a comprobar antes de publicar. No hay mensajes
programados ni registro automatico de sanciones; coordinacion y registro son
canales disponibles para el equipo. Los envios inciertos requieren revision
manual antes de habilitar un nuevo primer mensaje. Si borran el mensaje resumen,
no se recrea automaticamente.

Validacion real pendiente en un servidor de pruebas: permisos del bot y actor,
acceso con un miembro normal, creacion parcial y reutilizacion, voz y resumen.
No se han creado canales en el servidor real durante el desarrollo.
