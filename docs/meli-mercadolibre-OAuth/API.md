# Mercado Libre OAuth y API

Documento canónico de diseño para OAuth y onboarding de Connections. **Diseño auditado en 2.15; OAuth no está implementado.** Revalidar la documentación oficial y la configuración de la Developers Application inmediatamente antes de implementar.

## Límites y modelo

```text
Clerk Organization → Store interna → Connection → provider
```

- Una **Store** es una entidad interna tenant-scoped; puede tener varias Connections de distintos proveedores.
- Una **Connection** vincula una Store con una cuenta de un proveedor.
- Para Mercado Libre, `provider = 'mercado-libre'` y la identidad fuerte es `external_account_id = String(user.id)` de la cuenta autenticada en Mercado Libre.
- `nickname` de `GET /users/me` es display/sugerencia de nombre; nunca una clave de identidad ni de idempotencia.
- No se duplica el adapter por Store. MercadoCuentas es sólo referencia funcional/UX: no se consumen sus backends, cookies, endpoints privados ni scraping.

## Flujo OAuth oficial

Mercado Libre documenta OAuth 2.0 **Authorization Code Grant server-side**:

1. Un Owner autorizado inicia el intento server-side.
2. Se redirige a `https://auth.mercadolibre.com.{site}/authorization` con `response_type=code`, `client_id`, `redirect_uri` estática registrada y `state` opaco.
3. El callback server-side valida y consume el `state` una sola vez.
4. El servidor intercambia `code` mediante `POST https://api.mercadolibre.com/oauth/token`, con `application/x-www-form-urlencoded`, `client_id`, `client_secret`, `code` y la misma `redirect_uri`.
5. Con el Bearer token exclusivamente server-side consulta `GET https://api.mercadolibre.com/users/me`.
6. El campo `id` de esa respuesta se normaliza a texto y se usa como `connections.external_account_id`; el `nickname` sólo alimenta la experiencia de nombre visible.
7. Se resuelve la Connection antes de crear cualquier Store. Para una cuenta realmente nueva, se confirma/vincula la Store y se persisten Connection y secretos de manera atómica.

La respuesta de token también informa `user_id`; se puede cotejar contra `/users/me`, pero el dato canónico de onboarding es `id` del recurso de identidad autenticada.

## Estado, PKCE y seguridad del callback

`createOAuthState()` y las utilidades de PKCE actuales sólo generan valores criptográficamente aleatorios. Son preparación de Fase 0, no constituyen un flujo OAuth: hoy no existe ruta, almacenamiento del intento, expiración, consumo único ni callback.

La implementación futura debe usar un intento OAuth server-side de vida corta que contenga nonce/state, `code_verifier` cuando aplique, actor Clerk, Organization activa, membership persistente, permiso evaluado y expiración. El navegador sólo transporta el nonce opaco; no es autoridad y no debe transportar `organizationId` como dato confiable. El callback debe volver a comprobar sesión/contexto y consumir el intento de forma única antes del token exchange. Una tabla/RPC de intentos o almacenamiento server-side equivalente es una **decisión de implementación pendiente**.

Mercado Libre documenta que `code_verifier` aplica cuando la aplicación tiene PKCE habilitado. La Developers Application debe confirmar esa capacidad antes de habilitar `MELI_PKCE_ENABLED`; si se habilita, challenge/verifier se conservan sólo server-side y se envían según el contrato oficial. No se asume PKCE universal ni se activa por una variable de cliente.

Errores externos se normalizarán sin `code`, tokens, SQL ni detalles de infraestructura: `oauth_denied`, `invalid_state`, `token_exchange_failed`, `identity_lookup_failed`, `already_connected`, `connection_conflict`, `store_creation_failed` y `connection_creation_failed`.

## Idempotencia, conflictos y concurrencia

El schema actual tiene un índice único parcial global:

