# Plan y gobierno de e-ngenieria Hub

Este documento gobierna el avance del proyecto: define fases, gates, decisiones
y alcance. El código y los tests demuestran el estado técnico; las
invariantes obligatorias viven en [REGLAS.md](../REGLAS.md), y los detalles se
mantienen en la documentación especializada.

## A. Gobierno permanente

### Modelo y límites

e-ngenieria Hub es un SaaS multi-tenant para operar múltiples Stores e
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
- `hub_memberships` es la autoridad server-side del business role e-Hub.
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
| 2 | Persistencia multi-tenant e integración Mercado Libre incremental | **Activa — 2.20V cerrado** |
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
  actuales están en `credential_version=3` y lease libre.
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

- missing reconciliation y lifecycle/soft-delete;
- scheduler, worker/queue y ejecución periódica;
- recovery automática de runs stale;
- resumability con cursor persistente;
- writes hacia Mercado Libre;
- webhooks y otros dominios aún no implementados;
- órdenes, preguntas, envíos, variaciones, inventario y otros providers.

Checkpoint no equivale a resumability: los runs actuales no persisten offset,
cursor ni `scroll_id` y una nueva ejecución reinicia discovery.

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
