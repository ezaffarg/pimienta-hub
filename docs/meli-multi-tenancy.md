# Multi-tenancy

Modelo:

```text
Clerk Organization/Tenant -> Store -> External Connection -> External Account
```

La organizacion activa se obtiene desde `auth()` en servidor. Los repositorios filtran por tenant y las claves de cache futuras incluyen tenant y conexion.

El modelo permite varias stores y cuentas externas por organizacion. Una conexion nunca puede reutilizarse entre organizaciones. Webhooks futuros resolveran el tenant por la cuenta/conexion almacenada, no desde el payload.

RLS puede reforzar PostgreSQL, pero no sustituye autenticacion Clerk, autorizacion ni validacion de ownership.