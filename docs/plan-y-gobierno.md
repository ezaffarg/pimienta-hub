# Plan y gobierno de Pimienta Hub

Este documento gobierna el avance del proyecto: define fases, gates, decisiones
y alcance. El código y los tests demuestran el estado técnico; las
invariantes obligatorias viven en [REGLAS.md](../REGLAS.md), y los detalles se
mantienen en la documentación especializada.

## A. Gobierno permanente

### Modelo y límites

Pimienta Hub es un SaaS multi-tenant para operar múltiples Stores e
integraciones e-commerce. El modelo base es:

```text
Clerk Organization
  -> hub_memberships
  -> Store
    -> Connection
      -> Provider
```

- Clerk aporta identidad, sesión, `userId`, Organization activa y membership
  técnica de Organization.
- `hub_memberships` es la autoridad server-side del business role Pimienta Hub.
- Owner y Manager tienen Store Scope sobre todas las Stores de su Organization.
- Employee y Client sólo tienen las Stores asignadas.
- Permission y Store Scope son controles independientes.
- Supabase se usa como PostgreSQL/persistencia, nunca como Supabase Auth.
- `service_role` es server-only. RLS, constraints y RPCs complementan la
  autorización y el aislamiento tenant-scoped del servidor.
- `src/features/` contiene producto provider-agnostic;
  `src/integrations/` contiene providers; `src/infrastructure/` contiene DB e
  infraestructura técnica.
- La UI no llama providers ni base de datos privilegiada directamente.
- Credenciales y tokens permanecen cifrados y server-only.

La arquitectura especializada de Mercado Libre está en
[meli-architecture.md](./meli-architecture.md); autorización y tenancy en
[meli-multi-tenancy.md](./meli-multi-tenancy.md); persistencia en
[meli-database.md](./meli-database.md).

### Fuentes y contradicciones

Las fuentes tienen funciones distintas:

- autoridad normativa: `REGLAS.md` y este plan;
- evidencia técnica: código y tests vigentes;
- instrucciones operativas: `AGENTS.md`;
- detalle técnico: documentos especializados;
- ayudas: `.agents/skills/`;
- historia: handoffs y `docs/prompts/`.

Si existe un conflicto material entre ellas, se detiene el trabajo afectado y
se reporta la contradicción. No se resuelve silenciosamente por precedencia ni
se convierte una suposición en una decisión.

### Approval gate

Cada mandato debe delimitar alcance, riesgos, archivos y acciones externas. Una
instrucción afirmativa y específica puede autorizar una subfase completa y sus
acciones rutinarias locales; no se solicita de nuevo la misma autorización.

Requieren autorización explícita dentro del alcance correspondiente:

- cambios de arquitectura, auth, seguridad, DB o integraciones;
- migrations locales o remotas;
- OAuth, refresh, sync o llamadas reales a providers;
- escrituras remotas y operaciones con coste;
- acciones destructivas y cierre Git.

Una autorización no habilita fases posteriores, reintentos adicionales ni
acciones fuera de scope. Todo checkpoint termina y espera el siguiente mandato
cuando así se haya indicado.

### Decisiones, suposiciones y pendientes

- **Decisión confirmada:** aprobada y documentada.
- **Suposición:** hipótesis temporal; no autoriza schema, contrato, integración,
  seguridad ni UX definitiva.
- **Decisión pendiente:** definición capaz de cambiar arquitectura, seguridad,
  datos, integraciones o UX. Debe resolverse antes del cambio afectado.

Los cambios de arquitectura se documentan antes de implementarse. No se crean
capas, tablas, contratos o abstracciones especulativas.

### Ciclo de trabajo

```text
PLAN -> APPROVAL -> IMPLEMENTATION -> VALIDATION -> DOCUMENTATION -> CHECKPOINT
```

- No saltar fases ni adelantar capacidades futuras.
- Preservar el working tree preexistente.
- Mantener cambios mínimos y atribuibles.
- Archivar mandatos significativos en `docs/prompts/` cuando el alcance lo
  permita. Esos archivos conservan historia y no se reescriben como snapshots.
- Ejecutar validación proporcional al riesgo y al gate activo.
- No declarar cierre si falta una validación, evidencia o decisión requerida.

Validación base:

- docs-only: diff relevante y `git diff --check`;
- TypeScript pequeño: tests focalizados y typecheck;
- auth/DB/security: tests relevantes, typecheck y lint;
- build: cuando el gate, el cierre o el riesgo lo justifique.

