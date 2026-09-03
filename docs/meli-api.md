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

## Administrative stale-run recovery — 2.20U

La ruta server-only
`/api/integrations/mercado-libre/listing-sync-runs/:id/recovery` expone `GET`
para inspección segura y `POST` para una transición administrativa explícita.
Ambas operaciones exigen una membership persistente Owner o Manager de la
Organization activa; Clerk fallback, Employee y Client fallan cerrado.

El browser sólo aporta el run ID, `terminalStatus` (`succeeded` o `failed`) y
un reason allowlisted. Organization, recovery actor, Store y Connection se
resuelven y validan server-side. Un run es stale cuando su último checkpoint
tiene al menos 15 minutos de inactividad. La lectura clasifica
`RECOVERABLE_AS_SUCCEEDED`, `RECOVERABLE_AS_FAILED`, `NOT_RECOVERABLE` o
`NOT_STALE` y no expone idempotency key, actor original ni error summary.

`succeeded` requiere checkpoint posterior al start, cero fallos, counters
discovered/requested/fetched/persisted iguales y evidencia de página/batch.
Cuando esa evidencia no alcanza, sólo se admite `failed`. La RPC conserva los
counters, checkpoint y actor original; no llama a Mercado Libre ni reanuda el
backfill. Scheduler, worker, auto-recovery, resumability y UI administrativa
completa continúan fuera de alcance.

La migration y el contrato RPC 2.20U quedaron validados en remoto con fixtures
sintéticos eliminados al finalizar. La proyección administrativa segura,
clasificaciones, roles, tenant boundaries y outcomes controlados pasaron sin
usar runs reales ni ejecutar trabajo del provider.

## Administrative listing sync read UI — 2.20V-A

La ruta dashboard
`/dashboard/integrations/mercado-libre/listing-sync-runs` muestra a Owner y
Manager persistentes un historial administrativo de sólo lectura. La UI usa el
GET interno `/api/integrations/mercado-libre/listing-sync-runs`, hidratación
TanStack Query y el read model 2.20U; Employee, Client y Clerk fallback fallan
cerrado antes de consultar runs.

El servidor inspecciona como máximo los 50 runs más recientes del tenant,
ordena por inicio descendente por defecto y permite filtros acotados por status,
Store, stale y eligibility. Store y Connection se enriquecen sólo desde DB. La
respuesta incluye timestamps UTC, counters y errores allowlisted/redactados;
no expone actor, idempotency key ni material de credenciales. La ruta de
listado no expone POST, recovery, acción de sync ni llamada al provider.

2.20V-B consume exclusivamente el POST 2.20U
`/api/integrations/mercado-libre/listing-sync-runs/[id]/recovery`. La UI sólo
ofrece el target permitido por eligibility, exige una reason de la taxonomy
vigente e invalida el listado tras cualquier outcome controlado. No reintenta,
no expone errores backend y no llama al provider.

2.20V está cerrado: baseline final 69/69 focalizados, 232/232 suite, typecheck
y lint PASS. La evidencia remota funcional pasó con fixtures eliminados, cero
provider calls y recursos reales intactos; el toast quedó validado y su captura
inicial ausente se clasificó como `AUTOMATION_OBSERVABILITY_LIMITATION`.

## Safe run-aware reconciliation — 2.20W-B

El backfill orquestado entrega su `runId` a la persistencia positiva. Cada batch
usa `persist_listing_sync_batch_for_run`, que valida Organization, Store,
Connection y run `running`; actualiza `last_seen_sync_run_id`, restaura `seen` y
cuenta una reaparición sólo durante la transición desde `missing_candidate`.

El adapter calcula `reconciliationEligible` únicamente cuando el perfil técnico
sin filtros reductores termina en el final oficial, conserva modo/total
consistentes, no repite cursores y cumple
`discovered=requested=fetched=persisted` sin fallos. Esto expresa evidencia
interna de no-observación, no un snapshot autoritativo de Mercado Libre.

`finalize_listing_sync_run_with_reconciliation` aplica una única reconciliación
negativa y terminaliza el run en la misma transacción. Runs parciales, fallidos,
incompletos o recuperados administrativamente nunca producen candidates. W-C
validó remotamente ambos boundaries con fixtures sintéticos eliminados, cero
provider calls y recursos reales intactos. **2.20W está cerrado.**

## Integration event intake foundation — 2.20X-B

El contrato server-only recibe un envelope Mercado Libre `items` validado de
forma estricta, verifica `application_id`, extrae sólo un resource
`/items/{id}` canónico y resuelve la Connection activa por
`provider + external_account_id`. Organization, Store y Connection se derivan
de esa fila persistida; no son autoridad desde el evento.

El repository usa `intake_integration_event` y devuelve `ACCEPTED` o
`DUPLICATE`. La deduplicación durable no depende de `attempts` ni del
timestamp local de recepción. X-B no expone callback HTTP, ACK público, worker,
provider fetch ni actualización de Listings.

## Public items callback — 2.20X-C

`POST /api/integrations/mercado-libre/notifications/items` recibe JSON de hasta
16 KiB y reutiliza íntegramente el service X-B. `ACCEPTED` y `DUPLICATE`
responden 200 vacío. Payload, application o binding inválidos también reciben
200 sin persistencia para cortar retries permanentes; fallos de configuración,
resolución o intake responden 503 para preservar el retry del provider.

