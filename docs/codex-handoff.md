# Handoff de Codex — e-ngenieria Hub

Snapshot breve para iniciar una nueva sesión. No sustituye el código, los
tests, [REGLAS.md](../REGLAS.md), [AGENTS.md](../AGENTS.md) ni el
[plan de gobierno](./plan-y-gobierno.md).

## Producto

e-ngenieria Hub es un SaaS multi-tenant para operar múltiples Stores y
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
- Fase 2 activa; **2.20T, 2.20U, 2.20V y 2.20W cerrados**.
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
