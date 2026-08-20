# Plan y gobierno del e-ngenieria Hub

Este documento es la fuente de verdad operativa para el avance del proyecto. Define el orden de fases, los criterios de avance, el tratamiento de decisiones y los límites que deben respetar las personas y los agentes.

## Alcance actual

El proyecto conserva el starter de dashboard como base. La arquitectura objetivo es un SaaS multi-tenant donde:

- Clerk es la fuente de identidad y autenticación.
- Clerk Organizations representa el tenant de identidad.
- Supabase se utiliza únicamente como PostgreSQL.
- Las integraciones externas viven en `src/integrations/`.
- La UI consume modelos internos y nunca expone tokens ni DTOs de proveedores.
- Mercado Libre es el primer proveedor y el primer hito se limita a conectar cuentas.

La existencia de carpetas, tipos o documentación preparatoria no significa que una capacidad esté implementada.

### Implementación preparatoria de Fase 0

Durante la consolidación arquitectónica de la Fase 0 se crearon piezas preparatorias en `src/lib/auth/`, `src/infrastructure/` y `src/integrations/`. Su propósito es fijar límites, contratos y dependencias server-only; no constituyen la implementación de seguridad base, persistencia, OAuth, UI, adapters, sincronización ni producto.

Su existencia no autoriza iniciar, implementar ni dar por iniciadas las Fases 1 a 7. Cada fase conserva sus prerrequisitos, alcance, decisiones confirmadas y condiciones de salida definidos en este documento.

## Fuente de verdad documental

Este documento gobierna el orden de ejecución y las reglas de trabajo. Los documentos especializados aportan detalle técnico:

- [Arquitectura de Mercado Libre](./meli-architecture.md)
- [Seguridad de Mercado Libre](./meli-security.md)
- [Multi-tenancy](./meli-multi-tenancy.md)
- [Base de datos](./meli-database.md)
- [Integración](./meli-integration.md)
- [OAuth y API](./meli-mercadolibre-OAuth/API.md)
- [Sincronización](./meli-sync.md)
- [UI](./meli-ui.md)
- [Análisis histórico](./Cursor-AnalisisInicio.md)

Si dos documentos discrepan, primero se debe registrar la discrepancia como decisión pendiente y resolverla explícitamente antes de implementar.

## Estado de fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| 0. Decisiones y consolidación | Fuente de verdad, límites, decisiones pendientes y reglas de agentes | En curso |
| 1. Seguridad base | Auth server-side, autorización, tenant resolution, validación y errores | Pendiente |
| 2. Persistencia multi-tenant | Stores, conexiones, cuentas, auditoría, migraciones y repositorios | Pendiente |
| 3. OAuth Mercado Libre | Inicio, callback, state, replay protection, tokens cifrados, conexión y desconexión | Pendiente |
| 4. UI de conexiones | Stores, estados, conectar, reautorizar y desconectar | Pendiente |
| 5. Adapter y dominio inicial | Cliente server-only, DTOs, mappers y una capacidad inicial | Pendiente |
| 6. Sincronización | Webhooks, jobs, idempotencia, reintentos y reconciliación | Pendiente |
| 7. Producto y producción | Recorte selectivo del starter, observabilidad, despliegue y operación | Pendiente |

No se puede iniciar una fase posterior mientras la fase actual no cumpla sus criterios de salida.

## Plan por fases

### Fase 0 — Decisiones y consolidación

Definir y documentar Organization, Store, External Connection, ownership, cifrado, entornos y qué demos se conservan. No se eliminan funcionalidades del starter en esta fase.

#### DECISIÓN CONFIRMADA — excepción acotada de formato

La comprobación global `bun run format:check` falla actualmente sobre 309 archivos preexistentes del starter. Para este checkpoint de Fase 0 se acepta una excepción acotada: los archivos preparatorios incorporados en `src/lib/auth/`, `src/infrastructure/` y `src/integrations/` deben pasar una comprobación de formato focalizada, mientras que `typecheck`, `lint`, `build` y `git diff --check` deben pasar globalmente.

No se ejecutará un formateo masivo como parte de esta Fase 0. La normalización global del starter requiere un checkpoint independiente y autorización explícita. Esta excepción no autoriza omitir la validación de formato en fases posteriores; deberá reevaluarse antes de cerrar cada fase.

### Fase 1 — Seguridad base

Proteger todos los endpoints, resolver tenant desde Clerk en servidor, autorizar por rol/permiso, validar inputs con Zod, normalizar errores y revisar la configuración de Sentry.

### Fase 2 — Persistencia multi-tenant

Modelar `stores`, `external_connections`, `external_accounts` y `audit_log`, con tenant keys, constraints, índices, migraciones reproducibles, repositorios server-only y RLS como defensa adicional.

### Fase 3 — MVP OAuth de Mercado Libre

Implementar únicamente el flujo de conexión: inicio, state criptográfico, expiración, consumo único, callback, redirect URI exacta, intercambio de tokens, cuenta autorizada, cifrado, rotación, desconexión y reautorización.

### Fase 4 — UI de conexiones

Agregar una feature de integraciones que consuma endpoints internos protegidos. La UI no conoce URLs externas, tokens, DTOs de Mercado Libre ni reglas de persistencia.

### Fase 5 — Adapter y dominio inicial

Crear cliente HTTP server-only, DTOs externos, mappers, errores normalizados y `MercadoLibreAdapter`. Implementar una sola capacidad inicial antes de publicaciones, órdenes, preguntas o inventario.

### Fase 6 — Sincronización y operaciones

Implementar webhook-first, persistencia de eventos, idempotencia, jobs, cursores, reintentos, backfill, reconciliación y dead-letter. Avanzar por capacidad, no todo a la vez.

### Fase 7 — Recorte y producción

Retirar demos únicamente después de confirmar que no son reutilizables, actualizar branding, revisar dependencias, configurar backups, observabilidad, alertas y operación productiva.

## Puerta obligatoria de cada fase

Cada fase debe seguir exactamente este ciclo:

```text
FASE
  ↓
IMPLEMENTACIÓN
  ↓
TYPECHECK
  ↓
LINT
  ↓
BUILD
  ↓
TESTS
  ↓
REVISIÓN DE SEGURIDAD
  ↓
DOCUMENTACIÓN
  ↓
COMMIT
  ↓
SIGUIENTE FASE
```

La fase no está terminada si falta una comprobación, una revisión, la actualización documental o el commit correspondiente.

## Decisiones, supuestos y pendientes

Toda afirmación de diseño debe clasificarse como una de estas categorías:

- **Decisión confirmada:** acordada por el equipo y documentada.
- **Suposición:** hipótesis temporal, nunca base suficiente para una migración o contrato público.
- **Decisión pendiente:** asunto que puede cambiar arquitectura, seguridad, datos o UX y debe preguntarse antes de implementar.

Ejemplo: si no está claro si una Store puede tener varias cuentas de Mercado Libre, se debe registrar **DECISIÓN PENDIENTE** y detener el trabajo afectado. El agente no puede inventar la respuesta.

## Condiciones de avance

Antes de pasar de fase deben estar comprobados:

- Ningún endpoint sensible sin autenticación y autorización server-side.
- Toda consulta y mutación protegida con tenant-scoping.
- Ningún secreto en navegador, respuestas, logs, trazas o errores.
- DTOs externos aislados detrás de mappers.
- Tests de aislamiento entre organizaciones cuando exista persistencia.
- `bun run typecheck`, `bun run lint`, `bun run build` y los tests definidos para la fase.
- Documentación y estado de fase alineados con el código real.
