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
- Fase 2 activa; **2.20T cerrado**.
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

El código conserva un camino `clerk-fallback` transicional para compatibilidad;
no sustituye la autoridad de `hub_memberships` ni concede Store assignments.
Su retiro requiere un cutover explícito.

## Último checkpoint cerrado — 2.20T

`listing_sync_runs` registra runs `listing_backfill` con estados `running`,
`succeeded`, `partial` y `failed`, idempotency key, single-running por
Connection/kind, contadores, checkpoints y audits atómicos mediante RPCs
server-only.

Checkpoint no equivale a resumability: no se persisten offset, cursor ni
`scroll_id`. La recuperación administrativa general de stale runs,
scheduler/worker y missing reconciliation siguen diferidos.

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

- stale-run recovery administrativa;
- scheduler/worker;
- missing reconciliation y lifecycle/soft-delete;
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

Antes de actuar, inspeccionar siempre el working tree: puede contener cambios
locales intencionales aún no cerrados. El repositorio es la fuente de verdad;
una contradicción material se reporta y no se resuelve por inferencia.
