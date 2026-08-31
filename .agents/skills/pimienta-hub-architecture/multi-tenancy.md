# Multi-tenancy

Modelo obligatorio:

```text
Clerk Organization/Tenant -> Store -> Connection -> Provider
```

Toda fila de negocio debe tener tenant key directa o una relacion verificable e indexada. Las consultas deben filtrar por el tenant derivado de Clerk, no por un valor enviado desde el navegador.

## Reglas

- Permitir multiples Stores y conexiones por Organization desde el modelo.
- Resolver el business role desde `hub_memberships`.
- Aplicar todas las Stores para Owner/Manager y assignments explicitos para
  Employee/Client; Permission y Store Scope siguen separados.
- Usar claves unicas compuestas por tenant, proveedor y cuenta externa.
- Incluir tenant en repositorios, logs, cache keys y futuros jobs.
- Los webhooks resuelven el tenant por la conexion/cuenta externa almacenada; nunca por el body.
- RLS es defensa en profundidad y no sustituye Clerk ni los repositorios server-only.
- Probar siempre con dos organizaciones y dos conexiones.
