# Base de datos y migraciones

Supabase se usará únicamente como PostgreSQL; Supabase Auth queda fuera de la arquitectura. La autoridad de tenant llega al servidor desde Clerk y no desde parámetros controlados por el cliente.

> **Validation evidence:** [database-runtime-validation.md](./database-runtime-validation.md). **Operational history:** [índice de prompts de Fase 2](./prompts/phase-02/README.md). Este documento conserva el diseño canónico, no transcripciones de prompts.

> **Lectura histórica:** cada bloque identificado por Subfase o Checkpoint es un
> snapshot de ese momento. Sus afirmaciones sobre remoto, OAuth o RLS pueden
> quedar superadas por las secciones posteriores y el estado runtime vigente.

## Estado de la Subfase 2.1

**Database Runtime Validation: LOCAL VALIDATED.** Docker y Supabase CLI ejecutaron localmente desde cero las migraciones 2.2 y 2.5 en dos resets reproducibles. La matriz runtime verificó schema, constraints, aislamiento por FKs compuestas, `ON DELETE RESTRICT` y semántica de Connections. No existe link remoto, no se ejecutó `db push` y OAuth permanece diferido. Este documento continúa siendo canónico; ver [checkpoint runtime](./database-runtime-validation.md) para la evidencia de ejecución. Connections no contiene tokens ni secretos.

Bootstrap First Owner está validado localmente por una RPC transaccional con advisory lock por Organization. Una Organization puede tener **uno o más Owners**: el lock serializa únicamente el primer bootstrap y no introduce unicidad permanente. Una membership existente no-Owner no se promociona automáticamente. La validación remota posterior se realizó con fixtures limpiados; 2.20T no introduce nuevas mutaciones de bootstrap.

**Remote Supabase: LINKED + VALIDATED.** El proyecto remoto `ffcudwwrzttkumbdvada` tiene las migrations aplicadas; schema, constraints y bootstrap funcional fueron validados con fixtures limpiados. Concurrencia se validó localmente; no se repitió en remoto. Fallback Clerk sigue TRANSITIONAL, RLS permanece aplicado sin policies browser-facing, OAuth/reconnect real de 2.20R ya fue validado y 2.20T está cerrado. Production Ready NO.

## 2.10 — Activación de autoridad de membership

La consulta `hub_memberships` se ejecuta por `(organization_id, clerk_user_id)` y es la autoridad primaria del rol de negocio. Una fila válida se usa tal cual; la ausencia tras una consulta exitosa habilita de manera temporal el mapping de Clerk. Los errores de Supabase se propagan desde el repository como error de persistencia y el boundary de autorización responde fail-closed, sin asignar un rol Clerk como sustituto. No se añadió migration ni se creó ninguna membership, Store o assignment real durante este checkpoint.

Supabase CLI `2.114.0` está instalada como `devDependency` exacta y se ejecuta con `bunx supabase`; `bunfig.toml` mantiene su política de antigüedad mínima de siete días. El intento documentado de `2.115.0` fue bloqueado por esa política y no se la desactivó. `supabase init` creó la configuración local versionable en `supabase/config.toml`, sin link remoto, credenciales ni schema funcional.

## Convenciones

- Esquema PostgreSQL: `public`; nombres SQL en `snake_case` y tablas en plural.
- Identificadores internos: `uuid`, generados con `gen_random_uuid()` después de garantizar `pgcrypto` en la primera migración.
- Identificadores externos de Clerk y de proveedores: `text`; no se transforman ni se asumen UUID.
- Fechas: `timestamptz NOT NULL DEFAULT now()` para `created_at` y `updated_at`.
- `updated_at` se asignará explícitamente en cada mutación desde los repositorios server-only. No se introduce un trigger genérico en el primer schema.
- Roles, estados y providers se representan como `text` con `CHECK`, no como PostgreSQL enums: cambian sin migraciones de tipo y son consistentes con los contratos TypeScript.
- No se añade `deleted_at` por convención. Las conexiones usan estado controlado; el borrado de memberships y Stores se restringe mientras existan relaciones.

## Subfase 2.20C — foundation de listings

La migración forward-only `20260824223000_phase_2_listings_foundation.sql` incorpora `listings` como representación canónica y agnóstica de una publicación externa. La identidad idempotente es `unique(connection_id, external_listing_id)`: título, SKU y permalink son atributos mutables y no forman identidad.

Cada fila conserva `organization_id`, `store_id` y `connection_id`. Una FK compuesta hacia `connections (id, store_id, organization_id)` impide asociar una listing a otra Store u Organization; la migración añade la clave única compuesta necesaria en `connections` sin alterar migrations previas. El repository comprueba el mismo scope antes del upsert y falla cerrado ante cualquier discrepancia.

`price numeric(20,4)` evita `float`; TypeScript sólo recibe números normalizados válidos y el repository serializa el número a texto para el driver, preservando la escala que entrega el proveedor. `status` permanece `text` no vacío para no cerrar el modelo sobre estados de Mercado Libre. `seller_sku` es nullable y sólo puede provenir de `SELLER_SKU`; `seller_custom_field` no se persiste como fallback.

