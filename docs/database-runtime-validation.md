# Database Runtime Validation

> **Schema/design:** [meli-database.md](./meli-database.md). **Tenant/security model:** [meli-multi-tenancy.md](./meli-multi-tenancy.md). **Operational checkpoints:** [índice de prompts de Fase 2](./prompts/phase-02/README.md). Este documento conserva evidencia de validación, no arquitectura.

## Checkpoint local — 2026-08-24

**Estado:** LOCAL VALIDATED — 2026-08-24.

- Docker Engine: operativo (`29.7.2`).
- Docker Compose: operativo (`v5.4.0`).
- Supabase CLI del proyecto: `2.114.0`.
- Remoto: no enlazado; no se ejecutaron `login`, `link` ni `db push`.

El primer intento fue bloqueado por `429 Too Many Requests` al resolver una imagen oficial. Tras la autorización adicional de Docker/Windows, el retry inició el stack correctamente. No se observó un fallo SQL.

Dos ejecuciones de `bunx supabase db reset` aplicaron desde cero `20260821230525_phase_2_store_foundation.sql` y `20260822202032_phase_2_connections.sql`. Se verificaron tablas y una matriz transaccional, revertida al final, de roles, Stores, FKs compuestas cross-tenant, `ON DELETE RESTRICT`, Connections, allowlists, defaults, unicidad parcial global activa, liberación disabled, NULL y `scopes`. No se añadieron tests de integración de repositories ni se modificó la arquitectura.

Las migraciones versionadas se mantuvieron sin cambios. Bootstrap First Owner sigue pendiente de una estrategia transaccional que no fije prematuramente la cardinalidad futura de Owner; el fallback transitorio de Clerk y RLS permanecen sin cambios. Remote Database: NOT LINKED / NOT VALIDATED.

Fase 3 no está iniciada.

## Remote validation

Proyecto `ffcudwwrzttkumbdvada` linkeado. Las tres migrations están aplicadas. Roles, unicidad, Stores, assignments, delete restrict, Connections, providers, status/defaults, unicidad activa, disabled release, NULL, scopes y bootstrap funcional pasaron con fixtures ficticios limpiados; conteos finales: 0/0/0/0. Concurrencia: LOCAL VALIDATED; REMOTE NOT REPEATED.

## Bootstrap First Owner — validación local

La migration `20260824120039_phase_2_bootstrap_first_owner.sql` usa `pg_advisory_xact_lock(hashtextextended(organization_id, 0))` dentro de una transacción. Dos carreras independientes sobre una Organization produjeron exactamente un `created`, un `already_bootstrapped` y un Owner. Organizations distintas se inicializaron en paralelo. Una membership Employee existente devolvió `membership_exists_non_owner`, sin promoción. El schema permite un segundo Owner administrativo: el lock protege sólo bootstrap. Un reset final reaplicó las tres migrations desde cero. Remote permanece no enlazado.