## B. Roadmap y estado de fases

| Fase | Propósito | Estado |
| --- | --- | --- |
| 0 | Decisiones, fuentes y boundaries | Completada |
| 1 | Seguridad base server-side | Cerrada |
| 2 | Persistencia multi-tenant e integración Mercado Libre incremental | **Activa — 2.20X cerrado; siguiente bloque 2.20Y i18n** |
| 3–7 | Evolución funcional y productiva posterior | No iniciadas como fases independientes |

La Fase 2 evolucionó mediante subfases explícitamente aprobadas e incorporó
foundations que el roadmap inicial ubicaba en fases posteriores. Esto no abre
automáticamente las Fases 3–7 ni autoriza sus capacidades restantes.

## C. Hitos completados

### Fase 0

Se establecieron fuentes, boundaries, modelo multi-tenant y gobierno. El
starter se conservó como upstream sin convertir sus demos en arquitectura de
producto.

### Fase 1

Se cerraron authentication y Organization server-side, autorización
default-deny, permisos, Organization Scope, validación Zod, contrato HTTP y
privacidad Sentry. Los detalles históricos viven en
[prompts/phase-01](./prompts/phase-01/README.md).

### Fase 2 — foundations operativas completadas

- `hub_memberships`, Stores, assignments y Connections tenant-scoped.
- Store Scope: Owner/Manager `all-stores`; Employee/Client assignments.
- Repositories server-only, constraints compuestas y bootstrap First Owner.
- RLS deny-by-default sin policies browser-facing; acceso DB privilegiado sólo
  mediante `service_role` server-only.
- OAuth Mercado Libre server-side, pending authorizations, cifrado, auditoría y
  finalización atómica.
- Onboarding real, reconnect target-bound real y reutilización de Store y
  Connection sin duplicados.
- Safe refresh con lease, versionado y CAS; las credenciales persistidas
  actuales están en `credential_version=6` y lease libre.
- Listings read-only normalizados y persistencia idempotente tenant-bound.
- Primera listing real persistida e idempotencia comprobada.
- 2.20S: discovery completo, paginación/scan, chunks de hasta 20, timeout,
  retries acotados, fallos parciales sanitizados y timestamps del provider.

Este resumen no sustituye el historial operativo de
[prompts/phase-02](./prompts/phase-02/README.md).

## D. Estado actual — 2.20T completado

2.20T implementa orchestration y observabilidad persistente específica para el
listing backfill:

- `listing_sync_runs` con `kind=listing_backfill`;
- estados `running`, `succeeded`, `partial` y `failed`;
- idempotency key y un único run `running` por Connection/kind;
- contadores y checkpoints monotónicos;
- RPCs atómicas de start, checkpoint y finalize;
- audits `listing.sync.started` y terminales;
- RLS sin policies browser-facing y RPCs exclusivas de `service_role`;
- repository y orquestador server-only;
- errores allowlisted y taxonomía segura de fallos de credenciales.

La validación local y la validación remota DB/RPC pasaron. Los bugs pre-RPC de
start y finalize quedaron corregidos mediante construcción explícita del scope
y progress canónicos; la observabilidad CAS distingue fallos seguros sin
persistir material sensible.

La validación real creó el run y completó discovery, detail fetch, persistencia
y checkpoints. La recuperación autorizada finalizó el mismo run como
`succeeded`, sin repetir trabajo del provider, con counters `1/1/1/1/0`, una
página y un batch. Existen exactamente un audit `listing.sync.started` y uno
`listing.sync.succeeded`, sin terminales duplicados ni runs `running`.
Listings permanece en 1 sin duplicados; `credential_version` quedó en 3 y el
lease `CLEAR`. **2.20T está cerrado.**

## E. Cierre — 2.20U

2.20U implementa inspección y recuperación administrativa explícita de runs
stale para Owner/Manager persistentes. Usa un threshold server-side de 15
minutos, outcomes controlados, RPC atómica y audits con recovery actor; conserva
scope, actor original, counters y checkpoint y no llama al provider. Reset DB,
matrices locales 2.20T/2.20U y validaciones de aplicación pasaron. La migration
fue aplicada y validada en remoto con fixtures sintéticos eliminados, sin tocar
runs ni datos reales. **2.20U está cerrado.**

## F. Cierre — 2.20V