```text
(provider, external_account_id)
WHERE external_account_id IS NOT NULL AND status = 'active'
```

Por tanto:

- Bloquea dos Connections **activas** de la misma cuenta/proveedor, incluso entre Organizations.
- No bloquea filas `disabled` con la misma cuenta; tampoco `NULL`.
- `Store.name` no es único y no puede usarse como idempotency key.
- `ConnectionRepository` actual sólo lista por Store u obtiene por id tenant-scoped; no resuelve aún una cuenta externa para onboarding.

| Caso | Resultado propuesto |
| --- | --- |
| Cuenta ML nueva | Tras confirmar el nombre de Store, crear Store + Connection activa en una sola operación atómica. |
| Misma cuenta con Connection activa | No crear Store. Devolver `already_connected` si pertenece a la misma Store; `connection_conflict` si pertenece a otra Store u Organization. No revelar detalles cross-tenant. |
| Misma cuenta con Connection disabled | Reutilizar y reactivar la fila existente para su Store original; no crear una segunda Store ni una segunda Connection silenciosa. Una reasignación a otra Store exige flujo administrativo futuro explícito. |
| Callback repetido | El intento OAuth de un solo uso retorna un resultado seguro ya resuelto; no recrea Store ni Connection. |
| Callbacks simultáneos | Una transacción/RPC con lock por `(provider, external_account_id)` y el índice único parcial determina un único resultado. No basta `SELECT` seguido de `INSERT`. |

La regla actual permite técnicamente que una cuenta deshabilitada sea liberada. La política de reactivar la misma fila es la recomendación de onboarding; conservar o cambiar la semántica de liberación requiere aprobación humana y posiblemente una migración posterior.

## Store name y experiencia propuesta

Se recomienda que el Owner elija/valide el nombre de la Store. El `nickname` de Mercado Libre se muestra como sugerencia inicial y puede aceptarse o editarse, pero no se persiste como identidad. Para no dejar Stores huérfanas, el callback puede resolver la identidad y llevar a una confirmación server-side de onboarding antes de la operación transaccional final. Esa pantalla y estado pendiente no están implementados.

## Autorización y tenant safety

Política aprobada para el diseño: **Owner y Manager** pueden iniciar, completar, reconectar o desconectar una Connection Mercado Libre para cualquier Store de su Organization. **Employee** queda denegado inicialmente. **Client** sólo puede hacer self-onboarding o reconnect de su propia Store, sin administración global. No se modifica RBAC funcional en este checkpoint.

Toda futura operación sigue:

```text
Request → Authentication → Authorization → tenant resolution → validation → service → repository/transaction → database
```

La Organization, membership, permiso y Store Scope se derivan server-side. `organizationId`, `role`, `membershipId` y `storeId` del navegador identifican una intención/objetivo, nunca autorizan una mutación.

## Tokens, refresh y desconexión

- `access_token`, `refresh_token`, `client_secret` y `code` son server-only: nunca UI, cookies legibles por JavaScript, local/session storage, logs, respuestas ni Git.
- `connections` almacena metadata de conexión y **deliberadamente no contiene secretos**. Hace falta diseñar una entidad o vault de secretos cifrados en reposo y con acceso server-only; no se crea en 2.15.
- Se persiste el `expires_in` real recibido; no se fija una constante. El access token debe renovarse con margen configurable.
- El refresh token es de uso único y rota en cada refresh. La actualización de access token, refresh token y expiración debe ser atómica y serializada por Connection para evitar que dos refresh invaliden la credencial entre sí. Si falla, se marca la Connection para reautorización sin exponer la causa interna.
- La desconexión futura intenta la revocación oficial `DELETE /users/{user_id}/applications/{app_id}` con Bearer token cuando aún sea posible; elimina/inhabilita el secreto local y marca la Connection `disabled`. No borra automáticamente la Store. Si la revocación remota falla, se registra server-side y no se afirma éxito remoto.
- La reconexión de la misma cuenta deshabilitada reactiva la Connection existente y actualiza secretos mediante el almacenamiento seguro futuro.

