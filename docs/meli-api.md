# Mapa de API Mercado Libre

## Primer hito

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