El sync es idempotente por la constraint y el upsert: actualiza campos observables y `last_synced_at`, sin cambiar los bindings ni borrar listings ausentes de una página. No guarda payloads raw, no crea workers/cron/sync runs y no implementa reconciliación o borrado. RLS queda enabled sin policies browser-facing; `PUBLIC`, `anon` y `authenticated` no tienen acceso, y `service_role` conserva DML exclusivamente server-side.

La migration y matriz se validaron desde cero únicamente en Supabase local. Las fixtures deterministas se ejecutaron dentro de una transacción terminada en `ROLLBACK`: primer insert, segundo sync idempotente, actualización de precio/stock/status/timestamp, SKU nulo, dos listings, mismo external ID en otra Connection, rechazo cross-store y DML de `service_role`. Las lecturas directas de `anon` y `authenticated` fueron denegadas. No se aplicó migration ni se persistió una listing en remoto.

## Subfase 2.20D — validación remota de listings

La migration `20260824223000_phase_2_listings_foundation.sql` fue aplicada exclusivamente al proyecto remoto `ffcudwwrzttkumbdvada` después de un dry-run que enumeró sólo esa migration. Local y remoto quedaron alineados. La tabla `public.listings` existe con `price numeric(20,4)`, FK compuesta hacia `connections`, unique `(connection_id, external_listing_id)`, RLS enabled y cero policies browser-facing.

La matriz remota se ejecutó con `service_role` dentro de una transacción revertida: first insert, upsert idempotente, actualización de precio/stock/status/sold quantity, SKU nulo, dos listings, mismo external ID en otra Connection, `last_synced_at` y ownership mismatch pasaron. Se observaron 3 fixtures durante la transacción y 0 después del rollback. `PUBLIC`, `anon` y `authenticated` no tienen acceso; las comprobaciones directas de SELECT e INSERT para anon/authenticated fueron denegadas. `service_role` conserva DML.

El postcheck mantiene Listings 0, Stores 1, Connection 1 activa, Assignments 0, `integration_secrets` 1 y Owner persistente 1. No se persistió la publicación real de E.A.ZOCOOL, no hubo sync real ni mutaciones de Mercado Libre.

## Subfase 2.20F — rotación segura local de credenciales

La migración forward-only `20260825100000_safe_integration_secret_refresh_rotation.sql` prepara la rotación concurrente de `integration_secrets` sin retener una transacción de PostgreSQL durante HTTP. Cada secreto tiene `credential_version` monotónica y un lease efímero (`refresh_lease_id`, `refresh_lease_expires_at`). Tres RPCs `SECURITY DEFINER`, con `search_path=pg_catalog` y ejecución exclusiva de `service_role`, reclaman, completan con compare-and-swap y liberan el refresh. RLS queda enabled, sin policies browser-facing; `PUBLIC`, `anon` y `authenticated` no reciben acceso.

El lease dura 60 segundos. El provider request se limita a 15 segundos y la actualización acepta únicamente la versión y lease owner originales; un writer stale no puede sobrescribir credenciales nuevas. Un trigger incrementa la versión y limpia el lease cuando otro flujo autorizado —como reconnect— cambia el material de credenciales, de modo que tampoco puede dejar vigente un CAS de refresh anterior. Una vez reclamado el lease, el servidor relee antes de llamar al provider. Si otro request ya actualizó el token, reutiliza el valor actual; si el refresh falla o la respuesta está incompleta, no se persiste nada y se liberan las credenciales para un retry posterior/reconexión aprobada.

Esta foundation es local: no se aplicó la migration remota, no se ejecutó refresh real ni se persistieron listings reales.

## Subfase 2.20G — validación remota de rotación segura

La migration `20260825100000_safe_integration_secret_refresh_rotation.sql` fue aplicada únicamente al proyecto remoto dedicado `ffcudwwrzttkumbdvada` tras un dry-run que listó sólo esa migration. Local y remoto quedaron alineados. `integration_secrets` contiene `credential_version bigint not null default 1`, `refresh_lease_id uuid` y `refresh_lease_expires_at timestamptz` nullable.

Las RPC de claim, complete CAS y release son `SECURITY DEFINER`, fijan `search_path=pg_catalog` y sólo `service_role` puede ejecutarlas. RLS sigue enabled sin policies browser-facing; `PUBLIC`, `anon` y `authenticated` no tienen acceso a la tabla ni ejecución de las RPC.

La matriz remota se ejecutó con fixtures deterministas dentro de una subtransacción deliberadamente revertida: versión inicial, claim, claim concurrente `busy`, lease activo, recuperación de lease vencido, complete CAS, rechazo stale, release y version bump por reconnect pasaron. El postcheck confirmó cero fixtures residuales, Owner persistente 1, Store 1, Connection activa 1, Assignments 0, `integration_secrets` 1 y listings 0. No se leyó material de credenciales, no se ejecutó refresh real ni sync real.

## Subfase 2.20H — primer refresh real: STOP sin escritura confirmada

La invocación controlada del runner server-only terminó con un error normalizado antes de poder confirmar la rotación. El postcheck remoto read-only confirmó `credential_version=1`, access token aún expirado, lease limpio, envelope de refresh presente, Connection activa, Store 1, Connection 1, Assignments 0, `integration_secrets` 1 y listings 0. No se confirmó POST `/oauth/token`, no hubo escritura de credenciales y no se reintentó. El refresh real queda pendiente hasta resolver el fallo del runner y obtener una nueva autorización explícita.

