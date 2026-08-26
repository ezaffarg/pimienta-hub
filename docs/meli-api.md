# Mapa de API Mercado Libre

## Primer hito

> **SNAPSHOT HISTÓRICO:** este alcance inicial fue superado por las capacidades
> implementadas y el estado 2.20T documentados más abajo.

Solo OAuth, cuenta autorizada y estado de conexion.

## Fases posteriores

- Items: publicaciones, categorias, atributos, variaciones, imagenes, precio y stock.
- Inventario: user products y stock.
- Ordenes: ordenes, packs, pagos, descuentos, feedback y fraude.
- Preguntas: busqueda, respuesta y moderacion.
- Envios: shipment, estados, SLA, tracking y costos.
- Notificaciones: topics, idempotencia y recuperacion.

Cada recurso debe tener DTO, mapper, errores y tests contractuales propios dentro del adapter. Consultar la documentacion oficial vigente antes de fijar contratos.

## Listings read-only — 2.20B

> **SNAPSHOT DE ESE MOMENTO:** las afirmaciones de este bloque sobre ausencia de
> persistencia y sync fueron superadas por 2.20E, 2.20S y 2.20T más abajo.

La primera lectura de publicaciones usa exclusivamente la API oficial autenticada de Mercado Libre y se ejecuta server-side desde una Connection activa ya vinculada al tenant y a la Store. No existe todavía una ruta pública, UI, sincronización ni persistencia de listings.

- Búsqueda: `GET /users/{seller_id}/items/search?limit={1..20}&offset={n}`. El `seller_id` se obtiene de `Connection.external_account_id`, nunca del navegador.
- Detalle eficiente: `GET /items?ids={comma-separated-item-ids}&attributes=...`, limitado a los IDs de la página solicitada. No se consulta cada publicación de forma individual.
- DTO interno: `ExternalListingSummary`; sólo normaliza identificador, título, estado, precio/moneda, cantidades, tipo, enlaces públicos opcionales, catálogo, condición y datos de SKU disponibles.
- SKU: la fuente oficial es el atributo `SELLER_SKU`. `seller_custom_field` se conserva separado como dato interno opcional y no se interpreta como SKU.
- Credenciales: se descifran solamente en memoria. Si el token de acceso está vencido, esta primitive se detiene antes de cualquier llamada al proveedor: no implementa refresh ni escrituras durante esta etapa.
- Errores del proveedor y validación Zod usan categorías genéricas; no incluyen bearer tokens, respuestas sensibles ni credenciales.

