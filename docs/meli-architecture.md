# Arquitectura Mercado Libre

Mercado Libre es el primer provider de Pimienta Hub. Esta documentación
define invariantes y separa capacidades implementadas de trabajo futuro. El
estado operativo actual se resume en [codex-handoff.md](./codex-handoff.md).

## Modelo y tenant boundary

```text
Usuario
  -> Clerk session
  -> Organization
    -> Store
      -> Connection
        -> MercadoLibreAdapter
          -> API oficial de Mercado Libre
```

- Clerk resuelve identidad, sesión y Organization activa en servidor.
- `hub_memberships` aporta el business role; Permission y Store Scope se
  validan antes de resolver una Connection.
- Organization, Store y Connection se cruzan siempre mediante bindings
  tenant-scoped. IDs del browser sólo identifican objetivos y nunca autorizan.
- La identidad externa se obtiene y verifica mediante la API oficial.

## Límites de capas

- `src/features/` contiene lógica y UI de producto provider-agnostic.
- `src/integrations/` contiene adapters, clients, DTOs, mappers, credenciales y
  servicios de providers externos.
- `src/infrastructure/` contiene repositories, DB e infraestructura técnica.

Los DTOs y errores de Mercado Libre no cruzan a features. Los mappers producen
contratos internos; una Store guarda relaciones y configuración, no una copia
del código del provider.

No se crean `src/application/` o `src/domain/` por estilo. Sólo se extraen
responsabilidades reales cuando aportan un boundary claro y documentado.

## Seguridad de integración

- OAuth Authorization Code, refresh y llamadas autenticadas ocurren server-side.
- `client_id`, `client_secret`, access token y refresh token no llegan al
  navegador, logs, respuestas ni documentación.
- Los tokens se almacenan cifrados y separados de metadata de Connection.
- Refresh usa lease, versionado y compare-and-swap para impedir writers stale.
- Pending authorizations expiran, se consumen una vez y quedan tenant/actor-bound.
- Reconnect usa un `target_connection_id` resuelto y validado server-side.
- La UI sólo consume endpoints internos protegidos.
- Errores externos se normalizan y se redacta material sensible.
- Se usan exclusivamente la aplicación propia de Mercado Libre Developers y
  las APIs oficiales; no scraping, cookies de terceros ni backends privados.

La documentación oficial vigente debe revalidarse antes de cambiar OAuth,
refresh, endpoints, PKCE, rate limits o writes al provider.

## Capacidades implementadas

- OAuth server-side, state de un solo uso y staging de pending authorization.
- Onboarding y finalización atómica tenant-bound.
- Credenciales cifradas, auditoría y safe refresh con lease/version/CAS.
- Reconnect real target-bound reutilizando Store y Connection.
- Identidad oficial de la cuenta externa.
- Listings read-only mediante discovery oficial y multiget/detail.
- Normalización provider-agnostic y persistencia idempotente por Connection.
- Backfill con paginación/scan, chunks máximos de 20, timeout, retry acotado,
  fallos parciales sanitizados y timestamps del provider.
- Sync-run orchestration persistente con start/checkpoint/finalize, audits,
  idempotency y single-running por Connection/kind.

2.20T está cerrado: la infraestructura DB/RPC, la orchestration y la
observabilidad persistente están implementadas y validadas. El run real final
terminó `succeeded`, sin runs activos ni duplicados. Ver [API](./meli-api.md) y
[base de datos](./meli-database.md) para el contrato exacto.

2.20U agrega una recuperación administrativa explícita para runs stale y quedó
validado localmente y en remoto con fixtures sintéticos limpiados. Conserva el
boundary Request → Authentication → Authorization → Tenant resolution →
Validation → Service → Repository → Database, exige Owner/Manager persistente y
termina el run de forma atómica sin reanudar ni repetir trabajo del provider.

2.20V-A agrega una superficie dashboard de sólo lectura para esos runs. Usa un
GET interno y TanStack hydration, reutiliza la clasificación 2.20U y enriquece
Store/Connection desde repositories tenant-bound. No agrega navegación global,
mutation, provider call ni acceso DB desde el browser.

2.20V-B compone sobre esa lectura una confirmación de recovery que llama al
boundary 2.20U. La UI no decide stale ni elegibilidad, no cambia repositories o
RPCs y trata la visibilidad de la acción sólo como UX; el POST repite auth y
tenant resolution server-side.

2.20V está cerrado con validación local y evidencia funcional remota. Los
fixtures sintéticos fueron eliminados, no hubo provider calls ni recursos
reales modificados, y la observabilidad inicial del toast quedó clasificada
como limitación de automatización sin bug funcional.

## Capacidades futuras o diferidas

- lifecycle provider-confirmed y soft-delete;
- scheduler/worker y ejecución periódica;
- recovery automática de stale runs;
- resumability con cursor persistente;
- webhooks;
- writes hacia Mercado Libre, sólo con autorización explícita;
- variaciones, inventario, órdenes, preguntas, envíos y otros dominios;
- otros providers.

Checkpoint persistente no significa resumability: el run actual conserva
contadores y timestamps, pero no offset, cursor ni `scroll_id`.

## Reconciliation boundary — 2.20W-B