## Subfase 2.16 — foundations OAuth, Connection y Audit

La migración `20260824184934_oauth_security_foundations.sql` añade foundations locales para `oauth_attempts`, `integration_secrets` y `audit_events`. Los intentos almacenan sólo el digest de state, se atan a Organization y actor membership, expiran y se consumen una sola vez. Las credenciales se separan de `connections` y se almacenan como ciphertext autenticado application-level; la clave maestra server-only se identifica como `INTEGRATION_SECRETS_MASTER_KEY` y nunca se versiona.

La identidad externa pasa a ser única para `(provider, external_account_id)` aun si la Connection está `disabled`; deshabilitar no libera una cuenta para crear una fila histórica duplicada. Las primitives SQL de onboarding son atómicas: administrativa (Store + Connection) y Client (Store + Connection + assignment), con lock asesor por identidad externa y outcomes controlados. `audit_events` conserva metadata JSON limitada y rechaza claves sensibles conocidas. Nada de esta foundation ejecuta OAuth, crea datos reales ni aplica migraciones remotas.

## Subfase 2.17 — hardening de privilegios local

La migración forward-only `20260824191800_database_privilege_hardening.sql` habilita RLS deny-by-default, sin policies browser-facing, para `oauth_attempts`, `integration_secrets` y `audit_events`. También habilita el mismo límite para las tablas core (`hub_memberships`, `stores`, `store_assignments` y `connections`): es compatible con la arquitectura actual porque los repositories son server-only y `service_role` tiene `BYPASSRLS` y DML explícito.

`PUBLIC`, `anon` y `authenticated` no tienen acceso directo a esas tablas ni `EXECUTE` sobre `bootstrap_first_owner` o los RPCs de onboarding. Sólo `service_role` conserva DML/ejecución necesarios para el backend. Las tres functions continúan como `SECURITY DEFINER` porque realizan mutaciones atómicas que requieren esa primitive, con tablas schema-qualified y `search_path = pg_catalog` fijo. La validación local se ejecutó con operaciones reales bajo `anon`, `authenticated` y `service_role`, todas las fixtures fueron revertidas y el estado remoto continúa sin cambios.

## Subfase 2.18 — aplicación y validación remota

Las migrations `20260824184934_oauth_security_foundations.sql` y `20260824191800_database_privilege_hardening.sql` fueron aplicadas al proyecto remoto dedicado `ffcudwwrzttkumbdvada` después de un dry-run que incluyó exclusivamente esas dos migrations. RLS está habilitado en las siete tablas Hub y no existen policies browser-facing. `PUBLIC`, `anon` y `authenticated` no tienen DML/SELECT directo; `service_role` conserva DML server-only y EXECUTE exclusivo de las tres RPCs internas.

La validación remota ejecutó lecturas y llamadas de RPC denegadas para `anon` y `authenticated`, y una primitive de `service_role` dentro de rollback. No quedaron fixtures: hay una única membership Owner persistente y cero Stores, assignments, Connections, OAuth attempts, secretos de integración y eventos de auditoría. OAuth real y runtime Mercado Libre permanecen sin iniciar.

## Subfase 2.19B — autorización OAuth pendiente local

La migration forward-only `20260824195457_oauth_pending_authorizations.sql` agrega una staging table server-only para una identidad OAuth ya verificada antes de crear una Connection. Está vinculada de forma compuesta al attempt que la originó —Organization, actor membership, provider y purpose— y permite como máximo una pending authorization por attempt. Conserva sólo la identidad externa normalizada, display opcional y tokens cifrados con la misma clave AES-256-GCM existente; su TTL de onboarding es de 20 minutos, independiente de la expiración del access token.

La tabla tiene RLS sin policies browser-facing, grants sólo para `service_role` y no expone RPC pública.

## Subfase 2.19G — finalización atómica de pending local

La migration forward-only `20260824210000_finalize_pending_oauth_onboarding.sql` añade `finalize_admin_pending_integration_onboarding`. La RPC recibe sólo Organization, actor membership, pending ID opaco y nombre visible de Store; vuelve a validar binding, purpose, estado y expiración server-side. Dentro de una transacción bloquea la identidad `(provider, external_account_id)`, crea o reactiva la Connection, transfiere los envelopes cifrados directamente a `integration_secrets`, registra auditoría allowlisted y consume la pending. No descifra tokens ni requiere la master key en PostgreSQL.

El path inicial administrativo cubre `admin_connect` y `reconnect`: una Connection activa devuelve `already_connected`, una disabled se reactiva y un conflicto cross-tenant devuelve `conflict` sin crear Store ni transferir secretos. No crea `store_assignment`.

