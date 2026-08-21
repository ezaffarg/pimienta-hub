# Fase 1 — registro reconstruido

Status: **COMPLETED**. Las siguientes entradas son **Reconstructed from repository decisions**; resumen mandatos significativos y no citas textuales.

| Subfase / mandato | Propósito y límites | Resultado | Commit |
| --- | --- | --- | --- |
| Testing baseline (1.1) | Preparar Vitest Node y smoke test; sin guards, UI, persistencia ni dependencias de navegador. | Infraestructura de testing base. | `03ea103` |
| Server tenant context (1.2) | Resolver sesión y Organization en servidor; proteger rutas demo, sin roles ni scope real. | Contexto y contrato HTTP inicial. | `4da2dcb` |
| RBAC / permissions (1.3A) | Roles e-Hub, mapping provisional `org:admin -> Owner`, `org:member -> Employee`, default-deny; no Store ni persistencia. | Policy de permisos testeada. | `15daa5f` |
| Resource Scope (1.3B) | Tenantizar mocks; usar contexto server-side; ocultar cross-tenant con `404`; no Store scope. | Aislamiento temporal por Organization. | `8e47842` |
| API validation / errors (1.4) | Zod strict y contrato de error uniforme; IDs del cliente no controlan tenant. | Validación y respuestas normalizadas. | `9d5344f` |
| Sentry privacy (1.5) | `sendDefaultPii: false` y sanitización de eventos, transacciones y breadcrumbs. | Endurecimiento de privacidad y pruebas HTTP. | `0185cf6` |
| Phase 1 final audit | Verificar alcance, deuda y que Store/persistencia/OAuth siguieran fuera. | Fase 1 declarada cerrable. | — |
| Phase 1 closure (1.6) | Alinear documentos con código y dejar Fase 2 pendiente. | Cierre formal de la baseline de seguridad. | `b543597` |

La fuente operativa de estas decisiones continúa siendo [plan-y-gobierno.md](../../plan-y-gobierno.md).
