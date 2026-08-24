# Multi-tenancy

Modelo de tenant e identidad:

```text
Clerk Organization/Tenant
  -> Client
    -> Store
      -> External Connection -> External Account

Store <- Team / Employee / Manager assignments
```

La Organization activa se obtiene desde `auth()` en servidor. Client, Store, Team, User y asignaciones son conceptos de dominio distintos de los roles de Clerk. Un Client puede tener múltiples Stores y una Store puede asignarse a múltiples Teams, Employees y Managers sin alterar su identidad ni su relación con el Client.

El servidor aplica `User -> Role -> Permission -> Organization Scope -> Store Scope -> Resource` y los repositorios filtran por tenant. En Fase 1, el scope efectivo era Organization; 2.4 agrega el resolver server-only de Store Scope sin reemplazarlo. Una conexión nunca puede reutilizarse entre Organizations. Webhooks futuros resolverán el tenant por la cuenta/conexión almacenada, no desde el payload.

RLS puede reforzar PostgreSQL, pero no sustituye autenticacion Clerk, autorizacion ni validacion de ownership.

## Estado al cierre de Fase 1

El único Resource Scope implementado es Organization. Los mocks tenantizados son almacenamiento temporal para demostrar que `resource.organizationId === context.organizationId`; no representan Client, Store, Team, ownership ni asignaciones reales. En Fase 2, el scope deberá imponerse dentro de repositorios o queries tenant-scoped, no mediante filtrado posterior en memoria.

## Decisiones de diseño aprobadas para Fase 2

`hub_memberships` será la autoridad de roles e-Hub por Organization; Clerk conserva AuthN e identidad. Owner y Manager tienen Store Scope implícito para todas las Stores de su Organization, sujeto a permissions. Employee y Client requieren `store_assignments` explícitos; sin membership o assignment aplicable, el resultado es deny. Mientras la migración no esté ejecutada, el mapping Clerk sigue como fallback transitorio y no inventa assignments. **BOOTSTRAP FIRST OWNER: DEFERRED** hasta decidir una constraint/estrategia segura frente a concurrencia.

`store_assignments` deberá relacionar membership, Store y `organization_id` con FKs compuestas, de modo que no pueda unir entidades de tenants distintos. `storeId` del request solo identifica el objetivo: el servidor comprueba Organization, membership, permiso y Store Scope antes de operar. La defensa primaria será server-only + queries tenant-scoped + constraints; RLS se difiere porque el service role actual la bypassa.

La Subfase 2.1 documenta —sin aplicar todavía— las referencias compuestas `(membership_id, organization_id)` hacia `hub_memberships(id, organization_id)` y `(store_id, organization_id)` hacia `stores(id, organization_id)`. El mismo patrón une cada Connection con su Store. Las consultas y mutaciones futuras deberán incluir `organization_id` en el predicado y operar de forma atómica; la constraint evita que un bug una filas de tenants distintos, pero no sustituye la autorización server-side.

La 2.3 prepara repositorios que no exponen lookup global de Store ni membership por Clerk user sin Organization. La 2.4 añade un resolver explícito: `all-stores` para Owner/Manager y `assigned-stores` para Employee/Client; un scope vacío nunca equivale a todas las Stores. Listados por IDs siguen requiriendo `organization_id` y no hay aún rutas de Store ni DB ejecutada.

La 2.5 agrega el modelo de Connection: Store 1:N Connections y FK compuesta `(store_id, organization_id)`. Provider es el conjunto canónico controlado por código; una cuenta externa solo se reserva globalmente cuando la Connection está `active`. Tokens, OAuth y StoreIntegrationResolver siguen diferidos.
# Bootstrap First Owner

Flujo validado: Usuario autenticado → Clerk → Organization activa → `org:admin` server-side → IDs confiables → RPC bootstrap → advisory transaction lock por Organization → membership Owner persistente. Browser, body, query y formularios no eligen Organization, usuario ni rol. Bootstrap sólo crea el primer Owner; una Organization puede tener uno o más Owners mediante un futuro flujo administrativo. Una membership no-Owner existente no se promociona automáticamente.