La migration `20260824210000_finalize_pending_oauth_onboarding.sql` fue aplicada al proyecto remoto de desarrollo `ffcudwwrzttkumbdvada` el 2026-08-24. La RPC está presente con `SECURITY DEFINER`, `search_path=pg_catalog` y ejecución exclusiva de `service_role`. La validación remota con fixtures y `ROLLBACK` confirmó que no dejó datos residuales, pero detectó un bloqueador en la rama `reconnect`: `ON CONFLICT (connection_id)` es ambiguo porque `connection_id` también es una columna de salida de la función. La migration forward `20260824220000_fix_finalize_oauth_reconnect_conflict.sql` usa la constraint primaria explícita `integration_secrets_pkey`, preserva los grants y quedó aplicada y validada remotamente. Las cuatro ramas transaccionales —Store nueva, reconnect disabled, active existing y conflicto cross-tenant— pasaron sin fixtures residuales. El primer onboarding real administrativo se completó con una nueva pending OAuth válida: creó una Store `E.A.ZOCOOL`, una Connection Mercado Libre activa, un secreto cifrado y los eventos `store.created` e `integration.connected`; no creó assignment. La pending fue consumida atómicamente y no se expusieron secretos.

## Subfase 2.19C — aplicación y validación remota

La migration `20260824195457_oauth_pending_authorizations.sql` fue aplicada exclusivamente al proyecto remoto dedicado `ffcudwwrzttkumbdvada` después de un dry-run que listó sólo esa migration. El schema remoto conserva la FK compuesta de attempt/Organization/actor/provider/purpose, la unicidad por `oauth_attempt_id`, los campos cifrados y el TTL de 20 minutos.

La tabla tiene RLS habilitado y cero policies browser-facing. `PUBLIC`, `anon` y `authenticated` no tienen SELECT ni DML; las pruebas reales de lectura con `anon` y `authenticated` fueron denegadas. `service_role` conserva DML server-only, validado dentro de una transacción revertida que comprobó creación y consumo único. No quedaron fixtures: `oauth_pending_authorizations`, OAuth attempts, secretos, auditoría, Stores, assignments y Connections permanecen en cero; se conserva una única membership Owner persistente. OAuth real y rutas runtime siguen sin iniciar.

## DDL creado para Subfase 2.2

Este bloque corresponde a la migración versionada, **aún no ejecutada**. La validación real contra una base local queda pendiente de Docker.

```sql
create extension if not exists pgcrypto;

create table public.hub_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clerk_user_id text not null,
  role text not null check (role in ('Owner', 'Manager', 'Employee', 'Client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_memberships_organization_user_key unique (organization_id, clerk_user_id),
  constraint hub_memberships_id_organization_key unique (id, organization_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_id_organization_key unique (id, organization_id)
);

create index stores_organization_status_idx on public.stores (organization_id, status);

create table public.store_assignments (
  membership_id uuid not null,
  store_id uuid not null,
  organization_id text not null,
  created_at timestamptz not null default now(),
  constraint store_assignments_pkey primary key (membership_id, store_id),
  constraint store_assignments_membership_organization_fkey
    foreign key (membership_id, organization_id)
    references public.hub_memberships (id, organization_id) on delete restrict,
  constraint store_assignments_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict
);

create index store_assignments_store_membership_idx
  on public.store_assignments (store_id, membership_id);

```

No existe una tabla local de Organizations: `organization_id` referencia la Organization externa de Clerk. Las claves foráneas compuestas de la migración impiden que un assignment relacione memberships y Stores de Organizations distintas. No hay una restricción SQL simple para limitar assignments a Employee/Client sin duplicar el rol: los repositorios posteriores impondrán esa política junto con permiso y Store Scope.

Los nombres de Store no son únicos por Organization: son etiquetas de usuario, no una clave de negocio estable. Un slug o código único solo se añadirá si un caso de producto lo necesita. `connections` está definida en la migración 2.5 y fue validada localmente; tokens OAuth permanecen diferidos a Fase 3.

## Estrategia reproducible de migraciones

La opción recomendada es **A — Supabase CLI como devDependency exacta del proyecto**, invocada con Bun. Evita depender de una instalación global y hace que desarrollo y CI usen la misma versión registrada en `package.json` y `bun.lock`.

| Opción | Evaluación |
| --- | --- |
| A. `supabase` devDependency exacta | Recomendada: queda versionada en el proyecto y reproducible en CI. Requiere aprobación para descargar y cambiar el lockfile. |
| B. `bunx`/`npx` sin dependencia | No recomendada: puede resolver una versión distinta entre ejecuciones o equipos. |
| C. Binario de CI pinneado | Complemento posible en CI, pero no sustituye una herramienta local versionada para el flujo inicial. |

La convención preparada es:

```text
supabase/config.toml
supabase/migrations/<UTC timestamp>_<descripcion_en_snake_case>.sql
```

Ejemplo: `20260821143000_create_hub_tenant_schema.sql`. La CLI debe generar el nombre (`supabase migration new create_hub_tenant_schema`) para evitar colisiones. Cada cambio posterior será una migración nueva y aditiva; no se edita una migración ya aplicada. Una corrección se realiza mediante una migración forward, no mediante rollback destructivo en entornos compartidos.

El flujo reproducible previsto es: crear la migración con la CLI aprobada, arrancar una instancia local de Supabase con Docker, aplicar desde cero mediante `supabase db reset`, inspeccionar el schema/constraints/índices y ejecutar los tests que se creen en 2.2. Esta migración no se ejecutó aún. `supabase link`, `supabase db push`, login y cualquier base remota están fuera de 2.2 y no son parte de la validación inicial.

