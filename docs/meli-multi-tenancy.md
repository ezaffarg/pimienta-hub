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

El servidor aplica `User -> Role -> Permission -> Resource Scope -> Resource` y los repositorios futuros filtran por tenant. En Fase 1, el contrato de scope usa un resolver temporal testeable; Fase 2 incorporará la persistencia de Client, Store, Team y asignaciones detrás del mismo contrato. Una conexión nunca puede reutilizarse entre Organizations. Webhooks futuros resolverán el tenant por la cuenta/conexión almacenada, no desde el payload.

RLS puede reforzar PostgreSQL, pero no sustituye autenticacion Clerk, autorizacion ni validacion de ownership.

## Estado al cierre de Fase 1

El único Resource Scope implementado es Organization. Los mocks tenantizados son almacenamiento temporal para demostrar que `resource.organizationId === context.organizationId`; no representan Client, Store, Team, ownership ni asignaciones reales. En Fase 2, el scope deberá imponerse dentro de repositorios o queries tenant-scoped, no mediante filtrado posterior en memoria.
