# Mensajes de registro en Discord

Los cambios de solicitudes, resuenes del equipo y avisos automaticos se presentan
como embeds con titulo, color y fecha. Las solicitudes muestran estado, referencia,
actor y responsable si se conocen. Los avisos no inventan actores ni resultados.
Los resumenes muestran revisiones vencidas y seguimientos sin responsable como
recuentos separados, sin sumarlos porque pueden solaparse.

Los mensajes de solicitudes y resumenes incluyen un enlace al area correspondiente
de la dashboard cuando se dispone de su origen HTTPS. Se sigue exigiendo iniciar
sesion y verificar permisos al abrirla. No se publican titulos de tareas, motivos,
pruebas ni miembros afectados por reportes. allowedMentions.parse sigue vacio.
Los resumenes actualizan el mensaje existente, eliminando su contenido de texto
antiguo. Los mensajes historicos de otros tipos no se modifican.

Los embeds necesitan Insertar enlaces ademas de los permisos existentes de texto.
La ruta de resumen lo comprueba antes de publicar. El idioma de etiquetas es el
preferido del servidor, con fallback espanol. Los textos originales de avisos
automaticos mantienen su contenido; no hay traduccion automatica.
No se agrego publicacion automatica de medidas de moderacion ni un envio al
servidor real durante el desarrollo. Requiere reiniciar el backend actualizado.