En este equipo no se detectó Docker, por lo que la validación local no puede prometerse aún. Antes de 2.2 deberá estar disponible un runtime Docker compatible. Una base remota de desarrollo solo podrá evaluarse después de definir acceso, aislamiento y un procedimiento no destructivo; no sustituye la repetición local desde cero.

## Seguridad y límites

- RLS no se crea ni se habilita en esta subfase. La service role puede bypassearla; la defensa primaria posterior será contexto server-side, repositorios tenant-scoped y estas constraints.
- Toda lectura o mutación futura debe recibir `organization_id` desde `ServerAuthorizationContext`, incluirlo en su predicado y ejecutarse atómicamente. `store_id` de URL/body/query solo identifica el objetivo y nunca autoriza el tenant.
- Los repositorios 2.3/2.4 son server-only y exigen `organization_id` en cada lookup, incluso al listar IDs de Store autorizados. El resolver de Store Scope no habilita rutas, guards nuevos, bootstrap de Owner ni conexiones funcionales. La migración aún no fue ejecutada.
- La generación de tipos de base de datos se evaluará cuando el schema exista realmente y haya un contrato de consumo server-side aprobado; no se genera ni se versiona ahora.
# Subfase 2.11

No se requieren migraciones nuevas ni cambios remotos. Las primitivas usan las tablas existentes, verifican pertenencia por Organization y mantienen la invariante de último Owner en el servicio. La revocación elimina únicamente la tupla `(organization_id, membership_id, store_id)` exacta.

## Subfase 2.20I — diagnóstico no destructivo del refresh real

El único intento real de 2.20H terminó en `real_refresh_failed`. La auditoría no volvió a invocar Mercado Libre, no reclamó el lease real y no confirmó una escritura: el estado remoto permanece en `credential_version=1`, access expirado, refresh cifrado presente y lease libre.

La configuración requerida está presente (`MERCADO_LIBRE_CLIENT_ID`, `MERCADO_LIBRE_CLIENT_SECRET`, redirect HTTPS exacta y PKCE deshabilitado). La master key es válida (32 bytes Base64URL) y el descifrado server-side de access y refresh pasó sin mostrar plaintext. El contrato estático construye un POST form-urlencoded al endpoint oficial con `grant_type=refresh_token`, client id, client secret y refresh token, con timeout de 15 s.

No se conservó HTTP status, código del proveedor ni una traza segura que confirme si se alcanzó `/oauth/token`; por ello la etapa exacta es desconocida y la clasificación es **C — observabilidad insuficiente**. Antes de un único retry futuro se requiere instrumentación server-side mínima que distinga configuración, descifrado, claim, red/timeout, HTTP, respuesta inválida, cifrado, CAS y release, sin secretos. No se modificó código ni migration.

## Subfase 2.20J — observabilidad segura del refresh

La instrumentación local clasifica el refresh por etapa y código seguro, separa timeout de red, conserva status HTTP y sólo un código allowlisted (`invalid_grant`) del proveedor. El error público permanece genérico; el release secundario no reemplaza el fallo primario. No se modificaron lease, `credential_version`, CAS, cifrado, schema, RLS ni grants. No hubo refresh real, escritura remota ni migration nueva.

## Subfase 2.20K — segundo refresh real detenido en CAS

Se ejecutó una única vez la primitive real para la Connection activa de E.A.ZOCOOL. La configuración y el descifrado server-side pasaron; la ejecución terminó de forma segura en `stage=CAS_COMPLETE`, `safeCode=REFRESH_CAS_FAILED`. No se reintentó y no se ejecutó `GET /users/me`.

El postcheck remoto read-only confirmó `credential_version=1`, access expirado, refresh cifrado presente, lease libre, Store 1, Connection 1, Assignments 0, `integration_secrets` 1 y listings 0. Las credenciales persistidas anteriores permanecen sin cambios. Como el fallo ocurrió después de una respuesta válida del provider que incluyó refresh rotado, pero antes de un CAS confirmado, el refresh persistido debe considerarse potencialmente consumido y **no reutilizable**. La Connection queda en estado **RECONNECT_REQUIRED** antes de cualquier nueva operación; no se ejecutó reconnect en esta subfase ni se autoriza un tercer refresh.

## Subfase 2.20Q — finalización de reconnect target-bound

La migration append-only `20260825160000_bind_reconnect_finalization_target.sql`
hace que `finalize_admin_pending_integration_onboarding` use exclusivamente el
`target_connection_id` server-resolved para `purpose=reconnect`. La RPC bloquea
y valida Connection, Store, Organization, provider, identidad externa y estado;
no usa fallback por provider/identidad ni puede crear Store o Connection.

Un reconnect válido actualiza el secreto existente, deja estable su cardinalidad,
incrementa `credential_version` mediante el trigger canónico, limpia el lease,
activa la Connection, audita `integration.reconnected` y consume la pending al
final de la misma transacción. Fallos revierten estado, credenciales, versión,
lease, auditoría y consumo. Reset y matriz SQL local 13/13 pasaron con cero
duplicados y cero fixtures persistidos; remoto y datos reales no se tocaron.

