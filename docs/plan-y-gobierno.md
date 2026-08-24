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
- [Handoff para agentes](./codex-handoff.md)
- [Workflow de agentes](./agent-workflow.md)
- [Referencia funcional de MercadoCuentas](./mercado-cuentas-functional-reference.md)
- [Roadmap de módulos](./product-modules-roadmap.md)
- [Índice de prompts y mandatos](./prompts/README.md)
- [Análisis histórico](./Cursor-AnalisisInicio.md)

Si dos documentos discrepan, primero se debe registrar la discrepancia como decisión pendiente y resolverla explícitamente antes de implementar.

El handoff resume el estado para nuevas sesiones, pero no sustituye este plan. Los registros de prompts preservan decisiones significativas de forma resumida y no reemplazan el código, tests ni las reglas vigentes.

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
| 1. Seguridad base | Auth server-side, autorización, tenant resolution, validación, errores y privacidad Sentry | Cerrada — Checkpoint 1.6 |
| 2. Persistencia multi-tenant | Stores, conexiones, cuentas, auditoría, migraciones y repositorios | Activa — Checkpoint 2.10: autoridad primaria de memberships |
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

El servidor resuelve la identidad y Organization desde Clerk; `organizationId`, `clientId`, `storeId` y otros IDs del request son datos no confiables hasta cruzarlos con tenant, permiso y scope. El scope implementado en Fase 1 es únicamente por Organization: un recurso inexistente o de otra Organization devuelve `404` cuando su existencia debe ocultarse. Store scope, Client ownership y asignaciones no existen todavía y se difieren a Fase 2.

#### DECISIÓN CONFIRMADA — límites preparatorios de arquitectura

`features/` representa capacidades y experiencias del producto; `integrations/` representa adapters técnicos hacia proveedores externos. Una Store tendrá conexiones/configuración persistidas, no una copia del código del proveedor: `Organization -> Store -> IntegrationConnection -> Provider`. Se mantiene una única implementación reutilizable por proveedor en `src/integrations/mercado-libre/`.

No se crearán `src/application/` ni `src/domain/` hasta que una responsabilidad real justifique extraer código de su módulo actual y aporte un beneficio arquitectónico concreto. Los tipos de `src/integrations/core/` permanecen temporalmente allí; su ubicación se revisará antes de adapters reales de ventas, productos, inventario u órdenes. Estas decisiones no autorizan OAuth, persistencia, StoreIntegrationResolver ni integraciones funcionales.

#### Subfases completadas

1. **1.0 — Gobierno y modelo de autorización:** documentación y decisiones, sin código funcional.
2. **1.1 — Testing base:** Vitest en entorno Node, configuración compartida y smoke test.
3. **1.2 — Authentication + Organization server-side:** sesión, Organization y errores uniformes.
4. **1.3A — RBAC / permissions:** roles e-Hub, mapping provisional y default-deny.
5. **1.3B — Resource Scope por Organization:** mocks tenantizados y aislamiento temporal.
6. **1.4 — Zod + contrato de errores:** validación de `/api/products` y `/api/users`.
7. **1.5 — Sentry privacy hardening + pruebas HTTP:** minimización de datos y composición de handlers.
8. **1.6 — Checkpoint final:** auditoría, alineación documental y cierre de Fase 1.

Cada subfase requiere aprobación independiente mediante el Subfase Approval Gate.

#### Infraestructura de testing de Fase 1

Vitest se ejecuta en entorno Node con alias `@` hacia `src` y scripts `test` y `test:watch`. La infraestructura inicial no incorpora DOM, Testing Library, Playwright, cobertura, fixtures de scope ni tests de seguridad funcional; estos se agregan únicamente en sus subfases aprobadas.

#### Subfase 1.2 — Guards base y contrato HTTP

`src/lib/auth/server-context.ts` resuelve en servidor el contexto mínimo `{ userId, organizationId }` mediante `auth()` de Clerk. Los handlers existentes de `/api/products` y `/api/users`, incluidos sus recursos por ID, ejecutan `withServerPermission()` antes de leer body, parámetros o mocks. Sin sesión responden `401` con `AUTHENTICATION_REQUIRED`; con sesión pero sin Organization activa responden `403` con `ORGANIZATION_REQUIRED`. La respuesta usa el formato uniforme `{ error: { code, message } }`.

