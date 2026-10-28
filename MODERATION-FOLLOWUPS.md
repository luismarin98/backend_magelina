# Seguimiento colaborativo de moderacion

Reporte recibido -> En revision -> En seguimiento -> Cerrado.
El estado del trabajo es independiente de la conclusion: sin confirmar, hechos
confirmados por el equipo, reporte descartado o medida revocada.

Un reporte no aplica sanciones. Puede crearse desde cero o vincularse a una
medida existente del mismo miembro y servidor. La medida conserva su resultado
tecnico: cerrar el seguimiento no deshace una sancion en Discord.

Cada revision exige una nota y conserva actor, fecha, conclusion, responsable y
proxima revision. Un moderador asume el seguimiento; solo el responsable o el
propietario puede modificarlo. Las escrituras usan versionado optimista y las
altas un identificador de solicitud para impedir duplicados tras reintentos.
Se verifican permisos nativos de moderacion en cada peticion, ademas del acceso
al servidor. Los registros se separan por gremio y no se publican a miembros.

Las fechas aparecen en la dashboard. No hay vigilancia de mensajes, puntuaciones
de usuarios, sanciones automaticas ni mensajes o recordatorios por Discord.
Descartar o revocar exige cierre y elimina el proximo recordatorio. El historial
se conserva; no hay borrado automatico ni inferencia de reincidencia.

Validacion pendiente en un servidor de pruebas: registrar reporte, asumir,
revisar, programar fecha y cerrar; probar dos moderadores y la retirada de permisos.
La revocacion aqui documenta la conclusion; retirar un timeout usa la accion
existente y retirar un baneo aun no se implementa en este flujo.