Las migrations `20260825143100`, `20260825150000` y `20260825160000` fueron
aplicadas al proyecto remoto dedicado. La inspección confirmó columna UUID, FK
restrictiva, CHECK, RPC target-bound, `SECURITY DEFINER`, `search_path` seguro,
grant exclusivo de backend y RLS sin policies browser-facing. La matriz remota
sintética pasó 8/8 con rollback y cero residuos; los conteos reales, versión de
credencial, lease, listings y pending legacy permanecieron sin cambios.

## Subfase 2.20E — primera persistencia real de listings

Tras el reconnect real de 2.20R, la credencial persistida vigente permitió
reanudar el primer sync controlado. El runtime oficial recuperó 1 publicación
mediante seller search y multiget, la normalizó como `ExternalListingSummary` y
`ListingSyncService` creó 1 fila tenant-scoped en `public.listings`.

Una segunda sincronización del mismo conjunto mantuvo la misma fila y el mismo
`external_listing_id`, actualizó el timestamp de sync y dejó Listings en 1. El
postcheck confirmó Store y Connection correctas, provider Mercado Libre, datos
esenciales completos y 0 duplicados. `integration_secrets` permaneció en 1,
`credential_version` en 2 y el lease libre: no se ejecutó refresh. No hubo
escrituras en Mercado Libre, OAuth, reconnect, migration ni cambios de schema.

## Subfase 2.20S — hardening local del listing backfill

El contrato canónico y `ListingRepository` pasan a escribir y leer
`provider_created_at` y `provider_updated_at`, columnas nullable que ya existían
en `public.listings`. Los valores proceden exclusivamente de `date_created` y
`last_updated` oficiales; no se sustituyen por el reloj local. El upsert por
`(connection_id, external_listing_id)`, los bindings compuestos y
`last_synced_at` permanecen sin cambios.

El backfill persiste cada batch válido mediante `ListingSyncService` y devuelve
conteos agregados de discovery, requests, details, persistencia y fallos. Un
item inválido o fallido no bloquea otros batches, pero una falla DB continúa
fallando cerrado. No se agregan tablas, columnas, sync runs, métricas, audit,
missing detection, soft-delete ni migration.

## Subfase 2.20T — listing sync runs persistentes

La migration `20260825220634_listing_sync_runs.sql` agrega
`public.listing_sync_runs` como modelo específico del backfill de listings, no
como plataforma genérica de jobs. Cada run queda ligado mediante FKs compuestas
a Organization, Store, Connection y actor membership. `kind` se limita a
`listing_backfill`; los estados posibles son `running`, `succeeded`, `partial`
y `failed`, con coherencia entre estado, `completed_at` y el error allowlisted.

Los siete contadores de discovery, requests, details, persistencia, fallos,
páginas y batches son no negativos. La idempotency key UUID es única por
Organization, Connection y kind; un índice parcial permite un solo run
`running` por Connection/kind. La clave sólo deduplica una solicitud ya
autorizada y nunca decide tenant o scope.

`start_listing_sync_run` serializa por la Connection tenant-bound, resuelve
`started`, `reused` o `already_running` e inserta `listing.sync.started` en la
misma transacción. `checkpoint_listing_sync_run` acepta únicamente contadores
monotónicos para un run tenant-bound que siga `running`.
`finalize_listing_sync_run` realiza una sola transición terminal y su audit
correspondiente de forma atómica. La tabla y las tres RPC tienen RLS sin
policies browser-facing; PUBLIC, `anon` y `authenticated` no tienen acceso, y
`service_role` es el único rol habilitado.

La resolución idempotente valida primero los bindings de Organization, Store,
Connection y actor. Una key ya existente devuelve el run histórico aunque la
Connection haya sido deshabilitada después, sin ejecutar trabajo ni crear otro
run/audit. Una key nueva exige que la Connection siga activa y falla cerrado si
está disabled. Los counters de checkpoint/finalize rechazan tanto negativos
como `NULL` explícitamente.

El checkpoint contiene sólo contadores y timestamps: **checkpoint no es
resumability**. No se persisten offset, cursor ni `scroll_id`; una nueva
ejecución comienza discovery desde cero. Una caída de proceso puede dejar un
run `running`; la recuperación administrativa de stale runs permanece
explícitamente diferida.

La migration fue aplicada al proyecto remoto dedicado y su history quedó
alineado. La inspección confirmó columnas, constraints, FKs, índices, RLS sin
policies, grants server-only y las tres RPC con `SECURITY DEFINER` y
`search_path=pg_catalog`. La matriz sintética remota pasó 22/22 dentro de una
transacción revertida: no persistió runs, audits, Stores, Connections ni
Listings fixture. Los conteos reales permanecieron en Stores 1, Connections 1,
Listings 1 e `integration_secrets` 1; `credential_version` permaneció en 2 y el
lease libre.

### Estado runtime final 2.20T

El root cause de input scope fue corregido en el caller: `ListingScope` se
construye explícitamente con Organization, Store y Connection; actor membership
e idempotency key quedan fuera del scope estricto. Finalize recibe únicamente
los siete counters canónicos y excluye `failures`. La observabilidad CAS
distingue categorías seguras sin persistir mensajes crudos ni secretos.