### Rotación segura de refresh (2.20F)

La primitive server-only `MercadoLibreCredentialService.getValidAccessToken()` reutiliza tokens que exceden una ventana de seguridad de 120 segundos. Cuando debe rotar, reclama un lease de 60 segundos por Connection mediante PostgreSQL, relee las credenciales y recién entonces llama `POST /oauth/token` con `grant_type=refresh_token`. No mantiene una transacción de base durante la llamada HTTP; el request se aborta a los 15 segundos y no tiene retry ciego.

Mercado Libre requiere que se conserve el último refresh token y devuelve uno nuevo en cada rotación. La respuesta de refresh sin refresh token se rechaza sin escribir nada. La persistencia cifra access y refresh token antes del RPC y usa `credential_version` + lease owner como compare-and-swap: un resultado stale se descarta y se relee, nunca sobrescribe una rotación ganadora. Un fallo no borra ni desactiva la Connection automáticamente; el límite público comunica un error normalizado de refresh/reconexión sin secretos.

La migration sigue sólo local en este checkpoint. No se ejecutó refresh real ni listing sync real.

## Persistencia y trabajo pendiente

`StoreRepository.create()` y `ConnectionRepository.create()` no ofrecen una transacción conjunta ni idempotencia de onboarding. Para el flujo real se requiere diseño/implementación aprobados de:

1. almacenamiento de intentos OAuth (`state`, actor/tenant, expiración, consumo único y PKCE si aplica);
2. almacenamiento de secretos cifrados, separado de `connections`;
3. lookup seguro y resolución de conflicto por provider + external account;
4. primitive transaccional/RPC que cree/reutilice Store y Connection sin dejar Store huérfana;
5. actualización/rotación atómica de credenciales y estados.

La foundation 2.16 implementa localmente `oauth_attempts`, secretos cifrados separados, audit events, unicidad histórica de Connection y primitives transaccionales sin rutas OAuth. El runtime posterior implementó OAuth y onboarding server-only. En 2.20A se validó una única lectura real `GET /users/me` con la Connection persistida: los secretos se descifraron sólo en memoria, el access token seguía vigente y la identidad devuelta coincidió con `external_account_id`. No fue necesario refresh, no se realizaron mutaciones de negocio ni se registró una auditoría adicional para la lectura.

La foundation 2.19B añade `oauth_pending_authorizations`: tras validar y consumir un OAuth attempt, el callback 2.19D cifra los tokens y guarda `String(/users/me.id)` junto con `nickname` opcional durante 20 minutos. La pending authorization está bound a Organization, actor, provider y purpose, es de uso único y no es una Connection ni un secreto definitivo.

La foundation 2.19G incorpora localmente `finalize_admin_pending_integration_onboarding`, una primitive SQL transaccional que recibe el pending ID y Store.name: crea o reactiva Connection, copia los envelopes cifrados a `integration_secrets`, registra auditoría allowlisted y consume la pending en la misma transacción. No descifra tokens ni exige la master key a PostgreSQL. No se reutilizan las RPCs 2.16 porque aceptan una identidad externa sin pending ID ni transferencia cifrada. La migration sigue sin aplicar en remoto y no se ejecutó onboarding real.

## Runtime OAuth 2.19D

Se implementan `POST /api/integrations/mercado-libre/connect` y `GET /api/integrations/mercado-libre/callback`, ambos server-only. El inicio exige sesión Clerk, Organization activa y membership persistente; Owner y Manager usan `integration:connect`, Client sólo `integration:self_connect` con `client_self_onboard`, y Employee se deniega. El body no controla Organization, actor, membership, Store, provider ni identidad externa; el origen del POST debe coincidir con el origin de la redirect URI estática.

