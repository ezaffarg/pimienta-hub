# Fase 2 — índice operativo

Estado actual: **2.10 cerrado** en `0436622`; Fase 3 y OAuth no iniciados. Este índice se normaliza retrospectivamente sin reescribir prompts históricos.

Los documentos canónicos son la Source of Truth; este índice sólo resume propósito, estado y referencias. La auditoría 2.0 y sus decisiones bloqueantes están archivadas; no autorizan implementación. Ver [plan y gobierno](../../plan-y-gobierno.md).

- [Decisiones posteriores a auditoría 2.0](./2.0-decisions.md)
- [Subfase 2.1 — schema SQL y migraciones](./2.1-schema-migraciones.md)
- [Subfase 2.1B — Supabase CLI reproducible](./2.1b-supabase-cli.md)
- [Cierre de 2.1 + 2.1B](./2.1b-close.md)
- [Subfase 2.2 — schema mínimo persistente](./2.2-persistencia.md)
- [Subfase 2.3 — repositories y roles persistentes](./2.3-repositories-roles.md)
- [Cierre de Subfase 2.3](./2.3-close.md)
- [Subfase 2.4 — Store Scope persistente](./2.4-store-scope.md)
- [Subfase 2.5 — Connections sin OAuth](./2.5-connections.md)
- [Cierre/readiness de Fase 2](./2.6-phase-close-readiness.md)
- [Cierre documental de Fase 2](./2.6b-phase-close-commit.md)
- [Database Runtime Validation — primer intento](./2.7-runtime-db-validation.md)
- [Database Runtime Validation — retry](./2.7b-runtime-db-validation-retry.md)
- [Cierre de Database Runtime Validation local](./2.7c-runtime-db-validation-close.md)
- [2.8 — Bootstrap Owner + preparación remota](./2.8-bootstrap-owner-remote-prep.md)
- [2.8B — validación de concurrencia](./2.8b-bootstrap-owner-concurrency-validation.md)
- [2.8C — cierre Bootstrap Owner](./2.8c-bootstrap-owner-close.md)
- [2.9 — link y validación remota de Supabase](./2.9-remote-supabase-link-validation.md)
- [2.10 — activación de memberships persistentes](./2.10-persistent-membership-activation.md)

## Estado y referencias canónicas

| Checkpoint | Estado / commit | Propósito | Canónico |
| --- | --- | --- | --- |
| [2.0](./2.0-decisions.md) | Approved / `f8a13d5` | Decisiones de persistencia y Store | [plan](../../plan-y-gobierno.md), [multi-tenancy](../../meli-multi-tenancy.md) |
| [2.1](./2.1-schema-migraciones.md) · [2.1B](./2.1b-supabase-cli.md) · [cierre](./2.1b-close.md) | Completed / `f8a13d5`, `4006d22` | Diseño SQL y tooling | [database](../../meli-database.md) |
| [2.2](./2.2-persistencia.md) · [cierre](./2.2-close-memory.md) | Completed / `95d4828` | Schema persistente | [database](../../meli-database.md) |
| [2.3](./2.3-repositories-roles.md) · [cierre](./2.3-close.md) | Completed / `eabeac6` | Repositories y roles | [database](../../meli-database.md), [multi-tenancy](../../meli-multi-tenancy.md) |
| [2.4](./2.4-store-scope.md) · [cierre](./2.4-close.md) | Completed / `e14af7e` | Store Scope | [multi-tenancy](../../meli-multi-tenancy.md) |
| [2.5](./2.5-connections.md) · [cierre](./2.5-close.md) | Completed / `806917d` | Connections sin OAuth | [database](../../meli-database.md) |
| [2.6](./2.6-phase-close-readiness.md) · [2.6B](./2.6b-phase-close-commit.md) | Completed / `1444268` | Readiness/cierre | [plan](../../plan-y-gobierno.md) |
| [2.7](./2.7-runtime-db-validation.md) · [2.7B](./2.7b-runtime-db-validation-retry.md) · [2.7C](./2.7c-runtime-db-validation-close.md) | Completed / `dae9af6` | Validación runtime local | [evidencia](../../database-runtime-validation.md) |
| [2.8](./2.8-bootstrap-owner-remote-prep.md) · [2.8B](./2.8b-bootstrap-owner-concurrency-validation.md) · [2.8C](./2.8c-bootstrap-owner-close.md) | Completed / `59020bf` | Bootstrap First Owner | [database](../../meli-database.md), [evidencia](../../database-runtime-validation.md) |
| [2.9](./2.9-remote-supabase-link-validation.md) | Completed / `96c89ee` | Link y validación remota | [evidencia](../../database-runtime-validation.md) |
| [2.10](./2.10-persistent-membership-activation.md) | Completed / `0436622` | Autoridad primaria memberships | [multi-tenancy](../../meli-multi-tenancy.md), [plan](../../plan-y-gobierno.md) |

Obsidian conserva índice y memoria resumida; el detalle vive en documentos y prompts versionados.
# 2.11 — Real Membership Provisioning + Store Assignment Preparation

Prompt archivado: [2.11](2.11-real-membership-provisioning.md). Estado: ACTIVE / PENDING.
# 2.12 — Real User Provisioning Plan + Fallback Cutover Preparation

Prompt archivado: [2.12](2.12-real-user-provisioning-plan.md). Estado: ACTIVE / USER APPROVAL REQUIRED.

# 2.13 — Provision Current Owner Persistently

Prompt archivado: [2.13](2.13-provision-current-owner.md). Estado: COMPLETED.