La documentación oficial vigente para [búsquedas de ítems](https://developers.mercadolibre.com.ar/es_ar/guia-para-carrito-de-compras/items-y-busquedas) y [SKU/variaciones](https://developers.mercadolibre.com.ar/es_mx/variaciones) es el contrato externo de referencia.

### Validación real 2.20B

La primera ejecución real se realizó una vez con límite 20 y devolvió una página de una publicación. La identidad de vendedor ya había sido verificada en 2.20A; la Connection activa y el secreto asociado siguieron siendo únicos. El access token permanecía vigente, por lo que no hubo refresh ni escritura de secretos. El resultado normalizado no contenía `SELLER_SKU`; ello representa ausencia del atributo en esa publicación, no una conversión desde `seller_custom_field`.

No se crearon ni modificaron Stores, Connections, Assignments, secretos, publicaciones, stock, precio o datos de negocio. No se almacenaron listings ni se inició sincronización.

La foundation 2.20C consume exclusivamente `ExternalListingSummary` ya normalizado. La persistencia no acepta respuestas crudas del provider ni convierte los campos opcionales ausentes en cero. Un item que no supera la normalización no llega al sync repository. `seller_custom_field` no cruza el contrato canónico; sólo `SELLER_SKU` puede aportar `sellerSku`.

## Listing backfill server-only — 2.20S

El runtime conserva la lectura por Connection activa y agrega un backfill
completo server-only. Para sellers dentro del límite normal recorre offset/limit;
si el total supera 1000 reinicia discovery con `search_type=scan` y consume el
`scroll_id` hasta el final. Los IDs se deduplican y los details se solicitan
secuencialmente en chunks máximos de 20.

Las requests tienen timeout de 15 segundos y hasta 3 intentos. Sólo timeout,
fallo de red, 429 y 5xx son retryable; el backoff es exponencial con jitter y
respeta un `Retry-After` válido. Los errores no conservan token, headers o body
del provider. Un fallo completo de discovery detiene el backfill; un fallo de
details agotado se informa por cada external listing ID y permite continuar con
los demás chunks.

El resultado agregado expone únicamente `discovered`, `requested`, `fetched`,
`persisted`, `failed` y fallos sanitizados. Los timestamps oficiales
`date_created` y `last_updated` se normalizan como timestamps nullable del
provider; `last_synced_at` continúa siendo el reloj local. No se implementan
ausencia, soft-delete, variaciones, User Products, métricas/audit persistentes ni
escrituras hacia Mercado Libre.

## Listing sync run orchestration — 2.20T

`MercadoLibreListingSyncRunService` envuelve el backfill server-only existente
sin mover lógica del provider a la capa de DB. Recibe Organization, Store,
Connection, actor membership e idempotency key desde un caller server-side ya
autorizado; inicia el run, persiste checkpoints después de cada batch y al
cerrar cada página, y finaliza `succeeded`, `partial` o `failed`.

El resultado seguro distingue `executed`, `reused` y `already_running`. Un run
reutilizado o bloqueado no vuelve a llamar al backfill. Los fallos fatales se
clasifican con códigos allowlisted y resúmenes controlados; nunca se persiste
`error.message`, tokens, headers o bodies. Los fallos parciales completan el
recorrido y cierran como `partial_item_failure`.

`credential_failure` conserva su código canónico. Cuando la capa de credenciales
entrega un stage primario conocido, el resumen usa una plantilla controlada con
ese stage allowlisted; stages desconocidos vuelven al resumen genérico sin
interpolar mensajes ni material del proveedor.

Una idempotency key histórica puede devolver `reused` aunque la Connection haya
sido deshabilitada después, siempre después de validar tenant, Store,
Connection y actor server-side. Esto sólo reconoce el run existente: una key
nueva sobre una Connection disabled falla cerrado y no inicia backfill.

El resultado 2.20S incorpora `pages` y `batches` y admite un callback opcional
de progreso, por lo que los callers anteriores siguen funcionando. El callback
no se ejecuta por item. No existe route pública, scheduler, worker, heartbeat,
cursor persistente, resumability, missing reconciliation ni recovery automática
de runs stale en este corte.

La infraestructura DB/RPC 2.20T quedó validada en el proyecto remoto mediante
fixtures sintéticas con rollback. Esa validación estructural inicial no incluyó
el orquestador real; el resultado runtime posterior se registra en el bloque
vigente siguiente. La recuperación automática/general de stale runs continúa
`DEFERRED`; checkpoint continúa sin ser resumability.

### Estado runtime vigente 2.20T

El root cause inicial de input scope fue corregido: el caller construye
`ListingScope` explícitamente y mantiene `actorMembershipId` e `idempotencyKey`
fuera del scope estricto. El caller de finalize también construye progress con
los siete counters canónicos y excluye `failures`. La observabilidad CAS
distingue fallos seguros sin conservar material sensible.

La validación real creó el run y completó discovery, detail fetch, persistencia
y checkpoints. La recuperación posterior finalizó ese mismo run como
`succeeded`, sin repetir trabajo del provider, con counters `1/1/1/1/0`, una
página y un batch. Quedaron exactamente un audit `listing.sync.started` y uno
`listing.sync.succeeded`, sin terminales duplicados ni runs `running`.
Listings permanece en 1 sin duplicados; el reconnect controlado dejó
`credential_version=3` y lease `CLEAR`. 2.20T está cerrado.