El runtime guarda un attempt de diez minutos y devuelve sólo la authorization URL oficial. La callback exige la misma sesión/membership tenant-bound, comprueba state, expiración y consumo antes de intercambiar el code; luego consulta `/users/me`, cifra tokens al crear la pending authorization y devuelve únicamente `READY_FOR_ONBOARDING` o `READY_FOR_RECONNECT` con displayName opcional. No devuelve tokens, code, ciphertext ni identidad técnica. Replays, respuestas inválidas y denials no realizan un segundo token exchange.

La configuración es server-only: `MERCADO_LIBRE_CLIENT_ID`, `MERCADO_LIBRE_CLIENT_SECRET`, `MERCADO_LIBRE_REDIRECT_URI`, `INTEGRATION_SECRETS_MASTER_KEY` y el flag explícito `MERCADO_LIBRE_PKCE_ENABLED`. PKCE usa S256 sólo cuando ese flag es `true` y la Developers Application lo tiene habilitado. No se ejecutó authorize, callback, token exchange ni `GET /users/me` reales durante esta subfase; tampoco se creó Store, Connection, assignment, secreto permanente ni audit event.

## Permisos funcionales y capabilities futuras

La Developers Application configura permisos funcionales de sólo lectura o lectura/escritura; la documentación oficial también expone `read`, `write` y `offline_access` en el flujo. Se solicitará el mínimo necesario y se decidirán los permisos cuando se aprueben capacidades concretas. Etiquetas de la pantalla de autorización son permiso funcional/UX, no equivalencia automática con scopes técnicos.

Capacidades posteriores del adapter: Identity, Listings, Orders, Questions, Shipping, Promotions, Metrics y Billing/fiscal data sólo si la API y el permiso aprobado lo permiten. No se implementan en este checkpoint.

## Decisiones humanas pendientes

| Decisión | Recomendación |
| --- | --- |
| Quién conecta ML | Owner solamente en el primer hito; evaluar Manager después. |
| Nombre inicial de Store | Owner lo confirma; nickname ML sólo sugerencia editable. |
| Connection disabled | Reactivar la misma Connection de su Store original. |
| Cuenta ya ligada a otra Store/tenant | Rechazar con conflicto opaco; reasignación sólo mediante flujo administrativo futuro. |
| Store + Connection | Sí, una única transacción después de resolver identidad y confirmar Store. |
| Liberación de cuenta disabled | Mantener como comportamiento técnico actual sólo hasta aprobar una política histórica definitiva. |

## Fuentes oficiales revisadas el 2026-08-24