2.20V-A agrega una UI administrativa de sólo lectura para Owner/Manager
persistentes. Lista hasta 50 runs recientes mediante un GET interno
tenant-bound, reutiliza stale/eligibility de 2.20U y muestra Store, Connection,
status, timestamps, counters y error seguro. No incluye recovery, sync,
provider calls, writes ni cambios de schema. La navegación global
business-role-aware permanece fuera de este bloque porque el sidebar vigente
usa contexto Clerk cliente y no `hub_memberships`.
Los tests focalizados quedaron 62/62, la suite 225/225, typecheck y lint PASS.

2.20V-B agrega confirmación y mutation UI únicamente para runs elegibles,
reutilizando el endpoint 2.20U. Incluye reason taxonómica, prevención de doble
submit, feedback seguro e invalidación del listado; no agrega recovery logic,
DB, provider work ni sync.
Los focalizados quedaron 69/69, la suite 232/232, typecheck y lint PASS.

La evidencia funcional remota cubrió lectura, recovery, concurrencia,
invalidación y cleanup con fixtures sintéticos, cero provider calls y recursos
reales intactos. Sonner y los paths de feedback quedaron validados; la falta
inicial de captura fue `AUTOMATION_OBSERVABILITY_LIMITATION`, no un bug
funcional. **2.20V-A, 2.20V-B y 2.20V están cerrados.**

## G. Alcance futuro real

Permanece diferido y requiere planificación/aprobación propia:

- lifecycle provider-confirmed y soft-delete;
- worker/queue dedicado distinto del scheduler acotado vigente;
- recovery automática de runs stale;
- resumability con cursor persistente;
- writes hacia Mercado Libre;
- topics y dominios de provider distintos del callback `items` vigente;
- órdenes, preguntas, envíos, variaciones, inventario y otros providers.

Checkpoint no equivale a resumability: los runs actuales no persisten offset,
cursor ni `scroll_id` y una nueva ejecución reinicia discovery.

## G.1 Cierre — 2.20W

2.20W-B implementa evidencia positiva ligada al run, el estado reversible
`missing_candidate`, counters agregados y reconciliation+finalize atómicos. La
ausencia no cambia el status provider ni implica cierre, eliminación o removal.
Runs parciales, fallidos, incompletos o recuperados quedan ineligible. W-C
aplicó y validó remotamente la migration con cleanup total y recursos reales
intactos. **2.20W-A, 2.20W-A2, 2.20W-B, 2.20W-C y 2.20W están cerrados.**

Las secciones G.2–G.10 conservan el estado incremental de cada checkpoint. El
estado canónico final que las sucede está en G.11.

## G.2 Estado — 2.20X-B

2.20X-B implementa localmente la foundation server-only para recibir y
deduplicar envelopes Mercado Libre `items`: tabla tenant-bound, intake RPC,
repository canónico y parser/resolver provider-specific. El intake deriva scope
desde una Connection activa y persiste sólo metadata segura. Reset, matriz SQL,
tests, suite, typecheck y lint pasaron localmente.

No existe aún callback público, autenticación de entrega, worker, provider
fetch, procesamiento incremental ni actualización de Listings. Tampoco hubo
aplicación remota. Esos gates requieren autorización y bloques propios.

## G.3 Estado — 2.20X-C

Existe un único callback público `POST` para notifications Mercado Libre
`items`. Limita el body, reutiliza validación/resolución/intake X-B y responde
sin exponer scope ni IDs internos. Los éxitos durables reciben 200; los rechazos
permanentes reciben ACK sin persistencia y los fallos transitorios reciben 503.

X-C fue validado sólo localmente. No implementa firma propia sin contrato
oficial verificable, provider fetch, worker, Listing mutation, `missed_feeds`,
scheduler, rate limiter distribuido ni aplicación remota.

## G.4 Estado — 2.20X-D

X-D implementa localmente un processor server-only controlado con claim/lease,
revalidación del binding persistido, fetch mediante el client canónico y
persistencia atómica con freshness CAS por `provider_updated_at`. Soporta APPLY,
STALE_NOOP y EQUIVALENT_NOOP; empates conflictivos y timestamps ausentes fallan
cerrado. Un 404 no produce inferencias ni mutaciones de Listing.

Reset, matriz X-D 16/16, regresiones X-B/W-B, 70/70 focalizados, suite 306/306,
typecheck y lint pasaron. La validación fue local y con provider mockeado. No
existe scheduler/worker automático, dispatch de retries, `next_retry_at`,
`missed_feeds`, validación remota ni operación real.

## G.5 Estado — 2.20X-E

