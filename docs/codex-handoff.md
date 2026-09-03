# Handoff de Codex — Pimienta Hub

Snapshot breve para iniciar una nueva sesión. No sustituye el código, los
tests, [REGLAS.md](../REGLAS.md), [AGENTS.md](../AGENTS.md) ni el
[plan de gobierno](./plan-y-gobierno.md).

## Producto

Pimienta Hub es un SaaS multi-tenant para operar múltiples Stores y
conexiones e-commerce. Mercado Libre es el primer provider implementado.

```text
Clerk Organization
  -> hub_memberships
  -> Store
    -> Connection
      -> Provider
```

Clerk resuelve identidad, sesión y Organization activa. `hub_memberships` es
la autoridad del business role. Owner y Manager tienen scope sobre todas las
Stores de su Organization; Employee y Client sólo sobre Stores asignadas.
Permission y Store Scope son independientes.

Supabase se usa como PostgreSQL, no como Supabase Auth. Los repositories y RPCs
son server-only; `service_role` nunca llega al browser. RLS está habilitado
deny-by-default y no existen policies browser-facing para las tablas Hub.

## Estado actual

- Fase 0 completada y Fase 1 cerrada.
- Fase 2 activa; **2.20T, 2.20U, 2.20V, 2.20W y 2.20X cerrados**.
- Modelo persistente multi-tenant operativo: memberships, Stores, assignments,
  Connections, secretos, auditoría, listings y sync runs.
- Stores y Connections reales operativas y tenant-bound.
- OAuth Mercado Libre server-side operativo, con credenciales cifradas.
- Reconnect target-bound real validado reutilizando Store y Connection.
- Safe refresh implementado con lease, versionado y CAS.
- Listings read-only y persistencia idempotente implementados.
- Primera listing real persistida; 2.20S production hardening y backfill real
  idempotente validados.
- DB/RPC de 2.20T validados localmente y en el remoto dedicado.
- Recovery administrativa 2.20U validada localmente y en remoto y cerrada.
- UI administrativa read-only 2.20V-A cerrada.
- Recovery UI 2.20V-B cerrada sobre el boundary 2.20U.
- Intake, callback `items`, processing incremental, missed feeds y maintenance
  periódico operativos; Coolify ejecuta el scheduler y la app conserva locks,
  cooldown y observabilidad durable.

El código conserva un camino `clerk-fallback` transicional para compatibilidad;
no sustituye la autoridad de `hub_memberships` ni concede Store assignments.
Su retiro requiere un cutover explícito.

## Último checkpoint cerrado — 2.20T

`listing_sync_runs` registra runs `listing_backfill` con estados `running`,
`succeeded`, `partial` y `failed`, idempotency key, single-running por
Connection/kind, contadores, checkpoints y audits atómicos mediante RPCs
server-only.

Checkpoint no equivale a resumability: no se persisten offset, cursor ni
`scroll_id`. En 2.20T, scheduler/worker, recovery automática y reconciliation
todavía estaban diferidos; W-B implementa ahora sólo la última en local.

## Último bloque cerrado — 2.20U

Existe una superficie server-only de inspección y recuperación explícita para
runs stale. Sólo Owner/Manager con membership persistente pueden usarla. El
threshold es 15 minutos desde el último checkpoint; `succeeded` requiere
evidencia completa y `failed` registra `administrative_recovery`. La RPC
preserva counters, checkpoint y actor original y escribe los audits con el
recovery actor en la misma transacción. No llama a Mercado Libre.

`supabase db reset`, matrices 2.20T 22/22 y 2.20U 12/12, tests 213/213,
typecheck y lint pasaron localmente. Ese checkpoint local no ejecutó remote,
OAuth, refresh, reconnect, provider calls ni Git closure.

La migration 2.20U también quedó aplicada remotamente. La matriz sintética
controlada validó roles, tenant/Store/Connection boundaries, outcomes,
atomicidad, audits e idempotencia; el cleanup dejó cero fixtures y los conteos
reales intactos. No hubo provider calls ni recovery sobre runs reales.

## Último bloque cerrado — 2.20V