La ejecución real creó el run y completó discovery, detail fetch, persistencia
y checkpoints. La recuperación autorizada finalizó ese mismo run como
`succeeded` sin repetir trabajo del provider. Los counters quedaron
`1/1/1/1/0`, con una página y un batch; existen exactamente un audit
`listing.sync.started` y uno `listing.sync.succeeded`, sin terminales duplicados
ni runs `running`.

Stores, Connections, Listings e `integration_secrets` permanecen en 1,
duplicados en 0, `credential_version` en 3 y lease `CLEAR`. 2.20T está cerrado;
al cierre de ese bloque la recovery automática, scheduler/worker, missing
reconciliation y soft-delete continuaban `DEFERRED`. W-B implementa después
únicamente reconciliation interna reversible en local.

## Subfase 2.20U — recuperación administrativa de stale runs

La migration `20260827081922_administrative_stale_listing_sync_recovery.sql`
agrega la RPC `recover_stale_listing_sync_run` sin sumar columnas ni una tabla
de jobs genérica. La RPC es `SECURITY DEFINER`, usa `search_path=pg_catalog`,
no tiene grants para PUBLIC, `anon` o `authenticated` y sólo puede ejecutarla
`service_role`.

La transición bloquea el run, valida Organization, membership Owner/Manager y
los bindings Store/Connection Mercado Libre derivados del propio run. Sólo un
run `running` cuyo `last_checkpoint_at` sea menor o igual al cutoff server-side
puede pasar a `succeeded` o `failed`. `succeeded` exige evidencia completa en
los counters; `failed` usa el código controlado `administrative_recovery`. No
se modifica actor original, checkpoint ni counters.

El estado terminal y los audits terminal canónico y
`listing.sync.recovered` se escriben en una sola transacción. Los audits llevan
la membership del administrador y un reason allowlisted; un retry sobre un run
terminal devuelve `already_terminal` sin duplicar eventos. La matriz local
2.20U pasó 12/12 con rollback y la regresión 2.20T pasó 22/22; el reset local
desde cero fue PASS. La migration también quedó aplicada y validada en remoto
con fixtures sintéticos completamente limpiados: grants, boundaries, outcomes,
audits e idempotencia pasaron, sin modificar runs ni datos reales.

## Subfase 2.20W-B — reconciliación segura ligada al run

La migration `20260827150000_safe_listing_reconciliation.sql` agrega a
`listings` el vínculo nullable `last_seen_sync_run_id`, el estado estricto
`seen|missing_candidate`, `not_seen_since` y
`consecutive_not_seen_count`. Las filas históricas quedan `seen`, sin inventar
un run previo. Una FK compuesta a
`listing_sync_runs(id, connection_id, store_id, organization_id)` impide vínculos
cross-tenant, cross-Store o cross-Connection.

Los runs agregan `reconciliation_eligible`, `missing_candidate_count` y
`reappeared_count`. El primer counter cuenta sólo nuevas transiciones a
candidate; una ausencia repetida conserva `not_seen_since`, incrementa la
evidencia consecutiva y no vuelve a contar el candidate. Reappearance reutiliza
la fila, limpia la evidencia negativa y se cuenta una sola vez.

`persist_listing_sync_batch_for_run` serializa batches positivos contra el run
`running` y rechaza evidencia superada. La RPC
`finalize_listing_sync_run_with_reconciliation` bloquea scope/run, valida
counters y eligibility, reconcilia y emite el audit terminal dentro de una sola
transacción; un retry terminal no repite efectos. Ambas funciones revocan
EXECUTE a PUBLIC, `anon` y `authenticated` y conceden sólo a `service_role`.
El status textual del provider nunca cambia por ausencia. La matriz local W-B
pasó 14/14. W-C aplicó la migration una sola vez y confirmó remotamente
estructura, backfill, grants, FK, RPCs, transiciones e idempotencia con fixtures
sintéticos totalmente eliminados. Las huellas reales post-cleanup coincidieron
con el baseline. **2.20W está cerrado.**

## Subfase 2.20X-B — intake durable de eventos de integración

La migration `20260828120000_integration_event_intake_foundation.sql` crea
`integration_events`, scoped por Organization, Store y Connection mediante FK
compuesta. Conserva sólo metadata canónica segura; no almacena payload raw,
headers, tokens ni texto libre de error.

X-B creó los estados `received|processed|failed`. La unicidad
`(provider, application_id, dedupe_key)` hace idempotentes las entregas.
`intake_integration_event` valida Connection activa, provider, cuenta externa y
scope antes de insertar; una repetición devuelve la fila como `DUPLICATE`.
Tabla y RPC están revocadas a PUBLIC, `anon` y `authenticated`, con acceso
exclusivo de `service_role`.

X-B no define claim/lease, backlog ni procesamiento; quedan diferidos hasta un
worker con semántica aprobada. La matriz SQL local pasó 9/9 desde reset completo.

2.20X-C no cambia schema ni RPCs: el callback público sólo invoca el intake X-B
server-only. Ninguna respuesta HTTP expone el ID de `integration_events`, el
scope persistido ni detalles de base.

## Subfase 2.20X-D — procesamiento incremental y freshness CAS

