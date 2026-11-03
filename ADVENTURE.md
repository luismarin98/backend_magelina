# Gremio de aventureros: primera entrega

La participación es voluntaria. Consultar la pantalla o habilitar el juego no crea personajes ni inscripciones.

## Datos

- `AdventureCharacter`: identidad y progreso global, únicos por ID de Discord. Alias editable, nivel inicial 1, rango F, experiencia y monedas en cero.
- `AdventureMembership`: inscripción por usuario y servidor, con nombre local opcional. No guarda copias del nivel, rango, experiencia o monedas.
- `AdventureConfig`: habilitación por servidor, desactivada por defecto. Solo propietarios o administradores nativos del servidor pueden cambiarla.

Los permisos de Discord no conceden ventajas dentro del juego. Incluso el propietario global del bot debe pertenecer al servidor para registrar su participación.

## Entrada

```mermaid
flowchart TD
    A[Visitar Comunidad: Gremio de aventureros] --> B{Juego habilitado}
    B -->|No| C[Mostrar estado y configuración autorizada]
    B -->|Sí| D{Inscripción existente}
    D -->|Sí| E[Mostrar personaje y progreso global]
    D -->|No| F{Personaje global existente}
    F -->|No| G[Elegir alias y pulsar Crear personaje y comenzar]
    F -->|Sí| H[Pulsar Entrar con mi personaje]
    G --> I[Crear identidad global si todavía no existe]
    I --> J[Registrar inscripción sin reiniciar ni recompensar]
    H --> J
    J --> E
```

Las consultas no escriben datos. La inscripción es idempotente mediante índices únicos y operaciones de inserción condicional: repetirla no reinicia el personaje ni concede monedas. Si la identidad se creó pero la inscripción falló, un reintento reutiliza la identidad.

Los cambios de nombre usan versiones para detectar ediciones concurrentes desde varios servidores. La API identifica al jugador desde su sesión; no acepta un usuario destino ni cambios a estadísticas económicas o de progreso.

## Disponible y pendiente

Disponibles: habilitación administrativa, creación voluntaria, inscripción en varios servidores con el mismo progreso, consulta propia, alias global y nombre local.

Pendientes: expediciones, trabajos del worker, inventario, equipo, fabricación, tienda, misiones, recompensas, progresión, reputación y perfiles públicos, comandos de Discord. Las tarjetas de esas actividades indican «En preparación» y no ejecutan acciones ficticias.

La reputación futura y las recompensas deben tener reglas globales; cada servidor no puede multiplicar monedas ni experiencia mediante su configuración local.

## Diseños de objetos

En Comunidad > Gremio de aventureros > Diseños de objetos, los jugadores inscritos crean borradores globales privados. Pueden elegir ocho iconos de biblioteca o cargar PNG, JPEG o WebP de hasta 2 MB. La dashboard realiza recorte central con zoom a 256 por 256 y genera PNG; el backend valida firma, CRC, dimensiones, flujo comprimido y filtros, rechazando animaciones y formatos activos. Se almacena el PNG en el documento MongoDB del diseño, con límite de 512 KB, sin depender de adjuntos de Discord. La imagen no se incluye en las listas ni en los logs.

Los cosméticos pasan de borrador a enviado y después a aprobado o rechazado. Solo el propietario global del bot puede revisarlos; un administrador local no puede aprobar contenido global. La revisión no obliga al propietario a crear un personaje. Requiere abrir el juego en un servidor compartido con la modalidad habilitada. Los rechazos incluyen motivo, el creador puede corregir y volver a enviar. Los aprobados forman el catálogo global y quedan bloqueados para edición directa. Equipo, materiales y consumibles solo admiten borradores por ahora.

Las listas tienen diez resultados por página. Las imágenes privadas solo son visibles para su autor; las propuestas enviadas también para el revisor global y las aprobadas para los participantes. Guardar, enviar o aprobar un diseño nunca crea una unidad de inventario, cambia estadísticas ni entrega monedas. Los campos de daño, precio y recompensas no se aceptan en estas rutas.


### Catálogo visual predefinido
Los nuevos diseños usan exclusivamente el identificador de uno de ocho iconos de Game-icons.net. Los SVG se distribuyen localmente con el dashboard, incluyendo licencia y atribución a Lorc, Willdabeast y Delapouite (CC BY 3.0). Se retiraron la carga y el recorte de imágenes de la interfaz; la API rechaza `imageData` en altas y ediciones. Esta modalidad sustituye el flujo de carga descrito anteriormente. Las imágenes antiguas no se borran en masa; al guardar un borrador editable se sustituye su imagen por el icono elegido.
El acceso al juego también aparece directamente en cada tarjeta de servidor conectado y en la navegación del servidor. La activación sigue requiriendo propietario o Administrador de Discord.


### Entrada global al juego
La sección **Mi aventura** del sidebar abre `/adventure`, independiente de un servidor. `GET /api/adventure` no crea datos. `POST /api/adventure/start` crea voluntariamente un personaje global con alias y oficio (`hunter` o `merchant`), sin monedas ni membresías de regalo; reintentos y peticiones concurrentes conservan el personaje existente. `PATCH /api/adventure/character` permite editar alias y oficio con control de versión. Los personajes anteriores sin oficio pueden elegirlo sin perder progreso.
Unirse mediante `/guilds/:guildId/adventure/join` requiere un personaje existente, pertenencia real al servidor, presencia del bot y el juego habilitado por un administrador. El oficio por ahora es identidad, no implementa mecánicas de combate ni comercio. Las ciudades siguen pendientes.


