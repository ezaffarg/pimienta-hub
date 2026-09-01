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

# 2.20U — Administrative Stale-Run Recovery

Prompt archivado: [2.20U](2.20u-administrative-stale-run-recovery.md). Estado:
CLOSED.

# 2.20V-A — Administrative Listing Sync Operations Read UI

Prompt archivado:
[2.20V-A](2.20v-a-administrative-listing-sync-read-ui.md). Estado: LOCAL
VALIDATION PASS / CLOSED.

# 2.20V-B — Administrative Listing Sync Recovery UI

Prompt archivado:
[2.20V-B](2.20v-b-administrative-listing-sync-recovery-ui.md). Estado: LOCAL
AND REMOTE VALIDATION PASS / CLOSED. **2.20V está cerrado.**

# 2.20W — Safe Listing Reconciliation

Historial: [W-A audit](2.20w-a-listing-reconciliation-design-schema-audit.md),
[W-A2 semantics](2.20w-a2-provider-reconciliation-semantics.md) y
[W-B implementation](2.20w-b-safe-run-aware-listing-reconciliation.md).
Estado: W-B IMPLEMENTATION + LOCAL VALIDATION y W-C REMOTE VALIDATION PASS;
W-A, W-A2, W-B, W-C y 2.20W CLOSED.

# 2.20X — Incremental Sync & Notifications