La evidencia positiva sigue el boundary existente
`integration service → ListingSyncService → ListingRepository → RPC`. El
adapter de Mercado Libre decide completitud técnica; el dominio común conserva
sólo `seen|missing_candidate` y nunca deriva estados del provider. La evidencia
negativa se aplica una vez dentro del finalize atómico, scoped por Organization,
Store y Connection. No se incorporaron deletes, scheduler, webhooks ni un
repository paralelo.

W-C confirmó remotamente FK/scopes, grants server-only, transiciones,
idempotencia y old-run protection. Los fixtures quedaron en 0 y ningún recurso
real ni provider fue modificado. Esta evidencia no amplía la semántica de
`missing_candidate`. **2.20W está cerrado.**

## Contratos y referencias

`EcommerceIntegration` y los contratos de `src/integrations/core/` deben seguir
siendo agnósticos al provider y expresar capacidades opcionales. No se obliga a
todos los providers a soportar los mismos recursos.

- [REGLAS.md](../REGLAS.md)
- [Plan y gobierno](./plan-y-gobierno.md)
- [Seguridad](./meli-security.md)
- [Multi-tenancy](./meli-multi-tenancy.md)
- [API](./meli-api.md)
- [Base de datos](./meli-database.md)
- [OAuth](./meli-mercadolibre-OAuth/API.md)

MercadoCuentas es sólo referencia funcional/producto. No es proveedor de datos,
API, dependencia ni backend de Pimienta Hub.

## Event intake foundation — 2.20X-B

La foundation local agrega el flujo
`provider envelope → Mercado Libre parser/resolver → canonical event repository
→ intake RPC → integration_events`. El adapter provider-specific queda en
`src/integrations/`; el contrato durable y la persistencia, en
`src/infrastructure/`. El tenant se deriva desde la Connection persistida y
activa, no desde IDs aportados por el evento.

El bloque termina en intake durable idempotente. No implementa superficie HTTP
pública, autenticación de entrega, worker, cola, procesamiento incremental ni
llamadas a Mercado Libre.

## Public items callback — 2.20X-C

La única superficie pública es
`POST /api/integrations/mercado-libre/notifications/items`. El Route Handler
limita y parsea el body, delega validación/resolución/intake al boundary X-B y
responde inmediatamente. Sólo exporta `POST`; usa el runtime Node.js por
defecto y no accede a sesión humana, provider, Listings ni worker.

La ausencia de un contrato oficial implementable de firma queda como riesgo
conocido. Las defensas actuales son application ID server-side, schema estricto,
resource allowlisted, Connection activa, dedupe durable y body limitado.

## Incremental processing boundary — 2.20X-D

El flujo local controlado es
`eventId → claim RPC → binding revalidation → credential service → canonical
listings client/normalizer → freshness completion RPC`. El callback X-C sigue
terminando en intake+ACK y nunca ejecuta este flujo.

La base serializa claim/lease y la comparación de freshness con la mutación del
Listing y el estado terminal del evento. El processor no acepta tenant, Store,
Connection, resource ni credenciales desde el caller. Reaparición positiva
limpia evidencia negativa reversible sin alterar `last_seen_sync_run_id`.

X-D incorpora un servicio invocable de forma controlada, no un scheduler,
consumer permanente o route pública. Retry scheduling, `missed_feeds`, backlog
operativo y observabilidad de producción permanecen diferidos.

## Retry y missed-feed recovery boundary — 2.20X-E

La selección due es una lectura server-only limitada; la autoridad de claim
sigue siendo el lease/CAS X-D. Dos dispatchers pueden observar el mismo ID,
pero sólo uno lo procesa. Attempts se incrementa únicamente en claim.

El flujo recovery es `Connection tenant-scoped → credential service →
/users/me identity+site → missed_feeds page → intake X-B`. El caller no aporta
Store, cuenta externa ni site como autoridad. Los mensajes recuperados no
escriben Listings y comparten dedupe con el webhook. La paginación es acotada y
expone continuación explícita; nunca confunde truncamiento con final del feed.

La defensa ante pérdida queda en capas: webhook realtime, retries del provider,
missed feeds con ventana limitada y full scan/reconciliation. X-E no automatiza
ninguna capa; scheduler, cron y observabilidad operativa quedan para X-F.

## Event maintenance orchestration — 2.20X-F

El boundary server-only agrega un ciclo invocable y presupuestado por
Connection sobre las primitivas X-B/X-D/X-E. Un maintenance run persistente
actúa como lock compatible por Connection, conserva cadence/continuación de
`missed_feeds` y registra únicamente counters y errores seguros. Los leases y
CAS de cada evento continúan siendo la autoridad contra doble procesamiento.

La lectura administrativa se integra en la pantalla existente de Listing Sync
Runs y no crea una superficie de ejecución. El repositorio no identifica un
deployment productivo canónico entre Vercel y Docker self-hosted; por eso el
servicio quedó listo pero no se inventó cron, endpoint público, daemon ni
trigger manual.

## Maintenance stale reclaim — 2.20X-F2b

Los maintenance runs usan `last_checkpoint_at` como evidencia durable de vida.
El servicio escribe checkpoints monotónicos al completar received, retries,
missed feeds o el batch recuperado; no agrega timer. Un run sin checkpoint por
diez minutos puede pasar atómicamente a `failed/maintenance_stale_reclaimed`.

El reclaim sólo libera el lock por Connection y preserva counters, scope y
continuación. Los leases/CAS X-D siguen gobernando cada evento; por eso un nuevo
maintenance cycle no fuerza reprocessing ni resetea trabajo in-flight.