Existe una ruta dashboard read-only para inspeccionar listing sync runs. El
servidor exige Owner/Manager persistente, limita el scan a los 50 runs más
recientes del tenant y reutiliza el read model 2.20U. La tabla hidrata TanStack
Query y muestra status, Store/Connection, timestamps UTC, progress, stale,
eligibility y errores seguros. No agrega recovery, sync ni provider calls.
Los tests focalizados quedaron 62/62, la suite 225/225, typecheck y lint PASS.

No se agregó entrada al sidebar: su filtro vigente usa contexto Clerk en
cliente y no puede representar con autoridad los roles `hub_memberships`.

2.20V-B agrega una acción sólo para runs elegibles. El dialog confirma Store,
Connection, target y reason taxonómica; evita doble submit, maneja concurrencia
e invalida el listado. No agrega recovery logic, RPC, provider call ni sync.
Los focalizados quedaron 69/69, la suite 232/232, typecheck y lint PASS.

La validación remota con fixtures sintéticos confirmó lectura, recovery,
concurrencia, invalidación y limpieza sin provider calls ni recursos reales
modificados. Sonner y sus paths de feedback pasaron; la captura inicial ausente
fue `AUTOMATION_OBSERVABILITY_LIMITATION`. Cero fixtures quedaron pendientes.
**2.20V-A, 2.20V-B y 2.20V están cerrados.**

La validación real creó el run, completó discovery, detail fetch, persistencia y
checkpoints, y terminó `succeeded` con counters `1/1/1/1/0`, una página y un
batch. La recuperación del stale run reutilizó el mismo run sin repetir trabajo
del provider. Quedaron exactamente un audit `listing.sync.started` y uno
`listing.sync.succeeded`, sin terminales duplicados ni runs `running`.

Los dos rechazos pre-RPC quedaron corregidos mediante inputs canónicos: el
scope estricto ya no recibe actor membership ni idempotency key, y finalize ya
no recibe `failures` dentro de progress. La observabilidad CAS distingue fallos
seguros sin persistir material sensible. Listings permanece en 1 sin
duplicados; el reconnect controlado dejó `credential_version=3` y lease
`CLEAR`.

## Boundaries que deben preservarse

- `src/features/`: producto y UI provider-agnostic.
- `src/integrations/`: providers, DTOs, mappers, clients y servicios externos.
- `src/infrastructure/`: DB e infraestructura técnica.
- Todo acceso protegido sigue Authentication → Authorization → Tenant
  resolution → Validation → Service → Repository → Database.
- La UI y los IDs del request nunca son autoridad de negocio o tenant.
- Tokens y secretos permanecen cifrados y server-only.
- Mercado Libre se consume sólo mediante la aplicación propia y APIs oficiales.
- Cualquier write al provider requiere autorización explícita.

## Trabajo futuro ya diferido

- recovery automática de stale runs;
- scheduler/worker;
- lifecycle provider-confirmed y soft-delete;
- resumability persistente;
- writes al provider;
- otros dominios e-commerce y otros providers.

## Lectura mínima

1. [Plan y gobierno](./plan-y-gobierno.md).
2. [Workflow de agentes](./agent-workflow.md).
3. [Arquitectura](./meli-architecture.md),
   [multi-tenancy](./meli-multi-tenancy.md) y
   [seguridad](./meli-security.md).
4. [API](./meli-api.md) y [base de datos](./meli-database.md).
5. [2.20T](./prompts/phase-02/2.20t-sync-run-orchestration-observability.md)
   sólo como historial operativo del checkpoint.
6. [2.20U](./prompts/phase-02/2.20u-administrative-stale-run-recovery.md)
   como historial del bloque cerrado.
7. [2.20V-A](./prompts/phase-02/2.20v-a-administrative-listing-sync-read-ui.md)
   como alcance local vigente.

Antes de actuar, inspeccionar siempre el working tree: puede contener cambios
locales intencionales aún no cerrados. El repositorio es la fuente de verdad;
una contradicción material se reporta y no se resuelve por inferencia.

## Último bloque cerrado — 2.20W