X-E agrega localmente retry scheduling durable, selección due limitada y batch
controlado sobre el processor X-D. El modelo conserva `failed + retryable`,
respeta Retry-After y terminaliza al quinto claim sin loops infinitos.

También agrega client/service server-only para missed feeds `items`: resuelve
site mediante identidad oficial de la Connection, pagina de forma acotada y
reutiliza intake/dedupe X-B. Missed feeds no es source of truth ni reemplaza el
full scan/reconciliation.

Reset, matrices X-E/X-D/X-B/W-B, focalizados 85/85, suite 333/333, typecheck y
lint pasaron. Todo fue local y mockeado. Scheduler, cron, ejecución automática,
UI, validación remota y llamadas reales permanecen fuera de alcance.

## G.6 Estado — 2.20X-F

X-F implementa localmente `runIncrementalEventMaintenance`: un ciclo
server-only, acotado por Connections, eventos, páginas y duración, con
aislamiento de fallas y mantenimiento persistente por Connection. Reutiliza
claim/lease/CAS y retry/missed-feeds existentes sin crear un segundo modelo de
procesamiento.

El read model Owner/Manager y su resumen se integran en Listing Sync Runs sin
agregar una acción. Reset y matrices X-F/X-E/X-D/X-B/W-B pasaron 55/55; los
focalizados X-F 50/50, la suite 351/351, typecheck y lint también pasaron. Todo
fue local y mockeado.

La decisión del trigger permanece pendiente: deployment documenta Vercel y
Docker self-hosted sin una plataforma productiva canónica. No existe scheduler
real, daemon, route pública ni trigger manual; tampoco hubo provider calls,
apply remoto o Git closure.

## G.7 Decisión pendiente — 2.20X-F2

La auditoría confirmó `DEPLOYMENT_NOT_SELECTED`: Vercel y Docker son opciones
soportadas, no una selección productiva. El trigger conservará el patrón
`deployment scheduler → authenticated HTTP route → orchestration service`, sin
IDs tenant-scoped desde el request. Vercel Cron requiere aprobar Vercel Pro para
cadencia de pocos minutos; Docker/VPS requiere aprobar host y operación de
cron/systemd. Supabase Cron queda como alternativa y Netlify Scheduled
Functions no cubre directamente el budget de 45 segundos.

Antes de F3 se requieren dos decisiones: plataforma productiva y semántica de
recovery para un maintenance run abandonado entre start/finalize. Después del
cierre completo de 2.20X, el siguiente bloque funcional es 2.20Y i18n:
`es-419` principal, `pt-BR` soportado y `en` fallback.

## G.8 Estado — 2.20X-F2b

La semántica local de recovery quedó resuelta con checkpoints monotónicos y un
reclaim atómico tras diez minutos sin evidencia de vida. El resultado es
`failed/maintenance_stale_reclaimed`; preserva counters y no toca eventos,
leases, Listings ni provider. El orquestador reintenta start una sola vez tras
un reclaim exitoso.

Reset, matriz F2b 8/8, regresiones SQL 32/32, focalizados 11/11, regresión
TypeScript X-D/E/F 69/69, suite 353/353, typecheck y lint pasaron. El scheduler
sigue ausente y la migration no fue aplicada remotamente. La decisión de
deployment pendiente en ese momento fue resuelta después por F3-A.

## G.9 Decisión y audit — 2.20X-F3-A

El target canónico elegido es Hostinger VPS → Ubuntu LTS → Docker → Coolify. El
laboratorio local WSL2/Coolify/Traefik/Next.js fue aceptado como evidencia de
viabilidad, no como validación productiva.

El audit recomienda consolidar una imagen Next.js standalone mediante
`Dockerfile`, con Bun para install/build y Node.js para runtime. Antes de
producción faltan healthcheck, hardening reproducible, configuración de
dominio/TLS/secrets, apply controlado de X-B/D/E/F/F2b y el boundary scheduler.
F3-B debe usar un Coolify scheduled job cada cinco minutos hacia una ruta
interna machine-authenticated, sin IDs tenant-scoped y no expuesta por Traefik.
No se implementó ni ejecutó ninguna de esas capacidades en F3-A.

## G.10 Implementación local — 2.20X-F3-B

La foundation local ya usa un único `Dockerfile` canónico: Bun 1.3.14 instala
y construye con lockfile, y Node 22 ejecuta el standalone como usuario
non-root. `GET /api/health` no depende de Clerk, DB ni provider. La ruta interna
`POST /api/internal/maintenance/incremental-events` valida un Bearer secret
dedicado con comparación timing-safe, no acepta autoridad tenant del caller y
reutiliza el orquestador acotado existente.

