# Fase 1 — registro reconstruido

Status: **COMPLETED**.

Estas entradas fueron reconstruidas a partir del historial de Fase 1, los TXT conservados y el estado/documentación del repositorio. Siguen el estilo operativo que luego se consolidó en los prompts de Fase 2, pero **no pretenden ser transcripciones literales**.

> Los bloques **Prompt archivado** son reconstrucciones semánticas y fieles del mandato original. Cuando no existe el texto exacto, se preservan objetivo, restricciones, decisiones, resultado y commit sin inventar citas textuales.

## Prompts archivados

- [1.0 — auditoría inicial](./1.0-initial-audit.md)
- [1.0B — checkpoint arquitectónico](./1.0b-architecture-checkpoint.md)
- [1.1 — testing baseline](./1.1-testing-baseline.md)
- [1.2 — server tenant context](./1.2-server-tenant-context.md)
- [1.3A — RBAC y permisos](./1.3a-rbac-permissions.md)
- [1.3B — Resource Scope](./1.3b-resource-scope.md)
- [1.4 — validación de API y errores](./1.4-api-validation-errors.md)
- [1.4B — auditoría global de seguridad](./1.4b-phase-1-global-audit.md)
- [1.5 — privacidad de Sentry](./1.5-sentry-privacy.md)
- [1.6 — cierre formal](./1.6-closure.md)

| Subfase / mandato | Propósito y límites | Resultado | Commit |
| --- | --- | --- | --- |
| 1.0 — Auditoría inicial | Entender starter, seguridad, arquitectura y límites antes de modificar. | Baseline técnica y riesgos identificados. | Histórico / previo a commits de Fase 1 |
| 1.0B — Checkpoint arquitectónico | Fijar límites `features/` vs `integrations/`, Store/conexiones y capas diferidas. | Modelo histórico `Organization → Store → ExternalConnection`, luego consolidado como `Connection`. | Decisiones persistidas posteriormente |
| 1.1 — Testing baseline | Preparar Vitest Node y smoke test; sin guards, UI, persistencia ni dependencias de navegador. | Infraestructura de testing base. | `03ea103` |
| 1.2 — Server tenant context | Resolver sesión y Organization en servidor; proteger rutas demo, sin roles ni scope real. | Contexto server-side confiable. | `4da2dcb` |
| 1.3A — RBAC / permissions | Roles e-Hub, mapping provisional `org:admin → Owner`, `org:member → Employee`, default-deny; no Store ni persistencia. | Policy de permisos testeada. | `15daa5f` |
| 1.3B — Resource Scope | Tenantizar mocks; usar contexto server-side; ocultar cross-tenant con `404`; no Store scope persistente. | Aislamiento temporal por Organization. | `8e47842` |
| 1.4 — API validation / errors | Zod y contrato HTTP uniforme; IDs del cliente no controlan tenant. | Validación y respuestas normalizadas. | `9d5344f` |
| 1.4B — Auditoría global | Auditar Fase 1 completa en solo lectura antes de cerrarla. | `FASE 1 NO CERRABLE`; Sentry PII identificado como blocker y 1.5 autorizada. | Read-only / entre `9d5344f` y `0185cf6` |
| 1.5 — Sentry privacy | `sendDefaultPii: false`, sanitización y pruebas HTTP de seguridad. | Blocker de privacidad resuelto. | `0185cf6` |
| 1.6 — Cierre formal | Alinear documentos con código y verificar límites antes de Fase 2. | Cierre formal de la baseline de seguridad. | `b543597` |

La fuente operativa vigente de las decisiones continúa siendo [plan-y-gobierno.md](../../plan-y-gobierno.md). El historial de prompts funciona como registro operativo y no reemplaza al código, tests ni documentación arquitectónica vigente.