Esta subfase no implementa roles, permisos, resource scope, Store, Team, persistencia ni integraciones. Esos datos no se aceptan como autoridad desde el request.

#### Subfase 1.3A — RBAC y policy base

La autorización server-side usa los roles e-Hub Owner, Manager, Employee y Client, sin acoplar la policy a nombres de Clerk. Hasta contar con una fuente propia aprobada, el mapping temporal y testeable es `org:admin -> Owner` y `org:member -> Employee`; cualquier otro rol Clerk se deniega. Manager y Client no se resuelven automáticamente durante esta subfase.

Permisos implementados: `products.read`, `products.write`, `users.read` y `users.write`. La matriz explícita es Owner: todos; Manager: `products.read`, `products.write`, `users.read`; Employee: `products.read`; Client: ninguno global. Toda combinación no listada se deniega. Resource Scope, Store, Team, asignaciones y persistencia permanecen fuera de 1.3A.

#### Subfase 1.3B — Resource Scope de Organization

Los recursos mock de productos y usuarios tienen un `organizationId` temporal y determinista únicamente para probar aislamiento multi-tenant sin persistencia. Los handlers filtran listados y resuelven recursos por ID usando exclusivamente `ServerAuthorizationContext.organizationId`; el request no puede elegir el tenant. Las creaciones asignan el tenant del contexto server-side e ignoran `organizationId` del body.

La policy para recursos por ID es: falta de permiso `403`; recurso inexistente o de otra Organization `404`. No existe Store scope, Team scope, asignaciones, ownership de Client ni persistencia en esta subfase.

#### Subfase 1.4 — Validación de inputs y contrato de errores

Los handlers de productos y usuarios validan query, body e IDs con Zod. Los payloads son strict: no aceptan `organizationId`, roles, permisos ni scope del cliente. Los recursos por ID validan primero su sintaxis; un ID inválido devuelve `400 VALIDATION_ERROR`, y un ID válido inexistente o cross-tenant devuelve `404 NOT_FOUND`.

El formato uniforme de errores es `{ error: { code, message } }` con `401 AUTHENTICATION_REQUIRED`, `403 ORGANIZATION_REQUIRED`, `403 AUTHORIZATION_DENIED`, `400 VALIDATION_ERROR` y `404 NOT_FOUND`. La secuencia mantiene auth, Organization, permiso, scope y luego validación/operación.

#### Subfase 1.5 — Privacidad de Sentry y pruebas HTTP

Sentry deshabilita `sendDefaultPii` en todos sus runtimes y sanitiza eventos, transacciones y breadcrumbs antes de enviarlos. La sanitización redacta headers, cookies, request bodies, query strings y claves sensibles, sin incorporar identidad, email, Organization ni otros datos personales como contexto de telemetría.

Las pruebas HTTP directas cubren de forma representativa autenticación, Organization, permiso, scope cross-tenant, validación y éxito server-scoped en los handlers de productos. Los servicios de UI siguen usando mocks demo directamente: no son el boundary server-side de seguridad ni prueban todavía la cadena completa, y su migración se difiere a fases posteriores.

#### Subfase 1.6 — Checkpoint final y cierre documental

Fase 1 queda cerrada. Implementa Authentication y Organization server-side, RBAC con default-deny, permisos, Resource Scope por Organization, validación Zod, contrato HTTP consistente, privacidad Sentry y pruebas de seguridad. No implementa Store scope, Client ownership por Store, asignaciones de Store/Team, persistencia, repositorios, OAuth, Mercado Libre funcional ni sincronización.

La integración futura de Mercado Libre se realizará con una Mercado Libre Developers Application, OAuth server-side y la API oficial. `client_id`, `client_secret`, `redirect_uri`, `access_token` y `refresh_token` son datos server-only; cada cuenta vendedora autorizará la aplicación mediante OAuth. MercadoCuentas es solo referencia funcional/producto: no se usan ni copian sus endpoints privados, y no es una dependencia ni un backend.

El siguiente bloque pendiente es Fase 2: Store, persistencia, connections, fuente definitiva de roles/asignaciones y preparación del StoreIntegrationResolver. Esta referencia no autoriza implementar esos componentes antes de su aprobación explícita.

### Fase 2 — Persistencia multi-tenant

Modelar `stores`, `external_connections`, `external_accounts` y `audit_log`, con tenant keys, constraints, índices, migraciones reproducibles, repositorios server-only y RLS como defensa adicional.