La migration `20260828150000_incremental_event_processing_freshness_cas.sql`
extiende el lifecycle a `received|processing|processed|failed` y agrega attempts,
lease temporal, clasificación retryable y error seguro. Las RPCs
`claim_integration_event_processing`, `complete_integration_event_listing` y
`fail_integration_event_processing` están revocadas a PUBLIC, `anon` y
`authenticated`; sólo `service_role` puede ejecutarlas.

Completion bloquea evento y Listing y usa exclusivamente
`provider_updated_at`: un dato más nuevo inserta/actualiza la misma fila, uno
anterior es stale no-op y uno igual sólo es no-op si el payload normalizado es
equivalente. Timestamp ausente o empate conflictivo no terminalizan ni mutan el
Listing. Persistencia positiva y `processed` se confirman atómicamente; un 404
se registra como failure permanente sin inferencia sobre el Listing.

La matriz X-D pasó 16/16 sobre DB local, con regresiones X-B y W-B en verde.
No hubo apply remoto. Expired-lease reclaim existe; dispatch de retries,
`next_retry_at`, scheduler y `missed_feeds` permanecen diferidos.

## Subfase 2.20X-E — retries durables

La migration `20260828180000_event_retries_missed_feeds_foundation.sql` agrega
`next_retry_at`, el índice parcial due y el código seguro `retry_exhausted`.
No agrega estados: un transient permanece `failed + retryable`; un failure
permanente o agotado queda `failed + retryable=false` y sin próxima fecha.

`fail_integration_event_processing` programa atómicamente el próximo intento y
respeta un Retry-After normalizado. El backoff local usa base 30 segundos,
exponencial, jitter determinista 0–25 %, máximo una hora y máximo cinco claims.
`list_due_integration_event_retries` valida limit 1..100, ordena por fecha e ID,
exige Connection activa y no reclama ni modifica attempts. RPCs y tabla siguen
revocadas a browser y exclusivas de `service_role`.

Missed feeds no requiere tabla ni dedupe nuevos: sus mensajes pasan por
`intake_integration_event`. La matriz X-E pasó 8/8 tras reset completo; X-D,
X-B y W-B permanecieron en verde. No hubo apply remoto.

## Subfase 2.20X-F — observabilidad de event maintenance

La migration `20260828210000_event_maintenance_observability.sql` crea
`integration_event_maintenance_runs`, tenant-bound por Organization, Store y
Connection. Un índice parcial admite un único run `running` por Connection. El
`run_number` identity ordena de forma determinista el último run y la selección
justa aun cuando varias transacciones comparten timestamp.

Los RPCs server-only listan Connections elegibles y backlogs acotados, inician
y finalizan runs de forma atómica, y entregan el resumen administrativo. El run
persiste cadence/continuación real de `missed_feeds`, timestamps, counters y
los únicos códigos `event_processing_failed|missed_feed_failed`; no conserva
payloads ni errores raw. Tabla, sequence y RPCs están revocados a PUBLIC,
`anon` y `authenticated` y concedidos sólo a `service_role`.

Reset local y matrices X-F/X-E/X-D/X-B/W-B pasaron 55/55. No hubo apply ni
validación remota.

## Subfase 2.20X-F2b — stale reclaim de maintenance runs

La migration `20260828223000_maintenance_run_stale_reclaim.sql` reutiliza
`last_checkpoint_at` y agrega dos RPCs `service_role`-only. La RPC de checkpoint
acepta exclusivamente counters monotónicos y continuidad controlada. La RPC de
reclaim recibe sólo el run ID: bloquea la fila, calcula internamente diez
minutos y terminaliza un stale `running` como `failed` con el código seguro
`maintenance_stale_reclaimed`.

Counters, último checkpoint, scope y evidencia de missed feeds permanecen
intactos durante reclaim; sólo cambian status, `completed_at`, error allowlisted
y `updated_at`. El segundo reclaimer obtiene `already_terminal`. No se agrega
audit porque maintenance no tenía un modelo de audit propio.

Reset y matriz F2b pasaron 8/8; regresiones SQL X-F/X-E/X-D 32/32. Una carrera
real con dos conexiones PostgreSQL produjo un ganador `reclaimed` y un perdedor
`already_terminal`, seguida por cleanup completo. No hubo apply remoto.

## Subfase 2.20X-F3-C — observabilidad durable de missed feeds

La migration `20260901190000_durable_missed_feed_observability.sql` agrega a
`integration_event_maintenance_runs` un stage seguro y counters attempted /
succeeded. Los runs previos mantienen estos counters en NULL para expresar
UNKNOWN; los nuevos reciben 0. Checkpoint/finalize preservan monotonicidad,
validan `succeeded <= attempted` y exponen los campos mediante el summary
tenant-bound. Las firmas nuevas conservan defaults para callers anteriores.

La tabla mantiene RLS deny-by-default y las RPC siguen `SECURITY DEFINER`,
`search_path=pg_catalog` y `service_role`-only. Reset, matrices local/regresión y
callers reales `supabase-js -> PostgREST .rpc()` pasaron. La migration quedó
aplicada al proyecto remoto; el run histórico conserva stage y calls UNKNOWN.