La ruta no usa Clerk, no expone IDs internos y no llama a Mercado Libre. El
contrato oficial disponible recomienda HMAC-SHA256, pero no publica header,
canonicalización ni secreto implementable; no se inventó una firma. Rate
limiting distribuido y procesamiento permanecen diferidos.

## Incremental event processor — 2.20X-D

El servicio server-only controlado procesa un `eventId` persistido; no existe
route pública de procesamiento ni worker automático. Claim y lease son
atómicos. Tras revalidar el binding del evento, reutiliza credenciales, client
y normalización Mercado Libre canónicos para consultar únicamente el item
canónico persistido.

La persistencia terminal aplica freshness CAS por `provider_updated_at`:
`APPLY`, `STALE_NOOP` o `EQUIVALENT_NOOP`. Timestamp ausente o igualdad con
contenido conflictivo fallan cerrado. Un 404 no modifica Listing ni infiere
status, ausencia, candidate o eliminación. Los fallos seguros distinguen
retryable de permanentes sin exponer respuestas, tokens ni texto arbitrario.

X-D quedó validado sólo en local con provider mockeado. Scheduler, retry
dispatch, `missed_feeds`, endpoint administrativo y aplicación remota siguen
fuera de alcance.

## Retries y missed_feeds — 2.20X-E

Los transient failures conservan status `failed`, código seguro, attempts y
`next_retry_at`. La base calcula backoff determinista y el Retry-After
normalizado por el client actúa como piso. `list_due_integration_event_retries`
lista hasta 100 IDs ordenados, pero no reclama ni incrementa attempts; el batch
server-only reutiliza el claim y processor X-D.

La recuperación invocable usa el endpoint oficial
`GET /missed_feeds?app_id={id}&topic=items&site_id={site}&offset={n}&limit=10`.
Para `items`, `site_id` es obligatorio. La identidad `/users/me` se coteja con
la Connection y aporta el site; cada mensaje se reduce a campos canónicos y
vuelve al intake X-B. Un batch procesa hasta diez páginas y devuelve
`exhausted=false + nextOffset` sin declarar completitud si queda trabajo. La
retención oficial es de hasta dos días, por lo que el
full scan y reconciliation siguen siendo la última red de seguridad.

En el checkpoint X-E todavía no existía scheduler, cron o loop activo y la
validación era local con provider mockeado. F3-C completó luego el runtime.

## Event maintenance orchestration — 2.20X-F

`runIncrementalEventMaintenance` coordina de forma server-only y acotada hasta
10 Connections activas. Por ciclo dispone de 25 eventos `received`, 25 retries
due, 10 páginas de `missed_feeds` y 45 segundos totales. El orden es received,
retries, missed feeds y, si queda presupuesto, eventos recién recuperados. Una
falla se aísla por evento o Connection y sólo persiste códigos y summaries
seguros.

La observabilidad durable de missed feeds conserva un stage allowlisted y los
conteos exactos de requests attempted/succeeded. El attempt se incrementa justo
antes de `/users/me` o una página `/missed_feeds`; success sólo después de que el
client boundary acepta la respuesta. Un HTTP exitoso con payload inválido cuenta
como provider success y falla en `missed_feed_response`. No se conservan bodies,
headers, tokens ni URLs sensibles.

El read model administrativo agrega backlog y el último maintenance run para
Owner/Manager en la pantalla existente de Listing Sync Runs. Employee y Client
quedan denegados por membership persistente. F3-B agregó
`POST /api/internal/maintenance/incremental-events` como boundary técnico para
el job de Coolify: exige Bearer secret dedicado, rechaza bodies no vacíos, no
usa Clerk ni autoridad tenant del caller y sólo devuelve estados sanitizados.
El Scheduled Task local lo invoca dentro del container por loopback; no depende
de Cloudflare ni de internet público.

## Maintenance stale reclaim — 2.20X-F2b

El orquestador actualiza `last_checkpoint_at` sólo después de etapas naturales
de progreso; no existe heartbeat loop. Si `start` encuentra un run existente,
`reclaim_stale_integration_event_maintenance_run` puede terminalizarlo tras diez
minutos sin checkpoint y el servicio reintenta start una sola vez.

El cutoff se calcula dentro de PostgreSQL y no es input del caller. Reclaim no
procesa eventos, retries o missed feeds, no reinicia leases y no escribe
Listings ni provider. En F2b el deployment seguía sin seleccionar y no existía
trigger; F3-A/F3-B seleccionaron Coolify e implementaron sólo el boundary local.

## Cierre runtime — 2.20X-F3-C

La resolución de credenciales y el refresh canónico conservan scope estricto,
lease y persistencia CAS. Los fallos exponen sólo stages allowlisted y subtipo
CAS seguro; los counters durable distinguen llamadas provider de missed feeds y
del refresh. El adapter acepta el contrato real `messages: null`, lo normaliza a
`[]` y termina la página como exhausted sin repetir offsets.

Coolify ejecuta `Pimienta Hub Incremental Events` cada cinco minutos mediante un
POST sin body y Bearer leído del runtime. La observación controlada confirmó un
run elegible con 2/2 llamadas y, cinco minutos después, un run con
`missed_feed_due=false` y 0 llamadas. Ambos terminaron `succeeded`, sin retries,
refresh, overlap ni lease residual. **2.20X está cerrado.**