### Integración opcional con Discord
En el servidor: **Gremio de aventureros > Integración con Discord > Configurar avisos del gremio**. Por defecto no se crean canales ni se envían avisos. Se puede seleccionar una categoría y un canal de texto existente dentro de ella. La acción explícita de creación crea `#avisos-del-gremio` en la categoría elegida, o crea también una categoría `Gremio de aventureros` si no se seleccionó ninguna. No mueve ni modifica canales existentes; los nuevos heredan permisos de su categoría. Crear recursos no activa los avisos: hay que guardar la configuración.
Solo administradores reales del servidor pueden delegar esta configuración a roles concretos. Los delegados pueden configurar el canal y crear los recursos solicitados, pero no delegar a otros ni activar el juego. El backend valida pertenencia, roles actuales, categoría del canal y permisos del bot. Se comparte el control de versión con la activación del juego.
Las nuevas inscripciones al juego guardan su aviso pendiente en el mismo documento de membresía (`$setOnInsert`): repetir la inscripción no genera avisos nuevos. El worker revisa la cola cada 15 segundos, respeta mantenimiento y servidores bloqueados, comprueba otra vez la integración y reintenta hasta cinco veces. Los mensajes no envían menciones y usan un nonce estable con `enforceNonce` para reducir duplicados en reintentos recientes. Discord limita temporalmente esa deduplicación; no es una garantía de entrega exactamente una vez ante fallos prolongados. Un fallo del aviso no revierte la inscripción. Desactivar avisos cancela los pendientes al procesarlos; no publica inscripciones antiguas retroactivamente. Los estados y errores de envío permanecen en MongoDB.
En esta entrega se publica la **inscripción al gremio del juego**, no el ingreso al servidor de Discord. Viajes, ciudades y avisos de llegada/salida siguen pendientes de implementar.


### Inventario, fabricación y compraventa global
**Mi aventura > Inventario y comercio** ofrece Inventario, Taller, Mercado global y Mis ofertas a ambos oficios. No exige un servidor ni otorga ventajas por permisos de Discord. Cambiar de oficio no reinicia materiales, monedas, ofertas ni el tiempo de recolección. Los diseños privados no se convierten en objetos automáticamente: solo los cosméticos aprobados tienen una receta global predefinida. No se permiten estadísticas, recetas, saldos ni propietarios enviados por el cliente.

Valores iniciales centralizados en `src/modules/adventure/economy-rules.ts`:
- Recolectar entrega 2 maderas y 2 hierbas cada 10 minutos; no concede monedas.
- Un amuleto de madera o cosmético aprobado requiere 2 maderas + 2 hierbas por unidad. Son cosméticos sin efectos de combate.
- Venta al sistema: madera 2 monedas, hierba 1, cosmético 5. Fabricar no genera arbitraje: los materiales cuestan 6 monedas al venderlos separados.
- Fabricación, venta y lotes: entre 1 y 100 unidades por operación. Precio de mercado: entero de 1 a 1 000 000 por unidad.
- Inventario: hasta 200 tipos de objeto, 1 000 000 unidades por tipo. Saldo: hasta 1 000 000 000 monedas por personaje.

Las ofertas reservan las unidades en depósito: salen del inventario disponible al publicarse. Se compran lotes completos; una compra transfiere monedas del comprador al vendedor y las unidades al comprador. No se pueden comprar ofertas propias ni cancelar ofertas ajenas. Cancelar devuelve el lote al vendedor; si no hay espacio, se conserva en depósito hasta que lo haya. Inventario y ofertas se paginan en la interfaz; el mercado y el catálogo aprobado paginan también en la API. No se implementaron comisiones, equipamiento, combate, efectos de consumibles ni bonificaciones por oficio.

Persistencia: `AdventureInventory`, `AdventureListing` y `AdventureReceipt`. `POST /api/adventure/economy/{gather,craft,sell,list,buy,cancel}` exige una clave de idempotencia por acción, limitada al usuario autenticado. Repetir la clave y el mismo contenido devuelve el comprobante guardado; cambiar su contenido produce conflicto. Los comprobantes no expiran. Las escrituras de inventario, saldo, oferta y comprobante se confirman juntas mediante transacciones MongoDB. **Se requiere replica set o Atlas**; una instancia standalone devuelve 503 sin recurrir a transferencias no atómicas. El arranque inicializa los índices únicos antes de aceptar peticiones. Se respeta el mantenimiento global para nuevas operaciones.

El dashboard confirma cantidades e importes antes de operar y conserva la clave al reintentar una respuesta incierta. Las actualizaciones usan Redux y consultas compartidas, sin botón manual de actualizar. La recolección tiene su propio reloj persistente por personaje, independiente del navegador o del oficio. No se introdujeron recompensas de registro retroactivas.

Verificación: pruebas unitarias y HTTP, dobles transaccionales con rollback y una prueba optativa contra MongoDB real (`test/adventure-economy.mongo.test.ts`). Esta última se activa con `ADVENTURE_ECONOMY_MONGO_TEST=1`, usa colecciones temporales con prefijo aleatorio `tmp_eco_`, desactiva la creación implícita de colecciones del aplicativo y elimina solo sus propias colecciones al terminar. Nunca debe apuntar a colecciones reales de jugadores.