La build y el container locales pasaron; el scheduler real no fue configurado
ni ejecutado. Coolify, Traefik, dominio/TLS, migrations remotas y deploy
productivo siguen sujetos a gates explícitos. El orden futuro es
backup/preflight → apply controlado → verificación → deploy → healthcheck →
habilitar scheduler → observar. No hay migrations al startup.

## G.11 Cierre — 2.20X

2.20X quedó operativo en el laboratorio local Coolify contra el Supabase remoto
dedicado. El callback `items`, intake durable, processing con freshness CAS,
retries, missed feeds, maintenance runs, checkpoints y stale reclaim conservan
scope tenant-bound, límites explícitos y errores seguros. Las migrations X y
sus firmas PostgREST quedaron aplicadas y validadas; el adapter normaliza
`messages: null` a una página vacía y termina la paginación sin loops.

La ruta interna exige Bearer server-only y body de cero bytes. Coolify mantiene
un único Scheduled Task `Pimienta Hub Incremental Events`, habilitado cada cinco
minutos, con timeout de 60 segundos y secreto tomado sólo del runtime. Dos
ejecuciones naturales terminaron `succeeded`, sin retries ni leases residuales:
la primera realizó 2/2 llamadas provider elegibles y la segunda, con
`missed_feed_due=false`, realizó 0. La credencial quedó en versión 6 y lease
`CLEAR`. **2.20X está cerrado; el siguiente bloque es 2.20Y i18n con `es-419`
principal, `pt-BR` soportado y fallback `en`.**

Seguimiento de seguridad pendiente, sin material sensible: rotar/revisar la
credencial Redis local de Coolify expuesta accidentalmente.

## G.12 Foundation i18n — 2.20Y-I18N-02

La foundation usa `next-intl` sin routing por locale. El contrato canónico es
`es-419` default, `pt-BR` soportado y `en` fallback, con resolución server-side
por locale explícito, cookie `pimienta_locale`, `Accept-Language` y default. El
root refleja el locale en `<html lang>` sin provider global ni catálogos
completos en el cliente. La arquitectura y los límites de los slices siguientes
viven en [Internacionalización](./i18n.md).

## G.13 Shell global i18n — 2.20Y-I18N-03

El shell global traduce en el boundary de render y conserva en inglés estable
los IDs de navegación, URLs y reglas de acceso. El dashboard serializa sólo
`navigation` y `shell`; metadata y labels server-owned usan las APIs server de
`next-intl`. Breadcrumbs dinámicos y contenido de features/provider no se
traducen.

La matriz focalizada pasó 39/39 junto con typecheck, lint y build. El slice fue
cerrado y publicado en `68cbd896a07c9646a297727165134518483b134e`.

## G.14 Selector de locale y Clerk — 2.20Y-I18N-04

El selector de preferencias del footer escribe únicamente la cookie
allowlisted `pimienta_locale` durante 365 días y refresca la ruta actual sin
alterar la URL. El locale server-side continúa como fuente única para el shell,
`<html lang>` y Clerk. Los componentes Clerk embebidos usan recursos oficiales
con el mapping `es-419 → es-MX`, `pt-BR → pt-BR` y `en → en-US`.

El slice permanece local y sin cierre Git. Persistencia DB/Clerk metadata,
routing por locale, formatos, formularios, Zod y traducción de features siguen
diferidos a gates posteriores; el detalle técnico vive en
[Internacionalización](./i18n.md).

## H. Condiciones generales de avance

Antes de cerrar una fase o abrir la siguiente debe existir evidencia de:

- autenticación, autorización y tenant scoping server-side;
- ausencia de secretos en browser, respuestas, logs y trazas;
- provider DTOs aislados detrás de mappers;
- tests proporcionales, documentación y validaciones del gate;
- migrations reproducibles y validación de seguridad cuando corresponda;
- working tree revisado y cambios intencionales identificados;
- decisiones pendientes resueltas para el alcance siguiente.

Referencias operativas:

- [Handoff actual](./codex-handoff.md)
- [Workflow de agentes](./agent-workflow.md)
- [Arquitectura Mercado Libre](./meli-architecture.md)
- [API Mercado Libre](./meli-api.md)
- [Base de datos](./meli-database.md)
- [Sincronización](./meli-sync.md)
- [Índice de prompts](./prompts/README.md)