#### Decisiones aprobadas después de la auditoría 2.0

`hub_memberships` es la fuente server-side definitiva de los roles e-Hub por `Clerk userId + Organization`; el mapping Clerk es solo transitorio. El primer Owner se inicializa mediante `bootstrap_first_owner` server-side cerrado; Owners adicionales y otros memberships usan `provisionMembership()` con autoridad persistente. Owner y Manager tienen scope implícito sobre todas las Stores de su Organization; Employee y Client requieren `store_assignments` explícitos y una membership inexistente se deniega.

La base conceptual aprobada es `hub_memberships`, `stores`, `store_assignments` y `connections`. Store tiene relación 1:N con Connections; `provider + external_account_id` debe ser único entre conexiones activas cuando exista cuenta externa. La transferencia de cuenta será un workflow explícito posterior, nunca un cambio arbitrario de `store_id` u `organization_id` de una Connection activa. Provider permanece como conjunto controlado, sin tabla propia.

Las migraciones usan SQL versionado con Supabase CLI `2.114.0`, instalada como `devDependency` exacta e invocada con Bun. La política de antigüedad de paquetes permanece activa: el intento de `2.115.0` fue bloqueado, sin bypass. La 2.2 creó `20260821230525_phase_2_store_foundation.sql` con `hub_memberships`, `stores` y `store_assignments`: UUID internos, IDs externos `text`, `timestamptz`, checks, FKs compuestas e índices mínimos. La migración no fue ejecutada por ausencia de Docker; por lo tanto no hay schema aplicado. `connections`, su índice parcial y los tokens OAuth permanecen diferidos a 2.5/Fase 3. La defensa primaria es backend server-only, queries/repositories tenant-scoped y constraints/FKs compuestas. RLS queda diferido como defensa adicional porque service role no es una garantía de aislamiento. Ver [base de datos y migraciones](./meli-database.md) y el [mandato 2.2](./prompts/phase-02/2.2-persistencia.md).

La secuencia aprobada es: 2.1 diseño final de schema y convención de migraciones; 2.1B instala la CLI exacta e inicializa configuración local; 2.2 crea la migración mínima sin ejecutarla; 2.3 repositories y fuente propia de roles; 2.4 Store Scope; 2.5 Connections sin OAuth; 2.6 checkpoint. La ejecución local de DDL requiere Docker y una aprobación operativa correspondiente.

La 2.3 incorpora repositorios server-only tenant-scoped para `hub_memberships`, `stores` y `store_assignments`, y un resolver de rol persistente testeable. El bootstrap del primer Owner está implementado con advisory lock, re-check e insert atómico; los guards conservan el mapping Clerk como fallback transitorio solo cuando no existe membership persistente.

La 2.4 incorpora Store Scope server-only: Owner y Manager resuelven `all-stores` dentro de la Organization activa; Employee y Client resuelven únicamente IDs provenientes de assignments tenant-scoped. Permission y Store Scope son controles independientes. El resolver no se integra aún con rutas de Store porque no existen, y la migración sigue sin ejecutarse.

La 2.5 agrega una migración aditiva de `connections` y un repository server-only tenant-scoped. La tabla conserva metadata provider-agnostic, scopes y expiración opcional; no contiene tokens ni secretos. `active` reserva globalmente `provider + external_account_id`; `disabled` permite un workflow futuro de release. OAuth, RLS y StoreIntegrationResolver permanecen diferidos.

#### Security Hardening Backlog

Antes de exponer funcionalidades públicas o productivas se revisarán explícitamente: queries parametrizadas y SQL/RPC futuros; validación Zod con allow-list y límites de inputs, arrays, payloads, IDs y paginación; mass assignment; rate limiting; RLS como defensa adicional; prompt injection y límites de tools; salida/XSS; CSRF/Origin; uploads; y logging/privacidad sin tokens, cookies, secretos ni payloads sensibles indiscriminados. Este backlog no declara ninguna de esas defensas como implementada.

#### Fase 2 — Estado final

Para evidencia detallada de ejecución consultar [database-runtime-validation.md](./database-runtime-validation.md); para schema, migraciones y estado DB consultar [meli-database.md](./meli-database.md).

