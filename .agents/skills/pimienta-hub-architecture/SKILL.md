---
name: pimienta-hub-architecture
description: Guía de invariantes arquitectónicas para cambios en rutas, features, servicios, persistencia o integraciones de Pimienta Hub. Úsala para preservar auth, tenancy, Store Scope, boundaries y seguridad server-only; el estado actual se consulta en el repo y sus docs canónicos.
---

# Pimienta Hub Architecture

Esta skill ayuda a aplicar las invariantes de Pimienta Hub. No es autoridad
normativa ni snapshot de fase. Antes de usarla, leer `REGLAS.md`, `AGENTS.md` y
`docs/plan-y-gobierno.md`; ante una contradicción material, detenerse y
reportarla.

## Objetivo

Mantener un SaaS multi-tenant y multicanal donde las Stores y sus Connections
permanezcan aisladas por Organization, y donde cada provider pueda evolucionar
sin contaminar features ni debilitar seguridad.

## Flujo de trabajo

1. Revisar reglas, plan, working tree y alcance autorizado.
2. Identificar el código y los tests que controlan el comportamiento.
3. Resolver tenant, permiso, Store Scope y boundaries afectados.
4. Consultar documentación especializada y, para providers, documentación
   oficial vigente.
5. Distinguir decisión confirmada, suposición y decisión pendiente.
6. Implementar el cambio mínimo y validarlo en proporción al riesgo.

No iniciar operaciones remotas, OAuth, refresh, sync, migrations o writes al
provider sin autorización explícita.

## Identidad, roles y tenancy

- Clerk aporta authentication, session, `userId`, Organization activa y
  membership técnica de Clerk Organization.
- Clerk Organization representa el tenant de identidad.
- `hub_memberships` es la autoridad server-side del business role Pimienta Hub:
  Owner, Manager, Employee o Client.
- Owner y Manager tienen Store Scope sobre todas las Stores de su Organization.
- Employee y Client sólo tienen scope sobre Stores asignadas.
- Permission y Store Scope son controles independientes.
- Roles, planes, metadata y navegación de Clerk no autorizan operaciones de
  negocio.
- Un fallback Clerk transicional documentado en código es compatibilidad, no
  autoridad de negocio ni fuente de assignments.
- Supabase se usa como PostgreSQL; Supabase Auth está prohibido.
- `service_role` es exclusivamente server-only.

El tenant se resuelve desde Clerk en servidor. Nunca confiar en `orgId`,
`organizationId`, `storeId`, `connectionId`, role o scope enviados por el
navegador.

## Flujo server-side obligatorio

```text
Request
  -> Authentication
  -> Authorization
  -> Tenant resolution
  -> Validation
  -> Service
  -> Repository
  -> Database
```

Estar dentro de `/api` o `/dashboard` no equivale a estar autorizado. La
visibilidad cliente es UX; todo endpoint protegido repite auth, permiso y scope
en servidor.

## Boundaries

- `src/features/`: lógica y UI de producto provider-agnostic.
- `src/integrations/`: adapters, clients, DTOs, mappers y servicios externos.
- `src/infrastructure/`: repositories, DB e infraestructura técnica.

No crear integraciones específicas dentro de features. No importar DTOs o
errores de Mercado Libre en UI o features. Los providers se traducen a
contratos internos mediante mappers.

No crear `src/application/` o `src/domain/` por reflejo. Extraer una capa sólo
cuando una responsabilidad real y una decisión documentada la justifiquen.

## Datos y credenciales

- Toda entidad de negocio tiene tenant key directa o relación verificable.
- Repositories y RPCs reciben scope server-derived y filtran por tenant.
- FKs compuestas, constraints, índices y RLS refuerzan el aislamiento.
- RLS no sustituye autorización server-side; `service_role` puede bypassearla.
- Tokens y secretos se cifran, permanecen server-only y se redactan de errores.
- No conservar tokens, authorization codes, headers, cookies, ciphertexts,
  payloads sensibles o PII innecesaria en logs, docs o trazas.
- Migraciones aplicadas son append-only; correcciones se realizan con una nueva
  migration forward.

Consultar [database.md](database.md) y el diseño canónico en
`docs/meli-database.md`.

## Integraciones externas

Cada provider debe encapsular:

- cliente HTTP server-only;
- authentication y refresh;
- timeouts, retries y rate limits;
- DTOs, mappers y errores normalizados;
- capacidades opcionales cuando no sean comunes;
- auditoría y persistencia tenant-bound cuando corresponda.

Usar exclusivamente aplicaciones propias y APIs oficiales. Nunca usar scraping,
cookies de sesión de terceros o backends privados.

Para Mercado Libre, revisar antes de cada cambio:

- `docs/meli-architecture.md`;
- `docs/meli-security.md`;
- `docs/meli-api.md`;
- `docs/meli-database.md`;
- `docs/meli-mercadolibre-OAuth/API.md`;
- documentación oficial vigente del endpoint o flujo afectado.

El estado implemented/future no vive en esta skill. Consultar `README.md`,
`docs/codex-handoff.md` y las docs especializadas; no asumir que OAuth,
refresh, listings, persistencia o sync siguen pendientes por una referencia
histórica.

## Guardrails

### Prohibido

- Acceder a providers o DB privilegiada desde Client Components.
- Exponer tokens o `service_role` al browser.
- Usar ocultamiento de botones como autorización.
- Permitir acceso cross-tenant.
- Usar una idempotency key como identidad, tenant o permiso.
- Mover archivos, migrar mocks o rediseñar el upstream sin necesidad concreta.
- Inventar contratos de OAuth, PKCE, webhooks o rate limits por memoria.

### Obligatorio

- Validar body, params y query en runtime.
- Resolver Organization, membership, Permission y Store Scope antes del recurso.
- Comprobar Store, Connection y provider antes de usar credenciales.
- Normalizar errores sin detalles internos ni secretos.
- Preservar idempotencia y atomicidad donde el flujo lo requiera.
- Probar aislamiento con tenants y resources distintos cuando aplique.
- Mantener el diff focalizado y compatible con el upstream.

## Validación

Aplicar la estrategia proporcional de `AGENTS.md` y el gate activo:

- docs-only: diff y `git diff --check`;
- TypeScript focalizado: tests relevantes y typecheck;
- auth/DB/security: tests relevantes, typecheck y lint;
- build y validaciones remotas sólo cuando el cierre o mandato lo exija.

## Referencias locales

- [authentication.md](authentication.md)
- [authorization.md](authorization.md)
- [multi-tenancy.md](multi-tenancy.md)
- [oauth.md](oauth.md)
- [api-client.md](api-client.md)
- [database.md](database.md)
- [sync-strategy.md](sync-strategy.md)
- [rate-limits.md](rate-limits.md)
- [webhooks.md](webhooks.md)
- [items.md](items.md)
- [orders.md](orders.md)
- [questions.md](questions.md)
- [shipments.md](shipments.md)