- [Autenticación y autorización](https://developers.mercadolibre.com.ar/es_mx/autenticacion-y-autorizacion)
- [Gestión de identidades y tokens](https://developers.mercadolibre.com.ar/es_ar/administra-proyectos-aplicaciones/gestion-de-identidades-y-accesos-oauth-y-tokens)
- [Consulta de usuarios](https://developers.mercadolibre.com.ar/es_ar/manejo-de-envios/servicios-consulta-usuarios)
- [Gestión de aplicaciones y revocación](https://developers.mercadolibre.com.ar/es_ar/es_ar/gestiona-tus-aplicaciones)
- [Permisos funcionales](https://developers.mercadolibre.com.ar/permisos-funcionales)

## Cierre 2.15 — onboarding, roles y auditoría

### Benchmark funcional

MercadoCuentas queda registrado únicamente como benchmark funcional, referencia de UX y de flujos operativos, y fuente de ideas de capacidades. Mercado Libre es el provider prioritario actual. No se copian backends, endpoints privados, AJAX, cookies, credenciales ni mecanismos propietarios; toda implementación futura usará APIs oficiales.

### Roles de conexión

El modelo canónico sigue siendo `Owner`, `Manager`, `Employee`, `Client`; no se agregan `Administrator` ni `Operator`.

- `Owner`: permitido para conectar/reconectar cualquier Store de su Organization.
- `Manager`: permitido para conectar/reconectar cualquier Store de su Organization.
- `Employee`: denegado inicialmente para administrar Connections/OAuth.
- `Client`: permitido sólo para self-onboarding y reconnect de su propia Store, sin administración global.

El email puede ayudar a vincular la experiencia de Client, pero no prueba propiedad de Mercado Libre. La identidad técnica sigue siendo OAuth → `GET /users/me` → `id`.

### Onboarding de Client y administrativo

El flujo de Client previsto es Clerk → membership persistente Client → ausencia de assignment → OAuth oficial → identidad ML → confirmación de Store → Store + Connection + `store_assignment` → dashboard. El flujo administrativo Owner/Manager puede conectar y luego asignar Client/Employees. Cada Employee usa su propia identidad Clerk, membership y assignments; no se comparte login principal de Mercado Libre.

Store + Connection deben ser atómicos en onboarding administrativo. Client requiere Store + Connection + assignment atómicos o transaccionalmente coherentes. No se implementa aún.

### Idempotencia definitiva pendiente

Una cuenta activa o deshabilitada no debe producir duplicados históricos silenciosos. Se recomienda reactivar la misma Connection disabled, denegar cross-tenant y exigir flujo administrativo explícito para otra Store. El índice parcial actual (`provider + external_account_id` sólo `active`) no expresa todavía la política definitiva; requiere revisión de schema antes de OAuth real. No se crea migration en 2.15.

### Audit Log y Export Center

El futuro Audit Log será server-side: `audit:read` permitido a Owner y Manager, denegado a Employee y Client. Los eventos deberán atribuir actor, acción, fecha, Organization, Store y recurso, con metadata allowlisted/sanitizada y sin secretos, tokens, códigos, cookies ni PII innecesaria. La futura foundation `audit_events` es requisito previo a mutaciones ML productivas.

`Export Center` queda como capability futura, con Mercado Libre como primer provider considerado. Sus exportaciones deberán respetar RBAC y Store Scope y validarse individualmente contra la API oficial; no se implementa en 2.15.

### Preparación restante antes de OAuth real

2.16 deja foundations locales, pero todavía faltan secret storage de producción, refresh rotation real, servicio que derive el contexto Clerk para las primitives, rutas OAuth, UI, token exchange y validación remota separada. Ninguno se habilita por esta subfase.

## 2.20J — observabilidad segura del refresh

El refresh server-side conserva una taxonomía interna por etapa (`READ`, `DECRYPT`, `CLAIM`, `DOUBLE_CHECK`, `PROVIDER_REQUEST`, `PROVIDER_RESPONSE`, `ENCRYPT`, `CAS_COMPLETE`, `RELEASE`). Distingue configuración, lectura/descifrado, claim/busy, red, timeout, HTTP, `invalid_grant`, respuesta inválida, cifrado, CAS y release.

El cliente público continúa recibiendo errores normalizados y genéricos. Sólo se conservan server-side un código seguro, stage, status HTTP y códigos allowlisted del proveedor. Nunca se registran tokens, ciphertext, secretos, bodies ni headers sensibles. No existe retry automático del refresh token; cualquier retry real requiere autorización explícita y será único.

## 2.20K — resultado del segundo refresh real

El único intento autorizado finalizó en `CAS_COMPLETE / REFRESH_CAS_FAILED`. Mercado Libre aceptó el refresh y devolvió credenciales rotadas válidas, pero la rotación no quedó confirmada en persistencia: `credential_version` permaneció en 1, el access token siguió vencido y el lease quedó libre. Las credenciales nuevas existieron sólo en memoria; el refresh token persistido debe tratarse como potencialmente consumido y no reutilizable. No se ejecutó `GET /users/me`, listing sync ni una segunda llamada. Antes de cualquier reconnect debe diagnosticarse y corregirse el CAS; un tercer refresh no está autorizado.