**Clasificación:** **FASE 2 ACTIVA — Checkpoint 2.13 cerrado, planificación de Stores siguiente.** Las migraciones 2.2, 2.5 y 2.8 están validadas localmente y en el proyecto remoto enlazado `ffcudwwrzttkumbdvada`; no equivale a Production Ready. **Implementado/versionado:** tooling Supabase, migraciones, repositorios server-only, bootstrap First Owner, Current Owner persistente, Store Scope y Connections provider-agnostic. **Autoridad de rol:** `hub_memberships` por `(Organization, Clerk user)` es primaria; Clerk sólo es fallback transitorio cuando la consulta exitosa no encuentra membership. Un error DB falla cerrado. **Diferido:** Stores reales, memberships adicionales/assignments, eliminación de fallback, RLS, rate limiting, OAuth, StoreIntegrationResolver y Fase 3. Owner cardinality es ONE OR MORE y bootstrap usa advisory lock transaccional. **BLOCKER BEFORE REMOVING TRANSITIONAL ROLE FALLBACK:** provisioning de usuarios restantes, observación de fallback y aprobación explícita de cutover.

**2.8:** Bootstrap First Owner está IMPLEMENTED + LOCAL VALIDATED: Owner cardinality es ONE OR MORE; Clerk server-side exige sesión, Organization activa y `org:admin`, mientras PostgreSQL proporciona advisory lock, re-check e insert atómico. Remote Supabase es el siguiente checkpoint controlado; fallback Clerk permanece TRANSITIONAL y Fase 3 no inició.

**2.10:** `hub_memberships` queda activada como autoridad primaria de roles e-Hub en servidor. La resolución consulta siempre `(organizationId, clerkUserId)` derivados de Clerk; una membership válida usa source interno `persistent`. Sólo una consulta exitosa sin fila puede usar el fallback transitorio `org:admin → Owner` o `org:member → Employee` con source `clerk-fallback`. Error DB, Organization mismatch o rol desconocido deniegan; no existe fallback ante error. No se crean memberships ni assignments reales, no se agrega migration y el retiro del fallback sigue pendiente de provisioning, observación y aprobación de cutover.

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
- Vitest y pruebas de: sin sesión, sin Organization, sin permiso, roles y mapping provisional, aislamiento entre Organizations, cross-tenant `404`, validación `400`, contrato HTTP y privacidad Sentry. Las pruebas de Store, Client ownership y asignaciones se difieren a Fase 2 porque esas entidades no existen todavía.
- `typecheck`, `lint`, formato según la excepción vigente, `build`, tests y documentación aprobados.
# Subfase 2.11 — estado

La preparación de provisioning de memberships y Store assignments queda limitada a código server-only y fixtures/tests deterministas. No se crean usuarios o Stores reales, no se retira el fallback Clerk, no se implementa OAuth ni se inicia Fase 3.
# Checkpoint 2.12 — planificación, sin escrituras reales

2.12 prepara el inventario y la aprobación humana de memberships y Store assignments reales. El inventario remoto read-only confirmó `hub_memberships = 0`, `stores = 0`, `store_assignments = 0` y `connections = 0`; Current Clerk Admin es el Current Real Owner y está aprobado sólo para provisioning futuro. No autoriza INSERT/UPDATE/DELETE remotos, cambios de schema, retiro de fallback, OAuth ni Fase 3. El plan canónico es [docs/provisioning-plan.md](provisioning-plan.md).

**2.13 — corrección de bootstrap:** el primer Owner no puede invocar `provisionMembership()` directamente porque esa primitive exige un Owner resuelto. La ruta temporal, autenticada y sin parámetros usa el RPC `bootstrap_first_owner`; sólo Clerk `org:admin` con Organization activa puede auto-provisionarse como Owner inicial. No generaliza el fallback ni modifica la autorización persistente normal.

**2.13 — postcheck provisional:** el RPC creó exactamente una membership persistente `Owner` para el Current Clerk Admin. No existen Stores, assignments ni connections. El resolver prioriza esa fila y, por contrato, pasa a `roleSource = persistent`; la verificación de idempotencia todavía requiere un retry manual autenticado. El fallback global no se retira.

**2.13 — cierre:** la segunda invocación autenticada devolvió `already_exists`; el count final es una sola membership `Owner`. La ruta temporal fue eliminada. Fallback global continúa transicional; el siguiente paso es planificación de creación de Stores reales, sin iniciar OAuth ni Fase 3.