La migration local agrega vínculo Listing→run con FK compuesta, estado
`seen|missing_candidate`, evidencia consecutiva y counters del run. Los batches
positivos son run-aware; el adapter sólo habilita reconciliation al agotar un
perfil técnico consistente y sin fallos; la transición negativa y el finalize
son atómicos. Recovery 2.20U no reconcilia y la UI 2.20V sólo suma los dos
counters al read model. W-C aplicó una sola migration y pasó con fixtures
sintéticos completamente eliminados, cero provider calls y recursos reales
intactos. **2.20W-A, 2.20W-A2, 2.20W-B, 2.20W-C y 2.20W están cerrados.**

## Checkpoint histórico — 2.20X-B

`integration_events` y `intake_integration_event` aportan intake durable,
tenant-bound e idempotente bajo `service_role`. El parser acepta sólo topic
`items`, resource canónico y application ID esperado; el resolver obtiene
Organization, Store y Connection desde una única Connection activa.

La matriz SQL pasó 9/9, los focalizados 24/24, la suite 260/260, typecheck y
lint. No se aplicó la migration remotamente ni se agregó callback público,
provider call, worker o procesamiento de Listings.

## Checkpoint histórico — 2.20X-C

Existe `POST /api/integrations/mercado-libre/notifications/items`: acepta un
body limitado, reutiliza el boundary X-B y devuelve ACK vacío. Rechazos
permanentes no persisten; fallos transitorios devuelven 503. No usa Clerk,
provider calls, Listings ni worker.

Callback/intake/repository pasaron 39/39, seguridad 14/14, regresión amplia
127/127, suite 275/275, typecheck y lint. No hubo migration remota, webhook real
ni writes remotos. La verificación HMAC queda abierta hasta contar con un
contrato oficial implementable.

## Checkpoint histórico — 2.20X-D

El processor server-only recibe sólo `eventId`, adquiere un lease atómico,
revalida el scope persistido y usa credential service, listings client y
normalizador canónicos. Completion aplica freshness CAS y terminaliza el evento
en la misma transacción que la persistencia positiva. Los no-op stale/equivalent
son terminales seguros; timestamp ambiguo y 404 fallan sin modificar Listing.

Reset y matrices X-D/X-B/W-B pasaron; los focalizados quedaron 70/70, suite
306/306, typecheck y lint PASS. Todo fue local con provider mockeado. No hubo
remote, OAuth, refresh, sync real ni Git. Scheduler/worker automático, dispatch
de retry, `missed_feeds` y operación remota siguen pendientes.

## Checkpoint histórico — 2.20X-E

`integration_events` conserva lifecycle X-D y suma `next_retry_at`, backoff
determinista, Retry-After como piso y agotamiento terminal al quinto claim. El
selector due no reclama; `MercadoLibreEventRetryBatchService` reutiliza el
processor X-D y su lease/CAS.

`MercadoLibreMissedFeedRecoveryService` valida Connection y credencial,
resuelve `/users/me.id + site_id`, pagina `GET /missed_feeds` con límites y
continuación explícita, y reutiliza intake X-B para ACCEPTED/DUPLICATE. La
retención es limitada y el
full scan/reconciliation permanece como safety net.

Reset y matrices X-E/X-D/X-B/W-B pasaron; focalizados 85/85, suite 333/333,
typecheck y lint PASS. Provider fue totalmente mockeado. No hubo remote,
scheduler, webhook real, OAuth, sync real ni Git.

## Checkpoint histórico — 2.20X-F

`runIncrementalEventMaintenance` coordina received, retries due y missed feeds
con budgets globales y aislamiento por Connection. Los maintenance runs
persisten lock, cadence/continuación, counters y errores seguros; los leases y
CAS X-D conservan la autoridad por evento.

El resumen administrativo Owner/Manager vive en la pantalla existente de
Listing Sync Runs, sin action ni trigger. Reset y matrices X-F/X-E/X-D/X-B/W-B
pasaron 55/55; focalizados 50/50, suite 351/351, typecheck y lint PASS. Todo fue
local y mockeado, sin remote, provider real ni Git.

