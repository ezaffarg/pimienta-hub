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

## Subfase Approval Gate

Ninguna subfase comienza automáticamente. Antes de ejecutar una subfase, el agente debe leer la documentación aplicable, revisar el estado del repositorio, identificar archivos a modificar e inspeccionar, dependencias, riesgos, herramientas, APIs, servicios externos, costes y acciones irreversibles. Debe explicar el alcance, qué no hará, la complejidad y una estimación aproximada de contexto/tokens; luego presenta el plan y se detiene hasta recibir aprobación explícita.

```text
PLANNING → ANÁLISIS → ESTIMACIÓN DE IMPACTO / TOKENS / COSTES
                                      ↓
                              🛑 USER APPROVAL
                                      ↓
APPROVED → EXECUTING → VALIDATION → CHECKPOINT → 🛑 STOP
```

Nunca se permite `PLANNING → EXECUTING` sin aprobación explícita. Solo autorizan expresiones inequívocas como `APROBAR SUBFASE 1.1`, `CONTINUAR` o una instrucción afirmativa equivalente y claramente dirigida a la subfase propuesta. Preguntas, comentarios, “ok”, “bien”, “perfecto” o una aprobación previa no autorizan la siguiente subfase.

Cada subfase se clasifica antes de ejecutarse:

- 🟢 **Bajo:** 1–3 archivos, cambios localizados, sin arquitectura ni integraciones.
- 🟡 **Medio:** varios archivos, refactors, guards, contratos o tests nuevos.
- 🔴 **Alto:** autenticación, autorización, OAuth, integraciones, migraciones, base de datos, cambios estructurales, costes externos o consumo significativo de contexto.

En todos los niveles se presenta el plan y se espera aprobación. En nivel 🔴 se detallan además alternativas, dependencias, riesgos, impacto, tokens/contexto y costes potenciales. Al cerrar una subfase se validan cambios, se documentan hechos, pendientes, archivos, riesgos, consumo y costes, se presenta el checkpoint y se detiene.

## Estado de fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| 0. Decisiones y consolidación | Fuente de verdad, límites, decisiones pendientes y reglas de agentes | Completada |
| 1. Seguridad base | Auth server-side, autorización, tenant resolution, validación y errores | En curso — Subfase 1.1 completada |
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

Define y aplica seguridad server-side antes de persistencia o integraciones: autenticación, Organization activa, roles, permisos, alcance de recurso, validación Zod, errores HTTP y revisión de Sentry. Protege los endpoints demo `/api/products` y `/api/users`; estar bajo `/api` o `/dashboard` no es protección.

Quedan fuera de Fase 1 la persistencia definitiva de Client, Store, Team y asignaciones, OAuth, Mercado Libre, sincronización, UI de conexiones, ajustes de Google Sans Flex y `metadataBase`.

#### Modelo de autorización confirmado

```text
User → Role → Permission → Resource Scope → Resource
```

Los roles son Owner, Manager, Employee y Client; nunca se simplifican a `admin/member`. Existe un Owner con alcance global; los Managers tienen privilegios cercanos pero no adquieren automáticamente permisos globales ni condición de Owner; Employees operan solo dentro de sus asignaciones; Clients solo operan sus propios recursos. Client, Store, Team, User y Resource Scope son conceptos distintos. Un Client puede tener varias Stores y una Store puede ser asignada a múltiples Employees, Teams y Managers.

Clerk aporta identidad, autenticación, Organization y roles/permisos base. La aplicación conserva Client, Store, Team, ownership, asignaciones y alcance comercial; no se modelan exclusivamente mediante roles de Clerk. Fase 1 define el contrato de guards y un resolver temporal testeable para scope. Fase 2 lo reemplazará por un resolver persistente sin cambiar ese contrato.

El servidor resuelve la identidad y Organization desde Clerk; `organizationId`, `clientId`, `storeId` y otros IDs del request son datos no confiables hasta cruzarlos con tenant, permiso y scope. Una Store existente pero fuera del alcance del usuario devuelve `403` en las pruebas explícitas de Fase 1. `404` se reserva para recursos cuya existencia se decida ocultar según el tipo de recurso; no es una regla universal.

#### DECISIÓN CONFIRMADA — límites preparatorios de arquitectura