[X-A](2.20x-a-incremental-sync-notifications-design-audit.md) resolvió el
diseño. [X-B](2.20x-b-integration-event-intake-foundation.md) implementa y
valida localmente la foundation server-only de intake durable para eventos
Mercado Libre `items`. Estado: X-B LOCAL IMPLEMENTATION + VALIDATION PASS; el
callback público específico quedó implementado en
[X-C](2.20x-c-mercado-libre-items-public-callback.md) con validación local PASS.
[X-D](2.20x-d-incremental-event-processing-freshness-cas.md) agrega
procesamiento server-only controlado y freshness CAS, también con validación
local PASS. Retry scheduling y `missed_feeds` quedaron implementados como
foundation controlada en
[X-E](2.20x-e-retries-missed-feeds-recovery.md), con validación local PASS.
[X-F](2.20x-f-scheduler-event-observability.md) agrega orchestration acotada,
maintenance runs persistentes y el resumen administrativo Owner/Manager, con
validación local PASS. El trigger scheduler/cron permanece bloqueado hasta
seleccionar el deployment productivo canónico; no existe ejecución automática
ni route pública.
[X-F2](2.20x-f2-deployment-scheduler-decision.md) confirmó que el deployment
productivo no está seleccionado y dejó la decisión Vercel Pro vs Docker/VPS al
usuario antes de F3. No implementó trigger.
[X-F2b](2.20x-f2b-maintenance-run-stale-reclaim.md) implementó y validó
localmente checkpoints y reclaim atómico de maintenance runs abandonados. El
deployment fue seleccionado después en
[X-F3-A](2.20x-f3a-coolify-docker-deployment-readiness-audit.md): Hostinger VPS,
Docker y Coolify. El audit quedó PASS, con implementación de Dockerfile,
healthcheck, migrations controladas y scheduler interno diferidos a F3-B.
[X-F3-B](2.20x-f3b-coolify-docker-production-implementation.md) implementó y
validó localmente el Dockerfile standalone canónico, healthcheck y boundary
interno machine-authenticated. No aplicó migrations ni configuró Coolify,
Traefik, scheduler o provider reales; esos gates quedan para F3-C.
[X-F3-B2](2.20x-f3b2-product-rename-audit.md) auditó el rename propuesto a
Pimienta Hub sin ejecutarlo. Recomienda resolver branding/dominio y completar el
rename controlado antes de F3-C; código, migrations y sistemas externos quedaron
intactos.
[X-F3-B2-R1](2.20x-f3b2-r1-controlled-product-rename.md) aplica únicamente el
branding activo y package identity de Pimienta Hub. Dominio, asset OpenGraph,
GitHub, carpeta local, Supabase y sistemas externos permanecen diferidos.
[X-F3-B2-R2](2.20x-f3b2-r2-structural-github-rename.md) renombra la skill propia
a `pimienta-hub-architecture`; el repositorio GitHub y la carpeta local se
mantienen pendientes hasta completar sus gates explícitos.
[X-F3-B3](2.20x-f3b3-accumulated-x-closure.md) cierra el working tree acumulado
X/F3-B después de completar R1/R2 y los renames de repositorio y carpeta local
a Pimienta Hub. F3-C remoto todavía no inicia.
[X-F3-C1](2.20x-f3c1-remote-production-readiness-audit.md) audita en modo
read-only la infraestructura productiva real y prepara el plan F3-C2. No
realiza deployment, migrations remotas ni cambios de providers.
[X-F3-C-LOCAL-1](2.20x-f3c-local1-coolify-supabase-readiness.md) reemplaza el
supuesto de VPS por un laboratorio productivo local con Coolify y Supabase
remoto. Es un preflight read-only; LOCAL-2 queda pendiente.
[X-F3-C-LOCAL-2A](2.20x-f3c-local2a-pimienta-hub-coolify-deploy.md) autoriza un
único deployment de Pimienta Hub en Coolify local, sin migrations, providers,
scheduler ni tunnel. LOCAL-2B conserva el gate remoto separado.
[X-F3-C-LOCAL-2B](2.20x-f3c-local2b-remote-supabase-migration-gate.md) aplica
únicamente las cinco migrations X al Supabase remoto linked después de pasar
backup, auditoría e historial. Providers y runtime funcional quedan fuera.
[X-F3-C-LOCAL-2B2](2.20x-f3c-local2b2-supabase-key-incident-recovery.md) verifica
la rotación de la credencial Supabase y corrige la portabilidad remota de la
matriz de mantenimiento sin cambiar producto ni migrations.
[X-F3-C-LOCAL-2C](2.20x-f3c-local2c-runtime-validation.md) valida el pipeline
runtime X en el laboratorio Coolify local contra Supabase remoto.
[X-F3-C-LOCAL-2D](2.20x-f3c-local2d-mercado-libre-provider-test.md) valida el
boundary HTTPS temporal y un único mantenimiento real controlado.
[X-F3-C-LOCAL-2D2](2.20x-f3c-local2d2-quick-tunnel-host-routing.md) corrige el
Host de origin del Quick Tunnel sin cambiar Traefik ni Coolify.
[X-F3-C-LOCAL-2D3](2.20x-f3c-local2d3-mercado-libre-real-provider-test.md)
autoriza un provider test único sólo después de alinear tunnel y redirect.
[X-F3-C-LOCAL-2D3A](2.20x-f3c-local2d3a-refresh-cas-persistence-gap.md)
investiga el gap de persistencia CAS sin nuevas llamadas al provider.
[X-F3-C-LOCAL-2D3B](2.20x-f3c-local2d3b-refresh-failure-observability.md)
preserva subtipos seguros de fallo CAS y prepara la reautorización sin ejecutarla.
[X-F3-C-LOCAL-2D3C7](2.20x-f3c-local2d3c7-maintenance-body-gate-fix.md)
corrige la detección de body vacío del boundary interno sin ejecutar mantenimiento real.
[X-F3-C-LOCAL-2D3C9](2.20x-f3c-local2d3c9-missed-feed-failure-diagnostics.md)
audita stage, conteo provider y cadence del fallo `missed_feed_failed` sin nuevas llamadas reales.
[X-F3-C-LOCAL-2D3C10](2.20x-f3c-local2d3c10-durable-missed-feed-observability.md)
agrega observabilidad durable y segura de stage y provider calls mediante una migration forward.