El siguiente gate requiere decidir deployment productivo canónico. Hasta
entonces el servicio es invocable, pero scheduler/cron, endpoint público y
trigger manual permanecen bloqueados.

## Decisión histórica — 2.20X-F2

El audit clasificó el deployment como `DEPLOYMENT_NOT_SELECTED`. La mención
Vercel Recommended es herencia del starter y coexiste con Dockerfiles Node/Bun;
no hay configuración productiva ni cron canónico. F3 debe usar un boundary HTTP
machine-authenticated y delegar en `runIncrementalEventMaintenance`, pero no
puede elegir Vercel Cron o cron/systemd hasta que el usuario apruebe Vercel Pro
o Docker/VPS.

También debe resolverse el reclaim seguro de un maintenance run abandonado
entre start y finalize antes de activar ejecución periódica. Tras cerrar 2.20X,
continúa 2.20Y i18n con `es-419`, `pt-BR` y fallback `en`.

## Checkpoint histórico — 2.20X-F2b

El gap de crash recovery quedó resuelto localmente. Checkpoints monotónicos
actualizan `last_checkpoint_at` después de progreso real y la RPC
`reclaim_stale_integration_event_maintenance_run` falla de forma segura un run
sin checkpoint por diez minutos. El cutoff no es caller-controlled; counters y
event leases permanecen intactos.

Reset y matrices F2b/X-F/X-E/X-D pasaron 40/40; dos sesiones validaron
`reclaimed`/`already_terminal`; focalizados 11/11, regresión 69/69, suite
353/353, typecheck y lint PASS. No hubo remote, provider, scheduler ni Git.

## Decisión vigente — 2.20X-F3-A

El deployment canónico elegido es Hostinger VPS → Ubuntu LTS → Docker →
Coolify. El audit recomienda una única imagen Next.js standalone basada en el
`Dockerfile` ajustado: Bun para install/build y Node.js para runtime. Railpack y
Vercel no son el path canónico actual.

Antes de producción faltan `/api/health`, hardening/reproducibilidad del
container, dominio/TLS y URLs externas, migrations X-B/D/E/F/F2b aplicadas por
gate controlado, y el trigger. F3-B debe implementar un Coolify scheduled job
cada cinco minutos contra un boundary HTTP interno machine-authenticated y no
expuesto por Traefik. F3-A no modificó código, containers ni infraestructura.

## Checkpoint histórico — 2.20X-F3-B

La foundation productiva local quedó implementada: `Dockerfile` canónico con
Bun 1.3.14 para install/build y Node 22 non-root para standalone; healthcheck
`GET /api/health`; y boundary interno
`POST /api/internal/maintenance/incremental-events` con Bearer secret dedicado,
comparación timing-safe, sin Clerk ni IDs tenant del caller. `Dockerfile.bun`
queda deprecated.

Build, inicio del container, health 200 y usuario non-root pasaron con valores
sintéticos; el scheduler sólo se probó en sus rechazos 401 y nunca se ejecutó
contra servicios reales. No hubo remote, provider, migrations ni Git. El
siguiente gate es la validación/deploy remoto controlado F3-C, incluyendo
migrations, URLs/TLS, bloqueo público de la ruta interna y habilitación final
del job cada cinco minutos.

## Último bloque cerrado — 2.20X

El laboratorio local ejecuta Pimienta Hub en Coolify con Supabase remoto. Las
migrations X, los callers PostgREST, la ruta interna Bearer con body de cero
bytes, credential refresh/CAS y la normalización `messages: null → []` quedaron
validados. La paginación termina con `exhausted=true` y sin repetición.

Coolify conserva un único Scheduled Task `Pimienta Hub Incremental Events`,
habilitado con cron `*/5 * * * *`, timeout 60 y secreto sólo desde runtime. Las
dos primeras ejecuciones naturales terminaron sanas: la primera consumió el
trabajo missed-feed elegible con 2/2 llamadas y la segunda respetó cooldown con
0 llamadas. No hubo retries, overlap inseguro, refresh adicional ni lease
residual; `credential_version=6`. **2.20X está cerrado. Próximo bloque: 2.20Y
i18n (`es-419`, `pt-BR`, fallback `en`).**