`features/` representa capacidades y experiencias del producto; `integrations/` representa adapters técnicos hacia proveedores externos. Una Store tendrá conexiones/configuración persistidas, no una copia del código del proveedor: `Organization -> Store -> IntegrationConnection -> Provider`. Se mantiene una única implementación reutilizable por proveedor en `src/integrations/mercado-libre/`.

No se crearán `src/application/` ni `src/domain/` hasta que una responsabilidad real justifique extraer código de su módulo actual y aporte un beneficio arquitectónico concreto. Los tipos de `src/integrations/core/` permanecen temporalmente allí; su ubicación se revisará antes de adapters reales de ventas, productos, inventario u órdenes. Estas decisiones no autorizan OAuth, persistencia, StoreIntegrationResolver ni integraciones funcionales.

#### Subfases previstas

1. **1.0 — Gobierno y modelo de autorización:** documentación y decisiones, sin código funcional.
2. **1.1 — Auditoría y contrato de pruebas:** Vitest en entorno Node, configuración compartida, smoke test y matriz de pruebas; sin guards ni seguridad funcional.
3. **1.2 — Guards base y contrato HTTP:** sesión, Organization y errores uniformes.
4. **1.3 — Roles, permisos y policy de scope:** contrato reemplazable y pruebas de aislamiento.
5. **1.4 — Endpoints demo y Zod:** protección y validación de `/api/products` y `/api/users`.
6. **1.5 — Sentry y cierre de seguridad:** minimización de datos, auditoría y documentación.
7. **1.6 — Validación y checkpoint:** comprobaciones finales y cierre de fase.

Cada subfase requiere aprobación independiente mediante el Subfase Approval Gate.

#### Infraestructura de testing de Fase 1

Vitest se ejecuta en entorno Node con alias `@` hacia `src` y scripts `test` y `test:watch`. La infraestructura inicial no incorpora DOM, Testing Library, Playwright, cobertura, fixtures de scope ni tests de seguridad funcional; estos se agregan únicamente en sus subfases aprobadas.

#### Subfase 1.2 — Guards base y contrato HTTP

`src/lib/auth/server-context.ts` resuelve en servidor el contexto mínimo `{ userId, organizationId }` mediante `auth()` de Clerk. Los handlers existentes de `/api/products` y `/api/users`, incluidos sus recursos por ID, ejecutan el helper antes de leer body, parámetros o mocks. Sin sesión responden `401` con `AUTHENTICATION_REQUIRED`; con sesión pero sin Organization activa responden `403` con `ORGANIZATION_REQUIRED`. La respuesta usa el formato uniforme `{ error: { code, message } }`.

Esta subfase no implementa roles, permisos, resource scope, Store, Team, persistencia ni integraciones. Esos datos no se aceptan como autoridad desde el request.

#### Subfase 1.3A — RBAC y policy base

La autorización server-side usa los roles e-Hub Owner, Manager, Employee y Client, sin acoplar la policy a nombres de Clerk. Hasta contar con una fuente propia aprobada, el mapping temporal y testeable es `org:admin -> Owner` y `org:member -> Employee`; cualquier otro rol Clerk se deniega. Manager y Client no se resuelven automáticamente durante esta subfase.

Permisos implementados: `products.read`, `products.write`, `users.read` y `users.write`. La matriz explícita es Owner: todos; Manager: `products.read`, `products.write`, `users.read`; Employee: `products.read`; Client: ninguno global. Toda combinación no listada se deniega. Resource Scope, Store, Team, asignaciones y persistencia permanecen fuera de 1.3A.

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

### Condición de salida específica de Fase 1

- Auditoría de handlers, Server Actions, acceso a datos, IDs del cliente, guards, validaciones y Sentry.
- Guards de autenticación, Organization, rol/permiso y resource scope en servidor.
- Tenant isolation y contratos de scope testeables sin persistencia definitiva.
- `/api/products` y `/api/users` protegidos y validados con Zod.
- Contrato HTTP uniforme sin secretos, tokens, trazas, SQL ni detalles internos.
- Revisión de Sentry para excluir PII, cookies, headers Authorization, credenciales y secretos innecesarios.
- Vitest y pruebas de: sin sesión, sin Organization, sin permiso, Employee fuera de Store, Client de otra Store, otra Organization, Owner permitido, Manager permitido y Manager ante operación exclusiva de Owner.
- `typecheck`, `lint`, formato según la excepción vigente, `build`, tests y documentación aprobados.
